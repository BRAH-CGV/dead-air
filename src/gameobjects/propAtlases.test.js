import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { mapBoxFaces, cachedTexture, skinBox, DRIVE_ATLAS, BOX_ATLAS, BAG_ATLAS, READER_ATLAS, DOCK_ATLAS } from './propAtlases.js';

/** The uv range a face of `geometry` covers. */
function faceRange(geometry, g) {
  const { start, count } = geometry.groups[g];
  const uv = geometry.attributes.uv.array;
  const us = [], vs = [];
  for (let i = start; i < start + count; i++) {
    const v = geometry.index.array[i];
    us.push(uv[v * 2]); vs.push(uv[v * 2 + 1]);
  }
  return [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
}

describe('mapBoxFaces', () => {
  it('squeezes each face into its rectangle, measured from the top left', () => {
    const g = mapBoxFaces(new THREE.BoxGeometry(1, 1, 1), { py: [0, 0, 128, 64] }, [256, 256]);
    const [u0, u1, v0, v1] = faceRange(g, 2);
    expect([u0, u1]).toEqual([0, 0.5]);
    expect(v0).toBeCloseTo(0.75);
    expect(v1).toBeCloseTo(1);
  });

  it('leaves a face with no rectangle as it was', () => {
    const g = mapBoxFaces(new THREE.BoxGeometry(1, 1, 1), { py: [0, 0, 128, 64] }, [256, 256]);
    expect(faceRange(g, 0)).toEqual([0, 1, 0, 1]);
  });

  it('keeps every rectangle inside its atlas', () => {
    for (const atlas of [DRIVE_ATLAS, BOX_ATLAS, READER_ATLAS, DOCK_ATLAS]) {
      for (const [x, y, w, h] of Object.values(atlas.faces)) {
        expect(x + w).toBeLessThanOrEqual(atlas.size[0]);
        expect(y + h).toBeLessThanOrEqual(atlas.size[1]);
      }
    }
    for (const part of [BAG_ATLAS.body, BAG_ATLAS.roll]) {
      for (const [x, y, w, h] of Object.values(part)) {
        expect(x + w).toBeLessThanOrEqual(BAG_ATLAS.size[0]);
        expect(y + h).toBeLessThanOrEqual(BAG_ATLAS.size[1]);
      }
    }
  });
});

describe('cachedTexture', () => {
  it('reads a loaded texture, and is null without one', () => {
    const tex = new THREE.Texture();
    const assets = { has: k => k === 'tex:a', get: () => tex };
    const scene = { userData: { engine: { assets } } };
    expect(cachedTexture(scene, 'tex:a')).toBe(tex);
    expect(cachedTexture(scene, 'tex:b')).toBeNull();
    expect(cachedTexture({ userData: {} }, 'tex:a')).toBeNull();
  });
});

describe('skinBox', () => {
  it('maps the faces and puts a loaded texture on over white', () => {
    const tex = new THREE.Texture();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x1a1a1a }));
    skinBox(mesh, tex, READER_ATLAS);
    expect(mesh.material.map).toBe(tex);
    expect(mesh.material.color.getHex()).toBe(0xffffff);
    expect(faceRange(mesh.geometry, 2)[1]).toBeCloseTo(205 / 256);
  });

  it('without a texture leaves the material as it was', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x1a1a1a }));
    skinBox(mesh, null, DOCK_ATLAS);
    expect(mesh.material.map).toBeNull();
    expect(mesh.material.color.getHex()).toBe(0x1a1a1a);
  });
});
