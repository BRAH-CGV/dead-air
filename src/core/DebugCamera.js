import * as THREE from 'three';

// ─────────────────────────────────────────────
// DebugCamera  –  free-fly spectator camera
// ─────────────────────────────────────────────
// A noclip camera for inspecting the level the way the renderer sees it. Press
// the debug key and the camera detaches from the player Object3D onto the scene
// root — at exactly the pose it had, so the view doesn't jump — and every
// component on the player is suspended (Component.enabled = false): movement,
// mouse look and interaction freeze in place mid-stride, and the player's
// rigid body stays where it is because its fixed-step driver is one of those
// suspended components.
//
// Mouse steers the same YXZ Euler rig the first-person controller uses. WASD
// flies along the view direction (forward includes pitch — look down to
// descend), Space rises, C sinks, Shift multiplies speed. There is no physics
// anywhere in here — no rigid body, no collider, no raycast — which is what
// makes it noclip.
//
// Toggling off reverses everything: the camera re-mounts on the player and its
// local transform is zeroed, so the view snaps back to the player's eyes; the
// first-person controller re-aims the camera from its own frozen yaw/pitch on
// the next frame.
// ─────────────────────────────────────────────

export class DebugCamera {
  /** @type {THREE.PerspectiveCamera} */
  camera;
  /** @type {THREE.Object3D} the scene root the camera flies under */
  sceneRoot;
  /** @type {import('./GameObject.js').GameObject|null} camera's owner while flying */
  _player = null;
  /** @type {THREE.Object3D|null} camera's normal parent, saved by enable() */
  _parent = null;

  active = false;

  speed       = 8;      // m/s, multiplied by boost while Shift is held
  boost       = 4;
  sensitivity = 0.002;  // rad per mouse px — matches the player's default

  pitch = 0;
  yaw   = 0;

  // Scratch vector — no per-frame allocations.
  _dir = new THREE.Vector3();

  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {THREE.Object3D} sceneRoot
   */
  constructor(camera, sceneRoot) {
    this.camera    = camera;
    this.sceneRoot = sceneRoot;
  }

  /**
   * Detach the camera from [player] and freeze the player in place.
   * @param {import('./GameObject.js').GameObject|null} player
   */
  enable(player) {
    if (this.active) return;
    this._player = player ?? null;
    this.active  = true;

    // Inherit the camera's current aim (the controller writes YXZ Euler
    // straight onto it), so the switch is seamless.
    this.yaw   = this.camera.rotation.y;
    this.pitch = this.camera.rotation.x;

    // Reparent onto the scene root, keeping the world transform — .attach()
    // is the move-preserving counterpart of Object3D.add.
    this._parent = this.camera.parent;
    this.sceneRoot.attach(this.camera);

    if (player) {
      for (const c of player.components) c.enabled = false;
    }
  }

  /** Reattach the camera to the player and resume normal play. */
  disable() {
    if (!this.active) return;
    this.active = false;

    if (this._player) {
      for (const c of this._player.components) c.enabled = true;
    }

    // Plain re-mount, then zero the local transform: the player never moved,
    // so the eye goes back where it was — not where the fly camera ended up.
    // The controller re-aims the camera from its own yaw/pitch next frame,
    // and rewrites position.y as its eye-lift decays.
    if (this._parent) {
      this._parent.add(this.camera);
      this.camera.position.set(0, 0, 0);
      this.camera.rotation.set(0, 0, 0);
    }

    this._parent = null;
    this._player = null;
  }

  /**
   * Toggle the fly camera on/off.
   * @param {import('./GameObject.js').GameObject|null} player
   */
  toggle(player) {
    this.active ? this.disable() : this.enable(player);
  }

  /** Mouse look + flight. Call once per rendered frame while active.
   *  @param {number} dt
   *  @param {Object} input      Engine.input — mouse dx/dy accumulate here.
   *  @param {Object} keyBinds   Engine.keyBinds — reuse the player's binds. */
  update(dt, input, keyBinds) {
    if (!this.active) return;

    // ── Mouse look (same math as the first-person controller) ──
    if (input.locked) {
      this.yaw   -= input.mouse.dx * this.sensitivity;
      this.pitch -= input.mouse.dy * this.sensitivity;
      this.pitch  = Math.max(-Math.PI / 2 + 0.01,
                    Math.min( Math.PI / 2 - 0.01, this.pitch));
    }
    this.camera.rotation.set(this.pitch, this.yaw, 0);

    // ── Flight axes (vertical reuses the player's jump/crouch binds) ──
    const fwd   = Number(!!input.keys[keyBinds.forward]) - Number(!!input.keys[keyBinds.back]);
    const right = Number(!!input.keys[keyBinds.right])   - Number(!!input.keys[keyBinds.left]);
    const up    = Number(!!input.keys[keyBinds.jump])    - Number(!!input.keys[keyBinds.crouch]);

    const boosted = input.keys['ShiftLeft'] || input.keys['ShiftRight'];
    const speed   = this.speed * (boosted ? this.boost : 1);

    // Forward follows the full pitched view direction; strafe stays level.
    this._dir.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.camera.position.addScaledVector(this._dir, fwd * speed * dt);

    this._dir.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this.camera.position.addScaledVector(this._dir, right * speed * dt);

    this.camera.position.y += up * speed * dt;
  }
}
