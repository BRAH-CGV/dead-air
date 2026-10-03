import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Flashlight } from './Flashlight.js';
import { Component } from '../core/Component.js';
import { GameObject } from '../core/GameObject.js';

// ─────────────────────────────────────────────
// Flashlight  –  weak, short-range torch on the player's camera
// ─────────────────────────────────────────────
// Built by hand rather than through the Engine, which would drag in Rapier's
// WASM for a component that only needs a camera and the input table.

function buildPlayer(opts) {
  const camera = new THREE.PerspectiveCamera();
  const engine = {
    camera,
    keyBinds: { flashlight: 'KeyF' },
    input: { keys: {}, pressed: {} },
  };
  const go = new GameObject('Player');
  go.scene = { userData: { engine } };
  const torch = go.addComponent(new Flashlight(opts));
  torch.onAwake();
  torch.onStart();
  return { engine, camera, torch };
}

/** One frame with F freshly pressed — the engine clears `pressed` after each. */
function pressF(engine, torch) {
  engine.input.pressed.KeyF = true;
  torch.onUpdate(1 / 60);
  engine.input.pressed = {};
}

describe('Flashlight', () => {
  it('is a component, so it can ride on the player', () => {
    expect(new Flashlight()).toBeInstanceOf(Component);
  });

  it('mounts a spotlight on the camera, aimed down the view direction', () => {
    const { camera, torch } = buildPlayer();
    expect(torch.light).toBeInstanceOf(THREE.SpotLight);
    expect(torch.light.parent).toBe(camera);
    expect(torch.light.target.parent).toBe(camera);
    expect(torch.light.target.position.z).toBeLessThan(0);   // cameras look down -Z
  });

  it('starts off', () => {
    const { torch } = buildPlayer();
    expect(torch.on).toBe(false);
    expect(torch.light.intensity).toBe(0);
  });

  it('F toggles it on and off', () => {
    const { engine, torch } = buildPlayer();
    pressF(engine, torch);
    expect(torch.on).toBe(true);
    expect(torch.light.intensity).toBeGreaterThan(0);
    pressF(engine, torch);
    expect(torch.on).toBe(false);
    expect(torch.light.intensity).toBe(0);
  });

  it('holding F does not flicker it — only the press counts', () => {
    const { engine, torch } = buildPlayer();
    pressF(engine, torch);
    engine.input.keys.KeyF = true;           // still held, no new press
    torch.onUpdate(1 / 60);
    torch.onUpdate(1 / 60);
    expect(torch.on).toBe(true);
  });

  it('switches by intensity, never visibility — a light count change recompiles every shader', () => {
    const { engine, torch } = buildPlayer();
    expect(torch.light.visible).toBe(true);
    pressF(engine, torch);
    pressF(engine, torch);
    expect(torch.light.visible).toBe(true);
  });

  it('is bright up close but short-ranged, so the dark further off stays dark', () => {
    const { torch } = buildPlayer();
    const { light } = torch;
    expect(light.distance).toBeGreaterThan(0);
    expect(light.distance).toBeLessThanOrEqual(9);
    expect(light.decay).toBe(2);
    expect(light.angle).toBeLessThan(Math.PI / 5);
    expect(torch.intensity).toBeGreaterThanOrEqual(35);   // floods what is in front of you
  });

  it('takes its tunables from the constructor', () => {
    const { engine, torch } = buildPlayer({ intensity: 2, distance: 5 });
    pressF(engine, torch);
    expect(torch.light.intensity).toBe(2);
    expect(torch.light.distance).toBe(5);
  });

  it('removes its light from the camera when destroyed', () => {
    const { camera, torch } = buildPlayer();
    const { light } = torch;
    torch.onDestroy();
    expect(light.parent).toBeNull();
    expect(light.target.parent).toBeNull();
    expect(camera.children).toHaveLength(0);
  });

  it('waits quietly with no engine wired up', () => {
    const torch = new Flashlight();
    new GameObject('Player').addComponent(torch);
    expect(() => { torch.onAwake(); torch.onStart(); torch.onUpdate(1 / 60); torch.onDestroy(); }).not.toThrow();
  });
});

describe('Flashlight timing', () => {
  it('is on the camera from awake — before the boot warm-up compiles the shaders it changes', () => {
    // A light added on the first frame instead changes the light count every
    // lit shader is compiled for, after the warm-up: a full recompile.
    const camera = new THREE.PerspectiveCamera();
    const go = new GameObject('Player');
    go.scene = { userData: { engine: { camera, keyBinds: {}, input: { keys: {}, pressed: {} } } } };
    const torch = go.addComponent(new Flashlight());
    torch.onAwake();
    expect(torch.light.parent).toBe(camera);
  });
});
