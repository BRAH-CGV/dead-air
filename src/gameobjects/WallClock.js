import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';
import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// WallClock  –  an analogue clock that shows the NightClock's time
// ─────────────────────────────────────────────
// Lets the player read the time off the wall, not just the HUD. Built from
// primitives (no model to source) and driven by whatever NightClock it is
// handed:
//
//   const clock = room.root.addChild(new WallClock());
//   clock.object3d.position.set(5.15, 1.95, -4.9);   // on a back wall
//   clock.clock = nightClock;                        // scene wiring
//
// The face looks down +Z and the origin is the clock's back, so the position
// it hangs at is the wall's face. Turn it to hang on any other wall. It is
// thin and flat against the wall, so it has no collider.
//
// It owns its geometries and materials; dispose() frees them.
// ─────────────────────────────────────────────

const TWO_PI = Math.PI * 2;

/**
 * Hand angles for an hour of the day, in radians clockwise from 12.
 * @param {number} hour  Float hour, e.g. 4.5 for 4:30.
 * @returns {{ hour: number, minute: number }}
 */
export function clockHandAngles(hour) {
  const h12      = ((hour % 12) + 12) % 12;
  const fraction = ((hour % 1) + 1) % 1;
  return { hour: (h12 / 12) * TWO_PI, minute: fraction * TWO_PI };
}

/** Reads the clock each frame and turns the hands. */
class WallClockHands extends Component {
  onUpdate() {
    const time = this.gameObject.clock?.currentTime;
    if (time !== undefined) this.gameObject.showTime(time);
  }
}

export class WallClock extends GameObject {
  /** The clock to show. @type {import('../gameplay/NightClock.js').NightClock|null} */
  clock = null;

  /** @type {THREE.Mesh} */ hourHand;
  /** @type {THREE.Mesh} */ minuteHand;

  _shownTime = 0;

  /**
   * @param {string} [name]
   * @param {object} [opts]
   * @param {number} [opts.radius=0.22]  Face radius, metres.
   */
  constructor(name = 'WallClock', { radius = 0.22 } = {}) {
    super(name);
    this._build(radius);
    this.addComponent(new WallClockHands());
  }

  /** Point the hands at a float hour. */
  showTime(hour) {
    if (hour === this._shownTime) return;
    this._shownTime = hour;
    const angles = clockHandAngles(hour);
    // rotation.z turns anticlockwise as seen from +Z; a clock goes the other way.
    this.hourHand.rotation.z   = -angles.hour;
    this.minuteHand.rotation.z = -angles.minute;
  }

  /** Free every geometry and material the clock built. */
  dispose() {
    const resources = new Set();
    this.object3d.traverse(o => {
      if (o.isMesh) { resources.add(o.geometry); resources.add(o.material); }
    });
    for (const resource of resources) resource.dispose();
  }

  _build(radius) {
    const depth = 0.04;
    const root  = this.object3d;

    // Rim and body: a short cylinder turned to face +Z, its back on the wall.
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, depth, 48),
      new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.5, metalness: 0.6 }),
    );
    body.name = 'ClockBody';
    body.rotation.x = Math.PI / 2;
    body.position.z = depth / 2;
    root.add(body);

    // A faint glow so the face still reads in a dark room.
    const face = new THREE.Mesh(
      new THREE.CircleGeometry(radius * 0.9, 48),
      new THREE.MeshStandardMaterial({
        color: 0xe8e4da, roughness: 0.8, emissive: 0x3a3830, emissiveIntensity: 1,
      }),
    );
    face.name = 'ClockFace';
    face.position.z = depth + 0.001;
    root.add(face);

    // Hour marks, one shared geometry and material; 12, 3, 6 and 9 longer.
    const markMaterial = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6 });
    const shortMark    = new THREE.BoxGeometry(radius * 0.04, radius * 0.1, 0.004);
    const longMark     = new THREE.BoxGeometry(radius * 0.06, radius * 0.18, 0.004);
    for (let i = 0; i < 12; i++) {
      const long = i % 3 === 0;
      const mark = new THREE.Mesh(long ? longMark : shortMark, markMaterial);
      const angle = (i / 12) * TWO_PI;
      const r = radius * (long ? 0.72 : 0.76);
      mark.position.set(Math.sin(angle) * r, Math.cos(angle) * r, depth + 0.003);
      mark.rotation.z = -angle;
      root.add(mark);
    }

    const handMaterial = new THREE.MeshStandardMaterial({ color: 0x101214, roughness: 0.5 });
    this.hourHand   = this._hand('HourHand',   radius * 0.5,  radius * 0.07, depth + 0.006, handMaterial);
    this.minuteHand = this._hand('MinuteHand', radius * 0.78, radius * 0.045, depth + 0.010, handMaterial);

    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.06, radius * 0.06, 0.006, 16),
      handMaterial,
    );
    cap.name = 'ClockCap';
    cap.rotation.x = Math.PI / 2;
    cap.position.z = depth + 0.014;
    root.add(cap);
  }

  /** A hand pointing at 12, pivoting about the centre of the face. */
  _hand(name, length, width, z, material) {
    const tail = length * 0.15;
    const geometry = new THREE.BoxGeometry(width, length + tail, 0.004);
    geometry.translate(0, (length - tail) / 2, 0);   // pivot at the centre, not the middle
    const hand = new THREE.Mesh(geometry, material);
    hand.name = name;
    hand.position.z = z;
    this.object3d.add(hand);
    return hand;
  }
}
