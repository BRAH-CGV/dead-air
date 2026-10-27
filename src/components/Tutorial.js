import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { TutorialRunner } from '../gameplay/TutorialSteps.js';
import { NAP } from '../gameplay/Nap.js';
import { placeArrow } from '../ui/TutorialOverlay.js';

// ─────────────────────────────────────────────
// Tutorial  –  night 0 played out on the live scene
// ─────────────────────────────────────────────
// Night 0 is the tutorial (TutorialSteps holds the steps). This component
// reads what the player has done off the scene each frame, moves the steps
// on, and shows them: big words and an arrow (TutorialOverlay). It does
// nothing on any other night.
//
// The night is bent to teach one thing at a time:
//   - The clock holds at 7 PM, after dark, until the quota is met, so
//     there is no hurry and no signal of the shift's own comes up.
//   - One signal, placed off the dish's park so it has to be found,
//     comes up once the player is at the computer and never fades. Saved,
//     it is carried to the server room's processing console and processed
//     (cyan) before it is boxed; the words stay up, small, over the console.
//   - Stamina is held full, so the Sleep Demon never comes.
//   - No storm, dust eyes or UFO of their own (they stay off on night 0);
//     the storm step summons one whose outage is forced (StormOutage.force).
//   - The nap step sets the bunk's alarm to 6 AM, so one nap sees the
//     night out.
//   - In the morning the box goes in the buggy's boot and the buggy is
//     sent off (the bunk waits for it); the words hide through the cutscene.
//
// Subscribes in onStart and reads the controller's night there, like
// Sandstorm: New game sets night 0 before the scene's first frame.
// ─────────────────────────────────────────────

export const TUTORIAL = Object.freeze({
  night: 0,
  /** 7 PM: dark, and before any signal of the shift's own (APPEAR_START). */
  startHour: -5,
  /** How far through the tutorial's storm its outage comes. */
  outageAt: 0.1,
  /** The one signal: off the dish's park (45°, −55°) by more than a
   *  signal's reach, so the cursor has to be moved onto it. */
  signal: Object.freeze({ yaw: Math.PI / 4 + 0.6, pitch: -0.6 }),
  /** Where a retry of night 0 starts, past the story. */
  retryStep: 'deskBox',
});

export class Tutorial extends Component {
  /**
   * @param {object} opts
   * @param {object} opts.controller     GameController: state, nightNumber, onNightStart
   * @param {object} opts.clock          NightClock: setTime, pause, resume
   * @param {object} [opts.stamina]      Held full on night 0
   * @param {object} [opts.signalManager]
   * @param {object} [opts.terminal]     ComputerTerminal: state, _hoveredSignal
   * @param {object} [opts.driveManager]
   * @param {Array}  [opts.drives]       The office's drives
   * @param {Array}  [opts.driveBoxes]   The office's drive boxes
   * @param {object} [opts.quotaDock]    The airlock's DriveBoxDock
   * @param {object} [opts.serverSlot]   The processing console's DriveSlot: insertedDrive
   * @param {object} [opts.processingScreen]  ProcessingScreen: isOpen
   * @param {object} [opts.grid]         PowerGrid
   * @param {object} [opts.suit]         EVASuit
   * @param {object} [opts.nap]
   * @param {object} [opts.bed]          The bunk's Bed: its napLength is set to 6 AM
   * @param {object} [opts.bedRest]
   * @param {object} [opts.cargoDock]    The buggy boot's DriveBoxDock: depositedBox
   * @param {object} [opts.sendOff]      BuggySendOff: active through the cutscene
   * @param {object} [opts.flashlight]   The player's Flashlight: on
   * @param {(p: THREE.Vector3) => boolean} [opts.onDesk]  A world point is on the computer desk
   * @param {object} [opts.sandstorm]
   * @param {object} [opts.stormOutage]
   * @param {object} [opts.overlay]      TutorialOverlay
   * @param {THREE.Camera} [opts.camera] The player's camera, for the arrow
   * @param {() => { width: number, height: number }} [opts.screen]
   * @param {() => boolean} [opts.covered]  A panel covers the view (the
   *        generator's breakers): the words and arrow hide, the steps run on.
   *        Ignored while the processing console's screen is up: its step is
   *        shown over it
   * @param {Object<string, { object: THREE.Object3D|(() => THREE.Object3D|null), lift?: number }>} [opts.targets]
   *        What each step's arrow points at, by name; `lift` raises the
   *        point (metres) off the object's origin.
   */
  constructor({
    controller, clock, stamina = null, signalManager = null, terminal = null,
    driveManager = null, drives = [], driveBoxes = [], quotaDock = null, grid = null,
    serverSlot = null, processingScreen = null,
    suit = null, nap = null, bed = null, bedRest = null, cargoDock = null, sendOff = null,
    flashlight = null, onDesk = null,
    sandstorm = null, stormOutage = null,
    overlay = null, camera = null, screen = null, covered = null, targets = {},
  }) {
    super();
    Object.assign(this, {
      controller, clock, stamina, signalManager, terminal, driveManager, drives,
      driveBoxes, quotaDock, grid, serverSlot, processingScreen,
      suit, nap, bed, bedRest, cargoDock, sendOff, flashlight, onDesk,
      sandstorm, stormOutage, overlay, camera, targets,
    });
    this.screen = screen ?? (() => this._windowSize());
    this.covered = covered ?? (() => false);
    this.active = false;
    this.runner = new TutorialRunner({ onEnter: step => this._enter(step) });
    this._signal = null;
    this._off = null;
    this._ctx = {
      holdingBox: false, boxOnDesk: false,
      driveIn: false, terminalOpen: false, onSignal: false, scanning: false, scanned: false,
      saved: false, driveAtConsole: false, consoleOpen: false, processed: false,
      boxed: false, quotaMet: false, powerOn: true, flashlightOn: false,
      suitOn: false, napping: false, morning: false, boxInBuggy: false, dispatched: false,
    };
    this._v = new THREE.Vector3();
    this._ndc = { x: 0, y: 0, behind: false };
    this._placement = { x: 0, y: 0, angle: 0, onScreen: false };
    this._size = { width: 1, height: 1 };
  }

  onStart() {
    this._off = this.controller.onNightStart?.((night, opts) => this._begin(night, opts)) ?? null;
    this._begin(this.controller.nightNumber);
  }

  onDestroy() {
    this._off?.();
    this._off = null;
    this.overlay?.hide();
  }

  /** A night starts (or is retried): on for night 0, off for the rest. */
  _begin(night, { retry = false } = {}) {
    this.active = night === TUTORIAL.night;
    if (!this.active) {
      this.overlay?.hide();
      return;
    }
    this.clock.setTime(TUTORIAL.startHour);
    this.clock.pause();
    this._setUpSignal();
    this.runner.reset();
    if (retry) this.runner.goTo(TUTORIAL.retryStep);
  }

  /** The night's signals cut to one, placed, hidden until the player is
   *  at the computer, and never fading once shown. */
  _setUpSignal() {
    const signals = this.signalManager?.signals;
    this._signal = null;
    if (!signals?.length) return;
    signals.length = 1;
    const sig = signals[0];
    sig.yaw = TUTORIAL.signal.yaw;
    sig.pitch = TUTORIAL.signal.pitch;
    sig.appearAt = Infinity;          // only the tutorial shows it
    sig.appeared = false;
    sig.fadeElapsed = 0;
    sig.visibleSeconds = Infinity;
    this._signal = sig;
  }

  _enter(step) {
    switch (step.id) {
      case 'aim':
        if (this._signal) this._signal.appeared = true;
        break;
      case 'quota':
        this.clock.resume();
        break;
      case 'storm':
        this.sandstorm?.summon?.();
        this.stormOutage?.force?.(TUTORIAL.outageAt);
        break;
      case 'nap':
        if (this.bed) this.bed.napLength = NAP.lengths.indexOf(null);
        break;
    }
  }

  onUpdate(dt) {
    if (!this.active) return;
    this.stamina?.reset();
    const state = this.controller.state;
    if (state !== 'playing' && state !== 'morning') {
      this.overlay?.hide();
      return;
    }
    const ctx = this.readContext();
    this.runner.update(dt, ctx);
    // In the bunk the view is dark, a panel (the breakers) has it, or the
    // send-off's cutscene does: nothing to read. The processing console's
    // screen has the mouse too, but its step is shown over it, small.
    if (this.bedRest?.active || this.sendOff?.active || (this.covered() && !ctx.consoleOpen)) {
      this.overlay?.hide();
      return;
    }
    const view = this.runner.view(ctx);
    this.overlay?.show(view);
    this.overlay?.setArrow(view.target ? this._place(view.target) : null);
  }

  /** What the player has done, read off the scene. One object, rewritten. */
  readContext() {
    const c = this._ctx;
    const t = this.terminal;
    const sig = this._signal;
    this._readBoxes(c);
    c.driveIn = !!this.driveManager?.driveInserted;
    c.terminalOpen = !!t && t.state !== 'idle';
    c.onSignal = !!sig && t?._hoveredSignal === sig;
    c.scanning = t?.state === 'scanning';
    c.scanned = !!sig?.scanned;
    c.saved = !!sig?.saved || this._anyDrive(this.drives);
    const atConsole = this.serverSlot?.insertedDrive;
    c.driveAtConsole = !!atConsole?.saved && !atConsole.corrupted;
    c.consoleOpen = !!this.processingScreen?.isOpen;
    c.processed = this._processed(this.drives);
    c.quotaMet = !!this.quotaDock?.isQuotaMet();
    c.boxed = c.quotaMet || this._boxed();
    c.powerOn = !!this.grid?.on;
    c.flashlightOn = !!this.flashlight?.on;
    c.suitOn = !!this.suit?.worn;
    c.napping = !!(this.nap?.napping || this.bedRest?.active);
    c.morning = this.controller.state === 'morning';
    c.boxInBuggy = !!this.cargoDock?.depositedBox;
    c.dispatched = !!this.controller.dispatched;
    return c;
  }

  /** Is a drive box in the player's hands, and is one set down on the desk. */
  _readBoxes(c) {
    c.holdingBox = false;
    c.boxOnDesk = false;
    for (let i = 0; i < this.driveBoxes.length; i++) {
      const box = this.driveBoxes[i];
      if (box.pickupable?.held) c.holdingBox = true;
      else if (this.onDesk?.(box.object3d.getWorldPosition(this._v))) c.boxOnDesk = true;
    }
  }

  /** A drive in the list holds a good signal. */
  _anyDrive(drives) {
    for (let i = 0; i < drives.length; i++) {
      const d = drives[i];
      if (d?.saved && !d.corrupted) return true;
    }
    return false;
  }

  /** A drive in the list holds a good signal processed past level 1 (cyan). */
  _processed(drives) {
    for (let i = 0; i < drives.length; i++) {
      const d = drives[i];
      if (d?.saved && !d.corrupted && (d.signalLevel ?? 1) >= 2) return true;
    }
    return false;
  }

  /** A good signal sits in one of the office's drive boxes. */
  _boxed() {
    for (let i = 0; i < this.driveBoxes.length; i++) {
      const slots = this.driveBoxes[i].receiver?.attachments ?? [];
      for (let j = 0; j < slots.length; j++) {
        const d = slots[j]?.item;
        if (d?.saved && !d.corrupted) return true;
      }
    }
    return false;
  }

  /** Where the arrow goes for the target `name`; null when there is none. */
  _place(name) {
    const target = this.targets[name];
    const object = typeof target?.object === 'function' ? target.object() : target?.object;
    if (!object || !this.camera) return null;
    const v = object.getWorldPosition(this._v);
    v.y += target.lift ?? 0;
    v.applyMatrix4(this.camera.matrixWorldInverse);
    this._ndc.behind = v.z > 0;
    v.applyMatrix4(this.camera.projectionMatrix);
    this._ndc.x = v.x;
    this._ndc.y = v.y;
    const { width, height } = this.screen();
    return placeArrow(this._ndc, width, height, this._placement);
  }

  _windowSize() {
    if (typeof window !== 'undefined') {
      this._size.width = window.innerWidth;
      this._size.height = window.innerHeight;
    }
    return this._size;
  }
}
