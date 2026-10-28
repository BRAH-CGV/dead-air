import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// ThreatWatch  –  the base's log of what came tonight (#114)
// ─────────────────────────────────────────────
// While the shift is played it asks each source, every frame, whether its
// threat is about, and notes the clock's hour the first time it is. As the
// shift ends (morning) the night's log goes onto the run record, where the
// bedroom PC reads it the next evening. A failed night logs nothing, and
// every night start (a retry included) starts the log afresh.
//
// The scene hands it the rest:
//
//   watch.controller = gameController;
//   watch.clock      = nightClock;       // the hour each threat showed
//   watch.run        = engine.run;
//   watch.sources    = { storm: () => sandstorm.level > 0.5, … };
//
// The kinds are ThreatForecast's THREAT_KINDS. Nothing is allocated per
// frame: a source is asked only until its threat has shown.
// ─────────────────────────────────────────────

export class ThreatWatch extends Component {
  /** @type {import('./GameController.js').GameController|null} */
  controller = null;
  /** @type {{ currentTime: number }|null} */
  clock = null;
  /** @type {import('./RunRecord.js').RunRecord|null} */
  run = null;
  /** kind → () => boolean, true while that threat is about. */
  sources = {};

  /** Tonight's log so far: [{ kind, hour }], in the order they showed. */
  entries = [];
  _seen = new Set();

  onStart() {
    this._offStart = this.controller?.onNightStart?.(() => this._clear()) ?? null;
    this._offState = this.controller?.onStateChange?.((state) => {
      if (state === 'morning') this.run?.logThreats(this.controller.nightNumber, this.entries);
    }) ?? null;
  }

  onUpdate() {
    if (this.controller?.state !== 'playing') return;
    for (const kind in this.sources) {
      if (this._seen.has(kind) || !this.sources[kind]()) continue;
      this._seen.add(kind);
      this.entries.push({ kind, hour: this.clock?.currentTime ?? null });
    }
  }

  onDestroy() {
    this._offStart?.();
    this._offState?.();
    this._offStart = this._offState = null;
  }

  _clear() {
    this.entries.length = 0;
    this._seen.clear();
  }
}
