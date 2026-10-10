import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';
import { Component } from '../core/Component.js';
import { Pickupable } from '../components/Pickupable.js';
import { packGroups } from '../core/PhysicsLayers.js';

// ─────────────────────────────────────────────
// Drive  –  Physical hard drive (pickup-able small cube)
// ─────────────────────────────────────────────
// A small box representing a hard drive. Placed near the desk as a physics
// object the player can pick up and carry to the drive reader. When a signal
// is saved to it, the material turns green (later this will be an indicator
// light on a proper model).
//
// The drive is a dynamic physics body created in _init() (the engine
// lifecycle hook). Before _init it is a plain visual with a Pickupable
// marker; after _init it has a rigid body and collider. Gravity is on from
// the start: the drive rests on the floor (or desk) until picked up, and
// falls when dropped.
//
//   const drive = new Drive('Drive_1');
//   drive.object3d.position.set(1.2, 0.02, -2.0);
//   // After _init runs (engine lifecycle):
//   drive.setSaved(true);        // turns green
//   drive.enablePhysics();       // gravity on, rest damping (the default)
//   drive.disablePhysics();      // floats in place — scripted states
//   drive.makeKinematic();       // locked in place (e.g. in the reader)
//
// Owns its geometry and material; dispose() frees them.
// ─────────────────────────────────────────────

/** Default colour — dark grey plastic. */
const DEFAULT_COLOR = 0x3a3a3a;

/** Emissive colour when a signal has been saved — green indicator. */
const SAVED_EMISSIVE = 0x22cc44;
const SAVED_EMISSIVE_INTENSITY = 1.5;

/** Emissive colour when the anomalous (evil) signal is stored — red. */
const CORRUPTED_EMISSIVE = 0xcc2222;

/** Doom glow: the red drive pulses brighter as the silence timer runs
 *  down. The curve is exponential (pow 6) so the glow stays subdued for
 *  most of the countdown, then spikes dramatically in the final seconds.
 *  The PointLight is a single shared light on GameplaySystems — created
 *  once at scene build so the light count never changes (adding/removing
 *  lights recompiles every lit shader). Drive only computes the level. */
const DOOM_BASE_INTENSITY = 1.5;
const DOOM_PEAK_INTENSITY = 2400.0;
export const DOOM_LIGHT_COLOR = 0xff2200;
export const DOOM_LIGHT_MAX_DISTANCE = 5;
/** Exponent for the doom curve — higher = sharper end-spike. */
const DOOM_CURVE = 6;
/** Seconds the doom glow takes to fade out after the drive is wiped. */
export const DOOM_FADE_SECONDS = 3;

/**
 * Collision groups for the drive: member of SHELF (not DEFAULT), so it passes
 * through the shelf's player-only envelope box while still resting on the
 * SHELF-layer boards. Filters DEFAULT + SHELF to stay solid against the
 * environment and shelf surfaces.
 */
const DRIVE_GROUPS = packGroups(['SHELF'], ['DEFAULT', 'SHELF']);

/**
 * Collision groups while socketed (kinematic): SHELF membership keeps the
 * interaction ray finding the drive, but the filter drops DEFAULT so a drive
 * seated inside a host (the drive boxes) cannot shove its dynamic collider
 * around — a kinematic body overlapping a dynamic one pushes it out.
 */
const KINEMATIC_GROUPS = packGroups(['SHELF'], ['SHELF']);

/** Per-frame ticker for the doom-glow fade-out. A Component so the
 *  engine's update pass reaches it; the fade state itself lives on the
 *  Drive, like the Pickupable above this is pure data. */
class DoomGlowFade extends Component {
  _drive;
  constructor(drive) {
    super();
    this._drive = drive;
  }
  onUpdate(dt) { this._drive._tickDoomFade(dt); }
}

export class Drive extends GameObject {
  /** @type {THREE.Mesh} */
  _mesh;
  /** @type {THREE.MeshStandardMaterial} */
  _material;

  /** Marker used by generic snap receivers to accept only drives. */
  isDrive = true;

  /** Whether this drive currently shows the "saved" indicator. */
  saved = false;

  /** Set while the anomalous (red) signal is stored on it — the indicator
   *  shows red, and a red drive never counts towards the night quota
   *  (DriveBoxDock). Deleted the same way as a green one: wipe it at the
   *  ServerRoom console (setSaved(false)). */
  corrupted = false;

  /** Set when makeKinematic() is called before _init builds a body — a
   *  socket receiver attaching the drive during scene build. _init honours
   *  it by finishing on a kinematic body seated at the attached pose. */
  _socketedAtInit = false;

  // ── Doom glow state ──
  /** Emissive intensity the doom glow last set — where the fade starts. */
  _doomEmissive = 0;
  /** PointLight intensity the doom glow last set (for the shared light). */
  _doomLightLevel = 0;
  /** Peak light level at fade start — the fade scales this by t each frame. */
  _doomLightPeak = 0;
  /** Seconds left in the post-wipe glow fade, or null when not fading. */
  _doomFadeRemaining = null;
  /** Total seconds of the fade now running. */
  _doomFadeDuration = 0;

  /**
   * @param {string} [name]
   * @param {object} [opts]
   * @param {number[]} [opts.size]  Full metres [w, h, d].
   */
  constructor(name = 'Drive', { size = [0.08, 0.02, 0.12] } = {}) {
    super(name);
    this._size = size;
    this._build();
    // The Pickupable is pure data, so it exists before _init: a snap
    // receiver can attach the drive at build time and still swap its
    // prompt and install the detach-on-pickup hook.
    this.addComponent(new Pickupable());
    // Ticks the doom-glow fade-out; also pure data, same reasoning.
    this.addComponent(new DoomGlowFade(this));
  }

  // ── Lifecycle ──────────────────────────────────────────────

  /** Called by the engine when the scene graph initialises. Creates the
   *  dynamic rigid body and collider, registers with the engine maps, and
   *  attaches a Pickupable component. */
  _init(scene, world) {
    super._init(scene, world);

    const engine = scene.userData.engine;
    if (!engine?.RAPIER) return;
    const RAPIER = engine.RAPIER;
    // Use world position for the rigid body, since Rapier works in world space.
    // The drive's object3d.position is local (relative to the parent room), so
    // we must convert to world space before creating the body.
    const worldPos = new THREE.Vector3();
    this.object3d.getWorldPosition(worldPos);

    // Dynamic body with gravity — the drive rests where it is placed and
    // falls when dropped. Light damping on both axes so a nudge slides it
    // to a stop instead of spinning it forever; CCD keeps the thin, light
    // box from tunnelling through the floor when it is kicked or dropped.
    this.rigidBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(worldPos.x, worldPos.y, worldPos.z)
        .setLinearDamping(0.5)
        .setAngularDamping(1.0)
        .setGravityScale(1)
        .setCcdEnabled(true),
    );

    const halfSize = [this._size[0] / 2, this._size[1] / 2, this._size[2] / 2];
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(...halfSize)
        .setFriction(0.6)
        .setRestitution(0.1)
        .setDensity(800)
        .setCollisionGroups(DRIVE_GROUPS),
      this.rigidBody,
    );
    this.colliders = [this.collider];

    // Register with engine maps (same pattern as Engine._attachPhysics).
    engine._bodyToGO.set(this.rigidBody.handle, this);
    engine.rigidBodyMap.set(this.rigidBody.handle, this);

    // A drive socketed at build time asked for kinematic before it had a
    // body. The dynamic body now sits at the seated world pose, so rebuild
    // it as kinematic (KINEMATIC_GROUPS) in place.
    if (this._socketedAtInit) {
      this._socketedAtInit = false;
      this.makeKinematic();
    }
  }

  // ── Physics helpers (used by PickupSystem / drive reader) ──

  /** Restore normal physics — gravity on, rest damping. The drive falls
   *  and settles (the default body state). */
  enablePhysics() {
    if (!this.rigidBody) return;
    this.rigidBody.setGravityScale(1, true);
    this.rigidBody.setLinearDamping(0.5, true);
    this.rigidBody.setAngularDamping(1.0, true);
  }

  /** Disable gravity and raise damping — the drive floats in place.
   *  A scripted-state helper; the normal resting state has gravity on. */
  disablePhysics() {
    if (!this.rigidBody) return;
    this.rigidBody.setGravityScale(0, true);
    this.rigidBody.setLinearDamping(5.0, true);
    this.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /** Switch to a kinematic body — locked in place (e.g. inserted in reader). */
  makeKinematic() {
    // Before _init there is no body to convert — defer instead of dropping
    // the request: _init builds the dynamic body and then runs this for
    // real, so a drive attached at build time lands kinematic in place.
    if (!this.rigidBody || !this.world) {
      this._socketedAtInit = true;
      return;
    }
    const RAPIER = this.scene?.userData?.engine?.RAPIER;
    if (!RAPIER) return;
    const t = this.rigidBody.translation();
    const r = this.rigidBody.rotation();
    const engine = this.scene?.userData?.engine;
    const oldHandle = this.rigidBody.handle;
    // Remove old colliders before changing body type.
    for (const c of this.colliders) {
      try { this.world.removeCollider(c, true); } catch (_) { /* already gone */ }
    }
    try { this.world.removeRigidBody(this.rigidBody); } catch (_) { /* already gone */ }
    // Remove old handle from engine maps to prevent stale entries.
    if (engine) {
      engine._bodyToGO.delete(oldHandle);
      engine.rigidBodyMap.delete(oldHandle);
    }

    this.rigidBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(t.x, t.y, t.z)
        .setRotation(r),
    );
    const halfSize = [this._size[0] / 2, this._size[1] / 2, this._size[2] / 2];
    this.collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(...halfSize)
        .setFriction(0.6).setRestitution(0.1).setDensity(800)
        .setCollisionGroups(KINEMATIC_GROUPS),
      this.rigidBody,
    );
    this.colliders = [this.collider];

    if (engine) {
      engine._bodyToGO.set(this.rigidBody.handle, this);
      engine.rigidBodyMap.set(this.rigidBody.handle, this);
    }
  }

  /** Switch back to a dynamic body (e.g. after ejecting from reader). */
  makeDynamic() {
    // A bodyless makeDynamic undoes a pending makeKinematic deferral.
    if (!this.rigidBody || !this.world) {
      this._socketedAtInit = false;
      return;
    }
    const RAPIER = this.scene?.userData?.engine?.RAPIER;
    if (!RAPIER) return;
    const t = this.rigidBody.translation();
    const engine = this.scene?.userData?.engine;
    const oldHandle = this.rigidBody.handle;
    // Remove old colliders before changing body type.
    for (const c of this.colliders) {
      try { this.world.removeCollider(c, true); } catch (_) { /* already gone */ }
    }
    try { this.world.removeRigidBody(this.rigidBody); } catch (_) { /* already gone */ }
    // Remove old handle from engine maps to prevent stale entries.
    if (engine) {
      engine._bodyToGO.delete(oldHandle);
      engine.rigidBodyMap.delete(oldHandle);
    }

    this.rigidBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(t.x, t.y, t.z)
        .setLinearDamping(0.5)
        .setAngularDamping(1.0)
        .setGravityScale(1)
        .setCcdEnabled(true),
    );
    const halfSize = [this._size[0] / 2, this._size[1] / 2, this._size[2] / 2];
    this.collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(...halfSize)
        .setFriction(0.6).setRestitution(0.1).setDensity(800)
        .setCollisionGroups(DRIVE_GROUPS),
      this.rigidBody,
    );
    this.colliders = [this.collider];

    if (engine) {
      engine._bodyToGO.set(this.rigidBody.handle, this);
      engine.rigidBodyMap.set(this.rigidBody.handle, this);
    }
  }

  // ── Visual ─────────────────────────────────────────────────

  /** Turn the indicator on — green for a saved signal, red when that
   *  signal was the anomalous one ({ corrupted: true }). Turning it off
   *  clears both flags, so a wiped drive keeps no trace of the red signal. */
  setSaved(saved, { corrupted = false } = {}) {
    // Any state change stops a running glow fade — the new look stands.
    this._doomFadeRemaining = null;
    this.saved = saved;
    this.corrupted = saved && corrupted;
    if (this.saved) {
      this._material.emissive.setHex(this.corrupted ? CORRUPTED_EMISSIVE : SAVED_EMISSIVE);
      this._material.emissiveIntensity = SAVED_EMISSIVE_INTENSITY;
    } else {
      this._material.emissive.setHex(0x000000);
      this._material.emissiveIntensity = 0;
    }
  }

  /** Reset to the default unmarked colour (drive ejected). */
  setEjected() {
    this.setSaved(false);
  }

  /** Ramp the red doom glow. `fraction` is 0..1 where 0 is the dim base
   *  and 1 is the blinding peak (the silence timer is about to expire).
   *  Computes the PointLight intensity but does NOT create a light — a
   *  single shared light on GameplaySystems is managed by EvilSignal,
   *  so the scene's light count stays fixed (no shader recompiles). */
  setDoomGlow(fraction) {
    if (!this._material) return;
    const t = Math.max(0, Math.min(1, fraction));
    // Exponential curve: stays low for most of the countdown, then
    // spikes sharply in the final seconds before the game ends.
    const curved = Math.pow(t, DOOM_CURVE);
    const intensity = DOOM_BASE_INTENSITY + curved * (DOOM_PEAK_INTENSITY - DOOM_BASE_INTENSITY);
    this._material.emissive.setHex(CORRUPTED_EMISSIVE);
    this._material.emissiveIntensity = intensity;
    this._doomEmissive = intensity;  // remembered by the fade-out

    // Light level for the shared light (EvilSignal reads this each frame).
    this._doomLightLevel = curved * 40;  // 0 → 40 candela at peak
    this._doomLightPeak = this._doomLightLevel;
  }

  /** Remove the doom glow. Called when the night resets or the game-over
   *  sequence ends. The shared PointLight is managed by EvilSignal — this
   *  only resets the material and the stored levels. */
  clearDoomGlow() {
    this._doomFadeRemaining = null;
    this._doomEmissive = 0;
    this._doomLightLevel = 0;
  }

  /** Fade the doom glow out over `seconds` instead of cutting it — the
   *  wiped drive keeps dying down for a few seconds. The wipe resets the
   *  material, so the fade re-applies the red at the intensity the ramp
   *  had reached and eases it to zero. */
  startDoomFadeOut(seconds = DOOM_FADE_SECONDS) {
    if (!this._material) return;
    if (!(this._doomEmissive > 0)) { this.clearDoomGlow(); return; }
    this._doomFadeDuration = Math.max(0.001, seconds);
    this._doomFadeRemaining = this._doomFadeDuration;
    this._doomLightPeak = this._doomLightLevel;  // capture for the fade curve
  }

  /** Per-frame fade step (ticked by the DoomGlowFade component). */
  _tickDoomFade(dt) {
    if (!this._material || this._doomFadeRemaining === null) return;
    this._doomFadeRemaining -= dt;
    if (this._doomFadeRemaining <= 0) {
      // Faded out: back to the unmarked look, light level zero.
      this.clearDoomGlow();
      this._material.emissive.setHex(0x000000);
      this._material.emissiveIntensity = 0;
      return;
    }
    // Re-apply the red (the wipe darkened it) and ease it down.
    const t = this._doomFadeRemaining / this._doomFadeDuration;  // 1 → 0
    this._material.emissive.setHex(CORRUPTED_EMISSIVE);
    this._material.emissiveIntensity = this._doomEmissive * t;
    // Scale the stored light level down — EvilSignal reads it each frame
    // and applies it to the shared doom light.
    this._doomLightLevel = this._doomLightPeak * t;
  }

  /** Free the geometry, material, and physics resources this drive built. */
  dispose() {
    this.clearDoomGlow();
    this._mesh?.geometry?.dispose();
    this._material?.dispose();
    // Physics bodies are owned by the Rapier world — the engine frees the
    // whole world on scene teardown, so we don't remove individual bodies
    // here. Just clear our references.
    this.rigidBody = null;
    this.collider = null;
    this.colliders = [];
  }

  _build() {
    this._material = new THREE.MeshStandardMaterial({
      color: DEFAULT_COLOR,
      roughness: 0.6,
      metalness: 0.3,
      emissive: 0x000000,
      emissiveIntensity: 0,
    });
    this._mesh = new THREE.Mesh(
      new THREE.BoxGeometry(...this._size),
      this._material,
    );
    this._mesh.name = 'DriveMesh';
    this._mesh.castShadow = true;
    this._mesh.receiveShadow = true;
    this.object3d.add(this._mesh);
  }
}
