import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createCrtMaterial, CRT_VERTEX_SHADER, CRT_FRAGMENT_SHADER } from './CrtScreen.js';

describe('createCrtMaterial', () => {
  it('is a ShaderMaterial with the four uniforms gameplay drives', () => {
    const m = createCrtMaterial();
    expect(m).toBeInstanceOf(THREE.ShaderMaterial);
    for (const name of ['uTime', 'uSignal', 'uNoise', 'uPower']) {
      expect(typeof m.uniforms[name]?.value).toBe('number');
    }
    expect(m.uniforms.uPower.value).toBe(1);
    expect(m.uniforms.uSignal.value).toBe(0);
  });

  it('declares every uniform in the GLSL it is used in', () => {
    for (const name of ['uTime', 'uSignal', 'uNoise', 'uPower']) {
      expect(CRT_FRAGMENT_SHADER).toMatch(new RegExp(`uniform float ${name};`));
    }
    expect(CRT_VERTEX_SHADER).toMatch(/varying vec2 vUv;/);
    expect(CRT_FRAGMENT_SHADER).toMatch(/varying vec2 vUv;/);
  });

  it('bulges the middle of the glass by a compile-time amount', () => {
    expect(CRT_VERTEX_SHADER).toMatch(/BULGE/);
    expect(Number(createCrtMaterial({ bulge: 0.2 }).defines.BULGE)).toBeCloseTo(0.2);
    expect(Number(createCrtMaterial().defines.BULGE)).toBe(0);
  });

  it('ignores the fog, and goes through the same tone mapping as everything else', () => {
    const m = createCrtMaterial();
    expect(m.fog).toBe(false);
    expect(CRT_FRAGMENT_SHADER).toMatch(/#include <tonemapping_fragment>/);
    expect(CRT_FRAGMENT_SHADER).toMatch(/#include <colorspace_fragment>/);
  });

  it('gives every material its own uniforms', () => {
    const a = createCrtMaterial();
    const b = createCrtMaterial();
    expect(a.uniforms.uTime).not.toBe(b.uniforms.uTime);
  });
});
