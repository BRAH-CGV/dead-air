import * as THREE from 'three';
import { Room } from './Room.js';
import { Interactable } from '../../components/Interactable.js';
import { DriveSlot } from '../../components/DriveSlot.js';
import { SightlineZone } from '../../gameobjects/SightlineZone.js';
import { LEDStrip } from '../../components/LEDStrip.js';

// ─────────────────────────────────────────────
// ServerRoom  –  dark rack room, open from night 2
// ─────────────────────────────────────────────
// Where signals are processed and stored — and where the camera entity
// watches from (night 3). Kept deliberately dark: one fixed blue status
// light and no ambient of its own, so the scene's global ambient barely
// lifts it. Each rack has glow-in-the-dark trim and a small blinking LED
// cluster (see `_addRackGlow`), and casts light from that same spot — the
// light source IS the visible blinking dots, not a separate invisible
// point floating elsewhere. (An emissive material tint on the rack model
// itself was tried and rejected: even at low intensity it read as "the
// rack is blue," not "the rack is glowing.")
//
// The doorway is in the left wall, leading back toward the office.
// `doorOffset` slides it along the wall so BaseScene can line it up with
// the corridor.
// ─────────────────────────────────────────────

export class ServerRoom extends Room {
  /** The server console with the "Delete signal" interactable.
   *  @type {import('../../core/GameObject.js').GameObject|null} */
  _serverConsole = null;

  /** The drive slot on the console. @type {import('../../components/DriveSlot.js').DriveSlot|null} */
  _driveSlot = null;

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

  /** The drive slot on the console (for external wiring). */
  get driveSlot() { return this._driveSlot; }

  buildLighting() {
    // Blue only, to match the racks' own glow — a red light here read as an
    // unrelated alarm state rather than part of the room's palette.
    const status = new THREE.PointLight(0x3a6bff, 2.0, 6, 2);
    status.position.set(1.5, 2.2, -2.5);
    this._addGroup('StatusLEDs').object3d.add(status);
  }

  buildProps() {
    // Interior layout mock-up: sixteen racks. Four pairs stand down each
    // side wall — one rack against the wall and one in front of it, both
    // facing the aisle between the two sides — and the console is at the
    // back of that aisle.
    //
    // A rack is 0.666 m square; the wall row's backs stand 2 cm off the
    // wall's inner face, and the front row 4 mm off the wall row, so the
    // two don't z-fight.
    const rackX = this.width / 2 - this.wallThick / 2 - 0.333 - 0.02;
    const frontX = rackX - 0.67;
    const consoleAt = [0, -(this.depth / 2 - this.wallThick / 2) + 0.243 + 0.03];   // x, z

    // Four pairs a side, 1.35 m apart from the back of the room: the
    // spacing that fits the fourth in short of the doorway where BaseScene
    // puts it.
    const PAIRS = 4, first = -2.9, pitch = 1.35;
    const rightZ = Array.from({ length: PAIRS }, (_, i) => first + i * pitch);

    // The left wall has the doorway in it. Its pairs are laid out the same
    // way, but step over the doorway: none stands within a pace (0.3 m) of
    // the opening. With the doorway forward of them, as in the base, the
    // two sides stand opposite each other.
    const door = this.openings.find(o => o.side === 'left');
    const keepOut = door.width / 2 + 0.333 + 0.3;
    const leftZ = [];
    for (let z = first; leftZ.length < PAIRS; z += pitch) {
      if (Math.abs(z - (door.offset ?? 0)) < keepOut) z = (door.offset ?? 0) + keepOut + 0.01;
      leftZ.push(z);
    }

    // One geometry and one material shared by every rack's trim, and one
    // geometry shared by every LED — 16 identical slats and 12 identical
    // dots were each allocating their own before, which is 28 extra
    // geometries and 28 extra shader-program variants for no visual gain.
    const shared = {
      trimGeometry: this._own(new THREE.BoxGeometry(0.02, 0.05, 0.3)),
      trimMaterial: this._own(new THREE.MeshBasicMaterial({ color: 0x35ff7a })),
      ledGeometry:  this._own(new THREE.BoxGeometry(0.05, 0.05, 0.02)),
    };

    let n = 0;
    const addPair = (side, z) => {
      // Both face the aisle: the model's front is +z, turned to −x on the
      // right and +x on the left.
      const rotationY = -side * Math.PI / 2;
      this._spawnProp('model:server-rack', {
        name: `ServerRackBack_${n + 1}`, position: [side * rackX, 0, z], rotationY, scale: 0.333,
      });
      this._spawnProp('model:server-rack', {
        name: `ServerRack_${n + 1}`, position: [side * frontX, 0, z], rotationY, scale: 0.333,
      });
      // The glow goes on the face that shows — the front rack's. Only the
      // right side's cast light: the light count is compiled into every
      // lit shader, and each PointLight is paid for by every surface in
      // the base. The left side's glow without casting.
      this._addRackGlow([side * frontX, 0, z], n, shared, { side, light: side > 0 });
      n++;
    };
    for (const z of rightZ) addPair(1, z);
    for (const z of leftZ) addPair(-1, z);

    // Console in the middle of the aisle, backed up to the back wall and
    // facing down it. Its footprint runs 0.24 m behind its origin.
    // The drive slot passively snaps in a drive when it comes close.
    // The interactable deletes the signal from the inserted drive.
    const console_ = this._spawnProp('model:radar-terminal', {
      name: 'ServerConsole', position: [consoleAt[0], 0, consoleAt[1]], scale: 0.478,
    });
    this._serverConsole = console_;

    // Drive slot on top of the console. The slot works independently —
    // no DriveManager needed. The console's Interactable checks the slot's
    // insertedDrive for signals.
    // The slot is a separate static box (like the MainOffice drive reader),
    // not a child of the scaled console model, so it keeps its own size.
    // It sits on the console's front ledge: 0.16 m left of the console's
    // origin, 0.7 m forward of it, 0.405 m up.
    const slotSize = [0.12, 0.03, 0.15]; // same as MainOffice reader
    const slotPos = [consoleAt[0] - 0.16, 0.405, consoleAt[1] + 0.7];
    const slotMat = this._own(new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      roughness: 0.7,
      metalness: 0.4,
      emissive: 0x003311,
      emissiveIntensity: 0.3,
    }));
    const slotBox = this._addStaticBox('DriveSlot', slotPos, slotSize, slotMat);

    // Tooltip on hover (no interact action — just a label)
    const slotTooltip = new Interactable();
    slotTooltip.promptLabel = 'Drive reader';
    slotBox.addComponent(slotTooltip);

    // Attach a DriveSlot component — it auto-snaps nearby unheld drives.
    const driveHeight = 0.02; // Drive._size[1] default
    const driveSlot = new DriveSlot({
      snapDistance: 0.25,
      snapOffset: { y: slotSize[1] / 2 + driveHeight / 2 },
    });
    slotBox.addComponent(driveSlot);
    this._driveSlot = driveSlot;

    const self = this;
    console_.addComponent(new class extends Interactable {
      promptLabel = '[E] Delete signal';
      interactRange = 2;

      // Check the console's drive slot for a drive with a signal.
      _findDriveWithSignal() {
        const slot = self._driveSlot;
        if (!slot) return null;
        const drive = slot.insertedDrive;
        if (drive?.saved) return drive;
        return null;
      }

      // The prompt follows the drive state — shows "No signal to delete"
      // when there's nothing to clear.
      refreshPrompt() {
        if (this._findDriveWithSignal()) {
          this.promptLabel = '[E] Delete signal';
        } else {
          this.promptLabel = 'No signal to delete';
        }
      }

      onHover() {
        this.refreshPrompt();
      }

      onInteract() {
        const drive = this._findDriveWithSignal();
        if (drive) {
          drive.setSaved(false);
        }
        this.refreshPrompt();
      }
    }());

    // Camera-entity watch volume, over the rack aisle. Not wired to an AI
    // yet — a stub for phase 10, see docs/ROOM-BASED-SCENE-PLAN.md.
    this.root.addChild(new SightlineZone('SightlineZone', {
      position: [0, 1.5, -0.5], size: [4, 2, 5],
    }));
  }

  /** Glow-in-the-dark trim, a small blinking LED cluster, and a light that
   *  sits right at that cluster — the light source is the visible dots,
   *  not a separate invisible point somewhere else. `index` staggers each
   *  rack's blink period so all four don't flash in lockstep.
   *
   *  Lives in its own unscaled group next to the rack, in room-local
   *  metres — NOT parented under the rack's own Object3D, which carries
   *  the rack's 0.333 spawn scale and would shrink and squeeze in every
   *  child position by that same factor. `server.glb` measures 2×6×2 raw
   *  (0.666×2.0×0.666 m once scaled), origin on the floor, centred on
   *  x/z, so the group sits just proud of the front face (half the rack's
   *  depth, and a little, toward the aisle) — outside the rack's own solid
   *  geometry, not embedded in it.
   *
   *  `side` is the wall the rack stands on (1 = right, −1 = left). The
   *  group is laid out for a rack facing −x, and turned half round for one
   *  facing +x. `light: false` leaves out the PointLight: the trim and the
   *  LEDs still glow. */
  _addRackGlow([rackX, , rackZ], index, shared, { side = 1, light = true } = {}) {
    const faceX = rackX - side * 0.35;
    const groupGO = this._addGroup(`RackGlow_${index + 1}`);
    groupGO.object3d.position.set(faceX, 0, rackZ);
    if (side < 0) groupGO.object3d.rotation.y = Math.PI;

    // Static glow-in-the-dark trim, like the console's — unlit so it reads
    // as self-luminous regardless of how dark the room is. Wide, flat
    // slats (a glowing status-vent strip), not thin rods: a 2 cm-thick rod
    // reads as nothing at normal viewing distance.
    [1.7, 1.45, 1.2, 0.95].forEach((y) => {
      const slat = new THREE.Mesh(shared.trimGeometry, shared.trimMaterial);
      slat.position.set(0.01, y, 0);
      groupGO.object3d.add(slat);
    });

    // Geometry is shared; the material is NOT — LEDStrip writes
    // `emissiveIntensity` per dot, so a shared material would blink every
    // dot on every rack in lockstep.
    const leds = [0, 1, 2].map((i) => {
      const led = new THREE.Mesh(
        shared.ledGeometry,
        this._own(new THREE.MeshStandardMaterial({ color: 0x0a1420, emissive: 0x3ad6ff, emissiveIntensity: 0.4 })),
      );
      led.position.set(0.02, 1.75 - i * 0.12, 0.3);
      groupGO.object3d.add(led);
      return led;
    });
    groupGO.addComponent(new LEDStrip(leds, { period: 0.5 + index * 0.15 }));

    // The light source sits right at the LED cluster, not somewhere else —
    // the blinking dots *are* the point of light.
    if (!light) return;
    const glow = new THREE.PointLight(0x3a6bff, 0.9, 9, 1.2);
    glow.position.set(0.02, 1.63, 0.3);
    groupGO.object3d.add(glow);
  }
}
