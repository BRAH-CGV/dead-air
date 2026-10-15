import { Interactable } from './Interactable.js';
import { journalEntry } from '../gameplay/journal.js';

// ─────────────────────────────────────────────
// Journal  –  the notebook on the bedroom desk (#79)
// ─────────────────────────────────────────────
// [E] opens tonight's entry (gameplay/journal.js) on the paper panel. While
// it's open, time runs slow (engine.timeScale) and the player stands still;
// a fresh [E], or [Q] as at the terminal, puts it down. The notebook's
// cover glows until tonight's entry has been read, so a new player finds it
// on night 1 and a new entry is never missed.
//
// The room puts it on the notebook; the scene hands it the controller (for
// the night) and the panel, since rooms don't know about gameplay:
//
//   rooms.LivingQuarters.journal.controller = gameController;
//   rooms.LivingQuarters.journal.panel      = new JournalPanel();
// ─────────────────────────────────────────────

/** How fast time runs while the journal is open. */
export const READING_TIME_SCALE = 0.25;

/** The unread glow: emissive intensity swings between these, PULSE times a second-ish. */
const GLOW_MIN = 0.15;
const GLOW_MAX = 0.75;
const PULSE = 3;

export class Journal extends Interactable {
  promptLabel = '[E] Read the journal';
  interactRange = 2.5;

  /** @type {import('../gameplay/GameController.js').GameController|null} */
  controller = null;
  /** @type {import('../ui/JournalPanel.js').JournalPanel|null} */
  panel = null;
  /** The notebook's own material, for the unread glow. @type {THREE.MeshStandardMaterial|null} */
  material = null;

  /** True while the page is up. */
  open = false;

  /** Nights whose entry has been read. */
  _read = new Set();
  _glowTime = 0;
  /** The press that opened it is still down: wait for it to come up. */
  _waitRelease = false;

  onInteract() {
    if (this.open) return;
    const night = this._night();
    this.open = true;
    this._read.add(night);
    this._waitRelease = true;
    this.panel?.show(journalEntry(night));
    const engine = this._engine();
    if (engine) {
      engine.timeScale = READING_TIME_SCALE;
      if (engine.playerController) engine.playerController.inputLocked = true;
    }
  }

  /** Put it down: the page away, time and the player back to normal. */
  close() {
    if (!this.open) return;
    this.open = false;
    this.panel?.hide();
    const engine = this._engine();
    if (engine) {
      engine.timeScale = 1;
      if (engine.playerController) engine.playerController.inputLocked = false;
    }
  }

  onUpdate(dt) {
    this._glow(dt);
    if (!this.open) return;
    const engine = this._engine();
    if (!engine) return;
    const interact = engine.keyBinds?.interact;
    const held = !!engine.input.keys[interact];
    if (this._waitRelease && !held) this._waitRelease = false;
    const putDown = (!this._waitRelease && engine.input.pressed[interact]) || engine.input.pressed.KeyQ;
    if (putDown) this.close();
  }

  onDestroy() {
    // A scene rebuild with the page up must not leave the game slowed.
    this.close();
  }

  _glow(dt) {
    if (!this.material) return;
    if (this._read.has(this._night())) {
      this.material.emissiveIntensity = 0;
      return;
    }
    this._glowTime += dt;
    const k = 0.5 + 0.5 * Math.sin(this._glowTime * PULSE);
    this.material.emissiveIntensity = GLOW_MIN + (GLOW_MAX - GLOW_MIN) * k;
  }

  _night() {
    return this.controller?.nightNumber || 1;
  }

  _engine() {
    return this.gameObject?.scene?.userData?.engine ?? null;
  }
}
