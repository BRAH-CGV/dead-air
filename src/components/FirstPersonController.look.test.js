import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';

// The real Rapier WASM build doesn't load under vitest (BUG-003). Mouse look
// only needs the constructor's query capsule and filter flag.
vi.mock('@dimforge/rapier3d', () => ({
  default: {
    Capsule: class { constructor(halfHeight, radius) { this.halfHeight = halfHeight; this.radius = radius; } },
    QueryFilterFlags: { EXCLUDE_SENSORS: 8 },
  },
}));

const { FirstPersonController } = await import('./FirstPersonController.js');

const DT = 1 / 60;

/** A controller with an engine whose mouse moved by (dx, dy) this frame. */
function makeController(opts = {}, { dx = 0, dy = 0 } = {}) {
  const collider = { halfHeight: () => 0.5, radius: () => 0.3, setEnabled: vi.fn() };
  const ctrl = new FirstPersonController({}, { standCollider: collider, crouchCollider: collider, ...opts });
  ctrl.camera = new THREE.PerspectiveCamera();
  const engine = {
    input: { keys: {}, pressed: {}, mouse: { dx, dy }, locked: true },
    keyBinds: { forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', crouch: 'KeyC' },
    isAction: () => false,
  };
  ctrl.gameObject = { collider, scene: { userData: { engine } } };
  return ctrl;
}

describe('FirstPersonController mouse look', () => {
  it('moving the mouse down looks down by default', () => {
    const ctrl = makeController({}, { dy: 10 });
    ctrl.onUpdate(DT);
    expect(ctrl.pitch).toBeLessThan(0);
  });

  it('invertY flips the pitch', () => {
    const ctrl = makeController({ invertY: true }, { dy: 10 });
    ctrl.onUpdate(DT);
    expect(ctrl.pitch).toBeGreaterThan(0);
  });

  it('invertY leaves yaw alone', () => {
    const plain = makeController({}, { dx: 10 });
    const inverted = makeController({ invertY: true }, { dx: 10 });
    plain.onUpdate(DT);
    inverted.onUpdate(DT);
    expect(inverted.yaw).toBeCloseTo(plain.yaw);
  });

  it('defaults invertY to false, and can be flipped at runtime', () => {
    const ctrl = makeController({}, { dy: 10 });
    expect(ctrl.invertY).toBe(false);
    ctrl.invertY = true;
    ctrl.onUpdate(DT);
    expect(ctrl.pitch).toBeGreaterThan(0);
  });

  it('lookLocked freezes the view (rotating a held object) but not the legs', () => {
    const ctrl = makeController({}, { dx: 10, dy: 10 });
    ctrl.gameObject.scene.userData.engine.input.keys.KeyW = true;
    ctrl.lookLocked = true;
    ctrl.onUpdate(DT);
    expect(ctrl.yaw).toBe(0);
    expect(ctrl.pitch).toBe(0);
    expect(ctrl._wish).toBe(true);
  });
});
