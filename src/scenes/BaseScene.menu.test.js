import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('@dimforge/rapier3d', async () => (await import('../test/fakeRapier.js')).rapierModule());

import { BaseScene } from './BaseScene.js';
import { GameObject } from '../core/GameObject.js';
import { makeEngine } from '../test/fakeRapier.js';

// A full base build is slow under jsdom — see BaseScene.test.js.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// ─────────────────────────────────────────────
// The main menu's shot (#115): a camera of the scene's own, over the office
// computer, looking out of the window at the dish. App draws the main menu
// through it, so wherever the player wakes, the menu looks at the dish.
// ─────────────────────────────────────────────

/** dish-tower.glb at its 0.137 spawn scale, as BaseScene parks it (yaw 45°,
 *  pitch −55°; the menu's scene never ticks, so it is still there): the
 *  dish turns about a hub 6.2 m up, and its moving part — neck, reflector,
 *  feed horn — fills this box, in metres from the tower's foot. The test
 *  scene has no models loaded, so these are measured off the file's
 *  vertices, not the build. Re-measure if the park pose changes. */
const DISH_HUB = 6.2;
const DISH_PARKED = { x: [-2.01, 4.21], y: [5.15, 10.06], z: [-4.2, 2.0] };
/** retro-computer.glb at its 0.016 spawn scale: desk and monitor, 1.10 m tall. */
const COMPUTER_TOP = 1.10;
/** Screen shapes the shot has to hold up at. */
const ASPECTS = [4 / 3, 16 / 9, 21 / 9];

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

describe('BaseScene menu shot (#115)', () => {
  let engine, scene, shot, office, desk, tower, eye;

  beforeAll(() => {
    engine = makeSceneEngine();
    scene = new BaseScene(engine);
    scene.build();
    engine._rootObjects.find(go => go.name === 'SceneRoot').object3d.updateMatrixWorld(true);
    shot = scene.menuCamera;
    office = scene.rooms.MainOffice;
    desk = office.root.find('ComputerDesk').object3d.getWorldPosition(new THREE.Vector3());
    tower = scene.satellite.object3d.getWorldPosition(new THREE.Vector3());
    shot.updateMatrixWorld(true);
    eye = shot.getWorldPosition(new THREE.Vector3());
  });

  /** Where `point` lands in the shot on a screen of `aspect`: x and y run
   *  -1 … 1 across the frame. */
  function onScreen(point, aspect) {
    shot.aspect = aspect;
    shot.updateProjectionMatrix();
    return point.clone().project(shot);
  }

  /** The corners of the parked dish's box, in the world. */
  const dishPoints = () => {
    const out = [];
    for (const x of DISH_PARKED.x) for (const y of DISH_PARKED.y) for (const z of DISH_PARKED.z) {
      out.push(new THREE.Vector3(tower.x + x, tower.y + y, tower.z + z));
    }
    return out;
  };

  it("is a camera of the scene's own, not the player's", () => {
    expect(shot).toBeInstanceOf(THREE.PerspectiveCamera);
    expect(shot).not.toBe(engine.camera);
  });

  it('stands in the office over the computer: just behind it, above its screen', () => {
    expect(office.bounds().containsPoint(eye)).toBe(true);
    // On the chair's side of the desk, the window beyond it.
    expect(eye.z).toBeGreaterThan(desk.z);
    expect(eye.z - desk.z).toBeLessThan(1.5);
    expect(Math.abs(eye.x - desk.x)).toBeLessThan(0.8);
    expect(eye.y).toBeGreaterThan(COMPUTER_TOP + 0.2);
    expect(eye.y).toBeLessThan(office.height);
  });

  it('frames the whole dish, at any screen shape', () => {
    for (const aspect of ASPECTS) {
      for (const p of dishPoints()) {
        const v = onScreen(p, aspect);
        expect(v.z, `behind the eye at ${aspect.toFixed(2)}`).toBeLessThan(1);
        expect(Math.abs(v.x), `x at ${aspect.toFixed(2)}`).toBeLessThan(0.95);
        expect(Math.abs(v.y), `y at ${aspect.toFixed(2)}`).toBeLessThan(0.95);
      }
    }
  });

  it('sees the dish through the window, never the wall round it', () => {
    const { width, height, offset = 0, sill } = office.openings.find(o => o.side === 'back');
    const back = office.position[2] - office.depth / 2;
    const cx = office.position[0] + offset;
    // Both faces of the wall, kept clear of the rounded corners and of the
    // header: outside, the brow and the embrasure only open up from there.
    for (const z of [back + office.wallThick / 2, back - office.wallThick / 2]) {
      for (const p of dishPoints()) {
        const t = (z - eye.z) / (p.z - eye.z);
        const at = eye.clone().lerp(p, t);
        expect(Math.abs(at.x - cx)).toBeLessThan(width / 2 - 0.5);
        expect(at.y).toBeGreaterThan(sill + 0.3);
        expect(at.y).toBeLessThan(sill + height - 0.1);
      }
    }
  });

  it('puts the dish right of centre, clear of the menu panel on the left', () => {
    const hub = new THREE.Vector3(tower.x, DISH_HUB, tower.z);
    for (const aspect of ASPECTS) expect(onScreen(hub, aspect).x).toBeGreaterThan(0.1);
  });

  it('keeps the computer in the foreground, low in the frame', () => {
    const top = new THREE.Vector3(desk.x, COMPUTER_TOP, desk.z);
    for (const aspect of ASPECTS) {
      const v = onScreen(top, aspect);
      expect(Math.abs(v.x)).toBeLessThan(0.9);
      expect(v.y).toBeGreaterThan(-0.95);
      expect(v.y).toBeLessThan(-0.3);
    }
  });

  it('reaches as far as the game camera, so the valley and sky are drawn', () => {
    expect(shot.far).toBeGreaterThanOrEqual(engine.camera.far);
  });
});
