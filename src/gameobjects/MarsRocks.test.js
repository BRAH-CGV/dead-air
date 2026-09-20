import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

import { createMarsRocks, ROCK_FIELD } from './MarsRocks.js';
import { makeYard, yardDistance } from './BaseYard.js';
import { terrainHeightAt } from './MarsTerrain.js';

/** Every instance transform in the field, decomposed. */
function instances(rocks) {
  const out = [];
  const matrix = new THREE.Matrix4();
  for (const mesh of rocks.object3d.children) {
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      matrix.decompose(position, quaternion, scale);
      out.push({ position, quaternion, scale, mesh });
    }
  }
  return out;
}

describe('rock field structure', () => {
  it('is a group, so the level editor never measures a valley-sized box', () => {
    expect(createMarsRocks().isGroup).toBe(true);
  });

  it('hangs instanced meshes straight on the group, not as child GameObjects', () => {
    // The editor's outliner walks GameObject children only. Rocks must stay out
    // of it, or hundreds of rows make it unusable.
    const rocks = createMarsRocks();

    expect(rocks.children).toHaveLength(0);
    expect(rocks.object3d.children.length).toBeGreaterThan(0);
    for (const mesh of rocks.object3d.children) {
      expect(mesh.isInstancedMesh).toBe(true);
      expect(mesh.material).toBeInstanceOf(THREE.MeshLambertMaterial);
    }
  });

  it('does not cast shadows, being far outside the moonlight shadow camera', () => {
    for (const mesh of createMarsRocks().object3d.children) {
      expect(mesh.castShadow).toBe(false);
      expect(mesh.receiveShadow).toBe(true);
    }
  });

  it('draws the whole field in few enough meshes to stay cheap', () => {
    // One per shape per size band is the design; a per-rock mesh would be
    // hundreds of draw calls.
    const rocks = createMarsRocks();
    expect(rocks.object3d.children.length).toBeLessThanOrEqual(ROCK_FIELD.variants * 3);
  });
});

describe('rock placement', () => {
  it('leaves the base and its yard clear', () => {
    // The yard is shaped to the building's footprint, so it is the contract
    // with the branch extending the base — see BaseYard.
    const rocks = createMarsRocks();
    const zones = makeYard({ margin: ROCK_FIELD.yardMargin });

    for (const { position } of instances(rocks)) {
      expect(yardDistance(position.x, position.z, zones)).toBeGreaterThanOrEqual(-1e-3);
    }
  });

  it('honours extra keep-clear circles, like the satellite', () => {
    const keepClear = [{ x: 0, z: -25, radius: 12 }];
    const rocks = createMarsRocks({ keepClear });

    for (const { position } of instances(rocks)) {
      expect(Math.hypot(position.x - 0, position.z + 25)).toBeGreaterThanOrEqual(12);
    }
  });

  it('sits every rock on the ground, sunk rather than floating', () => {
    // The mesh only agrees with terrainHeightAt at its 4 m cell corners, so
    // rocks are buried a little to hide the sag.
    const rocks = createMarsRocks();

    for (const { position, scale } of instances(rocks)) {
      const ground = terrainHeightAt(position.x, position.z);
      expect(position.y).toBeLessThanOrEqual(ground + scale.y * 1.6);
      expect(position.y).toBeGreaterThan(ground - scale.y * 1.2);
    }
  });

  it('stays inside the ridge line', () => {
    for (const { position } of instances(createMarsRocks())) {
      expect(Math.hypot(position.x, position.z)).toBeLessThanOrEqual(ROCK_FIELD.outerRadius + 10);
    }
  });

  it('leans rocks with the slope instead of standing them all upright', () => {
    const up = new THREE.Vector3(0, 1, 0);
    const tilted = instances(createMarsRocks()).filter(({ quaternion }) => {
      return up.clone().applyQuaternion(quaternion).angleTo(up) > 0.05;
    });

    expect(tilted.length).toBeGreaterThan(100);
  });

  it('spreads evenly around the office rather than piling up on one side', () => {
    // The clumping field caused this once: its frequency was so low that its
    // lowest octave was the size of the whole valley, so one half came out
    // noticeably barer than the other. Measured near the office, where the
    // player would see it, the eight compass sectors should hold roughly equal
    // shares. 1.8x allows for the scatter being random; the bug was 2.8x.
    const sectors = new Array(8).fill(0);

    for (const { position } of instances(createMarsRocks())) {
      if (Math.hypot(position.x, position.z) > 120) continue;
      const angle = (Math.atan2(position.x, -position.z) + Math.PI * 2) % (Math.PI * 2);
      sectors[Math.floor(angle / (Math.PI * 2) * 8) % 8] += 1;
    }

    expect(Math.min(...sectors)).toBeGreaterThan(30);
    expect(Math.max(...sectors) / Math.min(...sectors)).toBeLessThan(1.8);
  });

  it('gives a range of sizes rather than one grade of gravel', () => {
    const sizes = instances(createMarsRocks()).map(i => i.scale.x);
    expect(Math.min(...sizes)).toBeLessThan(0.5);
    expect(Math.max(...sizes)).toBeGreaterThan(3);
  });
});

describe('rock determinism', () => {
  it('builds the same field for the same seed', () => {
    const a = instances(createMarsRocks());
    const b = instances(createMarsRocks());

    expect(a.length).toBe(b.length);
    expect(a[0].position.toArray()).toEqual(b[0].position.toArray());
    expect(a[a.length - 1].position.toArray()).toEqual(b[b.length - 1].position.toArray());
  });

  it('builds a different field for a different seed', () => {
    const a = instances(createMarsRocks({ seed: 1 }));
    const b = instances(createMarsRocks({ seed: 2 }));

    expect(a[0].position.toArray()).not.toEqual(b[0].position.toArray());
  });
});

describe('crater-aware placement', () => {
  it('follows whatever height function it is given', () => {
    // Craters are an extra displacement layer on the terrain; rocks take the
    // same function so they sit inside a crater rather than across its mouth.
    const heightAt = () => -7;
    const rocks = createMarsRocks({ heightAt });

    for (const { position, scale } of instances(rocks)) {
      expect(position.y).toBeLessThan(-7 + scale.y);
      expect(position.y).toBeGreaterThan(-7 - scale.y * 1.2);
    }
  });
});
