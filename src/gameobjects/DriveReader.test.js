import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { READER_SIZE, READER_SLOT, readerMaterial, skinReader } from './DriveReader.js';

describe('DriveReader', () => {
  it('seats a drive half in through its front, pins first', () => {
    const { offset, rotation } = READER_SLOT;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation.x, rotation.y, rotation.z));
    // The drive's pins (+z) point into the reader, its LED end (−z) out.
    expect(new THREE.Vector3(0, 0, 1).applyQuaternion(q).z).toBeCloseTo(-1);
    const back = offset.z - 0.06, front = offset.z + 0.06;    // the drive's ends
    expect(back).toBeLessThan(READER_SIZE[2] / 2);            // inside
    expect(back).toBeGreaterThan(-READER_SIZE[2] / 2);
    expect(front).toBeGreaterThan(READER_SIZE[2] / 2 + 0.03); // well out, to be taken
    expect(offset.y).toBe(0);                                 // level in its slot
  });

  it('dresses its box in the picture and the relief when they are loaded', () => {
    const colour = new THREE.Texture(), normal = new THREE.Texture();
    const assets = { has: () => true, get: k => (k === 'tex:drive-reader' ? colour : normal) };
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...READER_SIZE), readerMaterial());
    skinReader(mesh, assets);
    expect(mesh.material.map).toBe(colour);
    expect(mesh.material.normalMap).toBe(normal);
  });

  it('carries no green tint', () => {
    expect(readerMaterial().emissive.getHex()).toBe(0x000000);
  });
});
