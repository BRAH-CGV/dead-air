import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { VisorRefraction } from './VisorRefraction.js';

// ─────────────────────────────────────────────
// VisorRefraction  –  barrel distortion for the EVA visor
// ─────────────────────────────────────────────
// Pure Three.js state + a mocked renderer.  No GL context needed.

function makeRenderer(width = 2400, height = 1350) {
  const size = { w: width, h: height };
  return {
    size,
    autoClear: true,
    getDrawingBufferSize: vi.fn(v => v.set(size.w, size.h)),
    copyFramebufferToTexture: vi.fn(),
    setRenderTarget: vi.fn(),
    render: vi.fn(),
    compile: vi.fn(),
    initTexture: vi.fn(),
  };
}

describe('VisorRefraction', () => {
  it('attach() builds its shader, quad and private scene, and compiles them', () => {
    const renderer = makeRenderer();
    const vr = new VisorRefraction();
    vr.attach(renderer);

    expect(vr._material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(vr._material.uniforms.tDiffuse.value).toBe(vr._texture);
    expect(vr._scene.children).toEqual([vr._quad]);
    expect(vr._camera).toBeInstanceOf(THREE.OrthographicCamera);
    // Compiled while the scene is built, so the helmet going on never hitches.
    expect(renderer.compile).toHaveBeenCalledWith(vr._scene, vr._camera);
    vr.dispose();
  });

  it('active is false when intensity is 0, true when > 0', () => {
    const vr = new VisorRefraction();
    expect(vr.active).toBe(false);
    vr.setIntensity(0.0001);
    expect(vr.active).toBe(false);  // below threshold
    vr.setIntensity(0.01);
    expect(vr.active).toBe(true);
  });

  it('setIntensity clamps to 0..1', () => {
    const vr = new VisorRefraction();
    vr.setIntensity(-0.5);
    expect(vr._intensity).toBe(0);
    vr.setIntensity(1.5);
    expect(vr._intensity).toBe(1);
    vr.setIntensity(0.6);
    expect(vr._intensity).toBeCloseTo(0.6);
  });

  it('does nothing at all with the helmet off', () => {
    const renderer = makeRenderer();
    const vr = new VisorRefraction();
    vr.attach(renderer);
    renderer.render.mockClear();

    vr.render();
    expect(renderer.copyFramebufferToTexture).not.toHaveBeenCalled();
    expect(renderer.render).not.toHaveBeenCalled();
    vr.dispose();
  });

  it('bends the finished frame: copies the screen, then draws it back warped over itself', () => {
    // The scene is drawn as it always is — antialiased, tone mapped, at full
    // resolution. Routing it through an off-screen target instead lost all
    // three, and the outside shimmered behind the glass.
    const renderer = makeRenderer(2400, 1350);
    const vr = new VisorRefraction();
    vr.attach(renderer);
    vr.setIntensity(0.5);

    const order = [];
    renderer.copyFramebufferToTexture.mockImplementation(() => order.push('copy'));
    renderer.render.mockImplementation(() => order.push('draw'));
    vr.render();

    expect(order).toEqual(['copy', 'draw']);
    expect(renderer.copyFramebufferToTexture).toHaveBeenCalledWith(vr._texture);
    expect(renderer.setRenderTarget).toHaveBeenCalledWith(null);
    expect(renderer.render).toHaveBeenCalledWith(vr._scene, vr._camera);
    // uStrength = intensity (0.5) × DEFAULT_STRENGTH (0.1)
    expect(vr._material.uniforms.uStrength.value).toBeCloseTo(0.05);
    expect(vr._material.uniforms.uAspect.value).toBeCloseTo(2400 / 1350);
    // The copy covers every pixel, so nothing is cleared under it.
    expect(renderer.autoClear).toBe(true);
    vr.dispose();
  });

  it('copies at the drawing buffer\'s size, following a resize', () => {
    const renderer = makeRenderer(2400, 1350);
    const vr = new VisorRefraction();
    vr.attach(renderer);
    vr.setIntensity(1);
    expect(vr._texture).toBeInstanceOf(THREE.FramebufferTexture);
    expect(vr._texture.image.width).toBe(2400);
    expect(vr._texture.image.height).toBe(1350);

    const old = vr._texture;
    const freed = vi.spyOn(old, 'dispose');
    renderer.size.w = 1280;
    renderer.size.h = 1024;
    vr.render();
    expect(freed).toHaveBeenCalled();
    expect(vr._texture.image.width).toBe(1280);
    expect(vr._texture.image.height).toBe(1024);
    expect(vr._material.uniforms.tDiffuse.value).toBe(vr._texture);
    expect(renderer.copyFramebufferToTexture).toHaveBeenCalledWith(vr._texture);
    vr.dispose();
  });

  it('passes the copied pixels through as they are — they are already tone mapped and sRGB', () => {
    const vr = new VisorRefraction();
    vr.attach(makeRenderer());
    expect(vr._material.toneMapped).toBe(false);
    expect(vr._material.fragmentShader).not.toMatch(/tonemapping_fragment|colorspace_fragment/);
    vr.dispose();
  });

  it('dispose frees all resources', () => {
    const vr = new VisorRefraction();
    vr.attach(makeRenderer());
    vr.setIntensity(0.5);

    const matDispose = vi.spyOn(vr._material, 'dispose');
    const geoDispose = vi.spyOn(vr._quad.geometry, 'dispose');
    const texDispose = vi.spyOn(vr._texture, 'dispose');

    vr.dispose();
    expect(matDispose).toHaveBeenCalled();
    expect(geoDispose).toHaveBeenCalled();
    expect(texDispose).toHaveBeenCalled();
    expect(vr._material).toBeNull();
    expect(vr._quad).toBeNull();
    expect(vr._scene).toBeNull();
    expect(vr._camera).toBeNull();
    expect(vr._texture).toBeNull();
    expect(vr._renderer).toBeNull();
    expect(vr._intensity).toBe(0);
  });

  it('render() is safe before attach and after dispose', () => {
    const vr = new VisorRefraction();
    vr.setIntensity(1);
    expect(() => vr.render()).not.toThrow();
    vr.attach(makeRenderer());
    vr.dispose();
    vr.setIntensity(1);
    expect(() => vr.render()).not.toThrow();
  });
});
