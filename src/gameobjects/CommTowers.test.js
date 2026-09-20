import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

import { createCommTowers, COMM_TOWERS } from './CommTowers.js';
import { TERRAIN, terrainHeightAt } from './MarsTerrain.js';

/** The instanced parts, by the material they carry. */
function partsOf(towers) {
  const meshes = towers.object3d.children.filter(o => o.isInstancedMesh);
  return {
    lamps: meshes.find(m => m.material.isMeshBasicMaterial),
    steel: meshes.filter(m => m.material.isMeshStandardMaterial),
    sprites: towers.object3d.children.filter(o => o.isSprite),
  };
}

function positions(mesh) {
  const out = [];
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix);
    matrix.decompose(position, quaternion, scale);
    out.push({ position: position.clone(), scale: scale.clone() });
  }
  return out;
}

describe('structure', () => {
  it('is a group, so the editor never measures a valley-wide box', () => {
    expect(createCommTowers().isGroup).toBe(true);
  });

  it('raises the asked-for number of masts', () => {
    const towers = createCommTowers();
    expect(towers.sites.length).toBe(COMM_TOWERS.count);
    expect(createCommTowers({ count: 3 }).sites.length).toBe(3);
  });

  it('shares one geometry per part rather than building five of each', () => {
    const { steel, lamps } = partsOf(createCommTowers());
    for (const mesh of [...steel, lamps]) {
      expect(mesh.isInstancedMesh).toBe(true);
    }
  });
});

describe('siting', () => {
  it('stands them along the crest, spread around it', () => {
    const towers = createCommTowers();
    const bearings = [];

    for (const site of towers.sites) {
      const r = Math.hypot(site.x, site.z);
      // Near the rim: far enough out to be scenery, inside the camera's far
      // plane of 1000 so they are drawn at all.
      expect(r).toBeGreaterThan(TERRAIN.CREST_RADIUS - 60);
      expect(r).toBeLessThan(TERRAIN.CREST_RADIUS + 60);
      let a = Math.atan2(site.z, site.x);
      if (a < 0) a += Math.PI * 2;
      bearings.push(a);
    }

    // Stratified, so they cannot bunch on one side and leave the rest of the
    // rim bare — the whole point is that they ring the valley.
    bearings.sort((a, b) => a - b);
    for (let i = 0; i < bearings.length; i++) {
      const gap = i === 0
        ? bearings[0] + Math.PI * 2 - bearings[bearings.length - 1]
        : bearings[i] - bearings[i - 1];
      expect(gap).toBeGreaterThan(0.4);
    }
  });

  it('puts each mast on the high ground near its bearing', () => {
    // A mast dropped at its nominal spot can end up behind the next hill and
    // be invisible from the base, which defeats the object. Each one should
    // therefore beat most of the ground around it, not merely sit on it.
    const towers = createCommTowers();

    for (const site of towers.sites) {
      expect(site.ground).toBeCloseTo(terrainHeightAt(site.x, site.z), 5);

      let beaten = 0;
      const samples = 40;
      for (let i = 0; i < samples; i++) {
        const a = (i / samples) * Math.PI * 2;
        const near = terrainHeightAt(
          site.x + Math.cos(a) * COMM_TOWERS.siteSpread,
          site.z + Math.sin(a) * COMM_TOWERS.siteSpread,
        );
        if (site.ground >= near) beaten++;
      }
      // Comfortably above most of its neighbourhood — a ridge top, not a dip.
      expect(beaten / samples, `site ${site.x.toFixed(0)},${site.z.toFixed(0)}`)
        .toBeGreaterThan(0.6);
    }
  });

  it('stands the masts on the ground, not floating or buried', () => {
    const towers = createCommTowers();
    const { steel } = partsOf(towers);
    const masts = steel[0];

    positions(masts).forEach(({ position, scale }, i) => {
      const site = towers.sites[i];
      // The mast is scaled to its height and centred on it, so its foot sits
      // exactly on the sampled ground.
      expect(position.y - scale.y / 2).toBeCloseTo(site.ground, 3);
    });
  });

  it('clears the near hills but stays inside the office window', () => {
    // The two ways this feature silently fails. Too short and a nearer ridge
    // swallows the mast; too tall and the tip climbs past the top of the
    // window, so it only exists if you walk up to the glass. The rim is
    // already 50-60 m up, so the usable band is narrow.
    const EYE = 1.6;
    // Window opening is 2.35 m tall centred at y = 1.65, about 4.8 m back
    // from mid-room.
    const windowTop = Math.atan2(2.825 - EYE, 4.8);

    for (const site of createCommTowers().sites) {
      const distance = Math.hypot(site.x, site.z);
      const tip = Math.atan2(site.ground + site.height - EYE, distance);

      // Highest ground on the line between the base and the mast.
      let ridge = 0;
      for (let f = 0.05; f < 1; f += 0.02) {
        ridge = Math.max(ridge, Math.atan2(
          terrainHeightAt(site.x * f, site.z * f) - EYE, distance * f,
        ));
      }

      expect(tip).toBeGreaterThan(ridge + 0.02);
      expect(tip).toBeLessThan(windowTop);
    }
  });

  it('is deterministic for a seed, and different for another', () => {
    const a = createCommTowers().sites.map(s => [s.x, s.z]);
    const b = createCommTowers().sites.map(s => [s.x, s.z]);
    const c = createCommTowers({ seed: 7 }).sites.map(s => [s.x, s.z]);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});

describe('the beacons', () => {
  it('does not let fog eat the one thing meant to cut through it', () => {
    // A MeshBasicMaterial fogs by default, and at 400 m the outdoor fog
    // resolves to most of the horizon colour — the lamp would render as a
    // flat smudge of sky. The moons had exactly this bug.
    const { lamps, sprites } = partsOf(createCommTowers());
    expect(lamps.material.fog).toBe(false);
    for (const sprite of sprites) expect(sprite.material.fog).toBe(false);
  });

  it('pairs each lamp with a much wider glow, or it is a dead pixel', () => {
    // 1.2 m at 400 m is about a fifth of a degree: two or three pixels.
    const towers = createCommTowers();
    const { sprites } = partsOf(towers);
    expect(sprites.length).toBe(towers.sites.length);
    for (const sprite of sprites) {
      expect(sprite.scale.x).toBeGreaterThan(COMM_TOWERS.beacon.radius * 5);
      expect(sprite.material.blending).toBe(THREE.AdditiveBlending);
    }
  });

  it('sits the lamp at the top of its own mast', () => {
    const towers = createCommTowers();
    const { lamps, sprites } = partsOf(towers);

    positions(lamps).forEach(({ position }, i) => {
      const site = towers.sites[i];
      expect(position.y).toBeGreaterThan(site.ground + site.height);
      expect(sprites[i].position.y).toBeCloseTo(position.y, 5);
    });
  });

  it('flashes, and never goes completely dark between flashes', () => {
    const towers = createCommTowers();
    const { lamps } = partsOf(towers);
    const flash = towers.components[0];

    const brightness = () => {
      const c = new THREE.Color();
      lamps.getColorAt(0, c);
      return c.r;
    };

    const seen = [];
    for (let step = 0; step < 60; step++) {
      flash.onUpdate(COMM_TOWERS.beacon.period / 60);
      seen.push(brightness());
    }

    // It actually varies — a constant lamp is not a beacon.
    expect(Math.max(...seen)).toBeGreaterThan(Math.min(...seen) * 2);
    // And a true zero between flashes reads as a glitch, not a light.
    expect(Math.min(...seen)).toBeGreaterThan(0);
  });

  it('flashes the towers out of step with each other', () => {
    // Five lights blinking in lockstep read as one mechanism; out of step they
    // read as five separate things out there.
    const phases = createCommTowers().sites.map(s => s.phase);
    expect(new Set(phases).size).toBe(phases.length);
  });
});
