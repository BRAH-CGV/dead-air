import { GameObject } from '../core/GameObject.js';
import { aimError, angleDelta, SETTLED_EPSILON, createLocalRig } from './DishRig.js';

// ─────────────────────────────────────────────
// Satellite  –  steerable dish tower
// ─────────────────────────────────────────────
// A GameObject subclass for the 'model:dish-tower' asset. Two sub-parts
// move: the neck ('Neck_block') slews around Y — yaw — and the dish ('Dish')
// tilts around X — pitch. Each eases toward its target angle and never turns
// faster than `maxRotationSpeed`, so the tower steers like a real dish
// instead of spinning forever.
//
// The aiming state and spring-damper physics live in a headless DishRig
// (`this.rig`); the model's Object3D rotations stay authoritative for
// rendering — _update syncs them into the rig, advances it, writes back.
// The same rig class simulates the neighbouring array nodes' dishes
// (`this.neighbours`), which are too far away to be seen or heard, so only
// their rotation is simulated — no model, no body.
//
// Spawn through the engine, which handles physics and registration:
//
//   const dish = engine.spawnModel('model:dish-tower', {
//     name: 'Satellite', position: [0, 0, -25], scale: 0.5, type: Satellite,
//   });
//   dish.aimAll(Math.PI / 4, -0.4); // steer the whole array at any time
//   dish.isRotating();              // false once both axes are on target
// ─────────────────────────────────────────────

export { DISH_SLEW_RATE } from './DishRig.js';

export class Satellite extends GameObject {

  /** The local tower's aiming state. Its reach is the array's centre: out
   *  from the zenith (the radar's centre) to the ring of neighbour origins,
   *  and not beyond — the outer band of the sky belongs to the neighbours. */
  rig = createLocalRig();

  /** Dishes of the neighbouring array nodes, simulated headless. Set by the
   *  scene; _update ticks them alongside the local rig.
   *  @type {DishRig[]} */
  neighbours = [];

  // ── Facade over the rig: field writes/reads keep working ──
  /** Slew limit shared by both axes, radians per second. */
  get maxRotationSpeed() { return this.rig.maxRotationSpeed; }
  set maxRotationSpeed(v) { this.rig.maxRotationSpeed = v; }
  /** Angle the neck is slewing toward, radians around Y. */
  get targetYaw() { return this.rig.targetYaw; }
  set targetYaw(v) { this.rig.targetYaw = v; }
  /** Angle the dish is tilting toward, radians around X. */
  get targetPitch() { return this.rig.targetPitch; }
  set targetPitch(v) { this.rig.targetPitch = v; }
  /** Angular velocity around Y (rad/s). */
  get velYaw() { return this.rig.velYaw; }
  set velYaw(v) { this.rig.velYaw = v; }
  /** Angular velocity around X (rad/s). */
  get velPitch() { return this.rig.velPitch; }
  set velPitch(v) { this.rig.velPitch = v; }
  /** How fast the dish accelerates toward target (rad/s^2 per rad of error). */
  get angularAccel() { return this.rig.angularAccel; }
  set angularAccel(v) { this.rig.angularAccel = v; }
  /** Velocity damping factor (higher = less overshoot). */
  get angularDamping() { return this.rig.angularDamping; }
  set angularDamping(v) { this.rig.angularDamping = v; }

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
      console.warn("[Satellite] dish-tower is missing its 'Neck_block' or 'Dish' sub-node — it will not move");
    }
    // Hold the pose the model shipped with until something sets a target,
    // so spawning alone doesn't jerk the tower back to zero.
    const yaw   = sat.neck?.object3d.rotation.y ?? 0;
    const pitch = sat.dish?.object3d.rotation.x ?? 0;
    sat.rig.currentYaw   = yaw;
    sat.rig.currentPitch = pitch;
    sat.rig.targetYaw    = yaw;
    sat.rig.targetPitch  = pitch;
    return sat;
  }

  /** Slew the tower and tick every neighbour dish with the same
   *  spring-damper momentum physics. super first, so components and
   *  children tick before we re-aim them. The model's Object3D rotations
   *  are authoritative: they sync into the rig, the rig advances, and the
   *  new angles are written back. */
  _update(dt) {
    super._update(dt);

    // Scan logic (runs regardless of terminal state). Every dish of the
    // array that is locked on adds its share to the scan speed — two dishes
    // finish twice as fast.
    if (this.isScanning && this.scanTarget) {
      const dishes = this.aimedDishCount(
        this.scanTarget.yaw, this.scanTarget.pitch, this.scanTarget.tolerance,
      );
      if (dishes > 0) {
        this.scanProgress += dishes * dt;
        if (this.scanProgress >= this.scanTarget.scanTime) {
          this.scanTarget.scanned = true;
          this.isScanning = false;
          this._scanComplete = true;
        }
      } else {
        // Every dish drifted — pause (don't reset progress)
        this.isScanning = false;
      }
    }

    // Local tower: sync live rotations in, advance the shared physics, out.
    if (this.neck) this.rig.currentYaw = this.neck.object3d.rotation.y;
    if (this.dish) this.rig.currentPitch = this.dish.object3d.rotation.x;
    this.rig.update(dt);
    if (this.neck) this.neck.object3d.rotation.y = this.rig.currentYaw;
    if (this.dish) this.dish.object3d.rotation.x = this.rig.currentPitch;

    // The neighbours have no model — the rig's numbers are all they are.
    for (const rig of this.neighbours) rig.update(dt);
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

  /** Aim the local dish at a sky direction. The slew happens over subsequent
   *  _update ticks at maxRotationSpeed. */
  aimAt(yaw, pitch) {
    this.rig.aimAt(yaw, pitch);
  }

  /** Aim the whole array at a sky direction — the cursor's shared aim
   *  point. Every dish, local included, re-targets only while the point
   *  lies inside its section; a dish whose section doesn't contain the
   *  point holds its last target. aimAt stays unconditional — it is the
   *  low-level "point there" used for cutscenes and tests. */
  aimAll(yaw, pitch) {
    if (this.rig.covers(yaw, pitch)) this.rig.aimAt(yaw, pitch);
    for (const rig of this.neighbours) {
      if (rig.covers(yaw, pitch)) rig.aimAt(yaw, pitch);
    }
  }

  /** How many dishes — local plus neighbours — are aimed within
   *  `tolerance` radians of the target. Scan speed scales with this. */
  aimedDishCount(targetYaw, targetPitch, tolerance) {
    let count = this.isAimedAt(targetYaw, targetPitch, tolerance) ? 1 : 0;
    for (const rig of this.neighbours) {
      if (rig.isAimedAt(targetYaw, targetPitch, tolerance)) count++;
    }
    return count;
  }

  /** True when at least one dish of the array is aimed within `tolerance`
   *  radians of the target — the gate for starting a scan. */
  isAnyDishAimedAt(targetYaw, targetPitch, tolerance) {
    if (this.isAimedAt(targetYaw, targetPitch, tolerance)) return true;
    for (const rig of this.neighbours) {
      if (rig.isAimedAt(targetYaw, targetPitch, tolerance)) return true;
    }
    return false;
  }

  /** Angular distance (radians) from the dish's current aim to a target
   *  direction. Combines yaw and pitch error into a single magnitude. */
  getAimError(targetYaw, targetPitch) {
    // A missing part can't contribute error — treat it as on target.
    const yaw = this.neck ? this.neck.object3d.rotation.y : targetYaw;
    const pitch = this.dish ? this.dish.object3d.rotation.x : targetPitch;
    return aimError(yaw, pitch, targetYaw, targetPitch);
  }

  /** True when the dish is aimed within `tolerance` radians of the target. */
  isAimedAt(targetYaw, targetPitch, tolerance) {
    return this.getAimError(targetYaw, targetPitch) <= tolerance;
  }
}
