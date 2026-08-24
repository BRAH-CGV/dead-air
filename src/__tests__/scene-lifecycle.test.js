import { describe, it, expect } from 'vitest';
import { createDisposeManager, trackObject, disposeAll } from '../utils/dispose.js';

describe('scene lifecycle / dispose', () => {
  describe('createDisposeManager', () => {
    it('creates a manager with empty tracking lists', () => {
      const mgr = createDisposeManager();
      expect(mgr.geometries).toHaveLength(0);
      expect(mgr.materials).toHaveLength(0);
      expect(mgr.textures).toHaveLength(0);
    });
  });

  describe('trackObject', () => {
    it('tracks a mesh with geometry and material', () => {
      const mgr = createDisposeManager();
      const geo = { dispose: () => {} };
      const mat = { dispose: () => {} };
      const mesh = { geometry: geo, material: mat };
      trackObject(mgr, mesh);
      expect(mgr.geometries).toHaveLength(1);
      expect(mgr.materials).toHaveLength(1);
    });

    it('tracks a mesh with an array of materials', () => {
      const mgr = createDisposeManager();
      const geo = { dispose: () => {} };
      const mats = [{ dispose: () => {} }, { dispose: () => {} }];
      const mesh = { geometry: geo, material: mats };
      trackObject(mgr, mesh);
      expect(mgr.geometries).toHaveLength(1);
      expect(mgr.materials).toHaveLength(2);
    });

    it('tracks textures from materials', () => {
      const mgr = createDisposeManager();
      const geo = { dispose: () => {} };
      const tex = { dispose: () => {} };
      const mat = { dispose: () => {}, map: tex };
      const mesh = { geometry: geo, material: mat };
      trackObject(mgr, mesh);
      expect(mgr.textures).toHaveLength(1);
    });
  });

  describe('disposeAll', () => {
    it('calls dispose on all tracked resources', () => {
      const mgr = createDisposeManager();
      let geoDisposed = false;
      let matDisposed = false;
      let texDisposed = false;

      const geo = { dispose: () => { geoDisposed = true; } };
      const mat = { dispose: () => { matDisposed = true; } };
      const tex = { dispose: () => { texDisposed = true; } };
      const mesh = { geometry: geo, material: { ...mat, map: tex } };

      trackObject(mgr, mesh);
      disposeAll(mgr);

      expect(geoDisposed).toBe(true);
      expect(matDisposed).toBe(true);
      expect(texDisposed).toBe(true);
    });

    it('clears tracking lists after disposal', () => {
      const mgr = createDisposeManager();
      const geo = { dispose: () => {} };
      const mat = { dispose: () => {} };
      trackObject(mgr, { geometry: geo, material: mat });

      disposeAll(mgr);
      expect(mgr.geometries).toHaveLength(0);
      expect(mgr.materials).toHaveLength(0);
    });
  });
});
