import { describe, it, expect } from 'vitest';
import {
  createInteractionManager,
  setInteractionTarget,
  clearInteractionTarget,
  getInteractionTarget,
  interact,
  isInteractableCompleted,
} from '../interactions.js';

const sampleInteractables = [
  { id: 'door', action: 'barricade', prompt: 'Press E to barricade', completedPrompt: 'Door barricaded' },
  { id: 'signal-receiver', action: 'use', prompt: 'Press E to use', completedPrompt: 'Signal sent!' },
];

describe('interactions', () => {
  describe('createInteractionManager', () => {
    it('creates a manager with no active target', () => {
      const mgr = createInteractionManager(sampleInteractables);
      expect(getInteractionTarget(mgr)).toBeNull();
    });

    it('stores the interactable definitions', () => {
      const mgr = createInteractionManager(sampleInteractables);
      expect(mgr.interactables).toHaveLength(2);
    });
  });

  describe('setInteractionTarget / getInteractionTarget', () => {
    it('sets the target to a valid interactable id', () => {
      const mgr = createInteractionManager(sampleInteractables);
      setInteractionTarget(mgr, 'door');
      const target = getInteractionTarget(mgr);
      expect(target).not.toBeNull();
      expect(target.id).toBe('door');
      expect(target.prompt).toBe('Press E to barricade');
    });

    it('returns null for an unknown interactable id', () => {
      const mgr = createInteractionManager(sampleInteractables);
      setInteractionTarget(mgr, 'nonexistent');
      expect(getInteractionTarget(mgr)).toBeNull();
    });

    it('switches target between interactables', () => {
      const mgr = createInteractionManager(sampleInteractables);
      setInteractionTarget(mgr, 'door');
      expect(getInteractionTarget(mgr).id).toBe('door');
      setInteractionTarget(mgr, 'signal-receiver');
      expect(getInteractionTarget(mgr).id).toBe('signal-receiver');
    });
  });

  describe('clearInteractionTarget', () => {
    it('clears the current target', () => {
      const mgr = createInteractionManager(sampleInteractables);
      setInteractionTarget(mgr, 'door');
      clearInteractionTarget(mgr);
      expect(getInteractionTarget(mgr)).toBeNull();
    });
  });

  describe('interact', () => {
    it('completes the current target interaction', () => {
      const mgr = createInteractionManager(sampleInteractables);
      setInteractionTarget(mgr, 'door');
      const result = interact(mgr);
      expect(result).not.toBeNull();
      expect(result.id).toBe('door');
      expect(result.action).toBe('barricade');
    });

    it('returns null when no target is set', () => {
      const mgr = createInteractionManager(sampleInteractables);
      const result = interact(mgr);
      expect(result).toBeNull();
    });

    it('marks the interactable as completed', () => {
      const mgr = createInteractionManager(sampleInteractables);
      setInteractionTarget(mgr, 'door');
      interact(mgr);
      expect(isInteractableCompleted(mgr, 'door')).toBe(true);
    });

    it('does not mark other interactables as completed', () => {
      const mgr = createInteractionManager(sampleInteractables);
      setInteractionTarget(mgr, 'door');
      interact(mgr);
      expect(isInteractableCompleted(mgr, 'signal-receiver')).toBe(false);
    });

    it('shows completed prompt after interaction', () => {
      const mgr = createInteractionManager(sampleInteractables);
      setInteractionTarget(mgr, 'door');
      interact(mgr);
      const target = getInteractionTarget(mgr);
      expect(target.prompt).toBe('Door barricaded');
    });

    it('cannot interact with the same object twice', () => {
      const mgr = createInteractionManager(sampleInteractables);
      setInteractionTarget(mgr, 'door');
      interact(mgr);
      // try to interact again
      const result = interact(mgr);
      expect(result).toBeNull(); // already completed
    });
  });
});
