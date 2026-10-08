import * as THREE from 'three';
import { Room } from './Room.js';
import { Interactable } from '../../components/Interactable.js';
import { WallClock } from '../../gameobjects/WallClock.js';
import { SignalAlertLight } from '../../gameobjects/SignalAlertLight.js';
import { Drive } from '../../gameobjects/Drive.js';
import { DriveBox } from '../../gameobjects/DriveBox.js';
import { DriveSlot } from '../../components/DriveSlot.js';

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
// window, its chair, a food-ration dispenser (the player eats here, between
// scans), a bin, a shelf of spares, an extinguisher by the door, a poster.
//
// Doorways: front (the original door) → Airlock, and through its hatch to
// Outside; right → ServerRoom; left → LivingQuarters. None of them lock.
// The side doorways sit toward the front, leaving the back half of the
// side walls for the dispenser and the shelf.
//
// A wall clock hangs right of the window. The room builds it; the scene
// hands it the NightClock (`wallClock.clock`), since rooms don't know about
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

export class MainOffice extends Room {
  /** Hung by buildProps(). @type {WallClock|null} */
  wallClock = null;

  /** Perched by buildProps(). @type {SignalAlertLight|null} */
  signalLight = null;

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
    ceilingGO.object3d.add(ceiling);

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
    this._spawnProp('model:retro-computer', {
      name: 'ComputerDesk', position: [0, 0, -2.55], rotationY: 0, scale: 0.016,
    });

    // Pulled out to the right and turned toward the door, as if just left:
    // the kneehole (x ±0.545) stays open to crouch into.
    this._spawnProp('model:metal-chair', {
      name: 'DeskChair', position: [0.95, 0, -1.75], rotationY: Math.PI - 0.45,
    });

    // Left wall, behind the doorway: the ration dispenser and a bin for the
    // wrappers.
    this._buildRationDispenser();
    this._spawnProp('model:trash-bin', { name: 'TrashBin', position: [-5.68, 0, 0.05] });

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

    // By the airlock door, where a fire would be fought from.
    this._spawnProp('model:fire-extinguisher', { name: 'FireExtinguisher', position: [3.05, 0, 4.72] });

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
    const go = this._addStaticBox('VendingMachine', [-5.9 + size[0] / 2, size[1] / 2, -1.0], size, body);

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
    // Reader: a small dark box on the desk surface, right of centre.
    // Desk surface is at about y = 0.73 m; the reader is 3 cm tall, so
    // its centre sits at 0.73 + 0.015 = 0.745.
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

  /** Above the computer desk, where it reads from anywhere in the room. A
   *  placeholder sphere until a proper warning-lamp model is sourced. */
  _buildSignalLight() {
    this.signalLight = this._own(new SignalAlertLight());
    this.signalLight.object3d.position.set(-0.240, 1.090, -2.820);
    this.root.addChild(this.signalLight);
  }

  /** Frame around the back-wall opening. Left clear of glass: imported desk
   *  materials use transparency, and a glass plane sorts badly against them
   *  from inside the room. */
  _buildWindowFrame() {
    const frame = this._own(new THREE.MeshStandardMaterial({ color: 0x111820, roughness: 0.65 }));
    const parts = [
      ['WindowFrame_Top',           [0, 2.9, -4.84],     [8.75, 0.12, 0.18]],
      ['WindowFrame_Bottom',        [0, 0.4, -4.84],     [8.75, 0.12, 0.18]],
      ['WindowFrame_Left',          [-4.37, 1.65, -4.84], [0.12, 2.6, 0.18]],
      ['WindowFrame_Right',         [4.37, 1.65, -4.84],  [0.12, 2.6, 0.18]],
      ['WindowFrame_Mullion_Left',  [-1.42, 1.65, -4.83], [0.08, 2.35, 0.12]],
      ['WindowFrame_Mullion_Right', [1.42, 1.65, -4.83],  [0.08, 2.35, 0.12]],
      ['WindowFrame_Crossbar',      [0, 1.65, -4.82],     [8.5, 0.06, 0.12]],
    ];
    for (const [name, position, size] of parts) this._addStaticBox(name, position, size, frame);
  }
}
