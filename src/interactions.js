/**
 * Interaction manager — tracks which objects the player can interact with,
 * handles targeting and interaction completion.
 * Pure logic, no Three.js dependency.
 */

export function createInteractionManager(interactableDefs) {
  const completed = new Set();

  return {
    interactables: interactableDefs.map(d => ({ ...d })),
    definitions: new Map(interactableDefs.map(d => [d.id, { ...d }])),
    completed,
    currentTargetId: null,
  };
}

export function setInteractionTarget(manager, id) {
  if (manager.definitions.has(id)) {
    manager.currentTargetId = id;
  } else {
    manager.currentTargetId = null;
  }
}

export function clearInteractionTarget(manager) {
  manager.currentTargetId = null;
}

export function getInteractionTarget(manager) {
  if (!manager.currentTargetId) return null;
  const def = manager.definitions.get(manager.currentTargetId);
  if (!def) return null;

  const isCompleted = manager.completed.has(def.id);
  return {
    id: def.id,
    action: def.action,
    prompt: isCompleted ? def.completedPrompt : def.prompt,
    completed: isCompleted,
  };
}

export function interact(manager) {
  const targetId = manager.currentTargetId;
  if (!targetId) return null;

  // already completed — cannot interact again
  if (manager.completed.has(targetId)) return null;

  const def = manager.definitions.get(targetId);
  if (!def) return null;

  manager.completed.add(targetId);

  return {
    id: def.id,
    action: def.action,
  };
}

export function isInteractableCompleted(manager, id) {
  return manager.completed.has(id);
}
