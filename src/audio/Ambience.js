import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// Ambience  –  what the place the player stands in sounds like
// ─────────────────────────────────────────────
// Two layers, one per AudioSystem ambience channel, crossfading apart:
//
//   bed   where you are. Indoors, the base's machinery (amb:base-interior);
//         outside, the wind (amb:outside-wind). Both are recordings.
//   room  the room's own tone over the bed — the office's fan, the racks'
//         roar, the quarters' quiet. Corridors ring hollow. Outside, none.
//
// The airlock is indoors until its hatch opens: while it stands
// depressurised the wind comes in, under the airlock's own pumps.
//
// Checked every frame: a room lookup and a corridor test, and AudioSystem
// ignores a key it already has.
// ─────────────────────────────────────────────

export const INSIDE  = 'amb:base-interior';
export const OUTSIDE = 'amb:outside-wind';

/** Each room's tone, by room name. A room left out gets none. */
export const ROOM_TONES = {
  MainOffice:     'amb:office',
  ServerRoom:     'amb:server-room',
  LivingQuarters: 'amb:quarters',
  Airlock:        'amb:airlock',
};
const CORRIDOR_TONE = 'amb:corridor';

/** Channel volumes, set by ear: the recording carries the place, the room
 *  tone only colours it. */
export const MIX = { bed: 0.6, room: 0.3 };

export class Ambience extends Component {
  /**
   * @param {object} opts
   * @param {{ setAmbience(key: string|null, channel?: string): void, ambienceVolume: object }} opts.audio
   * @param {{ currentRoom: { name: string }|null }} opts.transitions  The player's room tracker.
   * @param {{ containsPoint(p: import('three').Vector3): boolean }[]} [opts.corridors]
   * @param {import('three').Object3D} opts.player
   * @param {{ state: string }} [opts.airlock]
   */
  constructor({ audio, transitions, corridors = [], player, airlock = null }) {
    super();
    this.audio = audio;
    this.transitions = transitions;
    this.corridors = corridors;
    this.player = player;
    this.airlock = airlock;
    Object.assign(audio.ambienceVolume, MIX);
  }

  onUpdate() {
    const room = this.transitions.currentRoom;
    let bed = INSIDE, tone = null;
    if (room) {
      tone = ROOM_TONES[room.name] ?? null;
      if (room === this.airlock && this.airlock.state === 'depressurised') bed = OUTSIDE;
    } else if (this._inCorridor()) {
      tone = CORRIDOR_TONE;
    } else {
      bed = OUTSIDE;
    }
    this.audio.setAmbience(bed, 'bed');
    this.audio.setAmbience(tone, 'room');
  }

  _inCorridor() {
    const p = this.player.position;
    for (let i = 0; i < this.corridors.length; i++) {
      if (this.corridors[i].containsPoint(p)) return true;
    }
    return false;
  }
}
