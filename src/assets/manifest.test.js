import { describe, it, expect } from 'vitest';
import { ASSETS, validateManifest } from './manifest.js';
import { resolveShape } from '../core/ColliderSpec.js';

/** Full spawn scale used for 'model:retro-computer' in MainOffice/OfficeScene
 *  — this model has no manifest-level `scale`, so its measured bounds (and
 *  any hand-written shape) are in the .glb's native (~100-wide) space and
 *  only become world metres once this is applied. */
const DESK_SPAWN_SCALE = 0.016;

/** Is `point` (world metres, desk-local origin) inside an axis-aligned cuboid part? */
function pointInBox(point, part) {
  return part.kind === 'cuboid'
    && Math.abs(point[0] - part.position[0]) <= part.halfExtents[0]
    && Math.abs(point[1] - part.position[1]) <= part.halfExtents[1]
    && Math.abs(point[2] - part.position[2]) <= part.halfExtents[2];
}

describe('manifest', () => {
  it('names every file after its key, so either one gives you the other', () => {
    for (const [key, entry] of Object.entries(ASSETS)) {
      const base = entry.url.split('/').pop().replace(/\.[a-z0-9]+$/i, '');
      expect(base, key).toBe(key.slice(key.indexOf(':') + 1));
    }
  });

  it('catches a filename that drifts from its key', () => {
    // The rule is only worth having if it fails loudly.
    expect(validateManifest({
      'model:crate': { type: 'model', url: 'assets/models/crate_v2.glb' },
    })).toContainEqual(expect.stringContaining('filename should match the key'));

    expect(validateManifest({
      'model:trash_bin': { type: 'model', url: 'assets/models/trash_bin.glb' },
    })).toContainEqual(expect.stringContaining('lowercase and hyphen-separated'));
  });

  it('has no validation problems', () => {
    expect(validateManifest(ASSETS)).toEqual([]);
  });
});

describe("model:retro-computer's compound collider (phase 11, AGENTS.md worked example)", () => {
  const parts = () => resolveShape(ASSETS['model:retro-computer'].physics.shape, undefined, DESK_SPAWN_SCALE);

  it('is a hand-written compound, not the tier-1 auto box', () => {
    expect(Array.isArray(ASSETS['model:retro-computer'].physics.shape)).toBe(true);
    expect(parts().length).toBeGreaterThan(1);
  });

  it('a desktop-height crouch point at the desk centre is clear — the kneehole', () => {
    const knee = [0, 0.3, 0];
    for (const part of parts()) expect(pointInBox(knee, part), part.kind).toBe(false);
  });

  // No separate top lid: the back region is tall enough (0.73 m) to stand
  // in for itself, and the kneehole has no ceiling at all — a standing
  // player can walk up to the opening, not just crouch at its edge.
  it('has no ceiling over the kneehole — a standing-height point front and centre is clear', () => {
    const standing = [0, 1.6, 0.2];
    for (const part of parts()) expect(pointInBox(standing, part), part.kind).toBe(false);
  });

  it('nothing reaches above the back region\'s own height (0.735 m) — no full-height back wall either', () => {
    const aboveBack = [0, 1.2, -0.25];
    for (const part of parts()) expect(pointInBox(aboveBack, part), part.kind).toBe(false);
  });

  // The model is a solid cabinet with the kneehole open on one face only
  // (not a table with 4 open sides) — local +Z, the side away from the
  // monitor mesh (measured centred toward -Z). Left, right and the back
  // region are solid; only the front lets the player crouch — or, since
  // there's no lid, walk — in.
  it('is open on the front (+Z) at knee height, all the way to the edge', () => {
    const front = [0, 0.3, 0.35];
    for (const part of parts()) expect(pointInBox(front, part), part.kind).toBe(false);
  });

  it('is closed on the back (-Z), left (-X) and right (+X) at knee height', () => {
    const closed = [[0, 0.3, -0.38], [-0.78, 0.3, 0], [0.78, 0.3, 0]];
    for (const point of closed) {
      expect(parts().some(part => pointInBox(point, part)), point.join(',')).toBe(true);
    }
  });
});
