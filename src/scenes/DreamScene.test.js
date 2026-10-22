// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('@dimforge/rapier3d', async () => (await import('../test/fakeRapier.js')).rapierModule());

import { DreamScene, BASE_SHELL } from './DreamScene.js';
import { BaseScene } from './BaseScene.js';
import { GameObject } from '../core/GameObject.js';
import { DreamWalk } from '../components/DreamWalk.js';
import { DreamFilter } from '../core/DreamFilter.js';
import { makeEngine } from '../test/fakeRapier.js';
import { DreamMusic } from '../components/DreamMusic.js';
import { DreamWind } from '../components/DreamWind.js';

// Imports and builds against the whole base scene module: as slow as
// BaseScene.test.js under a parallel run, so it gets the same budget.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

function makeDreamEngine() {
  const engine = makeEngine();
  engine.renderer = {
    setRenderTarget: vi.fn(),
    render: vi.fn(),
  };
  engine.scene = new THREE.Scene();
  engine.scene.fog = new THREE.FogExp2(0x1a1a2e, 0.02);
  engine.camera = new THREE.PerspectiveCamera(75);
  engine.assets = { get: vi.fn(() => null) };
  engine.buildPlayer = vi.fn(({ position = [0, 1, 5] } = {}) => {
    const player = new GameObject('Player');
    player.object3d.position.set(...position);
    engine.player = player;
    engine.playerController = {
      speedScale: 1, inputLocked: false, yaw: 0, pitch: 0, gameObject: player,
      teleport: vi.fn(([x, y, z], { yaw = 0, pitch = 0 } = {}) => {
        player.object3d.position.set(x, y, z);
        engine.playerController.yaw = yaw;
        engine.playerController.pitch = pitch;
      }),
    };
    engine._rootObjects.push(player);
    return player;
  });
  return engine;
}

describe('DreamScene (#101)', () => {
  let engine, scene;
  beforeEach(() => {
    engine = makeDreamEngine();
    scene = new DreamScene(engine, { level: 2, night: 2 });
    scene.build();
  });

  it('has the wind rush past as the base drags the dreamer back', () => {
    const all = go => [go, ...(go.children ?? []).flatMap(all)];
    const winds = engine._rootObjects.flatMap(all).map(g => g.getComponent?.(DreamWind)).filter(Boolean);
    expect(winds).toHaveLength(1);
    expect(winds[0].walk).toBe(scene.walk);
  });

  it('plays the spooky music under the dream', () => {
    const found = [];
    const all = go => [go, ...(go.children ?? []).flatMap(all)];
    for (const go of engine._rootObjects) for (const g of all(go)) { const m = g.getComponent?.(DreamMusic); if (m) found.push(m); }
    expect(found).toHaveLength(1);
  });

  it('wakes back into the base scene', () => {
    expect(DreamScene.returnTo).toBe(BaseScene);
  });

  it('takes its level and the night it came from, defaulting to 1', () => {
    expect(scene.level).toBe(2);
    expect(scene.night).toBe(2);
    const plain = new DreamScene(makeDreamEngine());
    expect(plain.level).toBe(1);
    expect(plain.night).toBe(1);
  });

  it('builds the valley: a sky that follows the camera, the terrain, and a moon light', () => {
    expect(scene.sky).toBeTruthy();
    expect(scene.terrain).toBeTruthy();
    expect(scene.moonLight?.isDirectionalLight).toBe(true);
  });

  describe('the base: the real one, not a block (meeting notes)', () => {
    /** The shell's edges left without a slope: the window wall and the hatch. */
    const flatEdges = () => scene.base.faces.edges.filter(e => e.flat);
    const boxOf = (o) => { o.updateWorldMatrix(true, true); return new THREE.Box3().setFromObject(o); };

    it("is the bunker shell, built from the base scene's own outline", () => {
      expect(scene.base.object3d.getObjectByName('BunkerSkin')).toBeTruthy();
      expect(scene.base.object3d.getObjectByName('BunkerEmbrasure')).toBeTruthy();
      expect(scene.base.faces.edges.length).toBe(BASE_SHELL.outline.length);
    });

    it('closes the two walls the shell leaves to the rooms, floor to roof', () => {
      const walls = [];
      scene.base.object3d.traverse(o => { if (o.name === 'DreamWall') walls.push(o); });
      expect(flatEdges().length).toBe(2);
      expect(walls.length).toBe(2);
      for (const e of flatEdges()) {
        const covers = walls.map(boxOf).some(b =>
          [e.a, e.b].every(p => b.distanceToPoint(new THREE.Vector3(p.x, 1, p.z)) < 0.05)
          && b.min.y <= 0.01 && b.max.y >= BASE_SHELL.height - 0.01);
        expect(covers).toBe(true);
      }
    });

    it("is solid all round: the slopes' hulls and a collider for each closed wall", () => {
      expect(scene.base.colliders.length).toBe(scene.base.faces.hulls.length + flatEdges().length);
    });

    it('has one warm window, in the window wall, inside its embrasure', () => {
      const glows = [];
      scene.base.object3d.traverse(o => { if (o.isMesh && o.material.emissive?.getHex()) glows.push(o); });
      expect(glows.length).toBe(1);
      const { edge, at, sill, height } = BASE_SHELL.embrasures[0];
      const e = scene.base.faces.edges[edge];
      const box = boxOf(glows[0]);
      const centre = box.getCenter(new THREE.Vector3());
      const along = (centre.x - e.a.x) * e.dir[0] + (centre.z - e.a.z) * e.dir[1];
      const out = (centre.x - e.a.x) * e.normal[0] + (centre.z - e.a.z) * e.normal[1];
      expect(along).toBeCloseTo(at, 1);
      expect(out).toBeGreaterThan(0);
      expect(out).toBeLessThan(0.08);   // behind the steel collar's lip
      expect(box.min.y).toBeGreaterThanOrEqual(sill - 0.01);
      expect(box.max.y).toBeLessThanOrEqual(sill + height + 0.01);
    });

    it("fades into the dream's fog, as the block did", () => {
      const unfogged = [];
      scene.base.object3d.traverse(o => { if (o.isMesh && o.material.fog === false) unfogged.push(o.name); });
      expect(unfogged).toEqual([]);
    });

    it('frees what the shell made when the dream goes', () => {
      const spies = scene.base.resources.map(r => vi.spyOn(r, 'dispose'));
      expect(spies.length).toBeGreaterThan(0);
      scene.dispose();
      for (const spy of spies) expect(spy).toHaveBeenCalled();
    });

    it('keeps the rocks off it', () => {
      const xs = BASE_SHELL.outline.map(p => p.x), zs = BASE_SHELL.outline.map(p => p.z);
      const m = new THREE.Matrix4(), p = new THREE.Vector3();
      let inside = 0;
      scene.rocks.object3d.traverse(o => {
        if (!o.isInstancedMesh) return;
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, m);
          p.setFromMatrixPosition(m);
          if (p.x > Math.min(...xs) && p.x < Math.max(...xs) && p.z > Math.min(...zs) && p.z < Math.max(...zs)) inside++;
        }
      });
      expect(inside).toBe(0);
    });
  });

  it('stands the player just outside the hatch, facing straight out of it', () => {
    const p = engine.player.object3d.position;
    const hatch = scene.base.faces.edges.find(e => e.flat && !BASE_SHELL.embrasures.some(w => w.edge === e.i));
    const mid = { x: (hatch.a.x + hatch.b.x) / 2, z: (hatch.a.z + hatch.b.z) / 2 };
    const out = (p.x - mid.x) * hatch.normal[0] + (p.z - mid.z) * hatch.normal[1];
    const aside = (p.x - mid.x) * hatch.dir[0] + (p.z - mid.z) * hatch.dir[1];
    expect(out).toBeGreaterThan(2);
    expect(out).toBeLessThan(5);
    expect(Math.abs(aside)).toBeLessThan(0.1);
    const yaw = engine.playerController.yaw;
    const forward = new THREE.Vector2(-Math.sin(yaw), -Math.cos(yaw));
    expect(forward.dot(new THREE.Vector2(...hatch.normal))).toBeGreaterThan(0.99);
  });

  it("measures the walk from the base's walls: its footprint covers the whole outline", () => {
    const { x, z, halfX, halfZ } = scene.walk.base;
    for (const p of BASE_SHELL.outline) {
      expect(Math.abs(p.x - x)).toBeLessThanOrEqual(halfX + 1e-9);
      expect(Math.abs(p.z - z)).toBeLessThanOrEqual(halfZ + 1e-9);
    }
    expect(BASE_SHELL.outline.some(p => Math.abs(Math.abs(p.x - x) - halfX) < 1e-9)).toBe(true);
    expect(BASE_SHELL.outline.some(p => Math.abs(Math.abs(p.z - z) - halfZ) < 1e-9)).toBe(true);
  });

  it('runs a DreamWalk at its level, round the base, on the scene fog and sky', () => {
    const walk = scene.walk;
    expect(walk).toBeInstanceOf(DreamWalk);
    expect(walk.level).toBe(2);
    expect(walk.fog).toBe(engine.scene.fog);
    expect(walk.sky).toBe(scene.sky);
    expect(walk.controller).toBe(engine.playerController);
  });

  it('waking loads the base scene and returns to the night it came from', async () => {
    let loaded;
    engine.loadScene = vi.fn((SceneClass) => {
      loaded = SceneClass;
      engine.activeScene = { nights: { setNight: vi.fn() } };
    });
    await scene.wake();
    expect(loaded).toBe(BaseScene);
    expect(engine.activeScene.nights.setNight).toHaveBeenCalledWith(2);
  });

  describe('waking holds the black until the base is ready (playtest: a long black screen)', () => {
    let fade, compiled;
    beforeEach(() => {
      fade = { caption: vi.fn(), uncover: vi.fn() };
      engine.screenFade = fade;
      engine.loadScene = vi.fn(() => { engine.activeScene = { nights: { setNight: vi.fn() } }; });
      let finish;
      compiled = new Promise((r) => { finish = r; });
      compiled.finish = finish;
      engine.compileScene = vi.fn(() => compiled);
    });

    it('says which night it is waking into, on the black', async () => {
      const waking = scene.wake();
      expect(fade.caption).toHaveBeenCalledWith('NIGHT 2');
      compiled.finish();
      await waking;
    });

    it('builds the base without the background compile, then waits for the compile', async () => {
      const waking = scene.wake();
      await Promise.resolve();
      await Promise.resolve();
      expect(engine.loadScene).toHaveBeenCalledWith(BaseScene, { compile: false });
      expect(engine.compileScene).toHaveBeenCalled();
      expect(fade.uncover).not.toHaveBeenCalled();
      compiled.finish();
      await waking;
      expect(fade.uncover).toHaveBeenCalledOnce();
    });

    it('a failed compile still uncovers — never stuck on black', async () => {
      engine.compileScene = vi.fn(() => Promise.reject(new Error('lost context')));
      await scene.wake();
      expect(fade.uncover).toHaveBeenCalledOnce();
    });
  });

  it('opens the eyes: the bunk\'s eyelids can be left shut by the sleep that led here', () => {
    document.body.innerHTML = '<div id="fatigue"><div id="fatigue-tunnel"></div><div id="fatigue-lids"></div></div>';
    const lids = document.getElementById('fatigue-lids');
    lids.style.setProperty('--lid', '1');
    new DreamScene(makeDreamEngine()).build();
    expect(lids.style.getPropertyValue('--lid')).toBe('0');
  });

  describe('the light on the ridge (Ryan\'s idea: something to walk towards)', () => {
    it('stands far ahead of the player, straight down their view', () => {
      const p = engine.player.object3d.position;
      const b = scene.beacon.object3d.position;
      const yaw = engine.playerController.yaw;
      const forward = new THREE.Vector2(-Math.sin(yaw), -Math.cos(yaw));
      const to = new THREE.Vector2(b.x - p.x, b.z - p.z);
      expect(to.clone().normalize().dot(forward)).toBeGreaterThan(0.99);
      expect(to.length()).toBeGreaterThan(200);
    });

    it('is out of reach: far past where the base pulls you back, at every level', () => {
      const b = scene.beacon.object3d.position;
      expect(Math.hypot(b.x, b.z)).toBeGreaterThan(80 * 2);
    });

    it('glows through the dream fog', () => {
      const glows = [];
      scene.beacon.object3d.traverse(o => { if (o.isMesh && o.material.fog === false) glows.push(o); });
      expect(glows.length).toBeGreaterThan(0);
    });

    it('turns from warm to red as the dreams get worse', () => {
      const colour = (level) => {
        const s = new DreamScene(makeDreamEngine(), { level });
        s.build();
        return s.beaconColor.clone();
      };
      const warm = colour(1), red = colour(3);
      expect(red.r).toBeGreaterThan(red.g * 2);
      expect(warm.g).toBeGreaterThan(red.g);
    });
  });

  it('hands the fog back on dispose', () => {
    scene.dispose();
    expect(engine.scene.fog.density).toBeCloseTo(0.02);
    expect(engine.scene.fog.color.getHex()).toBe(0x1a1a2e);
  });

  it('attaches a DreamFilter as the post-process on build, clears it on dispose', () => {
    expect(engine.postProcess).toBeInstanceOf(DreamFilter);
    expect(engine.postProcess.active).toBe(true);
    scene.dispose();
    expect(engine.postProcess).toBeNull();
  });

  it('scatters rocks over the valley, so walking (and slowing) can be seen (playtest)', () => {
    expect(scene.rocks).toBeTruthy();
    let instances = 0;
    scene.rocks.object3d.traverse(o => { if (o.isInstancedMesh) instances += o.count; });
    expect(instances).toBeGreaterThan(50);
  });

  it('lights the valley floor enough to see (the first playtest was pitch black)', () => {
    expect(scene.moonLight.intensity).toBeGreaterThanOrEqual(1.2);
  });
});
