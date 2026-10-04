import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { Ufo } from './Ufo.js';

// ─────────────────────────────────────────────
// Ufo — the saucer, its searchlight and its beam
// ─────────────────────────────────────────────

const uniforms = ufo => ufo.beamMesh.material.uniforms;

describe('Ufo', () => {
  it('starts hidden with its searchlight at zero — but the light itself is never hidden', () => {
    const ufo = new Ufo();
    expect(ufo.body.visible).toBe(false);
    expect(ufo.beamMesh.visible).toBe(false);
    expect(ufo.searchlight.intensity).toBe(0);
    // Hiding a light recompiles every lit shader; it is zeroed instead.
    let hidden = false;
    for (let o = ufo.searchlight; o; o = o.parent) if (!o.visible) hidden = true;
    expect(hidden).toBe(false);
  });

  it('points its searchlight straight down, casting shadows so roofs keep it out', () => {
    const ufo = new Ufo();
    ufo.setPose(new THREE.Vector3(0, 35, 0));
    ufo.object3d.updateMatrixWorld(true);
    const from = ufo.searchlight.getWorldPosition(new THREE.Vector3());
    const to = ufo.searchlight.target.getWorldPosition(new THREE.Vector3());
    expect(to.sub(from).normalize().y).toBeCloseTo(-1);
    expect(ufo.searchlight.castShadow).toBe(true);
  });

  it('its shadow is tight enough at roof distance that the ceiling slab keeps it out', () => {
    const ufo = new Ufo();
    const { near } = ufo.searchlight.shadow.camera;
    // Depth bias in metres at distance z: ≈ |bias| · z² / near.
    const atRoof = Math.abs(ufo.searchlight.shadow.bias) * 31 * 31 / near;
    expect(atRoof).toBeLessThan(0.05);   // a ceiling slab is 0.2 m thick
  });

  it('the beam reaches the ground from wherever it is', () => {
    const ufo = new Ufo();
    ufo.setPose(new THREE.Vector3(10, 140, -500));
    expect(uniforms(ufo).uLength.value).toBeCloseTo(140);
    expect(ufo.searchlight.distance).toBeGreaterThan(140);
    ufo.setPose(new THREE.Vector3(0, 35, 0));
    expect(uniforms(ufo).uLength.value).toBeCloseTo(35);
  });

  it('a thin beam is a narrow cone; a wide one covers its ground radius', () => {
    const ufo = new Ufo();
    ufo.setVisible(true);
    ufo.setPose(new THREE.Vector3(0, 35, 0));
    ufo.setBeam(1, 1.5);
    const thin = ufo.searchlight.angle;
    expect(Math.tan(thin) * 35).toBeLessThan(3);
    ufo.setBeam(1, 32);
    expect(Math.tan(ufo.searchlight.angle) * 35).toBeGreaterThanOrEqual(32);
    expect(uniforms(ufo).uBottomRadius.value).toBe(32);
    expect(ufo.searchlight.shadow.needsUpdate).toBe(true);   // the cone changed shape
  });

  it('setBeam drives the light and the beam shader together', () => {
    const ufo = new Ufo();
    ufo.setVisible(true);
    ufo.setPose(new THREE.Vector3(0, 35, 0));
    ufo.setBeam(1, 1.5);
    expect(ufo.searchlight.intensity).toBeGreaterThan(500);
    expect(ufo.beamMesh.visible).toBe(true);
    expect(uniforms(ufo).uIntensity.value).toBeGreaterThan(0);
    ufo.setBeam(0, 1.5);
    expect(ufo.searchlight.intensity).toBe(0);
    expect(ufo.beamMesh.visible).toBe(false);
  });

  it('is handed the building as boxes, which the beam shader cuts out — it ends on the roof', () => {
    const ufo = new Ufo();
    const boxes = [
      new THREE.Box3(new THREE.Vector3(-6, -0.2, -5), new THREE.Vector3(6, 3.2, 5)),
      new THREE.Box3(new THREE.Vector3(6, -0.2, 2.5), new THREE.Vector3(10, 3.2, 4.5)),
    ];
    ufo.setCutouts(boxes);
    const u = uniforms(ufo);
    expect(u.uCutoutCount.value).toBe(2);
    expect(u.uCutoutMin.value[1].toArray()).toEqual([6, -0.2, 2.5]);
    expect(u.uCutoutMax.value[0].toArray()).toEqual([6, 3.2, 5]);
    expect(ufo.beamMesh.material.fragmentShader).toMatch(/discard/);
  });

  it('takes at most as many cutouts as the shader has room for', () => {
    const ufo = new Ufo();
    const many = Array.from({ length: 20 }, () => new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(1, 1, 1)));
    ufo.setCutouts(many);
    expect(uniforms(ufo).uCutoutCount.value).toBe(uniforms(ufo).uCutoutMin.value.length);
  });

  it('tick advances the beam shader time (a time-driven uniform)', () => {
    const ufo = new Ufo();
    ufo.tick(0.5);
    expect(uniforms(ufo).uTime.value).toBeCloseTo(0.5);
  });

  it('bobs and spins its body only, so the searchlight (and its shadow) holds still', () => {
    const ufo = new Ufo();
    ufo.setVisible(true);
    ufo.setPose(new THREE.Vector3(0, 35, 0));
    const lightAt = ufo.searchlight.position.clone();
    for (let i = 0; i < 30; i++) ufo.tick(1 / 30);
    expect(ufo.body.rotation.y).not.toBe(0);
    expect(ufo.searchlight.position.equals(lightAt)).toBe(true);
  });

  it('carries a beacon glow under its hull that holds its size on screen and ignores the haze', () => {
    const ufo = new Ufo();
    const beacon = ufo.beacon;
    expect(beacon.isSprite).toBe(true);
    expect(beacon.material.sizeAttenuation).toBe(false);
    expect(beacon.material.fog).toBe(false);
    expect(beacon.material.blending).toBe(THREE.AdditiveBlending);
    expect(beacon.parent).toBe(ufo.body);   // shown and hidden with the saucer
  });

  it('wraps a supplied model under its body', () => {
    const model = new THREE.Group();
    const ufo = new Ufo({ model });
    expect(model.parent).toBe(ufo.body);
  });

  it('appear() bursts in: its beacon flares far past its size on screen, then settles back', () => {
    const ufo = new Ufo();
    ufo.setVisible(true);
    const rest = ufo.beacon.scale.x;
    ufo.appear();
    ufo.tick(0.1);
    expect(ufo.beacon.scale.x).toBeGreaterThan(rest * 2);
    expect(ufo.flash.visible).toBe(true);
    for (let i = 0; i < 90; i++) ufo.tick(1 / 60);
    expect(ufo.beacon.scale.x).toBeCloseTo(rest);
    expect(ufo.flash.visible).toBe(false);
  });

  it('teleport() flashes, and the flash dies away on its own', () => {
    const ufo = new Ufo();
    ufo.teleport();
    expect(ufo.flash.visible).toBe(true);
    for (let i = 0; i < 60; i++) ufo.tick(1 / 60);
    expect(ufo.flash.visible).toBe(false);
  });

  it('dispose frees what it built, never the shared model', () => {
    const modelMaterial = new THREE.MeshStandardMaterial();
    const model = new THREE.Mesh(new THREE.BoxGeometry(), modelMaterial);
    const ufo = new Ufo({ model });
    let beamFreed = false, modelFreed = false;
    ufo.beamMesh.material.addEventListener('dispose', () => { beamFreed = true; });
    modelMaterial.addEventListener('dispose', () => { modelFreed = true; });
    ufo.dispose();
    expect(beamFreed).toBe(true);
    expect(modelFreed).toBe(false);
  });
});
