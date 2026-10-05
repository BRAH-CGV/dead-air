import * as THREE from 'three';

// ─────────────────────────────────────────────
// ShadowSides  –  seal a building against one light
// ─────────────────────────────────────────────
// Two things let the UFO's searchlight, high overhead, into a closed room:
//
//   1. A mesh that doesn't receive shadows ignores them, and three defaults
//      receiveShadow to false — the server LEDs, light fittings, the
//      vending machine's face were all lit straight through the roof.
//      Every mesh under the root receives shadows.
//   2. The faces it draws into the shadow map (below).
//
// three.js draws the BACK faces of a front-sided mesh into shadow maps. That
// cures acne on lit surfaces, but it records an occluder where light leaves
// it rather than where light meets it — and a receiver touching that far
// face reads as unshadowed. Under the UFO's searchlight, high overhead,
// that is every floor along a wall on the light's side (the ray to the
// light runs up inside the wall and out of its outer face, below the roof)
// and every wall top under the ceiling: thin bright lines along the joints
// of a dark room.
//
// Drawing both faces for that one light puts the occluder at the face light
// meets — the roof's top, the wall's outer face — so the building is solid
// to it. Every other light keeps three's default, so nothing else changes:
//
//   sealAgainst(room.root.object3d, ufo.searchlight);
//
// It works through Object3D.onBeforeShadow, which three calls per draw with
// the depth material it is about to use — and which it resets to the
// default side on every draw, so the change never leaks to another mesh or
// another light.
// ─────────────────────────────────────────────

/**
 * @param {THREE.Object3D} root    Every mesh under it.
 * @param {THREE.Light} light      A shadow-casting light.
 */
export function sealAgainst(root, light) {
  const shadowCamera = light.shadow.camera;
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.receiveShadow = true;
    const before = o.onBeforeShadow;
    o.onBeforeShadow = function (renderer, object, camera, shadowCam, geometry, depthMaterial, group) {
      before.call(this, renderer, object, camera, shadowCam, geometry, depthMaterial, group);
      if (shadowCam === shadowCamera) depthMaterial.side = THREE.DoubleSide;
    };
  });
}
