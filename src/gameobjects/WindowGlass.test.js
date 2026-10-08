import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { WindowGlass, smudgeMap, WINDOW_GLASS } from './WindowGlass.js';

// The office window: 8.5 × 2.35 m, cut into 3 × 2 panes by its mullions and
// crossbar.
const OFFICE = { width: 8.5, height: 2.35, dividers: { x: [2.83, 5.67], y: [1.175] } };

/** Mean film density (0 … 1) over a rectangle of the map, in metres from the
 *  opening's bottom-left corner. */
function meanDensity(map, x0, x1, y0, y1) {
  const { data, columns, rows, width, height } = map;
  let sum = 0;
  let count = 0;
  for (let r = Math.floor(y0 / height * rows); r < Math.ceil(y1 / height * rows); r++) {
    for (let c = Math.floor(x0 / width * columns); c < Math.ceil(x1 / width * columns); c++) {
      sum += data[r * columns + c];
      count++;
    }
  }
  return sum / count / 255;
}

describe('smudgeMap', () => {
  const map = smudgeMap(OFFICE);

  it('is one byte of film density per texel', () => {
    expect(map.data).toBeInstanceOf(Uint8Array);
    expect(map.data.length).toBe(map.columns * map.rows);
  });

  it('is the same every time — the glass does not change between restarts', () => {
    expect(Array.from(smudgeMap(OFFICE).data.slice(0, 2000))).toEqual(Array.from(map.data.slice(0, 2000)));
  });

  it('is mostly clear glass: a thin film, not a frosted pane', () => {
    const mean = meanDensity(map, 0, OFFICE.width, 0, OFFICE.height);
    expect(mean).toBeGreaterThan(0.08);
    expect(mean).toBeLessThan(0.35);
  });

  it('dust gathers along the bottom of each pane, far more than in its middle', () => {
    // Lower-left pane: x 0 … 2.83, y 0 … 1.175.
    const bottom = meanDensity(map, 0.4, 2.4, 0, 0.05);
    const middle = meanDensity(map, 0.4, 2.4, 0.45, 0.75);
    expect(bottom).toBeGreaterThan(middle * 2);
  });

  it('every pane has its own dirt: the crossbar and mullions gather it too', () => {
    // Just above the crossbar is the bottom of an upper pane.
    const aboveBar = meanDensity(map, 3.3, 5.2, 1.175, 1.225);
    const upperMiddle = meanDensity(map, 3.3, 5.2, 1.6, 1.9);
    expect(aboveBar).toBeGreaterThan(upperMiddle * 2);
    // Beside a mullion, clear of the bottom's own dust.
    const besideMullion = meanDensity(map, 2.83, 2.86, 0.4, 0.8);
    const paneMiddle = meanDensity(map, 3.9, 4.6, 0.4, 0.8);
    expect(besideMullion).toBeGreaterThan(paneMiddle);
  });

  it('no two panes are smudged alike', () => {
    const { data, columns, rows } = map;
    const third = Math.floor(columns / 3);
    let differing = 0;
    const row = Math.floor(rows * 0.3) * columns;
    for (let c = 0; c < third; c++) if (data[row + c] !== data[row + c + third]) differing++;
    expect(differing).toBeGreaterThan(third / 2);
  });
});

describe('WindowGlass', () => {
  const build = () => new WindowGlass(OFFICE);

  it('is a pane the size of the opening, facing +Z', () => {
    const glass = build();
    const { width, height } = glass.mesh.geometry.parameters;
    expect(width).toBeCloseTo(8.5);
    expect(height).toBeCloseTo(2.35);
    expect(glass.mesh.position.equals(new THREE.Vector3())).toBe(true);
  });

  it('is see-through from both sides and never hides what is beyond it', () => {
    const { material } = build().mesh;
    expect(material.transparent).toBe(true);
    // A see-through card that writes depth hides whatever is drawn after it
    // from behind — the dust, the eyes in the storm.
    expect(material.depthWrite).toBe(false);
    expect(material.side).toBe(THREE.DoubleSide);
    expect(material.uniforms.uOpacity.value).toBe(WINDOW_GLASS.opacity);
    expect(material.uniforms.uOpacity.value).toBeLessThan(0.5);
  });

  it('casts no shadow, so moonlight still comes in through it', () => {
    expect(build().mesh.castShadow).toBe(false);
  });

  it('carries the smudge map as its film texture', () => {
    const glass = build();
    const texture = glass.mesh.material.uniforms.uSmudges.value;
    expect(texture.isDataTexture).toBe(true);
    expect(texture.image.data.length).toBe(texture.image.width * texture.image.height);
    // Sideways, the film must not wrap round onto the far edge.
    expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
  });

  it('is dark with no light on it', () => {
    const glass = build();
    glass.mesh.onBeforeRender();
    expect(glass.mesh.material.uniforms.uLight.value.toArray()).toEqual([0, 0, 0]);
  });

  it('shows by the light that falls on it: each lamp, by its colour, level and gain', () => {
    const glass = build();
    const lamp = new THREE.PointLight(0xffffff, 10);
    const tint = new THREE.AmbientLight(new THREE.Color(1, 0, 0), 2);
    glass.addLight(lamp, 0.05);
    glass.addLight(tint, 0.25);
    glass.mesh.onBeforeRender();
    const light = glass.mesh.material.uniforms.uLight.value;
    expect(light.x).toBeCloseTo(0.5 + 0.5);
    expect(light.y).toBeCloseTo(0.5);
    expect(light.z).toBeCloseTo(0.5);
  });

  it('goes dark with the lamps: a zeroed light is read live, every draw', () => {
    const glass = build();
    const lamp = new THREE.PointLight(0xffffff, 10);
    glass.addLight(lamp, 0.05);
    glass.mesh.onBeforeRender();
    lamp.intensity = 0;   // the power grid zeroes lights, it never hides them
    glass.mesh.onBeforeRender();
    expect(glass.mesh.material.uniforms.uLight.value.length()).toBe(0);
  });

  it('dispose frees its geometry, material and texture', () => {
    const glass = build();
    const freed = [];
    const { geometry, material } = glass.mesh;
    const texture = material.uniforms.uSmudges.value;
    geometry.addEventListener('dispose', () => freed.push('geometry'));
    material.addEventListener('dispose', () => freed.push('material'));
    texture.addEventListener('dispose', () => freed.push('texture'));
    glass.dispose();
    expect(freed.sort()).toEqual(['geometry', 'material', 'texture']);
  });
});
