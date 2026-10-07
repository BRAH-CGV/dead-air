// ─────────────────────────────────────────────
// AmbienceMix  –  which room loops are heard where (pure)
// ─────────────────────────────────────────────
// The base is a set of boxes. Standing in one, you hear something:
//
//   zone      a room: its own track, at full level
//   passage   a corridor: the tracks of whatever lies off its two ends,
//             crossfaded by how far along it you are
//   neither   outside: the `outside` track, or silence without one
//
// A passage is given only its box and the axis it runs along. What it joins
// is found here, by looking just past each end — so a corridor never has to
// be told which room is on which side, and one that opens on the yard fades
// toward the outside track.
//
// The crossfade is equal power (cos / sin), which holds the loudness level
// from one doorway to the other. A straight linear fade dips in the middle,
// since two unrelated loops don't add up the way one loop does.
//
// A zone's `track` may be changed at any time, to a track the mix already
// knows, or to null: the airlock hears whichever side's door stands open,
// and nothing at all while both are shut. A zone with no track is silent —
// it is not "outside" just because no loop claims it.
//
// The outside can get through the walls. `seep`, 0..1, is how hard it is
// pressing (a storm raises it); `leak` is how much of it a place lets in at
// full press — one value for the whole building, and a zone may give its
// own (the room with the window leaks more). Indoors the outside track is
// heard at seep × leak, on top of the room's own loop, which is not turned
// down for it. A zone with no track stays silent regardless: it is sealed.
//
// Boxes are anything with `min` / `max` of { x, y, z } — a THREE.Box3 or a
// room's `bounds()`. Neighbouring shells touch, so a doorway is never a
// sliver of outside.
// ─────────────────────────────────────────────

/** How far past a passage's end to look for the room it opens on (m). */
const PROBE = 0.05;

const _probe = { x: 0, y: 0, z: 0 };

function contains(box, p) {
  return p.x >= box.min.x && p.x <= box.max.x
      && p.y >= box.min.y && p.y <= box.max.y
      && p.z >= box.min.z && p.z <= box.max.z;
}

export class AmbienceMix {
  /** Every track this mix can ask for, in a fixed order. @type {string[]} */
  tracks = [];
  /** How hard the outside is pressing on the walls, 0..1. */
  seep = 0;

  /**
   * @param {object} opts
   * @param {{ box: {min: object, max: object}, track: string|null, leak?: number }[]} [opts.zones]
   * @param {{ box: {min: object, max: object}, axis: 'x'|'z' }[]} [opts.passages]
   * @param {string|null} [opts.outside]  Track heard everywhere else.
   * @param {number} [opts.leak=0]  How much of the outside a room or passage
   *        lets in at full `seep`, unless the zone says otherwise.
   */
  constructor({ zones = [], passages = [], outside = null, leak = 0 } = {}) {
    this.zones = zones;
    this.outside = outside;
    this.leak = leak;

    for (const { track } of zones) this._addTrack(track);
    this._addTrack(outside);

    /** Each passage with the tracks off its low and high ends resolved. */
    this.passages = passages.map(({ box, axis }) => ({
      box, axis,
      from: this._trackBeyond(box, axis, box.min[axis] - PROBE),
      to:   this._trackBeyond(box, axis, box.max[axis] + PROBE),
    }));
  }

  /**
   * How loud each track should be at `p`, 0..1, written into `out` under the
   * track's name. Every track gets a value, so `out` can be reused.
   * @param {{x: number, y: number, z: number}} p
   * @param {Record<string, number>} [out]
   */
  weightsAt(p, out = {}) {
    for (const track of this.tracks) out[track] = 0;

    for (const passage of this.passages) {
      const { box, axis, from, to } = passage;
      if (!contains(box, p)) continue;
      if (from === to) {
        if (from) out[from] = 1;
        return this._seepInto(out, this.leak);
      }
      const t = (p[axis] - box.min[axis]) / (box.max[axis] - box.min[axis]);
      if (from) out[from] = Math.cos(t * Math.PI / 2);
      if (to)   out[to]   = Math.sin(t * Math.PI / 2);
      return this._seepInto(out, this.leak);
    }

    for (const zone of this.zones) {
      if (!contains(zone.box, p)) continue;
      if (!zone.track) return out;   // sealed: silent, storm or not
      out[zone.track] = 1;
      return this._seepInto(out, zone.leak ?? this.leak);
    }

    if (this.outside) out[this.outside] = 1;
    return out;
  }

  /** Indoors, the outside is heard at least at seep × the place's leak. */
  _seepInto(out, leak) {
    const { outside } = this;
    const level = this.seep * leak;
    if (outside && level > 0) out[outside] = Math.max(out[outside], level);
    return out;
  }

  // ── Internals ─────────────────────────────

  _addTrack(track) {
    if (track && !this.tracks.includes(track)) this.tracks.push(track);
  }

  /** The zone's track at `p`, or the outside track (null without one). */
  _trackAt(p) {
    for (const zone of this.zones) {
      if (contains(zone.box, p)) return zone.track;
    }
    return this.outside;
  }

  /** The track at the middle of a passage's cross-section, `along` its axis. */
  _trackBeyond(box, axis, along) {
    _probe.x = (box.min.x + box.max.x) / 2;
    _probe.y = (box.min.y + box.max.y) / 2;
    _probe.z = (box.min.z + box.max.z) / 2;
    _probe[axis] = along;
    return this._trackAt(_probe);
  }
}
