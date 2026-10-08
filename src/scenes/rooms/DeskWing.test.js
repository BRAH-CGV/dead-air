import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { deskWingGeometry, deskWingOutline, DESK_ATLAS, WING } from './DeskWing.js';

// The office's computer desk, as MainOffice seats it.
const DESK = { halfW: 0.8, topHalfW: 0.752, front: -2.15, back: -2.95, top: 0.864 };

function triangles(geometry) {
  const pos = geometry.getAttribute('position'), nor = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv');
  const out = [];
  for (let i = 0; i < pos.count; i += 3) {
    const p = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(pos, i + k));
    const n = new THREE.Vector3().fromBufferAttribute(nor, i);
    const t = [0, 1, 2].map(k => new THREE.Vector2().fromBufferAttribute(uv, i + k));
    const face = new THREE.Vector3().crossVectors(p[1].clone().sub(p[0]), p[2].clone().sub(p[0]));
    out.push({ p, n, t, face });
  }
  return out;
}

const inRect = (t, r, eps = 1e-6) => t.x >= r.u[0] - eps && t.x <= r.u[1] + eps && t.y >= r.v[0] - eps && t.y <= r.v[1] + eps;

describe('deskWingOutline', () => {
  it('the body is the square wing turned 45° with its inner corner on the desk\'s front corner, plus the wedge back to the desk', () => {
    const { body, centre } = deskWingOutline(1, DESK);
    const reach = WING.size * Math.SQRT1_2;
    expect(centre[0]).toBeCloseTo(0.8 + reach);
    expect(centre[1]).toBeCloseTo(-2.15);
    // Desk back corner, wing back corner, outer corner, front corner, desk front corner.
    expect(body.length).toBe(5);
    expect(body[0]).toEqual([0.8, -2.95]);
    expect(body[4]).toEqual([0.8, -2.15]);
    expect(body[3][1]).toBeCloseTo(-2.15 + reach);          // the corner nearest the seat
  });

  it('the top overhangs the two front edges slightly, and runs on over the desk\'s own top edge', () => {
    const { body, top } = deskWingOutline(1, DESK);
    // Front corner pushed out along +z by √2 × the overhang.
    expect(top[3][1] - body[3][1]).toBeCloseTo(WING.overhang * Math.SQRT2);
    expect(WING.overhang).toBeGreaterThan(0.02);
    expect(WING.overhang).toBeLessThan(0.06);                // slight
    // It starts on the desk top's own edge, not the side panel's: no notch between the two tops.
    expect(top[0][0]).toBeCloseTo(DESK.topHalfW);
    expect(top[4][0]).toBeCloseTo(DESK.topHalfW, 1);
    expect(top[4][1]).toBeCloseTo(DESK.front);
    // No overhang at the back: the back edge stays on the body's line.
    expect(top[1]).toEqual(body[1]);
  });

  it('mirrors for the left side', () => {
    const right = deskWingOutline(1, DESK), left = deskWingOutline(-1, DESK);
    expect(left.centre[0]).toBeCloseTo(-right.centre[0]);
    expect(left.top.map(([x]) => x).sort()).toEqual(right.top.map(([x]) => -x).sort());
  });
});

describe('deskWingGeometry', () => {
  it('is one piece, level with the desk top and standing on the floor', () => {
    const geometry = deskWingGeometry(1, DESK);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    expect(box.max.y).toBeCloseTo(DESK.top);
    expect(box.min.y).toBeCloseTo(0);
    expect(box.min.x).toBeCloseTo(DESK.topHalfW);            // butts onto the desk top
    expect(geometry.index).toBeNull();
    expect(geometry.getAttribute('position').count % 3).toBe(0);
  });

  it('every face is wound outward (the desk material draws front faces only) and carries its own flat normal', () => {
    for (const side of [1, -1]) {
      const { centre } = deskWingOutline(side, DESK);
      const middle = new THREE.Vector3(centre[0], DESK.top / 2, centre[1] - 0.15);
      for (const { p, n, face } of triangles(deskWingGeometry(side, DESK))) {
        expect(face.length()).toBeGreaterThan(1e-9);
        expect(face.normalize().dot(n)).toBeGreaterThan(0.99);
        // Walls face away from the middle of the wing; the top faces up.
        const out = p[0].clone().add(p[1]).add(p[2]).divideScalar(3).sub(middle);
        if (Math.abs(n.y) < 0.5) expect(out.dot(n), `side ${side}`).toBeGreaterThan(0);
      }
    }
  });

  it('is textured from the desk\'s own atlas: wood, the dark of its front panels, the cream of its trim', () => {
    const regions = [DESK_ATLAS.wood, DESK_ATLAS.dark, DESK_ATLAS.cream];
    const used = new Set();
    for (const { t } of triangles(deskWingGeometry(1, DESK))) {
      const region = regions.findIndex(r => t.every(uv => inRect(uv, r)));
      expect(region).toBeGreaterThanOrEqual(0);              // never off into the monitor or the keyboard
      used.add(region);
    }
    expect([...used].sort()).toEqual([0, 1, 2]);
  });

  it('keeps the wood at the desk\'s own scale on the top: a metre of wing is a metre of grain', () => {
    // The top is tiled (mirrored) rather than stretched: within a triangle the
    // texture moves DESK_ATLAS.perMetre per metre, the density of the desk's sides.
    const tops = triangles(deskWingGeometry(1, DESK)).filter(({ n, p }) => n.y > 0.9 && Math.abs(p[0].y - DESK.top) < 1e-6);
    expect(tops.length).toBeGreaterThan(2);
    for (const { p, t } of tops) {
      const metres = p[0].distanceTo(p[1]);
      const texels = t[0].distanceTo(t[1]);
      expect(texels / metres).toBeCloseTo(DESK_ATLAS.perMetre, 2);
    }
  });

  it('the left wing is the right one mirrored', () => {
    const a = deskWingGeometry(1, DESK), b = deskWingGeometry(-1, DESK);
    a.computeBoundingBox(); b.computeBoundingBox();
    expect(b.boundingBox.max.x).toBeCloseTo(-a.boundingBox.min.x);
    expect(b.boundingBox.min.x).toBeCloseTo(-a.boundingBox.max.x);
    expect(b.boundingBox.min.z).toBeCloseTo(a.boundingBox.min.z);
  });
});
