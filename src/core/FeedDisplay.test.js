import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { FeedDisplay, FEED } from './FeedDisplay.js';

// ─────────────────────────────────────────────
// FeedDisplay  –  the security monitor's own picture (#161)
// ─────────────────────────────────────────────

function fakeRenderer() {
  let target = null;
  const r = {
    rendered: [],
    getRenderTarget: vi.fn(() => target),
    setRenderTarget: vi.fn((t) => { target = t; }),
    render: vi.fn((scene, camera) => { r.rendered.push({ scene, camera, target }); }),
  };
  return r;
}

function fakeZones() {
  const zones = {
    drawn: [],
    drawFor: vi.fn((names, draw) => { zones.drawn.push(names); draw(); }),
  };
  return zones;
}

function camera(zones = ['yard']) {
  return { lens: new THREE.PerspectiveCamera(60, 1, 0.1, 500), zones };
}

const transition = (over = {}) => ({
  active: false, frozen: false, blank: false, noise: 0, tear: 0, roll: 0, desat: 0, band: 0, ...over,
});

describe('FeedDisplay', () => {
  let renderer, zones, scene, display;

  beforeEach(() => {
    renderer = fakeRenderer();
    zones = fakeZones();
    scene = new THREE.Scene();
    display = new FeedDisplay({ scene, zones, aspect: 1.7 });
    display.attach(renderer);
  });

  it('draws nothing until a picture is wanted, then one, into its own target', () => {
    const cam = camera();
    display.show(cam);
    display.render();
    expect(renderer.render).not.toHaveBeenCalled();
    display.want();
    display.render();
    display.render();
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(renderer.rendered[0]).toMatchObject({ scene, camera: cam.lens, target: display.target });
  });

  it('puts back whatever target was set', () => {
    const before = { isRenderTarget: true };
    renderer.setRenderTarget(before);
    display.show(camera());
    display.want();
    display.render();
    expect(renderer.getRenderTarget()).toBe(before);
  });

  it('draws the zones the camera sees for its picture alone', () => {
    display.show(camera(['yard', 'unseen']));
    display.want();
    display.render();
    expect(zones.drawn).toEqual([['yard', 'unseen']]);
  });

  it('with no camera, or no power, draws nothing — and the screen goes dark', () => {
    display.want();
    display.render();
    display.show(camera());
    display.setPowered(false);
    display.want();
    display.render();
    expect(renderer.render).not.toHaveBeenCalled();
    expect(display.material.uniforms.uPower.value).toBe(0);
    display.setPowered(true);
    expect(display.material.uniforms.uPower.value).toBe(1);
  });

  it('shows the camera in the screen\'s own shape', () => {
    const cam = camera();
    display.show(cam);
    expect(cam.lens.aspect).toBeCloseTo(1.7);
    expect(display.camera).toBe(cam);
  });

  it('draws small from across the room, sharper up close', () => {
    expect(display.target.height).toBe(FEED.idleHeight);
    expect(display.target.width).toBe(Math.round(FEED.idleHeight * 1.7));
    display.setDetail('close');
    expect(display.target.height).toBe(FEED.closeHeight);
    display.setDetail('idle');
    expect(display.target.height).toBe(FEED.idleHeight);
  });

  it('keeps its picture in HDR, for the screen to tone map like the frame', () => {
    expect(display.target.texture.type).toBe(THREE.HalfFloatType);
    expect(display.material.uniforms.tFeed.value).toBe(display.target.texture);
  });

  it('takes the switch from the transition: frozen, grain, tear, roll, colour, band', () => {
    display.set(transition({ frozen: true, blank: true, noise: 0.4, tear: 0.3, roll: 0.2, desat: 0.8, band: 0.5 }));
    const u = display.material.uniforms;
    expect(u.uFrozen.value).toBe(1);
    expect(u.uBlank.value).toBe(1);
    expect(u.uNoise.value).toBe(0.4);
    expect(u.uTear.value).toBe(0.3);
    expect(u.uRoll.value).toBe(0.2);
    expect(u.uDesat.value).toBe(0.8);
    expect(u.uBand.value).toBe(0.5);
  });

  it('its clock runs always: the scanlines crawl on an idle screen', () => {
    display.tick(0.5);
    display.tick(0.25);
    expect(display.material.uniforms.uTime.value).toBeCloseTo(0.75);
  });

  it('is unlit and tone mapped: a picture glowing, not a surface lit', () => {
    expect(display.material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(display.material.lights).toBe(false);
    expect(display.material.fog).toBe(false);
    expect(display.material.toneMapped).toBe(true);
    expect(display.material.fragmentShader).toContain('#include <tonemapping_fragment>');
  });

  it('lays an overlay over the picture: the camera\'s label and the map, on the monitor itself', () => {
    expect(display.material.uniforms.uHasOverlay.value).toBe(0);
    const overlay = new THREE.Texture();
    display.setOverlay(overlay);
    expect(display.material.uniforms.tOverlay.value).toBe(overlay);
    expect(display.material.uniforms.uHasOverlay.value).toBe(1);
  });

  it('its grain and scanlines are a share of the screen, not of the picture\'s pixels: the same up close', () => {
    const fs = display.material.fragmentShader;
    expect(fs).toContain('SCANLINES');
    expect(fs).not.toMatch(/mod\(px\.y/);
  });

  it('dispose frees the target and the material', () => {
    const target = display.target;
    const material = display.material;
    const t = vi.spyOn(target, 'dispose');
    const m = vi.spyOn(material, 'dispose');
    display.dispose();
    expect(t).toHaveBeenCalled();
    expect(m).toHaveBeenCalled();
    display.want();
    display.render();   // nothing to draw with: no throw
  });
});
