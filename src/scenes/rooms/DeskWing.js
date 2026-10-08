import * as THREE from 'three';

// ─────────────────────────────────────────────
// DeskWing  –  the computer desk's top, carried on to each side
// ─────────────────────────────────────────────
// Interior layout mock-up. The office desk (`model:retro-computer`) is one
// low-poly mesh with everything baked into one texture: wood for the
// cabinet, near-black for the front panels of its two pillars, cream for
// the trim. A wing built from plain boxes can't match that, so this builds
// the wing as its own geometry and maps it into the desk's texture — the
// same wood at the same scale, the same dark, the same cream — and the
// office draws it with the desk's own material. One mesh per wing, one
// more draw call each, no new texture.
//
// Seen from above, right-hand wing (the left is its mirror):
//
//        desk back corner A ────── B  wing back corner
//          desk side │              ╲
//                    │    wing       C  outer corner
//       desk front   E              ╱
//          corner     ╲            ╱   ← the two front edges: the top
//                      ╲__ D ____╱       overhangs these, and they are dark
//                    corner nearest the seat
//
// The body stands on the floor under the top; the top is a slab at the
// desk top's height that starts on the desk top's own edge, so the two
// tops meet with no notch where the desk's side is chamfered.
//
// Pure: no engine, no scene. Tested in DeskWing.test.js.
// ─────────────────────────────────────────────

/** Where things are in retro-computer.glb's texture, in the model's own uv
 *  (v down, as glTF has it), read off the mesh:
 *
 *  - `wood` is the panel the desk's sides use, grain running along u. On
 *    those sides the floor is at v 0.011 and a metre is `perMetre` of uv.
 *  - `dark` is inside the panel its pillars' front faces use.
 *  - `cream` is inside the band along the front of its keyboard tray.
 *
 *  A different desk model needs these read again (and the wings rebuilt to
 *  its shape): they describe this download. */
export const DESK_ATLAS = {
  perMetre: 0.431,
  wood:  { u: [0.02, 0.345],  v: [0.02, 0.37] },
  dark:  { u: [0.40, 0.60],   v: [0.05, 0.30] },
  cream: { u: [0.25, 0.75],   v: [0.408, 0.425] },
};

/** The wing: the side of its square top, how far the top overhangs the two
 *  front edges, and how thick the top slab is. The overhang is the one that
 *  lands the top's inner corner exactly on the desk top's front corner
 *  (the desk top stops 0.05 m short of its side panels). */
export const WING = { size: 0.85, overhang: 0.05 * Math.SQRT1_2, slab: 0.05 };

/**
 * The wing's outlines seen from above, as [x, z] points in the desk's own
 * space (the room's, in the office): the body that stands on the floor, and
 * the top that overhangs it. Both run A, B, C, D, E as in the header.
 *
 * @param {1|-1} side  1 = right of the desk (+x), −1 = left
 * @param {{halfW:number, topHalfW:number, front:number, back:number}} desk
 */
export function deskWingOutline(side, desk) {
  const reach = WING.size * Math.SQRT1_2;        // centre to corner
  const cx = desk.halfW + reach, cz = desk.front;
  const o = WING.overhang, d = o * Math.SQRT1_2;

  const body = [
    [desk.halfW, desk.back],
    [cx, cz - reach],
    [cx + reach, cz],
    [cx, cz + reach],
    [desk.halfW, desk.front],
  ];
  const top = [
    [desk.topHalfW, desk.back],
    [cx, cz - reach],
    [cx + reach + d, cz + d],                    // slid out along the back-outer edge's own line
    [cx, cz + reach + o * Math.SQRT2],
    [desk.halfW - o * Math.SQRT2, desk.front],   // where the overhang meets the desk's front
  ];
  const flip = pts => pts.map(([x, z]) => [side * x, z]);
  return { body: flip(body), top: flip(top), centre: [side * cx, cz] };
}

/** Clip a convex polygon of [x, z] points to one side of an axis-aligned line. */
function clip(points, axis, value, keepGreater) {
  const out = [];
  const inside = p => keepGreater ? p[axis] >= value - 1e-9 : p[axis] <= value + 1e-9;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const ain = inside(a), bin = inside(b);
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = (value - a[axis]) / (b[axis] - a[axis]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/**
 * One wing as a single geometry (position, normal, uv; not indexed), in the
 * desk's own space, to be drawn with the desk's material.
 *
 * @param {1|-1} side
 * @param {{halfW:number, topHalfW:number, front:number, back:number, top:number}} desk
 * @returns {THREE.BufferGeometry}
 */
export function deskWingGeometry(side, desk) {
  // Built as the right-hand wing and mirrored at the end, so the winding
  // below only has to be right once.
  const { body, top } = deskWingOutline(1, desk);
  const { wood, dark, cream, perMetre } = DESK_ATLAS;
  const slabBase = desk.top - WING.slab;

  const positions = [], normals = [], uvs = [];
  const tri = (a, b, c, n) => {
    for (const [p, t] of [a, b, c]) { positions.push(...p); normals.push(...n); uvs.push(...t); }
  };

  // ── Walls ──
  // Edge p → q of an outline that runs clockwise seen from above (x right,
  // z toward the viewer): its outward normal is (dz, −dx).
  const wall = (p, q, y0, y1, paint) => {
    const dx = q[0] - p[0], dz = q[1] - p[1], length = Math.hypot(dx, dz);
    const n = [dz / length, 0, -dx / length];
    const uv = (s, y) => {
      if (paint === wood) {
        // Along the grain at the desk's scale (squeezed a little if the wall
        // is longer than the panel), up the wall as on the desk's sides.
        const per = Math.min(perMetre, (wood.u[1] - wood.u[0]) / length);
        return [wood.u[0] + s * per, Math.min(wood.v[1], wood.v[0] + y * perMetre)];
      }
      return [
        paint.u[0] + (s / length) * (paint.u[1] - paint.u[0]),
        paint.v[0] + ((y - y0) / (y1 - y0)) * (paint.v[1] - paint.v[0]),
      ];
    };
    const p0 = [[p[0], y0, p[1]], uv(0, y0)], q0 = [[q[0], y0, q[1]], uv(length, y0)];
    const p1 = [[p[0], y1, p[1]], uv(0, y1)], q1 = [[q[0], y1, q[1]], uv(length, y1)];
    tri(p0, q1, q0, n);
    tri(p0, p1, q1, n);
  };

  // Body: wood round the back, dark on the two front edges — the dark of
  // the desk's own front panels, which the inner one runs on from. The edge
  // along the desk's side is against the desk and never seen.
  const bodyPaint = [wood, wood, dark, dark];
  for (let i = 0; i < 4; i++) wall(body[i], body[i + 1], 0, slabBase, bodyPaint[i]);

  // Top slab: its edge is wood at the back and a cream lip on the overhang.
  const lipPaint = [wood, wood, cream, cream];
  for (let i = 0; i < 4; i++) wall(top[i], top[i + 1], slabBase, desk.top, lipPaint[i]);

  // ── The underside of the overhang ── (seen from a crouch)
  const darkMid = [(dark.u[0] + dark.u[1]) / 2, (dark.v[0] + dark.v[1]) / 2];
  for (let i = 1; i < top.length - 1; i++) {
    const at = k => [[top[k][0], slabBase, top[k][1]], darkMid];
    tri(at(0), at(i), at(i + 1), [0, -1, 0]);
  }

  // ── The top surface ──
  // Wood with the grain running front to back, like the desk's side rims.
  // The top is bigger than the wood panel in the texture, so it is cut into
  // tiles the panel's size, each mirrored against its neighbours: the grain
  // keeps the desk's scale and meets itself at every cut.
  const tileX = (wood.v[1] - wood.v[0]) / perMetre, tileZ = (wood.u[1] - wood.u[0]) / perMetre;
  const minX = Math.min(...top.map(p => p[0])), maxX = Math.max(...top.map(p => p[0]));
  const minZ = Math.min(...top.map(p => p[1])), maxZ = Math.max(...top.map(p => p[1]));
  for (let i = 0; minX + i * tileX < maxX - 1e-9; i++) {
    for (let j = 0; minZ + j * tileZ < maxZ - 1e-9; j++) {
      const x0 = minX + i * tileX, z0 = minZ + j * tileZ;
      let cell = clip(top, 0, x0, true);
      cell = clip(cell, 0, x0 + tileX, false);
      cell = clip(cell, 1, z0, true);
      cell = clip(cell, 1, z0 + tileZ, false);
      if (cell.length < 3) continue;

      const at = ([x, z]) => {
        let tx = (x - x0) / tileX, tz = (z - z0) / tileZ;
        if (i % 2) tx = 1 - tx;
        if (j % 2) tz = 1 - tz;
        return [[x, desk.top, z], [wood.u[0] + tz * (wood.u[1] - wood.u[0]), wood.v[0] + tx * (wood.v[1] - wood.v[0])]];
      };
      for (let k = 1; k < cell.length - 1; k++) {
        const a = at(cell[0]), b = at(cell[k]), c = at(cell[k + 1]);
        // Slivers left by a cut through a corner would only be degenerate faces.
        const area = (b[0][0] - a[0][0]) * (c[0][2] - a[0][2]) - (c[0][0] - a[0][0]) * (b[0][2] - a[0][2]);
        if (Math.abs(area) > 1e-9) tri(a, c, b, [0, 1, 0]);
      }
    }
  }

  // ── Mirror for the left wing ──
  if (side < 0) {
    for (let i = 0; i < positions.length; i += 3) { positions[i] = -positions[i]; normals[i] = -normals[i]; }
    // A mirror turns every face inside out: swap two corners of each to turn it back.
    for (let i = 0; i < positions.length; i += 9) {
      for (const [list, n] of [[positions, 3], [normals, 3]]) {
        for (let k = 0; k < n; k++) [list[i + n + k], list[i + 2 * n + k]] = [list[i + 2 * n + k], list[i + n + k]];
      }
    }
    for (let i = 0; i < uvs.length; i += 6) {
      [uvs[i + 2], uvs[i + 4]] = [uvs[i + 4], uvs[i + 2]];
      [uvs[i + 3], uvs[i + 5]] = [uvs[i + 5], uvs[i + 3]];
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return geometry;
}
