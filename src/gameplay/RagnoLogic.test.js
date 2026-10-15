import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { RagnoLogic, RAGNO, scheduleVisits, moodFor } from './RagnoLogic.js';
import { approachRoute, climbRoute, NavGraph, inWindowView } from './RagnoPaths.js';

// ─────────────────────────────────────────────
// The base's numbers (see RagnoPaths.test.js), routes built from them, and a
// small graph of the rooms: quarters ─ corridor ─ office ─ corridor ─ server.
// ─────────────────────────────────────────────
const WIN = { x0: -4.25, x1: 4.25, z: -4.9, sill: 0.475, top: 2.825 };
const EYE = { x: 0, y: 1.24, z: -1.3 };
const SLOPE = { batter: 1.5, shoulder: 0.15, height: 3.1 };
const FENCE = { minX: -16.5, maxX: 16.5, minZ: 4.1, maxZ: 22 };
const PATH_LAYOUT = { window: WIN, eye: EYE, slope: SLOPE, fence: FENCE, ground: () => 0 };

const graph = new NavGraph([
  { id: 'qL', x: -15.4, z: 1.5 }, { id: 'qS', x: -13.8, z: 1.6 }, { id: 'qD', x: -10.9, z: 3.5, door: true },
  { id: 'qc', x: -8.1, z: 3.5 }, { id: 'oL', x: -5.3, z: 3.5, door: true }, { id: 'oC', x: 0, z: 1 },
  { id: 'oF', x: 2, z: 3.8 }, { id: 'oR', x: 5.3, z: 3.5, door: true }, { id: 'sc', x: 8.1, z: 3.5 },
  { id: 'sD', x: 10.9, z: 3.5, door: true }, { id: 'sS', x: 14.4, z: 3.5 }, { id: 'sL', x: 15.6, z: 3.7 },
], [['qL', 'qS'], ['qS', 'qD'], ['qD', 'qc'], ['qc', 'oL'], ['oL', 'oC'], ['oC', 'oF'], ['oC', 'oR'],
  ['oR', 'sc'], ['sc', 'sD'], ['sD', 'sS'], ['sS', 'sL']]);

function sideOf(sign) {
  const side = { sign, endX: 16.3 * sign, back: -3.1, front: 5.1, vent: { z: sign < 0 ? 1.5 : 3.7, y: 2.2 } };
  const inner = 16.1 * sign;
  return {
    ...side,
    approach: { window: approachRoute('window', side, PATH_LAYOUT), yard: approachRoute('yard', side, PATH_LAYOUT) },
    climb: climbRoute(side, PATH_LAYOUT),
    // Out of the grille, down the wall, onto the floor: the wall's normal points into the room.
    descent: [
      { x: inner, y: 2.2, z: side.vent.z, up: [-sign, 0, 0] },
      { x: inner, y: 0.5, z: side.vent.z, up: [-sign, 0, 0] },
      { x: inner - sign * 0.7, y: 0, z: side.vent.z, up: [0, 1, 0] },
    ],
    landing: sign < 0 ? 'qL' : 'sL',
    stare: sign < 0 ? 'qS' : 'sS',
    door: { x: 10.1 * sign, z: 3.5 },
    room: sign < 0 ? 'LivingQuarters' : 'ServerRoom',
    corridor: sign < 0 ? 'OfficeToQuarters' : 'OfficeToServer',
  };
}

const LAYOUT = {
  sides: { [-1]: sideOf(-1), [1]: sideOf(1) },
  graph,
  airlockDoor: { x: 2, z: 5.1 },
};

/** A rand that walks a fixed sequence, so runs repeat. */
function seeded(seed = 1) {
  let a = seed * 0x9e3779b9;
  return () => {   // mulberry32
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CAMERA = new THREE.Vector3(-17, 3.2, -2.5);

function sense(over = {}) {
  return {
    flashHit: false, flashFrom: null, flashlightHit: false, powerOn: true, glance: false, spook: false,
    player: { pos: new THREE.Vector3(0, 1.24, -1.3), zone: 'MainOffice' },
    nearestCamera: CAMERA, clearToPlayer: false, canWalk: () => true, exposed: false,
    ...over,
  };
}

function makeLogic(opts = {}) {
  return new RagnoLogic({ layout: LAYOUT, rand: seeded(opts.seed ?? 7) });
}

/** Run until `until(logic, events)` or `seconds` pass; returns every event seen. */
function run(logic, { seconds = 900, dt = 1 / 30, s = () => sense(), until = () => false, onFrame } = {}) {
  const seen = [];
  for (let t = 0; t < seconds; t += dt) {
    logic.update(dt, s(logic, t));
    seen.push(...logic.events);
    onFrame?.(logic, t);
    if (until(logic, seen)) break;
  }
  return seen;
}

describe('RagnoLogic — outside', () => {
  it('spawns at the start of its route, shown, outside', () => {
    const logic = makeLogic();
    logic.spawn({ side: -1, approach: 'window', mood: 'normal' });
    const start = LAYOUT.sides[-1].approach.window[0];
    expect(logic.state).toBe('approach');
    expect(logic.visible).toBe(true);
    expect(logic.indoors).toBe(false);
    expect(logic.pos.x).toBeCloseTo(start.x);
    expect(logic.pos.z).toBeCloseTo(start.z);
  });

  it('pauses to stare at the nearest camera, then darts in bursts', () => {
    const logic = makeLogic();
    logic.spawn({ side: -1, approach: 'window', mood: 'normal' });
    const modes = new Set();
    let staredAtCamera = true;
    run(logic, {
      seconds: 20,
      onFrame: (l) => {
        modes.add(l.mode);
        if (l.mode === 'stare') {
          expect(l.velocity.length()).toBe(0);
          const to = CAMERA.clone().sub(l.pos).setY(0).normalize();
          if (l.facing.clone().setY(0).normalize().dot(to) < 0.95) staredAtCamera = false;
        }
      },
    });
    expect([...modes]).toContain('stare');
    expect([...modes]).toContain('dart');
    expect(staredAtCamera).toBe(true);
  });

  it('darts fast: a jumping spider\'s bursts, never faster than its dart speed', () => {
    const logic = makeLogic();
    logic.spawn({ side: -1, approach: 'window', mood: 'normal' });
    let fastest = 0;
    run(logic, { seconds: 30, onFrame: l => { fastest = Math.max(fastest, l.velocity.length()); } });
    expect(fastest).toBeGreaterThan(RAGNO.mood.normal.dartSpeed * 0.8);
    expect(fastest).toBeLessThanOrEqual(RAGNO.mood.normal.dartSpeed + 1e-6);
  });

  it('climbs the slope to the vent, goes in, and comes out of the grille inside to watch the doorway', () => {
    const logic = makeLogic();
    logic.spawn({ side: -1, approach: 'yard', mood: 'normal' });
    let climbed = false;
    const seen = run(logic, {
      until: l => l.state === 'watch',
      onFrame: (l) => { if (l.state === 'climbOut' && l.up.x < -0.5) climbed = true; },
    });
    expect(climbed).toBe(true);
    expect(seen).toContain('ventIn');
    expect(seen).toContain('emerge');
    expect(seen.indexOf('ventIn')).toBeLessThan(seen.indexOf('emerge'));
    expect(logic.state).toBe('watch');
    expect(logic.indoors).toBe(true);
    // Facing the doorway.
    const door = LAYOUT.sides[-1].door;
    const to = new THREE.Vector3(door.x - logic.pos.x, 0, door.z - logic.pos.z).normalize();
    expect(logic.facing.dot(to)).toBeGreaterThan(0.95);
  });

  it('is hidden in the duct between the vent outside and the grille inside', () => {
    const logic = makeLogic();
    logic.spawn({ side: 1, approach: 'yard', mood: 'normal' });
    run(logic, { until: l => l.state === 'duct' });
    expect(logic.visible).toBe(false);
    run(logic, { until: l => l.state !== 'duct' });
    expect(logic.visible).toBe(true);
  });

  it('flashed outside: flinches, then runs out of the camera\'s sight and is gone', () => {
    const logic = makeLogic();
    logic.spawn({ side: -1, approach: 'window', mood: 'normal' });
    run(logic, { seconds: 3 });
    const at = logic.pos.clone();
    const seen = run(logic, {
      seconds: 1 / 30,
      s: () => sense({ flashHit: true, flashFrom: CAMERA }),
    });
    expect(seen).toContain('flinch');
    expect(logic.state).toBe('flinch');
    let fastest = 0;
    const after = run(logic, { until: l => l.state === 'off', onFrame: l => { fastest = Math.max(fastest, l.velocity.length()); } });
    expect(after).toContain('gone');
    expect(fastest).toBeGreaterThan(RAGNO.fleeSpeed * 0.9);
    expect(logic.pos.distanceTo(CAMERA)).toBeGreaterThan(at.distanceTo(CAMERA) + 5);
  });

  it('caught looking through the window: scurries to the side of the building, out of the view, then carries on', () => {
    const logic = makeLogic();
    logic.spawn({ side: -1, approach: 'window', mood: 'normal' });
    // Onto the edge of the view first.
    run(logic, { until: l => inWindowView(l.pos, EYE, WIN) });
    const seen = run(logic, { seconds: 1 / 30, s: () => sense({ glance: true }) });
    expect(seen).toContain('scurry');
    let fastest = 0;
    run(logic, { until: l => l.state !== 'scurry', onFrame: l => { fastest = Math.max(fastest, l.velocity.length()); } });
    expect(fastest).toBeGreaterThan(RAGNO.scurrySpeed * 0.9);
    expect(inWindowView(logic.pos, EYE, WIN)).toBe(false);
    expect(logic.pos.x).toBeLessThan(-10);
    expect(logic.state).toBe('approach');
  });

  it('seen by the player outside: scurries to the side of the building too', () => {
    const logic = makeLogic();
    logic.spawn({ side: 1, approach: 'yard', mood: 'normal' });
    run(logic, { seconds: 2 });
    const seen = run(logic, { seconds: 1 / 30, s: () => sense({ spook: true }) });
    expect(seen).toContain('scurry');
    run(logic, { until: l => l.state !== 'scurry' });
    expect(logic.state).toBe('approach');
  });

  it('in sight of the player outside (through the fence), bolts well off to the side into the trees', () => {
    const logic = makeLogic();
    logic.spawn({ side: 1, approach: 'yard', mood: 'normal' });
    run(logic, { seconds: 20 });
    const from = logic.pos.clone();
    const seen = run(logic, { seconds: 1 / 30, s: () => sense({ exposed: true }) });
    expect(seen).toContain('scurry');
    expect(logic.state).toBe('evade');
    let fastest = 0;
    run(logic, {
      until: l => l.velocity.length() === 0 && l.state === 'evade' && l.pos.distanceTo(from) > 1,
      s: () => sense({ exposed: true }),
      onFrame: (l) => { fastest = Math.max(fastest, l.velocity.length()); },
    });
    expect(fastest).toBeGreaterThan(RAGNO.scurrySpeed * 0.9);
    // Out away from the building, by a good way.
    expect(Math.abs(logic.pos.x) - Math.abs(from.x)).toBeGreaterThan(RAGNO.evadeDistance - 1);
  });

  it('waits out there while the player can see him, then comes back to his way in', () => {
    const logic = makeLogic();
    logic.spawn({ side: 1, approach: 'yard', mood: 'normal' });
    run(logic, { seconds: 20 });
    run(logic, { seconds: 10, s: () => sense({ exposed: true }) });
    expect(logic.state).toBe('evade');
    run(logic, { seconds: RAGNO.evadeHold - 0.5 });
    expect(logic.state).toBe('evade');
    run(logic, { until: l => l.state === 'approach', seconds: 30 });
    expect(logic.state).toBe('approach');
    // And still gets to the vent.
    const seen = run(logic, { until: l => l.state === 'climbOut' });
    expect(logic.state).toBe('climbOut');
    void seen;
  });

  it('not while climbing: up on the wall he carries on in', () => {
    const logic = makeLogic();
    logic.spawn({ side: 1, approach: 'yard', mood: 'normal' });
    run(logic, { until: l => l.state === 'climbOut' });
    run(logic, { seconds: 1 / 30, s: () => sense({ exposed: true }) });
    expect(logic.state).toBe('climbOut');
  });

  it('takes his time outside: a couple of minutes to the vent on night 2, less on night 3', () => {
    const time = (mood) => {
      let total = 0;
      for (let seed = 1; seed <= 4; seed++) {
        const logic = makeLogic({ seed });
        logic.spawn({ side: -1, approach: 'window', mood });
        let t = 0;
        run(logic, { until: l => l.state === 'climbOut', onFrame: () => { t += 1 / 30; } });
        total += t;
      }
      return total / 4;
    };
    const normal = time('normal'), aggressive = time('aggressive');
    expect(normal).toBeGreaterThan(120);
    expect(normal).toBeLessThan(300);
    expect(aggressive).toBeLessThan(normal);
  });

  it('night 1 (calm): creeps to the vent, lingers, and goes back without going in', () => {
    const logic = makeLogic();
    logic.spawn({ side: -1, approach: 'window', mood: 'calm' });
    let fastest = 0;
    const seen = run(logic, { seconds: 1200, until: l => l.state === 'off', onFrame: l => { fastest = Math.max(fastest, l.velocity.length()); } });
    expect(seen).toContain('linger');
    expect(seen).toContain('gone');
    expect(seen).not.toContain('ventIn');
    expect(fastest).toBeLessThanOrEqual(RAGNO.mood.calm.dartSpeed + 1e-6);
    expect(fastest).toBeLessThan(RAGNO.mood.normal.dartSpeed / 2);
  });
});

describe('RagnoLogic — inside', () => {
  /** Spawned and walked to his watch in the quarters. */
  function watching(mood = 'normal', seed = 7) {
    const logic = makeLogic({ seed });
    logic.spawn({ side: -1, approach: 'yard', mood });
    run(logic, { until: l => l.state === 'watch' });
    return logic;
  }

  it('flashed by the room\'s camera: flinches, runs back up into the grille (static), and is gone', () => {
    const logic = watching();
    const seen = run(logic, { seconds: 1 / 30, s: () => sense({ flashHit: true }) });
    expect(seen).toContain('flinch');
    const after = run(logic, { until: l => l.state === 'off' });
    expect(after).toContain('ventOut');
    expect(after).toContain('gone');
    expect(after.indexOf('ventOut')).toBeLessThan(after.indexOf('gone'));
  });

  it('the player coming down his corridor sets him off', () => {
    const logic = watching();
    const seen = run(logic, {
      seconds: 1 / 30,
      s: () => sense({ player: { pos: new THREE.Vector3(-8, 1.24, 3.5), zone: 'OfficeToQuarters' } }),
    });
    expect(seen).toContain('aggro');
    expect(logic.state).toBe('aggro');
  });

  it('a corridor that isn\'t his doesn\'t', () => {
    const logic = watching();
    const seen = run(logic, {
      seconds: 1,
      s: () => sense({ player: { pos: new THREE.Vector3(8, 1.24, 3.5), zone: 'OfficeToServer' } }),
    });
    expect(seen).not.toContain('aggro');
  });

  it('left watching long enough, he comes anyway', () => {
    const logic = watching();
    const seen = run(logic, { seconds: RAGNO.mood.normal.watch[1] + 1, until: (_l, s) => s.includes('aggro') });
    expect(seen).toContain('aggro');
  });

  it('night 3 watches for less time than night 2, and stares for less outside', () => {
    expect(RAGNO.mood.aggressive.watch[1]).toBeLessThan(RAGNO.mood.normal.watch[0]);
    expect(RAGNO.mood.aggressive.stare[1]).toBeLessThan(RAGNO.mood.normal.stare[1]);
    expect(RAGNO.mood.aggressive.dartPause[1]).toBeLessThan(RAGNO.mood.normal.dartPause[1]);
  });

  /** Watching, then set off and through the screech. */
  function chasing(playerPos = new THREE.Vector3(0, 1.24, 1), zone = 'MainOffice') {
    const logic = watching();
    run(logic, { seconds: 1 / 30, s: () => sense({ player: { pos: new THREE.Vector3(-8, 1.24, 3.5), zone: 'OfficeToQuarters' } }) });
    run(logic, { until: l => l.state === 'chase', s: () => sense({ player: { pos: playerPos, zone } }) });
    return logic;
  }

  it('chases the player through the base by the graph, thin through the doorways', () => {
    const logic = chasing();
    let thinnest = 0, fastest = 0;
    run(logic, {
      seconds: 30,
      s: () => sense({ player: { pos: new THREE.Vector3(0, 1.24, 1), zone: 'MainOffice' } }),
      until: l => l.state === 'caught',
      onFrame: (l) => { thinnest = Math.max(thinnest, l.stance); fastest = Math.max(fastest, l.velocity.length()); },
    });
    expect(thinnest).toBeGreaterThan(0.9);
    expect(fastest).toBeLessThanOrEqual(RAGNO.mood.normal.chaseSpeed + 1e-6);
    expect(logic.state).toBe('caught');
  });

  it('never cuts through a wall: the way starts at a spot he can walk straight to', () => {
    const logic = chasing();
    // In the quarters' corridor, by its wall; the office's door spot is
    // nearer as the crow flies, but the wall is in the way of it.
    logic.pos.set(-6.6, 0, 2.6);
    // The office's left wall at x −6.1, with a narrow door at z 3.2–3.8.
    const wall = (from, to) => {
      if ((from.x < -6.1) === (to.x < -6.1)) return true;
      const z = from.z + (to.z - from.z) * (-6.1 - from.x) / (to.x - from.x);
      return Math.abs(z - 3.5) < 0.3;
    };
    let first = null;
    run(logic, {
      seconds: 1 / 30,
      s: () => sense({ canWalk: wall, player: { pos: new THREE.Vector3(0, 1.24, 1), zone: 'MainOffice' } }),
      onFrame: (l) => { first ??= l.velocity.clone(); },
    });
    // He went for the corridor's own spot (−8.1, 3.5), away from the office:
    // not the office's door spot at (−5.3, 3.5) through the wall.
    expect(first.x).toBeLessThan(0);
  });

  it('catches a player within reach', () => {
    const logic = chasing();
    const at = logic.pos.clone();
    const seen = run(logic, {
      seconds: 1 / 30,
      s: () => sense({ player: { pos: at.clone().add(new THREE.Vector3(0.5, 1.24, 0)), zone: 'LivingQuarters' } }),
    });
    expect(seen).toContain('catch');
    expect(logic.state).toBe('caught');
  });

  it('chasing, the camera flash and the torch with the power on do nothing', () => {
    const logic = chasing();
    const seen = run(logic, {
      seconds: 1,
      s: () => sense({ flashHit: true, flashlightHit: true, powerOn: true, player: { pos: new THREE.Vector3(0, 1.24, 1), zone: 'MainOffice' } }),
    });
    expect(seen).not.toContain('flinch');
  });

  it('chasing, the torch with the power off sends him back to his vent', () => {
    const logic = chasing();
    const seen = run(logic, {
      seconds: 1 / 30,
      s: () => sense({ flashlightHit: true, powerOn: false, player: { pos: new THREE.Vector3(0, 1.24, 1), zone: 'MainOffice' } }),
    });
    expect(seen).toContain('flinch');
    const after = run(logic, { until: l => l.state === 'off', s: () => sense({ powerOn: false }) });
    expect(after).toContain('ventOut');
  });

  it('the player in the airlock: he breaks off and prowls, never camping its door', () => {
    const logic = chasing();
    const door = new THREE.Vector3(LAYOUT.airlockDoor.x, 0, LAYOUT.airlockDoor.z);
    const seen = run(logic, {
      seconds: 1 / 30,
      s: () => sense({ player: { pos: new THREE.Vector3(2, 1.24, 6), zone: 'Airlock' } }),
    });
    expect(seen).toContain('prowl');
    let lingeredNear = 0;
    run(logic, {
      seconds: RAGNO.prowlTimeout - 5,
      s: () => sense({ player: { pos: new THREE.Vector3(2, 1.24, 6), zone: 'Airlock' } }),
      onFrame: (l) => {
        const d = Math.hypot(l.pos.x - door.x, l.pos.z - door.z);
        if (d < RAGNO.airlockKeepOut && l.velocity.length() === 0) lingeredNear += 1 / 30;
      },
    });
    expect(lingeredNear).toBe(0);
    expect(logic.state).toBe('prowl');
  });

  it('the player back inside: after a grace, the hunt goes on', () => {
    const logic = chasing();
    run(logic, { seconds: 2, s: () => sense({ player: { pos: new THREE.Vector3(2, 1.24, 6), zone: 'outside' } }) });
    expect(logic.state).toBe('prowl');
    run(logic, { seconds: RAGNO.returnGrace - 0.5, s: () => sense({ player: { pos: new THREE.Vector3(0, 1.24, 1), zone: 'MainOffice' } }) });
    expect(logic.state).toBe('prowl');
    run(logic, { seconds: 1, s: () => sense({ player: { pos: new THREE.Vector3(0, 1.24, 1), zone: 'MainOffice' } }) });
    expect(logic.state).toBe('chase');
  });

  it('the player gone outside long enough: he leaves by his vent', () => {
    const logic = chasing();
    const seen = run(logic, {
      seconds: RAGNO.prowlTimeout + 60,
      s: () => sense({ player: { pos: new THREE.Vector3(2, 1.24, 12), zone: 'outside' } }),
      until: l => l.state === 'off',
    });
    expect(seen).toContain('ventOut');
    expect(seen).toContain('gone');
  });
});

describe('scheduleVisits', () => {
  it('night 1: once, at midnight, calm', () => {
    for (let seed = 1; seed < 20; seed++) {
      const visits = scheduleVisits(1, seeded(seed));
      expect(visits).toHaveLength(1);
      expect(visits[0].hour).toBe(RAGNO.night1Hour);
      expect(visits[0].mood).toBe('calm');
    }
  });

  it('night 2: one or two, after dark, spaced out', () => {
    const counts = new Set();
    for (let seed = 1; seed < 60; seed++) {
      const visits = scheduleVisits(2, seeded(seed));
      counts.add(visits.length);
      for (const v of visits) {
        expect(v.hour).toBeGreaterThanOrEqual(RAGNO.firstHour);
        expect(v.hour).toBeLessThanOrEqual(RAGNO.lastHour);
        expect(v.mood).toBe('normal');
        expect([-1, 1]).toContain(v.side);
        expect(['window', 'yard']).toContain(v.approach);
      }
      for (let i = 1; i < visits.length; i++) expect(visits[i].hour - visits[i - 1].hour).toBeGreaterThanOrEqual(RAGNO.minGapHours - 1e-9);
    }
    expect([...counts].sort()).toEqual([1, 2]);
  });

  it('night 3: two to four, aggressive', () => {
    const counts = new Set();
    for (let seed = 1; seed < 80; seed++) {
      const visits = scheduleVisits(3, seeded(seed));
      counts.add(visits.length);
      for (const v of visits) expect(v.mood).toBe('aggressive');
    }
    expect([...counts].sort()).toEqual([2, 3, 4]);
  });

  it('a mood per night', () => {
    expect(moodFor(1)).toBe('calm');
    expect(moodFor(2)).toBe('normal');
    expect(moodFor(3)).toBe('aggressive');
    expect(moodFor(5)).toBe('aggressive');
  });
});
