import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { DustEye, DUST_EYE } from './DustEye.js';

// ─────────────────────────────────────────────
// DustEye — two floating eyes in the storm, and the jaw beneath them
// ─────────────────────────────────────────────
// Construction and wiring only; how the shaders paint is checked by eye.

const color = (eye) => eye.eyeMaterial.uniforms.uColor.value;

describe('DustEye', () => {
  it('is a pair of glowing eyes drawn by a custom shader that pierces the fog', () => {
    const eye = new DustEye();
    expect(eye.eyes).toHaveLength(2);
    const [left, right] = eye.eyes;
    expect(left.position.x).toBeLessThan(0);
    expect(right.position.x).toBeGreaterThan(0);
    expect(left.material).toBe(right.material);
    expect(eye.eyeMaterial.isShaderMaterial).toBe(true);
    expect(eye.eyeMaterial.fog).toBe(false);
    expect(eye.eyeMaterial.blending).toBe(THREE.AdditiveBlending);
  });

  it('starts passive: yellow, no jaw', () => {
    const eye = new DustEye();
    expect(eye.mode).toBe('passive');
    expect(color(eye).getHex()).toBe(new THREE.Color(DUST_EYE.passiveColor).getHex());
    expect(eye.jawMaterial.uniforms.uOpen.value).toBe(0);
  });

  it('growls: red eyes, a short jaw shown shut', () => {
    const eye = new DustEye();
    eye.setMode('growl');
    expect(color(eye).getHex()).toBe(new THREE.Color(DUST_EYE.aggressiveColor).getHex());
    expect(eye.jaw.visible).toBe(true);
    for (let i = 0; i < 30; i++) eye.tick(0.1, new THREE.Vector3(0, 0, 10));
    const u = eye.jawMaterial.uniforms;
    expect(u.uClosed.value).toBe(1);
    expect(u.uOpen.value).toBeCloseTo(DUST_EYE.closedLength);
    expect(eye.jawMaterial.fragmentShader).toMatch(/uClosed/);
  });

  it('then gapes: the jaw opens out to its full length', () => {
    const eye = new DustEye();
    eye.setMode('growl');
    for (let i = 0; i < 10; i++) eye.tick(0.1, new THREE.Vector3(0, 0, 10));
    eye.setMode('aggressive');
    for (let i = 0; i < 30; i++) eye.tick(0.1, new THREE.Vector3(0, 0, 10));
    const u = eye.jawMaterial.uniforms;
    expect(u.uClosed.value).toBe(0);
    expect(u.uOpen.value).toBeCloseTo(1);
  });

  it('turns aggressive: dark orange, and the jaw grows in', () => {
    const eye = new DustEye();
    eye.setMode('aggressive');
    expect(color(eye).getHex()).toBe(new THREE.Color(DUST_EYE.aggressiveColor).getHex());
    eye.tick(0.1, new THREE.Vector3(0, 0, 10));
    const partway = eye.jawMaterial.uniforms.uOpen.value;
    expect(partway).toBeGreaterThan(0);
    for (let i = 0; i < 30; i++) eye.tick(0.1, new THREE.Vector3(0, 0, 10));
    expect(eye.jawMaterial.uniforms.uOpen.value).toBeCloseTo(1);
    expect(eye.jawMaterial.fragmentShader).toMatch(/uOpen/);
  });

  it('has a canine jaw — upper teeth and a lower jaw — that is only teeth, nothing behind them', () => {
    const eye = new DustEye();
    const [w, h] = DUST_EYE.jawSize;
    // Wide enough to read as a mouth, not a thin slot.
    expect(w).toBeGreaterThanOrEqual(0.7);
    expect(h).toBeLessThanOrEqual(1.2);
    const shader = eye.jawMaterial.fragmentShader;
    expect(shader).toMatch(/canine/i);
    expect(shader).toMatch(/lower jaw/i);
    // No mouth and no gums: every pixel is a tooth or nothing.
    expect(eye.jawMaterial.uniforms.uGumColor).toBeUndefined();
    expect(shader).not.toMatch(/maw|gum/i);
    // Hung right under the eyes, like a snout — not trailing far below.
    expect(DUST_EYE.jawDrop).toBeLessThan(0.2);
  });

  it('its silhouette is round: a circle of dust round the face', () => {
    const [w, h] = DUST_EYE.bodySize;
    expect(w).toBe(h);
    const eye = new DustEye();
    expect(eye.bodyMaterial.fragmentShader).toMatch(/circle/i);
    // Big enough to take in the eyes and the jaw under them.
    expect(DUST_EYE.bodySize[0] / 2).toBeGreaterThan(DUST_EYE.jawSize[1] / 2 + 0.3);
  });

  it('agitated: the watching eyes burn a darker orange, until it is hidden', () => {
    const eye = new DustEye();
    eye.setAgitated(true);
    expect(color(eye).getHex()).toBe(new THREE.Color(DUST_EYE.agitatedColor).getHex());
    eye.setMode('growl');
    expect(color(eye).getHex()).toBe(new THREE.Color(DUST_EYE.aggressiveColor).getHex());
    eye.setMode('passive');
    expect(color(eye).getHex()).toBe(new THREE.Color(DUST_EYE.agitatedColor).getHex());
    eye.setAgitated(false);
    expect(color(eye).getHex()).toBe(new THREE.Color(DUST_EYE.passiveColor).getHex());
  });

  it('turns its face to the player, wherever they stand', () => {
    const eye = new DustEye();
    eye.object3d.position.set(3, 1.8, -20);
    eye.object3d.updateMatrixWorld(true);
    for (const player of [[3, 1.2, 0], [-15, 1.2, -20], [20, 0.5, -35], [3, 1.2, -40]]) {
      const at = new THREE.Vector3(...player);
      eye.tick(0.016, at);
      eye.object3d.updateMatrixWorld(true);
      const normal = new THREE.Vector3(0, 0, 1).transformDirection(eye.eyes[0].matrixWorld);
      const toPlayer = at.clone().sub(eye.eyes[0].getWorldPosition(new THREE.Vector3())).normalize();
      expect(normal.dot(toPlayer)).toBeGreaterThan(0.98);
    }
  });

  it('can never vanish edge-on from behind: every part is drawn from both sides', () => {
    const eye = new DustEye();
    for (const m of [eye.eyeMaterial, eye.jawMaterial, eye.bodyMaterial]) expect(m.side).toBe(THREE.DoubleSide);
  });

  it('has a silhouette behind the eyes — drawn first, tinted from outside, not lit or fogged', () => {
    const eye = new DustEye();
    expect(eye.body.isMesh).toBe(true);
    expect(eye.bodyMaterial.isShaderMaterial).toBe(true);
    expect(eye.bodyMaterial.fog).toBe(false);
    expect(eye.body.renderOrder).toBeLessThan(eye.eyes[0].renderOrder);
    expect(eye.body.renderOrder).toBeLessThan(eye.jaw.renderOrder);
    // Its top reaches above the eyes; most of it hangs below.
    eye.object3d.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(eye.body);
    expect(box.max.y).toBeGreaterThan(0);
    expect(box.min.y).toBeLessThan(-1);
    eye.setSilhouetteColor(new THREE.Color(0x221100));
    expect(eye.bodyMaterial.uniforms.uColor.value.getHex()).toBe(0x221100);
  });

  it('can burn fainter', () => {
    const eye = new DustEye();
    const full = eye.eyeMaterial.uniforms.uIntensity.value;
    eye.setIntensity(0.5);
    expect(eye.eyeMaterial.uniforms.uIntensity.value).toBeCloseTo(full * 0.5);
    eye.setIntensity(1);
    expect(eye.eyeMaterial.uniforms.uIntensity.value).toBeCloseTo(full);
  });

  it('fades as a whole', () => {
    const eye = new DustEye();
    eye.setFade(0.25);
    expect(eye.eyeMaterial.uniforms.uFade.value).toBe(0.25);
    expect(eye.jawMaterial.uniforms.uFade.value).toBe(0.25);
    expect(eye.bodyMaterial.uniforms.uFade.value).toBe(0.25);
  });

  it('frees what it built', () => {
    const eye = new DustEye();
    let freed = 0;
    for (const r of [eye.eyeMaterial, eye.jawMaterial, eye.bodyMaterial, eye.eyes[0].geometry, eye.jaw.geometry, eye.body.geometry]) {
      r.addEventListener('dispose', () => freed++);
    }
    eye.dispose();
    expect(freed).toBe(6);
  });
});
