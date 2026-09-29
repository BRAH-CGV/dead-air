import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';

// ─────────────────────────────────────────────
// SecurityCameraRig  –  a ceiling camera that pans, tilts and glows
// ─────────────────────────────────────────────
//
//   rig (mount, on the ceiling)
//    └─ pivot   yaw   — rotation.y, 0 looks along +Z
//        └─ head  tilt — rotation.x, positive looks down
//            ├─ model (attachModel)
//            ├─ lens  — where it sees from, looking along +Z
//            ├─ tally — a small red light that brightens with exposure
//            └─ cone  — a faint additive cone showing where it looks
//
// Only a visual: the rules (sweep, exposure) live in CameraEntityLogic and
// the threat drives this through yaw, tilt, setAlert and setActive. The
// cone is built unit-sized and scaled by setCone, so it always matches
// the view cone the rules test against.
//
// Geometry and materials are made here; the owner frees them (`resources`).
// ─────────────────────────────────────────────

const TALLY_CALM  = new THREE.Color(0x2a0605);
const TALLY_ALERT = new THREE.Color(0xff2412);
const CONE_CALM   = new THREE.Color(0x8fb4ff);
const CONE_ALERT  = new THREE.Color(0xff3020);
const CONE_OPACITY = [0.1, 0.32];   // calm, alert

export class SecurityCameraRig extends GameObject {
  /** The sweep its owner wants, radians: yaw limits and the resting tilt. */
  minYaw = 0;
  maxYaw = 0;
  restTilt = 0;

  /**
   * @param {string} [name]
   * @param {object} [opts]
   * @param {number} [opts.lensOffset]  metres from the pivot to the lens, along the view
   */
  constructor(name = 'SecurityCamera', { lensOffset = 0.15 } = {}) {
    super(name);
    this.pivot = this.addChild(new GameObject(`${name}Pivot`));
    this.head = this.pivot.addChild(new GameObject(`${name}Head`));

    this.lens = new THREE.Object3D();
    this.lens.name = `${name}Lens`;
    this.lens.position.z = lensOffset;
    this.head.object3d.add(this.lens);

    const tallyGeometry = new THREE.SphereGeometry(0.018, 8, 6);
    const tallyMaterial = new THREE.MeshBasicMaterial({ color: TALLY_CALM, fog: false });
    this.tally = new THREE.Mesh(tallyGeometry, tallyMaterial);
    this.tally.name = `${name}Tally`;
    this.tally.position.set(0.035, 0.05, lensOffset - 0.03);
    this.head.object3d.add(this.tally);

    const coneGeometry = unitCone();
    const coneMaterial = new THREE.MeshBasicMaterial({
      color: CONE_CALM.clone(),
      vertexColors: true,       // per-vertex alpha: bright at the lens, gone at the far end
      transparent: true,
      opacity: CONE_OPACITY[0],
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.cone = new THREE.Mesh(coneGeometry, coneMaterial);
    this.cone.name = `${name}Cone`;
    this.cone.position.copy(this.lens.position);
    this.cone.visible = false;
    this.head.object3d.add(this.cone);

    this.resources = [tallyGeometry, tallyMaterial, coneGeometry, coneMaterial];
    this.setCone(7, 25 * Math.PI / 180);
  }

  get yaw() { return this.pivot.object3d.rotation.y; }
  set yaw(v) { this.pivot.object3d.rotation.y = v; }

  get tilt() { return this.head.object3d.rotation.x; }
  set tilt(v) { this.head.object3d.rotation.x = v; }

  /** Size the cone to the rules' view cone. */
  setCone(range, halfAngle) {
    const r = range * Math.tan(halfAngle);
    this.cone.scale.set(r, r, range);
    this.range = range;
    this.halfAngle = halfAngle;
  }

  /** Show the cone while the camera is watching (its night). */
  setActive(on) {
    this.cone.visible = on;
    if (!on) this.setAlert(0);
  }

  /** 0 calm … 1 about to fail the night. Allocates nothing. */
  setAlert(level) {
    const t = Math.min(1, Math.max(0, level));
    this.tally.material.color.lerpColors(TALLY_CALM, TALLY_ALERT, t);
    this.cone.material.color.lerpColors(CONE_CALM, CONE_ALERT, t);
    this.cone.material.opacity = CONE_OPACITY[0] + (CONE_OPACITY[1] - CONE_OPACITY[0]) * t;
  }

  /** Mount a model on the head, so it pans and tilts with the view. */
  attachModel(go) {
    this.head.addChild(go);
    go.object3d.position.set(0, 0, 0);
    go.object3d.rotation.set(0, 0, 0);
    return go;
  }

  /** @param {THREE.Vector3} target */
  getLensPosition(target) {
    this.lens.updateWorldMatrix(true, false);
    return target.setFromMatrixPosition(this.lens.matrixWorld);
  }

  /** Unit view direction in world space. @param {THREE.Vector3} target */
  getLensDirection(target) {
    return this.lens.getWorldDirection(target);
  }
}

/** Open cone, apex at the origin, opening along +Z to a unit-radius rim
 *  one unit out. Vertex alpha fades it out toward the rim. */
function unitCone() {
  const geometry = new THREE.ConeGeometry(1, 1, 24, 6, true);
  geometry.translate(0, -0.5, 0);   // apex to the origin
  geometry.rotateX(-Math.PI / 2);   // open along +Z
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 4);
  for (let i = 0; i < position.count; i++) {
    const fade = 1 - position.getZ(i);
    colors.set([1, 1, 1, fade * fade], i * 4);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  return geometry;
}
