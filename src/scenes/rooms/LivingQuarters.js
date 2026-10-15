import * as THREE from 'three';
import { Room } from './Room.js';
import { Bed, BUNK_POSES } from '../../components/Bed.js';
import { Journal } from '../../components/Journal.js';
import { DigitalClock } from '../../gameobjects/DigitalClock.js';

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
//   bedroom   back left: the bunk (a single bed) and a side table with the
//             bedside clock, the lockers on the back wall beside the table
//   storage   back right: two rows of big racks running front to back (one
//             against the right wall), with an aisle between
//   office    front: the desk end-on to the front wall with its chair and a
//             lit lamp, the previous operator's notebook (the Journal,
//             #79), and two small shelves along the wall behind it
//
// The player wakes here (`spawn`): beside the bunk, facing the desk, so
// the journal is the first thing in reach each night.
//
// The main paths stay open: in at the door and across the middle of the
// room, and from there into the bedroom and down the storage aisle.
//
// The doorway is in the right wall, leading back toward the office.
// `doorOffset` slides it along the wall so BaseScene can line it up with
// the corridor. Only the storage racks stand on the right wall, in the
// back half (z < −0.5): from there forward the metre inside the wall is
// clear, so the doorway works anywhere in the front half.
// ─────────────────────────────────────────────

export class LivingQuarters extends Room {
  /** On the bunk, from buildProps(). @type {Bed|null} */
  bed = null;
  /** On the desk's notebook, from buildProps(). @type {Journal|null} */
  journal = null;
  /** Where the player wakes: world position (capsule centre) and yaw.
   *  @type {{ position: [number, number, number], yaw: number }|null} */
  spawn = null;

  /** On the side table beside the bunk, from buildProps(). @type {DigitalClock|null} */
  bedsideClock = null;

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
    // Back-left corner, its long side along the left wall, 3 cm off both
    // walls (bed.glb is 0.9 × 2 m), the pillow at the back.
    const bunk = this._spawnProp('model:bed', {
      name: 'Bunk', position: [-inX + 0.48, 0, -inZ + 1.03],
    });
    this.bed = bunk.addComponent(new Bed());

    // The side table stands just off the bed's open side, by the pillow.
    const wood = this._own(new THREE.MeshStandardMaterial({ color: 0x4a3b2e, roughness: 0.85 }));
    const table = this._addStaticBox('SideTable', [-1.45, 0.25, -3.5], [0.7, 0.5, 0.7], wood);

    // A digital clock on the side table, its face (+z) turned to the pillow
    // so a napper watches the minutes race (#113). The scene hands it the
    // NightClock.
    this.bedsideClock = this._own(new DigitalClock('BedsideClock'));
    const clock = this.bedsideClock.object3d;
    clock.position.set(table.object3d.position.x, 0.5, table.object3d.position.z);
    const [px, , pz] = BUNK_POSES.pillow.position;   // the bunk is not turned
    const { x: bx, z: bz } = bunk.object3d.position;
    clock.rotation.y = Math.atan2(bx + px - clock.position.x, bz + pz - clock.position.z);
    this.root.addChild(this.bedsideClock);

    // Three lockers in one model, against the back wall past the side
    // table, the doors facing into the room: the bed, the table and the
    // lockers together. locker.glb's origin is 0.274 m off-centre along its
    // width (0.246 m at 0.9 scale), so the spawn point sits that far left of
    // the lockers' middle.
    this._spawnProp('model:locker', {
      name: 'Lockers', position: [-0.2 - 0.246, 0, -inZ + 0.225 - 0.018], scale: 0.9,
    });

    // ── Storage ──
    // Two rows of three big racks (0.92 × 0.6 m) running out from the back
    // wall, turned end-on to it: one against the right wall, one standing
    // free with a 0.9 m aisle between, open at the front onto the middle of
    // the room. The racks are open both sides.
    const rack = { w: 0.92, d: 0.6 };
    const rows = [inX - 0.005 - rack.d / 2, inX - 0.005 - rack.d * 1.5 - 0.9];   // x of each row
    let n = 0;
    for (const x of rows) {
      for (let i = 0; i < 3; i++) {
        this._spawnProp('model:bigger-shelf', {
          name: `StorageRack_${++n}`,
          position: [x, 0, -inZ + 0.005 + (rack.w + 0.01) * i + rack.w / 2],
          rotationY: Math.PI / 2,
        });
      }
    }

    // ── Office ──
    // The desk end-on to the front wall, its drawers toward the chair on its
    // left, facing it.
    this._spawnProp('model:simple-desk', { name: 'Desk', position: [-0.2, 0, 2.6], rotationY: Math.PI });
    this._spawnProp('model:metal-chair', { name: 'DeskChair', position: [-1.45, 0, 2.67], rotationY: 1.3 });
    this._buildDeskLamp([-0.05, 0.79, 2.2]);
    this._buildNotebook([-0.25, 0.8, 2.75]);
    this._placeSpawn([-1.3, -2.4], [-0.2, 2.6]);

    // Two small shelves along the front wall, behind the desk's end.
    [-1.3, -0.26].forEach((x, i) => {
      this._spawnProp('model:shelf', { name: `OfficeShelf_${i + 1}`, position: [x, 0, inZ - 0.2], rotationY: Math.PI / 2 });
    });
  }

  /** A lamp on the desk: base, stem, a glowing shade and a small light,
   *  drawn only, with no collider. `position` is on the desk top (0.79 m). */
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

    // Lit (#79): a small warm pool over the desk to read the journal by.
    // No shadow, and built with the room, so the one-off shader compile
    // happens under the loading screen. Under the room, so the power grid
    // collects it with the other lamps and a cut takes it out too.
    const light = new THREE.PointLight(0xffb070, 1.6, 3.5, 2);
    light.castShadow = false;
    light.position.y = 0.32;
    go.object3d.add(light);
  }

  /** The previous operator's notebook, closed, on the desk top: a solid
   *  box with its own collider (the interaction ray needs one) and its own
   *  material, which the Journal pulses while tonight's entry is unread. */
  _buildNotebook(position) {
    const cover = this._own(new THREE.MeshStandardMaterial({
      color: 0x5a3b26, roughness: 0.9, emissive: 0xffc070, emissiveIntensity: 0,
    }));
    const notebook = this._addStaticBox('Notebook', position, [0.2, 0.02, 0.28], cover);
    this.journal = notebook.addComponent(new Journal());
    this.journal.material = cover;
  }

  /** Where the player wakes: `at` room-local [x, z], turned to face `look`. */
  _placeSpawn([x, z], [lx, lz]) {
    const [ox, oy, oz] = this.position;
    // Forward at yaw is (-sin, -cos) in x/z.
    const yaw = Math.atan2(-(lx - x), -(lz - z));
    this.spawn = { position: [x + ox, oy + 1, z + oz], yaw };
  }
}
