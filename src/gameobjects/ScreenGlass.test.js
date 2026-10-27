import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createScreenMaterial, SCREEN_GLASS_GLSL } from './ScreenGlass.js';

// ─────────────────────────────────────────────
// ScreenGlass  –  every screen's glass, on the GPU (#161)
// ─────────────────────────────────────────────

describe('createScreenMaterial', () => {
  it('shows a picture through the screen shader: unlit, no fog, not tone mapped', () => {
    const picture = new THREE.Texture();
    const m = createScreenMaterial({ picture, aspect: 1.8 });
    expect(m).toBeInstanceOf(THREE.ShaderMaterial);
    expect(m.uniforms.tPicture.value).toBe(picture);
    expect(m.uniforms.uHasPicture.value).toBe(1);
    expect(m.fog).toBe(false);
    expect(m.lights).toBe(false);
    expect(m.toneMapped).toBe(false);
  });

  it('draws the glass itself: scanlines and a dark edge, as the camera monitor does', () => {
    const m = createScreenMaterial({ picture: null, aspect: 1.8 });
    expect(m.fragmentShader).toContain(SCREEN_GLASS_GLSL);
    expect(m.fragmentShader).toContain('screenGlass(');
    expect(m.uniforms.uTime.value).toBe(0);
  });

  it('cuts the screen\'s rounded corners in the shader', () => {
    const m = createScreenMaterial({ picture: null, aspect: 1.8, corner: 0.15 });
    expect(m.uniforms.uCorner.value).toBe(0.15);
    expect(m.uniforms.uAspect.value).toBe(1.8);
    expect(m.fragmentShader).toContain('discard');
  });

  it('without a picture, a dark screen', () => {
    const m = createScreenMaterial({ picture: null, aspect: 1 });
    expect(m.uniforms.uHasPicture.value).toBe(0);
  });
});
