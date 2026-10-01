import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { OcclusionZones } from './OcclusionZones.js';

// ─────────────────────────────────────────────
// OcclusionZones  –  named sets of objects shown and hidden together
// ─────────────────────────────────────────────

/** A renderer stand-in whose compileAsync resolves when the test says so. */
function fakeRenderer() {
  const pending = [];
  return {
    compileAsync: vi.fn(() => new Promise(resolve => pending.push(resolve))),
    finishCompiles: () => { while (pending.length) pending.shift()(); },
  };
}

function setup({ renderer = fakeRenderer(), framesToReady = 2 } = {}) {
  const zones = new OcclusionZones({ renderer, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), framesToReady });
  const desk = new THREE.Mesh();
  const shelf = new THREE.Mesh();
  const buggy = new THREE.Mesh();
  zones.add('interior', [desk, shelf]);
  zones.add('yard', [buggy]);
  return { zones, renderer, desk, shelf, buggy };
}

/** Let compile promises settle. */
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('OcclusionZones', () => {
  it('starts with every zone visible — nothing is hidden until someone decides', () => {
    const { zones, desk, buggy } = setup();
    expect(zones.isVisible('interior')).toBe(true);
    expect(zones.isVisible('yard')).toBe(true);
    expect(desk.visible && buggy.visible).toBe(true);
  });

  it('hide() and show() flip every object in the zone, and only that zone', () => {
    const { zones, desk, shelf, buggy } = setup();
    zones.hide('interior');
    expect([desk.visible, shelf.visible, buggy.visible]).toEqual([false, false, true]);
    zones.show('interior');
    expect([desk.visible, shelf.visible]).toEqual([true, true]);
  });

  it('add() appends to an existing zone', () => {
    const { zones } = setup();
    const extra = new THREE.Mesh();
    zones.add('yard', [extra]);
    zones.hide('yard');
    expect(extra.visible).toBe(false);
  });

  it('tells listeners when a zone actually changes — shadows hang off this', () => {
    const { zones } = setup();
    const listener = vi.fn();
    zones.onChange(listener);
    zones.hide('yard');
    zones.hide('yard');              // already hidden
    zones.show('yard');
    expect(listener.mock.calls).toEqual([['yard', false], ['yard', true]]);
  });

  describe('readiness — a door only opens onto a side that is ready', () => {
    it('a hidden zone is never ready', async () => {
      const { zones, renderer } = setup();
      zones.hide('yard');
      renderer.finishCompiles();
      await flush();
      zones.tick(); zones.tick(); zones.tick();
      expect(zones.isReady('yard')).toBe(false);
    });

    it('a shown zone is ready once its shaders are compiled and it has been drawn for a few frames', async () => {
      const { zones, renderer, buggy } = setup({ framesToReady: 2 });
      zones.hide('yard');
      zones.show('yard');
      expect(renderer.compileAsync).toHaveBeenCalledWith(buggy, expect.any(THREE.Camera), expect.any(THREE.Scene));
      expect(zones.isReady('yard')).toBe(false);

      zones.tick(); zones.tick();
      expect(zones.isReady('yard')).toBe(false);     // drawn, but still compiling

      renderer.finishCompiles();
      await flush();
      zones.tick();
      expect(zones.isReady('yard')).toBe(true);
    });

    it('needs the frames after the compile too, not just before it', async () => {
      const { zones, renderer } = setup({ framesToReady: 2 });
      zones.hide('yard');
      zones.show('yard');
      renderer.finishCompiles();
      await flush();
      zones.tick();
      expect(zones.isReady('yard')).toBe(false);
      zones.tick();
      expect(zones.isReady('yard')).toBe(true);
    });

    it('waits for anything still loading for the zone', async () => {
      const { zones, renderer } = setup({ framesToReady: 1 });
      let finishLoad;
      zones.waitFor('yard', new Promise(resolve => { finishLoad = resolve; }));
      zones.hide('yard');
      zones.show('yard');
      renderer.finishCompiles();
      await flush();
      zones.tick(); zones.tick();
      expect(zones.isReady('yard')).toBe(false);

      finishLoad();
      await flush();
      zones.tick();
      expect(zones.isReady('yard')).toBe(true);
    });

    it('works with no renderer at all (headless): ready after the frames', () => {
      const zones = new OcclusionZones({ framesToReady: 1 });
      zones.add('yard', [new THREE.Mesh()]);
      zones.hide('yard');
      zones.show('yard');
      zones.tick();
      expect(zones.isReady('yard')).toBe(true);
    });

    it('a zone visible from the start is ready from the start — the boot warm-up drew it', () => {
      const { zones } = setup();
      expect(zones.isReady('interior')).toBe(true);
    });
  });

  describe('revealAll — the debug camera and editor need to see everything', () => {
    it('shows every zone while on, and puts back what was hidden when off', () => {
      const { zones, desk, buggy } = setup();
      zones.hide('yard');
      zones.revealAll(true);
      expect(buggy.visible).toBe(true);
      expect(zones.isVisible('yard')).toBe(false);    // the decision stands underneath

      zones.revealAll(false);
      expect(buggy.visible).toBe(false);
      expect(desk.visible).toBe(true);
    });

    it('decisions made while revealed land when the reveal ends', () => {
      const { zones, desk } = setup();
      zones.revealAll(true);
      zones.hide('interior');
      expect(desk.visible).toBe(true);
      zones.revealAll(false);
      expect(desk.visible).toBe(false);
    });
  });

  it('dispose() shows everything again and forgets the zones', () => {
    const { zones, buggy } = setup();
    zones.hide('yard');
    zones.dispose();
    expect(buggy.visible).toBe(true);
    expect(zones.names()).toEqual([]);
  });
});
