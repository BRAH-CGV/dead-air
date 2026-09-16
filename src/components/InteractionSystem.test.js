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
});
