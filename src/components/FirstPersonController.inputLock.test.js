import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';

// The real Rapier WASM build doesn't load under vitest (BUG-003). Sampling
// input only needs the constructor's query capsule and filter flag.
vi.mock('@dimforge/rapier3d', () => ({
  default: {
    Capsule: class { constructor(halfHeight, radius) { this.halfHeight = halfHeight; this.radius = radius; } },
    QueryFilterFlags: { EXCLUDE_SENSORS: 8 },
  },
}));

const { FirstPersonController } = await import('./FirstPersonController.js');

const DT = 1 / 60;

/** A controller whose engine has `keys` held. */
function makeController(keys = {}) {
  const collider = { halfHeight: () => 0.5, radius: () => 0.3, setEnabled: vi.fn() };
  const ctrl = new FirstPersonController({}, { standCollider: collider, crouchCollider: collider });
  ctrl.camera = new THREE.PerspectiveCamera();
  const engine = {
    input: { keys, pressed: {}, mouse: { dx: 0, dy: 0 }, locked: true },
    keyBinds: { forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', crouch: 'KeyC' },
    isAction: () => false,
  };
  ctrl.gameObject = { collider, scene: { userData: { engine } } };
  return ctrl;
}

describe('FirstPersonController input lock (#58)', () => {
  it('a movement key held as a panel opens stops moving the player', () => {
    const ctrl = makeController({ KeyW: true });
    ctrl.onUpdate(DT);
    expect(ctrl._wish).toBe(true);

    ctrl.inputLocked = true;   // the terminal or the breaker panel opened
    ctrl.onUpdate(DT);
    expect(ctrl._wish).toBe(false);
  });

  it('a held jump is dropped too', () => {
    const ctrl = makeController({ Space: true });
    ctrl.onUpdate(DT);
    expect(ctrl._wantJump).toBe(true);
    ctrl.inputLocked = true;
    ctrl.onUpdate(DT);
    expect(ctrl._wantJump).toBe(false);
  });

  it('moves again once the panel closes, if the key is still held', () => {
    const ctrl = makeController({ KeyW: true });
    ctrl.inputLocked = true;
    ctrl.onUpdate(DT);
    ctrl.inputLocked = false;
    ctrl.onUpdate(DT);
    expect(ctrl._wish).toBe(true);
  });
});
