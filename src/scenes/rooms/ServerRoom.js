import * as THREE from 'three';
import { Room } from './Room.js';
import { Interactable } from '../../components/Interactable.js';
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

  /** DriveManager reference, set by bindDriveManager.
   *  @type {import('../../gameplay/DriveManager.js').DriveManager|null} */
  _driveManager = null;

  /** PickupSystem reference, set by bindPickupSystem.
   *  @type {import('../../components/PickupSystem.js').PickupSystem|null} */
  _pickupSystem = null;

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

  /** Wire the DriveManager to the console's interactable. Called by the
   *  scene after gameplay systems are up. */
  bindDriveManager(dm) {
    this._driveManager = dm;
    // Refresh the console prompt now that the manager is available.
    const interact = this._serverConsole?.getComponent(Interactable);
    interact?.refreshPrompt?.();
  }

  /** Wire the player's PickupSystem to the console's interactable. Called by
   *  the scene after the PickupSystem is created. */
  bindPickupSystem(pickupSystem) {
    this._pickupSystem = pickupSystem;
    const interact = this._serverConsole?.getComponent(Interactable);
    interact?.refreshPrompt?.();
  }

  buildLighting() {
    // Blue only, to match the racks' own glow — a red light here read as an
    // unrelated alarm state rather than part of the room's palette.
    const status = new THREE.PointLight(0x3a6bff, 2.0, 6, 2);
    status.position.set(1.5, 2.2, -2.5);
    this._addGroup('StatusLEDs').object3d.add(status);
  }

  buildProps() {
    // One row along the right wall, set off it the same way as the office
    // rack (1.35 m in from the inner face, facing into the room).
    const rackX = this.width / 2 - this.wallThick / 2 - 1.35;

    // One geometry and one material shared by every rack's trim, and one
    // geometry shared by every LED — 16 identical slats and 12 identical
    // dots were each allocating their own before, which is 28 extra
    // geometries and 28 extra shader-program variants for no visual gain.
    const shared = {
      trimGeometry: this._own(new THREE.BoxGeometry(0.02, 0.05, 0.3)),
      trimMaterial: this._own(new THREE.MeshBasicMaterial({ color: 0x35ff7a })),
      ledGeometry:  this._own(new THREE.BoxGeometry(0.05, 0.05, 0.02)),
    };

    [-2.6, -1.2, 0.2, 1.6].forEach((z, i) => {
      this._spawnProp('model:server-rack', {
        name: `ServerRack_${i + 1}`, position: [rackX, 0, z], rotationY: -Math.PI / 2, scale: 0.333,
      });
      this._addRackGlow([rackX, 0, z], i, shared);
    });

    // Console against the back wall, facing the racks' aisle.
    // The interactable clears the signal from a drive — either the inserted
    // drive in the reader, or a drive the player is carrying. This is the
    // "Delete signal" action from the original design, repurposed to reset
    // drives so they can accept new signals.
    const console_ = this._spawnProp('model:radar-terminal', {
      name: 'ServerConsole', position: [-1, 0, -2.45], scale: 0.478,
    });
    this._serverConsole = console_;
    const self = this;
    console_.addComponent(new class extends Interactable {
      promptLabel = '[E] Delete signal';
      interactRange = 2;

      // Find a drive with a signal: either inserted or being carried.
      _findDriveWithSignal() {
        const dm = self._driveManager;
        const ps = self._pickupSystem;
        if (!dm) return null;
        // Check the inserted drive first.
        if (dm.insertedDriveHasSignal) return dm.insertedDrive;
        // Check if the player is carrying a drive with a signal.
        const heldGO = ps?.heldPickupable?.gameObject;
        if (heldGO && dm.drives.includes(heldGO) && heldGO.saved) {
          return heldGO;
        }
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
          // Also reset the counter on the DriveManager if this was the
          // inserted drive.
          const dm = self._driveManager;
          if (dm && dm.insertedDrive === drive) {
            dm.signalsOnDrive = 0;
          }
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
   *  x/z, so `faceX` sits just proud of the front face (rackX − half the
   *  rack's depth), toward the room's centre — outside the rack's own
   *  solid geometry, not embedded in it. */
  _addRackGlow([rackX, , rackZ], index, shared) {
    const faceX = rackX - 0.35;
    const groupGO = this._addGroup(`RackGlow_${index + 1}`);
    groupGO.object3d.position.set(faceX, 0, rackZ);

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
    const glow = new THREE.PointLight(0x3a6bff, 0.9, 9, 1.2);
    glow.position.set(0.02, 1.63, 0.3);
    groupGO.object3d.add(glow);
  }
}
