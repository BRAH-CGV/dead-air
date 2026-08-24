import { describe, it, expect } from 'vitest';
import { createLevel1Definition } from '../levels/level1.js';

describe('level1', () => {
  const level = createLevel1Definition();

  describe('level definition structure', () => {
    it('returns an object with required sections', () => {
      expect(level).toHaveProperty('name');
      expect(level).toHaveProperty('objects');
      expect(level).toHaveProperty('lights');
      expect(level).toHaveProperty('interactables');
      expect(level).toHaveProperty('spawnPoint');
      expect(level).toHaveProperty('terrain');
      expect(level).toHaveProperty('skybox');
    });

    it('has a level name', () => {
      expect(level.name).toBe('Fix & Barricade');
    });
  });

  describe('terrain', () => {
    it('defines a ground plane', () => {
      expect(level.terrain).toBeDefined();
      expect(level.terrain.size).toBeGreaterThan(0);
    });

    it('has a colour for the terrain', () => {
      expect(level.terrain.color).toBeDefined();
    });
  });

  describe('skybox', () => {
    it('defines a skybox colour', () => {
      expect(level.skybox).toBeDefined();
      expect(level.skybox.color).toBeDefined();
    });
  });

  describe('building structure', () => {
    it('contains building objects (walls, floor, ceiling)', () => {
      const buildingParts = level.objects.filter(o => o.group === 'building');
      expect(buildingParts.length).toBeGreaterThanOrEqual(4); // floor, ceiling, at least 2 walls
    });

    it('building parts have position and size', () => {
      const buildingParts = level.objects.filter(o => o.group === 'building');
      for (const part of buildingParts) {
        expect(part.position).toBeDefined();
        expect(part.position.x).toBeDefined();
        expect(part.position.y).toBeDefined();
        expect(part.position.z).toBeDefined();
        expect(part.size).toBeDefined();
        expect(part.size.x).toBeGreaterThan(0);
        expect(part.size.y).toBeGreaterThan(0);
        expect(part.size.z).toBeGreaterThan(0);
      }
    });
  });

  describe('door', () => {
    it('has a door object in the building', () => {
      const door = level.objects.find(o => o.id === 'door');
      expect(door).toBeDefined();
      expect(door.group).toBe('building');
    });

    it('door is listed as interactable', () => {
      const doorInteractable = level.interactables.find(i => i.id === 'door');
      expect(doorInteractable).toBeDefined();
      expect(doorInteractable.action).toBe('barricade');
    });
  });

  describe('signal receiver', () => {
    it('has a signal receiver object', () => {
      const receiver = level.objects.find(o => o.id === 'signal-receiver');
      expect(receiver).toBeDefined();
    });

    it('signal receiver is listed as interactable', () => {
      const receiverInteractable = level.interactables.find(i => i.id === 'signal-receiver');
      expect(receiverInteractable).toBeDefined();
      expect(receiverInteractable.action).toBe('use');
    });
  });

  describe('lighting', () => {
    it('has multiple light sources', () => {
      expect(level.lights.length).toBeGreaterThanOrEqual(2);
    });

    it('includes an ambient light', () => {
      const ambient = level.lights.find(l => l.type === 'ambient');
      expect(ambient).toBeDefined();
    });

    it('includes at least one point or spot light', () => {
      const dynamic = level.lights.find(l => l.type === 'point' || l.type === 'spot');
      expect(dynamic).toBeDefined();
    });

    it('all lights have position (except ambient)', () => {
      for (const light of level.lights) {
        if (light.type !== 'ambient') {
          expect(light.position).toBeDefined();
        }
      }
    });
  });

  describe('spawn point', () => {
    it('defines a spawn point inside or near the building', () => {
      expect(level.spawnPoint).toBeDefined();
      expect(level.spawnPoint.x).toBeDefined();
      expect(level.spawnPoint.y).toBeDefined();
      expect(level.spawnPoint.z).toBeDefined();
    });
  });

  describe('win conditions', () => {
    it('defines objectives for the level', () => {
      expect(level.objectives).toBeDefined();
      expect(level.objectives.length).toBeGreaterThanOrEqual(2);
    });

    it('has barricade and signal objectives', () => {
      const objIds = level.objectives.map(o => o.id);
      expect(objIds).toContain('barricade-door');
      expect(objIds).toContain('use-signal-receiver');
    });
  });
});
