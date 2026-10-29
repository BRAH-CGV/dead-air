import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import * as THREE from 'three';

vi.mock('@dimforge/rapier3d', async () => (await import('../test/fakeRapier.js')).rapierModule());

import { BaseScene } from './BaseScene.js';
import { GameObject } from '../core/GameObject.js';
import { makeEngine } from '../test/fakeRapier.js';

// A full base build is slow under jsdom — see BaseScene.test.js.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// ─────────────────────────────────────────────
// Portal culling on the base (#175): from the quarters' corridor looking
// into the office, the whole office, the airlock and the server room were
// drawn through their walls (449 draw calls). Now another room is drawn
// only where a doorway shows it.
// ─────────────────────────────────────────────

let scene, engine;
beforeAll(() => {
  engine = makeEngine();
  engine.scene = new THREE.Scene();
  engine.scene.fog = new THREE.FogExp2(0x1a1a2e, 0.02);
  engine.assets = { get: () => null };
  engine.renderCullers = [];
  engine.buildPlayer = ({ position = [0, 1, 5] } = {}) => {
    const player = new GameObject('Player');
    player.object3d.position.set(...position);
    engine.player = player;
    engine._rootObjects.push(player);
    return player;
  };
  scene = new BaseScene(engine);
  scene.build();
  engine.scene.updateMatrixWorld(true);
});

afterEach(() => scene.portalCulling.restore());

const eye = (position, target) => {
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 1000);
  camera.position.set(...position);
  camera.lookAt(...target);
  camera.updateMatrixWorld(true);
  return camera;
};

/** Drawn: it and every ancestor visible. */
const drawn = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
const centerOf = (m) => {
  m.geometry.computeBoundingSphere();
  return m.geometry.boundingSphere.center.clone().applyMatrix4(m.matrixWorld);
};

/** Every mesh under a room that the culling could hide. */
const meshesOf = (room) => {
  const out = [];
  room.root.object3d.traverse(o => { if (o.isMesh && o.frustumCulled && !o.isSkinnedMesh) out.push(o); });
  return out;
};

describe('BaseScene portal culling', () => {
  it('is handed to the engine, one portal per doorway between two rooms (not the hatch to the yard)', () => {
    const culling = scene.portalCulling;
    expect(engine.renderCullers).toContain(culling);
    const joins = culling.portals.map(p => [culling.nodes[p.a].name, culling.nodes[p.b].name].sort().join('|')).sort();
    expect(joins).toEqual([
      'Airlock|MainOffice',
      'LivingQuarters|OfficeToQuarters',
      'MainOffice|OfficeToQuarters',
      'MainOffice|OfficeToServer',
      'OfficeToServer|ServerRoom',
    ]);
  });

  it('from the quarters corridor into the office: the server room only as far as the doors show it', () => {
    const [x, , z] = scene.corridors.OfficeToQuarters.position;
    const culling = scene.portalCulling;
    const before = new Set([...meshesOf(scene.rooms.MainOffice), ...meshesOf(scene.rooms.ServerRoom)].filter(drawn));
    culling.hide(eye([x, 1.24, z], [x + 10, 1.24, z]));

    const server = meshesOf(scene.rooms.ServerRoom).filter(m => before.has(m));
    const hidden = server.filter(m => !m.visible);
    expect(hidden.length).toBeGreaterThan(0);
    expect(hidden.length).toBeLessThan(server.length);   // the slice through the doors is still drawn

    // Straight down the line of the doors (they line up across the office):
    // drawn. Tucked against the wall the corridor comes through, well to one
    // side of its doorway: hidden.
    const officeBox = scene.rooms.MainOffice.bounds();
    let onLine = 0, beside = 0;
    for (const m of meshesOf(scene.rooms.MainOffice).filter(m => before.has(m))) {
      const c = centerOf(m);
      if (!officeBox.containsPoint(c)) continue;
      m.geometry.computeBoundingSphere();
      const radius = m.geometry.boundingSphere.radius * m.matrixWorld.getMaxScaleOnAxis();
      if (Math.hypot(c.y - 1.24, c.z - z) < radius) {   // the sightline passes through it
        onLine++;
        expect(m.visible, `${m.name} on the sightline`).toBe(true);
      }
      m.geometry.computeBoundingSphere();
      const r = m.geometry.boundingSphere.radius * m.matrixWorld.getMaxScaleOnAxis();
      if (c.x - r > officeBox.min.x && c.x + r < officeBox.min.x + 1 && Math.abs(c.z - z) - r > 3) {
        beside++;
        expect(m.visible, `${m.name} beside the doorway`).toBe(false);
      }
    }
    expect(onLine, 'objects on the sightline').toBeGreaterThan(0);
    expect(beside, 'objects beside the doorway').toBeGreaterThan(0);
  });

  it('from the bedroom, facing away from its door: nothing of the office or the server room', () => {
    const quarters = scene.rooms.LivingQuarters;
    const [x, , z] = quarters.position;
    scene.portalCulling.hide(eye([x, 1.24, z], [x - 10, 1.24, z]));
    for (const room of [scene.rooms.MainOffice, scene.rooms.ServerRoom]) {
      const box = room.bounds();
      // Placed by where it is: a mesh of this room standing elsewhere isn't this room's.
      const visible = meshesOf(room).filter(m => drawn(m) && box.containsPoint(centerOf(m)));
      expect(visible.map(m => m.name)).toEqual([]);
    }
  });

  it('opens on the outside through the hatch and the office window, for what the moon sees', () => {
    const culling = scene.portalCulling;
    const opens = culling.outside.map(p => culling.nodes[p.a].name).sort();
    expect(opens).toEqual(['Airlock', 'MainOffice']);
  });

  it('the moon sees the office floor under the window, not the server room under its roof', () => {
    const culling = scene.portalCulling;
    const win = scene._officeWindow();
    // High over the yard behind the window, looking down and in.
    culling.look(new THREE.Vector3((win.x0 + win.x1) / 2, 600, win.z - 800));
    expect(culling.sees(new THREE.Sphere(new THREE.Vector3((win.x0 + win.x1) / 2, 0.2, win.z + 0.6), 0.1))).toBe(true);
    const server = scene.rooms.ServerRoom.bounds().getCenter(new THREE.Vector3());
    expect(culling.sees(new THREE.Sphere(server, 0.3))).toBe(false);
  });

  it('puts everything back', () => {
    const quarters = scene.rooms.LivingQuarters;
    const [x, , z] = quarters.position;
    const office = meshesOf(scene.rooms.MainOffice);
    const before = office.filter(m => m.visible).length;
    scene.portalCulling.hide(eye([x, 1.24, z], [x - 10, 1.24, z]));
    scene.portalCulling.restore();
    expect(office.filter(m => m.visible).length).toBe(before);
  });
});
