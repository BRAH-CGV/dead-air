import * as THREE from 'three';
import { Corridor } from './Corridor.js';
import { Component } from '../../core/Component.js';
import { Interactable } from '../../components/Interactable.js';
import { PLAYER_BODY } from '../../components/PlayerBody.js';
import { SnapSocket } from '../../components/SnapSocket.js';
import { DriveBoxDock } from '../../gameplay/DriveBoxDock.js';

// ─────────────────────────────────────────────
// Airlock  –  the only way out, sealed without the EVA suit
// ─────────────────────────────────────────────
// A short passage off the office's front door. The back end is open and
// butts against the office's front wall (the office doorway is the
// opening, as with any corridor); the front end has the hatch to Outside.
//
// Kind 'Room', not 'Corridor': the airlock is somewhere the player stands
// and suits up, so RoomTransitionSystem tracks it like any room.
//
// The suit hangs in a locker against the left wall. The hatch has no key
// and no night — it opens for whoever is wearing the suit. `bindSuit`
// hands the airlock the player's EVASuit, and `bindInnerDoor` the office's
// front door; from then on both doors, the locker's prompt and the beacon
// over the hatch follow `suit.worn`, whatever changes it.
//
// An interlock: the two doors are never open together.
//
//   pressurised ──suit on──▶ depressurising ──cycleTime──▶ depressurised
//        ▲                      │   ▲                          │
//        └──cycleTime── pressurising ◀──────────suit off────────┘
//
//   pressurised     inner door open, hatch shut       red beacon
//   depressurising  both shut                         amber
//   depressurised   inner door shut, hatch open       green
//   pressurising    both shut                         amber
//
// The door you are leaving shuts the moment the suit changes; the one ahead
// opens once the airlock has cycled — and, if `readyFor` is set, once the
// side beyond it says it is ready (BaseScene's AirlockPortal swaps which
// half of the base is drawn while both doors are shut, and holds the door
// until the new half is). Changing your mind mid-cycle runs back only as far
// as the cycle had got. `onStateChange` reports every state. The room's root carries the ticking
// component, so the scene drives the cycle like any other GameObject.
//
// The locker does nothing while the airlock cycles: it answers again only
// once a door has opened. A player running in from something mashes E at it,
// and every press used to flip the suit back, reversing the cycle each time.
//
// The locker only works from inside the chamber, clear of both doorways:
// not through the open inner door from the office, and never where a door
// would shut on the player.
//
// locker.glb is 1.45 × 2.1 × 0.49 m (w × h × d) with its origin 0.274 m
// off-centre along its width. Turned a quarter to face +X, the width runs
// along −Z, so the spawn z is pushed +0.25 m (× 0.9 scale) to centre it.
// Check the facing in the browser — glTF says +Z is the front, downloads
// don't always agree.
// ─────────────────────────────────────────────

const PROMPT = {
  putOn:   '[E] Put on EVA suit',
  takeOff: '[E] Take off EVA suit',
  stepIn:  'Step into the airlock to use the suit locker',
};
const SHUT = {
  sealed:        'Sealed — put on the EVA suit',
  cycling:       'Airlock cycling…',
  depressurised: 'Depressurised — take off the EVA suit',
};
const BEACON = { sealed: 0xff2a1a, cycling: 0xffa01a, open: 0x2aff5a };

/** How far the player's centre must be from a doorway box for the locker
 *  to work: the capsule radius plus a little, so a door that shuts never
 *  shuts on the player. */
const CLEARANCE = PLAYER_BODY.radius + 0.05;

const _wearerPos = new THREE.Vector3();

/** Ticks the airlock from its root, so the scene drives the cycle. */
class AirlockCycle extends Component {
  constructor(airlock) {
    super();
    this.airlock = airlock;
  }

  onUpdate(dt) { this.airlock.update(dt); }
}

export class Airlock extends Corridor {
  static kind = 'Room';

  /**
   * @param {import('../../core/Engine.js').Engine} engine
   * @param {object} [opts]
   * @param {number[]} [opts.position=[0,0,0]]  Floor centre; the back end
   *        sits `length / 2` behind it, on the office's front wall face
   * @param {THREE.Material} [opts.material]    Caller-owned; omit for bare steel
   */
  constructor(engine, { position = [0, 0, 0], material } = {}) {
    const ownsMaterial = !material;
    super(engine, {
      name: 'Airlock',
      length: 3, width: 2.4, height: 3, wallThick: 0.2,
      axis: 'z', ends: ['open', 'doorway'], doorWidth: 1.1, doorHeight: 2.2,
      position,
      material: material ?? new THREE.MeshStandardMaterial({ color: 0x3d423f, metalness: 0.4, roughness: 0.7 }),
    });
    if (ownsMaterial) this._own(this.material);

    /** @type {import('../../gameobjects/Door.js').Door|null} */
    this.hatch = null;
    /** The office's front door, the other half of the interlock.
     *  @type {import('../../gameobjects/Door.js').Door|null} */
    this.innerDoor = null;
    /** @type {import('../../components/EVASuit.js').EVASuit|null} */
    this.suit = null;
    /** Hatch status light — red sealed, amber cycling, green open. @type {THREE.PointLight|null} */
    this.beacon = null;

    /** The dock pedestal (placeholder). @type {import('../../core/GameObject.js').GameObject|null} */
    this.quotaDockGO = null;
    /** The socket seating a whole drive box on the pedestal.
     *  @type {SnapSocket|null} */
    this.quotaSocket = null;
    /** The DriveBoxDock quota counter. @type {DriveBoxDock|null} */
    this.quotaDock = null;

    /** @type {'pressurised'|'depressurising'|'depressurised'|'pressurising'} */
    this.state = 'pressurised';
    /** Seconds to cycle from one door to the other: as long as the pressure
     *  release that plays through it is audible (AirlockSound's
     *  `audibleSeconds` — a test in the scene keeps the two the same). */
    this.cycleTime = 3.1;

    /** Gate on the door ahead: `readyFor('outside' | 'inside')` must say yes
     *  before a finished cycle opens it, so the far side is never opened
     *  onto before it is drawn. Null opens on the cycle alone.
     *  @type {((side: 'outside'|'inside') => boolean)|null} */
    this.readyFor = null;

    this._cycleLeft = 0;
    this._stateListeners = new Set();
    this._lockerUse = null;
    this._beaconLens = null;
    this._offSuit = null;
    this._disposed = false;
  }

  get cycling() {
    return this.state === 'depressurising' || this.state === 'pressurising';
  }

  buildDoors() {
    this.hatch = this.addDoor('ToOutside', 'front', 'Outside', { locked: true });
    this.hatch.lockedPrompt = SHUT.sealed;
  }

  buildLighting() {
    super.buildLighting();

    // Just inside, over the hatch. Small range: it colours the hatch and
    // the end of the passage, not the office behind.
    const beaconGO = this._addGroup('HatchBeacon');
    // On its own battery, off the PowerGrid: the interlock — and the lamp
    // that says which door is safe — must work with the generator off.
    beaconGO.object3d.userData.offGrid = true;
    const y = 2.2 + 0.3;
    const z = this.length / 2 - this.wallThick / 2 - 0.08;

    this.beacon = new THREE.PointLight(BEACON.sealed, 2.0, 4, 2);
    this.beacon.position.set(0, y, z - 0.2);
    beaconGO.object3d.add(this.beacon);

    this._beaconLens = this._own(new THREE.MeshStandardMaterial({
      color: 0x1a1a1a, emissive: BEACON.sealed, emissiveIntensity: 2,
    }));
    const lens = new THREE.Mesh(this._own(new THREE.SphereGeometry(0.07, 12, 8)), this._beaconLens);
    lens.position.set(0, y, z);
    beaconGO.object3d.add(lens);
  }

  buildProps() {
    const inX = this.corridorWidth / 2 - this.wallThick / 2;   // inner face of the side walls
    const locker = this._spawnProp('model:locker', {
      name: 'SuitLocker', position: [-inX + 0.22, 0, 0.25], rotationY: Math.PI / 2, scale: 0.9,
    });

    const airlock = this;
    this._lockerUse = locker.addComponent(new class extends Interactable {
      promptLabel = PROMPT.putOn;
      onInteract() { airlock._useLocker(); }
    }());

    this.root.addComponent(new AirlockCycle(this));

    // Drive-box dock inside the chamber, against the right wall: the
    // night's quota is the saved drives seated in the box docked there.
    this._buildQuotaDock();
  }

  /** A pedestal that receives whole drive boxes. Same chamber spot as the
   *  old loose-drive quota box; SnapSocket seats a carried box on top and
   *  DriveBoxDock counts the saved drives inside it. */
  _buildQuotaDock() {
    const dockSize = [0.42, 0.12, 0.36];
    const inX = this.corridorWidth / 2 - this.wallThick / 2;
    const dockPos = [inX - dockSize[0] / 2 - 0.05, dockSize[1] / 2, 0];
    const dockMat = new THREE.MeshStandardMaterial({
      color: 0x4a3a3a, roughness: 0.6, metalness: 0.3,
      emissive: 0x220000, emissiveIntensity: 0.2,
    });
    this._own(dockMat);

    this.quotaDockGO = this._addStaticBox('QuotaDock', dockPos, dockSize, dockMat);

    // Tooltip on hover (no interact action — just a label)
    const dockTooltip = new Interactable();
    dockTooltip.promptLabel = 'Drive box dock';
    this.quotaDockGO.addComponent(dockTooltip);

    // Slot y: half pedestal + half box height (a DriveBox is 0.12 m tall),
    // so a seated box rests exactly on the pedestal top.
    this.quotaSocket = this.quotaDockGO.addComponent(new SnapSocket({
      snapDistance: 0.35,
      slots: [{ offset: { y: dockSize[1] / 2 + 0.06 } }],
      attachedPromptLabel: '[E] Take drive box',
      canAccept: item => item?.isDriveBox === true,
    }));

    this.quotaDock = this.quotaDockGO.addComponent(new DriveBoxDock({ socket: this.quotaSocket }));
  }

  /** Give the airlock the office door it opens from. It is locked and
   *  unlocked with the cycle from now on, starting with the current state.
   *  @param {import('../../gameobjects/Door.js').Door} door */
  bindInnerDoor(door) {
    this.innerDoor = door;
    this._apply();
  }

  /** Give the airlock the player's suit. The doors, the locker prompt and
   *  the beacon follow it from now on; a previously bound suit is let go.
   *  The airlock settles to the suit's current state without a cycle.
   *  @param {import('../../components/EVASuit.js').EVASuit} suit */
  bindSuit(suit) {
    this._offSuit?.();
    this.suit = suit;
    this._offSuit = suit.onChange(worn => this._cycle(worn));
    this._settle(suit.worn);
  }

  /** Advance the cycle. The room's root calls this every frame.
   *  @param {number} dt  Seconds */
  update(dt) {
    if (this._disposed) return;
    if (this.cycling) {
      this._cycleLeft -= dt;
      const outward = this.state === 'depressurising';
      if (this._cycleLeft <= 0 && (this.readyFor?.(outward ? 'outside' : 'inside') ?? true)) {
        this._settle(outward);
      }
    }
    this._updateLockerLabel();
  }

  /** `listener(state)` on every state change — the scene swaps which side
   *  of the base is drawn on these. @returns {() => void} unsubscribe */
  onStateChange(listener) {
    this._stateListeners.add(listener);
    return () => this._stateListeners.delete(listener);
  }

  /** The suit changed: shut both doors and start cycling towards the other
   *  side. A reversal mid-cycle only has to undo the time already run. */
  _cycle(worn) {
    // Overrun while held by readyFor leaves _cycleLeft negative; a reversal
    // then runs back the whole cycle, never more.
    const run = Math.min(this.cycleTime, this.cycleTime - this._cycleLeft);
    this._cycleLeft = this.cycling ? run : this.cycleTime;
    this.state = worn ? 'depressurising' : 'pressurising';
    this._apply();
    this._emitState();
  }

  _settle(worn) {
    const state = worn ? 'depressurised' : 'pressurised';
    const changed = state !== this.state;
    this.state = state;
    this._cycleLeft = 0;
    this._apply();
    if (changed) this._emitState();
  }

  _emitState() {
    for (const listener of [...this._stateListeners]) listener(this.state);
  }

  /** Put the doors, their prompts and the beacon in step with `state`. */
  _apply() {
    const { cycling } = this;

    this.hatch.locked = this.state !== 'depressurised';
    this.hatch.lockedPrompt = cycling ? SHUT.cycling : SHUT.sealed;

    if (this.innerDoor) {
      this.innerDoor.locked = this.state !== 'pressurised';
      this.innerDoor.lockedPrompt = cycling ? SHUT.cycling : SHUT.depressurised;
    }

    const colour = cycling ? BEACON.cycling
      : this.state === 'depressurised' ? BEACON.open : BEACON.sealed;
    this.beacon.color.setHex(colour);
    this._beaconLens.emissive.setHex(colour);

    this._updateLockerLabel();
  }

  _useLocker() {
    if (!this.suit || !this._wearerInChamber()) return;
    // One change per cycle: wait for the door ahead to open.
    if (this.cycling) return;
    this.suit.toggle();
  }

  /** The suit's wearer stands in the airlock, clear of both doorways. */
  _wearerInChamber() {
    const wearer = this.suit?.gameObject;
    if (!wearer) return false;
    const p = wearer.object3d.getWorldPosition(_wearerPos);
    return this.containsPoint(p)
        && !this.hatch.containsPoint(p, CLEARANCE)
        && !(this.innerDoor?.containsPoint(p, CLEARANCE) ?? false);
  }

  _updateLockerLabel() {
    if (!this._lockerUse) return;
    let label = PROMPT.putOn;
    if (this.suit) {
      label = !this._wearerInChamber() ? PROMPT.stepIn
        : this.cycling ? SHUT.cycling
        : this.suit.worn ? PROMPT.takeOff : PROMPT.putOn;
    }
    this._lockerUse.promptLabel = label;
  }

  dispose(opts) {
    this._offSuit?.();
    this._offSuit = null;
    this.suit = null;
    this.innerDoor = null;
    this.readyFor = null;
    this._stateListeners.clear();
    this._disposed = true;
    super.dispose(opts);
  }
}
