import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildBeanProcessor, PROCESSOR, PROCESSOR_LABELS, PROCESSOR_SOLIDS, NEAR_PROCESSOR, BAG_SPOTS, LID_OPEN } from './BeanProcessor.js';

const CEILING = 3;

function build(opts = {}) {
  const target = new THREE.Group();
  const owned = [];
  const parts = buildBeanProcessor(target, { own: r => (owned.push(r), r), ceiling: CEILING, ...opts });
  target.updateMatrixWorld(true);
  return { target, owned, parts };
}
/** A part's box, from the floor under the machine's middle. */
const boxOf = (target, mesh) => new THREE.Box3().setFromObject(mesh).translate(new THREE.Vector3(0, PROCESSOR.size[1] / 2, 0));
const meshes = target => {
  const out = [];
  target.traverse(o => { if (o.isMesh) out.push(o); });
  return out;
};

describe('buildBeanProcessor', () => {
  it('stands in its box: everything but its pipes, valve and side hopper inside the footprint and under its top, the front details proud of +x', () => {
    const { target, parts } = build();
    const [w, h, d] = PROCESSOR.size;
    const hop = PROCESSOR.hopper;
    for (const mesh of meshes(target)) {
      if ([parts.pipes, parts.valve].includes(mesh)) continue;                 // out to the beds, up to the ceiling
      if ([parts.hopper, parts.accent, parts.labels, parts.load, parts.steel, parts.trim, parts.dark, parts.lid].includes(mesh)) {
        // On or round the hopper, out of the +z side: no further than its mouth.
        const box = boxOf(target, mesh);
        expect(box.max.z, mesh.name).toBeLessThanOrEqual(hop.z + hop.mouth / 2 + 0.03);
        expect(box.min.z, mesh.name).toBeGreaterThanOrEqual(-d / 2 - 1e-6);
        continue;
      }
      const box = boxOf(target, mesh);
      expect(box.min.y, mesh.name).toBeGreaterThanOrEqual(-1e-6);
      expect(box.max.y, mesh.name).toBeLessThanOrEqual(h + 1e-6);
      expect(box.min.x, mesh.name).toBeGreaterThanOrEqual(-w / 2 - 1e-6);
      expect(box.max.x, mesh.name).toBeLessThanOrEqual(w / 2 + 0.06);   // bezels, buttons, the bay's lip
      expect(Math.max(-box.min.z, box.max.z), mesh.name).toBeLessThanOrEqual(d / 2 + 1e-6);
    }
  });

  it('takes the beans in on its side, toward the bin: a hopper out of the +z side at chest height, its lid on a hinge', () => {
    const { target, parts } = build();
    const hop = PROCESSOR.hopper;
    const hopper = boxOf(target, parts.hopper);
    const d = PROCESSOR.size[2];
    expect(hopper.min.z).toBeGreaterThan(d / 2 - 0.01);                        // out of the side, not on top
    const mouth = hop.base + hop.height;
    expect(mouth).toBeGreaterThan(1.1);
    expect(mouth).toBeLessThan(1.45);                                            // under a standing eye
    const lid = parts.lid;
    expect(lid.castShadow).toBe(false);                                          // it swings under frozen shadow maps
    expect(lid.rotation.x).toBe(LID_OPEN);
    expect(boxOf(target, lid).max.y).toBeGreaterThan(mouth + 0.3);               // open: stood up
    lid.rotation.x = 0;
    target.updateMatrixWorld(true);
    const shut = boxOf(target, lid);
    expect(shut.max.y).toBeLessThan(mouth + 0.05);                              // shut: flat over the mouth
    expect(shut.min.z).toBeLessThan(hop.z - hop.mouth / 2 + 0.01);
    expect(shut.max.z).toBeGreaterThan(hop.z + hop.mouth / 2 - 0.01);
    lid.rotation.x = LID_OPEN;
    // Nothing over its mouth: open to a pile dropped from above.
    const ray = new THREE.Raycaster(new THREE.Vector3(hop.x, 2.5 - PROCESSOR.size[1] / 2, hop.z + 0.05), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(parts.hopper)[0];
    expect(hit === undefined || hit.point.y + PROCESSOR.size[1] / 2 < mouth).toBe(true);
  });

  it('braces the hopper with a strut from low on the cabinet\'s side up and out to the hopper\'s foot', () => {
    // The strut is the trim bucket's only part below the hopper, off the side.
    const { parts } = build();
    const pos = parts.trim.geometry.getAttribute('position');
    const hop = PROCESSOR.hopper, wall = PROCESSOR.size[2] / 2;
    let low = null, high = null;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i), z = pos.getZ(i);                                   // built from the floor up
      if (z < wall - 1e-3 || y > hop.base + 0.01) continue;                     // off the side, under the hopper
      if (!low || y < low.y) low = { y, z };
      if (!high || y > high.y) high = { y, z };
    }
    expect(low.z).toBeLessThan(wall + 0.05);                                     // its foot on the cabinet
    expect(high.z).toBeGreaterThan(hop.z - 0.05);                                // its head out under the hopper
  });

  it('feeds from the grow beds beside it and draws power from the ceiling', () => {
    const { target, parts } = build();
    const pipes = boxOf(target, parts.pipes);
    expect(pipes.min.z).toBeLessThan(-PROCESSOR.size[2] / 2 - 0.1);             // toward the beds (−z)
    expect(pipes.max.y).toBeCloseTo(CEILING, 2);                               // the conduit
    expect(boxOf(target, parts.valve).min.z).toBeLessThan(-PROCESSOR.size[2] / 2);
  });

  it('shows the work going on: a lit window on the process, a screen, three lamps and a button, all glows the grid can dim', () => {
    const { target, parts } = build();
    for (const name of ['window', 'screen', 'button', 'bayLight']) {
      expect(parts[name].material.emissive.getHex(), name).not.toBe(0);
      expect(parts[name].material.emissiveIntensity, name).toBeGreaterThan(0);
      expect(boxOf(target, parts[name]).max.x, name).toBeGreaterThan(PROCESSOR.size[0] / 2 - 0.35);
    }
    expect(parts.lamps).toHaveLength(3);
    expect(new Set(parts.lamps.map(l => l.material.emissive.getHex())).size).toBe(3);
    expect(boxOf(target, parts.window).min.y).toBeGreaterThan(PROCESSOR.bay[1]);   // above the bay
  });

  it('turns its burrs behind the window on a pivot of their own, and shows beans in the hopper while it works', () => {
    const { target, parts } = build();
    const paddles = parts.paddles;
    expect(paddles.castShadow).toBe(false);                                      // spins under frozen shadow maps
    const centre = boxOf(target, parts.window).getCenter(new THREE.Vector3());
    const pivot = paddles.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, PROCESSOR.size[1] / 2, 0));
    expect(pivot.y).toBeCloseTo(centre.y, 2);
    expect(pivot.z).toBeCloseTo(centre.z, 2);
    const load = parts.load;
    expect(load.visible).toBe(false);
    expect(load.castShadow).toBe(false);
    const box = boxOf(target, load);
    expect(box.min.y).toBeGreaterThan(PROCESSOR.hopper.base);
    expect(box.max.y).toBeLessThan(PROCESSOR.hopper.base + PROCESSOR.hopper.height);   // down in the funnel
  });

  it('hands the coffee out at waist height: a lit bay open at the front, with a chute over two spots for bags', () => {
    const { target, parts } = build();
    const [y0, y1] = PROCESSOR.bay;
    const half = PROCESSOR.size[1] / 2;
    expect(y0).toBeGreaterThan(0.7);
    expect(y1).toBeLessThan(1.3);
    expect(BAG_SPOTS).toHaveLength(2);
    for (const [x, y, z] of BAG_SPOTS) {
      expect(y + half).toBeGreaterThanOrEqual(y0);
      expect(y + half).toBeLessThan(y0 + 0.05);
      expect(x).toBeGreaterThan(PROCESSOR.bayBack + 0.06);                       // a bag's half-depth clear of the back
      expect(x).toBeLessThan(PROCESSOR.size[0] / 2 - 0.06);
      expect(Math.abs(z)).toBeLessThan(PROCESSOR.bayHalfWidth - 0.07);
    }
    expect(boxOf(target, parts.chute).max.y).toBeCloseTo(y1, 1);
    const light = boxOf(target, parts.bayLight);
    expect(light.min.y).toBeGreaterThan(y1 - 0.03);
    // Nothing solid across the opening: the cabinet's steel stops at its sides and above and below.
    const ray = new THREE.Raycaster(new THREE.Vector3(1, (y0 + y1) / 2 - half, 0), new THREE.Vector3(-1, 0, 0));
    const hit = ray.intersectObject(parts.steel)[0];
    expect(hit.point.x).toBeLessThanOrEqual(PROCESSOR.bayBack + 1e-6);
  });

  it('is solid round the bay, not across it: a bag stands in the bay and the hopper is open from above', () => {
    const boxes = PROCESSOR_SOLIDS.map(({ size, at }) => new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(...at), new THREE.Vector3(...size)));
    const [w, h, d] = PROCESSOR.size;
    const all = boxes.reduce((u, b) => u.union(b), new THREE.Box3());
    expect(all.min.toArray().map(v => +v.toFixed(4))).toEqual([-w / 2, -h / 2, -d / 2]);
    const hop = PROCESSOR.hopper;
    expect(all.max.z).toBeCloseTo(hop.z + hop.mouth / 2);                       // the hopper, a box to land beans on
    expect(all.max.y).toBeCloseTo(PROCESSOR.cabinetTop - h / 2);               // nothing over the top
    for (const [x, y, z] of BAG_SPOTS) {
      const bag = new THREE.Box3(new THREE.Vector3(x - 0.05, y + 0.002, z - 0.065), new THREE.Vector3(x + 0.05, y + 0.18, z + 0.065));
      for (const b of boxes) expect(b.intersectsBox(bag)).toBe(false);
    }
    const near = new THREE.Box3(new THREE.Vector3(...NEAR_PROCESSOR.min), new THREE.Vector3(...NEAR_PROCESSOR.max));
    const floor = -h / 2 + 0.03;
    expect(near.containsPoint(new THREE.Vector3(hop.x, hop.base + hop.height - h / 2 + 0.03, hop.z))).toBe(true);   // on the hopper
    expect(near.containsPoint(new THREE.Vector3(0.8, floor, 0))).toBe(true);           // on the floor in front
    expect(near.containsPoint(new THREE.Vector3(0.3, floor, hop.z + 0.3))).toBe(true); // on the floor by the hopper
    expect(near.containsPoint(new THREE.Vector3(0.6, floor, -d / 2 - 0.2))).toBe(false);   // toward the grow beds
  });

  it('wears a coffee-brown band, so it reads as something new beside the grow beds', () => {
    const { parts } = build();
    const hsl = {};
    parts.accent.material.color.getHSL(hsl);
    expect(hsl.h).toBeGreaterThan(0.03);
    expect(hsl.h).toBeLessThan(0.12);                                            // brown, not grey
  });

  it('says what it is: four plates from the label atlas, each its own strip', () => {
    const atlas = new THREE.Texture();
    const { parts } = build({ labels: atlas });
    expect(parts.labels.material.map).toBe(atlas);
    const uv = parts.labels.geometry.getAttribute('uv');
    const rows = new Set();
    for (let i = 0; i < uv.count; i += 3) {                                      // each triangle's middle
      const v = (uv.getY(i) + uv.getY(i + 1) + uv.getY(i + 2)) / 3;
      rows.add(Math.floor((1 - v) * Object.keys(PROCESSOR_LABELS).length));
    }
    expect([...rows].sort()).toEqual([0, 1, 2, 3]);
    expect(build().parts.labels.material.map).toBeNull();                      // plain plates without it
  });

  it('is a handful of draw calls: its parts merged by material', () => {
    const { target } = build();
    expect(meshes(target).length).toBeLessThanOrEqual(20);
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
