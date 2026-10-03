import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('@dimforge/rapier3d', async () => (await import('../test/fakeRapier.js')).rapierModule());

import { AirlockPortal } from './AirlockPortal.js';
import { Airlock } from '../scenes/rooms/Airlock.js';
import { OcclusionZones } from '../systems/OcclusionZones.js';
import { EVASuit } from './EVASuit.js';
import { Component } from '../core/Component.js';
import { GameObject } from '../core/GameObject.js';
import { makeEngine } from '../test/fakeRapier.js';

// ─────────────────────────────────────────────
// AirlockPortal  –  the airlock decides which side of the base is drawn
// ─────────────────────────────────────────────

function fakeRenderer() {
  const pending = [];
  return {
    compileAsync: vi.fn(() => new Promise(resolve => pending.push(resolve))),
    finishCompiles: () => { while (pending.length) pending.shift()(); },
  };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('AirlockPortal', () => {
  let engine, airlock, suit, zones, renderer, portal, desk, buggy;

  /** One frame: the portal, then the airlock, as the scene graph ticks them. */
  function frame() {
    portal.onUpdate(1 / 60);
    airlock.update(1 / 60);
  }
  function run(seconds) {
    for (let i = 0; i < Math.round(seconds * 60); i++) frame();
  }

  beforeEach(() => {
    engine = makeEngine();
    airlock = new Airlock(engine, { position: [2, 0, 6.6] });
    airlock.build();
    suit = new GameObject('Player').addComponent(new EVASuit());
    airlock.bindSuit(suit);

    renderer = fakeRenderer();
    zones = new OcclusionZones({ renderer, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), framesToReady: 2 });
    desk = new THREE.Mesh();
    buggy = new THREE.Mesh();
    zones.add('interior', [desk]);
    zones.add('yard', [buggy]);

    portal = new AirlockPortal({ airlock, zones, engine });
    portal.onStart();
  });

  it('is a component, ticked by whatever it hangs on', () => {
    expect(portal).toBeInstanceOf(Component);
  });

  it('starts indoors: the interior drawn, the yard beyond the hatch not', () => {
    expect(desk.visible).toBe(true);
    expect(buggy.visible).toBe(false);
  });

  it('suiting up swaps sides at once — both doors are shut, nobody can see either', () => {
    suit.putOn();
    expect(airlock.state).toBe('depressurising');
    expect(desk.visible).toBe(false);
    expect(buggy.visible).toBe(true);
  });

  it('keeps the hatch shut until the yard is ready, however long the cycle has run', async () => {
    suit.putOn();
    run(airlock.cycleTime + 1);
    expect(airlock.hatch.locked).toBe(true);

    renderer.finishCompiles();
    await flush();
    run(0.1);
    expect(airlock.hatch.locked).toBe(false);
  });

  it('coming back in draws the interior again, and hides the yard, as the hatch shuts', async () => {
    suit.putOn();
    renderer.finishCompiles();
    await flush();
    run(airlock.cycleTime + 0.1);

    suit.takeOff();
    expect(airlock.hatch.locked).toBe(true);
    expect(desk.visible).toBe(true);
    expect(buggy.visible).toBe(false);

    renderer.finishCompiles();
    await flush();
    run(airlock.cycleTime + 0.1);
    expect(airlock.state).toBe('pressurised');
  });

  it('shows everything while the debug fly camera is out, and restores the culling after', () => {
    engine.debugCamera = { active: true };
    frame();
    expect(buggy.visible).toBe(true);

    engine.debugCamera.active = false;
    frame();
    expect(buggy.visible).toBe(false);
  });

  it('shows everything while the level editor is open', () => {
    engine.levelEditor = { enabled: true };
    frame();
    expect(buggy.visible).toBe(true);
    engine.levelEditor.enabled = false;
    frame();
    expect(buggy.visible).toBe(false);
  });

  it('lets go of the airlock when destroyed', () => {
    portal.onDestroy();
    expect(airlock.readyFor).toBeNull();
    suit.putOn();
    expect(desk.visible).toBe(true);     // no longer listening
  });
});
