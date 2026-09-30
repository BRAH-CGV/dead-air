import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// SoundCues  –  the one-shots that mark something happening
// ─────────────────────────────────────────────
// Watches state the game already keeps and plays a sound on each edge, so
// the terminal, the controller and the airlock stay silent code:
//
//   terminal   scanning → a tick, quickening as the scan nears its lock
//              review   → the lock chirp
//   controller morning  → the 6 AM chime;  gameOver → the death sting
//   airlock    a cycle starting (either way) → hiss; the far door seating
//              after a cycle → clunk. Both from the airlock itself.
//
// Anything left out of the constructor is simply not watched.
// ─────────────────────────────────────────────

const CYCLING = new Set(['depressurising', 'pressurising']);

/** Seconds between scan ticks, at the start of a scan and just before the lock. */
const TICK_SLOW = 0.5;
const TICK_FAST = 0.12;

export class SoundCues extends Component {
  /**
   * @param {object} opts
   * @param {{ play(key: string, opts?: object): unknown }} opts.audio
   * @param {{ state: string, satellite?: { scanProgress: number, scanTarget: { scanTime: number }|null } }} [opts.terminal]
   * @param {{ state: string }} [opts.controller]
   * @param {{ state: string }} [opts.airlock]
   * @param {import('three').Object3D} [opts.airlockAt]  Where the airlock's sounds come from.
   */
  constructor({ audio, terminal = null, controller = null, airlock = null, airlockAt = null }) {
    super();
    this.audio = audio;
    this.terminal = terminal;
    this.controller = controller;
    this.airlock = airlock;
    this._airlockOpts = { at: airlockAt, volume: 0.8 };
    this._clunkOpts = { at: airlockAt, volume: 1 };

    this._terminalState = terminal?.state;
    this._controllerState = controller?.state;
    this._airlockState = airlock?.state;
    /** Seconds to the next scan tick. */
    this._tickIn = 0;
  }

  onUpdate(dt) {
    if (this.terminal) this._scanner(dt);
    if (this.controller) this._shift();
    if (this.airlock) this._airlock();
  }

  _scanner(dt) {
    const state = this.terminal.state;
    if (state !== this._terminalState) {
      if (state === 'scanning') this._tickIn = 0;
      if (state === 'review') this.audio.play('sfx:scan-lock', { volume: 0.6 });
      this._terminalState = state;
    }
    if (state !== 'scanning') return;

    this._tickIn -= dt;
    if (this._tickIn > 0) return;
    this.audio.play('sfx:scan-tick', { volume: 0.35 });
    const sat = this.terminal.satellite;
    const progress = sat?.scanTarget ? Math.min(1, sat.scanProgress / sat.scanTarget.scanTime) : 0;
    this._tickIn = TICK_SLOW + (TICK_FAST - TICK_SLOW) * progress;
  }

  _shift() {
    const state = this.controller.state;
    if (state === this._controllerState) return;
    this._controllerState = state;
    if (state === 'morning') this.audio.play('sfx:chime', { volume: 0.7 });
    else if (state === 'gameOver') this.audio.play('sfx:death-sting');
  }

  _airlock() {
    const state = this.airlock.state;
    const was = this._airlockState;
    if (state === was) return;
    this._airlockState = state;
    if (CYCLING.has(state)) this.audio.play('sfx:airlock-hiss', this._airlockOpts);
    else if (CYCLING.has(was)) this.audio.play('sfx:airlock-clunk', this._clunkOpts);
  }
}
