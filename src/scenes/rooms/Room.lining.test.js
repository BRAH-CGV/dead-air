import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('@dimforge/rapier3d', async () => (await import('../../test/fakeRapier.js')).rapierModule());

import { Room } from './Room.js';
import { Corridor } from './Corridor.js';
import { MainOffice } from './MainOffice.js';
import { LINING } from './RoomLining.js';
import { makeEngine } from '../../test/fakeRapier.js';

/** An engine whose asset cache holds the lining's textures, as after preload. */
function engineWithTextures() {
  const engine = makeEngine();
  const cache = new Map(Object.values(LINING.textures).flat().map(key => [key, new THREE.Texture()]));
  engine.assets = { has: key => cache.has(key), get: key => cache.get(key), cache };
  return engine;
}
const lining = room => room.root.find('Lining');
const sheet = (room, name) => lining(room).object3d.children.find(c => c.name === name);
const bounds = mesh => { mesh.geometry.computeBoundingBox(); return mesh.geometry.boundingBox; };

describe('a room\'s lining', () => {
  const build = (opts = {}) => {
    const room = new Room(engineWithTextures(), { name: 'Test', width: 6, depth: 8, height: 3, ...opts });
    room.build();
    return room;
  };

  it('is three meshes — walls, floor, ceiling — however many pieces the walls are in', () => {
    const plain = build();
    const doored = build({ openings: [{ side: 'right', width: 1.2, height: 2.2 }, { side: 'back', width: 3, height: 1.5, sill: 0.8 }] });
    for (const room of [plain, doored]) {
      expect(lining(room).object3d.children.map(c => c.name).sort()).toEqual(['Lining_Ceiling', 'Lining_Floor', 'Lining_Walls']);
    }
    // One quad a wall piece: 4 walls, or 4 + 2 for the doorway + 3 for the window.
    expect(sheet(plain, 'Lining_Walls').geometry.getIndex().count / 6).toBe(4);
    expect(sheet(doored, 'Lining_Walls').geometry.getIndex().count / 6).toBe(4 + 2 + 3);
  });

  it('lies just inside the shell: 4 mm off the floor, the ceiling and each wall\'s inner face', () => {
    const room = build();
    const g = LINING.gap;
    expect(bounds(sheet(room, 'Lining_Floor')).max.y).toBeCloseTo(g);
    expect(bounds(sheet(room, 'Lining_Ceiling')).min.y).toBeCloseTo(3 - g);
    const walls = bounds(sheet(room, 'Lining_Walls'));
    // Inner faces at ±2.9 (x) and ±3.9 (z). The back and front walls run
    // corner to corner behind the side walls, so x reaches out to their ends.
    expect(walls.min.z).toBeCloseTo(-3.9 + g);
    expect(walls.max.z).toBeCloseTo(3.9 - g);
    expect(walls.min.y).toBeCloseTo(0);
    expect(walls.max.y).toBeCloseTo(3);
    const pos = sheet(room, 'Lining_Walls').geometry.getAttribute('position');
    const sideFaces = new Set();
    for (let i = 0; i < pos.count; i++) if (Math.abs(Math.abs(pos.getZ(i)) - (3.9 - g)) > 1e-6) sideFaces.add(pos.getX(i).toFixed(3));
    expect([...sideFaces].sort()).toEqual([(-2.9 + g).toFixed(3), (2.9 - g).toFixed(3)].sort());
  });

  it('the floor and ceiling cover the whole slab, so the pattern runs through the doorways', () => {
    const room = build();
    const floor = bounds(sheet(room, 'Lining_Floor'));
    expect(floor.max.x - floor.min.x).toBeCloseTo(6.2);
    expect(floor.max.z - floor.min.z).toBeCloseTo(8.2);
  });

  it('takes shadows and casts none: the boxes behind it already cast them', () => {
    for (const mesh of lining(build()).object3d.children) {
      expect(mesh.receiveShadow, mesh.name).toBe(true);
      expect(mesh.castShadow, mesh.name).toBe(false);
    }
  });

  it('is furnishing, not shell: its name keeps it out of what the base always draws', () => {
    // BaseScene treats anything named Floor…, Ceiling… or …Wall… as the
    // building seen from outside. The lining is only ever seen from inside.
    const isShell = name => /^(Floor|Ceiling|(Back|Front|Left|Right)Wall)/.test(name);
    const room = build();
    expect(isShell(lining(room).name)).toBe(false);
    expect(lining(room).parent).toBe(room.root);
    expect(lining(room).rigidBody).toBeNull();          // nothing solid: the boxes are
  });

  it('is tinted by the room and textured from the cache', () => {
    const room = build({ material: new THREE.MeshStandardMaterial({ color: 0x3b3530 }) });
    const walls = sheet(room, 'Lining_Walls').material;
    expect(walls.map).toBe(room.engine.assets.cache.get(LINING.textures.wall[0]));
    expect(walls.color.r).toBeGreaterThan(walls.color.b);      // the room's warmth
    // The shell keeps the room's plain material: nothing about the outside changes.
    expect(room.root.find('BackWall').object3d.children[0].material).toBe(room.material);
    expect(room.root.find('Floor').object3d.children[0].material).toBe(room.material);
  });

  it('without the textures there is no lining, and the room is as it was', () => {
    const room = new Room(makeEngine(), { name: 'Bare', width: 6, depth: 8, height: 3 });
    room.build();
    expect(room.root.find('Lining')).toBeNull();
  });

  it('dispose frees the lining\'s geometry and materials, and leaves the shared textures alone', () => {
    const room = build();
    const freed = [];
    for (const mesh of lining(room).object3d.children) {
      mesh.geometry.addEventListener('dispose', () => freed.push(mesh.name + ':geometry'));
      mesh.material.addEventListener('dispose', () => freed.push(mesh.name + ':material'));
    }
    let textures = 0;
    for (const texture of room.engine.assets.cache.values()) texture.addEventListener('dispose', () => { textures++; });
    room.dispose();
    expect(freed.length).toBe(6);
    expect(textures).toBe(0);
  });
});

describe('a corridor\'s lining', () => {
  it('lines its two long walls and runs its floor exactly its length, to meet the rooms at each end', () => {
    const corridor = new Corridor(engineWithTextures(), { name: 'Hall', length: 4, width: 2, position: [8.1, 0, 3.5] });
    corridor.build();
    expect(sheet(corridor, 'Lining_Walls').geometry.getIndex().count / 6).toBe(2);
    const floor = bounds(sheet(corridor, 'Lining_Floor'));
    expect(floor.max.x - floor.min.x).toBeCloseTo(4);
    expect(floor.max.z - floor.min.z).toBeCloseTo(2.2);
  });
});

describe('the office\'s lining', () => {
  it('lines the window wall round the glass, not across it', () => {
    const office = new MainOffice(engineWithTextures());
    office.build();
    // Back wall: two sides, a header and a sill. Front, left and right: two sides and a header each.
    expect(sheet(office, 'Lining_Walls').geometry.getIndex().count / 6).toBe(4 + 3 * 3);
  });
});
