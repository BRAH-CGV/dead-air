import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('@dimforge/rapier3d', async () => (await import('../test/fakeRapier.js')).rapierModule());

import { BaseScene } from './BaseScene.js';
import { GameObject } from '../core/GameObject.js';
import { makeEngine } from '../test/fakeRapier.js';
import { BUNKER, roundedRect } from '../gameobjects/BunkerShell.js';
import { SIGNAL_MAST } from '../gameobjects/SignalMast.js';
import { WINDOW_CORNER_RADIUS } from './rooms/MainOffice.js';
import { PLAYER_BODY } from '../components/PlayerBody.js';

// A full base build is slow under jsdom — see BaseScene.test.js.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// ─────────────────────────────────────────────
// The bunker shell round the base, as built: it wraps the building, and
// keeps out of the way of everything that looks or walks out of it.
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

describe('BaseScene bunker shell', () => {
  let scene, shell, meshes;
  /** Each shell mesh's own material, by name, before the clones below. */
  const built = new Map();
  const ray = new THREE.Raycaster();
  /** Does a ray from `from` along `dir` hit the shell within `far`? */
  const hits = (from, dir, far = 50) => {
    ray.set(new THREE.Vector3(...from), new THREE.Vector3(...dir).normalize());
    ray.far = far;
    return ray.intersectObjects(meshes, false);
  };

  beforeAll(() => {
    const engine = makeSceneEngine();
    scene = new BaseScene(engine);
    scene.build();
    const sceneRoot = engine._rootObjects.find(go => go.name === 'SceneRoot');
    sceneRoot.object3d.updateMatrixWorld(true);
    shell = scene.bunker;
    meshes = [];
    shell?.object3d.traverse(o => { if (o.isMesh) meshes.push(o); });
    // Seen from either side: a slope inside the airlock faces away from a
    // ray fired out along it, and a one-sided raycast would miss it.
    for (const m of meshes) {
      built.set(m.name, m.material);
      m.material = m.material.clone();
      m.material.side = THREE.DoubleSide;
    }
  });

  it('is built, on the scene root where the occlusion sort leaves it drawn', () => {
    expect(shell).toBeTruthy();
    expect(shell.object3d.parent?.name).toBe('SceneRoot');
    expect(meshes.length).toBeGreaterThan(0);
  });

  it('wraps every room, corridor and the airlock, and covers their roofs', () => {
    const outer = new THREE.Box3().setFromObject(shell.object3d);
    for (const part of [...Object.values(scene.rooms), ...Object.values(scene.corridors)]) {
      const b = part.bounds();
      expect(outer.containsBox(new THREE.Box3(b.min.clone().setY(0), b.max)), part.name).toBe(true);
      // Straight down on to its roof, the shell's roof is met first.
      const c = b.getCenter(new THREE.Vector3());
      const [hit] = hits([c.x, 20, c.z], [0, -1, 0]);
      expect(hit, part.name).toBeDefined();
      expect(hit.point.y).toBeGreaterThanOrEqual(b.max.y - 1e-6);
    }
  });

  it('keeps the view out of the office window clear: from the desk, the flare never cuts into it', () => {
    const office = scene.rooms.MainOffice;
    const { width, height, offset = 0, sill } = office.openings.find(o => o.side === 'back');
    const face = office.bounds().min.z;
    // A seated-height eye 2.5 m back from the glass (the desk is further).
    const eye = new THREE.Vector3(offset, PLAYER_BODY.crouchEyeHeight + 0.7, face + 2.5);
    // Every point round the window's rounded opening, a hair inside it.
    const ring = roundedRect({
      x0: offset - width / 2 + 0.03, x1: offset + width / 2 - 0.03,
      y0: sill + 0.03, y1: sill + height - 0.03, r: WINDOW_CORNER_RADIUS, segments: 6,
    });
    for (const [x, y] of ring) {
      const through = new THREE.Vector3(x, y, face);
      const dir = through.clone().sub(eye).normalize();
      expect(hits(through.toArray(), dir.toArray(), 40), `(${x.toFixed(2)}, ${y.toFixed(2)})`).toHaveLength(0);
    }
  });

  it('rounds and reinforces the window outside: a flared concrete embrasure with a steel collar', () => {
    const office = scene.rooms.MainOffice;
    const { width, offset = 0, sill } = office.openings.find(o => o.side === 'back');
    const face = office.bounds().min.z;
    expect(shell.object3d.getObjectByName('BunkerEmbrasure')).toBeDefined();
    expect(shell.object3d.getObjectByName('BunkerEmbrasureSteel')).toBeDefined();
    // Straight at the wall just beside the window, the embrasure stands out in front of it.
    const [hit] = hits([offset + width / 2 + 0.3, sill + 1, face - 3], [0, 0, 1], 5);
    expect(hit).toBeDefined();
    expect(hit.point.z).toBeLessThan(face - 0.05);
  });

  it('keeps out of the airlock, and the hatch opens on to the yard', () => {
    const b = scene.rooms.Airlock.bounds();
    const t = scene.rooms.Airlock.wallThick;
    for (const x of [b.min.x + t + 0.1, (b.min.x + b.max.x) / 2, b.max.x - t - 0.1]) {
      for (const y of [0.2, 1.5, 2.8]) {
        // The length of the chamber, and on out of the hatch.
        expect(hits([x, y, b.min.z + 0.01], [0, 0, 1], 20)).toHaveLength(0);
      }
    }
  });

  it('clads the office back wall and the embrasure in the slopes’ own weathered concrete, laid out by height', () => {
    const skin = built.get('BunkerSkin');
    expect(shell.concrete).toBe(skin);
    expect(built.get('BunkerEmbrasure')).toBe(skin);
    const H = scene.rooms.MainOffice.bounds().max.y;
    for (const name of ['BackWall_A', 'BackWall_B', 'BackWall_Header', 'BackWall_Sill']) {
      const mesh = scene.rooms.MainOffice.root.find(name).object3d.children.find(c => c.isMesh);
      expect(mesh.material, name).toBe(skin);
      // v is height up the wall over the slopes' height, as on the slopes, so
      // the dirt at the foot and the streaks under the roof line up with them.
      mesh.updateWorldMatrix(true, false);
      const pos = mesh.geometry.getAttribute('position'), uv = mesh.geometry.getAttribute('uv');
      const p = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        expect(uv.getY(i), `${name} vertex ${i}`).toBeCloseTo(p.y / H, 5);
      }
    }
  });

  it('wraps the airlock: its sides slope, its hatch end is left sheer', () => {
    const b = scene.rooms.Airlock.bounds();
    const midZ = (b.min.z + b.max.z) / 2;
    for (const [x, dir] of [[b.min.x - 3, 1], [b.max.x + 3, -1]]) {
      const [hit] = hits([x, 1, midZ], [dir, 0, 0], 3);
      expect(hit, `from ${dir > 0 ? 'the left' : 'the right'}`).toBeDefined();
      expect(hit.object.name).toBe('BunkerSkin');
      // Met on the slope, out in front of the airlock's own wall.
      expect((dir > 0 ? b.min.x - hit.point.x : hit.point.x - b.max.x)).toBeGreaterThan(0.3);
    }
    // Head on at the hatch: nothing of the shell in front of it.
    const hatch = scene.rooms.Airlock.hatch.object3d.getWorldPosition(new THREE.Vector3());
    expect(hits([hatch.x, 1.2, b.max.z + 5], [0, 0, -1], 5)).toHaveLength(0);
  });

  it('carries a signal mast on the roof, a red lamp flashing on top', () => {
    const mast = scene.signalMast;
    expect(mast).toBeTruthy();
    const base = mast.object3d.getWorldPosition(new THREE.Vector3());
    // Standing on the roof slab.
    expect(base.y).toBeCloseTo(scene.rooms.MainOffice.bounds().max.y + BUNKER.cap.height, 3);
    const [roof] = hits([base.x, base.y + 0.5, base.z], [0, -1, 0], 2);
    expect(roof?.object.name).toBe('BunkerRoof');
    expect(mast.glow.material.color.getHex()).toBe(SIGNAL_MAST.beacon.color);
    expect(mast.components).toContain(mast.blink);
  });

  it('runs the fence into the bunker: each side run ends at the front slope\'s toe, on a concrete buttress', () => {
    const toe = Math.min(scene.rooms.ServerRoom.bounds().max.z, scene.rooms.LivingQuarters.bounds().max.z) + BUNKER.batter;
    const sides = scene.fence.colliders.filter(c => c.halfExtents().z > c.halfExtents().x);
    expect(sides).toHaveLength(2);
    for (const c of sides) expect(c.translation().z - c.halfExtents().z).toBeCloseTo(toe, 5);
    expect(scene.fenceAnchors).toHaveLength(2);
    for (const anchor of scene.fenceAnchors) {
      expect(anchor.toe).toBeCloseTo(toe, 5);
      // Along the wire, from the yard side, at hip height: met by the
      // buttress, between the last post and the slope — no gap to slip into.
      const x = anchor.x;
      const [hit] = hits([x, 1.6, toe + 3], [0, 0, -1], 5);
      expect(hit?.object.name, `x ${x.toFixed(2)}`).toBe('BunkerAnchor');
      expect(hit.point.z).toBeCloseTo(toe, 3);
      expect(Math.abs(x - (x < 0 ? scene.fence.rect.minX : scene.fence.rect.maxX))).toBeLessThan(1e-6);
    }
  });

  it('is solid, and far too steep to climb', () => {
    expect(shell.colliders.length).toBeGreaterThan(0);
    const slope = Math.atan2(scene.rooms.MainOffice.height, BUNKER.batter - BUNKER.shoulder);
    expect(THREE.MathUtils.radToDeg(slope)).toBeGreaterThan(55);
  });

  it('hangs the outdoor cameras on the roof band, never in the slope', () => {
    // Every outdoor camera but the two on poles (Ragno's).
    const outdoor = scene.securityCameras.filter(c => c.zones.includes('yard') && !c.label.startsWith('POLE'));
    expect(outdoor).toHaveLength(4);
    for (const cam of outdoor) {
      const p = cam.object3d.getWorldPosition(new THREE.Vector3());
      expect(p.y, cam.label).toBeCloseTo(shell.fascia.y, 2);
      // Back toward the building, level, the band is right behind it.
      const back = cam.object3d.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
      const [hit] = hits([p.x, p.y, p.z], [back.x, 0, back.z], 2);
      expect(hit, cam.label).toBeDefined();
      expect(hit.distance, cam.label).toBeLessThan(0.15);
      expect(hit.object.name).toBe('BunkerBand');
    }
  });
});
