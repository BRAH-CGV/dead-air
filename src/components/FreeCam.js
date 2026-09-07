import * as THREE from 'three';
import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// FreeCam  –  Fly-around camera control
// ─────────────────────────────────────────────
// V toggles flight. E ascends, Q descends, WASD moves relative to view.
// While active, the regular first-person movement component stands down.
// ─────────────────────────────────────────────

export class FreeCam extends Component {
  constructor(opts = {}) {
    super();
    this.speed = opts.speed ?? 10;
    this.toggleKey = opts.toggleKey ?? 'KeyV';
    this.active = false;
    this.blocksFirstPersonController = true;
    this._toggleHeld = false;
        
    // Scratch vectors
    this._moveDir = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
  }
  
  onUpdate(_dt) {
    if (!this.gameObject) return;
      
    const engine = this.gameObject.scene?.userData.engine;
    if (!engine) return;
      
    const { input } = engine;
      
    // Toggle freecam with V (press once to toggle on/off)
    const toggleHeld = !!input.keys[this.toggleKey];
    const togglePressed = !!input.pressed?.[this.toggleKey] || (toggleHeld && !this._toggleHeld);
    this._toggleHeld = toggleHeld;
    
    if (togglePressed) {
      this._setActive(!this.active);
      console.log(`[FreeCam] ${this.active ? 'ENABLED' : 'DISABLED'} - fly around with WASD+E/Q`);
    }
  }
    
  onFixedUpdate(dt) {
    if (!this.gameObject || !this.camera || !this.active) return;
      
    const engine = this.gameObject.scene?.userData.engine;
    const rb = this.gameObject.rigidBody;
    if (!engine || !rb) return;
      
    const { input, keyBinds } = engine;
    const wantAscend = !!input.keys['KeyE'];
    const wantDescend = !!input.keys['KeyQ'];
      
    // Get camera forward and right vectors
    this._fwd.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this._right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
      
    // Build movement direction
    this._moveDir.set(0, 0, 0);
      
    // WASD for horizontal movement
    if (input.keys[keyBinds.forward]) this._moveDir.add(this._fwd);
    if (input.keys[keyBinds.back]) this._moveDir.sub(this._fwd);
    if (input.keys[keyBinds.right]) this._moveDir.add(this._right);
    if (input.keys[keyBinds.left]) this._moveDir.sub(this._right);
      
    // E/Q for vertical movement
    if (wantAscend) this._moveDir.y += 1;
    if (wantDescend) this._moveDir.y -= 1;
      
    // Normalize and apply speed
    if (this._moveDir.length() > 0) {
      this._moveDir.normalize().multiplyScalar(this.speed * dt);
        
      const t = rb.translation();
      rb.setNextKinematicTranslation({
        x: t.x + this._moveDir.x,
        y: t.y + this._moveDir.y,
        z: t.z + this._moveDir.z,
      });
    }
  }
    
  _setActive(active) {
    this.active = active;
    this.gameObject?.rigidBody?.setGravityScale(active ? 0 : 1, true);
  }
    
  onDestroy() {
    // Re-enable gravity when component is destroyed
    this._setActive(false);
  }
}
