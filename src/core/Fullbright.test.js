import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Fullbright } from './Fullbright.js';

// ─────────────────────────────────────────────
// Fullbright  –  unlit debug lighting mode
// ─────────────────────────────────────────────
// Pure Three.js scene-graph state — no renderer, no GL context. The renderer
// is faked where tone mapping matters.

function buildScene() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x1a1a2e, 0.02);

  const sun    = new THREE.DirectionalLight(0xffffff, 1.5);
  const ambient = new THREE.AmbientLight(0x404060, 0.5);
  scene.add(sun, ambient);

  return { scene, sun, ambient };
}

function makeMesh(material) {
  return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
}

describe('Fullbright lights, fog and tone mapping', () => {
  it('hides every light while active and restores them after', () => {
    const { scene, sun, ambient } = buildScene();
    const fb = new Fullbright(scene);

    fb.enable();
    expect(sun.visible).toBe(false);
    expect(ambient.visible).toBe(false);

    fb.disable();
    expect(sun.visible).toBe(true);
    expect(ambient.visible).toBe(true);
  });

  it('lights nested in groups are found too', () => {
    const { scene } = buildScene();
    const group = new THREE.Group();
    const lamp = new THREE.PointLight(0xff0000, 2, 10);
    group.add(lamp);
    scene.add(group);

    const fb = new Fullbright(scene);
    fb.enable();
    expect(lamp.visible).toBe(false);

    fb.disable();
    expect(lamp.visible).toBe(true);
  });

  it('a light that was already off stays off after restore', () => {
    const { scene, sun } = buildScene();
    sun.visible = false;   // a switched-off flashlight

    const fb = new Fullbright(scene);
    fb.enable();
    fb.disable();

    expect(sun.visible).toBe(false);
  });

  it('clears fog while active and restores the exact fog instance', () => {
    const { scene } = buildScene();
    const fb = new Fullbright(scene);

    fb.enable();
    expect(scene.fog).toBeNull();

    fb.disable();
    expect(scene.fog).toBeInstanceOf(THREE.FogExp2);
  });

  it('switches tone mapping off and back when given a renderer', () => {
    const { scene } = buildScene();
    const renderer = { toneMapping: THREE.ACESFilmicToneMapping };
    const fb = new Fullbright(scene, renderer);

    fb.enable();
    expect(renderer.toneMapping).toBe(THREE.NoToneMapping);

    fb.disable();
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
  });

  it('tolerates having no renderer at all', () => {
    const { scene } = buildScene();
    const fb = new Fullbright(scene, null);
    expect(() => { fb.enable(); fb.disable(); }).not.toThrow();
  });
});

describe('Fullbright material swap', () => {
  it('swaps lit materials for unlit MeshBasicMaterial twins', () => {
    const { scene } = buildScene();
    const crate = makeMesh(new THREE.MeshStandardMaterial({ color: 0xaa5544 }));
    scene.add(crate);

    const fb = new Fullbright(scene);
    fb.enable();

    expect(crate.material).toBeInstanceOf(THREE.MeshBasicMaterial);
  });

  it('twin keeps the original map and colour', () => {
    const { scene } = buildScene();
    const map = new THREE.Texture();
    const mat = new THREE.MeshStandardMaterial({ color: 0x112233, map });
    const crate = makeMesh(mat);
    scene.add(crate);

    const fb = new Fullbright(scene);
    fb.enable();

    expect(crate.material.map).toBe(map);
    expect(crate.material.color.getHex()).toBe(0x112233);
  });

  it('leaves already-unlit materials alone', () => {
    const { scene } = buildScene();
    const basic = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const poster = makeMesh(basic);
    scene.add(poster);

    const fb = new Fullbright(scene);
    fb.enable();

    expect(poster.material).toBe(basic);
  });

  it('shares one twin across meshes that share a material', () => {
    const { scene } = buildScene();
    const shared = new THREE.MeshStandardMaterial({ color: 0x8890a0 });
    const a = makeMesh(shared);
    const b = makeMesh(shared);
    scene.add(a, b);

    const fb = new Fullbright(scene);
    fb.enable();

    expect(a.material).toBe(b.material);
    expect(fb._twins.size).toBe(1);
  });

  it('handles multi-material meshes (material arrays)', () => {
    const { scene } = buildScene();
    const lit = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const unlit = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const mesh = makeMesh([lit, unlit]);
    scene.add(mesh);

    const fb = new Fullbright(scene);
    fb.enable();

    expect(Array.isArray(mesh.material)).toBe(true);
    expect(mesh.material[0]).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(mesh.material[1]).toBe(unlit);   // basic entry passes through
  });

  it('restore puts every original back, exactly', () => {
    const { scene } = buildScene();
    const matA = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const matB = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const a = makeMesh(matA);
    const b = makeMesh(matB);
    scene.add(a, b);

    const fb = new Fullbright(scene);
    fb.enable();
    fb.disable();

    expect(a.material).toBe(matA);
    expect(b.material).toBe(matB);
  });

  it('restore disposes the twins and empties the caches', () => {
    const { scene } = buildScene();
    const mat = new THREE.MeshStandardMaterial();
    scene.add(makeMesh(mat));

    const fb = new Fullbright(scene);
    fb.enable();
    const twin = fb._twins.get(mat);
    const spy = vi.spyOn(twin, 'dispose');

    fb.disable();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(fb._twins.size).toBe(0);
    expect(fb._swapped.size).toBe(0);
  });

  it('enable/disable round-trips cleanly (toggle twice)', () => {
    const { scene } = buildScene();
    const mat = new THREE.MeshStandardMaterial({ color: 0x334455 });
    const crate = makeMesh(mat);
    scene.add(crate);

    const fb = new Fullbright(scene);
    fb.toggle();
    fb.toggle();
    fb.toggle();

    expect(fb.active).toBe(true);
    expect(crate.material).toBeInstanceOf(THREE.MeshBasicMaterial);

    fb.toggle();
    expect(fb.active).toBe(false);
    expect(crate.material).toBe(mat);
  });
});

describe('Fullbright refresh', () => {
  it('picks up meshes spawned while active', () => {
    const { scene } = buildScene();
    const fb = new Fullbright(scene);
    fb.enable();

    const late = makeMesh(new THREE.MeshStandardMaterial({ color: 0x123456 }));
    scene.add(late);
    expect(late.material).toBeInstanceOf(THREE.MeshStandardMaterial);   // not yet

    fb.refresh();
    expect(late.material).toBeInstanceOf(THREE.MeshBasicMaterial);

    fb.disable();
    expect(late.material).toBeInstanceOf(THREE.MeshStandardMaterial);
  });

  it('is idempotent — a second pass swaps nothing new', () => {
    const { scene } = buildScene();
    const mat = new THREE.MeshStandardMaterial();
    scene.add(makeMesh(mat));

    const fb = new Fullbright(scene);
    fb.enable();
    const twin = fb._twins.get(mat);

    fb.refresh();

    expect(fb._twins.get(mat)).toBe(twin);
    expect(fb._twins.size).toBe(1);
  });

  it('is a no-op while inactive', () => {
    const { scene } = buildScene();
    const mat = new THREE.MeshStandardMaterial();
    const crate = makeMesh(mat);
    scene.add(crate);

    const fb = new Fullbright(scene);
    fb.refresh();

    expect(crate.material).toBe(mat);
  });
});

describe('Fullbright dispose', () => {
  it('restores the scene when disposed while active', () => {
    const { scene, sun } = buildScene();
    const mat = new THREE.MeshStandardMaterial();
    const crate = makeMesh(mat);
    scene.add(crate);

    const fb = new Fullbright(scene);
    fb.enable();
    fb.dispose();

    expect(fb.active).toBe(false);
    expect(crate.material).toBe(mat);
    expect(sun.visible).toBe(true);
    expect(scene.fog).toBeInstanceOf(THREE.FogExp2);
  });
});
