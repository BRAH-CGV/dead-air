import { describe, it, expect } from 'vitest';
import { createHolographicUniforms, updateHolographicUniforms, holographicVertexShader, holographicFragmentShader } from '../shaders/holographic.js';

describe('holographic shader', () => {
  describe('shader sources', () => {
    it('has a vertex shader string', () => {
      expect(typeof holographicVertexShader).toBe('string');
      expect(holographicVertexShader.length).toBeGreaterThan(0);
    });

    it('has a fragment shader string', () => {
      expect(typeof holographicFragmentShader).toBe('string');
      expect(holographicFragmentShader.length).toBeGreaterThan(0);
    });

    it('vertex shader uses position and normal attributes', () => {
      expect(holographicVertexShader).toContain('position');
      expect(holographicVertexShader).toContain('normal');
    });

    it('fragment shader uses uTime uniform', () => {
      expect(holographicFragmentShader).toContain('uTime');
    });

    it('fragment shader uses uColor uniform', () => {
      expect(holographicFragmentShader).toContain('uColor');
    });
  });

  describe('createHolographicUniforms', () => {
    it('creates uniforms with default values', () => {
      const uniforms = createHolographicUniforms();
      expect(uniforms.uTime).toBeDefined();
      expect(uniforms.uTime.value).toBe(0);
      expect(uniforms.uColor).toBeDefined();
      expect(uniforms.uIntensity).toBeDefined();
      expect(uniforms.uIntensity.value).toBeGreaterThan(0);
    });
  });

  describe('updateHolographicUniforms', () => {
    it('updates uTime with elapsed time', () => {
      const uniforms = createHolographicUniforms();
      updateHolographicUniforms(uniforms, 1.5);
      expect(uniforms.uTime.value).toBe(1.5);
    });

    it('accumulates time over multiple updates', () => {
      const uniforms = createHolographicUniforms();
      updateHolographicUniforms(uniforms, 0.5);
      updateHolographicUniforms(uniforms, 0.3);
      expect(uniforms.uTime.value).toBeCloseTo(0.8, 5);
    });
  });
});
