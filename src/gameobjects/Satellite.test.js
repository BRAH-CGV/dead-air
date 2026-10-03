import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';
import { Satellite, DISH_SLEW_RATE } from './Satellite.js';
import { DishRig, cursorToSky } from './DishRig.js';

/** Minimal dish-tower stand-in: Base → Neck_block → Dish, matching the node
 *  names the real GLB ships with. */
function buildTower() {
  const root = new THREE.Object3D(); root.name = 'Base';
  const neck = new THREE.Object3D(); neck.name = 'Neck_block';
  const dish = new THREE.Object3D(); dish.name = 'Dish';
  neck.add(dish);
  root.add(neck);
  return { root, neck, dish };
}

describe('Satellite', () => {
  it('wraps the model root as a Satellite and latches onto the moving parts', () => {
    const { root } = buildTower();
    const sat = Satellite.fromObject3D(root);

    expect(sat).toBeInstanceOf(Satellite);
    expect(sat.neck).toBeInstanceOf(GameObject);   // children stay plain wrappers
    expect(sat.neck.name).toBe('Neck_block');
    expect(sat.dish.name).toBe('Dish');
  });

  it('holds the pose the model shipped with until a target is set', () => {
    const { root, neck, dish } = buildTower();
    neck.rotation.y = 0.5;
    dish.rotation.x = -0.25;
    const sat = Satellite.fromObject3D(root);

    // The rig latches the shipped pose in game angles — the neck mirrors
    // yaw, so model 0.5 is game bearing π − 0.5. The dish tilt is direct.
    expect(sat.targetYaw).toBeCloseTo(Math.PI - 0.5);
    expect(sat.targetPitch).toBeCloseTo(-0.25);

    sat._update(1);   // a whole second of headroom — nothing may move
    expect(neck.rotation.y).toBeCloseTo(0.5);
    expect(dish.rotation.x).toBeCloseTo(-0.25);
  });

  // ── The model's world convention (measured from dish-tower.glb) ──
  // The reflector's axis is its mesh's local +Z (the feed horn sits on the
  // +Z side); the dish tilts about X and the neck slews about Y. A POSITIVE
  // neck rotation swings the boresight toward −X while game yaw
  // (atan2(x, −z)) grows toward +X — the neck MIRRORS game yaw, so bearing
  // g needs neck.rotation.y = π − g. Pitch is direct: the boresight's
  // elevation is −dish.rotation.x, the game's own pitch sign.

  it('points the dish where the game aims — the boresight, through the model', () => {
    const { root, neck, dish } = buildTower();
    const sat = Satellite.fromObject3D(root);
    sat.aimAt(0.6, -0.35);

    for (let i = 0; i < 1200; i++) sat._update(1 / 60);   // settle the slew

    expect(neck.rotation.y).toBeCloseTo(Math.PI - 0.6, 1);
    expect(dish.rotation.x).toBeCloseTo(-0.35, 1);

    // The boresight is the Dish node's local +Z; in world it must equal the
    // game direction (sin yaw·cos elev, sin elev, −cos yaw·cos elev).
    const bore = new THREE.Vector3();
    dish.getWorldDirection(bore);
    expect(bore.x).toBeCloseTo(Math.sin(0.6) * Math.cos(0.35), 1);
    expect(bore.y).toBeCloseTo(Math.sin(0.35), 1);
    expect(bore.z).toBeCloseTo(-Math.cos(0.6) * Math.cos(0.35), 1);
  });

  it("reads the model's live pose back as game angles — the mirror runs both ways", () => {
    const { root, neck, dish } = buildTower();
    neck.rotation.y = Math.PI;   // boresight toward −Z: bearing 0, out the window
    dish.rotation.x = -0.5;
    const sat = Satellite.fromObject3D(root);

    expect(sat.rig.currentYaw).toBeCloseTo(0);
    expect(sat.rig.currentPitch).toBeCloseTo(-0.5);
    expect(sat.getAimError(0, -0.5)).toBeCloseTo(0, 1);
  });

  it('exposes the current aim in game angles for the radar', () => {
    const { root, neck, dish } = buildTower();
    neck.rotation.y = Math.PI - 0.8;
    dish.rotation.x = -0.4;
    const sat = Satellite.fromObject3D(root);

    expect(sat.currentYaw).toBeCloseTo(0.8);
    expect(sat.currentPitch).toBeCloseTo(-0.4);
  });

  it('accelerates from rest instead of moving at constant rate', () => {
    const { root, neck } = buildTower();
    const sat = Satellite.fromObject3D(root);
    sat.maxRotationSpeed = 2;
    sat.angularAccel = 4;     // rad/s^2
    // The stand-in parks at bearing π; a half turn across the ±π seam is
    // far away, and the rig's yaw climbs to reach it.
    sat.targetYaw = -Math.PI / 2;

    // First small step: velocity builds up from zero
    sat._update(0.1);
    const firstMove = sat.rig.currentYaw;
    expect(firstMove).toBeGreaterThan(Math.PI);
    // With momentum starting from rest, initial movement is gradual
    expect(sat.velYaw).toBeGreaterThan(0);
    expect(sat.velYaw).toBeLessThan(sat.maxRotationSpeed);

    // After more time, velocity builds up
    sat._update(0.5);
    expect(sat.rig.currentYaw).toBeGreaterThan(firstMove);
  });

  it('decelerates as it approaches the target', () => {
    const { root, neck } = buildTower();
    neck.rotation.y = Math.PI;   // parked at bearing 0 — the neck mirrors yaw
    const sat = Satellite.fromObject3D(root);
    sat.maxRotationSpeed = 10;
    sat.angularAccel = 5;
    sat.angularDamping = 8;  // high damping for quick decel
    sat.targetYaw = 0.5;     // close target

    // Get it moving
    sat._update(0.2);
    const vel1 = sat.velYaw;
    expect(vel1).toBeGreaterThan(0);

    // As it nears target, velocity should decrease
    sat._update(0.2);
    const vel2 = sat.velYaw;
    // Either velocity decreased or it settled
    expect(vel2 <= vel1 || Math.abs(sat.currentYaw - 0.5) < 0.01).toBe(true);
  });

  it('clamps velocity to maxRotationSpeed', () => {
    const { root } = buildTower();
    const sat = Satellite.fromObject3D(root);
    sat.maxRotationSpeed = 1;
    sat.angularAccel = 100;   // very high accel
    sat.targetYaw = Math.PI / 2;  // a quarter turn from the parked bearing π

    sat._update(1);  // enough time to accelerate
    expect(sat.velYaw).toBeLessThanOrEqual(1 + 0.001);  // clamped to max
    expect(sat.velYaw).toBeGreaterThanOrEqual(-1 - 0.001);
  });

  it('settles near target with damping', () => {
    const { root, neck } = buildTower();
    const sat = Satellite.fromObject3D(root);
    sat.maxRotationSpeed = 2;
    sat.angularAccel = 3;
    sat.angularDamping = 6;  // higher damping for faster settling
    // The stand-in parks at bearing π; a target 1 rad away keeps the travel
    // this test's 4-second budget was calibrated for — the spring is
    // overdamped, so the residual after a fixed time scales with distance.
    sat.targetYaw = Math.PI - 1.0;

    // Run for a while — momentum causes overshoot, but damping settles it
    for (let i = 0; i < 120; i++) sat._update(1/30);  // 4 seconds

    // Close to target after settling, in game angles
    expect(Math.abs(sat.currentYaw - (Math.PI - 1.0))).toBeLessThan(0.15);
  });

  it('moves toward the target with momentum', () => {
    const { root, neck, dish } = buildTower();
    const sat = Satellite.fromObject3D(root);
    sat.maxRotationSpeed = 2;
    sat.angularAccel = 4;
    sat.angularDamping = 3;
    sat.targetYaw   = Math.PI / 2;
    sat.targetPitch = Math.PI / 2;

    sat._update(0.5);  // dish moves toward target with momentum
    expect(neck.rotation.y).toBeGreaterThan(0);
    expect(dish.rotation.x).toBeGreaterThan(0);
    // Velocity is building up; the rig bears down from the parked bearing π
    expect(sat.velYaw).toBeLessThan(0);
    expect(sat.velPitch).toBeGreaterThan(0);
  });

  it('takes the short way around the circle', () => {
    const { root } = buildTower();
    const sat = Satellite.fromObject3D(root);
    sat.targetYaw = -3;   // parked at bearing π: 0.14 rad up through the seam

    sat._update(0.01);    // a small step must head up through ±π
    expect(sat.rig.currentYaw).toBeGreaterThan(Math.PI);
    expect(sat.rig.currentYaw).toBeLessThanOrEqual(Math.PI + (Math.PI / 8) * 0.01);
  });

  it('isRotating reports false when spawned and true once a target is set', () => {
    const { root, neck } = buildTower();
    const sat = Satellite.fromObject3D(root);
    expect(sat.isRotating()).toBe(false);   // targets start on the shipped pose

    sat.targetYaw = 1;
    sat.maxRotationSpeed = 10;  // fast cap so it can reach target in time
    sat.angularAccel = 10;  // high accel for fast response
    sat.angularDamping = 10;  // high damping to prevent oscillation
    expect(sat.isRotating()).toBe(true);    // and immediately reflect a new aim

    // With momentum, the dish moves toward target and eventually settles
    for (let i = 0; i < 500; i++) sat._update(1/30);  // ~17 seconds
    // Should be close to target (within a few degrees)
    expect(Math.abs(sat.currentYaw - 1.0)).toBeLessThan(0.1);   // game angles
  });

  it('isRotating is true while either axis is off target', () => {
    const { root, dish } = buildTower();
    dish.rotation.x = 0.2;
    const sat = Satellite.fromObject3D(root);
    sat.targetPitch = -0.2;                 // yaw settled, pitch not

    expect(sat.isRotating()).toBe(true);
  });

  it('isRotating treats a target one full turn away as settled', () => {
    const { root, neck } = buildTower();
    neck.rotation.y = 1;
    const sat = Satellite.fromObject3D(root);
    sat.targetYaw = Math.PI - 1 + Math.PI * 2;   // same bearing as the parked pose (π − 1), wrapped

    expect(sat.isRotating()).toBe(false);
  });

  // ── Gameplay helpers ─────────────────────────────────────

  it('aimAt sets both target angles', () => {
    const { root } = buildTower();
    const sat = Satellite.fromObject3D(root);
    sat.aimAt(1.2, -0.4);
    expect(sat.targetYaw).toBeCloseTo(1.2);
    expect(sat.targetPitch).toBeCloseTo(-0.4);
  });

  it('getAimError returns 0 when on target', () => {
    const { root, neck, dish } = buildTower();
    neck.rotation.y = Math.PI - 0.5;   // boresight at game bearing 0.5
    dish.rotation.x = -0.3;
    const sat = Satellite.fromObject3D(root);
    expect(sat.getAimError(0.5, -0.3)).toBeCloseTo(0);
  });

  it('getAimError returns combined angular distance', () => {
    const { root, neck, dish } = buildTower();
    neck.rotation.y = Math.PI;   // boresight at game bearing 0
    dish.rotation.x = 0;
    const sat = Satellite.fromObject3D(root);
    // yaw error = 0.3, pitch error = 0.4, combined = 0.5 (Pythagorean)
    const error = sat.getAimError(0.3, 0.4);
    expect(error).toBeCloseTo(0.5);
  });

  it('isAimedAt returns true within tolerance and false outside', () => {
    const { root, neck, dish } = buildTower();
    neck.rotation.y = Math.PI;   // boresight at game bearing 0
    dish.rotation.x = 0;
    const sat = Satellite.fromObject3D(root);

    expect(sat.isAimedAt(0.01, 0.01, 0.1)).toBe(true);   // tiny error < 0.1
    expect(sat.isAimedAt(1.0, 1.0, 0.1)).toBe(false);     // large error > 0.1
  });

  // ── Default tuning — how the dish feels in the minigame ───
  // These use the shipped constants, not per-test overrides: they pin the
  // pace a player actually waits through while the dish chases the cursor.

  /** Step at 60 fps until both axes have stayed within 1° of target for a
   *  full second; returns the time that settled run began. */
  function timeToSettle(sat, maxSeconds = 20) {
    const DT = 1 / 60, ONE_DEG = Math.PI / 180;
    let settledAt = null;
    for (let t = 0; t < maxSeconds; t += DT) {
      sat._update(DT);
      // Settling is measured in game angles — the neck's rotation mirrors yaw
      const onTarget = Math.abs(sat.currentYaw - sat.targetYaw) < ONE_DEG
                    && Math.abs(sat.currentPitch - sat.targetPitch) < ONE_DEG;
      if (!onTarget) settledAt = null;
      else if (settledAt === null) settledAt = t;
      else if (t - settledAt >= 1) return settledAt;
    }
    return Infinity;
  }

  it('swings round to face the opposite sky within 10 s', () => {
    const { root, neck, dish } = buildTower();
    const sat = Satellite.fromObject3D(root);
    sat.aimAt(0, 0);   // the stand-in parks at bearing π: the opposite sky
    expect(timeToSettle(sat)).toBeLessThanOrEqual(10);
  });

  it('takes its time over a half turn — heavy, not twitchy (at least 8 s)', () => {
    const { root, neck, dish } = buildTower();
    const sat = Satellite.fromObject3D(root);
    sat.aimAt(0, 0);   // a half turn from the parked bearing π
    expect(timeToSettle(sat)).toBeGreaterThanOrEqual(8);
  });

  it('slews at DISH_SLEW_RATE, 22.5°/s, by default', () => {
    const { root } = buildTower();
    const sat = Satellite.fromObject3D(root);
    expect(DISH_SLEW_RATE).toBeCloseTo(Math.PI / 8);
    expect(sat.maxRotationSpeed).toBe(DISH_SLEW_RATE);
  });

  it('makes a small correction in under a second', () => {
    const { root, neck, dish } = buildTower();
    const sat = Satellite.fromObject3D(root);
    sat.aimAt(Math.PI - 12 * Math.PI / 180, -12 * Math.PI / 180);   // near the parked bearing π
    expect(timeToSettle(sat)).toBeLessThan(1);
  });

  it('comes to rest without swinging past the target', () => {
    const { root, neck } = buildTower();
    const sat = Satellite.fromObject3D(root);
    sat.targetYaw = 1.0;                  // parked at bearing π: 2.1 rad away
    const neckTarget = Math.PI - 1.0;     // where the neck settles (mirrored)
    let furthest = 0;
    for (let i = 0; i < 600; i++) {
      sat._update(1 / 60);
      furthest = Math.max(furthest, neck.rotation.y);
    }
    expect(furthest - neckTarget).toBeLessThan(Math.PI / 180);   // < 1° overshoot
  });

  it('still looks like heavy machinery — never snaps faster than 60°/s', () => {
    const { root, neck } = buildTower();
    const sat = Satellite.fromObject3D(root);
    sat.targetYaw = 0;   // a half turn from the parked bearing π — real motion
    let prev = neck.rotation.y, fastest = 0;
    for (let i = 0; i < 300; i++) {
      sat._update(1 / 60);
      fastest = Math.max(fastest, (neck.rotation.y - prev) * 60);
      prev = neck.rotation.y;
    }
    expect(fastest).toBeLessThanOrEqual(Math.PI / 3 + 1e-9);
  });

  it('scan state starts cleared', () => {
    const { root } = buildTower();
    const sat = Satellite.fromObject3D(root);
    expect(sat.scanProgress).toBe(0);
    expect(sat.scanTarget).toBeNull();
    expect(sat.isScanning).toBe(false);
  });

  // ── The neighbouring array dishes ────────────────────────

  /** A satellite with two hand-placed neighbour rigs (not the default
   *  layout): east at cursor (0.5, 0) and west at (-0.5, 0), each covering
   *  0.55 around its origin — the east one reaches the point (0.3, 0), the
   *  west one doesn't. The local tower is parked deep inside its own
   *  central reach. */
  function makeArrayed() {
    const { root, neck, dish } = buildTower();
    const sat = Satellite.fromObject3D(root);
    neck.rotation.y = Math.PI;   // the model pose of bearing 0 (the neck mirrors yaw)
    dish.rotation.x = -1.0;
    sat.rig.currentYaw = 0;
    sat.rig.currentPitch = -1.0;
    sat.rig.targetYaw = 0;
    sat.rig.targetPitch = -1.0;
    sat.neighbours = [
      new DishRig({ originX: 0.5, originY: 0, coverageRadius: 0.55 }),   // covers (0.3, 0)
      new DishRig({ originX: -0.5, originY: 0, coverageRadius: 0.55 }),  // doesn't
    ];
    return { sat, neck, dish };
  }

  it('aimAll re-targets the local dish and every neighbour that covers the point', () => {
    const { sat } = makeArrayed();
    const west = sat.neighbours[1];
    west.currentYaw = 1.5;             // start pose — where it will stop
    west.currentPitch = -0.2;
    const p = cursorToSky(0.3, 0);     // cursor radius 0.3 — inside the local reach

    sat.aimAll(p.yaw, p.pitch);

    expect(sat.targetYaw).toBeCloseTo(p.yaw);                  // local covers → follows
    expect(sat.targetPitch).toBeCloseTo(p.pitch);
    expect(sat.neighbours[0].targetYaw).toBeCloseTo(p.yaw);    // 0.2 away → follows
    expect(sat.neighbours[0].targetPitch).toBeCloseTo(p.pitch);
    expect(west.targetYaw).toBeCloseTo(1.5);                   // 0.8 away → stops where it is
    expect(west.targetPitch).toBeCloseTo(-0.2);
  });

  it('the local dish stops where it is once the cursor leaves its reach', () => {
    const { sat } = makeArrayed();
    const p = cursorToSky(0.8, 0);       // cursor radius 0.8 — beyond the local reach (0.75)

    sat.aimAll(p.yaw, p.pitch);

    expect(sat.targetYaw).toBeCloseTo(0);                      // stops where it is (currentYaw)
    expect(sat.targetPitch).toBeCloseTo(-1.0);                 // stops where it is (currentPitch)
    expect(sat.neighbours[0].targetYaw).toBeCloseTo(p.yaw);    // the east neighbour reaches it
    expect(sat.neighbours[0].targetPitch).toBeCloseTo(p.pitch);
    expect(sat.neighbours[1].targetYaw).toBeCloseTo(0);        // fresh rig: stops at start pose
  });

  it('a dish that loses the cursor decelerates smoothly with momentum', () => {
    const { sat } = makeArrayed();
    // Give the dish a velocity (it was tracking the cursor)
    sat.rig.velYaw = 0.5;
    sat.rig.velPitch = -0.2;
    const p = cursorToSky(0.8, 0);       // cursor leaves the local reach

    sat.aimAll(p.yaw, p.pitch);          // target becomes current position

    // The dish should decelerate, not stop instantly
    expect(sat.rig.velYaw).toBe(0.5);    // velocity unchanged by aimAll
    expect(sat.rig.velPitch).toBe(-0.2);

    // After a few ticks, velocity decays through damping
    for (let i = 0; i < 10; i++) sat._update(1 / 60);
    expect(Math.abs(sat.rig.velYaw)).toBeLessThan(0.5);
    expect(Math.abs(sat.rig.velPitch)).toBeLessThan(0.2);
  });

  it('_update ticks every neighbour rig alongside the local tower', () => {
    const { sat } = makeArrayed();
    const [a, b] = sat.neighbours;
    a.aimAt(0, 0);         // its own start pose: no motion
    b.aimAt(2.6, -0.5);    // a step away from its pose — must slew
    const before = b.currentYaw;

    for (let i = 0; i < 10; i++) sat._update(1 / 60);   // momentum builds from rest

    expect(b.currentYaw - before).toBeGreaterThan(0.01);   // physics ran on the neighbour
    expect(a.isRotating()).toBe(false);                    // and only where it should
  });

  it('isAnyDishAimedAt and aimedDishCount span the local dish and the neighbours', () => {
    const { sat, neck, dish } = makeArrayed();
    neck.rotation.y = Math.PI;                // bearing 0 (the neck mirrors yaw)
    dish.rotation.x = -0.5;
    // Neighbour 0 at (0.3, -0.5); neighbour 1 far off.
    sat.neighbours[0].currentYaw = 0.3;
    sat.neighbours[0].currentPitch = -0.5;
    sat.neighbours[1].currentYaw = 2.0;
    sat.neighbours[1].currentPitch = -0.5;

    // A tolerance wide enough to admit both the local dish and neighbour 0.
    expect(sat.aimedDishCount(0, -0.5, 0.4)).toBe(2);
    expect(sat.isAnyDishAimedAt(0, -0.5, 0.4)).toBe(true);

    // Tighter: only the local dish is close enough.
    expect(sat.aimedDishCount(0, -0.5, 0.2)).toBe(1);
    expect(sat.isAnyDishAimedAt(0, -0.5, 0.2)).toBe(true);

    // Nowhere near anything.
    expect(sat.aimedDishCount(3, -0.1, 0.05)).toBe(0);
    expect(sat.isAnyDishAimedAt(3, -0.1, 0.05)).toBe(false);
  });

  it('aimedDishCount with no neighbours counts just the local dish', () => {
    const { root, neck, dish } = buildTower();
    const sat = Satellite.fromObject3D(root);
    neck.rotation.y = Math.PI - 1;   // boresight at game bearing 1
    dish.rotation.x = -0.3;

    expect(sat.aimedDishCount(1, -0.3, 0.1)).toBe(1);
    expect(sat.aimedDishCount(1.5, -0.3, 0.1)).toBe(0);
  });

  // ── Multi-dish scan aggregation ──────────────────────────

  /** A scan setup aimed (or not) by hand: local tower plus one neighbour,
   *  a target at (0, -0.5) with a 3 s scan and a wide tolerance. */
  function makeScan({ localAimed, neighbourAimed }) {
    const { root, neck, dish } = buildTower();
    const sat = Satellite.fromObject3D(root);
    const yaw   = localAimed ? 0 : 2.0;
    const pitch = localAimed ? -0.5 : -0.2;
    neck.rotation.y = Math.PI - yaw;   // the model pose of game bearing `yaw`
    dish.rotation.x = pitch;
    sat.rig.currentYaw = yaw;      // frozen pose — no target set, nothing slews
    sat.rig.currentPitch = pitch;
    sat.rig.targetYaw = yaw;
    sat.rig.targetPitch = pitch;

    const neighbour = new DishRig({ coverageRadius: 1 });   // reach is irrelevant here
    neighbour.currentYaw   = neighbourAimed ? 0 : 2.0;
    neighbour.currentPitch = neighbourAimed ? -0.5 : -0.2;
    neighbour.targetYaw    = neighbour.currentYaw;
    neighbour.targetPitch  = neighbour.currentPitch;
    sat.neighbours = [neighbour];

    sat.scanTarget = { id: 1, yaw: 0, pitch: -0.5, tolerance: 0.15, scanTime: 3, scanned: false };
    sat.isScanning = true;
    return { sat };
  }

  it('one aimed dish scans at dt per tick', () => {
    const { sat } = makeScan({ localAimed: true, neighbourAimed: false });
    expect(sat.aimedDishCount(0, -0.5, 0.15)).toBe(1);

    sat._update(0.5);
    expect(sat.scanProgress).toBeCloseTo(0.5);
  });

  it('two aimed dishes scan at 2× dt per tick', () => {
    const { sat } = makeScan({ localAimed: true, neighbourAimed: true });
    expect(sat.aimedDishCount(0, -0.5, 0.15)).toBe(2);

    sat._update(0.5);
    expect(sat.scanProgress).toBeCloseTo(1.0);
  });

  it('a neighbour alone can carry the scan — local dish off target', () => {
    const { sat } = makeScan({ localAimed: false, neighbourAimed: true });
    expect(sat.aimedDishCount(0, -0.5, 0.15)).toBe(1);

    sat._update(0.5);
    expect(sat.scanProgress).toBeCloseTo(0.5);
  });

  it('no dish aimed pauses the scan and keeps progress', () => {
    const { sat } = makeScan({ localAimed: true, neighbourAimed: false });
    sat._update(0.4);
    expect(sat.scanProgress).toBeCloseTo(0.4);

    // Local dish drifts off target mid-scan.
    sat.neck.object3d.rotation.y = 2.0;
    sat._update(0.5);

    expect(sat.isScanning).toBe(false);
    expect(sat.scanProgress).toBeCloseTo(0.4);   // kept, not reset
  });

  it('completion marks the target scanned, stops scanning and flags _scanComplete', () => {
    const { sat } = makeScan({ localAimed: true, neighbourAimed: true });
    sat.scanProgress = 2.9;                       // one 2× tick finishes it

    sat._update(0.1);

    expect(sat.scanTarget.scanned).toBe(true);
    expect(sat.isScanning).toBe(false);
    expect(sat._scanComplete).toBe(true);
  });
});
