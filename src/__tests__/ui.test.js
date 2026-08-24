import { describe, it, expect } from 'vitest';
import {
  createUIState,
  setInteractionPrompt,
  clearInteractionPrompt,
  updateObjectiveTracker,
  setGameMessage,
  clearGameMessage,
} from '../ui.js';

describe('ui', () => {
  describe('createUIState', () => {
    it('creates a UI state with no prompts visible', () => {
      const ui = createUIState();
      expect(ui.interactionPrompt).toBeNull();
      expect(ui.gameMessage).toBeNull();
      expect(ui.objectives).toHaveLength(0);
    });
  });

  describe('setInteractionPrompt / clearInteractionPrompt', () => {
    it('sets the interaction prompt text', () => {
      const ui = createUIState();
      setInteractionPrompt(ui, 'Press E to barricade door');
      expect(ui.interactionPrompt).toBe('Press E to barricade door');
    });

    it('clears the interaction prompt', () => {
      const ui = createUIState();
      setInteractionPrompt(ui, 'Press E to barricade door');
      clearInteractionPrompt(ui);
      expect(ui.interactionPrompt).toBeNull();
    });
  });

  describe('updateObjectiveTracker', () => {
    it('updates the objective list', () => {
      const ui = createUIState();
      const objectives = [
        { id: 'barricade-door', description: 'Barricade the door', completed: false },
        { id: 'use-signal-receiver', description: 'Activate the signal receiver', completed: false },
      ];
      updateObjectiveTracker(ui, objectives);
      expect(ui.objectives).toHaveLength(2);
    });

    it('reflects completed status', () => {
      const ui = createUIState();
      const objectives = [
        { id: 'barricade-door', description: 'Barricade the door', completed: true },
        { id: 'use-signal-receiver', description: 'Activate the signal receiver', completed: false },
      ];
      updateObjectiveTracker(ui, objectives);
      expect(ui.objectives[0].completed).toBe(true);
      expect(ui.objectives[1].completed).toBe(false);
    });
  });

  describe('setGameMessage / clearGameMessage', () => {
    it('sets a temporary game message', () => {
      const ui = createUIState();
      setGameMessage(ui, 'Door barricaded!');
      expect(ui.gameMessage).toBe('Door barricaded!');
    });

    it('clears the game message', () => {
      const ui = createUIState();
      setGameMessage(ui, 'Door barricaded!');
      clearGameMessage(ui);
      expect(ui.gameMessage).toBeNull();
    });
  });
});
