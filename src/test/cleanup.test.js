import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import v8 from 'node:v8';
import vm from 'node:vm';

import { makeEngine } from './fakeRapier.js';
import { onCleanup } from './cleanup.js';

// ─────────────────────────────────────────────
// What one test builds is let go once it is over. Vitest keeps every vi.fn
// until the file ends, with its implementation and every call's arguments and
// result. The fake engine's mocks close over the engine and the engine holds
// the scene, so before this a file that built the base in every test kept
// every base it built, until the worker ran out of memory.
//
// The tests come in pairs: the first builds something and keeps only a
// WeakRef to it, the next forces a full collection and checks it went.
// ─────────────────────────────────────────────

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc');

/** True once nothing holds the WeakRef's target. */
async function collected(ref) {
  // A WeakRef keeps its target alive to the end of the job that made or read it.
  await new Promise(resolve => setTimeout(resolve, 0));
  gc();
  return ref.deref() === undefined;
}

describe('an engine made in a test', () => {
  let scene;

  it('builds a scene on the fake engine', () => {
    const engine = makeEngine();
    engine.scene = new THREE.Scene();
    const crate = engine.spawnModel('model:crate', { position: [1, 0, 0] });
    engine.scene.add(crate.object3d);
    scene = new WeakRef(engine.scene);
  });

  it('is let go once that test is over, scene and all', async () => {
    expect(await collected(scene)).toBe(true);
  });
});

describe('a mock called in a test', () => {
  const record = vi.fn();
  let argument;

  it('is called with something big', () => {
    const big = { data: new Float32Array(1024) };
    record(big);
    argument = new WeakRef(big);
  });

  it('has forgotten it by the next test', async () => {
    expect(record).not.toHaveBeenCalled();
    expect(await collected(argument)).toBe(true);
  });
});

describe('an engine made in beforeAll', () => {
  let engine;

  beforeAll(() => {
    engine = makeEngine();
    engine.scene = new THREE.Scene();
    engine.spawnModel('model:crate');
  });

  it('is there for the first test', () => {
    expect(engine._rootObjects.length).toBe(1);
  });

  it('and still whole for the next, since it belongs to the whole block', () => {
    expect(engine.scene).toBeInstanceOf(THREE.Scene);
    expect(engine._rootObjects.length).toBe(1);
    expect(engine.world.bodies.len()).toBe(1);
  });
});

describe('onCleanup', () => {
  const ran = [];

  afterEach(() => ran.push('afterEach'));

  it('in a test, runs once the test is over, after its afterEach', () => {
    onCleanup(() => ran.push('cleanup'));
    expect(ran).toEqual([]);
  });

  it('ran then, and only once', () => {
    expect(ran).toEqual(['afterEach', 'cleanup']);
  });
});
