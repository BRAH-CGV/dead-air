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
// Food is in the office — the ration dispenser lives there.
//
// ── Interior layout mock-up ──
// The room is split in three with the furniture, using the models already
// in the game as stand-ins until better ones are found:
//
//   bedroom   back left: the bunk and a side table, with the lockers
//             against the left wall at the foot of the bed
//   storage   back right: three rows of shelves running front to back
//             (the last against the right wall), with aisles between
//   office    front: the desk end-on to the front wall with its chair and a
//             lamp, shelves along the wall, and a row of shelves out from
//             the left wall parting it from the bedroom
//
// The main paths stay open: in at the door and across the middle of the
// room, and from there round the end of the divider into the bedroom.
//
// The doorway is in the right wall, leading back toward the office.
// `doorOffset` slides it along the wall so BaseScene can line it up with
// the corridor. Only the storage shelves stand on the right wall, in the
// back half (z < −0.5): from there forward the metre inside the wall is
// clear, so the doorway works anywhere in the front half.
// ─────────────────────────────────────────────

export class LivingQuarters extends Room {
  /** On the bunk, from buildProps(). @type {Bed|null} */
  bed = null;

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

    // ── Bedroom ──
    // Back-left corner, its long side along the left wall.
    const bunk = this._spawnProp('model:bunk-bed', {
      name: 'Bunk', position: [-inX + 0.56, 0, -inZ + 1.02],
    });
    this.bed = bunk.addComponent(new Bed());

    const wood = this._own(new THREE.MeshStandardMaterial({ color: 0x4a3b2e, roughness: 0.85 }));
    this._addStaticBox('SideTable', [-1.3, 0.25, -3.5], [0.7, 0.5, 0.7], wood);

    // Three lockers in one model, against the left wall just past the foot
    // of the bunk, the doors facing into the room. Same model, scale and
    // turn as the airlock's suit locker: locker.glb's origin is 0.274 m
    // off-centre along its width, so turned to face +x at 0.9 scale it
    // reaches 0.9 m toward the back wall from the spawn point and 0.41 m
    // the other way.
    const bunkFoot = -inZ + 2.02;
    this._spawnProp('model:locker', {
      name: 'Lockers', position: [-inX + 0.22, 0, bunkFoot + 0.05 + 0.9], rotationY: Math.PI / 2, scale: 0.9,
    });

    // ── Storage ──
    // A shelf is 0.37 × 1.03 m, its open sides facing ±x. Three rows run
    // out from the back wall: one beside the bedroom, one down the middle,
    // one against the right wall and a shelf longer. The aisles between
    // are 0.8 m, and open at the front onto the middle of the room.
    const rows = [[0.35, 2], [1.52, 2], [inX - 0.2, 3]];   // x, shelves
    let shelf = 0;
    for (const [x, count] of rows) {
      for (let i = 0; i < count; i++) {
        this._spawnProp('model:shelf', { name: `StorageShelf_${++shelf}`, position: [x, 0, -3.35 + i * 1.05] });
      }
    }

    // ── Office ──
    // A row of shelves out from the left wall, between the bunk and the
    // desk; the way into the bedroom is past its end.
    [-inX + 0.52, -inX + 1.56].forEach((x, i) => {
      this._spawnProp('model:shelf', { name: `DividerShelf_${i + 1}`, position: [x, 0, 0.35], rotationY: Math.PI / 2 });
    });

    // The desk end-on to the front wall, the chair on its left, facing it.
    this._spawnProp('model:desk', { name: 'Desk', position: [-0.2, 0, 2.68], rotationY: -Math.PI / 2 });
    this._spawnProp('model:metal-chair', { name: 'DeskChair', position: [-1.45, 0, 2.67], rotationY: 1.3 });
    this._buildDeskLamp([-0.05, 0.745, 2.2]);

    // Shelves along the front wall, behind the desk's end.
    [-1.3, -0.26].forEach((x, i) => {
      this._spawnProp('model:shelf', { name: `OfficeShelf_${i + 1}`, position: [x, 0, inZ - 0.2], rotationY: Math.PI / 2 });
    });
  }

  /** A lamp on the desk: base, stem and a glowing shade. A glow, not a
   *  light — the light count is compiled into every lit shader — and drawn
   *  only, with no collider. `position` is on the desk top (0.745 m). */
  _buildDeskLamp(position) {
    const go = this._addGroup('DeskLamp');
    go.object3d.position.set(...position);

    const metal = this._own(new THREE.MeshStandardMaterial({ color: 0x2a2520, roughness: 0.5, metalness: 0.6 }));
    const shade = this._own(new THREE.MeshStandardMaterial({ color: 0x3a2a1a, emissive: 0xffb070, emissiveIntensity: 1.2 }));
    const base = new THREE.Mesh(this._own(new THREE.CylinderGeometry(0.08, 0.09, 0.02, 16)), metal);
    base.position.y = 0.01;
    const stem = new THREE.Mesh(this._own(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 8)), metal);
    stem.position.y = 0.17;
    const top = new THREE.Mesh(this._own(new THREE.CylinderGeometry(0.07, 0.12, 0.12, 16)), shade);
    top.position.y = 0.36;
    go.object3d.add(base, stem, top);
  }
}
