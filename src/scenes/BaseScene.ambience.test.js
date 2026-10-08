import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('@dimforge/rapier3d', async () => (await import('../test/fakeRapier.js')).rapierModule());

import { BaseScene } from './BaseScene.js';
import { GameObject } from '../core/GameObject.js';
import { makeEngine } from '../test/fakeRapier.js';
import { Ambience, AMBIENCE } from '../components/Ambience.js';
import { AirlockSound, AIRLOCK_SOUND } from '../components/AirlockSound.js';
import { SatelliteSound } from '../components/SatelliteSound.js';
import { WindowSand, windowDistance } from '../components/WindowSand.js';
import { ASSETS, PRELOAD } from '../assets/manifest.js';

// A full base build is slow under jsdom — see BaseScene.test.js.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// ─────────────────────────────────────────────
// Which loop the real base plays where. The blending itself is covered in
// AmbienceMix.test.js; this pins the wiring to the rooms as they are built.
// ─────────────────────────────────────────────

function makeSceneEngine() {
  const engine = makeEngine();
  engine.scene = new THREE.Scene();
  engine.scene.fog = new THREE.FogExp2(0x1a1a2e, 0.02);
  engine.assets = { get: vi.fn(() => null) };
  engine.buildPlayer = vi.fn(({ position = [0, 1, 5] } = {}) => {
    const player = new GameObject('Player');
    player.object3d.position.set(...position);
    engine.player = player;
    engine._rootObjects.push(player);
    return player;
  });
  return engine;
}

const centreOf = part => part.bounds().getCenter(new THREE.Vector3());

describe('BaseScene ambience', () => {
  let scene, mix;
  const { rooms: TRACK } = AMBIENCE;

  beforeAll(() => {
    scene = new BaseScene(makeSceneEngine());
    scene.build();
    mix = scene.ambience.mix;
  });

  /** The tracks audible at `p`, loudest first. */
  const heardAt = (p) => {
    const w = mix.weightsAt(p, {});
    return Object.keys(w).filter(k => w[k] > 1e-6).sort((a, b) => w[b] - w[a]);
  };

  it('puts an Ambience on the scene', () => {
    expect(scene.ambience).toBeInstanceOf(Ambience);
  });

  it('names clips the manifest knows', () => {
    for (const key of [...Object.values(TRACK), AMBIENCE.outside, AMBIENCE.music]) {
      expect(ASSETS[key], key).toBeDefined();
    }
  });

  it('gives each room its own loop', () => {
    expect(heardAt(centreOf(scene.rooms.MainOffice))).toEqual([TRACK.MainOffice]);
    expect(heardAt(centreOf(scene.rooms.ServerRoom))).toEqual([TRACK.ServerRoom]);
    expect(heardAt(centreOf(scene.rooms.LivingQuarters))).toEqual([TRACK.LivingQuarters]);
    expect(new Set([TRACK.MainOffice, TRACK.ServerRoom, TRACK.LivingQuarters]).size).toBe(3);
  });

  describe('in the airlock', () => {
    const wind = AMBIENCE.outside;
    const heardInAirlock = () => heardAt(centreOf(scene.rooms.Airlock));
    /** Tick the interlock on by `seconds`. */
    const cycle = (seconds) => {
      const airlock = scene.rooms.Airlock;
      for (let i = 0; i < Math.round(seconds * 60); i++) airlock.update(1 / 60);
    };
    const full = () => scene.rooms.Airlock.cycleTime + 0.5;

    afterEach(() => {
      scene.suit.takeOff();
      cycle(full());
      expect(scene.rooms.Airlock.state).toBe('pressurised');
    });

    it('plays the office loop while the inner door stands open, from end to end', () => {
      const airlock = scene.rooms.Airlock;
      expect(airlock.state).toBe('pressurised');
      const p = centreOf(airlock);
      for (const z of [airlock.bounds().min.z + 0.1, p.z, airlock.bounds().max.z - 0.1]) {
        p.z = z;
        expect(heardAt(p)).toEqual([TRACK.MainOffice]);
      }
    });

    it('is silent with both doors shut, then the wind when the hatch opens', () => {
      scene.suit.putOn();
      cycle(1);
      expect(scene.rooms.Airlock.state).toBe('depressurising');
      expect(heardInAirlock()).toEqual([]);

      cycle(full());
      expect(scene.rooms.Airlock.state).toBe('depressurised');
      expect(heardInAirlock()).toEqual([wind]);
    });

    it('is silent again on the way back in, then the office when the inner door opens', () => {
      scene.suit.putOn();
      cycle(full());
      scene.suit.takeOff();
      cycle(1);
      expect(scene.rooms.Airlock.state).toBe('pressurising');
      expect(heardInAirlock()).toEqual([]);

      cycle(full());
      expect(scene.rooms.Airlock.state).toBe('pressurised');
      expect(heardInAirlock()).toEqual([TRACK.MainOffice]);
    });

    it('stays silent through a change of mind, and never lets the wind in', () => {
      scene.suit.putOn();
      cycle(1);
      scene.suit.takeOff();
      expect(scene.rooms.Airlock.state).toBe('pressurising');
      expect(heardInAirlock()).toEqual([]);
      cycle(full());
      expect(heardInAirlock()).toEqual([TRACK.MainOffice]);
    });

    it('stays silent while sealed even in a storm', () => {
      mix.seep = 1;
      scene.suit.putOn();
      cycle(1);
      expect(heardInAirlock()).toEqual([]);
      mix.seep = 0;
    });

    it('leaves the office and the yard to their own sound, whichever door is open', () => {
      scene.suit.putOn();
      cycle(full());
      expect(heardAt(centreOf(scene.rooms.MainOffice))).toEqual([TRACK.MainOffice]);
      expect(heardAt(new THREE.Vector3(0, 1, 40))).toEqual([wind]);
    });
  });

  it('keeps the wind out of the rooms and the corridors', () => {
    const wind = AMBIENCE.outside;
    const inside = [...Object.values(scene.rooms), ...Object.values(scene.corridors)]
      .filter(part => part !== scene.rooms.Airlock);
    for (const part of inside) {
      expect(heardAt(centreOf(part)), part.name).not.toContain(wind);
    }
  });

  it('blends the office with the server room down their corridor', () => {
    const corridor = scene.corridors.OfficeToServer;
    expect(heardAt(centreOf(corridor)).sort()).toEqual([TRACK.MainOffice, TRACK.ServerRoom].sort());

    // Nearer the server room, the server room is the louder of the two.
    const p = centreOf(corridor);
    p.x = corridor.bounds().max.x - 0.5;
    expect(heardAt(p)).toEqual([TRACK.ServerRoom, TRACK.MainOffice]);
  });

  it('blends the office with the living quarters down theirs', () => {
    const corridor = scene.corridors.OfficeToQuarters;
    expect(heardAt(centreOf(corridor)).sort()).toEqual([TRACK.MainOffice, TRACK.LivingQuarters].sort());

    const p = centreOf(corridor);
    p.x = corridor.bounds().min.x + 0.5;
    expect(heardAt(p)).toEqual([TRACK.LivingQuarters, TRACK.MainOffice]);
  });

  it('has the sandstorm blow the ambience\'s wind, with no recording of its own', () => {
    expect(scene.sandstorm.ambience).toBe(scene.ambience);
    expect(ASSETS['sfx:sandstorm']).toBeUndefined();
  });

  it('mixes a little of a storm into the office, and less into the rest', () => {
    const wind = AMBIENCE.outside;
    const windAt = part => mix.weightsAt(centreOf(part), {})[wind];
    mix.seep = 1;
    expect(windAt(scene.rooms.MainOffice)).toBeCloseTo(AMBIENCE.storm.rooms.MainOffice);
    expect(windAt(scene.rooms.ServerRoom)).toBeCloseTo(AMBIENCE.storm.inside);
    expect(windAt(scene.rooms.LivingQuarters)).toBeCloseTo(AMBIENCE.storm.inside);
    expect(windAt(scene.corridors.OfficeToServer)).toBeCloseTo(AMBIENCE.storm.inside);
    // The airlock, open to the office, hears what the office hears.
    expect(windAt(scene.rooms.Airlock)).toBeCloseTo(AMBIENCE.storm.rooms.MainOffice);
    // The office's own loop stays as it was.
    expect(mix.weightsAt(centreOf(scene.rooms.MainOffice), {})[TRACK.MainOffice]).toBe(1);
    mix.seep = 0;
    expect(windAt(scene.rooms.MainOffice)).toBe(0);
  });

  it('gives the airlock a pressure release as it cycles', () => {
    const voice = scene.ambience.gameObject.getComponent(AirlockSound);
    expect(voice).not.toBeNull();
    expect(voice.airlock).toBe(scene.rooms.Airlock);
    // A one-shot the player must hear on the first cycle: preloaded.
    expect(ASSETS[AIRLOCK_SOUND.key]).toMatchObject({ type: 'audio' });
    expect(PRELOAD).toContain(AIRLOCK_SOUND.key);
  });

  it('runs the airlock cycle for as long as the pressure release is audible', () => {
    expect(scene.rooms.Airlock.cycleTime).toBe(AIRLOCK_SOUND.audibleSeconds);
  });

  it('only sounds the release for a player in the chamber', () => {
    const voice = scene.ambience.gameObject.getComponent(AirlockSound);
    const camera = new THREE.Object3D();
    scene.engine.camera = camera;
    camera.position.copy(centreOf(scene.rooms.Airlock));
    camera.updateMatrixWorld();
    expect(voice.isInside()).toBe(true);
    camera.position.copy(centreOf(scene.rooms.MainOffice));
    camera.updateMatrixWorld();
    expect(voice.isInside()).toBe(false);
    delete scene.engine.camera;
  });

  it('puts sand on the office window in a storm, for a player in the office', () => {
    const sand = scene.ambience.gameObject.getComponent(WindowSand);
    expect(sand).not.toBeNull();

    // The window is the office's own back window, in its wall.
    const office = scene.rooms.MainOffice;
    const centre = centreOf(office);
    expect(sand.window.z).toBeCloseTo(office.bounds().min.z + office.wallThick);
    expect(sand.window.x1 - sand.window.x0).toBeCloseTo(8.5);
    // Nearer the glass at the desk than at the front door.
    const front = centre.clone(); front.z = office.bounds().max.z - 0.5;
    const desk = centre.clone();  desk.z = office.bounds().min.z + 2.5;
    expect(windowDistance(desk, sand.window)).toBeLessThan(windowDistance(front, sand.window));

    // Only in the office.
    expect(sand.isInside(centre)).toBe(true);
    expect(sand.isInside(centreOf(scene.rooms.ServerRoom))).toBe(false);
    expect(sand.isInside(new THREE.Vector3(0, 1, 40))).toBe(false);

    // It follows the storm's own level.
    const level = scene.sandstorm.level;
    scene.sandstorm.level = 0.7;
    expect(sand.storm()).toBe(0.7);
    scene.sandstorm.level = level;
  });

  it('gives the dish the sound of its drive', () => {
    const voice = scene.satellite.getComponent(SatelliteSound);
    expect(voice).not.toBeNull();
    // It reads the dish it rides on.
    voice.onStart();
    expect(voice.satellite).toBe(scene.satellite);
    expect(typeof scene.satellite.velYaw).toBe('number');
    expect(typeof scene.satellite.velPitch).toBe('number');
  });

  it('plays the wind alone out in the yard, and up on the roof', () => {
    expect(heardAt(new THREE.Vector3(0, 1, 40))).toEqual([AMBIENCE.outside]);
    const roof = centreOf(scene.rooms.MainOffice);
    roof.y = scene.rooms.MainOffice.bounds().max.y + 1;
    expect(heardAt(roof)).toEqual([AMBIENCE.outside]);
  });
});
