// ─────────────────────────────────────────────
// RunRecord  –  this run's array name and each night's threat log
// ─────────────────────────────────────────────
// The bedroom PC reads it: the array the intro named, and what came on the
// night before (ThreatWatch writes each night's log as the shift ends).
// Nothing adds up over the run: no tally of drives, no score. A night is
// passed or failed on its own.
//
// It outlives the scene. A dream rebuilds the base between nights, so the
// record is held on the engine (engine.run) and only App starts it over:
// on New game and the Tutorial under the intro's array name, on Continue
// and Select night with none. Never saved: Continue after a reload starts
// with an empty record.
//
// Pure — no scene, no DOM.
// ─────────────────────────────────────────────

export class RunRecord {
  /** The array's name for this run (the intro's arrayLabel), or null. */
  array = null;
  /** night → [{ kind, hour }], what came that night and when it first showed. */
  _threats = new Map();

  /** Start a new run. */
  reset({ array = null } = {}) {
    this.array = array;
    this._threats.clear();
  }

  /** Night [night]'s log. A night played again keeps its last log. */
  logThreats(night, entries) {
    this._threats.set(night, entries.map((e) => ({ ...e })));
  }

  /** Night [night]'s log: [] for a quiet night, null for none kept. */
  threats(night) {
    return this._threats.get(night) ?? null;
  }
}
