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

  /** Show the zone on `side`, then hide the other — showing first, so there
   *  is never a frame with neither drawn. */
  _drawSide(side) {
    const other = side === 'inside' ? 'outside' : 'inside';
    this.zones.show(ZONE[side]);
    this.zones.hide(ZONE[other]);
  }
}
