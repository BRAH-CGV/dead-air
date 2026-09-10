import { GameObject } from '../core/GameObject.js';

// ─────────────────────────────────────────────
// Satellite  –  steerable dish tower
// ─────────────────────────────────────────────
// A GameObject subclass for the 'model:dish_tower' asset. Two sub-parts
// move: the neck ('Neck_block') slews around Y — yaw — and the dish ('Dish')
// tilts around X — pitch. Each eases toward its target angle and never turns
// faster than `maxRotationSpeed`, so the tower steers like a real dish
// instead of spinning forever.
//
// Spawn through the engine, which handles physics and registration:
//
//   const dish = engine.spawnModel('model:dish_tower', {
//     name: 'Satellite', position: [0, 0, -25], scale: 0.5, type: Satellite,
//   });
//   dish.targetYaw = Math.PI / 4;   // steer at any time, from any system
//   dish.isRotating();              // false once both axes are on target
// ─────────────────────────────────────────────

export class Satellite extends GameObject {

  /** Slew limit shared by both axes, radians per second (π/8 ≈ 22.5°/s —
   *  a full yaw revolution takes 16 s). */
  maxRotationSpeed = Math.PI / 8;

  /** Angle the neck is slewing toward, radians around Y. */
  targetYaw = 0;
  /** Angle the dish is tilting toward, radians around X. */
  targetPitch = 0;

  /** The slewing base of the tower. @type {GameObject|null} */
  neck = null;
  /** The tilting reflector. @type {GameObject|null} */
  dish = null;

  // ── Scan state (driven by ComputerTerminal, stored here for convenience) ──
  /** Accumulated scan seconds (0..scanTime). @type {number} */
  scanProgress = 0;
  /** The signal currently being scanned. @type {import('../gameplay/SignalTarget.js').SignalTarget|null} */
  scanTarget = null;
  /** True while the terminal is actively scanning this dish. */
  isScanning = false;

  /** Wrap a dish-tower clone and latch onto the two moving parts. Reached
   *  via `engine.spawnModel(..., { type: Satellite })`, so the parts are
   *  resolved before the first update ticks. */
  static fromObject3D(obj) {
    const sat = super.fromObject3D(obj);
    sat.neck = sat.find('Neck_block');
    sat.dish = sat.find('Dish');
    if (!sat.neck || !sat.dish) {
      console.warn("[Satellite] dish_tower is missing its 'Neck_block' or 'Dish' sub-node — it will not move");
    }
    // Hold the pose the model shipped with until something sets a target,
    // so spawning alone doesn't jerk the tower back to zero.
    sat.targetYaw   = sat.neck?.object3d.rotation.y ?? 0;
    sat.targetPitch = sat.dish?.object3d.rotation.x ?? 0;
    return sat;
  }

  /** Slew both axes one `maxRotationSpeed`-bounded step toward their
   *  targets. super first, so components and children tick before we
   *  re-aim them. */
  _update(dt) {
    super._update(dt);
    if (this.neck) {
      this.neck.object3d.rotation.y = approachAngle(
        this.neck.object3d.rotation.y, this.targetYaw, this.maxRotationSpeed * dt,
      );
    }
    if (this.dish) {
      this.dish.object3d.rotation.x = approachAngle(
        this.dish.object3d.rotation.x, this.targetPitch, this.maxRotationSpeed * dt,
      );
    }
  }

  /** True while either axis is still slewing toward its target — false once
   *  the tower has finished aiming (or was never asked to move). Measured
   *  from the live rotations, so it is correct even between updates. */
  isRotating() {
    if (this.neck && Math.abs(angleDelta(this.neck.object3d.rotation.y, this.targetYaw)) > SETTLED_EPSILON) {
      return true;
    }
    if (this.dish && Math.abs(angleDelta(this.dish.object3d.rotation.x, this.targetPitch)) > SETTLED_EPSILON) {
      return true;
    }
    return false;
  }

  // ── Gameplay helpers ──────────────────────────────────────

  /** Aim the dish at a sky direction. The slew happens over subsequent
   *  _update ticks at maxRotationSpeed. */
  aimAt(yaw, pitch) {
    this.targetYaw = yaw;
    this.targetPitch = pitch;
  }

  /** Angular distance (radians) from the dish's current aim to a target
   *  direction. Combines yaw and pitch error into a single magnitude. */
  getAimError(targetYaw, targetPitch) {
    const yawErr = this.neck
      ? Math.abs(angleDelta(this.neck.object3d.rotation.y, targetYaw))
      : 0;
    const pitchErr = this.dish
      ? Math.abs(angleDelta(this.dish.object3d.rotation.x, targetPitch))
      : 0;
    return Math.sqrt(yawErr * yawErr + pitchErr * pitchErr);
  }

  /** True when the dish is aimed within `tolerance` radians of the target. */
  isAimedAt(targetYaw, targetPitch, tolerance) {
    return this.getAimError(targetYaw, targetPitch) <= tolerance;
  }
}

/** Remaining error below which an axis counts as settled, in radians. The
 *  slew lands exactly on its target, so this only absorbs float noise from
 *  targets set to values computed elsewhere. */
const SETTLED_EPSILON = 1e-6;

/** Shortest signed difference from `angle` to `target`, wrapped into ±π —
 *  the distance and direction around the circle. */
function angleDelta(angle, target) {
  return Math.atan2(Math.sin(target - angle), Math.cos(target - angle));
}

/** Step `angle` toward `target` by at most `maxStep` radians. The atan2
 *  wraps the difference into ±π, so yaw always takes the short way around
 *  the circle instead of slewing through a full turn. */
function approachAngle(angle, target, maxStep) {
  const delta = angleDelta(angle, target);
  return Math.abs(delta) <= maxStep ? target : angle + Math.sign(delta) * maxStep;
}
