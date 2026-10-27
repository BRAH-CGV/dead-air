import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createCloudPoof, POOF } from './CloudPoof.js';

/** Each puff's scale and distance from the middle, read off its instance matrix. */
function puffs(mesh) {
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  return Array.from({ length: mesh.count }, (_, i) => {
    mesh.getMatrixAt(i, m);
    m.decompose(p, q, s);
    return { scale: s.x, out: p.length() };
  });
}

function run(poof, seconds) {
  for (let i = 0; i < Math.round(seconds * 60); i++) poof.update(1 / 60);
}

describe('createCloudPoof', () => {
  it('waits hidden until it is played', () => {
    const poof = createCloudPoof({ radius: 0.143 });
    expect(poof.visible).toBe(false);
    expect(poof.playing).toBe(false);
    poof.dispose();
  });

  it('is a handful of puffs in two draw calls: the cloud and its outline', () => {
    const poof = createCloudPoof();
    expect(poof.puffs).toBeInstanceOf(THREE.InstancedMesh);
    expect(poof.puffs.count).toBe(POOF.count);
    expect(poof.outline.count).toBe(POOF.count);
    expect(poof.outline.material.side).toBe(THREE.BackSide);
    poof.dispose();
  });

  it('a little toon, and opaque: the room\'s light in steps, never a fade', () => {
    const poof = createCloudPoof();
    expect(poof.puffs.material).toBeInstanceOf(THREE.MeshToonMaterial);
    expect(poof.puffs.material.transparent).toBe(false);
    expect(poof.puffs.material.fog).toBe(false);
    poof.dispose();
  });

  it('casts no shadow: it comes and goes, and the shadow maps are frozen', () => {
    const poof = createCloudPoof();
    expect(poof.puffs.castShadow).toBe(false);
    expect(poof.outline.castShadow).toBe(false);
    poof.dispose();
  });

  it('played, it bursts out past the ball and swells, then shrinks away to nothing and hides', () => {
    const r = 0.143;
    const poof = createCloudPoof({ radius: r });
    poof.play();
    expect(poof.visible).toBe(true);

    run(poof, POOF.seconds * 0.3);
    const mid = puffs(poof.puffs);
    expect(Math.max(...mid.map((p) => p.scale))).toBeGreaterThan(r * 0.3);   // swelled
    expect(Math.min(...mid.map((p) => p.out))).toBeGreaterThan(r * 0.5);     // on their way out

    run(poof, POOF.seconds);
    expect(poof.playing).toBe(false);
    expect(poof.visible).toBe(false);
    poof.dispose();
  });

  it('covers the ball while the swap happens: big enough early on', () => {
    const r = 0.143;
    const poof = createCloudPoof({ radius: r });
    poof.play();
    run(poof, 0.08);
    const sizes = puffs(poof.puffs).map((p) => p.scale + p.out);
    expect(Math.max(...sizes)).toBeGreaterThan(r);
    poof.dispose();
  });
});
