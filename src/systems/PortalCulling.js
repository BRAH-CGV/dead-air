import * as THREE from 'three';

// ─────────────────────────────────────────────
// PortalCulling  –  rooms drawn only as far as the doorways show them (#175)
// ─────────────────────────────────────────────
// three culls by the camera's frustum alone, so every room the view points
// at was drawn through its walls: from the quarters' corridor, the whole
// office, the airlock and the server room behind it. This draws another
// room's things only where they can be seen through a doorway.
//
// Rooms and corridors are nodes, their doorways portals. Each frame, from
// the node the camera stands in, it walks out through every doorway the
// view can see, narrowing the view to the opening each time: the opening
// is clipped by the view so far, and the next view is the pyramid from the
// eye through what is left of it. A thing in another room is hidden unless
// its bounding sphere meets one of the views that reached that room.
//
// What it hides, and what it doesn't:
//   • Only drawable leaves (meshes, points, lines, sprites), never a group
//     and never a light: a hidden light changes the light count three
//     compiles into every lit shader.
//   • A thing is placed by where it is, not by which room it hangs under:
//     a drive carried into the corridor still belongs to its room's tree.
//   • Nothing with frustumCulled off (its bounds aren't to be trusted),
//     nothing in no room (outside, the yard: the occlusion zones see to
//     that), nothing in the camera's own room (three's frustum is enough),
//     and nothing at all while the camera is in no room.
//   • Standing in a doorway, the next room gets the whole view.
//
// The same walk answers what a light can see (look / sees, #175), for the
// shadow maps: from the light's eye in every direction, through the
// doorways and the openings to outside (the office window, the hatch), so
// the moon sees in only through those. A map is redrawn only for a body
// its light can see, and drawn without the casters it can't
// (hideUnseenCasters): behind a wall from the light, they change nothing.
// Only a room's contents can be behind its walls: a room's own shell (its
// walls, floor and ceiling) is what an outside light sees of it, so
// anything not wholly inside a node's `inner` box counts as seen. Left out
// of the moon's map, the roofs let the moonlight into every room.
//
// Main view only. The engine calls hide() just before rendering and
// restore() as three begins its shadow maps (which it draws after it has
// listed what the main view draws), so a hidden thing still casts its
// shadow into a map redrawn that frame. Nothing is allocated per frame.
// ─────────────────────────────────────────────

/** Metres added round a doorway's opening, for the frame's own thickness. */
const PORTAL_MARGIN = 0.05;
/** How far past a doorway's wall a room is looked for on either side. */
const PROBE = 0.25;
/** Nearer a doorway's plane than this, and inside its opening (with this
 *  much to spare), the camera is in the doorway: the next room is seen whole. */
const IN_DOORWAY = 0.4;
/** Doorways deep a view is followed. */
const MAX_DEPTH = 8;
/** A light's walk starts unbounded: it sees every way. */
const NO_PLANES = Object.freeze([]);

const _local = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _probe = new THREE.Vector3();

/**
 * A doorway as a portal: the opening's corners in world space, and the two
 * nodes either side of it. Null if there isn't a node on each side (the
 * airlock's hatch opens on the yard).
 * @param {THREE.Object3D} object  The doorway, its local z across the wall
 * @param {number[]} size          [width, height, depth] of the opening, centred on the object
 * @param {{ box: THREE.Box3 }[]} nodes
 */
export function doorPortal(object, size, nodes) {
  const portal = opening(object, size, nodes);
  return portal.a >= 0 && portal.b >= 0 && portal.a !== portal.b ? portal : null;
}

/**
 * An opening from a room to the outside (a window, the hatch): the room
 * side as `a`, the outside as `b` (one past the last node). Null unless
 * exactly one side is a room.
 */
export function outsidePortal(object, size, nodes) {
  const portal = opening(object, size, nodes);
  if ((portal.a >= 0) === (portal.b >= 0)) return null;
  if (portal.a < 0) portal.a = portal.b;
  portal.b = nodes.length;
  return portal;
}

function opening(object, [width, height, depth], nodes) {
  object.updateWorldMatrix(true, false);
  const m = object.matrixWorld;
  const hw = width / 2 + PORTAL_MARGIN;
  const hh = height / 2 + PORTAL_MARGIN;
  const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]
    .map(([x, y]) => new THREE.Vector3(x, y, 0).applyMatrix4(m));
  const center = new THREE.Vector3().setFromMatrixPosition(m);
  const normal = new THREE.Vector3().setFromMatrixColumn(m, 2).normalize();
  const u = new THREE.Vector3().setFromMatrixColumn(m, 0).normalize();
  const v = new THREE.Vector3().setFromMatrixColumn(m, 1).normalize();

  const side = (sign) => {
    _probe.copy(center).addScaledVector(normal, sign * (depth / 2 + PROBE));
    return nodes.findIndex(node => node.box.containsPoint(_probe));
  };
  return { a: side(1), b: side(-1), corners, center, normal, u, v, halfWidth: hw, halfHeight: hh };
}

export class PortalCulling {
  /** Off: hide() hides nothing. */
  enabled = true;
  /** How many things the last hide() hid. */
  hiddenCount = 0;

  /**
   * @param {object} opts
   * @param {{ name: string, box: THREE.Box3, inner?: THREE.Box3 }[]} opts.nodes  Rooms and
   *        corridors: their whole shells, and inside their walls, floor and ceiling
   * @param {(ReturnType<typeof doorPortal>|null)[]} opts.portals
   * @param {(ReturnType<typeof outsidePortal>|null)[]} [opts.outside]  For look() only
   * @param {THREE.Object3D[]} opts.roots  What may be hidden lies under these
   */
  constructor({ nodes, portals, outside = [], roots }) {
    this.nodes = nodes;
    this.portals = portals.filter(Boolean);
    this.outside = outside.filter(Boolean);
    this.roots = roots;
    /** The outside, as a node: one past the last. */
    this._out = nodes.length;
    /** Per node, the doorways in its walls (the main view's walk). */
    this._doorsOf = nodes.map((_, i) => this.portals.filter(p => p.a === i || p.b === i));
    /** Per node and the outside, every opening (a light's walk). */
    const all = [...this.portals, ...this.outside];
    this._openingsOf = [...nodes, null].map((_, i) => all.filter(p => p.a === i || p.b === i));
    /** Per node (and the outside), this walk's views into it: each a list of planes. */
    this._views = [...nodes, null].map(() => []);
    /** The node look() was from. */
    this._lookFrom = -1;
    this._hidden = [];
    this._stack = [];
    this._eye = new THREE.Vector3();
    this._sphere = new THREE.Sphere();
    this._frustum = new THREE.Frustum();
    this._viewProjection = new THREE.Matrix4();
    // Pools, rewound each frame.
    this._planes = [];
    this._planesUsed = 0;
    this._lists = [];
    this._listsUsed = 0;
    this._points = [];
    this._pointsUsed = 0;
    this._polygons = [[], [], []];
  }

  /**
   * Hide what `camera` can't see of the other rooms. Matrices must be current.
   * @param {THREE.Camera} camera
   */
  hide(camera) {
    this.restore();
    if (!this.enabled) return;
    const eye = this._eye.setFromMatrixPosition(camera.matrixWorld);
    const here = this._nodeAt(eye);
    if (here < 0) return;

    this._rewind();
    this._viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._viewProjection);
    this._walk(here, this._frustum.planes, null, 0, this._doorsOf);
    this._hideUnseen(here);
  }

  /** Walk out from `eye` in every direction, for sees(). A point in no
   *  room is outside. @param {THREE.Vector3} eye */
  look(eye) {
    this._eye.copy(eye);
    const from = this._nodeAt(eye);
    this._lookFrom = from < 0 ? this._out : from;
    this._rewind();
    this._walk(this._lookFrom, NO_PLANES, null, 0, this._openingsOf);
  }

  /** Can the eye of the last look() see any of `sphere`? Its own room
   *  (or the outside, from outside) always. @param {THREE.Sphere} sphere */
  sees(sphere) {
    const at = this._nodeAt(sphere.center);
    const node = at < 0 ? this._out : at;
    if (node === this._lookFrom) return true;
    // Part of the shell (or reaching into it): seen from outside the room.
    if (at >= 0 && !this._inside(at, sphere)) return true;
    return this._inViews(node, sphere);
  }

  /** Is all of `sphere` inside the node's walls, floor and ceiling? A
   *  node given no inner box counts everything as inside. */
  _inside(node, { center, radius }) {
    const inner = this.nodes[node].inner;
    if (!inner) return true;
    return center.x - radius >= inner.min.x && center.x + radius <= inner.max.x
      && center.y - radius >= inner.min.y && center.y + radius <= inner.max.y
      && center.z - radius >= inner.min.z && center.z + radius <= inner.max.z;
  }

  /** Hide every shadow caster under the roots the last look() can't see,
   *  until restore(). */
  hideUnseenCasters() {
    this.restore();
    const stack = this._stack;
    stack.length = 0;
    for (const root of this.roots) stack.push(root);
    while (stack.length) {
      const object = stack.pop();
      if (!object.visible) continue;
      for (const child of object.children) stack.push(child);
      if (!object.isMesh || !object.castShadow || !object.frustumCulled || object.isSkinnedMesh) continue;
      if (!this._boundsOf(object) || this.sees(this._sphere)) continue;
      object.visible = false;
      this._hidden.push(object);
    }
    this.hiddenCount = this._hidden.length;
  }

  /** Show again everything the last hide() hid. Safe to call any time. */
  restore() {
    for (const object of this._hidden) object.visible = true;
    this._hidden.length = 0;
  }

  // ── The walk through the doorways ─────────

  _rewind() {
    this._planesUsed = 0;
    this._listsUsed = 0;
    this._pointsUsed = 0;
    for (const views of this._views) views.length = 0;
  }

  _walk(node, planes, from, depth, doors) {
    if (depth >= MAX_DEPTH) return;
    for (const portal of doors[node]) {
      if (portal === from) continue;
      const next = portal.a === node ? portal.b : portal.a;
      if (this._inDoorway(portal)) {
        this._views[next].push(planes);
        this._walk(next, planes, portal, depth + 1, doors);
        continue;
      }
      const opening = this._clip(portal.corners, planes);
      if (opening.length < 3) continue;
      const view = this._pyramid(opening);
      if (view.length === 0) continue;
      this._views[next].push(view);
      this._walk(next, view, portal, depth + 1, doors);
    }
  }

  _inDoorway(portal) {
    _local.subVectors(this._eye, portal.center);
    return Math.abs(_local.dot(portal.normal)) < IN_DOORWAY
      && Math.abs(_local.dot(portal.u)) < portal.halfWidth + IN_DOORWAY
      && Math.abs(_local.dot(portal.v)) < portal.halfHeight + IN_DOORWAY;
  }

  /** The polygon, clipped to the inside of every plane. Returns a pooled array. */
  _clip(polygon, planes) {
    let input = polygon;
    let flip = 0;
    for (const plane of planes) {
      const output = this._polygons[flip];
      flip = 1 - flip;
      output.length = 0;
      for (let i = 0; i < input.length; i++) {
        const a = input[i];
        const b = input[(i + 1) % input.length];
        const da = plane.distanceToPoint(a);
        const db = plane.distanceToPoint(b);
        if (da >= 0) output.push(a);
        if ((da >= 0) !== (db >= 0)) output.push(this._point().lerpVectors(a, b, da / (da - db)));
      }
      input = output;
      if (input.length < 3) break;
    }
    // Copied out, so the next clip can reuse both buffers.
    const out = this._polygons[2];
    out.length = 0;
    for (const p of input) out.push(p);
    return out;
  }

  /** The planes from the eye through each edge of a convex opening, facing in. */
  _pyramid(opening) {
    const planes = this._list();
    const centroid = this._point().set(0, 0, 0);
    for (const p of opening) centroid.add(p);
    centroid.divideScalar(opening.length);
    const eye = this._eye;
    for (let i = 0; i < opening.length; i++) {
      const a = opening[i];
      const b = opening[(i + 1) % opening.length];
      _local.subVectors(a, eye);
      _normal.subVectors(b, eye).cross(_local);
      if (_normal.lengthSq() < 1e-12) continue;
      const plane = this._plane().setFromNormalAndCoplanarPoint(_normal.normalize(), eye);
      if (plane.distanceToPoint(centroid) < 0) plane.negate();
      planes.push(plane);
    }
    return planes;
  }

  // ── Hiding ────────────────────────────────

  _hideUnseen(here) {
    const stack = this._stack;
    stack.length = 0;
    for (const root of this.roots) stack.push(root);
    while (stack.length) {
      const object = stack.pop();
      if (!object.visible) continue;
      for (const child of object.children) stack.push(child);
      if (!(object.isMesh || object.isPoints || object.isLine || object.isSprite) || !object.frustumCulled) continue;
      if (object.isSkinnedMesh || !this._boundsOf(object)) continue;
      const node = this._nodeAt(this._sphere.center);
      if (node < 0 || node === here || this._inViews(node, this._sphere)) continue;
      object.visible = false;
      this._hidden.push(object);
    }
    this.hiddenCount = this._hidden.length;
  }

  /** The object's world bounding sphere into _sphere; false if it has none. */
  _boundsOf(object) {
    let local;
    if (object.isInstancedMesh) {
      if (!object.boundingSphere) object.computeBoundingSphere();
      local = object.boundingSphere;
    } else {
      const geometry = object.geometry;
      if (!geometry) return false;
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      local = geometry.boundingSphere;
    }
    if (!local || local.radius < 0) return false;
    this._sphere.copy(local).applyMatrix4(object.matrixWorld);
    return true;
  }

  _inViews(node, sphere) {
    const { center, radius } = sphere;
    for (const view of this._views[node]) {
      let inside = true;
      for (const plane of view) {
        if (plane.distanceToPoint(center) < -radius) { inside = false; break; }
      }
      if (inside) return true;
    }
    return false;
  }

  _nodeAt(point) {
    const nodes = this.nodes;
    for (let i = 0; i < nodes.length; i++) if (nodes[i].box.containsPoint(point)) return i;
    return -1;
  }

  // ── Pools ─────────────────────────────────

  _plane() {
    if (this._planesUsed === this._planes.length) this._planes.push(new THREE.Plane());
    return this._planes[this._planesUsed++];
  }

  _list() {
    if (this._listsUsed === this._lists.length) this._lists.push([]);
    const list = this._lists[this._listsUsed++];
    list.length = 0;
    return list;
  }

  _point() {
    if (this._pointsUsed >= this._points.length) this._points.push(new THREE.Vector3());
    return this._points[this._pointsUsed++];
  }
}
