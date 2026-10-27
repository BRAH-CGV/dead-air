import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';

// As in Engine.pause.test.js: interpolation only touches Rapier through the
// body-type enum, so a stub module is enough.
vi.mock('@dimforge/rapier3d', () => ({
  default: { RigidBodyType: { Dynamic: 0, Fixed: 1, KinematicPositionBased: 2 } },
}));

const { Engine } = await import('./Engine.js');
const { GameObject } = await import('./GameObject.js');

/** A dynamic body that was at x = 0 last step and is at x = 1 now. */
function makeMoved(engine) {
  const go = new GameObject('Moved');
  go.rigidBody = {
    bodyType: () => 0,
    translation: () => ({ x: 1, y: 0, z: 0 }),
    rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
  };
  engine.rigidBodyMap.set(7, go);
  engine._prevPos.set(7, { x: 0, y: 0, z: 0 });
  engine._prevQuat.set(7, { x: 0, y: 0, z: 0, w: 1 });
  return go;
}

describe('Engine physics interpolation', () => {
  it('draws a dynamic body between its last two steps', () => {
    const engine = new Engine();
    const go = makeMoved(engine);
    engine._interpolatePhysics(0.25);
    expect(go.object3d.position.x).toBeCloseTo(0.25);
  });

  it('draws one that is not interpolated (a carried object) at the latest step, as the player', () => {
    const engine = new Engine();
    const go = makeMoved(engine);
    go.interpolate = false;
    engine._interpolatePhysics(0.25);
    expect(go.object3d.position.x).toBeCloseTo(1);
    expect(go.object3d.quaternion.equals(new THREE.Quaternion())).toBe(true);
  });
});
