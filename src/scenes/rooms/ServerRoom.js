import * as THREE from 'three';
import { Room } from './Room.js';

// ─────────────────────────────────────────────
// ServerRoom  –  dark rack room, open from night 2
// ─────────────────────────────────────────────
// Where signals are processed and stored — and where the camera entity
// watches from (night 3). Kept deliberately dark: two dim LED-coloured
// point lights and no ambient of its own, so the scene's global ambient
// barely lifts it.
//
// The doorway is in the left wall, leading back toward the office.
// `doorOffset` slides it along the wall so BaseScene can line it up with
// the corridor.
// ─────────────────────────────────────────────

export class ServerRoom extends Room {
  /**
   * @param {import('../../core/Engine.js').Engine} engine
   * @param {object} [opts]
   * @param {number[]} [opts.position=[0,0,0]]
   * @param {THREE.Material} [opts.material]  Caller-owned; omit for the dark default
   * @param {number} [opts.doorOffset=0]      Doorway position along the left wall (z)
   */
  constructor(engine, { position = [0, 0, 0], material, doorOffset = 0 } = {}) {
    const ownsMaterial = !material;
    super(engine, {
      name: 'ServerRoom',
      width: 6, depth: 8, height: 3, wallThick: 0.2,
      position,
      material: material ?? new THREE.MeshStandardMaterial({ color: 0x1b2128, roughness: 0.9 }),
      openings: [{ side: 'left', width: 1.2, height: 2.2, offset: doorOffset }],
    });
    if (ownsMaterial) this._own(this.material);
  }

  buildDoors() {
    this.addDoor('ToMainOffice', 'left', 'MainOffice');
  }

  buildLighting() {
    const status = new THREE.PointLight(0x3a6bff, 1.2, 6, 2);
    status.position.set(1.5, 2.2, -2.5);
    this._addGroup('StatusLEDs').object3d.add(status);

    const warning = new THREE.PointLight(0xff2a1a, 0.8, 5, 2);
    warning.position.set(1.5, 0.6, 2.5);
    this._addGroup('WarningLED').object3d.add(warning);
  }

  buildProps() {
    // One row along the right wall, set off it the same way as the office
    // rack (1.35 m in from the inner face, facing into the room).
    const rackX = this.width / 2 - this.wallThick / 2 - 1.35;
    [-2.6, -1.2, 0.2, 1.6].forEach((z, i) => {
      this._spawnProp('model:server-rack', {
        name: `ServerRack_${i + 1}`, position: [rackX, 0, z], rotationY: -Math.PI / 2, scale: 0.333,
      });
    });

    // Console against the back wall, facing the racks' aisle.
    this._spawnProp('model:radar-terminal', {
      name: 'ServerConsole', position: [-1, 0, -2.45], scale: 0.478,
    });
  }
}
