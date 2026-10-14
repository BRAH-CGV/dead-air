import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// AirlockPortal  –  the airlock decides which side of the base is drawn
// ─────────────────────────────────────────────
// The airlock is the only way between the inside of the base and the fenced
// yard in front of it, and its interlock never has both doors open. So the
// two sides are never on screen together, and the airlock state alone says
// which one to draw:
//
//   pressurised / pressurising     interior drawn, yard skipped
//   depressurised / depressurising yard drawn, interior skipped
//
// The swap happens the moment a cycle starts — both doors are already shut,
// the player is standing in the chamber — and the door ahead is held shut
// (Airlock.readyFor) until the side it opens onto is ready: shown, compiled,
// any pending loads in, and drawn for a few frames behind the closed door.
// So there is nothing left to upload or compile at the moment it opens.
//
// While the debug fly camera or the level editor is out, everything is
// drawn — both fly and edit in places the culling assumes nobody can see.
//
// A security camera does the same for just what it needs:
// setViewZones(['yard', 'unseen']) draws those zones on top of the side the
// player is on, for as long as its picture is on the monitor, and
// setViewZones(null) puts the airlock's choice back. The camera terminal
// shows static until they're ready (OcclusionZones.isReady).
//
//   root.addComponent(new AirlockPortal({ airlock, zones, engine }));
// ─────────────────────────────────────────────

/** Zone drawn on each side of the airlock. */
export const ZONE = { inside: 'interior', outside: 'yard' };

/** Which side an airlock state is on: the side it is at, or cycling to. */
export function sideOf(state) {
  return state === 'depressurised' || state === 'depressurising' ? 'outside' : 'inside';
}

export class AirlockPortal extends Component {
  /**
   * @param {object} opts
   * @param {import('../scenes/rooms/Airlock.js').Airlock} opts.airlock
   * @param {import('../systems/OcclusionZones.js').OcclusionZones} opts.zones
   * @param {object} [opts.engine]  For the debug camera / editor override;
   *        defaults to the one on the scene.
   */
  constructor({ airlock, zones, engine = null }) {
    super();
    this.airlock = airlock;
    this.zones = zones;
    this._engine = engine;
    this._off = null;
    /** Zones a security camera's view wants drawn as well. @type {string[]} */
    this._view = [];
    /** Every zone this portal shows and hides. */
    this._managed = new Set(Object.values(ZONE));
  }

  get engine() {
    return this._engine ?? this.gameObject?.scene?.userData?.engine ?? null;
  }

  onStart() {
    const { airlock, zones } = this;
    airlock.readyFor = side => zones.isReady(ZONE[side]);
    this._off = airlock.onStateChange(state => this._drawSide(sideOf(state)));
    this._drawSide(sideOf(airlock.state));
  }

  onUpdate() {
    const engine = this.engine;
    this.zones.revealAll(!!(engine?.debugCamera?.active || engine?.levelEditor?.enabled));
    this.zones.tick();
  }

  onDestroy() {
    this._off?.();
    this._off = null;
    if (this.airlock.readyFor) this.airlock.readyFor = null;
  }

  /** Draw `names` as well as the player's side, for a view from somewhere
   *  else (a security camera); null or [] for just the side again.
   *  @param {string[]|null} names */
  setViewZones(names) {
    this._view = names ? [...names] : [];
    for (const name of this._view) this._managed.add(name);
    this._drawSide(sideOf(this.airlock.state));
  }

  /** Show the zone on `side` and any a view wants, then hide the rest —
   *  showing first, so there is never a frame with neither side drawn. */
  _drawSide(side) {
    const want = new Set([ZONE[side], ...this._view]);
    for (const name of want) this.zones.show(name);
    for (const name of this._managed) if (!want.has(name)) this.zones.hide(name);
  }
}
