/**
 * Input state management — tracks keyboard, mouse, touch, and drag state.
 * Pure logic, no DOM dependency.
 */

const MOVEMENT_KEYS = {
  KeyW: { x: 0, z: -1 },  // forward (camera looks down -Z)
  KeyS: { x: 0, z: 1 },   // backward
  KeyA: { x: -1, z: 0 },  // left
  KeyD: { x: 1, z: 0 },   // right
};

export function createInputState() {
  return {
    keys: new Set(),
    mouseDeltaX: 0,
    mouseDeltaY: 0,
    isPointerLocked: false,
    isDragging: false,
  };
}

export function setKeyPressed(state, code, pressed) {
  if (pressed) {
    state.keys.add(code);
  } else {
    state.keys.delete(code);
  }
}

export function getMovementDirection(state) {
  let x = 0;
  let z = 0;

  for (const code of state.keys) {
    const dir = MOVEMENT_KEYS[code];
    if (dir) {
      x += dir.x;
      z += dir.z;
    }
  }

  // normalize diagonal movement
  const len = Math.sqrt(x * x + z * z);
  if (len > 0) {
    x /= len;
    z /= len;
  }

  return { x, z };
}

export function resetInputState(state) {
  state.keys.clear();
  state.mouseDeltaX = 0;
  state.mouseDeltaY = 0;
  state.isDragging = false;
}

export function setDragActive(state, active) {
  state.isDragging = active;
}

export function accumulateDragDelta(state, deltaX, deltaY) {
  if (!state.isDragging) return;
  state.mouseDeltaX += deltaX;
  state.mouseDeltaY += deltaY;
}
