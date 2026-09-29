import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createMonsterFigure } from './MonsterFigure.js';

describe('createMonsterFigure', () => {
  it('stands on its origin, as tall as asked', () => {
    const figure = createMonsterFigure({ name: 'Watcher', height: 2.4 });
    const box = new THREE.Box3().setFromObject(figure.object3d);
    expect(box.min.y).toBeCloseTo(0, 5);
    expect(box.max.y).toBeCloseTo(2.4, 5);
    expect(figure.name).toBe('Watcher');
  });

  it('is built hidden, with no body — a monster is not physics', () => {
    const figure = createMonsterFigure();
    expect(figure.object3d.visible).toBe(false);
    expect(figure.rigidBody).toBeNull();
    expect(figure.collider).toBeNull();
  });

  it('has two unlit eyes near the top, facing +Z (the way lookAt turns it)', () => {
    const figure = createMonsterFigure({ height: 2 });
    expect(figure.eyes).toHaveLength(2);
    for (const eye of figure.eyes) {
      expect(eye.material).toBeInstanceOf(THREE.MeshBasicMaterial);
      expect(eye.position.y).toBeGreaterThan(2 * 0.8);
      expect(eye.position.z).toBeGreaterThan(0);
    }
    expect(Math.sign(figure.eyes[0].position.x)).toBe(-Math.sign(figure.eyes[1].position.x));
  });

  it('records the file it stands in for', () => {
    const figure = createMonsterFigure({ placeholderFor: 'window-watcher.glb' });
    expect(figure.placeholderFor).toBe('window-watcher.glb');
  });
});
