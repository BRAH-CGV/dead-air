import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { PostPipeline } from './PostPipeline.js';

// ─────────────────────────────────────────────
// PostPipeline  –  chains multiple post-processing passes
// ─────────────────────────────────────────────
// Pure Three.js state + mocked renderers.  No GL context needed.

function makeEngine() {
  return {
    renderer: {
      setRenderTarget: vi.fn(),
      render: vi.fn(),
    },
  };
}

/** A minimal pass stub that records calls. */
function makePass(active = false) {
  return {
    _active: active,
    get active() { return this._active; },
    build: vi.fn(),
    composite: vi.fn(),
    warmUp: vi.fn(),
    preCompile: vi.fn(),
    dispose: vi.fn(),
  };
}

describe('PostPipeline', () => {
  it('attach() sets up the renderer', () => {
    const pipeline = new PostPipeline();
    pipeline.attach(makeEngine());
    expect(pipeline._renderer).toBeTruthy();
    pipeline.dispose();
  });

  it('add() registers a pass and calls build()', () => {
    const pipeline = new PostPipeline();
    pipeline.attach(makeEngine());
    const pass = makePass();
    pipeline.add('test', pass);
    expect(pass.build).toHaveBeenCalledTimes(1);
    expect(pipeline.get('test')).toBe(pass);
    pipeline.dispose();
  });

  it('remove() disposes and unregisters a pass', () => {
    const pipeline = new PostPipeline();
    pipeline.attach(makeEngine());
    const pass = makePass();
    pipeline.add('test', pass);
    pipeline.remove('test');
    expect(pass.dispose).toHaveBeenCalled();
    expect(pipeline.get('test')).toBeUndefined();
    pipeline.dispose();
  });

  it('active is false when no passes are active', () => {
    const pipeline = new PostPipeline();
    pipeline.attach(makeEngine());
    pipeline.add('a', makePass(false));
    pipeline.add('b', makePass(false));
    expect(pipeline.active).toBe(false);
    pipeline.dispose();
  });

  it('active is true when at least one pass is active', () => {
    const pipeline = new PostPipeline();
    pipeline.attach(makeEngine());
    pipeline.add('a', makePass(false));
    pipeline.add('b', makePass(true));
    expect(pipeline.active).toBe(true);
    pipeline.dispose();
  });

  it('preRender is a no-op when nothing is active', () => {
    const engine = makeEngine();
    const pipeline = new PostPipeline();
    pipeline.attach(engine);
    pipeline.add('a', makePass(false));

    pipeline.preRender();
    expect(engine.renderer.setRenderTarget).not.toHaveBeenCalled();
    pipeline.dispose();
  });

  it('preRender redirects scene output to the first target when a pass is active', () => {
    const engine = makeEngine();
    const pipeline = new PostPipeline();
    pipeline.attach(engine);
    pipeline.add('a', makePass(true));

    pipeline.preRender();
    expect(engine.renderer.setRenderTarget).toHaveBeenCalledTimes(1);
    // The target is a WebGLRenderTarget (the first one the pipeline created).
    expect(engine.renderer.setRenderTarget.mock.calls[0][0]).toBeInstanceOf(THREE.WebGLRenderTarget);
    pipeline.dispose();
  });

  it('postRender chains active passes, last one outputs to screen (null)', () => {
    const engine = makeEngine();
    const pipeline = new PostPipeline();
    pipeline.attach(engine);
    const passA = makePass(true);
    const passB = makePass(true);
    pipeline.add('a', passA);
    pipeline.add('b', passB);

    pipeline.preRender();
    pipeline.postRender();

    // Two active passes → composite called twice.
    expect(passA.composite).toHaveBeenCalledTimes(1);
    expect(passB.composite).toHaveBeenCalledTimes(1);
    // The first pass writes to a render target (not null).
    expect(passA.composite.mock.calls[0][1]).toBeInstanceOf(THREE.WebGLRenderTarget);
    // The last pass writes to screen (null).
    expect(passB.composite.mock.calls[0][1]).toBeNull();
    pipeline.dispose();
  });

  it('postRender is a no-op when nothing is active', () => {
    const engine = makeEngine();
    const pipeline = new PostPipeline();
    pipeline.attach(engine);
    const pass = makePass(false);
    pipeline.add('a', pass);

    pipeline.postRender();
    expect(pass.composite).not.toHaveBeenCalled();
    pipeline.dispose();
  });

  it('warmUp delegates to every pass', () => {
    const engine = makeEngine();
    const pipeline = new PostPipeline();
    pipeline.attach(engine);
    const passA = makePass();
    const passB = makePass();
    pipeline.add('a', passA);
    pipeline.add('b', passB);

    pipeline.warmUp();
    expect(passA.warmUp).toHaveBeenCalledTimes(1);
    expect(passB.warmUp).toHaveBeenCalledTimes(1);
    pipeline.dispose();
  });

  it('dispose frees every pass and every target', () => {
    const engine = makeEngine();
    const pipeline = new PostPipeline();
    pipeline.attach(engine);
    const pass = makePass(true);
    pipeline.add('a', pass);

    // Force target creation.
    pipeline.preRender();
    expect(pipeline._targets.length).toBeGreaterThan(0);

    pipeline.dispose();
    expect(pass.dispose).toHaveBeenCalled();
    expect(pipeline._targets.length).toBe(0);
  });
});
