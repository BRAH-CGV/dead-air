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
// that doesn't sit flush against a room.
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
   * @param {'open'|'doorway'} [opts.ends='open']
   * @param {number} [opts.doorWidth=1.2]  Only used with ends: 'doorway'
   * @param {number} [opts.doorHeight=2.2]
   * @param {number[]} [opts.position]    World position of the floor centre
   * @param {import('three').Material} [opts.material]
   */
  constructor(engine, {
    name, length, width = 2, height = 3, wallThick = 0.2, axis = 'x',
    ends = 'open', doorWidth = 1.2, doorHeight = 2.2, position, material,
  }) {
    if (!AXES.includes(axis)) throw new Error(`Corridor ${name}: axis must be 'x' or 'z', got '${axis}'`);
    if (!ENDS.includes(ends)) throw new Error(`Corridor ${name}: ends must be 'open' or 'doorway', got '${ends}'`);

    const endSides = axis === 'x' ? ['left', 'right'] : ['back', 'front'];
    const openings = ends === 'doorway'
      ? endSides.map(side => ({ side, width: doorWidth, height: doorHeight }))
      : [];

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
  }

  /** A single ceiling light at the midpoint, with a visible fixture (same
   *  disc-on-the-ceiling treatment as the room ceiling lights) — corridors
   *  have no room lighting of their own otherwise, and doorways at either
   *  end aren't enough to keep a 4 m passage from reading as pitch black. */
  buildLighting() {
    const lightGO = this._addGroup('CorridorLight');

    const light = new THREE.PointLight(0xcfd8e3, 6.0, 8, 1.4);
    light.position.set(0, this.height - 0.3, 0);
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
      if (this._isLong(side) || this.ends === 'doorway') this._buildWall(side);
    }

    const size = this.axis === 'x'
      ? [this.length, t, this.corridorWidth + t]
      : [this.corridorWidth + t, t, this.length];
    this._addStaticBox('Floor',   [0, -t / 2, 0],               size);
    this._addStaticBox('Ceiling', [0, this.height + t / 2, 0],  size);
  }
}
