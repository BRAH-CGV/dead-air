import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Room } from './Room.js';
import { GameObject } from '../../core/GameObject.js';
import { Interactable } from '../../components/Interactable.js';
import { WallClock } from '../../gameobjects/WallClock.js';
import { DigitalClock } from '../../gameobjects/DigitalClock.js';
import { GlobeSpin } from '../../components/GlobeSpin.js';
import { SignalAlertLight } from '../../gameobjects/SignalAlertLight.js';
import { WindowGlass } from '../../gameobjects/WindowGlass.js';
import { Drive } from '../../gameobjects/Drive.js';
import { DriveBox } from '../../gameobjects/DriveBox.js';
import { populateGrowRack, GROW_RACK } from '../../gameobjects/GrowRack.js';
import { DriveSlot } from '../../components/DriveSlot.js';
import { deskWingGeometry, deskWingOutline, deskWingSolids } from './DeskWing.js';

// ── Drive boxes on the shelf ──
// The shelf collider (manifest) has five boards; these are their top
// surfaces — board centre y + half the 0.025 thickness — in the same
// world space the ShelfCube's resting height uses.
const SHELF_LEVEL_TOPS = [0.2236, 0.6458, 1.0681, 1.4903, 1.9125];
const SHELF_XZ = [5.68, -2.0];   // where the Shelf prop stands
const DRIVE_BOX_GAP = 0.03;      // clearance between a box pair on a board

// One entry per box: which board it rests on, which side of the board
// centre it sits on, its colour, and how many drives it starts with.
const DRIVE_BOX_LAYOUT = [
  { name: 'DriveBox_A', level: 0, slot: -1, color: 0x405064, fill: 8 },
  { name: 'DriveBox_B', level: 0, slot: +1, color: 0x584064, fill: 8 },
  { name: 'DriveBox_C', level: 1, slot: -1, color: 0x3e5a50, fill: 8 },
  { name: 'DriveBox_D', level: 1, slot: +1, color: 0x5a4a3e, fill: 8 },
];

// ─────────────────────────────────────────────
// MainOffice  –  the signal lab, open from night 1
// ─────────────────────────────────────────────
// The hub room, carried over from OfficeScene: same 12 × 10 × 3 shell, big
// back window, warm ceiling light and cool desk glow. Scene-wide lighting
// (ambient, moon) belongs to the scene, not the room.
//
// Furnished for the job and nothing else: the computer desk facing the
// window, a food-ration dispenser (the player eats here, between scans), a
// bin, a shelf of spares, a poster.
//
// ── Interior layout mock-up ──
// Placeholder shapes for the planned layout, to walk around in before the
// real assets are found. Everything usable before is usable still.
//   • The station: the desk top carries on into an angled wing each side
//     (`DeskWing_*`, see DeskWing.js), drawn with the desk's own material
//     so it reads as one piece of furniture. On the left one stands the
//     security-camera monitor (camera-monitor.glb, square to the wing; the
//     scene attaches its CameraTerminal). On the right one stand a digital clock and a globe
//     on its stand; [E] on the globe gives it a spin (GlobeSpin). The clock
//     and the stand are render-only — a collider on the desk could stop the
//     interact ray short of the terminal or the drive reader — and the
//     globe's is a ball no bigger than itself.
//   • The food corner, down the left wall: a two-tier rack of grow beds
//     under UV lights (GrowRack.js), then the dispenser and the bin, short
//     of the doorway.
//   • No chair at the station, and no extinguisher by the door.
//
// Doorways: front (the original door) → Airlock, and through its hatch to
// Outside; right → ServerRoom; left → LivingQuarters. None of them lock.
// The side doorways sit toward the front, leaving the back half of the
// side walls for the dispenser and the shelf.
//
// A wall clock hangs right of the window, and a digital one stands on the desk.
// The room builds them; the scene hands them the NightClock
// (`wallClock.clock`, `deskClock.clock`), since rooms don't know about
// gameplay. Same for the red signal lamp above the computer desk: the room
// perches it, the scene wires it to the SignalManager and GameController
// (`signalLight.signalManager` / `.gameController`).
//
// The food-ration dispenser on the left wall is `rationDispenser`, a
// RationDispenser; the scene hands it the stamina a ration restores.
// ─────────────────────────────────────────────

const RATION_READY = '[E] Take a food ration';
const RATION_REFILLING = 'Dispenser refilling…';

/** The dispenser's use: a ration restores stamina, then it refills for
 *  `cooldown` seconds. The prompt is a data field, so InteractionSystem
 *  re-shows it when it changes under the crosshair. */
export class RationDispenser extends Interactable {
  promptLabel = RATION_READY;
  /** Set by the scene. @type {{restore(amount: number): void}|null} */
  stamina = null;
  /** Stamina per ration. */
  amount = 0.35;
  /** Seconds before the next ration. */
  cooldown = 40;
  /** Seconds left until it is ready again. */
  refill = 0;
  /** Called after each ration (the sound). */
  onEat = null;

  onUpdate(dt) {
    if (this.refill > 0 && (this.refill -= dt) <= 0) this.reset();
  }

  onInteract() {
    if (!this.stamina || this.refill > 0) return;
    this.stamina.restore(this.amount);
    this.refill = this.cooldown;
    this.promptLabel = RATION_REFILLING;
    this.onEat?.();
  }

  /** Ready again: a new or retried night. */
  reset() {
    this.refill = 0;
    this.promptLabel = RATION_READY;
  }
}

/** The bars across the window: mullions at ±x, the crossbar's height, and
 *  the mullions' width. The frame is built from them and the glass is cut
 *  into panes by them. */
const WINDOW_MULLION_X = 1.42;
const WINDOW_CROSSBAR_Y = 1.65;
const WINDOW_BAR = 0.08;
/** The window's corners are rounded, a quarter circle of this radius (m):
 *  a steel fillet through the wall in each (_buildWindowFrame), and the
 *  bunker's embrasure outside follows the same curve (BunkerShell). */
export const WINDOW_CORNER_RADIUS = 0.45;
/** Bolt heads round the inside of the frame: radius, and spacing along it. */
const WINDOW_BOLT = { radius: 0.018, spacing: 0.5 };

/** The computer desk, as MainOffice seats it, read off retro-computer.glb
 *  at its 0.016 spawn scale: its centre; the half-width of its side panels
 *  and of its top (the sides are chamfered in to it); its front (the
 *  kneehole side) and back; and the height of its top, where the drive
 *  reader rests. The wings and what stands on them are placed from these. */
const DESK = { x: 0, z: -2.55, halfW: 0.8, topHalfW: 0.752, front: -2.15, back: -2.95, top: 0.864 };

/** The whole station on the floor, desk and both wings, room-local metres
 *  (x, z): what anything walking round it (Ragno) has to keep clear of. */
export function deskStation() {
  const pts = [-1, 1].flatMap(side => deskWingOutline(side, DESK).body);
  const xs = pts.map(([x]) => x), zs = [...pts.map(([, z]) => z), DESK.back, DESK.front];
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

/** Where the player stands to use the desk (x, z): what the wing monitor
 *  turns to face. */
const SEAT = [0, -1.45];

/** How high over the floor something on the desk or its wings is: above
 *  the kneehole's 0.72 m and well short of the ceiling. */
const ON_DESK_Y = [0.6, 1.6];

/** [x, z] inside the polygon `pts` (even–odd rule). */
function insidePolygon(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** The security-camera monitor on the left wing (camera-monitor.glb):
 *  width, height, depth. */
const CAMERA_MONITOR = [0.6, 0.379, 0.331];

export class MainOffice extends Room {
  /** Hung by buildProps(). @type {WallClock|null} */
  wallClock = null;

  /** Stood on the desk's right wing by buildProps(). @type {DigitalClock|null} */
  deskClock = null;

  _deskPoint = new THREE.Vector3();

  /** Perched by buildProps(). @type {SignalAlertLight|null} */
  signalLight = null;

  /** The security-camera monitor on the desk's left wing. The scene hangs
   *  the CameraTerminal on it. @type {GameObject|null} */
  cameraMonitor = null;

  /** The drive reader slot on the desk. @type {import('../../core/GameObject.js').GameObject|null} */
  driveReader = null;

  /** Physical drives in the room: the drives pre-seated in the drive
   *  boxes. @type {Drive[]} */
  drives = [];

  /** Pickupable drive boxes on the shelf. @type {DriveBox[]} */
  driveBoxes = [];

  /** On the VendingMachine, from buildProps(). @type {RationDispenser|null} */
  rationDispenser = null;

  /**
   * @param {import('../../core/Engine.js').Engine} engine
   * @param {object} [opts]
   * @param {number[]} [opts.position=[0,0,0]]
   * @param {THREE.Material} [opts.material]  Wall material (caller-owned)
   */
  constructor(engine, { position = [0, 0, 0], material } = {}) {
    super(engine, {
      name: 'MainOffice',
      width: 12, depth: 10, height: 3, wallThick: 0.2,
      position, material,
      openings: [
        // Window centred 1.65 m up, 2.35 m tall → sill at 0.475 m.
        { side: 'back',  width: 8.5, height: 2.35, sill: 0.475 },
        { side: 'front', width: 1,   height: 2.2,  offset: 2 },
        { side: 'right', width: 1.2, height: 2.2,  offset: 3.5 },
        { side: 'left',  width: 1.2, height: 2.2,  offset: 3.5 },
      ],
    });
  }

  /** A world point is over the computer desk or one of its wings, at the
   *  height of something set down on them (the tutorial's drive box). */
  isOnDesk(worldPoint) {
    this.root.object3d.updateMatrixWorld();
    const p = this.root.object3d.worldToLocal(this._deskPoint.copy(worldPoint));
    if (p.y < ON_DESK_Y[0] || p.y > ON_DESK_Y[1]) return false;
    const x = p.x - DESK.x;
    if (Math.abs(x) <= DESK.halfW && p.z >= DESK.back && p.z <= DESK.front) return true;
    return insidePolygon(x, p.z, deskWingOutline(1, DESK).top)
        || insidePolygon(x, p.z, deskWingOutline(-1, DESK).top);
  }

  buildDoors() {
    this.addDoor('ToAirlock',        'front', 'Airlock');
    this.addDoor('ToServerRoom',     'right', 'ServerRoom');
    this.addDoor('ToLivingQuarters', 'left',  'LivingQuarters');
  }

  buildLighting() {
    const ceilingGO = this._addGroup('CeilingLight');
    const ceiling = new THREE.PointLight(0xffd8a8, 14.0, 24, 1.0);
    ceiling.position.set(0, 2.75, 0.4);
    ceiling.castShadow = true;
    ceiling.shadow.mapSize.set(1024, 1024);
    // Without a bias, anything round under this light shadows itself in
    // fine stripes (shadow acne) — the desk globe showed it. Two centimetres
    // along the surface normal clears it, and is too little to pull a
    // shadow away from what casts it.
    ceiling.shadow.normalBias = 0.02;
    ceilingGO.object3d.add(ceiling);
    this.ceilingLight = ceiling;

    const fixture = new THREE.Mesh(
      this._own(new THREE.CylinderGeometry(0.35, 0.45, 0.08, 24)),
      this._own(new THREE.MeshStandardMaterial({
        color: 0x2a2a2a,
        emissive: 0xffc36b,
        emissiveIntensity: 1.8,
      })),
    );
    fixture.position.copy(ceiling.position);
    ceilingGO.object3d.add(fixture);

    const deskGO = this._addGroup('DeskGlow');
    const desk = new THREE.PointLight(0x66ccff, 4.0, 6, 1.6);
    desk.position.set(0, 1.1, -2.1);
    deskGO.object3d.add(desk);

    // The terminal screen's own faint green spill. It is a vital function,
    // not a bulb: with the generator running it glows even after the UFO has
    // blown every lamp in the base — the one sign in a dark office that the
    // computer still works (PowerGrid reads `unbreakable`).
    const screenGO = this._addGroup('ScreenGlow');
    screenGO.object3d.userData.unbreakable = true;
    const screen = new THREE.PointLight(0x4dff7a, 0.8, 3, 2);
    screen.position.set(0, 1.0, -2.2);
    screenGO.object3d.add(screen);
    this.screenGlow = screen;
  }

  buildProps() {
    this._buildWindowFrame();
    this._buildWindowGlass();
    this._buildWallClock();
    this._buildSignalLight();

    // rotationY 0 seats the desk facing the back window — the dish tower is
    // out there, and the terminal's whole job is aiming it. The kneehole
    // (the manifest collider's open +Z side) ends up facing the door, which
    // is where the player crouches in from.
    //
    // No Interactable here: BaseScene attaches the ComputerTerminal and its
    // own Interactable to this desk. InteractionSystem resolves
    // getComponent(Interactable) — the first match wins — so a stub of our
    // own would silently shadow the terminal.
    const desk = this._spawnProp('model:retro-computer', {
      name: 'ComputerDesk', position: [0, 0, -2.55], rotationY: 0, scale: 0.016,
    });

    // The station around it: the wings, and what stands on the right one.
    this._buildDeskWings(desk);
    this._buildCameraMonitor();
    this._buildDeskClock();
    this._buildGlobe();

    // Left wall, back to front: the grow beds, the ration dispenser and a
    // bin for the wrappers, all short of the doorway.
    this._buildGrowBeds();
    this._buildRationDispenser();
    this._spawnProp('model:trash-bin', { name: 'TrashBin', position: [-5.68, 0, 1.9] });

    // Right wall: spare parts on a shelf; a poster where the eye lands
    // walking in from the airlock. The shelf's open sides face ±x.
    this._spawnProp('model:shelf', { name: 'Shelf', position: [5.68, 0, -2.0] });

    // Tiny dynamic crate on the second shelf level to demonstrate collision layers:
    // the crate rests on the SHELF-layer boards, while the player is blocked by
    // the DEFAULT-layer outer box. Toggle physics debug (`) to see the layers.
    // The crate uses explicit groups (DEFAULT membership, not PLAYER) so it
    // passes through the player-only bounding box.
    this._spawnProp('model:crate', {
      name: 'ShelfCube',
      position: [5.68, 1.09, -2.0],  // third shelf level (y≈1.06)
      scale: 0.0016,                  // doubled from 0.0008
      physics: {
        body: 'dynamic',
        mass: 0.5,
        // DEFAULT membership (not PLAYER) so it passes through the player-only box.
        // Filters for DEFAULT + SHELF so it rests on the shelf boards.
        groups: { membership: ['DEFAULT'], filter: ['DEFAULT', 'SHELF'] },
      },
    });

    this._spawnProp('model:poster', {
      name: 'Poster', position: [5.9, 1.05, 0.6], rotationY: -Math.PI / 2, physics: 'none',
    });

    // Drive reader on the desk and the shelf's drive boxes, each
    // pre-filled with seated drives.
    this._buildDriveStation();
    this._buildDriveBoxes();
  }

  /** Where food comes from: a wall-mounted machine that dispenses rations
   *  of nutrient mush. Built here rather than imported — the downloaded
   *  vending machine is a broken fragment. The body is the collider the
   *  interact ray hits; the face details are plain meshes on it. */
  _buildRationDispenser() {
    const body = this._own(new THREE.MeshStandardMaterial({ color: 0x3a4148, roughness: 0.55, metalness: 0.4 }));
    const size = [0.7, 1.9, 0.9];
    const go = this._addStaticBox('VendingMachine', [-5.9 + size[0] / 2, size[1] / 2, 0.95], size, body);

    // Front face is +x, into the room; positions are relative to the body's
    // centre, 0.95 m up.
    const front = size[0] / 2;
    const detail = (geometry, material, position) => {
      const mesh = new THREE.Mesh(this._own(geometry), material);
      mesh.position.set(...position);
      go.object3d.add(mesh);
      return mesh;
    };
    const dark  = this._own(new THREE.MeshStandardMaterial({ color: 0x0c0e10, roughness: 0.9 }));
    const glass = this._own(new THREE.MeshStandardMaterial({
      color: 0x0a140e, emissive: 0x6dff9c, emissiveIntensity: 0.9, roughness: 0.3,
    }));
    const light = this._own(new THREE.MeshStandardMaterial({
      color: 0x200808, emissive: 0xff5a3c, emissiveIntensity: 1.4,
    }));

    detail(new THREE.BoxGeometry(0.02, 0.34, 0.56), glass, [front + 0.01, 0.4, 0]);       // status screen
    detail(new THREE.BoxGeometry(0.03, 0.08, 0.08), light, [front + 0.015, 0.05, 0.2]);   // dispense button
    detail(new THREE.BoxGeometry(0.04, 0.22, 0.5), dark, [front + 0.02, -0.35, 0]);       // hatch
    detail(new THREE.BoxGeometry(0.16, 0.03, 0.56), body, [front + 0.08, -0.47, 0]);      // tray lip

    this.rationDispenser = go.addComponent(new RationDispenser());
  }

  /** Drive reader slot on the desk surface, right of the computer. A small
   *  static box with a DriveSlot component that auto-snaps nearby unheld
   *  drives. The inserted drive can be picked up directly (no [E] prompt). */
  _buildDriveStation() {
    // Reader: a small dark box on the desk's right pillar, whose top is at
    // y = 0.86 m; the reader is 3 cm tall, so its centre sits at
    // 0.86 + 0.015 = 0.875.
    const readerSize = [0.12, 0.03, 0.15];
    const readerPos  = [0.650, 0.875, -2.260];
    const readerMat  = this._own(new THREE.MeshStandardMaterial({
      color: 0x1a1a1a, roughness: 0.7, metalness: 0.4,
      emissive: 0x003311, emissiveIntensity: 0.3,
    }));
    this.driveReader = this._addStaticBox('DriveReader', readerPos, readerSize, readerMat);

    // Tooltip on hover (no interact action — just a label)
    const readerTooltip = new Interactable();
    readerTooltip.promptLabel = 'Drive reader';
    this.driveReader.addComponent(readerTooltip);

    // Attach a DriveSlot component — it auto-snaps nearby unheld drives.
    // The slot is configured with a snap offset that places the drive on
    // top of the reader (half reader height + half drive height).
    const driveHeight = 0.02; // Drive._size[1] default
    this.driveReader.addComponent(new DriveSlot({
      snapDistance: 0.25,
      snapOffset: { y: readerSize[1] / 2 + driveHeight / 2 },
    }));
  }

  /** Pickupable drive boxes stocked on the office shelf. Each rests on a
   *  board with its sockets pre-filled; a taken drive can go to a reader or
   *  another box, and a released drive snaps into any free socket nearby. */
  _buildDriveBoxes() {
    for (const spec of DRIVE_BOX_LAYOUT) {
      const box = this._own(new DriveBox(spec.name, { color: spec.color }));
      // Rest on the board: top surface + half box height. Along the board
      // the boxes spread from the shelf centre, spaced off the box's own
      // depth so a resized box keeps its clearance.
      box.object3d.position.set(
        SHELF_XZ[0],
        SHELF_LEVEL_TOPS[spec.level] + box.size[1] / 2,
        SHELF_XZ[1] + spec.slot * (box.size[2] / 2 + DRIVE_BOX_GAP),
      );
      this.driveBoxes.push(box);
      this.root.addChild(box);

      // Seat its starting drives. Attaching at build time swaps the prompt
      // and installs the detach-on-pickup hook; the drive's deferred
      // kinematic lands the body kinematic in the socket once _init runs.
      for (let i = 0; i < (spec.fill ?? 0); i++) {
        const drive = new Drive(`${spec.name}_Drive_${i + 1}`);
        this.root.addChild(drive);
        box.receiver.attach(drive, i);
        this.drives.push(drive);
      }
    }
  }

  /** Right of the window, between its frame (x 4.43) and the side wall
   *  (x 5.9), flush on the back wall's inner face. */
  _buildWallClock() {
    this.wallClock = this._own(new WallClock());
    this.wallClock.object3d.position.set(5.15, 1.95, -4.9);
    this.root.addChild(this.wallClock);
  }

  // ──────────────────────────────────────────
  // Interior layout mock-up — placeholder shapes
  // ──────────────────────────────────────────
  /** `_addStaticBox` with a yaw: the body is turned with the mesh. Pass no
   *  material for a collider with nothing drawn. */
  _addTurnedBox(name, position, size, rotationY, material = null) {
    const go = new GameObject(name);
    go.object3d.position.set(...position);
    go.object3d.rotation.y = rotationY;
    if (material) {
      const mesh = new THREE.Mesh(this._own(new THREE.BoxGeometry(...size)), material);
      mesh.name = name;
      mesh.castShadow = mesh.receiveShadow = true;
      go.object3d.add(mesh);
    }

    const { world } = this.engine;
    const [ox, oy, oz] = this.position;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(position[0] + ox, position[1] + oy, position[2] + oz)
        .setRotation({ x: 0, y: Math.sin(rotationY / 2), z: 0, w: Math.cos(rotationY / 2) }),
    );
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2),
      body,
    );
    go.rigidBody = body;
    go.colliders = [collider];
    go.collider  = collider;
    go._originalSize = [...size];
    this.engine._bodyToGO?.set(body.handle, go);
    this.root.addChild(go);
    return go;
  }

  /** A fixed body with these colliders, nothing drawn: for a solid made of
   *  more than one shape. The descs are placed in the room's space. */
  _addSolid(name, descs) {
    const go = new GameObject(name);
    const { world } = this.engine;
    const [ox, oy, oz] = this.position;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(ox, oy, oz));
    go.rigidBody = body;
    go.colliders = descs.map(desc => world.createCollider(desc, body));
    go.collider  = go.colliders[0];
    this.engine._bodyToGO?.set(body.handle, go);
    this.root.addChild(go);
    return go;
  }

  /** The desk top carried on to each side: a wing turned 45° in toward the
   *  seat, its inner corner on the desk's front corner, drawn as one piece
   *  with the desk's own material (DeskWing.js maps it into the desk's
   *  texture). What is solid (`DeskWingSolid_*`) is the top's outline,
   *  floor to desk top: a box under the square and a small hull for the
   *  wedge between it and the desk's side (`deskWingSolids`), so what is
   *  set down there (the globe's side) rests on it, and nobody walks into
   *  it from behind the desk. Not one hull of the whole wing: Rapier made
   *  next to no contacts against the left one, and drives sank through. */
  _buildDeskWings(desk) {
    // The desk's material belongs to the asset cache — shared, never freed
    // here. A desk with no textured mesh (a stand-in model, a test) gets
    // plain wood instead.
    let material = null;
    desk?.object3d.traverse(o => { if (!material && o.isMesh && o.material?.map) material = o.material; });
    material ??= this._own(new THREE.MeshStandardMaterial({ color: 0x4a2c1a, roughness: 0.7 }));

    for (const [label, side] of [['Left', -1], ['Right', 1]]) {
      const mesh = new THREE.Mesh(this._own(deskWingGeometry(side, DESK)), material);
      mesh.name = `DeskWing_${label}`;
      mesh.castShadow = mesh.receiveShadow = true;
      this._addGroup(mesh.name).object3d.add(mesh);

      const { square, filler } = deskWingSolids(side, DESK);
      const [hx, hz] = square.halfExtents, turn = square.rotationY / 2;
      this._addSolid(`DeskWingSolid_${label}`, [
        RAPIER.ColliderDesc.cuboid(hx, DESK.top / 2, hz)
          .setTranslation(square.centre[0], DESK.top / 2, square.centre[1])
          .setRotation({ x: 0, y: Math.sin(turn), z: 0, w: Math.cos(turn) }),
        RAPIER.ColliderDesc.convexHull(new Float32Array([
          ...filler.map(([x, z]) => [x, 0, z]),
          ...filler.map(([x, z]) => [x, DESK.top, z]),
        ].flat())),
      ]);
    }
  }

  /** The security cameras' monitor on the left wing's top: the bottom-left
   *  screen of wall-screen.glb, cut out as camera-monitor.glb. It is turned
   *  square to the wing — the wing is set at 45°, so the screen looks
   *  straight out of its front edge, toward the front of the room. A box
   *  the size of the model is the collider the interact ray lands on;
   *  BaseScene attaches the CameraTerminal and its Interactable to it, as it
   *  does the computer's. The model is drawn only. Its screen is dark glass,
   *  as if switched off, until it is given something to show. */
  _buildCameraMonitor() {
    const [w, h, d] = CAMERA_MONITOR;
    const [cx, cz] = deskWingOutline(-1, DESK).centre;
    const yaw = Math.PI / 4;   // its front (+z) square to the wing
    const go = this._addTurnedBox('CameraMonitor', [cx, DESK.top + h / 2, cz], [w, h, d], yaw);
    const model = this._spawnProp('model:camera-monitor', {
      name: 'CameraMonitorModel', position: [cx, DESK.top, cz], rotationY: yaw, physics: 'none',
    });
    this.cameraMonitor = go;
  }

  /** A digital clock where the desk top meets the right wing, turned to
   *  the seat: placed by eye in the level editor. The scene runs it off the
   *  NightClock like the one on the wall. */
  _buildDeskClock() {
    this.deskClock = this._own(new DigitalClock('DeskClock'));
    this.deskClock.object3d.position.set(0.8, DESK.top, -2.6);
    this.deskClock.object3d.rotation.y = THREE.MathUtils.degToRad(-22.7);
    this.root.addChild(this.deskClock);
  }

  /** A globe on its stand, on the right wing. The two are
   *  separate models that share one origin, the globe's centre, 0.245 m
   *  above the stand's base: both are spawned at that one point and turned
   *  the same way — toward the back of the wing, placed by eye in the level
   *  editor, with the stand's arc to the back, away from the seat — and
   *  the globe spins inside the stand when it is used (GlobeSpin). The
   *  stand is drawn only; the globe's collider is what the interact ray
   *  finds. */
  _buildGlobe() {
    const place = { position: [1.1, DESK.top + 0.245, -2.58], rotationY: Math.PI / 4 };
    this._spawnProp('model:mars-stand', { name: 'GlobeStand', ...place, physics: 'none' });
    const globe = this._spawnProp('model:mars-globe', { name: 'Globe', ...place });
    globe.addComponent(new GlobeSpin());
  }

  /** Along the left wall, behind the dispenser: the grow rack (GrowRack.js),
   *  two tiers of three soil trays, each tier under UV grow lights, two
   *  plants to a tray. One box is the collider — the whole rack is solid to
   *  walk into — and the rack is drawn on it. */
  _buildGrowBeds() {
    const size = GROW_RACK.size;
    const go = this._addTurnedBox('GrowBeds', [-5.9 + size[0] / 2, size[1] / 2, -1.52], size, 0);
    populateGrowRack(go.object3d, { assets: this.engine.assets, own: r => this._own(r) });
  }

  /** Above the computer desk, where it reads from anywhere in the room. A
   *  placeholder sphere until a proper warning-lamp model is sourced. */
  _buildSignalLight() {
    this.signalLight = this._own(new SignalAlertLight());
    this.signalLight.object3d.position.set(-0.240, 1.090, -2.820);
    this.root.addChild(this.signalLight);
  }

  /** Frame around the back-wall opening. The solid part of the window is
   *  the collider Room puts in every window opening (`BackWindow`); what is
   *  seen of the glass is _buildWindowGlass. */
  _buildWindowFrame() {
    const frame = this._own(new THREE.MeshStandardMaterial({ color: 0x111820, roughness: 0.65 }));
    const parts = [
      ['WindowFrame_Top',           [0, 2.9, -4.84],     [8.75, 0.12, 0.18]],
      ['WindowFrame_Bottom',        [0, 0.4, -4.84],     [8.75, 0.12, 0.18]],
      ['WindowFrame_Left',          [-4.37, 1.65, -4.84], [0.12, 2.6, 0.18]],
      ['WindowFrame_Right',         [4.37, 1.65, -4.84],  [0.12, 2.6, 0.18]],
      ['WindowFrame_Mullion_Left',  [-WINDOW_MULLION_X, 1.65, -4.83], [WINDOW_BAR, 2.35, 0.12]],
      ['WindowFrame_Mullion_Right', [WINDOW_MULLION_X, 1.65, -4.83],  [WINDOW_BAR, 2.35, 0.12]],
      ['WindowFrame_Crossbar',      [0, WINDOW_CROSSBAR_Y, -4.82],    [8.5, 0.06, 0.12]],
    ];
    for (const [name, position, size] of parts) this._addStaticBox(name, position, size, frame);
    this._buildWindowFillets(frame);
    this._buildWindowBolts(frame);
  }

  /** A curved fillet in each corner of the opening, through the wall: from
   *  inside, the window reads as a hatch in a hardened wall — rounded like
   *  a ship's port — rather than a cut in a partition. Seen only; the glass
   *  collider (`BackWindow`) still fills the whole opening. */
  _buildWindowFillets(material) {
    const { width, height, offset = 0, sill } = this.openings.find(o => o.side === 'back');
    const r = WINDOW_CORNER_RADIUS, t = this.wallThick;
    // The top-right corner's fillet, the corner at the origin; mirrored
    // into the other three.
    const shape = new THREE.Shape();
    shape.moveTo(0, -r);
    shape.lineTo(0, 0);
    shape.lineTo(-r, 0);
    shape.absarc(-r, -r, r, Math.PI / 2, 0, true);
    const geometry = this._own(new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 10 }));

    const group = new THREE.Group();
    group.name = 'WindowFillets';
    group.position.set(offset, 0, this._wallPlane('back') - t / 2);
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(sx * width / 2, sy > 0 ? sill + height : sill, 0);
      mesh.scale.set(sx, sy, 1);   // three flips the winding for a mirrored mesh
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
    this.root.object3d.add(group);
  }

  /** Bolt heads round the frame, on its face toward the room, one mesh. */
  _buildWindowBolts(material) {
    const top = this.root.find('WindowFrame_Top'), left = this.root.find('WindowFrame_Left');
    const [tw, th, td] = top._originalSize, [, lh] = left._originalSize;
    const z = top.object3d.position.z + td / 2;
    const { y: topY } = top.object3d.position, bottomY = this.root.find('WindowFrame_Bottom').object3d.position.y;
    const leftX = left.object3d.position.x, rightX = this.root.find('WindowFrame_Right').object3d.position.x;
    const { radius, spacing } = WINDOW_BOLT;

    const at = [];
    const row = (from, to, place) => {
      const n = Math.max(1, Math.round((to - from) / spacing));
      for (let i = 0; i <= n; i++) at.push(place(from + ((to - from) * i) / n));
    };
    row(-tw / 2 + 0.1, tw / 2 - 0.1, x => [x, topY]);
    row(-tw / 2 + 0.1, tw / 2 - 0.1, x => [x, bottomY]);
    const sideY = left.object3d.position.y;
    row(sideY - lh / 2 + th + 0.2, sideY + lh / 2 - th - 0.2, y => [leftX, y]);
    row(sideY - lh / 2 + th + 0.2, sideY + lh / 2 - th - 0.2, y => [rightX, y]);

    const parts = at.map(([x, y]) => {
      const bolt = new THREE.CylinderGeometry(radius, radius * 1.15, 0.025, 6);
      bolt.rotateX(Math.PI / 2);
      bolt.translate(x, y, z + 0.0125);
      return bolt;
    });
    const merged = this._own(mergeGeometries(parts));
    for (const g of parts) g.dispose();
    const bolts = new THREE.Mesh(merged, material);
    bolts.name = 'WindowBolts';
    bolts.receiveShadow = true;
    this.root.object3d.add(bolts);
  }

  /** The glass itself, as much as is drawn of it: a thin film of dust and
   *  smears on a pane in the middle of the wall's thickness — behind the
   *  mullions from inside, set back in the reveal from outside. Cut into
   *  panes where the frame's bars cross it, so the dust lies along them. It
   *  shows by the ceiling light, read live: 1 / (π d) of it reaches the
   *  glass, as the light falls off (its decay is 1). BaseScene adds the
   *  night outside and the UFO's beam.
   *
   *  The glass never writes depth and the desk in front of it does (its
   *  manifest entry), so the desk's transparent materials stay in front
   *  whichever of the two is drawn first — the sorting that kept glass out
   *  of this window before. */
  _buildWindowGlass() {
    const { width, height, offset = 0, sill } = this.openings.find(o => o.side === 'back');
    const centre = [offset, sill + height / 2, this._wallPlane('back')];
    const fromLeft = x => x - offset + width / 2;

    this.windowGlass = this._own(new WindowGlass({
      width, height,
      dividers: {
        x: [fromLeft(-WINDOW_MULLION_X), fromLeft(WINDOW_MULLION_X)],
        y: [WINDOW_CROSSBAR_Y - sill],
        width: WINDOW_BAR,
      },
    }));
    this.windowGlass.object3d.position.set(...centre);
    this.root.addChild(this.windowGlass);

    const reach = this.ceilingLight.position.distanceTo(this.windowGlass.object3d.position);
    this.windowGlass.addLight(this.ceilingLight, 1 / (Math.PI * reach));
  }
}
