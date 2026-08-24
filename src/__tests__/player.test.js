import { describe, it, expect } from 'vitest';
import { createPlayer, updatePlayer, damagePlayer, killPlayer, respawnPlayer } from '../player.js';

describe('player', () => {
  describe('createPlayer', () => {
    it('creates a player at the default position', () => {
      const player = createPlayer();
      expect(player.position.x).toBe(0);
      expect(player.position.y).toBe(0);
      expect(player.position.z).toBe(0);
    });

    it('creates a player at a custom position', () => {
      const player = createPlayer({ x: 5, y: 10, z: -3 });
      expect(player.position.x).toBe(5);
      expect(player.position.y).toBe(10);
      expect(player.position.z).toBe(-3);
    });

    it('starts with alive state', () => {
      const player = createPlayer();
      expect(player.state).toBe('alive');
    });

    it('starts with zero velocity', () => {
      const player = createPlayer();
      expect(player.velocity.x).toBe(0);
      expect(player.velocity.y).toBe(0);
      expect(player.velocity.z).toBe(0);
    });

    it('has default yaw and pitch of 0', () => {
      const player = createPlayer();
      expect(player.yaw).toBe(0);
      expect(player.pitch).toBe(0);
    });
  });

  describe('updatePlayer', () => {
    it('applies movement direction to position based on speed and dt', () => {
      const player = createPlayer();
      const input = { x: 0, z: -1 }; // forward (W key sends -Z, camera looks down -Z)
      updatePlayer(player, input, 1.0); // 1 second
      // player should have moved forward (negative z) by speed * dt
      expect(player.position.z).toBeLessThan(0);
    });

    it('applies gravity when not on ground', () => {
      const player = createPlayer({ x: 0, y: 5, z: 0 });
      const input = { x: 0, z: 0 };
      updatePlayer(player, input, 0.1);
      // gravity should pull velocity.y negative
      expect(player.velocity.y).toBeLessThan(0);
    });

    it('stops falling at ground level (y=0)', () => {
      const player = createPlayer({ x: 0, y: 0.01, z: 0 });
      const input = { x: 0, z: 0 };
      // simulate enough frames to hit ground
      for (let i = 0; i < 100; i++) {
        updatePlayer(player, input, 0.016);
      }
      expect(player.position.y).toBe(0);
      expect(player.velocity.y).toBe(0);
    });

    it('does not move when state is not alive', () => {
      const player = createPlayer();
      player.state = 'stunned';
      const posBefore = { ...player.position };
      updatePlayer(player, { x: 1, z: 0 }, 0.1);
      expect(player.position.x).toBe(posBefore.x);
      expect(player.position.z).toBe(posBefore.z);
    });

    it('rotates yaw based on mouse delta X', () => {
      const player = createPlayer();
      const input = { x: 0, z: 0, mouseDeltaX: 0.5 };
      updatePlayer(player, input, 0.016);
      expect(player.yaw).not.toBe(0);
    });

    it('rotates pitch based on mouse delta Y', () => {
      const player = createPlayer();
      const input = { x: 0, z: 0, mouseDeltaY: 0.3 };
      updatePlayer(player, input, 0.016);
      expect(player.pitch).not.toBe(0);
    });

    it('clamps pitch to prevent over-rotation', () => {
      const player = createPlayer();
      const input = { x: 0, z: 0, mouseDeltaY: 100 };
      // simulate many frames of looking up
      for (let i = 0; i < 200; i++) {
        updatePlayer(player, input, 0.016);
      }
      // pitch should be clamped (not exceed ~PI/2)
      expect(Math.abs(player.pitch)).toBeLessThanOrEqual(Math.PI / 2 + 0.01);
    });
  });

  describe('damagePlayer', () => {
    it('reduces health', () => {
      const player = createPlayer();
      const maxHealth = player.health;
      damagePlayer(player, 20);
      expect(player.health).toBe(maxHealth - 20);
    });

    it('does not reduce health below 0', () => {
      const player = createPlayer();
      damagePlayer(player, 9999);
      expect(player.health).toBe(0);
    });

    it('sets state to dead when health reaches 0', () => {
      const player = createPlayer();
      damagePlayer(player, 9999);
      expect(player.state).toBe('dead');
    });
  });

  describe('killPlayer', () => {
    it('sets health to 0 and state to dead', () => {
      const player = createPlayer();
      killPlayer(player);
      expect(player.health).toBe(0);
      expect(player.state).toBe('dead');
    });
  });

  describe('respawnPlayer', () => {
    it('resets health, state, position, and velocity', () => {
      const player = createPlayer();
      killPlayer(player);
      respawnPlayer(player);
      expect(player.state).toBe('alive');
      expect(player.health).toBe(100);
      expect(player.position.x).toBe(0);
      expect(player.position.y).toBe(0);
      expect(player.position.z).toBe(0);
      expect(player.velocity.x).toBe(0);
      expect(player.velocity.y).toBe(0);
      expect(player.velocity.z).toBe(0);
    });
  });
});
