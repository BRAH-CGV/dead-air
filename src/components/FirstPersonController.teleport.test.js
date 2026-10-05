import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';

// The real Rapier WASM build doesn't load under vitest (BUG-003): a stub
// module, as in FirstPersonController.eye.test.js.
vi.mock('@dimforge/rapier3d', () => ({
  default: {
    Capsule: class { constructor(halfHeight, radius) { this.halfHeight = halfHeight; this.radius = radius; } },
    QueryFilterFlags: { EXCLUDE_SENSORS: 8 },
  },
}));

const { FirstPersonController } = await import('./FirstPersonController.js');
const { playerBody } = await import('./PlayerBody.js');

const body = playerBody();

/** A controller on a stub kinematic body that records where it was put. */
function makeController() {
  const collider = (half) => ({ halfHeight: () => half, radius: () => body.radius, setEnabled: vi.fn() });
  const standCollider = collider(body.standHalf);
  const crouchCollider = collider(body.crouchHalf);
  const ctrl = new FirstPersonController({}, { standCollider, crouchCollider });
  ctrl.camera = new THREE.PerspectiveCamera();
  const rigidBody = {
    handle: 7,
    setTranslation: vi.fn(),
    setNextKinematicTranslation: vi.fn(),
  };
  const object3d = new THREE.Object3D();
  const prevPos = new Map([[7, { x: 9, y: 9, z: 9 }]]);
  ctrl.gameObject = {
    collider: standCollider, rigidBody, object3d,
    scene: { userData: { engine: { _prevPos: prevPos } } },
  };
  return { ctrl, rigidBody, object3d, prevPos };
}

describe('FirstPersonController.teleport', () => {
  it('puts the body, its next kinematic step and the visual at the spot', () => {
    const { ctrl, rigidBody, object3d } = makeController();
    ctrl.teleport([0, 1, 0]);
    expect(rigidBody.setTranslation).toHaveBeenCalledWith({ x: 0, y: 1, z: 0 }, true);
    expect(rigidBody.setNextKinematicTranslation).toHaveBeenCalledWith({ x: 0, y: 1, z: 0 });
    expect(object3d.position.toArray()).toEqual([0, 1, 0]);
  });

  it('cuts the interpolation, so the view jumps instead of sliding across the base', () => {
    const { ctrl, prevPos } = makeController();
    ctrl.teleport([0, 1, 0]);
    expect(prevPos.get(7)).toEqual({ x: 0, y: 1, z: 0 });
  });

  it('kills all momentum', () => {
    const { ctrl } = makeController();
    ctrl._vel.x = 5; ctrl._vel.z = -3; ctrl.vertVel = -8; ctrl._wantJump = true;
    ctrl.teleport([0, 1, 0]);
    expect(ctrl._vel).toEqual({ x: 0, z: 0 });
    expect(ctrl.vertVel).toBe(0);
    expect(ctrl._wantJump).toBe(false);
  });

  it('faces the given way at once, with no smoothing swing', () => {
    const { ctrl } = makeController();
    ctrl.yaw = 2; ctrl.pitch = -0.6; ctrl._smoothYaw = 2; ctrl._smoothPitch = -0.6;
    ctrl.teleport([0, 1, 0], { yaw: 0, pitch: 0 });
    expect(ctrl.yaw).toBe(0);
    expect(ctrl.pitch).toBe(0);
    expect(ctrl._smoothYaw).toBe(0);
    expect(ctrl._smoothPitch).toBe(0);
  });
});
