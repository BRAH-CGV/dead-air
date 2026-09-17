import * as THREE from 'three';
import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// SkyFollow  –  keeps a sky dome centred on the camera
// ─────────────────────────────────────────────
// A sky dome has a finite radius, so left at the world origin the player can
// walk — or, with the noclip camera, fly — toward its edge and eventually
// through it. Recentring it on the camera every frame makes it read as
// infinitely distant. Position only: rotating it would drag the stars along
// with the player's view.
//
//   sky.addComponent(new SkyFollow());
// ─────────────────────────────────────────────

export class SkyFollow extends Component {
  /** Reused across frames — this runs every frame, on every frame. */
  _worldPos = new THREE.Vector3();

  onLateUpdate(dt) {
    const camera = this.gameObject?.scene?.userData?.engine?.camera;
    if (!camera) return;

    // getWorldPosition, not .position: the camera is normally a child of the
    // player (so its local position is just an eye offset), and the debug fly
    // camera reparents that same camera onto the scene root.
    camera.getWorldPosition(this._worldPos);
    this.transform.position.copy(this._worldPos);

    if (this.gameObject.skyUniforms) {
      this.gameObject.skyUniforms.uTime.value += dt;
    }
  }
}
