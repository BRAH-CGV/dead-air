import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { warmUp, collectTextures, precompile } from './WarmUp.js';

// ─────────────────────────────────────────────
// WarmUp  –  pay every first-use GPU cost behind the loading screen
// ─────────────────────────────────────────────

function fakeRenderer() {
  const culledAtRender = [];
  const renderer = {
    compileAsync: vi.fn(async () => {}),
    initTexture: vi.fn(),
    render: vi.fn((scene) => {
      scene.traverse(o => { if (o.isMesh) culledAtRender.push(o.frustumCulled); });
    }),
  };
  return { renderer, culledAtRender };
}

function scene() {
  const root = new THREE.Scene();
  const map = new THREE.Texture();
  const normal = new THREE.Texture();
  const a = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map, normalMap: normal }));
  const b = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map }));   // shared texture
  const c = new THREE.Mesh(new THREE.BoxGeometry(), [new THREE.MeshBasicMaterial({ alphaMap: normal })]);
  const noCull = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  noCull.frustumCulled = false;
  root.add(a, b, c, noCull);
  return { root, map, normal, noCull };
}

const nextFrame = () => Promise.resolve();

describe('collectTextures', () => {
  it('finds every texture on every material once, array materials included', () => {
    const { root, map, normal } = scene();
    const found = collectTextures(root);
    expect(found).toHaveLength(2);
    expect(found).toEqual(expect.arrayContaining([map, normal]));
  });

  it('includes the scene background and environment', () => {
    const root = new THREE.Scene();
    root.background = new THREE.Texture();
    expect(collectTextures(root)).toEqual([root.background]);
  });
});

describe('warmUp', () => {
  it('compiles every shader, uploads every texture, then draws the whole scene once', async () => {
    const { root, map, normal } = scene();
    const { renderer } = fakeRenderer();
    const camera = new THREE.PerspectiveCamera();
    await warmUp({ renderer, scene: root, camera, nextFrame });

    expect(renderer.compileAsync).toHaveBeenCalledWith(root, camera);
    expect(renderer.initTexture).toHaveBeenCalledWith(map);
    expect(renderer.initTexture).toHaveBeenCalledWith(normal);
    expect(renderer.render).toHaveBeenCalledOnce();
  });

  it('draws with frustum culling off — the meshes behind the camera are the ones that hitch later', async () => {
    const { root } = scene();
    const { renderer, culledAtRender } = fakeRenderer();
    await warmUp({ renderer, scene: root, camera: new THREE.PerspectiveCamera(), nextFrame });
    expect(culledAtRender.every(c => c === false)).toBe(true);
  });

  it('puts frustum culling back afterwards, exactly as it was', async () => {
    const { root, noCull } = scene();
    const { renderer } = fakeRenderer();
    await warmUp({ renderer, scene: root, camera: new THREE.PerspectiveCamera(), nextFrame });
    root.traverse((o) => {
      if (o.isMesh) expect(o.frustumCulled, o.uuid).toBe(o !== noCull);
    });
  });

  it('draws hidden objects too — they are the ones a zone swap will show', async () => {
    const { root } = scene();
    const hidden = root.children[0];
    hidden.visible = false;
    const seen = [];
    const { renderer } = fakeRenderer();
    renderer.render = vi.fn(() => seen.push(hidden.visible));
    await warmUp({ renderer, scene: root, camera: new THREE.PerspectiveCamera(), nextFrame });
    expect(seen).toEqual([true]);
    expect(hidden.visible).toBe(false);
  });

  it('reports its stages with progress, ending full', async () => {
    const { root } = scene();
    const { renderer } = fakeRenderer();
    const onStage = vi.fn();
    await warmUp({ renderer, scene: root, camera: new THREE.PerspectiveCamera(), nextFrame, onStage });
    const labels = onStage.mock.calls.map(([label]) => label);
    expect(labels[0]).toMatch(/shader/i);
    expect(labels).toEqual(expect.arrayContaining([expect.stringMatching(/texture/i)]));
    expect(onStage.mock.calls.at(-1)[1]).toBe(1);
  });

  it('copes with a renderer that has no compileAsync (older three)', async () => {
    const { root } = scene();
    const { renderer } = fakeRenderer();
    delete renderer.compileAsync;
    renderer.compile = vi.fn();
    await warmUp({ renderer, scene: root, camera: new THREE.PerspectiveCamera(), nextFrame });
    expect(renderer.compile).toHaveBeenCalled();
  });
});

// A rebuilt scene (Retry, Restart night, Main menu) has no loading screen to
// hide behind: its old programs went with the old materials, and anything
// that starts hidden (the Sleep Demon, the dust eyes, the UFO) compiled on
// the frame it first showed — the freeze when the demon first appeared.
describe('precompile', () => {
  it('compiles every shader in the background, and draws and uploads nothing', async () => {
    const { root } = scene();
    const { renderer } = fakeRenderer();
    const camera = new THREE.PerspectiveCamera();
    await precompile({ renderer, scene: root, camera });
    expect(renderer.compileAsync).toHaveBeenCalledWith(root, camera);
    expect(renderer.render).not.toHaveBeenCalled();
    expect(renderer.initTexture).not.toHaveBeenCalled();
  });

  it('leaves hidden objects hidden — three compiles them anyway, and a shown one would be on screen while it waits', async () => {
    const { root } = scene();
    const hidden = root.children[0];
    hidden.visible = false;
    const { renderer } = fakeRenderer();
    const seen = [];
    renderer.compileAsync = vi.fn(async () => { seen.push(hidden.visible); });
    await precompile({ renderer, scene: root, camera: new THREE.PerspectiveCamera() });
    expect(seen).toEqual([false]);
    expect(hidden.visible).toBe(false);
  });

  it('copes with a renderer that has no compileAsync, or none at all', async () => {
    const { root } = scene();
    const camera = new THREE.PerspectiveCamera();
    const renderer = { compile: vi.fn() };
    await precompile({ renderer, scene: root, camera });
    expect(renderer.compile).toHaveBeenCalledWith(root, camera);
    await expect(precompile({ renderer: {}, scene: root, camera })).resolves.toBeUndefined();
  });
});
