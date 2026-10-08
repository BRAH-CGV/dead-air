import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { LINING, SURFACES, floorQuad, ceilingQuad, wallQuad, liningGeometry, liningTint, liningMaterials } from './RoomLining.js';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { ASSETS, PRELOAD } from '../../assets/manifest.js';

/** The texture files as they were painted: pixels, and the metres of real
 *  surface each covers [across, up]. */
const TEXTURES = {
  floor:   { size: [512, 512],  metres: [2, 2] },       // 4 × 4 panels of 0.5 m
  wall:    { size: [512, 1024], metres: [1.5, 3] },     // two 0.75 m panels, floor to ceiling
  ceiling: { size: [512, 512],  metres: [2.4, 2.4] },   // 4 × 4 panels of 0.6 m, one with a vent
};

/** The triangles of a geometry: corner positions, uvs, and the face's own normal. */
function triangles(geometry) {
  const pos = geometry.getAttribute('position'), uv = geometry.getAttribute('uv'), index = geometry.getIndex();
  const out = [];
  for (let i = 0; i < index.count; i += 3) {
    const ids = [0, 1, 2].map(k => index.getX(i + k));
    const p = ids.map(id => new THREE.Vector3().fromBufferAttribute(pos, id));
    const t = ids.map(id => new THREE.Vector2().fromBufferAttribute(uv, id));
    out.push({ p, t, face: new THREE.Vector3().crossVectors(p[1].clone().sub(p[0]), p[2].clone().sub(p[0])).normalize() });
  }
  return out;
}

describe('LINING', () => {
  it('names textures the scene preloads: colour as sRGB, normals as data, a pair for each surface', () => {
    expect(Object.keys(LINING.textures).sort()).toEqual([...SURFACES].sort());
    for (const [colour, normal] of Object.values(LINING.textures)) {
      expect(PRELOAD).toEqual(expect.arrayContaining([colour, normal]));
      expect(ASSETS[colour].colorSpace).toBe('srgb');
      expect(ASSETS[normal].colorSpace).toBe('linear');
      expect(ASSETS[colour].repeat, colour).toEqual(ASSETS[normal].repeat);
    }
  });

  it('stands a sheet a few millimetres off its surface: clear of the depth buffer, too thin to see', () => {
    expect(LINING.gap).toBeGreaterThanOrEqual(0.002);
    expect(LINING.gap).toBeLessThanOrEqual(0.006);
  });
});

describe('floor and ceiling sheets', () => {
  const rect = { x0: -3, x1: 3, z0: -4, z1: 4 };

  it('the floor faces up and the ceiling down, whichever way their corners run', () => {
    for (const { face } of triangles(liningGeometry([floorQuad(rect, 0.004)]))) expect(face.y).toBeCloseTo(1);
    for (const { face } of triangles(liningGeometry([ceilingQuad(rect, 2.996)]))) expect(face.y).toBeCloseTo(-1);
  });

  it('maps the floor in metres of the world: a 0.5 m deck plate wherever the room is', () => {
    const [tx, tz] = LINING.tile.floor;
    const here = floorQuad(rect, 0), there = floorQuad(rect, 0, [13.2, 0, 1]);
    // 6 m of floor is 6 / 2 repeats across, 8 / 2 deep.
    const span = q => [0, 1].map(k => Math.max(...q.uvs.map(t => t[k])) - Math.min(...q.uvs.map(t => t[k])));
    expect(span(here)[0]).toBeCloseTo(6 / tx);
    expect(span(here)[1]).toBeCloseTo(8 / tz);
    // The same point of the world has the same place in the pattern from
    // either room: a room and its corridor meet without a break.
    const a = floorQuad({ x0: 5, x1: 6, z0: 3, z1: 4 }, 0, [0, 0, 0]);
    const b = floorQuad({ x0: 5 - 8.1, x1: 6 - 8.1, z0: 3 - 3.5, z1: 4 - 3.5 }, 0, [8.1, 0, 3.5]);
    for (let i = 0; i < 4; i++) {
      expect(b.uvs[i][0]).toBeCloseTo(a.uvs[i][0]);
      expect(b.uvs[i][1]).toBeCloseTo(a.uvs[i][1]);
    }
    expect(there.uvs[0][0]).not.toBeCloseTo(here.uvs[0][0]);
  });
});

describe('wall sheets', () => {
  it('each faces into the room', () => {
    const inward = { back: [0, 0, 1], front: [0, 0, -1], left: [1, 0, 0], right: [-1, 0, 0] };
    for (const [side, n] of Object.entries(inward)) {
      const face = side === 'back' || side === 'left' ? -2.9 : 2.9;
      for (const { face: f } of triangles(liningGeometry([wallQuad(side, -2, 2, 0, 3, face)]))) {
        expect(f.toArray().map(v => Math.round(v)), side).toEqual(n);
      }
    }
  });

  it('runs the wall\'s height through the texture once: the skirting at the floor, on every piece of wall', () => {
    const whole = wallQuad('back', -3, 3, 0, 3, -4.9);
    expect(Math.min(...whole.uvs.map(t => t[1]))).toBeCloseTo(0);
    expect(Math.max(...whole.uvs.map(t => t[1]))).toBeCloseTo(1);
    // The header over a 2.2 m doorway starts 2.2 m up the same texture.
    const header = wallQuad('back', -0.5, 0.5, 2.2, 3, -4.9);
    expect(Math.min(...header.uvs.map(t => t[1]))).toBeCloseTo(2.2 / 3);
  });

  it('carries the pattern across a doorway: the pieces either side line up with the header over it', () => {
    const left = wallQuad('front', -3, -0.6, 0, 3, 4.9), header = wallQuad('front', -0.6, 0.6, 2.2, 3, 4.9);
    const uAt = (quad, a) => quad.uvs[quad.positions.findIndex(p => Math.abs(p[0] - a) < 1e-9)][0];
    expect(uAt(left, -0.6)).toBeCloseTo(uAt(header, -0.6));
  });

  it('never mirrors the texture: seen from inside, it runs left to right on all four walls', () => {
    // Looking at a wall from the middle of the room, u must grow toward the
    // viewer's right: right = up × (direction faced), with up = +y.
    const facing = { back: [0, 0, -1], front: [0, 0, 1], left: [-1, 0, 0], right: [1, 0, 0] };
    for (const [side, look] of Object.entries(facing)) {
      const face = side === 'back' || side === 'left' ? -2.9 : 2.9;
      const quad = wallQuad(side, -2, 2, 0, 3, face);
      const right = new THREE.Vector3(...look).cross(new THREE.Vector3(0, 1, 0));
      const lo = quad.uvs.reduce((m, t, i) => t[0] < quad.uvs[m][0] ? i : m, 0);
      const hi = quad.uvs.reduce((m, t, i) => t[0] > quad.uvs[m][0] ? i : m, 0);
      const across = new THREE.Vector3(...quad.positions[hi]).sub(new THREE.Vector3(...quad.positions[lo]));
      expect(across.dot(right), side).toBeGreaterThan(0);
    }
  });
});

describe('liningGeometry', () => {
  it('merges every piece into one mesh\'s worth: four corners and two triangles a piece', () => {
    const geometry = liningGeometry([
      wallQuad('back', -3, 3, 0, 3, -3.9), wallQuad('left', -3.9, 3.9, 0, 3, -2.9), wallQuad('right', -3.9, 3.9, 0, 3, 2.9),
    ]);
    expect(geometry.getAttribute('position').count).toBe(12);
    expect(geometry.getIndex().count).toBe(18);
    expect(geometry.getAttribute('uv').count).toBe(12);
  });
});

describe('liningTint', () => {
  it('keeps a room\'s mood: a darker room has a darker lining, and its hue leans the same way', () => {
    const office = liningTint(new THREE.Color(0x2f3945), 'wall');
    const server = liningTint(new THREE.Color(0x1b2128), 'wall');
    const quarters = liningTint(new THREE.Color(0x3b3530), 'wall');
    const lum = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    expect(lum(server)).toBeLessThan(lum(office));
    expect(office.b).toBeGreaterThan(office.r);          // cool
    expect(quarters.r).toBeGreaterThan(quarters.b);      // warm
  });

  it('lets the textures through: much nearer grey than the room\'s own colour, and brighter to make up for the painting', () => {
    const room = new THREE.Color(0x2f3945), tint = liningTint(room, 'wall');
    const spread = c => (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) / Math.max(c.r, c.g, c.b);
    expect(spread(tint)).toBeLessThan(spread(room) * 0.5);
    expect(tint.g).toBeGreaterThan(room.g);
  });
});

describe('liningMaterials', () => {
  const assets = () => {
    const cache = new Map(Object.values(LINING.textures).flat().map(key => [key, new THREE.Texture()]));
    return { has: key => cache.has(key), get: key => cache.get(key), cache };
  };
  const base = new THREE.MeshStandardMaterial({ color: 0x2f3945 });

  it('one material a surface, each with its own colour and normal map from the cache', () => {
    const a = assets(), mats = liningMaterials(a, base);
    for (const [surface, [colour, normal]] of Object.entries(LINING.textures)) {
      expect(mats[surface].map, surface).toBe(a.cache.get(colour));
      expect(mats[surface].normalMap, surface).toBe(a.cache.get(normal));
      expect(mats[surface].metalness, surface).toBe(0);
      expect(mats[surface].roughness, surface).toBeGreaterThan(0.6);     // nothing in here shines
    }
  });

  it('is null when the textures aren\'t loaded, so the room keeps its plain boxes', () => {
    expect(liningMaterials(undefined, base)).toBeNull();
    expect(liningMaterials({ has: () => false, get: () => { throw new Error('not loaded'); } }, base)).toBeNull();
    const partial = assets();
    partial.cache.delete(LINING.textures.wall[1]);
    expect(liningMaterials(partial, base)).toBeNull();
  });
});

describe('the interior\'s texture files', () => {
  it('there is one for every surface', () => {
    expect(Object.keys(TEXTURES).sort()).toEqual([...SURFACES].sort());
  });

  it('each covers the lining\'s tile, or its manifest entry makes up the difference', () => {
    // The mapping lays one repeat over LINING.tile metres; `repeat` scales
    // that to the metres the texture was painted to cover.
    for (const surface of SURFACES) {
      const { metres } = TEXTURES[surface];
      const { repeat } = ASSETS[LINING.textures[surface][0]];
      expect(repeat[0], surface).toBeCloseTo(LINING.tile[surface][0] / metres[0], 3);
      expect(repeat[1], surface).toBeCloseTo(LINING.tile[surface][1] / metres[1], 3);
    }
  });

  it('are in public/, PNGs of the size they were painted at', () => {
    for (const surface of SURFACES) {
      for (const key of LINING.textures[surface]) {
        const png = fs.readFileSync(`public/${ASSETS[key].url}`);
        expect(png.subarray(1, 4).toString('ascii'), key).toBe('PNG');
        expect([png.readUInt32BE(16), png.readUInt32BE(20)], key).toEqual(TEXTURES[surface].size);
      }
    }
  });

  it('the floor and ceiling as painted meet themselves at every edge: left to right and top to bottom', () => {
    // Read the colour PNGs back (they are written unfiltered) and compare
    // each edge with the opposite one: neighbours across the wrap should
    // differ no more than neighbours anywhere else do.
    for (const surface of ['floor', 'ceiling']) {
      const png = fs.readFileSync(`public/${ASSETS[LINING.textures[surface][0]].url}`);
      const [w, h] = TEXTURES[surface].size;
      const idat = [];
      for (let o = 8; o < png.length;) {
        const len = png.readUInt32BE(o);
        if (png.subarray(o + 4, o + 8).toString() === 'IDAT') idat.push(png.subarray(o + 8, o + 8 + len));
        o += len + 12;
      }
      const raw = zlib.inflateSync(Buffer.concat(idat));
      const at = (x, y) => raw[y * (w * 3 + 1) + 1 + x * 3 + 1];             // green channel
      let acrossWrap = 0, inside = 0;
      for (let i = 0; i < h; i++) {
        acrossWrap += Math.abs(at(0, i) - at(w - 1, i)) + Math.abs(at(i, 0) - at(i, h - 1));
        inside += Math.abs(at(200, i) - at(201, i)) + Math.abs(at(i, 200) - at(i, 201));
      }
      expect(acrossWrap, surface).toBeLessThan(inside * 2.5 + h * 4);
    }
  });
});
