import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { PromptLabel } from '../ui/PromptLabel.js';

// ─────────────────────────────────────────────
// RoomTransitionSystem  –  Component (attach to Player)
// ─────────────────────────────────────────────
// Watches where the player is relative to doors and rooms, every frame:
//
//  • Doors — fires door.onPlayerEnter / onPlayerExit on the edges. An
//    unlocked door counts its doorway box; a locked one is solid, so it
//    counts an approach zone `approachMargin` around it instead, and shows
//    the door's lockedPrompt while the player is there.
//  • Rooms — keeps `currentRoom` (null in corridors and outside) and calls
//    onRoomChange(room, previous) when it changes. Per-room atmosphere
//    (fog, ambience) hooks in there.
//
// No teleporting: the base is one continuous scene, so the player simply
// walks through an unlocked doorway.
// ─────────────────────────────────────────────

const _pos = new THREE.Vector3();

export class RoomTransitionSystem extends Component {
  /** Room the player is in, or null. @type {{name:string, containsPoint:Function}|null} */
  currentRoom = null;

  /**
   * @param {object} [opts]
   * @param {import('../gameobjects/Door.js').Door[]} [opts.doors]
   * @param {{name:string, containsPoint:Function}[]} [opts.rooms]
   * @param {{show:Function, hide:Function}} [opts.prompt]  Defaults to a PromptLabel on start
   * @param {number} [opts.approachMargin=0.75]  Metres around a locked door that count as "at" it
   */
  constructor({ doors = [], rooms = [], prompt = null, approachMargin = 0.75 } = {}) {
    super();
    this.doors = [...doors];
    this.rooms = [...rooms];
    this.prompt = prompt;
    this.approachMargin = approachMargin;

    /** Doors whose zone the player is in. */
    this._inside = [];
    /** Door whose locked prompt is showing. */
    this._promptDoor = null;
  }

  addDoors(doors) { this.doors.push(...doors); }

  addRooms(rooms) { this.rooms.push(...rooms); }

  /** Override: called when the player moves between rooms (either may be null). */
  onRoomChange(_room, _previous) {}

  onStart() {
    this.prompt ??= new PromptLabel();
  }

  onUpdate(_dt) {
    const player = this.gameObject;
    if (!player) return;
    const p = player.object3d.getWorldPosition(_pos);

    this._updateDoors(player, p);
    this._updatePrompt();
    this._updateRoom(p);
  }

  onDestroy() {
    if (this._promptDoor) this.prompt?.hide();
  }

  _updateDoors(player, p) {
    for (const door of this.doors) {
      const inside = door.containsPoint(p, door.locked ? this.approachMargin : 0);
      const i = this._inside.indexOf(door);
      if (inside && i === -1) {
        this._inside.push(door);
        door.onPlayerEnter(player);
      } else if (!inside && i !== -1) {
        this._inside.splice(i, 1);
        door.onPlayerExit(player);
      }
    }
  }

  _updatePrompt() {
    let target = null;
    for (const door of this._inside) {
      if (door.locked) { target = door; break; }
    }
    if (target === this._promptDoor) return;
    this._promptDoor = target;
    if (target) this.prompt?.show(target.lockedPrompt);
    else this.prompt?.hide();
  }

  _updateRoom(p) {
    let room = null;
    for (const r of this.rooms) {
      if (r.containsPoint(p)) { room = r; break; }
    }
    if (room === this.currentRoom) return;
    const previous = this.currentRoom;
    this.currentRoom = room;
    this.onRoomChange(room, previous);
  }
}
