import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// ThreatDirector  –  which monsters run tonight
// ─────────────────────────────────────────────
// Lives on GameplaySystems, right after GameController, so within a frame
// it reads the state the controller has just moved to (the same reason
// Daylight sits there).
//
// It polls rather than subscribes. Each frame it compares the controller's
// state and night number with the last frame's:
//
//   becomes 'playing', or the night changes while playing
//        → stop everything, start that night's threats fresh
//          (covers sleeping, retryNight, the N key and a scene rebuild)
//   any other state
//        → stop everything: the day is safe, a failed night freezes
//   'playing'
//        → update each active threat
//
// Polling works with or without an onStateChange event on the controller,
// and allocates nothing. While the fly camera is active the player's
// components are disabled, so the threats hold too.
// ─────────────────────────────────────────────

/** Night → threat keys. One threat per night (decision D1); list the
 *  earlier nights' keys too to make them cumulative. */
export const THREATS_BY_NIGHT = {
  1: ['sleepDemon'],
  2: ['windowWatchers'],
  3: ['cameraEntity'],
};

export class ThreatDirector extends Component {
  /** Threats running now. One array, reused. @type {import('./threats/Threat.js').Threat[]} */
  active = [];

  /**
   * @param {object} opts
   * @param {{state: string, nightNumber: number, fail: (reason: string) => void}} opts.controller
   * @param {object} [opts.context]  Handed to every threat's start(); the
   *   controller is added to it.
   * @param {{setObjective: (text: string) => void}|null} [opts.hud]
   * @param {Record<number, string[]>} [opts.threatsByNight]
   */
  constructor({ controller, context = {}, hud = null, threatsByNight = THREATS_BY_NIGHT } = {}) {
    super();
    this.controller = controller;
    this.context = { ...context, controller };
    this.hud = hud;
    this.threatsByNight = threatsByNight;
    /** key → Threat */
    this.threats = new Map();

    this._lastState = null;
    this._lastNight = 0;
    /** Log threats starting and stopping — once per change, not per frame. */
    this.log = !!import.meta.env?.DEV;
  }

  /** Make a threat available to the nights that list `key`.
   *  @template T @param {string} key @param {T} threat @returns {T} */
  register(key, threat) {
    this.threats.set(key, threat);
    return threat;
  }

  onUpdate(dt) {
    const { state, nightNumber } = this.controller;
    const playing = state === 'playing';

    if (playing && (this._lastState !== 'playing' || this._lastNight !== nightNumber)) {
      this._stopAll();
      this._startNight(nightNumber);
    } else if (!playing && this.active.length) {
      this._stopAll();
    }
    this._lastState = state;
    this._lastNight = nightNumber;

    if (!playing || this._held()) return;
    for (let i = 0; i < this.active.length; i++) this.active[i].update(dt);
  }

  /** Stop everything. BaseScene.dispose() calls this — loadScene never
   *  reaches onDestroy. */
  dispose() {
    this._stopAll();
    this._lastState = null;
  }

  onDestroy() { this.dispose(); }

  // ── Private ──

  _startNight(night) {
    for (const key of this.threatsByNight[night] ?? []) {
      const threat = this.threats.get(key);
      if (!threat) continue;
      threat.start(this.context);
      this.active.push(threat);
      if (this.log) console.log(`[threats] night ${night}: ${key} started`);
    }
    this.hud?.setObjective(this.active.map(t => t.objective).filter(Boolean).join(' '));
  }

  _stopAll() {
    if (this.log && this.active.length) console.log(`[threats] stopped ${this.active.length}`);
    for (let i = 0; i < this.active.length; i++) this.active[i].stop();
    if (this.active.length) this.hud?.setObjective('');
    this.active.length = 0;
  }

  /** The fly camera froze the player: nothing may hunt them meanwhile. */
  _held() {
    const engine = this.context.engine ?? this.scene?.userData?.engine;
    return !!engine?.debugCamera?.active;
  }
}
