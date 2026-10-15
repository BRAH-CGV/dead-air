import * as THREE from 'three';
import { Room, SIDES } from './Room.js';

// ─────────────────────────────────────────────
// Corridor  –  Walled passage between two rooms
// ─────────────────────────────────────────────
// A Room with a different shell: two long walls plus floor and ceiling,
// running `length` along `axis`. Reuses Room's wall segmenting, static
// colliders and teardown.
//
// Ends are open by default. A corridor butts against a room's outer wall
// face and the room's doorway is the opening — giving the corridor its own
// end walls there would put two coplanar walls in the same place
// (z-fighting). For the same reason the floor and ceiling run exactly
// `length`, so they meet the room's floor edge without overlapping in the
// doorway threshold.
//
// `ends: 'doorway'` adds end walls with a centred doorway, for a corridor
// that doesn't sit flush against a room. `ends` can also be set per end,
// `[first, second]` in the order the axis runs — [left, right] along x,
// [back, front] along z — for a passage that butts against a room at one
// end and stands free at the other (the airlock).
//
// An open end shows the outer face of the room's wall it butts against,
// which neither the room nor the corridor lines. `openEndDoorways` names the
// doorway in that wall, per end side ({ back: { width, height } }), and the
// corridor lines the face round it.
// ─────────────────────────────────────────────

const AXES = ['x', 'z'];
const ENDS = ['open', 'doorway'];

export class Corridor extends Room {
  static kind = 'Corridor';

  /**
   * @param {import('../../core/Engine.js').Engine} engine
   * @param {object} opts
   * @param {string} opts.name
   * @param {number} opts.length           Along `axis` (m)
   * @param {number} [opts.width=2]        Wall centre to wall centre (m)
   * @param {number} [opts.height=3]
   * @param {number} [opts.wallThick=0.2]
   * @param {'x'|'z'} [opts.axis='x']
   * @param {'open'|'doorway'|('open'|'doorway')[]} [opts.ends='open']  Both
   *        ends, or [first, second] along the axis
   * @param {number} [opts.doorWidth=1.2]  Only used by a 'doorway' end
   * @param {number} [opts.doorHeight=2.2]
   * @param {Object<string, {width:number, height:number, offset?:number}>} [opts.openEndDoorways]
   *        The doorway in the wall each open end butts against, by end side:
   *        that face is lined round it. Also settable before build().
   * @param {number[]} [opts.position]    World position of the floor centre
   * @param {import('three').Material} [opts.material]
   */
  constructor(engine, {
    name, length, width = 2, height = 3, wallThick = 0.2, axis = 'x',
    ends = 'open', doorWidth = 1.2, doorHeight = 2.2, openEndDoorways = {}, position, material,
  }) {
    if (!AXES.includes(axis)) throw new Error(`Corridor ${name}: axis must be 'x' or 'z', got '${axis}'`);
    const endModes = Array.isArray(ends) ? ends : [ends, ends];
    if (endModes.length !== 2 || !endModes.every(mode => ENDS.includes(mode))) {
      throw new Error(`Corridor ${name}: ends must be 'open', 'doorway' or a pair of them, got ${JSON.stringify(ends)}`);
    }

    const endSides = axis === 'x' ? ['left', 'right'] : ['back', 'front'];
    const openings = endSides
      .filter((_, i) => endModes[i] === 'doorway')
      .map(side => ({ side, width: doorWidth, height: doorHeight }));

    // Room's width/depth are X/Z extents, so map length/width onto them.
    super(engine, {
      name, height, wallThick, position, material, openings,
      width: axis === 'x' ? length : width,
      depth: axis === 'x' ? width : length,
    });

    this.length        = length;
    this.corridorWidth = width;
    this.axis          = axis;
    this.ends          = ends;
    /** Mode per end side, e.g. { back: 'open', front: 'doorway' }. */
    this._endMode      = Object.fromEntries(endSides.map((side, i) => [side, endModes[i]]));
    /** The doorway in the wall each open end butts against, by end side. */
    this.openEndDoorways = openEndDoorways;
  }

  /** A single ceiling light at the midpoint, with a visible fixture (same
   *  disc-on-the-ceiling treatment as the room ceiling lights) — corridors
   *  have no room lighting of their own otherwise, and doorways at either
   *  end aren't enough to keep a 4 m passage from reading as pitch black. */
  buildLighting() {
    const lightGO = this._addGroup('CorridorLight');

    const light = new THREE.PointLight(0xcfd8e3, 6.0, 8, 1.4);
    light.position.set(0, this.height - 0.3, 0);
    // A light without a shadow lights everything in its 8 m that faces it,
    // walls or not: the yard beside the corridor and the next room's floor
    // shone as brightly as the corridor (#87). The walls keep it in only as
    // shadow casters. The map is small — it only has to hold a passage — and
    // frozen like every other (Engine.shadows). The near plane comes in under
    // the ceiling (0.3 m up), or the ceiling isn't in the map at all.
    light.castShadow = true;
    light.shadow.mapSize.set(256, 256);
    light.shadow.camera.near = 0.1;
    light.shadow.normalBias = 0.02;   // as the office's ceiling light: no acne
    lightGO.object3d.add(light);

    const fixture = new THREE.Mesh(
      this._own(new THREE.CylinderGeometry(0.2, 0.28, 0.06, 20)),
      this._own(new THREE.MeshStandardMaterial({
        color: 0x2a2a2a,
        emissive: 0xcfd8e3,
        emissiveIntensity: 1.6,
      })),
    );
    fixture.position.copy(light.position);
    lightGO.object3d.add(fixture);
  }

  /** Long walls run along the corridor axis; end walls cross it. */
  _isLong(side) {
    return SIDES[side].axis === this.axis;
  }

  /** Long walls are exactly `length`; end walls fit between them. */
  _wallLength(side) {
    return this._isLong(side) ? this.length : this.corridorWidth - this.wallThick;
  }

  _buildShell() {
    const t = this.wallThick;
    for (const side of Object.keys(SIDES)) {
      if (this._isLong(side) || this._endMode[side] === 'doorway') this._buildWall(side);
    }

    const size = this.axis === 'x'
      ? [this.length, t, this.corridorWidth + t]
      : [this.corridorWidth + t, t, this.length];
    this._addStaticBox('Floor',   [0, -t / 2, 0],               size);
    this._addStaticBox('Ceiling', [0, this.height + t / 2, 0],  size);
    for (const [side, mode] of Object.entries(this._endMode)) {
      const doorway = mode === 'open' && this.openEndDoorways?.[side];
      if (doorway) this._lineOpenEnd(side, doorway);
    }
    this._buildLining([size[0], size[2]]);
  }

  /** The face an open end butts against, for the lining: from long wall to
   *  long wall, floor to ceiling, round the doorway in it. Nothing is built —
   *  the wall is the next room's. */
  _lineOpenEnd(side, doorway) {
    const half = this._wallLength(side) / 2;
    const { lo, hi, top } = this._openingSpan(doorway);
    const face = SIDES[side].sign * this.length / 2;
    this._wallPieces.push(
      { side, a0: -half, a1: lo,   y0: 0,   y1: this.height, face },
      { side, a0: hi,    a1: half, y0: 0,   y1: this.height, face },
      { side, a0: lo,    a1: hi,   y0: top, y1: this.height, face },
    );
  }
}
