import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildFoodDispenser, DISPENSER, DISPENSER_LABELS } from './FoodDispenser.js';

const CEILING = 3;

function build(opts = {}) {
  const target = new THREE.Group();
  const owned = [];
  const parts = buildFoodDispenser(target, { own: r => (owned.push(r), r), ceiling: CEILING, ...opts });
  target.updateMatrixWorld(true);
  return { target, owned, parts };
}
/** A part's box, from the floor under the machine's middle. */
const boxOf = (target, mesh) => new THREE.Box3().setFromObject(mesh).translate(new THREE.Vector3(0, DISPENSER.size[1] / 2, 0));
const meshes = target => {
  const out = [];
  target.traverse(o => { if (o.isMesh) out.push(o); });
  return out;
};

describe('buildFoodDispenser', () => {
  it('stands in its box: everything but its pipes, valve and open lid inside the footprint and under its top, the front details proud of +x', () => {
    const { target, parts } = build();
    const [w, h, d] = DISPENSER.size;
    for (const mesh of meshes(target)) {
      if ([parts.pipes, parts.valve, parts.hopper].includes(mesh)) continue;   // out to the beds, up to the ceiling, the lid
      const box = boxOf(target, mesh);
      expect(box.min.y, mesh.name).toBeGreaterThanOrEqual(-1e-6);
      expect(box.max.y, mesh.name).toBeLessThanOrEqual(h + 1e-6);
      expect(box.min.x, mesh.name).toBeGreaterThanOrEqual(-w / 2 - 1e-6);
      expect(box.max.x, mesh.name).toBeLessThanOrEqual(w / 2 + 0.06);   // bezels, buttons, the bay's lip
      expect(Math.max(-box.min.z, box.max.z), mesh.name).toBeLessThanOrEqual(d / 2 + 1e-6);
    }
  });

  it('takes the crop in at the top: a hopper over the cabinet, its lid propped open', () => {
    const { target, parts } = build();
    const hopper = boxOf(target, parts.hopper);
    const mouth = DISPENSER.cabinetTop + DISPENSER.hopper.height;
    expect(hopper.min.y).toBeGreaterThan(DISPENSER.cabinetTop - 0.01);
    expect(hopper.max.y).toBeGreaterThan(mouth + 0.3);                           // the lid, up and open
    // Nothing but the lid over its mouth: open to the crop.
    const ray = new THREE.Raycaster(new THREE.Vector3(DISPENSER.hopper.x + 0.05, 2, DISPENSER.hopper.z), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(parts.hopper)[0];
    expect(hit === undefined || hit.point.y + DISPENSER.size[1] / 2 < mouth).toBe(true);
  });

  it('feeds from the grow beds beside it and draws power from the ceiling', () => {
    const { target, parts } = build();
    const pipes = boxOf(target, parts.pipes);
    expect(pipes.min.z).toBeLessThan(-DISPENSER.size[2] / 2 - 0.1);             // toward the beds (−z)
    expect(pipes.max.y).toBeCloseTo(CEILING, 2);                               // the conduit
    expect(boxOf(target, parts.valve).min.z).toBeLessThan(-DISPENSER.size[2] / 2);
  });

  it('shows the work going on: a lit window on the process, a screen, three lamps and a button, all glows the grid can dim', () => {
    const { target, parts } = build();
    for (const name of ['window', 'screen', 'button', 'bayLight']) {
      expect(parts[name].material.emissive.getHex(), name).not.toBe(0);
      expect(parts[name].material.emissiveIntensity, name).toBeGreaterThan(0);
      expect(boxOf(target, parts[name]).max.x, name).toBeGreaterThan(DISPENSER.size[0] / 2 - 0.35);
    }
    expect(parts.lamps).toHaveLength(3);
    expect(new Set(parts.lamps.map(l => l.material.emissive.getHex())).size).toBe(3);
    expect(boxOf(target, parts.window).min.y).toBeGreaterThan(DISPENSER.bay[1]);   // above the bay
  });

  it('serves the meal at waist height: a lit bay open at the front, a meal tray waiting in it', () => {
    const { target, parts } = build();
    const [y0, y1] = DISPENSER.bay;
    expect(y0).toBeGreaterThan(0.7);
    expect(y1).toBeLessThan(1.3);
    const tray = boxOf(target, parts.tray);
    expect(tray.min.y).toBeGreaterThanOrEqual(y0 - 1e-6);
    expect(tray.max.y).toBeLessThan(y0 + 0.06);
    expect(tray.min.x).toBeGreaterThan(DISPENSER.bayBack);                    // in the recess, not in the wall
    expect(tray.max.x).toBeLessThan(DISPENSER.size[0] / 2);
    const light = boxOf(target, parts.bayLight);
    expect(light.min.y).toBeGreaterThan(y1 - 0.03);
    // Nothing solid across the opening: the cabinet's steel stops at its sides and above and below.
    const steel = parts.steel.geometry;
    steel.computeBoundingBox();
    const ray = new THREE.Raycaster(new THREE.Vector3(1, (y0 + y1) / 2 - DISPENSER.size[1] / 2, 0), new THREE.Vector3(-1, 0, 0));
    const hit = ray.intersectObject(parts.steel)[0];
    expect(hit.point.x).toBeLessThanOrEqual(DISPENSER.bayBack + 1e-6);
  });

  it('says what it is: four plates from the label atlas, each its own strip', () => {
    const atlas = new THREE.Texture();
    const { parts } = build({ labels: atlas });
    expect(parts.labels.material.map).toBe(atlas);
    const uv = parts.labels.geometry.getAttribute('uv');
    const rows = new Set();
    for (let i = 0; i < uv.count; i += 3) {                                      // each triangle's middle
      const v = (uv.getY(i) + uv.getY(i + 1) + uv.getY(i + 2)) / 3;
      rows.add(Math.floor((1 - v) * Object.keys(DISPENSER_LABELS).length));
    }
    expect([...rows].sort()).toEqual([0, 1, 2, 3]);
    expect(build().parts.labels.material.map).toBeNull();                      // plain plates without it
  });

  it('is a handful of draw calls: its parts merged by material', () => {
    const { target } = build();
    expect(meshes(target).length).toBeLessThanOrEqual(15);
  });

  it('owns what it builds, but never the label atlas (the asset cache\'s)', () => {
    const atlas = new THREE.Texture();
    const { target, owned } = build({ labels: atlas });
    for (const mesh of meshes(target)) {
      expect(owned, mesh.name).toContain(mesh.geometry);
      expect(owned, mesh.name).toContain(mesh.material);
    }
    expect(owned).not.toContain(atlas);
  });
});
