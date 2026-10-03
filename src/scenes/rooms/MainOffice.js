import * as THREE from 'three';
import { Room } from './Room.js';
import { Interactable } from '../../components/Interactable.js';
import { Pickupable } from '../../components/Pickupable.js';
import { WallClock } from '../../gameobjects/WallClock.js';
import { SignalAlertLight } from '../../gameobjects/SignalAlertLight.js';
import { Drive } from '../../gameobjects/Drive.js';

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
// ─────────────────────────────────────────────

export class MainOffice extends Room {
  /** Hung by buildProps(). @type {WallClock|null} */
  wallClock = null;

  /** Perched by buildProps(). @type {SignalAlertLight|null} */
  signalLight = null;

  /** The drive reader slot on the desk. @type {import('../../core/GameObject.js').GameObject|null} */
  driveReader = null;

  /** Physical drives on the floor beside the desk. @type {Drive[]} */
  drives = [];

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
    this._spawnProp('model:poster', {
      name: 'Poster', position: [5.9, 1.05, 0.6], rotationY: -Math.PI / 2, physics: 'none',
    });

    // By the airlock door, where a fire would be fought from.
    this._spawnProp('model:fire-extinguisher', { name: 'FireExtinguisher', position: [3.05, 0, 4.72] });

    // Drive reader on the desk and placeholder drives beside it.
    this._buildDriveStation();
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

    go.addComponent(new class extends Interactable {
      promptLabel = '[E] Take a food ration';
      onInteract() {
        // TODO: coordinate with Hayden's stamina system.
        console.log('[MainOffice] food ration eaten');
      }
    }());
  }

  /** Drive reader slot on the desk surface, right of the computer. A small
   *  static box with an Interactable whose prompt follows the drive state.
   *  Three physical drive cubes sit on the floor beside the desk — the player
   *  picks them up and carries them to the reader. */
  _buildDriveStation() {
    // Reader: a small dark box on the desk surface, right of centre.
    // Desk surface is at about y = 0.73 m; the reader is 3 cm tall, so
    // its centre sits at 0.73 + 0.015 = 0.745.
    const readerSize = [0.12, 0.03, 0.15];
    const readerPos  = [0.55, 0.745, -2.55];
    const readerMat  = this._own(new THREE.MeshStandardMaterial({
      color: 0x1a1a1a, roughness: 0.7, metalness: 0.4,
      emissive: 0x003311, emissiveIntensity: 0.3,
    }));
    this.driveReader = this._addStaticBox('DriveReader', readerPos, readerSize, readerMat);

    // The Interactable prompt is driven by the driveManager + pickupSystem,
    // set later by the scene. Until then, the reader shows a static fallback.
    const reader = this.driveReader;
    const self = this;
    reader.addComponent(new class extends Interactable {
      promptLabel = '[E] Insert drive';
      interactRange = 2;

      // The prompt follows the drive state — InteractionSystem re-shows it
      // when this value changes (data field, not getter, per AGENTS.md).
      refreshPrompt() {
        const dm = self._driveManager;
        const ps = self._pickupSystem;
        if (!dm) { this.promptLabel = '[E] Insert drive'; return; }

        const heldDrive = ps?.heldPickupable &&
          self.drives.includes(ps.heldPickupable.gameObject);

        if (dm.driveInserted) {
          this.promptLabel = '[E] Eject drive';
        } else if (heldDrive) {
          // The player is carrying one of our drives — offer to insert it.
          this.promptLabel = '[E] Insert drive';
        } else if (dm.hasAvailableDrives()) {
          this.promptLabel = 'Pick up a drive first';
        } else {
          this.promptLabel = 'No drives available';
        }
      }

      // The state can change while the player looks at the reader (a drive
      // picked up, inserted or ejected) — keep the label live.
      onHover() {
        this.refreshPrompt();
      }

      onInteract() {
        const dm = self._driveManager;
        const ps = self._pickupSystem;
        if (!dm) return;

        if (dm.driveInserted) {
          // Eject: return the drive to the world.
          const ejected = dm.ejectDrive();
          if (ejected) {
            ejected.setEjected();
            // Make the drive dynamic again (it was kinematic in the reader).
            ejected.makeDynamic?.();
            ejected.enablePhysics?.();
            // If the player's PickupSystem is free, give them the drive directly.
            if (ps && !ps.heldPickupable) {
              const pickupable = ejected.getComponent(Pickupable);
              if (pickupable) ps.pickUp(pickupable);
            }
          }
        } else if (ps?.heldPickupable) {
          // Player is holding a drive — insert it into the reader.
          const heldGO = ps.heldPickupable.gameObject;
          // Check if the held object is one of our drives.
          const drive = self.drives.find(d => d === heldGO);
          if (drive) {
            ps.dropHeld();
            dm.insertDrive(drive);
            // Lock the drive in the reader slot: convert it to a kinematic
            // body and snap it onto the reader, upright.
            drive.makeKinematic?.();
            if (drive.rigidBody) {
              const slot = new THREE.Vector3();
              reader.object3d.getWorldPosition(slot);
              slot.y += readerSize[1] / 2 + drive._size[1] / 2;
              drive.rigidBody.setTranslation({ x: slot.x, y: slot.y, z: slot.z }, true);
              drive.rigidBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
            }
          }
        }
        this.refreshPrompt();
      }
    }());

    // Three physical drive cubes on the floor beside the desk.
    // They get physics bodies when _init runs (Drive._init creates the
    // rigid body + Pickupable component).
    const drivePositions = [
      [1.2, 0.01, -1.8],
      [1.4, 0.01, -2.1],
      [1.0, 0.01, -2.4],
    ];
    for (let i = 0; i < 3; i++) {
      const drive = new Drive(`Drive_${i + 1}`);
      drive.object3d.position.set(...drivePositions[i]);
      this.root.addChild(drive);
      this.drives.push(drive);
    }
  }

  /** Wire the DriveManager to the reader's Interactable. Called by the
   *  scene after gameplay systems are up. Also registers all drives. */
  bindDriveManager(driveManager) {
    this._driveManager = driveManager;
    // Register each drive with the manager.
    for (const drive of this.drives) {
      driveManager.addDrive(drive);
    }
    // Refresh the prompt now that the manager is available.
    const interact = this.driveReader?.getComponent(Interactable);
    interact?.refreshPrompt();
  }

  /** Wire the player's PickupSystem to the reader's Interactable. Called by
   *  the scene after the PickupSystem is created. */
  bindPickupSystem(pickupSystem) {
    this._pickupSystem = pickupSystem;
    const interact = this.driveReader?.getComponent(Interactable);
    interact?.refreshPrompt();
  }

  /** Frame update for the drive reader prompt — call from the terminal or
   *  game loop when the drive state may have changed externally. */
  updateDriveReaderPrompt() {
    const interact = this.driveReader?.getComponent(Interactable);
    interact?.refreshPrompt();
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
    this.signalLight.object3d.position.set(0, 1.3, -2.45);
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
