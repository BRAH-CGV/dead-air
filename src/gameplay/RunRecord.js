// ─────────────────────────────────────────────
// RunRecord  –  what this run has sent to the hub, night by night
// ─────────────────────────────────────────────
// Each morning the buggy takes the night's drive box to the central hub.
// The record counts the processed drives in its boot at the send-off
// (GameController.dispatch), and the bedroom PC reads them back: the hub's
// results arrive the evening after, so a night's findings are everything
// delivered on the nights before it.
//
// It outlives the scene. A dream rebuilds the base between nights, so the
// record is held on the engine (engine.run) and only App starts it over:
// on New game and the Tutorial under the intro's array name, on Continue
// and Select night with none. Never saved: Continue after a reload starts
// with an empty record.
//
// Pure — no scene, no DOM.
// ─────────────────────────────────────────────

/** A drive's signalLevel once processed at the ServerRoom console. */
export const PROCESSED_LEVEL = 2;

/** How many drives in [box] hold a processed signal: saved, not red, and
 *  through the ServerRoom console. */
export function processedDrives(box) {
  const items = box?.receiver?.attachedItems;
  if (!items) return 0;
  let n = 0;
  for (const d of items) {
    if (d.saved && !d.corrupted && d.signalLevel >= PROCESSED_LEVEL) n++;
  }
  return n;
}

export class RunRecord {
  /** The array's name for this run (the intro's arrayLabel), or null. */
  array = null;
  /** night → processed drives sent to the hub that morning. */
  _delivered = new Map();

  /** Start a new run. */
  reset({ array = null } = {}) {
    this.array = array;
    this._delivered.clear();
  }

  /** Night [night]'s send-off took [count] processed drives. A night played
   *  again keeps its last send-off. */
  deliver(night, count) {
    this._delivered.set(night, count);
  }

  delivered(night) {
    return this._delivered.get(night) ?? 0;
  }

  /** What the hub has sent back by night [night]: one entry per processed
   *  drive delivered on an earlier night, oldest first. `index` counts from
   *  1 within its night. */
  findings(night) {
    const nights = [...this._delivered.keys()].filter((n) => n < night).sort((a, b) => a - b);
    const out = [];
    for (const n of nights) {
      const count = this._delivered.get(n);
      for (let i = 1; i <= count; i++) out.push({ night: n, index: i });
    }
    return out;
  }
}
