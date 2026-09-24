import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

import { createDishPad, DISH_PAD } from './DishPad.js';

const lightsOf = pad => pad.object3d.children.filter(o => o.isSpotLight);
const slabOf = pad => pad.object3d.children.find(o => o.name === 'DishPadSlab');

describe('the pad', () => {
  it('is a group carrying a square slab', () => {
    const pad = createDishPad();
    expect(pad.isGroup).toBe(true);

    const slab = slabOf(pad);
    const { width, depth } = slab.geometry.parameters;
    expect(width).toBe(DISH_PAD.size);
    expect(depth).toBe(width);
  });

  it('stands where the tower stands', () => {
    // Taking the satellite's own position rather than a second copy of its
    // coordinates is what keeps the two from drifting apart.
    const pad = createDishPad({ position: new THREE.Vector3(0, 0, -25) });
    expect(pad.object3d.position.z).toBe(-25);
  });

  it('sits proud of the ground without hovering over it', () => {
    // Coplanar with the terrain would z-fight; a slab dropped on top would
    // read as a block rather than a poured footing.
    const slab = slabOf(createDishPad());
    const top = slab.position.y + DISH_PAD.thickness / 2;
    expect(top).toBeCloseTo(DISH_PAD.lift);
    expect(top).toBeGreaterThan(0);
    expect(top).toBeLessThan(0.1);
  });
});

describe('the floods', () => {
  it('puts a light at each corner, on the slab', () => {
    const pad = createDishPad();
    const lights = lightsOf(pad);
    expect(lights.length).toBe(DISH_PAD.lights);

    for (const light of lights) {
      const reach = Math.hypot(light.position.x, light.position.z);
      expect(reach).toBeLessThan(DISH_PAD.size / 2);
      expect(light.position.y).toBeGreaterThan(0);
    }
  });

  it('aims them up the mast, not across the ground', () => {
    const pad = createDishPad();
    for (const light of lightsOf(pad)) {
      expect(light.target.position.y).toBe(DISH_PAD.light.aimHeight);
      // Above the fitting it leaves, or it is not uplighting anything.
      expect(light.target.position.y).toBeGreaterThan(light.position.y);
    }
  });

  it('casts no shadows — the moon owns the only shadow map worth paying for', () => {
    for (const light of lightsOf(createDishPad())) {
      expect(light.castShadow).toBe(false);
    }
  });

  it('keeps every flood out of the line between the window and the dish', () => {
    // The dish is what the back window looks at. A flood parked on that line
    // would sit in silhouette right in front of it.
    for (const light of lightsOf(createDishPad())) {
      expect(Math.abs(light.position.x)).toBeGreaterThan(0.5);
    }
  });
});
