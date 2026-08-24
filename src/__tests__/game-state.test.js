import { describe, it, expect } from 'vitest';
import {
  createGameState,
  completeObjective,
  isObjectiveComplete,
  checkWinCondition,
  resetGameState,
  getActiveObjectives,
  getCompletedObjectives,
} from '../game-state.js';

const sampleObjectives = [
  { id: 'barricade-door', description: 'Barricade the door', interactableId: 'door' },
  { id: 'use-signal-receiver', description: 'Activate the signal receiver', interactableId: 'signal-receiver' },
];

describe('game-state', () => {
  describe('createGameState', () => {
    it('creates a game state with no objectives completed', () => {
      const state = createGameState(sampleObjectives);
      expect(getCompletedObjectives(state)).toHaveLength(0);
      expect(getActiveObjectives(state)).toHaveLength(2);
    });

    it('stores the objective definitions', () => {
      const state = createGameState(sampleObjectives);
      expect(state.objectives).toHaveLength(2);
    });

    it('starts in playing status', () => {
      const state = createGameState(sampleObjectives);
      expect(state.status).toBe('playing');
    });
  });

  describe('completeObjective', () => {
    it('marks an objective as completed', () => {
      const state = createGameState(sampleObjectives);
      completeObjective(state, 'barricade-door');
      expect(isObjectiveComplete(state, 'barricade-door')).toBe(true);
    });

    it('reduces active objectives count', () => {
      const state = createGameState(sampleObjectives);
      completeObjective(state, 'barricade-door');
      expect(getActiveObjectives(state)).toHaveLength(1);
      expect(getCompletedObjectives(state)).toHaveLength(1);
    });

    it('does nothing for an unknown objective id', () => {
      const state = createGameState(sampleObjectives);
      completeObjective(state, 'nonexistent');
      expect(getActiveObjectives(state)).toHaveLength(2);
    });

    it('does not duplicate completion', () => {
      const state = createGameState(sampleObjectives);
      completeObjective(state, 'barricade-door');
      completeObjective(state, 'barricade-door');
      expect(getCompletedObjectives(state)).toHaveLength(1);
    });
  });

  describe('checkWinCondition', () => {
    it('returns false when objectives remain', () => {
      const state = createGameState(sampleObjectives);
      completeObjective(state, 'barricade-door');
      expect(checkWinCondition(state)).toBe(false);
    });

    it('returns true when all objectives are completed', () => {
      const state = createGameState(sampleObjectives);
      completeObjective(state, 'barricade-door');
      completeObjective(state, 'use-signal-receiver');
      expect(checkWinCondition(state)).toBe(true);
    });

    it('sets status to won when all objectives complete', () => {
      const state = createGameState(sampleObjectives);
      completeObjective(state, 'barricade-door');
      completeObjective(state, 'use-signal-receiver');
      checkWinCondition(state);
      expect(state.status).toBe('won');
    });
  });

  describe('resetGameState', () => {
    it('resets all objectives and status', () => {
      const state = createGameState(sampleObjectives);
      completeObjective(state, 'barricade-door');
      completeObjective(state, 'use-signal-receiver');
      checkWinCondition(state);

      resetGameState(state);
      expect(state.status).toBe('playing');
      expect(getCompletedObjectives(state)).toHaveLength(0);
      expect(getActiveObjectives(state)).toHaveLength(2);
    });
  });

  describe('getActiveObjectives', () => {
    it('returns only incomplete objectives', () => {
      const state = createGameState(sampleObjectives);
      completeObjective(state, 'barricade-door');
      const active = getActiveObjectives(state);
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe('use-signal-receiver');
    });
  });
});
