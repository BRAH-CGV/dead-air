// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';

// Recording-free fake: InteractionSystem only needs Ray construction and a
// world.castRay it can call — no bodies, no WASM (see AGENTS.md, BUG-003).
vi.mock('@dimforge/rapier3d', () => ({
  default: {
    Ray: class Ray {
      constructor(origin, dir) { this.origin = origin; this.dir = dir; }
      pointAt() { return { x: 0, y: 0, z: 0 }; }
    },
    QueryFilterFlags: { EXCLUDE_SENSORS: 8 },   // Rapier's own bit
  },
}));

import { InteractionSystem } from './InteractionSystem.js';
import { Interactable } from './Interactable.js';
import { GameObject } from '../core/GameObject.js';

function makePlayer({ hit = null } = {}) {
  const player = new GameObject('Player');
  player.rigidBody = { handle: 1 };

  const camera = new THREE.PerspectiveCamera();
  const engine = {
    camera,
    world: { castRay: vi.fn(() => hit) },
    _bodyToGO: new Map(),
    isAction: vi.fn(() => false),
  };
  player.scene = { userData: { engine } };

  const prompt = { show: vi.fn(), hide: vi.fn() };
  const sys = new InteractionSystem({ prompt });
  player.addComponent(sys);
  sys.onStart();

  return { player, sys, engine, prompt };
}

describe('InteractionSystem prompt', () => {
  it('shows the targeted Interactable.promptLabel on the HUD prompt', () => {
    const target = new GameObject('Console');
    const interactable = target.addComponent(new class extends Interactable {
      promptLabel = '[E] Delete signal';
    }());
    const collider = { parent: () => ({ handle: 1 }) };

    const { sys, engine, prompt } = makePlayer({
      hit: { collider, timeOfImpact: 1 },
    });
    engine._bodyToGO.set(1, target);

    sys.onUpdate(0);

    expect(sys.currentTarget).toBe(interactable);
    expect(prompt.show).toHaveBeenCalledWith('[E] Delete signal');
    expect(prompt.hide).not.toHaveBeenCalled();
  });

  it('hides the prompt once nothing is targeted', () => {
    const { sys, prompt } = makePlayer({ hit: null });

    sys.onUpdate(0);

    expect(sys.currentTarget).toBeNull();
    expect(prompt.hide).toHaveBeenCalled();
  });

  it('does not re-show the same prompt every frame — only on target change', () => {
    const target = new GameObject('Console');
    target.addComponent(new class extends Interactable {
      promptLabel = '[E] Delete signal';
    }());
    const collider = { parent: () => ({ handle: 1 }) };

    const { sys, engine, prompt } = makePlayer({
      hit: { collider, timeOfImpact: 1 },
    });
    engine._bodyToGO.set(1, target);

    sys.onUpdate(0);
    sys.onUpdate(0);

    expect(prompt.show).toHaveBeenCalledTimes(1);
  });

  it('re-shows the prompt when the hovered target changes its label (a toggle)', () => {
    // The suit locker flips between "Put on" and "Take off" while the player
    // is still looking at it — the prompt must not keep the stale verb.
    const target = new GameObject('Locker');
    const interactable = target.addComponent(new class extends Interactable {
      promptLabel = '[E] Put on EVA suit';
    }());
    const collider = { parent: () => ({ handle: 1 }) };

    const { sys, engine, prompt } = makePlayer({
      hit: { collider, timeOfImpact: 1 },
    });
    engine._bodyToGO.set(1, target);

    sys.onUpdate(0);
    interactable.promptLabel = '[E] Take off EVA suit';
    sys.onUpdate(0);
    sys.onUpdate(0);

    expect(prompt.show.mock.calls).toEqual([['[E] Put on EVA suit'], ['[E] Take off EVA suit']]);
  });
});

// ── Line of sight ───────────────────────────────────────────
// A fake castRay that honours its arguments the way Rapier does: of the
// colliders along the ray, it returns the nearest one inside maxToi that
// survives the sensor flag, the excluded body and the predicate. So these
// tests pin what the player can reach, not which filter argument does it.

const EXCLUDE_SENSORS = 8;

function collider(handle, { sensor = false } = {}) {
  return { parent: () => ({ handle }), isSensor: () => sensor };
}

function rayThrough(...along) {
  return vi.fn((ray, maxToi, solid, flags, groups, exCollider, exBody, predicate) => {
    const hit = along
      .filter(h => h.timeOfImpact <= maxToi)
      .filter(h => !((flags ?? 0) & EXCLUDE_SENSORS && h.collider.isSensor()))
      .filter(h => h.collider.parent()?.handle !== exBody?.handle)
      .filter(h => !predicate || predicate(h.collider))
      .sort((a, b) => a.timeOfImpact - b.timeOfImpact)[0];
    return hit ?? null;
  });
}

function lockerAt(engine, handle) {
  const locker = new GameObject('SuitLocker');
  const use = locker.addComponent(new class extends Interactable {
    promptLabel = '[E] Put on EVA suit';
  }());
  engine._bodyToGO.set(handle, locker);
  return use;
}

describe('InteractionSystem line of sight', () => {
  it('reaches an Interactable with nothing in the way', () => {
    const { sys, engine } = makePlayer();
    const use = lockerAt(engine, 20);
    engine.world.castRay = rayThrough({ collider: collider(20), timeOfImpact: 2 });

    sys.onUpdate(0);

    expect(sys.currentTarget).toBe(use);
  });

  it('cannot reach an Interactable through a wall', () => {
    const { sys, engine, prompt } = makePlayer();
    lockerAt(engine, 20);
    const wall = new GameObject('Wall');                 // registered, but not interactable
    engine._bodyToGO.set(10, wall);
    engine.world.castRay = rayThrough(
      { collider: collider(10), timeOfImpact: 1 },
      { collider: collider(20), timeOfImpact: 2 },
    );

    sys.onUpdate(0);

    expect(sys.currentTarget).toBeNull();
    expect(prompt.show).not.toHaveBeenCalled();
  });

  it('cannot reach through a collider that belongs to no GameObject (room shells, terrain)', () => {
    const { sys, engine } = makePlayer();
    lockerAt(engine, 20);
    engine.world.castRay = rayThrough(
      { collider: collider(10), timeOfImpact: 1 },       // not in _bodyToGO
      { collider: collider(20), timeOfImpact: 2 },
    );

    sys.onUpdate(0);

    expect(sys.currentTarget).toBeNull();
  });

  it('does not fire onInteract on a prop behind a wall', () => {
    const { sys, engine } = makePlayer();
    const use = lockerAt(engine, 20);
    use.onInteract = vi.fn();
    engine.world.castRay = rayThrough(
      { collider: collider(10), timeOfImpact: 1 },
      { collider: collider(20), timeOfImpact: 2 },
    );
    engine.isAction = vi.fn(() => true);

    sys.onUpdate(0);

    expect(use.onInteract).not.toHaveBeenCalled();
  });

  it('sees through an open doorway — a sensor blocks nothing', () => {
    const { sys, engine } = makePlayer();
    const use = lockerAt(engine, 20);
    engine.world.castRay = rayThrough(
      { collider: collider(10, { sensor: true }), timeOfImpact: 1 },
      { collider: collider(20), timeOfImpact: 2 },
    );

    sys.onUpdate(0);

    expect(sys.currentTarget).toBe(use);
  });

  it("never targets the player's own body", () => {
    const { sys, engine } = makePlayer();                // player body handle is 1
    const use = lockerAt(engine, 20);
    engine.world.castRay = rayThrough(
      { collider: collider(1), timeOfImpact: 0 },
      { collider: collider(20), timeOfImpact: 2 },
    );

    sys.onUpdate(0);

    expect(sys.currentTarget).toBe(use);
  });
});

