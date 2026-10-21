import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { VisorRefraction } from './VisorRefraction.js';

// ─────────────────────────────────────────────
// VisorRefraction  –  barrel distortion for the EVA visor
// ─────────────────────────────────────────────
// Pure Three.js state + a mocked renderer.  No GL context needed.

function makeCtx() {
  return {
    renderer: {
      setRenderTarget: vi.fn(),
      render: vi.fn(),
    },
  };
}

describe('VisorRefraction', () => {
  it('build() creates the shader material and fullscreen quad', () => {
    const vr = new VisorRefraction();
    vr.build(makeCtx());

    expect(vr._material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(vr._material.uniforms.tDiffuse).toBeDefined();
    expect(vr._material.uniforms.uStrength).toBeDefined();
    expect(vr._material.uniforms.uAspect).toBeDefined();
    expect(vr._quad).toBeInstanceOf(THREE.Mesh);
    expect(vr._scene).toBeInstanceOf(THREE.Scene);
    expect(vr._camera).toBeInstanceOf(THREE.OrthographicCamera);
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

  it('composite() sets the strength uniform as intensity × default strength', () => {
    const ctx = makeCtx();
    const vr = new VisorRefraction();
    vr.build(ctx);
    vr.setIntensity(0.5);

    vr.composite({ isTexture: true }, null, ctx.renderer);

    // uStrength = intensity (0.5) × DEFAULT_STRENGTH (0.1) = 0.05
    expect(vr._material.uniforms.uStrength.value).toBeCloseTo(0.05);
    expect(ctx.renderer.setRenderTarget).toHaveBeenCalledWith(null);
    expect(ctx.renderer.render).toHaveBeenCalled();
    vr.dispose();
  });

  it('each pass owns its own private scene, not an external one', () => {
    const ctx = makeCtx();
    const vr = new VisorRefraction();
    vr.build(ctx);
    vr.setIntensity(0.3);

    expect(vr._scene.children).toContain(vr._quad);
    expect(vr._scene.children.length).toBe(1);
    vr.dispose();
  });

  it('dispose frees all resources', () => {
    const ctx = makeCtx();
    const vr = new VisorRefraction();
    vr.build(ctx);
    vr.setIntensity(0.5);

    const matDispose = vi.spyOn(vr._material, 'dispose');
    const geoDispose = vi.spyOn(vr._quad.geometry, 'dispose');

    vr.dispose();
    expect(matDispose).toHaveBeenCalled();
    expect(geoDispose).toHaveBeenCalled();
    expect(vr._material).toBeNull();
    expect(vr._quad).toBeNull();
    expect(vr._scene).toBeNull();
    expect(vr._camera).toBeNull();
    expect(vr._renderer).toBeNull();
    expect(vr._intensity).toBe(0);
  });
});
