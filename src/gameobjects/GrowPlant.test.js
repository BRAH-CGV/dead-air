import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildGrowPlant, GROW_PLANT } from './GrowPlant.js';

const bounds = g => (g.computeBoundingBox(), g.boundingBox);
const triangles = g => (g.index ? g.index.count : g.attributes.position.count) / 3;
const all = p => [p.stems, p.leaves, p.fruit];

describe('GrowPlant', () => {
  it('stands on its own origin, as tall as GROW_PLANT.height', () => {
    const p = buildGrowPlant();
    const box = new THREE.Box3();
    for (const g of all(p)) box.union(bounds(g));
    expect(box.min.y).toBeGreaterThan(-0.01);
    expect(box.min.y).toBeLessThan(0.01);
    expect(box.max.y).toBeGreaterThan(GROW_PLANT.height * 0.85);
    expect(box.max.y).toBeLessThan(GROW_PLANT.height * 1.15);
  });

  it('is a bush, not a stick: the canopy is most of its height across', () => {
    const leaves = bounds(buildGrowPlant().leaves);
    const width = Math.min(leaves.max.x - leaves.min.x, leaves.max.z - leaves.min.z);
    expect(width).toBeGreaterThan(GROW_PLANT.height * 0.6);
    expect(triangles(buildGrowPlant().leaves)).toBeGreaterThan(1200);   // a full canopy of leaves
  });

  it('keeps inside its tray: no wider than a tray holds two of', () => {
    const leaves = bounds(buildGrowPlant().leaves);
    expect(leaves.max.x - leaves.min.x).toBeLessThan(0.48);
    expect(leaves.max.z - leaves.min.z).toBeLessThan(0.48);
  });

  it('carries beans in clusters along its branches: dozens of small ones', () => {
    const { fruit } = buildGrowPlant();
    const count = triangles(fruit) / 20;          // an icosahedron at detail 0 is 20 triangles
    expect(count).toBeGreaterThanOrEqual(30);
    expect(count).toBeLessThanOrEqual(100);
    const box = bounds(fruit);
    expect(Math.max(box.max.x - box.min.x, box.max.z - box.min.z)).toBeGreaterThan(0.15);
    expect(box.max.y - box.min.y).toBeGreaterThan(0.15);
  });

  it('leaves its beans a pale neutral, so the rack tints each bush ripe or not per night', () => {
    const colour = buildGrowPlant().fruit.attributes.color;
    const c = new THREE.Color(), hsl = {};
    const shades = new Set();
    for (let i = 0; i < colour.count; i += 3) {
      c.fromBufferAttribute(colour, i).getHSL(hsl);
      expect(hsl.s).toBeLessThan(0.15);
      expect(hsl.l).toBeGreaterThan(0.6);
      shades.add(hsl.l.toFixed(2));
    }
    expect(shades.size).toBeGreaterThan(3);       // each bean a touch lighter or darker
  });

  it('hangs its fruit inside the bush, not floating off it', () => {
    const p = buildGrowPlant();
    const bush = bounds(p.leaves).clone().expandByScalar(0.02);
    expect(bush.containsBox(bounds(p.fruit))).toBe(true);
  });

  it('gives its leaves varied, dark greens, so the canopy is not one flat colour', () => {
    const colour = buildGrowPlant().leaves.attributes.color;
    const greens = new Set();
    for (let i = 0; i < colour.count; i += 7) {
      expect(colour.getY(i)).toBeGreaterThan(colour.getX(i));              // green, not brown
      greens.add(colour.getY(i).toFixed(2));
    }
    expect(greens.size).toBeGreaterThan(5);
  });

  it('stays cheap: twelve of them is well under a hundred thousand triangles', () => {
    const total = all(buildGrowPlant()).reduce((n, g) => n + triangles(g), 0);
    expect(total).toBeLessThan(6000);
  });

  it('has normals, for lighting', () => {
    for (const g of all(buildGrowPlant())) expect(g.attributes.normal).toBeDefined();
  });

  it('is the same plant for the same seed, and a different one for another', () => {
    const a = buildGrowPlant({ seed: 3 }).leaves.attributes.position.array;
    const b = buildGrowPlant({ seed: 3 }).leaves.attributes.position.array;
    const c = buildGrowPlant({ seed: 4 }).leaves.attributes.position.array;
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });
});
