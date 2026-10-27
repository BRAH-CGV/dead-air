import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createCheeseBlast, BLAST } from './CheeseBlast.js';

/** Each instance's scale and distance from the middle, read off its matrix. */
function instances(mesh) {
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  return Array.from({ length: mesh.count }, (_, i) => {
    mesh.getMatrixAt(i, m);
    m.decompose(p, q, s);
    return { scale: s.x, out: p.length(), y: p.y };
  });
}

function run(blast, seconds) {
  for (let i = 0; i < Math.round(seconds * 60); i++) blast.update(1 / 60);
}

describe('createCheeseBlast', () => {
  it('waits hidden until it is played', () => {
    const blast = createCheeseBlast();
    expect(blast.visible).toBe(false);
    expect(blast.playing).toBe(false);
    blast.dispose();
  });

  it('is fire and chunks in two draw calls', () => {
    const blast = createCheeseBlast();
    expect(blast.fire).toBeInstanceOf(THREE.InstancedMesh);
    expect(blast.fire.count).toBe(BLAST.fire);
    expect(blast.chunks.count).toBe(BLAST.chunks);
    blast.dispose();
  });

  it('the fire is unlit and drawn from both sides, so a view inside it is filled', () => {
    const blast = createCheeseBlast();
    expect(blast.fire.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(blast.fire.material.side).toBe(THREE.DoubleSide);
    blast.dispose();
  });

  it('the fire tears far past the ball; the chunks are flung out and fall', () => {
    const radius = 0.143;
    const blast = createCheeseBlast({ radius });
    blast.play();
    run(blast, BLAST.seconds * BLAST.fireUntil);
    const biggest = Math.max(...instances(blast.fire).map(f => f.out + f.scale));
    expect(biggest).toBeGreaterThan(radius * 6);
    const early = instances(blast.chunks);
    run(blast, 0.3);
    const later = instances(blast.chunks);
    expect(later.every((c, i) => c.out > early[i].out)).toBe(true);
    const sumY = list => list.reduce((n, c) => n + c.y, 0);
    expect(sumY(later)).toBeLessThan(sumY(early));
    blast.dispose();
  });

  it('is gone again after, and can be played again', () => {
    const blast = createCheeseBlast();
    blast.play();
    run(blast, BLAST.seconds + 0.1);
    expect(blast.visible).toBe(false);
    expect(blast.playing).toBe(false);
    blast.play();
    expect(blast.visible).toBe(true);
    blast.dispose();
  });

  it('casts no shadow', () => {
    const blast = createCheeseBlast();
    expect(blast.fire.castShadow || blast.chunks.castShadow).toBe(false);
    blast.dispose();
  });
});
