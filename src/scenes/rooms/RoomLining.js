import * as THREE from 'three';

// ─────────────────────────────────────────────
// RoomLining  –  the textured inside of a room's shell
// ─────────────────────────────────────────────
// A room's walls, floor and ceiling are plain boxes: one colour, and seen
// from outside as well as in. The lining is what the inside looks like: a
// floor, a ceiling and the inner face of every wall, each a flat sheet a few
// millimetres proud of the box behind it, drawn with the base's own
// textures (`tex:interior-*`).
//
// Those are original work, painted procedurally for this game: pale
// composite floor panels, a wall of cream enamelled panels over pressed
// corrugated plate with an orange-striped service duct between, and ribbed
// ceiling panels with an air vent every 2.4 m. The base is sealed, so their
// grime is its own — soiling, streaks, dirt in the creases — and never the
// red dust of outside.
//
// Lined rather than textured, because a box has one material for all six
// faces: texturing it would paint the two-tone wall on the outside of the
// building and the ceiling panels on its roof. The boxes stay as they were —
// what is solid, what casts shadows and what the yard sees don't change.
//
// The textures are mapped in metres of the world, not per surface: a deck
// plate is 0.5 m wherever it is, the pattern runs unbroken from a room into
// its corridor and across the pieces of a wall with a doorway in it, and
// the wall's skirting is at the floor whatever piece of wall it is on.
//
// Cost: three meshes a room (all its wall faces are one), sharing six
// textures between every room. Pure: no engine. Tested in RoomLining.test.js.
// ─────────────────────────────────────────────

export const LINING = {
  /** How far a sheet stands off the surface behind it, metres: enough that
   *  the two never fight for the same depth, too little to see. */
  gap: 0.004,
  /** Metres one repeat of the mapping covers, [across, up]. A texture that
   *  covers a different area (the ceiling: 2.4 m) says so with its manifest
   *  `repeat`. */
  tile: { floor: [2, 2], wall: [1.5, 3], ceiling: [1.2, 1.2] },
  /** Manifest keys, [colour, normal]. */
  textures: {
    floor:   ['tex:interior-floor', 'tex:interior-floor-normal'],
    wall:    ['tex:interior-wall', 'tex:interior-wall-normal'],
    ceiling: ['tex:interior-ceiling', 'tex:interior-ceiling-normal'],
  },
  /** How each surface takes the light: worn laminate, enamel and plate
   *  under a film of grime, pressed panels. Nothing in here shines. */
  roughness: { floor: 0.68, wall: 0.8, ceiling: 0.85 },
  /** The room's own colour tints its lining, so each room keeps its mood.
   *  `keep` is how much of that colour's hue survives (the rest goes to
   *  grey, letting the textures' own colours through). `gain` makes up for
   *  each texture being darker than white, so the rooms stay about as
   *  bright as their plain boxes were. */
  tint: { keep: 0.25, gain: { floor: 2.7, wall: 1.9, ceiling: 2.2 } },
};

export const SURFACES = ['floor', 'wall', 'ceiling'];

/** Which way a wall's texture runs, so it is never mirrored: seen from
 *  inside the room, u grows to the right. [axis the wall runs along, sign]. */
const WALL_U = { back: ['x', 1], front: ['x', -1], left: ['z', -1], right: ['z', 1] };

/**
 * The floor's sheet: the rectangle [x0, x1] × [z0, z1], room-local, facing up.
 * `origin` is the room's world position, for the mapping.
 * @returns {{positions:number[][], normal:number[], uvs:number[][]}}
 */
export function floorQuad({ x0, x1, z0, z1 }, y, origin = [0, 0, 0]) {
  const [tx, tz] = LINING.tile.floor;
  const corners = [[x0, z0], [x0, z1], [x1, z1], [x1, z0]];
  return {
    positions: corners.map(([x, z]) => [x, y, z]),
    normal: [0, 1, 0],
    uvs: corners.map(([x, z]) => [(origin[0] + x) / tx, -(origin[2] + z) / tz]),
  };
}

/** The ceiling's sheet: the same rectangle, facing down. */
export function ceilingQuad({ x0, x1, z0, z1 }, y, origin = [0, 0, 0]) {
  const [tx, tz] = LINING.tile.ceiling;
  const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  return {
    positions: corners.map(([x, z]) => [x, y, z]),
    normal: [0, -1, 0],
    uvs: corners.map(([x, z]) => [(origin[0] + x) / tx, (origin[2] + z) / tz]),
  };
}

/**
 * One piece of a wall's inner face: from a0 to a1 along the wall and y0 to
 * y1 up it, on the plane `face` (the wall's inner face, room-local), facing
 * into the room.
 * @param {'back'|'front'|'left'|'right'} side
 */
export function wallQuad(side, a0, a1, y0, y1, face, origin = [0, 0, 0]) {
  const [axis, sign] = WALL_U[side];
  const [tw, th] = LINING.tile.wall;
  const at = (a, y) => axis === 'x' ? [a, y, face] : [face, y, a];
  // Inward: back (−z) and left (−x) walls face +; front and right face −.
  const inward = side === 'back' || side === 'left' ? 1 : -1;
  const normal = axis === 'x' ? [0, 0, inward] : [inward, 0, 0];
  const along = axis === 'x' ? origin[0] : origin[2];
  const uv = (a, y) => [sign * (along + a) / tw, (origin[1] + y) / th];
  const corners = [[a0, y0], [a1, y0], [a1, y1], [a0, y1]];
  return { positions: corners.map(([a, y]) => at(a, y)), normal, uvs: corners.map(([a, y]) => uv(a, y)) };
}

/**
 * Several quads as one geometry. Each is wound to face the way its normal
 * points, whichever order its corners came in.
 * @param {ReturnType<typeof wallQuad>[]} quads
 */
export function liningGeometry(quads) {
  const positions = [], normals = [], uvs = [], index = [];
  for (const { positions: p, normal, uvs: t } of quads) {
    const first = positions.length / 3;
    for (let i = 0; i < 4; i++) { positions.push(...p[i]); normals.push(...normal); uvs.push(...t[i]); }
    const ab = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
    const ac = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    const facing = (ab[1] * ac[2] - ab[2] * ac[1]) * normal[0]
                 + (ab[2] * ac[0] - ab[0] * ac[2]) * normal[1]
                 + (ab[0] * ac[1] - ab[1] * ac[0]) * normal[2];
    if (facing > 0) index.push(first, first + 1, first + 2, first, first + 2, first + 3);
    else index.push(first, first + 2, first + 1, first, first + 3, first + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  return geometry;
}

/** The room's colour as a tint for one of its lining's surfaces (LINING.tint). */
export function liningTint(color, surface) {
  const { keep, gain } = LINING.tint;
  const grey = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
  return new THREE.Color(
    THREE.MathUtils.lerp(grey, color.r, keep),
    THREE.MathUtils.lerp(grey, color.g, keep),
    THREE.MathUtils.lerp(grey, color.b, keep),
  ).multiplyScalar(gain[surface]);
}

/**
 * The three materials of a room's lining, tinted with the room's colour, or
 * null where the textures aren't loaded (a test, a scene that doesn't
 * preload them) — the room then keeps its plain boxes.
 *
 * The textures belong to the asset cache and are shared by every room; the
 * materials are the room's own, to free with the rest of what it built.
 *
 * @param {{has:(key:string)=>boolean, get:(key:string)=>THREE.Texture}|undefined} assets
 * @param {THREE.MeshStandardMaterial} base  The room's plain shell material
 * @returns {{floor:THREE.Material, wall:THREE.Material, ceiling:THREE.Material}|null}
 */
export function liningMaterials(assets, base) {
  if (!assets?.has || !Object.values(LINING.textures).flat().every(key => assets.has(key))) return null;

  const materials = {};
  for (const surface of SURFACES) {
    const [map, normalMap] = LINING.textures[surface];
    materials[surface] = new THREE.MeshStandardMaterial({
      map: assets.get(map),
      normalMap: assets.get(normalMap),
      color: liningTint(base.color, surface),
      roughness: LINING.roughness[surface],
      metalness: 0,
    });
    materials[surface].name = `Lining:${surface}`;
  }
  return materials;
}
