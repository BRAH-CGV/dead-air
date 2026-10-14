// ─────────────────────────────────────────────
// ProcessingScreen  –  Signal processing console overlay
// ─────────────────────────────────────────────
// A DOM overlay (same pattern as RadarOverlay / BreakerPanel) shown when
// the player interacts with the ServerRoom processing console. Displays
// the signal image from the inserted drive and an abstract set of controls
// (buttons, sliders, knobs …) below it.
//
// The controls are described by an array of action objects:
//   { id, label, enabled, onClick, render? }
// The default renderer creates a <button>; a custom `render(container, action)`
// hook lets callers draw sliders, knobs or any other widget.
//
// The screen opens even with no drive inserted — the preview area stays
// blank and every action starts disabled.
// ─────────────────────────────────────────────

import { FirstPersonController } from '../components/FirstPersonController.js';

export class ProcessingScreen {
  /** @type {import('../gameplay/SignalManager.js').SignalManager|null} */
  signalManager = null;

  /** Engine reference for input locking. Set by the scene that owns it. */
  _engine = null;

  /** The actions currently rendered, so refreshActions can re-evaluate. */
  _actions = [];

  /** The drive passed to the last open() call. */
  _drive = null;

  /** Key handler for Q-to-close. */
  _keyHandler = null;

  constructor(root = typeof document !== 'undefined' ? document.getElementById('processing-screen') : null) {
    this.root = root;
    this._image   = root?.querySelector('#processing-image')   ?? null;
    this._controls = root?.querySelector('#processing-controls') ?? null;
    this._hint    = root?.querySelector('#processing-hint')    ?? null;
    this._title   = root?.querySelector('#processing-title')   ?? null;
  }

  /** Wire the engine so open/close can lock input and hide the crosshair.
   *  @param {import('../core/Engine.js').Engine} engine */
  setEngine(engine) { this._engine = engine; }

  /** Open the screen. `drive` may be null (blank preview). `actions` is an
   *  array of abstract control descriptors.
   *  @param {object|null} drive
   *  @param {Array<{id:string, label:string, enabled:boolean, onClick?:function, render?:function}>} actions */
  open(drive, actions = []) {
    if (!this.root) return;
    this._drive = drive;
    this._actions = actions;
    this._updateImage(drive);
    this._renderActions(actions);
    this.root.style.display = 'flex';
    this._lockInput(true);
    this._installKeyHandler();
  }

  /** Close the screen and restore input. */
  close() {
    if (!this.root) return;
    this.root.style.display = 'none';
    this._clearImage();
    this._clearActions();
    this._lockInput(false);
    this._removeKeyHandler();
    this._drive = null;
    this._actions = [];
  }

  /** Re-render the controls with updated enabled/label state. Call after
   *  an action changes the drive (e.g. upgrade). */
  refreshActions(drive) {
    this._drive = drive;
    this._updateImage(drive);
    this._renderActions(this._actions);
  }

  /** Stop listening for keys and drop references. The DOM element lives
   *  on (index.html), but scene-rebuild safety requires cleanup. */
  dispose() {
    this.close();
    this._engine = null;
    this.signalManager = null;
  }

  // ── Internals ──────────────────────────────────────────────

  /** Look up the signal's payload URL and show it, or clear the image. */
  _updateImage(drive) {
    if (!this._image) return;
    const url = this._payloadUrl(drive);
    if (url) {
      this._image.src = url;
      this._image.style.display = '';
    } else {
      this._image.src = '';
      this._image.style.display = 'none';
    }
  }

  _clearImage() {
    if (!this._image) return;
    this._image.src = '';
    this._image.style.display = 'none';
  }

  /** Resolve the payload URL from the drive's signalIndex via the
   *  SignalManager. Returns '' if nothing can be shown. */
  _payloadUrl(drive) {
    if (!drive?.saved || drive.signalIndex == null) return '';
    const mgr = this.signalManager;
    if (!mgr) return '';
    const sig = mgr.signals.find(s => s.id === drive.signalIndex);
    return sig?.payloadUrl ?? '';
  }

  /** Render the action descriptors into the controls container. Each
   *  action with a custom `render` hook gets it called; otherwise a
   *  default <button> is created. */
  _renderActions(actions) {
    if (!this._controls) return;
    this._clearActions();
    for (const action of actions) {
      if (typeof action.render === 'function') {
        action.render(this._controls, action);
      } else {
        const btn = document.createElement('button');
        btn.className = 'processing-btn';
        btn.textContent = action.label;
        btn.disabled = !action.enabled;
        btn.dataset.actionId = action.id;
        if (action.enabled && typeof action.onClick === 'function') {
          btn.addEventListener('click', action.onClick);
        }
        this._controls.appendChild(btn);
      }
    }
  }

  _clearActions() {
    if (!this._controls) return;
    // Remove click listeners by replacing the contents wholesale.
    this._controls.innerHTML = '';
  }

  /** Lock or unlock player movement (WASD + mouse look) while the screen
   *  is open. Mirrors BaseScene._usePanel: releases pointer lock so the
   *  cursor is visible for clicking buttons, and tells the App layer the
   *  mouse is in use (no pause on lock loss). */
  _lockInput(locked) {
    if (!this._engine?.player) return;
    const ctrl = this._engine.player.getComponent(FirstPersonController);
    if (ctrl) ctrl.inputLocked = locked;
    // Tell the app layer the lock is being let go on purpose (no pause).
    this._engine.uiHasMouse = locked;
    // Hide the first-person reticle while the overlay is showing.
    if (this._engine.crosshair) {
      locked ? this._engine.crosshair.hide() : this._engine.crosshair.show();
    }
    // Release / re-request pointer lock so the cursor is visible for buttons.
    const canvas = this._engine.renderer?.domElement;
    if (locked) {
      if (typeof document !== 'undefined' && document.pointerLockElement) {
        document.exitPointerLock?.();
      }
    } else {
      try { canvas?.requestPointerLock?.()?.catch?.(() => {}); } catch (_) { /* no gesture: the next click locks */ }
    }
  }

  _installKeyHandler() {
    this._removeKeyHandler();
    this._keyHandler = (e) => {
      if (e.code === 'KeyQ') {
        e.preventDefault();
        this.close();
      }
    };
    addEventListener('keydown', this._keyHandler);
  }

  _removeKeyHandler() {
    if (this._keyHandler) {
      removeEventListener('keydown', this._keyHandler);
      this._keyHandler = null;
    }
  }
}
