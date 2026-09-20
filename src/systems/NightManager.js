// ─────────────────────────────────────────────
// NightManager  –  which rooms are open on which night
// ─────────────────────────────────────────────
// The base is one continuous scene; nights don't load new levels, they
// unlock doors (GENERAL-VISION: night 1 the office, night 2 + server room,
// night 3 everything including the outside).
//
// A door is open only when BOTH the room it's in and the room it leads to
// are open. That locks a corridor at both ends: on night 1 the server
// room's own door back to the office is shut too, not just the office's.
//
// Plain state, no engine dependency — gameplay (end of night, debug keys)
// calls advance(); the scene listens with onChange and re-applies locks.
// ─────────────────────────────────────────────

/** Rooms open per night. 'Outside' is the exterior (generator). */
export const DEFAULT_NIGHTS = Object.freeze({
  1: Object.freeze(['MainOffice']),
  2: Object.freeze(['MainOffice', 'ServerRoom']),
  3: Object.freeze(['MainOffice', 'ServerRoom', 'LivingQuarters', 'Outside']),
});

export class NightManager {
  /**
   * @param {object} [opts]
   * @param {Record<number, string[]>} [opts.config=DEFAULT_NIGHTS]  Open rooms per night
   * @param {number} [opts.startNight=1]
   */
  constructor({ config = DEFAULT_NIGHTS, startNight = 1 } = {}) {
    this._config = config;
    this._nights = Object.keys(config).map(Number).sort((a, b) => a - b);
    this.maxNight = this._nights[this._nights.length - 1];
    this._listeners = new Set();

    this._check(startNight);
    this.currentNight = startNight;
  }

  /** Rooms open on `night` (a copy). */
  getOpenRooms(night = this.currentNight) {
    this._check(night);
    return [...this._config[night]];
  }

  isOpen(roomName, night = this.currentNight) {
    return this._config[night]?.includes(roomName) ?? false;
  }

  /** First night on which every named room is open, or null if never. */
  firstNightOpen(...roomNames) {
    for (const night of this._nights) {
      if (roomNames.every(name => this.isOpen(name, night))) return night;
    }
    return null;
  }

  /** Move to the next night. Stays put (no change event) on the last one.
   *  @returns {number} the current night afterwards */
  advance() {
    if (this.currentNight >= this.maxNight) return this.currentNight;
    return this.setNight(this._nights[this._nights.indexOf(this.currentNight) + 1]);
  }

  /** Jump to a night — restarts, debug. @returns {number} */
  setNight(night) {
    this._check(night);
    const previous = this.currentNight;
    if (night === previous) return night;
    this.currentNight = night;
    for (const listener of [...this._listeners]) listener(night, previous);
    return night;
  }

  /** Subscribe to night changes: `listener(night, previous)`.
   *  @returns {() => void} unsubscribe */
  onChange(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /**
   * Lock or unlock every door for the current night. A locked door's
   * prompt says when it opens.
   * @param {Record<string, {name:string, doors:object[]}> | {name:string, doors:object[]}[]} rooms
   */
  applyTo(rooms) {
    const list = Array.isArray(rooms) ? rooms : Object.values(rooms);
    for (const room of list) {
      for (const door of room.doors) {
        const open = this.isOpen(room.name) && this.isOpen(door.targetRoom);
        door.locked = !open;
        if (!open) {
          const night = this.firstNightOpen(room.name, door.targetRoom);
          door.lockedPrompt = night ? `Locked — opens night ${night}` : 'Locked';
        }
      }
    }
  }

  _check(night) {
    if (!(night in this._config)) throw new Error(`NightManager: no config for night ${night}`);
  }
}
