import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { GameObject } from '../../core/GameObject.js';
import { Door } from '../../gameobjects/Door.js';

// ─────────────────────────────────────────────
// Room  –  Self-contained walled enclosure
// ─────────────────────────────────────────────
// Not a Scene: a helper a Scene composes. Everything the room builds —
// walls, floor, ceiling, doors, lights, props — hangs under one group
// GameObject (`room.root`), so moving or removing a room is one operation.
//
// Coordinates are local to the room: the origin is the floor centre, +Y up,
// "back" is −Z, "front" is +Z, "left" is −X, "right" is +X. `width` and
// `depth` are measured wall centre to wall centre (same convention as the
// original OfficeScene, so a 12 × 10 room keeps its old footprint).
//
// Rooms are axis-aligned — no rotation. Rapier bodies have no parent, so
// each body carries the room offset itself; a rotated room would need the
// same treatment for orientation.
//
// Subclasses override `buildDoors()`, `buildLighting()` and `buildProps()`.
// ─────────────────────────────────────────────

/** Wall per side. `axis` is the world axis the wall runs along. */
export const SIDES = {
  back:  { wall: 'BackWall',  axis: 'x', sign: -1 },
  front: { wall: 'FrontWall', axis: 'x', sign:  1 },
  left:  { wall: 'LeftWall',  axis: 'z', sign: -1 },
  right: { wall: 'RightWall', axis: 'z', sign:  1 },
};

const EPS = 1e-6;

export class Room {
  /**
   * @param {import('../../core/Engine.js').Engine} engine
   * @param {object} opts
   * @param {string} opts.name
   * @param {number} opts.width      X, wall centre to wall centre (m)
   * @param {number} opts.depth      Z, wall centre to wall centre (m)
   * @param {number} opts.height     Floor to ceiling (m)
   * @param {number} [opts.wallThick=0.2]
   * @param {number[]} [opts.position=[0,0,0]]  World position of the floor centre
   * @param {THREE.Material} [opts.material]    Shared by every surface. Not
   *        disposed by the room — the caller owns it. Omit to get a default
   *        the room creates and frees.
   * @param {{side:string, width:number, height:number, offset?:number, sill?:number}[]} [opts.openings]
   *        One per wall at most. `offset` slides the opening along the wall
   *        from its centre (+X for back/front, +Z for left/right). `sill` > 0
   *        makes it a window; 0 (the default) is a doorway.
   */
  constructor(engine, {
    name, width, depth, height, wallThick = 0.2,
    position = [0, 0, 0], material = null, openings = [],
  }) {
    this.engine    = engine;
    this.name      = name;
    this.width     = width;
    this.depth     = depth;
    this.height    = height;
    this.wallThick = wallThick;
    this.position  = position;
    this.openings  = openings;

    /** GPU resources this room created — the only ones it may free. Props
     *  spawned from the asset cache share geometry and materials and must
     *  not be disposed here (AGENTS.md ownership rule). */
    this._owned = [];

    this.material = material ?? this._own(new THREE.MeshStandardMaterial({ color: 0x2f3945, roughness: 0.95 }));

    /** @type {GameObject|null} */
    this.root = null;
    /** @type {Door[]} */
    this.doors = [];

    this._openingBySide = new Map();
  }

  /** Prefix of the root group's name — `Room:<name>`. Subclasses that aren't
   *  rooms in the gameplay sense (corridors) override it. */
  static kind = 'Room';

  /** Build the shell, doors, lighting and props. Returns the root group;
   *  the caller parents it (e.g. under the scene's SceneRoot). */
  build() {
    this._indexOpenings();

    this.root = new GameObject(`${this.constructor.kind}:${this.name}`).makeGroup();
    this.root.object3d.position.set(...this.position);

    this._buildShell();
    this.buildDoors();
    this.buildLighting();
    this.buildProps();
    return this.root;
  }

  /** Override: `addDoor` calls for this room's doorways. */
  buildDoors() {}

  /** Override: room-specific lights. */
  buildLighting() {}

  /** Override: room-specific models and furniture. */
  buildProps() {}

  /** Is the world-space point inside the room's footprint, floor to ceiling?
   *  Measured to the wall centre lines. Used to track which room the player
   *  is in. @param {THREE.Vector3} p */
  containsPoint(p) {
    const [ox, oy, oz] = this.position;
    return Math.abs(p.x - ox) <= this.width / 2
        && Math.abs(p.z - oz) <= this.depth / 2
        && p.y >= oy && p.y <= oy + this.height;
  }

  /** Outer world-space box of the built shell: outer wall faces, floor
   *  bottom to ceiling top. Read off the floor slab, which spans the full
   *  footprint in every subclass (a corridor's runs exactly its length).
   *  @returns {THREE.Box3} */
  bounds() {
    const floor = this.root?.find('Floor');
    if (!floor) throw new Error(`Room ${this.name}: bounds() needs build() first`);
    const [w, , d] = floor._originalSize;
    const [ox, oy, oz] = this.position;
    const t = this.wallThick;
    return new THREE.Box3(
      new THREE.Vector3(ox - w / 2, oy - t, oz - d / 2),
      new THREE.Vector3(ox + w / 2, oy + this.height + t, oz + d / 2),
    );
  }

  // ──────────────────────────────────────────
  // Shell
  // ──────────────────────────────────────────
  _buildShell() {
    const { width, depth, height, wallThick: t } = this;

    for (const side of Object.keys(SIDES)) this._buildWall(side);

    // Floor top flush with y = 0 so rooms and corridors join without a
    // step — the character controller has no autostep.
    this._addStaticBox('Floor',   [0, -t / 2, 0],          [width + t, t, depth + t]);
    this._addStaticBox('Ceiling', [0, height + t / 2, 0],  [width + t, t, depth + t]);
  }

  /** One wall, or its segments around an opening. Back/front walls span the
   *  full outer width and close the corners; left/right fit between them,
   *  so no two walls overlap (overlap = z-fighting). */
  _buildWall(side) {
    const { wall } = SIDES[side];
    const { height } = this;
    const half = this._wallLength(side) / 2;
    const opening = this._openingBySide.get(side);

    if (!opening) {
      this._addWallBox(side, wall, -half, half, 0, height);
      return;
    }

    const { lo, hi, sill, top } = this._openingSpan(opening);
    this._addWallBox(side, `${wall}_A`,      -half, lo,   0,   height);
    this._addWallBox(side, `${wall}_B`,       hi,   half, 0,   height);
    this._addWallBox(side, `${wall}_Header`,  lo,   hi,   top, height);
    if (sill > 0) this._addWallBox(side, `${wall}_Sill`, lo, hi, 0, sill);
  }

  _wallLength(side) {
    return SIDES[side].axis === 'x' ? this.width + this.wallThick : this.depth - this.wallThick;
  }

  /** Distance of a wall's centre plane from the room centre, signed. */
  _wallPlane(side) {
    const { axis, sign } = SIDES[side];
    return sign * (axis === 'x' ? this.depth : this.width) / 2;
  }

  _openingSpan({ width, height, offset = 0, sill = 0 }) {
    return { lo: offset - width / 2, hi: offset + width / 2, sill, top: sill + height };
  }

  /** Box spanning [a0, a1] along the wall and [y0, y1] vertically. Zero-size
   *  segments (an opening flush with a wall end) are skipped. */
  _addWallBox(side, name, a0, a1, y0, y1) {
    if (a1 - a0 < EPS || y1 - y0 < EPS) return null;
    const t = this.wallThick;
    const plane = this._wallPlane(side);
    const along = (a0 + a1) / 2;
    const y = (y0 + y1) / 2;

    if (SIDES[side].axis === 'x') {
      return this._addStaticBox(name, [along, y, plane], [a1 - a0, y1 - y0, t]);
    }
    return this._addStaticBox(name, [plane, y, along], [t, y1 - y0, a1 - a0]);
  }

  _indexOpenings() {
    this._openingBySide.clear();
    for (const o of this.openings) {
      if (!SIDES[o.side]) {
        throw new Error(`Room ${this.name}: unknown side '${o.side}' (use ${Object.keys(SIDES).join(', ')})`);
      }
      if (this._openingBySide.has(o.side)) {
        throw new Error(`Room ${this.name}: only one opening per wall (${o.side} has two)`);
      }
      const half = this._wallLength(o.side) / 2;
      const { lo, hi, sill, top } = this._openingSpan(o);
      if (o.width <= 0 || o.height <= 0 || sill < 0 || lo < -half - EPS || hi > half + EPS || top > this.height + EPS) {
        throw new Error(`Room ${this.name}: opening on ${o.side} wall does not fit (wall ${2 * half} × ${this.height} m)`);
      }
      this._openingBySide.set(o.side, o);
    }
  }

  // ──────────────────────────────────────────
  // Doors
  // ──────────────────────────────────────────
  /**
   * Place a Door in the doorway on `side`: filling the opening, with a
   * sensor collider (solid while locked) at its world position.
   *
   * @param {string} name        Becomes `Door:<name>`
   * @param {string} side        Wall with a doorway opening
   * @param {string} targetRoom  Name of the room this door leads to
   * @param {object} [opts]
   * @param {boolean} [opts.locked=false]
   * @returns {Door}
   */
  addDoor(name, side, targetRoom, { locked = false } = {}) {
    const opening = this._openingBySide.get(side);
    if (!opening) throw new Error(`Room ${this.name}: no opening on ${side} wall for door '${name}'`);
    if ((opening.sill ?? 0) > 0) throw new Error(`Room ${this.name}: ${side} opening is a window, not a doorway`);

    const { width, height, offset = 0 } = opening;
    const plane = this._wallPlane(side);
    const door = new Door(`Door:${name}`, { size: [width, height, this.wallThick], targetRoom, locked });
    if (SIDES[side].axis === 'x') {
      door.object3d.position.set(offset, height / 2, plane);
    } else {
      door.object3d.position.set(plane, height / 2, offset);
      door.object3d.rotation.y = Math.PI / 2;
    }
    this.root.addChild(door);

    const [ox, oy, oz] = this.position;
    const p = door.object3d.position;
    door.attachCollider(this.engine.world, [p.x + ox, p.y + oy, p.z + oz], door.object3d.rotation.y);

    this.doors.push(door);
    return door;
  }

  // ──────────────────────────────────────────
  // Building blocks for subclasses
  // ──────────────────────────────────────────
  /** Register a geometry/material this room created, to be freed on
   *  dispose. Returns it, so it can wrap the constructor call. */
  _own(resource) {
    this._owned.push(resource);
    return resource;
  }

  /** Empty child GameObject — a holder for lights or a cluster of parts. */
  _addGroup(name, parent = this.root) {
    const go = new GameObject(name);
    parent.addChild(go);
    return go;
  }

  /**
   * Spawn a manifest model inside the room, `position` in room-local
   * coordinates. Engine.spawnModel places the body where it's told, in
   * world space, so it gets the room offset; the visual is then re-parented
   * under the room and put back to its local position.
   *
   * spawnModel also registers the model as a root object. Left there, it
   * would be updated twice per frame — once as a root, once as a room
   * child — so it is taken off that list.
   *
   * Static props only. A dynamic/kinematic body would have its world
   * transform synced onto a now-local Object3D; spawn those at the scene
   * root instead.
   *
   * @param {string} key  Manifest key
   * @param {object} [opts]  Engine.spawnModel options, `position` room-local
   */
  _spawnProp(key, { position = [0, 0, 0], ...opts } = {}) {
    const [ox, oy, oz] = this.position;
    const go = this.engine.spawnModel(key, {
      ...opts,
      position: [position[0] + ox, position[1] + oy, position[2] + oz],
    });

    const roots = this.engine._rootObjects;
    const i = roots?.indexOf(go) ?? -1;
    if (i !== -1) roots.splice(i, 1);

    if (go.rigidBody && this.engine.rigidBodyMap?.has(go.rigidBody.handle)) {
      console.warn(`[Room ${this.name}] '${key}' has a moving body — room props should be static`);
    }

    this.root.addChild(go);
    go.object3d.position.set(...position);
    return go;
  }

  /** Procedural box + matching fixed collider, parented under the room.
   *  Same shape as OfficeScene._addStaticBox so the level editor treats
   *  room surfaces like any other static box. */
  _addStaticBox(name, position, size, material = this.material, parent = this.root) {
    const { world } = this.engine;

    const go = new GameObject(name);
    go.object3d.position.set(...position);
    const mesh = new THREE.Mesh(this._own(new THREE.BoxGeometry(...size)), material);
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    go.object3d.add(mesh);

    // The mesh is local to the room group, but the body has no parent —
    // it needs the room offset baked in.
    const [ox, oy, oz] = this.position;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(position[0] + ox, position[1] + oy, position[2] + oz),
    );
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2),
      body,
    );
    go.rigidBody = body;
    go.colliders = [collider];
    go.collider  = collider;
    go._originalSize = [...size];
    this.engine._bodyToGO?.set(body.handle, go);

    parent.addChild(go);
    return go;
  }

  // ──────────────────────────────────────────
  // Teardown
  // ──────────────────────────────────────────
  /** Remove the room: children, owned GPU resources and — unless told
   *  otherwise — its physics bodies.
   *
   *  Scene teardown passes `removeBodies: false`: Engine drops the whole
   *  physics world right after Scene.dispose(), and removing bodies one by
   *  one there is the fragile path Engine._teardownScene warns about.
   *  Removing a room mid-scene (a rebuild) keeps the default.
   *
   *  @param {object} [opts]
   *  @param {boolean} [opts.removeBodies=true] */
  dispose({ removeBodies = true } = {}) {
    if (!this.root) return;
    const { world, _bodyToGO, rigidBodyMap } = this.engine;

    for (const go of removeBodies ? this.root.descendants() : []) {
      if (!go.rigidBody) continue;
      _bodyToGO?.delete(go.rigidBody.handle);
      rigidBodyMap?.delete(go.rigidBody.handle);
      try { world.removeRigidBody(go.rigidBody); } catch (_) { /* world already replaced */ }
      go.rigidBody = null;
      go.collider  = null;
      go.colliders = [];
    }

    for (const door of this.doors) door.dispose();
    for (const child of [...this.root.children]) this.root.removeChild(child);
    if (this.root.parent) this.root.parent.removeChild(this.root);
    this.root.object3d.removeFromParent();

    for (const resource of this._owned) resource.dispose();
    this._owned.length = 0;

    this.doors.length = 0;
  }
}
