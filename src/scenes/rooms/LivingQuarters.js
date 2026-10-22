import * as THREE from 'three';
import { Room } from './Room.js';
import { Bed, BUNK_POSES } from '../../components/Bed.js';
import { CoffeeMachine } from '../../components/CoffeeMachine.js';
import { DigitalClock } from '../../gameobjects/DigitalClock.js';
import { CoffeeCup } from '../../gameobjects/CoffeeCup.js';
import { layoutShelf, buildClutter, RACK_SHELF, SMALL_SHELF } from '../../gameobjects/ShelfClutter.js';
import { BedroomPC } from '../../components/BedroomPC.js';
import { screenSurface } from '../../components/ScreenView.js';

/** The coffee machine (coffee-machine.glb at its manifest scale): width,
 *  height, depth, in metres. */
export const COFFEE_MACHINE = [0.4029, 0.5178, 0.5084];

/** Where its cup stands, in the model's own metres (front +z): the middle
 *  of the drip tray (x −0.132 … 0.095, z −0.079 … 0.103), on its grille's
 *  top, 0.092 m up, read off coffee-machine.glb. */
export const CUP_SPOT = [-0.018, 0.092, 0.012];

/** The double spout's two tips over it, the same way: where the coffee
 *  pours from. */
const SPOUT_TIPS = [[-0.0555, 0.2115, 0.0266], [0.0189, 0.2115, 0.0266]];

/** The tables' wood (tex:wood-table) covers this many metres a repeat. */
const WOOD_TILE = 0.55;

/** A box whose UVs are metres on every face, in repeats of the wood, the
 *  grain (u) along the face's longer side: a leg's runs down it. */
function woodBox(w, h, d) {
  const geometry = new THREE.BoxGeometry(w, h, d);
  const size = [w, h, d];
  const pos = geometry.getAttribute('position'), normal = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    const facing = [normal.getX(i), normal.getY(i), normal.getZ(i)].findIndex(n => Math.abs(n) > 0.5);
    const [a, b] = [0, 1, 2].filter(k => k !== facing);
    const [along, across] = size[a] >= size[b] ? [a, b] : [b, a];
    uv.setXY(i, pos.getComponent(i, along) / WOOD_TILE, pos.getComponent(i, across) / WOOD_TILE);
  }
  return geometry;
}

/** Its table: depth out from the wall, height, length along it. */
const COFFEE_TABLE = [0.65, 0.75, 0.9];

/** The bedroom PC (laptop.glb at its manifest scale): width, height (the
 *  lid's top), depth, in metres. */
export const LAPTOP = [0.326, 0.2714, 0.243];

/** Its screen (#161): the lid's flat classic_laptop_screen face, 6 mm back
 *  from the bezel, 0.224 × 0.183 m and facing +z, [tl, tr, br, bl] in the
 *  model's own metres. The face's corners are rounded a little; this is
 *  the rectangle round them. */
export const LAPTOP_SCREEN = [
  [-0.11204, 0.25644, -0.10337], [0.11216, 0.25644, -0.10337],
  [0.11216, 0.07316, -0.10337], [-0.11204, 0.07316, -0.10337],
];

// ─────────────────────────────────────────────
// LivingQuarters  –  the bedroom
// ─────────────────────────────────────────────
// Where the day goes: the player works the night shift and sleeps through
// the daylight. The "safe" room — but never truly safe.
//
// The bunk is the bed: its Bed interactable (`room.bed`) is how the player
// sleeps through the day. The scene wires the controller and fade into it.
// The coffee machine on the left wall is `coffeeMachine`, a CoffeeMachine;
// the scene hands it the stamina a cup restores. It is here, not in the
// office, so a cup means leaving the desk and the radar for a while.
//
// ── Interior layout mock-up ──
// The room is split in three with the furniture, using the models already
// in the game as stand-ins until better ones are found:
//
//   bedroom   back left: the bunk (a single bed) and a side table with the
//             bedside clock, the lockers on the back wall beside the table
//   coffee    the left wall, halfway down: the coffee machine on its
//             table, facing in
//   storage   back right: two rows of big racks running front to back (one
//             against the right wall), with an aisle between
//   office    front: the desk end-on to the front wall with its chair and a
//             lit lamp, and two small shelves along the wall behind it
//
// The player wakes here (`spawn`): beside the bunk, facing the desk.
//
// The main paths stay open: in at the door and across the middle of the
// room, and from there into the bedroom and down the storage aisle.
//
// The doorway is in the right wall, leading back toward the office.
// `doorOffset` slides it along the wall so BaseScene can line it up with
// the corridor. Only the storage racks stand on the right wall, in the
// back half (z < −0.5): from there forward the metre inside the wall is
// clear, so the doorway works anywhere in the front half.
//
// The computer (#114) is a laptop on the desk's far half, its screen turned
// to the chair, with the BedroomPC on it. BaseScene
// hands it the panel, the run and the map.
// ─────────────────────────────────────────────

export class LivingQuarters extends Room {
  /** On the bunk, from buildProps(). @type {Bed|null} */
  bed = null;
  /** Where the player wakes: world position (capsule centre) and yaw.
   *  @type {{ position: [number, number, number], yaw: number }|null} */
  spawn = null;

  /** On the side table beside the bunk, from buildProps(). @type {DigitalClock|null} */
  bedsideClock = null;

  /** On the CoffeeMachine, from buildProps(). @type {CoffeeMachine|null} */
  coffeeMachine = null;

  /** On the desk's laptop, from buildProps(). @type {BedroomPC|null} */
  pc = null;

  /** The laptop's screen, for ScreenView and its picture (#161). From
   *  buildProps(). */
  pcScreen = null;

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
    // Both tables are worn wood: Poly Haven's, its colour and normal maps.
    const assets = this.engine.assets;
    const woodMap = assets?.get('tex:wood-table') ?? null;
    const wood = this._own(new THREE.MeshStandardMaterial({
      color: woodMap ? 0xffffff : 0x4a3b2e, map: woodMap,
      normalMap: assets?.get('tex:wood-table-normal') ?? null, roughness: 0.8,
    }));
    const table = this._buildTable('SideTable', [-1.45, -3.5], [0.7, 0.5, 0.7], wood);

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

    // ── Coffee ──
    // Halfway down the left wall, between the bunk and the desk.
    this._buildCoffeeMachine([-inX, 0], wood);

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
    this._placeSpawn([-1.3, -2.4], [-0.2, 2.6]);

    // Two small shelves along the front wall, behind the desk's end.
    [-1.3, -0.26].forEach((x, i) => {
      this._spawnProp('model:shelf', { name: `OfficeShelf_${i + 1}`, position: [x, 0, inZ - 0.2], rotationY: Math.PI / 2 });
    });

    // The computer on the desk's far half, beyond the lamp, near the edge
    // the chair is at: a laptop is used up close.
    this._buildComputer([-0.25, 2.75]);

    this._fillShelves();
  }

  /** The racks and the small shelves, filled with the base's odds and ends
   *  (ShelfClutter): boxes, bins, cases, bottles, cable. Each shelf its own
   *  seed, so no two look alike, and the same every build. A small shelf's
   *  length runs along the model's z, so its frame turns a quarter. */
  _fillShelves() {
    const quarter = new THREE.Matrix4().makeRotationY(Math.PI / 2);
    const frame = (go, turn) => {
      go.object3d.updateMatrix();
      const matrix = go.object3d.matrix.clone();
      return turn ? matrix.multiply(quarter) : matrix;
    };
    const shelves = [];
    let seed = 1;
    for (const go of this.root.children) {
      if (/^StorageRack_/.test(go.name)) shelves.push({ items: layoutShelf(RACK_SHELF, seed++), matrix: frame(go, false) });
      else if (/^OfficeShelf_/.test(go.name)) shelves.push({ items: layoutShelf(SMALL_SHELF, seed++), matrix: frame(go, true) });
    }
    const group = this._addGroup('ShelfClutter');
    buildClutter(group.object3d, shelves, { own: r => this._own(r) });
  }

  /** The coffee: an espresso machine on a small table, the table's back to
   *  the wall at `[x, z]` (the wall's inner face, the middle of the table),
   *  the machine facing +x into the room. A box the machine's size is the
   *  collider the interact ray lands on, and carries the CoffeeMachine; the
   *  model is drawn only. Its white switch, beside the gauge, is the status
   *  light (CoffeeMachine colours it), on a copy of its material: the
   *  cached model's is shared. */
  _buildCoffeeMachine([x, z], wood) {
    const [tw, th] = COFFEE_TABLE;
    this._buildTable('CoffeeTable', [x + tw / 2, z], COFFEE_TABLE, wood);

    // The machine's back 4 cm off the wall, turned a quarter so its front
    // (+z) faces into the room and its depth runs along x.
    const [w, h, d] = COFFEE_MACHINE;
    const mx = x + 0.04 + d / 2;
    const go = this._addGroup('CoffeeMachine');
    const position = [mx, th + h / 2, z];
    go.object3d.position.set(...position);
    this._attachFixedBox(go, position, [d, h, w]);
    const model = this._spawnProp('model:coffee-machine', {
      name: 'CoffeeMachineModel', position: [mx, th, z], rotationY: Math.PI / 2, physics: 'none',
    });

    let screen = null;
    model?.object3d.traverse((o) => {
      if (!o.isMesh || o.material?.name !== 'Plastic_white') return;
      screen ??= this._own(o.material.clone());
      o.material = screen;
    });
    screen ??= this._own(new THREE.MeshStandardMaterial({ roughness: 0.5 }));
    screen.color.setHex(0x1a1a1a);   // dark under the glow, so its colour reads, not a pale tint
    screen.emissiveIntensity = 1.4;

    // The cup on the drip tray, shown while one brews and waits, the coffee
    // pouring into it from the spouts; its handle to the right of anyone
    // facing the machine.
    const cup = this._own(new CoffeeCup({
      picture: this.engine.assets?.get('tex:mug-hang-in-there') ?? null,
      spouts: SPOUT_TIPS.map(tip => tip.map((v, i) => v - CUP_SPOT[i])),
    }));
    cup.object3d.position.set(...CUP_SPOT);
    (model ?? go).addChild(cup);
    this.coffeeMachine = go.addComponent(new CoffeeMachine({ screen, cup }));
  }

  /** A table: a top on four legs, `size` [width (x), height, depth (z)]
   *  standing on the floor with its middle at `[x, z]`. A fixed box the
   *  table's size is its collider, so nothing goes under it. */
  _buildTable(name, [x, z], [w, h, d], material) {
    const go = this._addGroup(name);
    const middle = [x, h / 2, z];
    go.object3d.position.set(...middle);
    this._attachFixedBox(go, middle, [w, h, d]);
    const slab = 0.04, leg = 0.05;
    const part = (size, position) => {
      const mesh = new THREE.Mesh(this._own(woodBox(...size)), material);
      mesh.position.set(...position);
      mesh.castShadow = mesh.receiveShadow = true;
      go.object3d.add(mesh);
    };
    part([w, slab, d], [0, h / 2 - slab / 2, 0]);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        part([leg, h - slab, leg], [sx * (w - leg) / 2, -slab / 2, sz * (d - leg) / 2]);
      }
    }
    return go;
  }

  /** The computer (#114): a laptop open on the desk top at `[x, z]`, its
   *  screen turned to the chair (−x). A box the laptop's size is the
   *  collider the interact ray lands on, and carries the BedroomPC; the
   *  model is drawn only. A quarter turn, so the box stays square to the
   *  room, its width along z. */
  _buildComputer([x, z]) {
    const [w, h, d] = LAPTOP;
    const top = 0.79;                        // simple-desk.glb's top
    const yaw = -Math.PI / 2;
    const go = this._addGroup('BedroomPC');
    const position = [x, top + h / 2, z];
    go.object3d.position.set(...position);
    this._attachFixedBox(go, position, [d, h, w]);
    const model = this._spawnProp('model:laptop', {
      name: 'BedroomPCModel', position: [x, top, z], rotationY: yaw, physics: 'none',
    });
    this.pcScreen = model ? screenSurface(model.object3d, LAPTOP_SCREEN) : null;
    this.pc = go.addComponent(new BedroomPC());
  }

  /** A lamp on the desk: base, stem and a glowing shade. A glow, not a
   *  light — the light count is compiled into every lit shader — and drawn
   *  only, with no collider. `position` is on the desk top (0.79 m). */
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

    // Lit (#79): a small warm pool over the desk.
    // No shadow, and built with the room, so the one-off shader compile
    // happens under the loading screen. Under the room, so the power grid
    // collects it with the other lamps and a cut takes it out too.
    const light = new THREE.PointLight(0xffb070, 1.6, 3.5, 2);
    light.castShadow = false;
    light.position.y = 0.32;
    go.object3d.add(light);
  }

  /** Where the player wakes: `at` room-local [x, z], turned to face `look`. */
  _placeSpawn([x, z], [lx, lz]) {
    const [ox, oy, oz] = this.position;
    // Forward at yaw is (-sin, -cos) in x/z.
    const yaw = Math.atan2(-(lx - x), -(lz - z));
    this.spawn = { position: [x + ox, oy + 1, z + oz], yaw };
  }
}
