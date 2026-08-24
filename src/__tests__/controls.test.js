import { describe, it, expect } from 'vitest';
import { createInputState, setKeyPressed, getMovementDirection, resetInputState } from '../controls.js';

describe('controls', () => {
  describe('createInputState', () => {
    it('creates an input state with no keys pressed', () => {
      const state = createInputState();
      expect(state.keys.size).toBe(0);
      expect(state.mouseDeltaX).toBe(0);
      expect(state.mouseDeltaY).toBe(0);
      expect(state.isPointerLocked).toBe(false);
    });
  });

  describe('setKeyPressed', () => {
    it('adds a key to the pressed set when pressed', () => {
      const state = createInputState();
      setKeyPressed(state, 'KeyW', true);
      expect(state.keys.has('KeyW')).toBe(true);
    });

    it('removes a key from the pressed set when released', () => {
      const state = createInputState();
      setKeyPressed(state, 'KeyW', true);
      setKeyPressed(state, 'KeyW', false);
      expect(state.keys.has('KeyW')).toBe(false);
    });

    it('handles multiple simultaneous keys', () => {
      const state = createInputState();
      setKeyPressed(state, 'KeyW', true);
      setKeyPressed(state, 'KeyD', true);
      expect(state.keys.has('KeyW')).toBe(true);
      expect(state.keys.has('KeyD')).toBe(true);
    });
  });

  describe('getMovementDirection', () => {
    it('returns forward (0, -1) when W is pressed', () => {
      const state = createInputState();
      setKeyPressed(state, 'KeyW', true);
      const dir = getMovementDirection(state);
      expect(dir.x).toBe(0);
      expect(dir.z).toBe(-1);
    });

    it('returns backward (0, 1) when S is pressed', () => {
      const state = createInputState();
      setKeyPressed(state, 'KeyS', true);
      const dir = getMovementDirection(state);
      expect(dir.x).toBe(0);
      expect(dir.z).toBe(1);
    });

    it('returns left (-1, 0) when A is pressed', () => {
      const state = createInputState();
      setKeyPressed(state, 'KeyA', true);
      const dir = getMovementDirection(state);
      expect(dir.x).toBe(-1);
      expect(dir.z).toBe(0);
    });

    it('returns right (1, 0) when D is pressed', () => {
      const state = createInputState();
      setKeyPressed(state, 'KeyD', true);
      const dir = getMovementDirection(state);
      expect(dir.x).toBe(1);
      expect(dir.z).toBe(0);
    });

    it('returns zero vector when no movement keys are pressed', () => {
      const state = createInputState();
      const dir = getMovementDirection(state);
      expect(dir.x).toBe(0);
      expect(dir.z).toBe(0);
    });

    it('returns diagonal when W and D are both pressed', () => {
      const state = createInputState();
      setKeyPressed(state, 'KeyW', true);
      setKeyPressed(state, 'KeyD', true);
      const dir = getMovementDirection(state);
      // diagonal should be normalized
      expect(dir.x).toBeGreaterThan(0);
      expect(dir.z).toBeLessThan(0);
      const len = Math.sqrt(dir.x * dir.x + dir.z * dir.z);
      expect(len).toBeCloseTo(1, 5);
    });

    it('cancels out when W and S are both pressed', () => {
      const state = createInputState();
      setKeyPressed(state, 'KeyW', true);
      setKeyPressed(state, 'KeyS', true);
      const dir = getMovementDirection(state);
      expect(dir.x).toBe(0);
      expect(dir.z).toBe(0);
    });
  });

  describe('resetInputState', () => {
    it('clears all keys and mouse deltas', () => {
      const state = createInputState();
      setKeyPressed(state, 'KeyW', true);
      state.mouseDeltaX = 5;
      state.mouseDeltaY = -3;
      resetInputState(state);
      expect(state.keys.size).toBe(0);
      expect(state.mouseDeltaX).toBe(0);
      expect(state.mouseDeltaY).toBe(0);
    });
  });
});
