import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';

// The real Rapier WASM build doesn't load under vitest (BUG-003). Eye height
// only needs the colliders' dimensions, so a stub module is enough here —
// the constructor builds one query capsule and reads one filter flag.
vi.mock('@dimforge/rapier3d', () => ({
  default: {
    Capsule: class { constructor(halfHeight, radius) { this.halfHeight = halfHeight; this.radius = radius; } },
    QueryFilterFlags: { EXCLUDE_SENSORS: 8 },
  },
}));

const { FirstPersonController } = await import('./FirstPersonController.js');
const { playerBody } = await import('./PlayerBody.js');

const DT = 1 / 60;
const body = playerBody();

/** A grounded controller on stub colliders sized from PlayerBody. */
function makeController() {
  const collider = (half) => ({ halfHeight: () => half, radius: () => body.radius, setEnabled: vi.fn() });
  const standCollider  = collider(body.standHalf);
  const crouchCollider = collider(body.crouchHalf);

  const ctrl = new FirstPersonController({}, {
    standCollider, crouchCollider,
    standEyeOffset: body.standEyeOffset,
    crouchEyeOffset: body.crouchEyeOffset,
  });
  ctrl.camera = new THREE.PerspectiveCamera();
  // Minimal GameObject: the swap helpers reassign `collider`, and onUpdate
  // bails before input when there's no engine — which is all this needs.
  ctrl.gameObject = { collider: standCollider, scene: null };
  return ctrl;
}

/** Camera height above the feet, given where the capsule centre sits. */
function eyeAboveFeet(ctrl, centreAboveFeet) {
  return centreAboveFeet + ctrl.camera.position.y;
}

const standCentre  = body.standHalf + body.radius;
const crouchCentre = body.crouchHalf + body.radius;

describe('FirstPersonController eye height', () => {
  it('holds the camera at the standing eye offset at rest', () => {
    const ctrl = makeController();
    ctrl.onUpdate(DT);
    expect(ctrl.camera.position.y).toBeCloseTo(body.standEyeOffset);
  });

  it('keeps applying the eye offset while input is locked (terminal open)', () => {
    const ctrl = makeController();
    ctrl.inputLocked = true;
    ctrl.onUpdate(DT);
    expect(ctrl.camera.position.y).toBeCloseTo(body.standEyeOffset);
  });

  it('leaves the eye where it was on the frame a grounded crouch lands', () => {
    const ctrl = makeController();
    ctrl.onUpdate(DT);
    const before = eyeAboveFeet(ctrl, standCentre);

    ctrl._enterCrouch();   // capsule centre drops to crouchCentre, feet planted
    ctrl._applyEye();      // same-frame camera placement, no easing yet
    expect(eyeAboveFeet(ctrl, crouchCentre)).toBeCloseTo(before);
  });

  it('eases down to the crouched eye height', () => {
    const ctrl = makeController();
    ctrl.onUpdate(DT);
    ctrl._enterCrouch();
    for (let i = 0; i < 60; i++) ctrl.onUpdate(DT);
    expect(eyeAboveFeet(ctrl, crouchCentre)).toBeCloseTo(0.55);
  });

  it('eases back up to the standing eye height after standing', () => {
    const ctrl = makeController();
    ctrl._enterCrouch();
    for (let i = 0; i < 60; i++) ctrl.onUpdate(DT);

    const swapDrop = standCentre - crouchCentre;
    ctrl._exitCrouch(swapDrop);   // grounded stand-up: feet stay planted
    ctrl._applyEye();
    expect(eyeAboveFeet(ctrl, standCentre)).toBeCloseTo(0.55);   // no pop on the swap frame

    for (let i = 0; i < 60; i++) ctrl.onUpdate(DT);
    expect(eyeAboveFeet(ctrl, standCentre)).toBeCloseTo(1.65);
  });

  it('holds the view through a mid-air crouch (legs tuck, head stays)', () => {
    const ctrl = makeController();
    ctrl.onUpdate(DT);
    const cameraBefore = ctrl.camera.position.y;   // relative to an unmoved centre

    ctrl._enterCrouchAir();
    ctrl._applyEye();
    expect(ctrl.camera.position.y).toBeCloseTo(cameraBefore);
  });

  it('defaults to no offset, so a bare controller keeps the old centre camera', () => {
    const collider = { halfHeight: () => 0.5, radius: () => 0.3, setEnabled: vi.fn() };
    const ctrl = new FirstPersonController({}, { standCollider: collider, crouchCollider: collider });
    ctrl.camera = new THREE.PerspectiveCamera();
    ctrl.gameObject = { collider, scene: null };
    ctrl.onUpdate(DT);
    expect(ctrl.camera.position.y).toBe(0);
  });
});
