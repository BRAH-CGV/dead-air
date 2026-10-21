import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { Interactable } from './Interactable.js';
import { CameraFeed } from '../gameplay/CameraFeed.js';
import { keyName } from '../app/keyNames.js';
import { LoopVoice } from './LoopVoice.js';
import { CameraTransition } from '../gameplay/CameraTransition.js';
import { FEED } from '../core/FeedDisplay.js';

// ─────────────────────────────────────────────
// CameraTerminal  –  Component (attach to the security monitor)
// ─────────────────────────────────────────────
// The monitor on the desk's left wing always shows a security camera: its
// picture is drawn into a small target and shown on the monitor's screen in
// the world (FeedDisplay). [E] on it leans the view in to that screen
// (ScreenView) and lays the overlay — the label, the controls, the map — on
// it; the player stays at the desk, held still.
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
// the switch's grain (CameraTransition.hiss), and the flash clicks as it comes on and as it goes out
// (by F, a switch or leaving — whatever puts it out). They come from the
// monitor's speaker, not the camera, so they aren't placed in the world. The
// audio clock runs on through a pause, so the scene calls silence() then.
//
// The speaker also plays everything the camera on screen hears, as if the
// player stood there: `hooks.listenFrom(lens, level)` every frame (the
// scene moves the ears onto the lens, through a MonitorSpeaker). The level
// is cut under the static of a switch and comes back as the picture does
// (1 - hiss), so a lost signal is lost sound too; leaving says
// listenFrom(null, 0).
//
// A new picture is drawn (display.want()) every frame while leaned in, and
// FEED.idleFps times a second from across the room — only while
// `hooks.seen()` says the monitor is in view. A switch (CameraTransition,
// drawn by the screen's shader) holds the last picture by drawing no new
// one: it freezes, degrades, and holds for at least CCTV.minStatic (longer
// while `hooks.isReady` says a zone is still loading, if given; a long wait
// says CONNECTING), then the new camera's picture resolves out of the grain.
// The yard the outdoor cameras see is drawn for their picture alone
// (OcclusionZones.drawFor): the player's own frame stays culled.
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
export const CAMERA_SOUNDS = { servo: 0.14, static: 0.18, spotlight: 0.4, spotlightOff: 0.4, glitch: 0.55 };

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

  /** Whether the flash was lit when last applied: its clicks go with a change. */
  _flashLit = false;

  /** The camera actually drawn — a switch changes it a frame late. */
  _onAir = null;

  /**
   * @param {object} opts
   * @param {import('../gameobjects/SecurityCamera.js').SecurityCamera[]} opts.cameras
   * @param {THREE.SpotLight} [opts.flash]  Built by the scene, at intensity 0.
   * @param {import('../ui/CameraOverlay.js').CameraOverlay} [opts.overlay]
   * @param {object} [opts.hooks]
   * @param {(zone: string) => boolean} [opts.hooks.isReady]  A zone is in,
   *        for the switch to wait on; left out, every zone is.
   * @param {() => boolean} [opts.hooks.seen]  The monitor can be seen, so
   *        its picture is worth drawing from across the room.
   * @param {(held: boolean) => void} [opts.hooks.holdPlayer]  Hold the player
   *        still and free the mouse for the map (true), or give both back.
   * @param {(lens: THREE.Object3D|null, level: number) => void} [opts.hooks.listenFrom]
   *        What the monitor's speaker hears from, and how loud (0..1); null
   *        for the player's own ears.
   * @param {{ show(): void, hide(): void }} [opts.crosshair]
   * @param {{ servo?: THREE.Audio, static?: THREE.Audio, spotlight?: THREE.Audio, spotlightOff?: THREE.Audio }} [opts.sounds]
   * @param {import('../core/FeedDisplay.js').FeedDisplay} [opts.display]  The
   *        monitor's picture: the camera on it, the switch drawn by its shader.
   * @param {import('./ScreenView.js').ScreenView} [opts.screenView]  Leans in
   *        to `screen`, the monitor's, with the overlay on it.
   */
  constructor({ cameras, flash = null, overlay = null, hooks = {}, crosshair = null, sounds = {}, display = null, screenView = null, screen = null }) {
    super();
    this.display = display;
    this.screenView = screenView;
    this.screen = screen;
    /** Seconds since the last picture from across the room. */
    this._sinceFrame = Infinity;
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
    // The monitor shows the camera last watched, from the start.
    this._onAir = 0;
    display?.show(cameras[0] ?? null);
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
    // The picture is on the monitor already: no switch, just lean in.
    this._applyCamera();
    this.overlay?.setCamera(this._label());
    this.display?.setDetail('close');
    if (this.screenView && this.screen) this.screenView.open(this.screen, this.overlay?.root ?? null);
  }

  /** Back to the desk: the player's own eyes and ears, the flash out. The
   *  monitor goes on showing the camera. */
  exit() {
    if (this.state === 'idle') return;
    this.state = 'idle';
    this.feed.close();
    this._applyFlash();
    this.silence();
    this.transition.reset();
    this.display?.set(this.transition);
    this.display?.setDetail('idle');
    this.overlay?.setConnecting(false);
    this.hooks.listenFrom?.(null, 0);
    // On the screen, the overlay stays up while the view leans back out.
    if (this.screenView && this.screen) this.screenView.close(() => this.overlay?.hide());
    else this.overlay?.hide();
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

  /** The camera actually on screen: its index, whether its picture is in
   *  (not covered by a switch), and whether its flash is lit. Null away from
   *  the monitor. Ragno reads it to know when a flash is on him. */
  get onAir() {
    if (this.state !== 'viewing' || this._onAir === null) return null;
    const index = this._onAir;
    return {
      index,
      camera: this.cameras[index],
      live: this.feed.live && this.feed.index === index && this.transition.phase !== 'drop' && this.transition.phase !== 'wait',
      flash: this.feed.flash && this.feed.index === index,
    };
  }

  /**
   * Camera `i`'s picture breaks up under static for `seconds` — only if it
   * is the one on screen. Something has reached a vent in front of it.
   * @returns {boolean} whether it was on screen
   */
  interfere(i, seconds) {
    if (this.state !== 'viewing' || this._onAir !== i) return false;
    this.transition.glitch(seconds);
    this.display?.set(this.transition);
    return true;
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
    this.display?.setPowered(powered);
    if (!powered) this.exit();
  }

  // ──────────────────────────────────────────
  // Per frame
  // ──────────────────────────────────────────

  onUpdate(dt) {
    if (this.state === 'viewing') this._watch(dt);
    if (this.state === 'viewing') this._applyFlash();
    this.display?.set(this.transition);
    this.display?.tick(dt);
    this._schedule(dt);
  }

  /** At the monitor: the keys, the switch, the sound. */
  _watch(dt) {
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

    // The lens sees as far as the player does (Settings).
    const lens = cam.lens;
    if (lens.far !== engine.camera.far) {
      lens.far = engine.camera.far;
      lens.updateProjectionMatrix();
    }

    this.feed.update(dt);
    this.transition.update(dt, this.feed.live);
    this.overlay?.setConnecting(this.transition.waitingLong);
    // A glitch (something at a vent) hisses louder than a switch: the
    // camera's own sound is cut under it (listenFrom, below), storm or not.
    const hissLevel = this.transition.phase === 'glitch' ? CAMERA_SOUNDS.glitch : CAMERA_SOUNDS.static;
    this._static.set(hissLevel * this.transition.hiss, dt);
    if (this._onAir !== null) this.hooks.listenFrom?.(this.cameras[this._onAir].lens, 1 - this.transition.hiss);
  }

  /** Whether the monitor gets a new picture after this frame: every frame
   *  leaned in, idleFps times a second from across the room while it can
   *  be seen, and never while a switch holds the last one. */
  _schedule(dt) {
    if (!this.display || !this.powered || this.transition.frozen) return;
    if (this.state === 'viewing') {
      this.display.want();
      return;
    }
    this._sinceFrame += dt;
    if (this._sinceFrame < 1 / FEED.idleFps) return;
    if (!(this.hooks.seen?.() ?? true)) return;
    this._sinceFrame = 0;
    this.display.want();
  }

  // ──────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────

  /** A switch to the feed's camera: the label at once, and the switch's
   *  timeline from the top. The new camera goes on the monitor at once; the
   *  switch holds the last picture (no new one is drawn) until it resolves. */
  _showCamera() {
    this.overlay?.setCamera(this._label());
    this.overlay?.setFlash(false);
    this.transition.cut();
    this.display?.set(this.transition);
    this._applyCamera();
  }

  /** The feed's camera on the monitor. */
  _applyCamera() {
    this._onAir = this.feed.index;
    this.display?.show(this.cameras[this._onAir]);
    this._applyFlash();
  }

  _label() {
    const cam = this.cameras[this.feed.index];
    return { index: this.feed.index, count: this.cameras.length, label: cam.label };
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
   *  it. Its click on or off goes with the change, whatever made it. */
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
