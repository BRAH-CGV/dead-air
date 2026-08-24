/**
 * Game state — tracks objectives, win conditions, and overall game status.
 * Pure logic, no Three.js dependency.
 */

export function createGameState(objectiveDefs) {
  return {
    objectives: objectiveDefs.map(o => ({ ...o })),
    completedIds: new Set(),
    status: 'playing', // 'playing' | 'won' | 'lost'
  };
}

export function completeObjective(state, objectiveId) {
  const exists = state.objectives.find(o => o.id === objectiveId);
  if (!exists) return;
  state.completedIds.add(objectiveId);
}

export function isObjectiveComplete(state, objectiveId) {
  return state.completedIds.has(objectiveId);
}

export function checkWinCondition(state) {
  const allDone = state.objectives.every(o => state.completedIds.has(o.id));
  if (allDone) {
    state.status = 'won';
  }
  return allDone;
}

export function resetGameState(state) {
  state.completedIds.clear();
  state.status = 'playing';
}

export function getActiveObjectives(state) {
  return state.objectives.filter(o => !state.completedIds.has(o.id));
}

export function getCompletedObjectives(state) {
  return state.objectives.filter(o => state.completedIds.has(o.id));
}
