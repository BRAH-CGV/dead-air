/**
 * UI state — tracks what the HUD should display.
 * Pure data, no DOM dependency. main.js reads this state and updates DOM elements.
 */

export function createUIState() {
  return {
    interactionPrompt: null,
    gameMessage: null,
    objectives: [],
  };
}

export function setInteractionPrompt(ui, text) {
  ui.interactionPrompt = text;
}

export function clearInteractionPrompt(ui) {
  ui.interactionPrompt = null;
}

export function updateObjectiveTracker(ui, objectives) {
  ui.objectives = objectives.map(o => ({
    id: o.id,
    description: o.description,
    completed: o.completed ?? false,
  }));
}

export function setGameMessage(ui, text) {
  ui.gameMessage = text;
}

export function clearGameMessage(ui) {
  ui.gameMessage = null;
}
