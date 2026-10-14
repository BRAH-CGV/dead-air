import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';
import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// DigitalClock  –  a desk clock that shows the NightClock's time in digits
// ─────────────────────────────────────────────
// The wall clock's desk-top sibling: a small box with a red seven-segment
// display, driven by whatever NightClock it is handed.
//
//   const clock = room.root.addChild(new DigitalClock());
//   clock.object3d.position.set(1.15, 0.864, -2.0);   // on a desk top
//   clock.clock = nightClock;                         // scene wiring
//
// The origin is the middle of its base and the display looks down +Z, so
// the position it is given is the surface it stands on.
//
// The display is one mesh: every segment of every digit is a quad in one
// geometry, and showing a time only recolours them. It is unlit, so it
// reads in a dark office, and it is a glow rather than a light — the light
// count is compiled into every lit shader. The PowerGrid dims it with the
// rest of the room's glows, so it goes dark in a power cut.
//
// It owns its geometries and materials; dispose() frees them. No collider:
// on a desk, one could stop the interact ray short of what is behind it.
// ─────────────────────────────────────────────

/** Which of the seven segments each digit lights:
 *
 *       a
 *     f   b
 *       g
 *     e   c
 *       d
 */
export const SEGMENTS = {
  0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc',
  5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
};
const ORDER = 'abcdefg';

/**
 * The four digits of a 12-hour clock face for a float hour (the NightClock's
 * `currentTime`): tens of hours, hours, tens of minutes, minutes. The tens
 * of hours is null when there is nothing to show there (no leading zero).
 * Floored to the minute gone, as the HUD's clock is (NightClock.formatTime),
 * so the two never disagree. The whole time is floored, not the minutes on
 * their own, so the display never reads :60; the epsilon keeps float error
 * (0.1 + 0.2) on its exact minute, as the HUD does.
 * @param {number} hour  e.g. 4.5 for 4:30
 * @returns {(number|null)[]}
 */
export function clockDigits(hour) {
  const total = Math.floor((((hour % 24) + 24) % 24) * 60 + 1e-6) % (24 * 60);   // minutes since midnight
  const h12 = Math.floor(total / 60) % 12 || 12;
  const minutes = total % 60;
  return [h12 >= 10 ? 1 : null, h12 % 10, Math.floor(minutes / 10), minutes % 10];
}

// The casing, and the display laid out on its front. Metres.
const CASE = { width: 0.26, height: 0.11, depth: 0.07 };
const DIGIT = { width: 0.036, height: 0.07, stroke: 0.008 };
/** Digit centres along x, left to right; the colon sits at 0, between the pairs. */
const DIGIT_X = [-0.083, -0.035, 0.035, 0.083];
// Segment colours, written as they should look on screen. Vertex colours
// are linear, so the sRGB hex is converted: fed in raw, this red comes out
// salmon and an "unlit" segment glows.
const linear = hex => new THREE.Color(hex).toArray();
const LIT   = linear(0xff2b1c);
/** All but black: an unlit segment is the dark glass it sits behind, not a dim digit. */
const UNLIT = linear(0x1a0504);

/** Reads the clock each frame; the display redraws only when the minute changes. */
class DigitalClockDisplay extends Component {
  onUpdate() {
    const time = this.gameObject.clock?.currentTime;
    if (time !== undefined) this.gameObject.showTime(time);
  }
}

export class DigitalClock extends GameObject {
  /** The clock to show. @type {import('../gameplay/NightClock.js').NightClock|null} */
  clock = null;

  /** The segments, one mesh. @type {THREE.Mesh} */
  display;

  _shown = '';

  /** @param {string} [name] */
  constructor(name = 'DigitalClock') {
    super(name);
    this._build();
    this.showTime(0);
    this.addComponent(new DigitalClockDisplay());
  }

  /** Show a float hour. Recolours the segments only if the digits changed. */
  showTime(hour) {
    const digits = clockDigits(hour);
    const key = digits.join();
    if (key === this._shown) return;
    this._shown = key;

    const colors = this.display.geometry.getAttribute('color');
    digits.forEach((digit, d) => {
      const on = digit === null ? '' : SEGMENTS[digit];
      for (let s = 0; s < 7; s++) {
        const [r, g, b] = on.includes(ORDER[s]) ? LIT : UNLIT;
        const first = (d * 7 + s) * 4;
        for (let v = first; v < first + 4; v++) colors.setXYZ(v, r, g, b);
      }
    });
    colors.needsUpdate = true;
  }

  /** Free every geometry and material the clock built. */
  dispose() {
    const resources = new Set();
    this.object3d.traverse(o => {
      if (o.isMesh) { resources.add(o.geometry); resources.add(o.material); }
    });
    for (const resource of resources) resource.dispose();
  }

  _build() {
    const { width, height, depth } = CASE;
    const root = this.object3d;

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.5, metalness: 0.4 }),
    );
    body.name = 'ClockCase';
    body.position.y = height / 2;
    body.castShadow = body.receiveShadow = true;
    root.add(body);

    // The dark window the digits sit in, just proud of the casing's front.
    const window_ = new THREE.Mesh(
      new THREE.BoxGeometry(width - 0.03, height - 0.025, 0.004),
      new THREE.MeshStandardMaterial({ color: 0x060607, roughness: 0.3 }),
    );
    window_.name = 'ClockWindow';
    window_.position.set(0, height / 2, depth / 2 + 0.002);
    root.add(window_);

    this.display = new THREE.Mesh(
      this._segmentGeometry(),
      // Not tone mapped: the scene's filmic curve would dull the red.
      new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    );
    this.display.name = 'ClockDisplay';
    this.display.position.set(0, height / 2, depth / 2 + 0.005);
    root.add(this.display);
  }

  /** Every segment as a flat quad facing +z: 4 digits × 7 segments, in
   *  SEGMENTS' a–g order, then the colon's two dots. Four vertices a quad,
   *  so a segment's colour is four entries in the colour attribute. */
  _segmentGeometry() {
    const { width: w, height: h, stroke: t } = DIGIT;
    const across = [w - 1.6 * t, t], up = [t, h / 2 - 1.3 * t];
    // Centre and size of each segment, a–g, in a digit's own space.
    const shapes = [
      [0, h / 2 - t / 2, ...across],             // a
      [w / 2 - t / 2, h / 4, ...up],             // b
      [w / 2 - t / 2, -h / 4, ...up],            // c
      [0, -h / 2 + t / 2, ...across],            // d
      [-w / 2 + t / 2, -h / 4, ...up],           // e
      [-w / 2 + t / 2, h / 4, ...up],            // f
      [0, 0, ...across],                         // g
    ];

    const positions = [], colors = [], index = [];
    const quad = (cx, cy, sx, sy, color) => {
      const first = positions.length / 3;
      for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        positions.push(cx + dx * sx / 2, cy + dy * sy / 2, 0);
        colors.push(...color);
      }
      index.push(first, first + 1, first + 2, first, first + 2, first + 3);
    };
    for (const x of DIGIT_X) {
      for (const [cx, cy, sx, sy] of shapes) quad(x + cx, cy, sx, sy, UNLIT);
    }
    for (const y of [-0.016, 0.016]) quad(0, y, t, t, LIT);   // the colon, always lit

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(index);
    return geometry;
  }
}
