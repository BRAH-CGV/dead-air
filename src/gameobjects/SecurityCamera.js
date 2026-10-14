import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';

// ─────────────────────────────────────────────
// SecurityCamera  –  a wall-mounted CCTV camera (placeholder shapes)
// ─────────────────────────────────────────────
// A bracket on the wall, a head that pans on it, and the head's housing,
// lens and red tally light. The head carries `lens`, a PerspectiveCamera the
// camera terminal renders through (engine.viewCamera), held just in front of
// the housing so none of it is in its own picture.
//
//   const cam = new SecurityCamera({ name: 'Cam_Yard', label: 'YARD WEST',
//     position: [x, y, z], target: [tx, ty, tz], panRange: 1, zones: ['yard'] });
//   room.root.addChild(cam);
//   cam.setPan(0.3);    // radians from rest, + = left
//
// `target` is where it looks at rest: the bracket turns to face it, the head
// tilts down to it. `zones` are the occlusion zones (BaseScene._buildOcclusion)
// that have to be drawn for its picture: an outdoor camera sees the yard,
// which is skipped while the player is indoors.
//
// No shadows either way: it never moves on its own, and the shadow maps are
// frozen (Engine.shadows) — a pan shouldn't redraw them. Nothing here is
// shared: dispose() frees the lot.
// ─────────────────────────────────────────────

/** Metres, the housing's size: wide, tall, long. */
const HOUSING = [0.12, 0.1, 0.26];
/** The lens camera's near plane — a few cm, for the lens set just ahead. */
const NEAR = 0.05;
/** Metres from the bracket's origin back to the wall face of its plate. */
const PLATE_BACK = 0.02;
/** The wedge behind a turned bracket: half its width along the plate, its
 *  height, and the smallest gap to a wall worth filling. */
const WEDGE = { halfWidth: 0.07, height: 0.18, minGap: 0.03 };
/** Metres out along the bracket to where the head turns. */
const ARM = 0.12;

/** How far round a wall-mounted camera may pan: the lens kept at least
 *  `lens` metres in front of every wall it is fixed to (its near plane
 *  reaches a few cm either side), and on a single wall the view kept within
 *  `view` radians of square to it — further round it only looks along the
 *  wall. */
export const CAMERA_CLEARANCE = { lens: 0.1, view: THREE.MathUtils.degToRad(75) };

/** The yaw and pitch (YXZ, as for the player's camera) that point an
 *  object's −z from `from` at `to`. @returns {{ yaw: number, pitch: number }} */
export function aimAngles(from, to) {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

export class SecurityCamera extends GameObject {
  /**
   * @param {object} [opts]
   * @param {string}   [opts.name='SecurityCamera']
   * @param {string}   [opts.label]          Shown on the monitor.
   * @param {number[]} [opts.position=[0,0,0]]  In the parent's space.
   * @param {number[]} [opts.target]         Where it looks at rest, same space.
   * @param {number}   [opts.panRange=0.8]   Radians either way it can pan.
   * @param {number}   [opts.maxView]        On a single wall, how far off square
   *        (radians) the view may turn: CAMERA_CLEARANCE.view unless given —
   *        π/2 lets it turn all the way round to look along the wall.
   * @param {string[]} [opts.zones=[]]       Occlusion zones its picture needs.
   * @param {number}   [opts.fov=70]
   * @param {number}   [opts.flashReach=12]  Metres the flash carries.
   * @param {{ corner?: number[], wall?: { axis: 'x'|'z', at: number }, material?: THREE.Material }} [opts.mount]
   *        What it is fixed to, in the parent's space, for the wedge behind
   *        it: the (x, z) of a corner between two axis-aligned walls, or one
   *        wall's plane. Square to its wall it needs no wedge, and gets none.
   *        `material` is the wall's own, so the wedge reads as part of it —
   *        the caller's, never freed here; left out, the camera's grey.
   */
  constructor({
    name = 'SecurityCamera', label = name, position = [0, 0, 0], target = null,
    panRange = 0.8, zones = [], fov = 70, flashReach = 12, mount = null,
    maxView = CAMERA_CLEARANCE.view,
  } = {}) {
    super(name);
    this.label = label;
    this.panRange = panRange;
    this.maxView = maxView;
    this.zones = zones;
    this.flashReach = flashReach;
    this._owned = [];

    const { yaw, pitch } = target ? aimAngles(position, target) : { yaw: 0, pitch: 0 };
    this.object3d.position.set(...position);
    this.object3d.rotation.y = yaw;

    const body  = this._own(new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.5, metalness: 0.3 }));
    const dark  = this._own(new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.4, metalness: 0.5 }));
    const tally = this._own(new THREE.MeshBasicMaterial({ color: 0xff2a1a }));

    // The bracket: a plate on the wall (at the origin, behind) and an arm out.
    const plate = this._mesh(new THREE.BoxGeometry(0.1, 0.14, 0.02), dark, [0, 0, 0.01]);
    plate.name = 'CameraBracket';
    this._mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.12, 8), dark, [0, 0, -0.06]).rotation.x = Math.PI / 2;

    // A bracket turned off square to its wall would hang in the air at one
    // edge: a wedge fills the gap behind it.
    if (mount) this._buildWedge(mount, position, yaw, mount.material ?? body);

    // The head, on the end of the arm: pans (yaw) and is tilted (pitch).
    this.pan = new THREE.Group();
    this.pan.position.set(0, 0, -ARM);
    this.object3d.add(this.pan);
    this.tilt = new THREE.Group();
    this.tilt.rotation.x = pitch;
    this.pan.add(this.tilt);

    this.housing = new THREE.Group();
    this.housing.name = 'CameraHousing';
    this.tilt.add(this.housing);
    const [w, h, l] = HOUSING;
    this._mesh(new THREE.BoxGeometry(w, h, l), body, [0, 0, -l / 2], this.housing);
    this._mesh(new THREE.BoxGeometry(w + 0.03, 0.012, l + 0.02), body, [0, h / 2 + 0.006, -l / 2 - 0.01], this.housing);   // sun hood, flush with the lens
    const glass = this._mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 16), dark, [0, 0, -l - 0.005], this.housing);
    glass.rotation.x = Math.PI / 2;
    this._mesh(new THREE.SphereGeometry(0.008, 8, 6), tally, [w / 2 - 0.015, h / 2 - 0.02, -l - 0.002], this.housing);

    this.lens = new THREE.PerspectiveCamera(fov, 16 / 9, NEAR, 1000);
    this.lens.name = `${name}_Lens`;
    this.lens.position.set(0, 0, -l - 0.02);
    this.tilt.add(this.lens);

    /** How far it may pan from rest, [right, left] radians (− right, + left).
     *  Within panRange, and on a wall never so far round that the lens swings
     *  behind the wall's face (the picture would be inside the building), nor
     *  — on a single wall — the view past `maxView` off it. */
    this.panLimits = mount ? this._panLimits(mount, yaw, pitch) : [-panRange, panRange];
  }

  /** Turn the head `yaw` radians from rest (+ = left). */
  setPan(yaw) {
    this.pan.rotation.y = yaw;
  }

  /** Walk out from rest each way until a pan would break a rule (see
   *  panLimits). Everything in the parent's space, on the ground plan: the
   *  head turns about the arm's end, and the lens rides `reach` out from it. */
  _panLimits(mount, yaw, pitch) {
    const { x: ox, z: oz } = this.object3d.position;   // after any stand-off
    const walls = mount.corner
      ? [{ axis: 'x', at: mount.corner[0] }, { axis: 'z', at: mount.corner[1] }]
      : mount.wall ? [mount.wall] : [];
    const o = [ox, oz];
    const sides = walls.map(({ axis, at }) => {
      const i = axis === 'x' ? 0 : 1;
      return { i, at, out: Math.sign(o[i] - at) || 1 };   // which way is off the wall
    });
    const fwd = a => [-Math.sin(a), -Math.cos(a)];
    const pivot = [ox + fwd(yaw)[0] * ARM, oz + fwd(yaw)[1] * ARM];
    const reach = (HOUSING[2] + 0.02) * Math.cos(pitch);
    const minCos = Math.cos(this.maxView);
    const ok = (p) => {
      const f = fwd(yaw + p);
      return sides.every(({ i, at, out }) => {
        const lens = pivot[i] + f[i] * reach;
        if ((lens - at) * out < CAMERA_CLEARANCE.lens) return false;
        return sides.length > 1 || f[i] * out >= minCos - 1e-9;
      });
    };
    const STEP = 0.005;
    const limit = (dir) => {
      let p = 0;
      while (Math.abs(p + dir * STEP) <= this.panRange + 1e-9 && ok(p + dir * STEP)) p += dir * STEP;
      return Math.abs(this.panRange - Math.abs(p)) < STEP ? dir * this.panRange : p;
    };
    return [limit(-1), limit(1)];
  }

  /** A block between the bracket's back and the wall (or both walls of a
   *  corner), seen from above as:
   *    corner  the triangle the corner makes with the plate's back line;
   *    wall    the plate's back edge and its foot on the wall.
   *  Worked out in the parent's space, then drawn in the bracket's own. */
  _buildWedge(mount, [ox, , oz], yaw, material) {
    const r = [Math.cos(yaw), -Math.sin(yaw)];                 // the plate's width, across
    const f = [-Math.sin(yaw), -Math.cos(yaw)];                // out from the wall
    const P = [ox - f[0] * PLATE_BACK, oz - f[1] * PLATE_BACK];   // the plate's back
    let outline = null;

    if (mount.corner) {
      const [cx, cz] = mount.corner;
      if (Math.abs(r[0]) < 1e-3 || Math.abs(r[1]) < 1e-3) return;   // square to a wall: no wedge
      const along = s => [P[0] + r[0] * s, P[1] + r[1] * s];
      outline = [[cx, cz], along((cx - P[0]) / r[0]), along((cz - P[1]) / r[1])];
    } else if (mount.wall) {
      const { axis, at } = mount.wall;
      const i = axis === 'x' ? 0 : 1;
      const out = Math.sign(f[i]) || 1;                        // which way is off the wall
      let ends = [-1, 1].map(s => [P[0] + r[0] * WEDGE.halfWidth * s, P[1] + r[1] * WEDGE.halfWidth * s]);
      // Turned, one edge of the plate would sink into the wall: stand the
      // whole camera off it until that edge just touches.
      const sunk = Math.max(0, ...ends.map(e => (at - e[i]) * out));
      if (sunk > 0) {
        const shift = [0, 0];
        shift[i] = sunk * out;
        ox += shift[0]; oz += shift[1];
        this.object3d.position.x = ox;
        this.object3d.position.z = oz;
        ends = ends.map(e => [e[0] + shift[0], e[1] + shift[1]]);
      }
      const foot = ([x, z]) => (axis === 'x' ? [at, z] : [x, at]);
      const gap = Math.max(...ends.map(e => Math.hypot(e[0] - foot(e)[0], e[1] - foot(e)[1])));
      if (gap < WEDGE.minGap) return;
      outline = [ends[0], ends[1], foot(ends[1]), foot(ends[0])];
    }
    if (!outline) return;

    // Into the bracket's frame: undo its position, then its yaw.
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const local = outline.map(([x, z]) => {
      const vx = x - ox, vz = z - oz;
      return new THREE.Vector2(vx * c - vz * s, vx * s + vz * c);
    });
    // The shape is drawn in x / y and stood up: y becomes z, and the
    // extrusion runs down, centred on the bracket's height.
    const geometry = new THREE.ExtrudeGeometry(new THREE.Shape(local), { depth: WEDGE.height, bevelEnabled: false });
    geometry.rotateX(Math.PI / 2);
    geometry.translate(0, WEDGE.height / 2, 0);
    const wedge = this._mesh(geometry, material, [0, 0, 0]);
    wedge.name = 'CameraWedge';
  }

  dispose() {
    for (const resource of this._owned) resource.dispose();
    this._owned.length = 0;
  }

  _own(resource) {
    this._owned.push(resource);
    return resource;
  }

  _mesh(geometry, material, position, parent = this.object3d) {
    const mesh = new THREE.Mesh(this._own(geometry), material);
    mesh.position.set(...position);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    parent.add(mesh);
    return mesh;
  }
}
