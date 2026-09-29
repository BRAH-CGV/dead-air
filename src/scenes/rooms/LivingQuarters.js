import * as THREE from 'three';
import { Room } from './Room.js';
import { Bed } from '../../components/Bed.js';

// ─────────────────────────────────────────────
// LivingQuarters  –  the bedroom
// ─────────────────────────────────────────────
// Where the day goes: the player works the night shift and sleeps through
// the daylight. The "safe" room — but never truly safe.
//
// The bunk is the bed: its Bed interactable (`room.bed`) is how the player
// sleeps through the day. The scene wires the controller and fade into it.
// Around it, a row of lockers and a desk with a chair. Food is in the
// office — the ration dispenser lives there.
//
// The doorway is in the right wall, leading back toward the office.
// `doorOffset` slides it along the wall so BaseScene can line it up with
// the corridor. The furniture keeps to the left half, leaving the metre
// inside the right wall clear wherever the doorway lands.
//
// `threatAnchors.corridorEnd` (room-local) is just inside that doorway:
// the far end of the corridor seen from the office, the Sleep Demon's
// second stage.
// ─────────────────────────────────────────────

export class LivingQuarters extends Room {
  /** On the bunk, from buildProps(). @type {Bed|null} */
  bed = null;
  /** Room-local [x, y, z] spots for monsters, feet on the floor. */
  threatAnchors = {};

  /**
   * @param {import('../../core/Engine.js').Engine} engine
   * @param {object} [opts]
   * @param {number[]} [opts.position=[0,0,0]]
   * @param {THREE.Material} [opts.material]  Caller-owned; omit for the warm default
   * @param {number} [opts.doorOffset=0]      Doorway position along the right wall (z)
   */
  constructor(engine, { position = [0, 0, 0], material, doorOffset = 0 } = {}) {
    const ownsMaterial = !material;
    super(engine, {
      name: 'LivingQuarters',
      width: 6, depth: 8, height: 3, wallThick: 0.2,
      position,
      material: material ?? new THREE.MeshStandardMaterial({ color: 0x3b3530, roughness: 0.95 }),
      openings: [{ side: 'right', width: 1.2, height: 2.2, offset: doorOffset }],
    });
    if (ownsMaterial) this._own(this.material);
    const inX = this.width / 2 - this.wallThick / 2;
    this.threatAnchors = { corridorEnd: [inX - 0.5, 0, doorOffset] };
  }

  buildDoors() {
    this.addDoor('ToMainOffice', 'right', 'MainOffice');
  }

  buildLighting() {
    // No shadows: the office ceiling light already casts them, and
    // shadow-casting lights are the expensive kind.
    const lampGO = this._addGroup('CeilingLamp');
    const lamp = new THREE.PointLight(0xffc48a, 6, 10, 1.4);
    lamp.position.set(0, 2.7, 0);
    lampGO.object3d.add(lamp);

    const shade = new THREE.Mesh(
      this._own(new THREE.CylinderGeometry(0.25, 0.3, 0.06, 20)),
      this._own(new THREE.MeshStandardMaterial({ color: 0x2a2520, emissive: 0xffb070, emissiveIntensity: 1.2 })),
    );
    shade.position.set(0, 2.94, 0);
    lampGO.object3d.add(shade);
  }

  buildProps() {
    const inX = this.width / 2 - this.wallThick / 2;   // inner face of the side walls
    const inZ = this.depth / 2 - this.wallThick / 2;   // inner face of back/front

    // Back-left corner, its long side along the left wall.
    const bunk = this._spawnProp('model:bunk-bed', {
      name: 'Bunk', position: [-inX + 0.56, 0, -inZ + 1.02],
    });
    this.bed = bunk.addComponent(new Bed());

    // Three lockers in one model, along the left wall with the doors facing
    // into the room. Same model, scale and turn as the airlock's suit
    // locker, so the same +0.25 m nudge centres it — here on z = 0.3.
    this._spawnProp('model:locker', {
      name: 'Lockers', position: [-inX + 0.22, 0, 0.3 + 0.25], rotationY: Math.PI / 2, scale: 0.9,
    });

    // Front-left: a desk against the front wall and its chair.
    this._spawnProp('model:desk', { name: 'Desk', position: [-1.4, 0, inZ - 0.42], rotationY: Math.PI });
    this._spawnProp('model:metal-chair', { name: 'DeskChair', position: [-1.3, 0, inZ - 1.18], rotationY: 0.25 });
  }
}
