import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('@dimforge/rapier3d', async () => (await import('../test/fakeRapier.js')).rapierModule());

import { BaseScene } from './BaseScene.js';
import { GameObject } from '../core/GameObject.js';
import { makeEngine } from '../test/fakeRapier.js';
import { Ragno } from '../gameplay/Ragno.js';
import { inWindowView } from '../gameplay/RagnoPaths.js';
import { sightBlocked } from '../gameplay/DustEyes.js';
import { RAGNO_GAIT, stanceHome } from '../gameplay/RagnoGait.js';

// A full base build is slow under jsdom — see BaseScene.test.js.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// ─────────────────────────────────────────────
// Ragno in the base as built: his two cameras, his vents, his routes and
// the rooms he hunts through.
// ─────────────────────────────────────────────

function makeSceneEngine() {
  const engine = makeEngine();
  engine.scene = new THREE.Scene();
  engine.scene.fog = new THREE.FogExp2(0x1a1a2e, 0.02);
  engine.assets = { get: vi.fn(() => null) };
  engine.camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000);
  engine.input = { keys: {}, pressed: {} };
  engine.keyBinds = { forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', flashlight: 'KeyF' };
  engine.consumeAction = vi.fn();
  engine.viewCamera = null;
  engine.buildPlayer = vi.fn(({ position = [0, 1, 5] } = {}) => {
    const player = new GameObject('Player');
    player.object3d.position.set(...position);
    engine.player = player;
    engine._rootObjects.push(player);
    return player;
  });
  return engine;
}

const worldPos = o => o.getWorldPosition(new THREE.Vector3());

describe('BaseScene — Ragno', () => {
  let engine, scene, cams, byLabel, layout;

  beforeAll(() => {
    engine = makeSceneEngine();
    scene = new BaseScene(engine);
    scene.build();
    engine.scene.userData.engine = engine;
    const sceneRoot = engine._rootObjects.find(go => go.name === 'SceneRoot');
    sceneRoot._init?.(engine.scene, engine.world);
    sceneRoot.object3d.updateMatrixWorld(true);
    cams = scene.securityCameras;
    byLabel = Object.fromEntries(cams.map(c => [c.label, c]));
    layout = scene.ragnoLayout;
  });

  it('runs on the gameplay systems, his figure built hidden', () => {
    expect(scene.ragno).toBeInstanceOf(Ragno);
    expect(scene.ragnoFigure.object3d.visible).toBe(false);
  });

  describe('his two cameras: on CCTV poles in the clearing behind each wing', () => {
    const check = (label, roomName, side) => {
      const cam = byLabel[label];
      expect(cam, label).toBeDefined();
      const p = worldPos(cam.object3d);
      const b = scene.rooms[roomName].bounds();
      expect(scene._isOutside(p)).toBe(true);
      expect(Math.sign(p.x)).toBe(side);
      // In the clearing behind its wing, toward the end, well off the wall.
      expect(Math.abs(p.x)).toBeGreaterThan(Math.abs(scene.rooms.MainOffice.bounds().max.x));
      expect(Math.abs(p.x)).toBeLessThan(Math.abs(side < 0 ? b.min.x : b.max.x));
      expect(p.z).toBeLessThan(b.min.z - 5);
      // Up a pole, and looking out, away from the building.
      expect(p.y).toBeGreaterThan(3);
      const d = cam.lens.getWorldDirection(new THREE.Vector3());
      expect(Math.sign(d.x)).toBe(side);
      expect(cam.zones).toContain('yard');
    };
    it('the quarters side', () => check('POLE — QUARTERS SIDE', 'LivingQuarters', -1));
    it('the server side', () => check('POLE — SERVER SIDE', 'ServerRoom', 1));

    it('never see the building, however they are turned: only the trees', () => {
      const frustum = new THREE.Frustum();
      const m = new THREE.Matrix4();
      // Points all over the building's shells, the bunker's slopes included.
      const points = [];
      for (const part of [...Object.values(scene.rooms), ...Object.values(scene.corridors)]) {
        const b = part.bounds().expandByVector(new THREE.Vector3(1.5, 0, 1.5));
        for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) for (const y of [0.2, 1.5, 3]) {
          points.push(new THREE.Vector3(b.min.x + (b.max.x - b.min.x) * i / 4, y, b.min.z + (b.max.z - b.min.z) * j / 4));
        }
      }
      for (const label of ['POLE — QUARTERS SIDE', 'POLE — SERVER SIDE']) {
        const cam = byLabel[label];
        const [lo, hi] = cam.panLimits;
        for (let k = 0; k <= 10; k++) {
          cam.setPan(lo + (hi - lo) * k / 10);
          cam.object3d.updateMatrixWorld(true);
          cam.lens.updateMatrixWorld();
          frustum.setFromProjectionMatrix(m.multiplyMatrices(cam.lens.projectionMatrix, cam.lens.matrixWorldInverse));
          const seen = points.filter(p => frustum.containsPoint(p));
          expect(seen.length, `${label} at pan ${(lo + (hi - lo) * k / 10).toFixed(2)}`).toBe(0);
        }
        cam.setPan(0);
      }
    });

    it('look where he comes from: the start of the window-side walk is in view of each pole', () => {
      const frustum = new THREE.Frustum();
      const m = new THREE.Matrix4();
      for (const [label, sign] of [['POLE — QUARTERS SIDE', -1], ['POLE — SERVER SIDE', 1]]) {
        const cam = byLabel[label];
        cam.setPan(0);
        cam.object3d.updateMatrixWorld(true);
        cam.lens.updateMatrixWorld();
        frustum.setFromProjectionMatrix(m.multiplyMatrices(cam.lens.projectionMatrix, cam.lens.matrixWorldInverse));
        const start = layout.sides[sign].approach.window[0];
        expect(frustum.containsPoint(new THREE.Vector3(start.x, start.y + 0.9, start.z)), label).toBe(true);
      }
    });

    it('are cameras 7 and 8, after the six there were, each on a pole', () => {
      expect(cams).toHaveLength(8);
      expect(cams[6].label).toBe('POLE — QUARTERS SIDE');
      expect(cams[7].label).toBe('POLE — SERVER SIDE');
      expect(scene.cameraPoles).toHaveLength(2);
    });
  });

  describe('he is nearly always in some camera\'s view on his way in', () => {
    /** Can some outdoor camera, turned as it rests, see this point? With
     *  `trees`, not through a tree's canopy either. */
    function seen(point, trees = null) {
      const frustum = new THREE.Frustum();
      const m = new THREE.Matrix4();
      for (const cam of cams) {
        if (!cam.zones.includes('yard')) continue;
        cam.setPan(0);
        cam.object3d.updateMatrixWorld(true);
        const lens = cam.lens;
        lens.updateMatrixWorld();
        frustum.setFromProjectionMatrix(m.multiplyMatrices(lens.projectionMatrix, lens.matrixWorldInverse));
        if (!frustum.containsPoint(point)) continue;
        const from = worldPos(lens);
        if (from.distanceTo(point) > 32) continue;
        if (scene.ragno._blockedOutside(from, point)) continue;
        if (trees && sightBlocked(from, point, trees)) continue;
        return true;
      }
      return false;
    }

    for (const sign of [-1, 1]) {
      for (const approach of ['window', 'yard']) {
        it(`${approach} side, ${sign < 0 ? 'left' : 'right'}: in view for most of the walk`, () => {
          const route = layout.sides[sign].approach[approach];
          const points = [];
          for (let i = 1; i < route.length; i++) {
            const a = route[i - 1], b = route[i];
            const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.5));
            for (let k = 0; k < n; k++) points.push(new THREE.Vector3(a.x + (b.x - a.x) * k / n, a.y + 0.9, a.z + (b.z - a.z) * k / n));
          }
          const share = points.filter(p => seen(p)).length / points.length;
          expect(share, `${(share * 100).toFixed(0)}% in view`).toBeGreaterThan(0.75);
          // The trees hide him a little, never for long.
          const trees = scene._sceneRoot.find('Outside')?.find('MarsVegetation')?.trees ?? [];
          const clear = points.filter(p => seen(p, trees)).length / points.length;
          expect(clear, `${(clear * 100).toFixed(0)}% in view past the trees`).toBeGreaterThan(0.6);
        });
      }
    }
  });

  describe('the vents', () => {
    for (const sign of [-1, 1]) {
      const name = sign < 0 ? 'LivingQuarters' : 'ServerRoom';

      it(`${name}: the hood outside is on the end wall's slope, out of every room`, () => {
        const vent = scene.vents[sign];
        expect(scene._isOutside(vent.intake)).toBe(true);
        const b = scene.rooms[name].bounds();
        expect(vent.intake.z).toBeGreaterThan(b.min.z);
        expect(vent.intake.z).toBeLessThan(b.max.z);
        expect(Math.sign(vent.intake.x)).toBe(sign);
      });

      it(`${name}: the grille inside is on the same wall, inside the room`, () => {
        const vent = scene.vents[sign];
        expect(scene.rooms[name].bounds().containsPoint(vent.grille)).toBe(true);
        expect(scene._zoneOf(vent.grille)).toBe(name);
        expect(vent.grille.z).toBeCloseTo(vent.intake.z);
      });

      it(`${name}: some camera, turned some way, sees the hood with nothing in between`, () => {
        const vent = scene.vents[sign];
        const frustum = new THREE.Frustum();
        const m = new THREE.Matrix4();
        let seen = null;
        for (const cam of cams.slice(2)) {
          const [lo, hi] = cam.panLimits;
          for (let i = 0; i <= 40 && !seen; i++) {
            cam.setPan(lo + ((hi - lo) * i) / 40);
            cam.object3d.updateMatrixWorld(true);
            const lens = cam.lens;
            lens.updateMatrixWorld();
            frustum.setFromProjectionMatrix(m.multiplyMatrices(lens.projectionMatrix, lens.matrixWorldInverse));
            if (!frustum.containsPoint(vent.intake)) continue;
            const from = worldPos(lens);
            if (from.distanceTo(vent.intake) > cam.flashReach) continue;
            if (scene.ragno._blockedOutside(from, vent.intake)) continue;
            seen = cam.label;
          }
          cam.setPan(0);
        }
        expect(seen, `nothing sees the ${name} vent`).not.toBeNull();
      });
    }
  });

  describe('his routes outside', () => {
    const eye = { x: 0, y: 1.24, z: -1.4 };

    for (const sign of [-1, 1]) {
      const name = sign < 0 ? 'left' : 'right';
      it(`window side, ${name}: at most a far glimpse through the window as he sets off, then out of its view, with places to hide`, () => {
        const route = layout.sides[sign].approach.window;
        for (const p of route.slice(1)) expect(inWindowView(p, eye, layout.window)).toBe(false);
        for (const p of route.filter(q => q.hide)) {
          expect(inWindowView(p, eye, layout.window)).toBe(false);
          expect(scene._isOutside(new THREE.Vector3(p.x, 1, p.z))).toBe(true);
        }
      });

      it(`${name}: never walks backwards: from where he spawns every step brings him nearer the vent`, () => {
        for (const routes of [layout.sides[sign].approach, layout.sides[sign].creep]) {
          for (const approach of ['window', 'yard']) {
            const route = routes[approach];
            const foot = route[route.length - 1];
            const d = route.map(p => Math.hypot(p.x - foot.x, p.z - foot.z));
            for (let i = 1; i < d.length; i++) expect(d[i], `${approach} at ${i}`).toBeLessThanOrEqual(d[i - 1] + 1e-6);
          }
        }
      });

      it(`yard side, ${name}: never inside the fence`, () => {
        const { minX, maxX, minZ, maxZ } = scene.fence.rect;
        for (const p of layout.sides[sign].approach.yard) {
          expect(p.x > minX && p.x < maxX && p.z > minZ && p.z < maxZ).toBe(false);
        }
      });

      it(`${name}: the climb ends just under the hood`, () => {
        const climb = layout.sides[sign].climb;
        const top = climb[climb.length - 1];
        expect(top.y).toBeLessThan(scene.vents[sign].intake.y);
        expect(Math.abs(top.z - scene.vents[sign].intake.z)).toBeLessThan(1e-6);
      });
    }
  });

  describe('the rooms he hunts through', () => {
    it('every spot is in a room or a corridor, and each room is joined to the other through the office', () => {
      const { graph } = layout;
      for (const n of graph.nodes) {
        expect(scene._zoneOf(new THREE.Vector3(n.x, 1, n.z)), n.id).not.toBe('outside');
      }
      const way = graph.route('qL', 'sL').map(n => scene._zoneOf(new THREE.Vector3(n.x, 1, n.z)));
      expect(way).toContain('OfficeToQuarters');
      expect(way).toContain('MainOffice');
      expect(way).toContain('OfficeToServer');
    });

    it('he watches from his own room, and the doorway he watches is that room\'s', () => {
      for (const sign of [-1, 1]) {
        const side = layout.sides[sign];
        const watch = layout.graph.get(side.stare);
        expect(scene._zoneOf(new THREE.Vector3(watch.x, 1, watch.z))).toBe(side.room);
      }
    });

    it('thin, he fits through every doorway', () => {
      const homes = [[0.73, 0, 0.06], [0.26, 0, -0.69], [-0.73, 0, 0.06], [-0.26, 0, -0.69]];
      const doorWidth = Math.min(...[scene.rooms.LivingQuarters, scene.rooms.ServerRoom, scene.rooms.MainOffice]
        .flatMap(r => r.openings.filter(o => o.side === 'left' || o.side === 'right').map(o => o.width)));
      for (const h of homes) expect(Math.abs(stanceHome(h, 1, new THREE.Vector3(), RAGNO_GAIT).x)).toBeLessThan(doorWidth / 2);
    });

    it('the airlock\'s door, which he never camps, is the office\'s front door', () => {
      const door = new THREE.Vector3(layout.airlockDoor.x, 1, layout.airlockDoor.z - 0.05);
      expect(scene._zoneOf(door)).toBe('MainOffice');
      expect(scene._zoneOf(door.clone().setZ(layout.airlockDoor.z + 0.5))).toBe('Airlock');
    });
  });

  it('there is a way round the office desk, behind it, that never crosses it', () => {
    const { graph } = layout;
    const way = graph.route('oC', 'oB');
    expect(way.map(n => n.id)).toContain('oB');
    // The desk and its wings on the floor, from the room's own boxes.
    const desk = new THREE.Box3();
    for (const name of ['ComputerDesk', 'DeskWingSolid_Left', 'DeskWingSolid_Right']) {
      const o = scene.rooms.MainOffice.root.object3d.getObjectByName(name);
      if (o) desk.union(new THREE.Box3().setFromObject(o));
    }
    const station = desk.isEmpty() ? null : desk;
    for (let i = 1; i < way.length; i++) {
      for (let t = 0; t <= 1; t += 0.05) {
        const x = way[i - 1].x + (way[i].x - way[i - 1].x) * t;
        const z = way[i - 1].z + (way[i].z - way[i - 1].z) * t;
        if (station) expect(x > station.min.x && x < station.max.x && z > station.min.z && z < station.max.z).toBe(false);
        expect(scene._zoneOf(new THREE.Vector3(x, 1, z))).toBe('MainOffice');
      }
    }
    // Behind the desk is between it and the window wall.
    const b = graph.get('oB');
    expect(b.z).toBeLessThan(-2.95);
    expect(b.z).toBeGreaterThan(scene.rooms.MainOffice.bounds().min.z);
  });

  it('in the server room his way to the watch goes by the aisle\'s mouth, not across a rack', () => {
    const way = layout.graph.route('sL', 'sW').map(n => n.id);
    expect(way).toEqual(['sL', 'sA', 'sW']);
    // The aisle's mouth is in the room, forward of the racks (room-local z > 1.5).
    const a = layout.graph.get('sA');
    expect(scene._zoneOf(new THREE.Vector3(a.x, 1, a.z))).toBe('ServerRoom');
    expect(a.z - scene.rooms.ServerRoom.position[2]).toBeGreaterThan(1.5);
  });

  it('the corridors he goes thin in are their floors, between the walls', () => {
    expect(layout.corridors).toHaveLength(2);
    for (const c of layout.corridors) {
      const mid = new THREE.Vector3((c.minX + c.maxX) / 2, 1, (c.minZ + c.maxZ) / 2);
      expect(scene._zoneOf(mid)).toMatch(/^OfficeTo/);
      // Narrower than the shell by a wall each side.
      expect(c.maxZ - c.minZ).toBeLessThan(2.4);
      expect(c.maxZ - c.minZ).toBeGreaterThan(1.5);
    }
  });

  it('each vent hood outside has a grate across its mouth', () => {
    for (const name of ['VentHood_LivingQuarters', 'VentHood_ServerRoom']) {
      const hood = scene.bunker.object3d.getObjectByName(name);
      expect(hood, name).toBeDefined();
      const grate = hood.getObjectByName('VentGrate');
      expect(grate).toBeDefined();
      expect(grate.children.length).toBeGreaterThan(4);
    }
  });

  it('zoneOf names rooms, corridors, the airlock and outside', () => {
    expect(scene._zoneOf(new THREE.Vector3(0, 1, 0))).toBe('MainOffice');
    expect(scene._zoneOf(new THREE.Vector3(-8, 1, 3.5))).toBe('OfficeToQuarters');
    expect(scene._zoneOf(new THREE.Vector3(0, 1, -30))).toBe('outside');
  });
});
