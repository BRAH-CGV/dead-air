import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { Interactable } from './Interactable.js';
import { CameraFeed } from '../gameplay/CameraFeed.js';
import { keyName } from '../app/keyNames.js';
import { LoopVoice } from './LoopVoice.js';
import { CameraTransition } from '../gameplay/CameraTransition.js';

// ─────────────────────────────────────────────
// CameraTerminal  –  Component (attach to the security monitor)
// ─────────────────────────────────────────────
// [E] on the monitor puts the base's security cameras on screen. The frame
// is drawn through the camera's own lens (Engine.viewCamera); the player
// stays at the desk, held still, hearing the office — only the picture moves.
//
//   idle ──[E]──▶ viewing ──Q / Esc / power lost / BaseScene says so──▶ idle
//
// While viewing:
//   A / D, ← / →    pan the camera on screen (within its panRange)
//   W / S, ↑ / ↓    next / previous camera;  1 … 9 that camera
//   the map         click a camera on the overlay's map (overlay.onSelect)
//   F               the camera's flash: a bright spotlight along its view,
//                   out again on F, on a switch, or on leaving the monitor
//   Q / Esc         back to the desk
//
// `hooks.holdPlayer(true)` holds the player still and hands the mouse to the
// page, for the map (BaseScene._usePanel, as for the breaker panel).
//
// Sound (`sounds`, THREE.Audio each, any of them may be missing): the pan
// motor loops faintly while a camera actually turns, the static hisses with
// the switch's grain (CameraTransition.hiss), and the flash clunks as it comes on and as it goes out
// (by F, a switch or leaving — whatever puts it out). They come from the
// monitor's speaker, not the camera, so they aren't placed in the world. The
// audio clock runs on through a pause, so the scene calls silence() then.
//
// A switch (CameraTransition, drawn by CameraSignalPass) freezes the screen
// as it stands, degrades it, and holds it for as long as the zones the new
// camera sees are still loading — the yard is left undrawn while the player
// is indoors (BaseScene._buildOcclusion), so `hooks.setViewZones` asks for
// it and `hooks.isReady` says when it's in (CameraFeed.live). Only then does
// the live picture resolve out of the grain; a long wait says CONNECTING.
// The camera and its zones change one frame after the switch is asked for,
// once the pass has copied the old picture (_showCamera → _applyCamera).
//
// The flash is one SpotLight for every camera, built with the scene (so the
// boot warm-up compiles the lit shaders for it) and moved to whichever
// camera is on screen. It's zeroed when out, never hidden (AGENTS.md). It
// lives on the scene root, not on a camera: a light under a room the
// occlusion sort has hidden drops out of the light list, which recompiles
// every lit shader. It casts no shadow — the shadow maps are frozen.
// ─────────────────────────────────────────────

/** The flash's light. `distance` is each camera's own flashReach. */
export const CAMERA_FLASH = { intensity: 90, angle: 0.55, penumbra: 0.35, decay: 1.4, color: 0xf2f6ff };

/** Levels, against each clip's own: the motor is faint by request. */
export const CAMERA_SOUNDS = { servo: 0.2, static: 0.18, spotlight: 0.4, spotlightOff: 0.4 };

/** How closely the hiss follows the switch's grain (per second, see
 *  LoopVoice): tight, so picture and sound move as one, with just enough
 *  easing to take the click off a frame's step. */
const HISS_FOLLOW = { rateUp: 200, rateDown: 120 };

/** The one-shot sounds; every other one loops. */
const ONE_SHOTS = new Set(['spotlight', 'spotlightOff']);

/** The monitor's prompt while the generator is off. */
const NO_POWER_LABEL = 'No power — restore it at the generator outside';

/** Keys that pan, besides the left / right binds. */
const PAN_LEFT = 'ArrowLeft';
const PAN_RIGHT = 'ArrowRight';
const NEXT = 'ArrowUp';
const PREV = 'ArrowDown';

const _pos = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class CameraTerminal extends Component {
  /** 'idle' | 'viewing' */
  state = 'idle';
  /** The generator is feeding the monitor. Change it through setPowered(). */
  powered = true;

  promptLabel = '[E] Use the security cameras';
  interactRange = 4;

  /** The Interactable on the monitor, so its prompt can say there's no
   *  power. Set by createCameraInteractable(). @type {Interactable|null} */
  _interactable = null;

  /** Whether the flash was lit when last applied: its clunks go with a change. */
  _flashLit = false;

  /**
   * @param {object} opts
   * @param {import('../gameobjects/SecurityCamera.js').SecurityCamera[]} opts.cameras
   * @param {THREE.SpotLight} [opts.flash]  Built by the scene, at intensity 0.
   * @param {import('../ui/CameraOverlay.js').CameraOverlay} [opts.overlay]
   * @param {object} [opts.hooks]
   * @param {(zones: string[]|null) => void} [opts.hooks.setViewZones]
   * @param {(zone: string) => boolean} [opts.hooks.isReady]
   * @param {(held: boolean) => void} [opts.hooks.holdPlayer]  Hold the player
   *        still and free the mouse for the map (true), or give both back.
   * @param {{ show(): void, hide(): void }} [opts.crosshair]
   * @param {{ servo?: THREE.Audio, static?: THREE.Audio, spotlight?: THREE.Audio, spotlightOff?: THREE.Audio }} [opts.sounds]
   * @param {import('../core/CameraSignalPass.js').CameraSignalPass} [opts.signal]  Draws
   *        the switch over the frame. Without one, a switch is immediate.
   */
  constructor({ cameras, flash = null, overlay = null, hooks = {}, crosshair = null, sounds = {}, signal = null }) {
    super();
    this.signal = signal;
    this.cameras = cameras;
    this.flash = flash;
    this.overlay = overlay;
    this.hooks = hooks;
    this.crosshair = crosshair;
    this.sounds = sounds;
    this._static = new LoopVoice({ sound: sounds.static ?? null, ...HISS_FOLLOW });
    /** The switch's timeline: the frozen frame, its grain, the hiss. */
    this.transition = new CameraTransition({
      reducedMotion: typeof matchMedia === 'function' && !!matchMedia('(prefers-reduced-motion: reduce)')?.matches,
    });
    for (const [name, sound] of Object.entries(sounds)) {
      if (!sound) continue;
      sound.setVolume?.(CAMERA_SOUNDS[name] ?? 1);
      if (!ONE_SHOTS.has(name)) sound.setLoop?.(true);
    }
    if (overlay) overlay.onSelect = i => this.select(i);
    this.feed = new CameraFeed({ cameras, isReady: zone => hooks.isReady?.(zone) ?? true });
    if (flash) {
      flash.intensity = 0;
      flash.angle = CAMERA_FLASH.angle;
      flash.penumbra = CAMERA_FLASH.penumbra;
      flash.decay = CAMERA_FLASH.decay;
      flash.color.setHex(CAMERA_FLASH.color);
      flash.castShadow = false;
    }
  }

  get _engine() {
    return this.gameObject?.scene?.userData?.engine ?? null;
  }

  // ──────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────

  /** Sit down at the monitor: the camera last watched, behind static. */
  enter() {
    if (this.state !== 'idle' || !this.powered || !this.cameras.length) return;
    this.state = 'viewing';
    this.hooks.holdPlayer?.(true);
    this.crosshair?.hide();
    this.overlay?.show();
    this.overlay?.setHint(this._hint());
    this.feed.open();
    // Nothing worth freezing yet — it would be the desk — so the cover is
    // grain over black, behind the monitor's overlay.
    this._showCamera({ blank: true });
  }

  /** Back to the desk: the player's own eyes, the zones as the airlock
   *  has them, the flash out. */
  exit() {
    if (this.state === 'idle') return;
    this.state = 'idle';
    this.feed.close();
    this._applyFlash();
    this.silence();
    this.signal?.cancel();
    this.transition.reset();
    this.signal?.set(this.transition);
    this.overlay?.setConnecting(false);
    const engine = this._engine;
    if (engine) engine.viewCamera = null;
    this.hooks.setViewZones?.(null);
    this.overlay?.hide();
    this.crosshair?.show();
    this.hooks.holdPlayer?.(false);
  }

  /** Put camera `i` on screen (the map's buttons). Ignored away from the
   *  monitor, or for a camera there isn't. */
  select(i) {
    if (this.state !== 'viewing') return;
    const before = this.feed.index;
    this.feed.select(i);
    if (this.feed.index !== before) this._showCamera();
  }

  /** Stop the loops. The next frame starts again whatever is still wanted. */
  silence() {
    this._loop(this.sounds.servo, false);
    this._static.silence();
  }

  /** The power came or went; losing it drops the picture. */
  setPowered(powered) {
    this.powered = powered;
    if (this._interactable) this._interactable.promptLabel = powered ? this.promptLabel : NO_POWER_LABEL;
    if (!powered) this.exit();
  }

  // ──────────────────────────────────────────
  // Per frame
  // ──────────────────────────────────────────

  onUpdate(dt) {
    if (this.state !== 'viewing') return;
    const engine = this._engine;
    if (!engine) return;
    const { keys, pressed } = engine.input;
    const kb = engine.keyBinds;

    // pressed: a tap let go before this frame.
    if (keys.KeyQ || pressed.KeyQ || pressed.Escape) {
      this.exit();
      return;
    }

    // Switching: a number, or a step either way.
    const before = this.feed.index;
    for (let n = 1; n <= 9; n++) if (pressed[`Digit${n}`] || pressed[`Numpad${n}`]) this.feed.select(n - 1);
    if (pressed[kb.forward] || pressed[NEXT]) this.feed.next();
    if (pressed[kb.back] || pressed[PREV]) this.feed.prev();
    if (this.feed.index !== before) this._showCamera();

    // Panning, held.
    const left  = keys[kb.left]  || keys[PAN_LEFT];
    const right = keys[kb.right] || keys[PAN_RIGHT];
    const was = this.feed.panOf(this.feed.index);
    this.feed.pan((left ? 1 : 0) - (right ? 1 : 0), dt);
    const cam = this.cameras[this.feed.index];
    cam.setPan(this.feed.panOf(this.feed.index));
    // The motor runs while the camera turns — not against the end stop.
    this._loop(this.sounds.servo, this.feed.panOf(this.feed.index) !== was);

    // The flash — and the press is used up, or the torch in the player's
    // hand would switch with it.
    if (pressed[kb.flashlight]) {
      this.feed.toggleFlash();
      engine.consumeAction?.('flashlight');
      this.overlay?.setFlash(this.feed.flash);
    }

    // The lens matches the screen and the render distance (Settings).
    const lens = cam.lens;
    if (lens.aspect !== engine.camera.aspect || lens.far !== engine.camera.far) {
      lens.aspect = engine.camera.aspect;
      lens.far = engine.camera.far;
      lens.updateProjectionMatrix();
    }

    this.feed.update(dt);
    this.transition.update(dt, this.feed.live);
    this.signal?.set(this.transition);
    this.signal?.tick(dt);
    this.overlay?.setConnecting(this.transition.waitingLong);
    this._static.set(CAMERA_SOUNDS.static * this.transition.hiss, dt);
    this._applyFlash();
  }

  // ──────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────

  /** A switch to the feed's camera: the label at once, the switch's
   *  timeline from the top, and the picture once the screen as it stands
   *  has been captured — the pass copies it after this frame is drawn, then
   *  runs _applyCamera. Without a pass, or with `blank` (sitting down:
   *  nothing to freeze, grain over black instead), at once. */
  _showCamera({ blank = false } = {}) {
    const cam = this.cameras[this.feed.index];
    this.overlay?.setCamera({ index: this.feed.index, count: this.cameras.length, label: cam.label });
    this.overlay?.setFlash(false);
    this.transition.cut({ blank });
    // Handed over before this frame is drawn: a blank cover is opaque from
    // the first frame, so the camera can go on screen under it at once.
    this.signal?.set(this.transition);
    if (this.signal && !blank) this.signal.capture(() => this._applyCamera());
    else this._applyCamera();
  }

  /** Draw through the feed's camera, and ask for the zones it sees. Only
   *  while still at the monitor: a switch dropped by leaving does nothing. */
  _applyCamera() {
    if (this.state !== 'viewing') return;
    const cam = this.cameras[this.feed.index];
    const engine = this._engine;
    if (engine) engine.viewCamera = cam.lens;
    this.hooks.setViewZones?.(cam.zones);
    this._applyFlash();
  }

  /** Start or stop a looping sound. */
  _loop(sound, on) {
    if (!sound) return;
    if (on && !sound.isPlaying) sound.play();
    else if (!on && sound.isPlaying) sound.stop();
  }

  /** Play a sound from its start, cutting itself off if it is still going. */
  _oneShot(sound) {
    if (!sound) return;
    if (sound.isPlaying) sound.stop();
    sound.play();
  }

  /** Light the flash on the camera on screen, aimed down its view — or zero
   *  it. Its clunk on or off goes with the change, whatever made it. */
  _applyFlash() {
    const lit = this.feed.active && this.feed.flash;
    if (lit !== this._flashLit) {
      this._flashLit = lit;
      if (lit) this._oneShot(this.sounds.spotlight);
      else {
        // Going out cuts the coming-on short.
        if (this.sounds.spotlight?.isPlaying) this.sounds.spotlight.stop();
        this._oneShot(this.sounds.spotlightOff);
      }
    }
    const light = this.flash;
    if (!light) return;
    if (!lit) {
      light.intensity = 0;
      return;
    }
    const cam = this.cameras[this.feed.index];
    cam.lens.getWorldPosition(_pos);
    cam.lens.getWorldDirection(_dir);
    light.position.copy(_pos);
    light.target.position.copy(_pos).add(_dir);
    light.distance = cam.flashReach;
    light.intensity = CAMERA_FLASH.intensity;
    light.updateMatrixWorld();
    light.target.updateMatrixWorld();
  }

  _hint() {
    const kb = this._engine?.keyBinds ?? {};
    const k = (action, fallback) => keyName(kb[action] ?? fallback);
    return `${k('left', 'KeyA')}/${k('right', 'KeyD')}: pan · ${k('forward', 'KeyW')}/${k('back', 'KeyS')} or 1–${this.cameras.length}: switch camera · `
      + `click the map · ${k('flashlight', 'KeyF')}: flash · Q: exit`;
  }
}

/** A ready-to-attach Interactable that opens the terminal. */
export function createCameraInteractable(terminal) {
  const interact = new class extends Interactable {
    promptLabel = terminal.powered ? terminal.promptLabel : NO_POWER_LABEL;
    interactRange = terminal.interactRange;
    onInteract() { terminal.enter(); }
  }();
  terminal._interactable = interact;
  return interact;
}
