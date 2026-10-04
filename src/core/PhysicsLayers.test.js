import { describe, it, expect } from 'vitest';
import { Layers, DEFAULT_GROUPS, packGroups, resolveGroups } from './PhysicsLayers.js';

describe('PhysicsLayers', () => {
  describe('Layers constants', () => {
    it('defines DEFAULT as bit 0', () => {
      expect(Layers.DEFAULT).toBe(0);
    });

    it('defines PLAYER as bit 1', () => {
      expect(Layers.PLAYER).toBe(1);
    });

    it('defines SHELF as bit 2', () => {
      expect(Layers.SHELF).toBe(2);
    });

    it('is frozen so layers cannot be added at runtime by accident', () => {
      expect(Object.isFrozen(Layers)).toBe(true);
    });
  });

  describe('DEFAULT_GROUPS', () => {
    it('is 0xFFFFFFFF — member of all, filters all', () => {
      expect(DEFAULT_GROUPS).toBe(0xFFFFFFFF);
    });
  });

  describe('packGroups', () => {
    it('packs a single membership and single filter bit', () => {
      // membership: DEFAULT (bit 0) → 0x0001
      // filter: PLAYER (bit 1) → 0x0002
      // packed: (0x0001 << 16) | 0x0002 = 0x00010002
      expect(packGroups(['DEFAULT'], ['PLAYER'])).toBe(0x00010002);
    });

    it('packs multiple membership and filter bits', () => {
      // membership: DEFAULT | SHELF (bits 0, 2) → 0x0005
      // filter: DEFAULT | PLAYER (bits 0, 1) → 0x0003
      // packed: (0x0005 << 16) | 0x0003 = 0x00050003
      expect(packGroups(['DEFAULT', 'SHELF'], ['DEFAULT', 'PLAYER'])).toBe(0x00050003);
    });

    it('accepts numeric bit indices as well as names', () => {
      expect(packGroups([0], [1])).toBe(packGroups(['DEFAULT'], ['PLAYER']));
    });

    it('returns 0 when no layers are provided', () => {
      expect(packGroups([], [])).toBe(0);
    });

    it('ignores unknown layer names', () => {
      // Only DEFAULT should count
      expect(packGroups(['DEFAULT', 'NONEXISTENT'], ['DEFAULT'])).toBe(packGroups(['DEFAULT'], ['DEFAULT']));
    });
  });

  describe('resolveGroups', () => {
    it('returns DEFAULT_GROUPS when input is null or undefined', () => {
      expect(resolveGroups(null)).toBe(DEFAULT_GROUPS);
      expect(resolveGroups(undefined)).toBe(DEFAULT_GROUPS);
    });

    it('passes through a number unchanged', () => {
      expect(resolveGroups(0x12345678)).toBe(0x12345678);
    });

    it('resolves an object with membership and filter arrays', () => {
      const groups = { membership: ['PLAYER'], filter: ['DEFAULT'] };
      expect(resolveGroups(groups)).toBe(packGroups(['PLAYER'], ['DEFAULT']));
    });

    it('handles missing membership or filter gracefully', () => {
      expect(resolveGroups({ membership: ['PLAYER'] })).toBe(packGroups(['PLAYER'], []));
      expect(resolveGroups({ filter: ['DEFAULT'] })).toBe(packGroups([], ['DEFAULT']));
    });
  });
});
