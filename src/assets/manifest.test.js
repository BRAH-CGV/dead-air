import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ASSETS, PRELOAD, validateManifest } from './manifest.js';
import { resolveShape } from '../core/ColliderSpec.js';
import { packGroups } from '../core/PhysicsLayers.js';

/** Full spawn scale used for 'model:retro-computer' in MainOffice/OfficeScene
 *  — this model has no manifest-level `scale`, so its measured bounds (and
 *  any hand-written shape) are in the .glb's native (~100-wide) space and
 *  only become world metres once this is applied. */
const DESK_SPAWN_SCALE = 0.016;

/** Is `point` (world metres, desk-local origin) inside a cuboid part, turned or not? */
function pointInBox(point, part) {
  if (part.kind !== 'cuboid') return false;
  const local = new THREE.Vector3(...point).sub(new THREE.Vector3(...part.position))
    .applyQuaternion(new THREE.Quaternion(...part.rotation).invert());
  return Math.abs(local.x) <= part.halfExtents[0]
    && Math.abs(local.y) <= part.halfExtents[1]
    && Math.abs(local.z) <= part.halfExtents[2];
}

describe('manifest', () => {
  it('names every file after its key, so either one gives you the other', () => {
    for (const [key, entry] of Object.entries(ASSETS)) {
      const base = entry.url.split('/').pop().replace(/\.[a-z0-9]+$/i, '');
      expect(base, key).toBe(key.slice(key.indexOf(':') + 1));
    }
  });

  it('preloads the models the vegetation belt draws on every load', () => {
    // These lived in LIBRARY, which is fetched on demand — so assets.get()
    // came back empty during build and the belt grew grass and no trees at
    // all. Nothing failed loudly; the trees were simply absent.
    for (const key of ['model:tree-birch', 'model:tree-pine', 'model:tree-fantasy', 'model:tree-dead']) {
      expect(PRELOAD, key).toContain(key);
    }
  });

  it('preloads the grow rack\'s UV fixture, which the office builds from the cache', () => {
    expect(PRELOAD).toContain('model:light-ceiling');
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

  it('accepts audio entries, and keeps the mask breathing loop under assets/audio/', () => {
    expect(validateManifest({
      'sfx:hum': { type: 'audio', url: 'assets/audio/hum.mp3' },
    })).toEqual([]);
    expect(ASSETS['sfx:mask-breathing']).toMatchObject({
      type: 'audio', url: 'assets/audio/mask-breathing.mp3',
    });
  });

  it('keeps the ambience loops out of the preload, so they never hold the loading screen', () => {
    // ~10 MB of mp3 between them. Ambience fetches them once the scene is
    // up and fades each in as it arrives.
    const keys = [
      'sfx:interior-base-ambience-bed-room',
      'sfx:interior-base-ambience-centre-room',
      'sfx:interior-base-ambience-server-room',
      'sfx:interior-base-spooky-music',
      'sfx:interior-base-ambient-music',
      'sfx:exterior-base-ambience-wind',
    ];
    for (const key of keys) {
      expect(ASSETS[key], key).toMatchObject({ type: 'audio' });
      expect(PRELOAD, key).not.toContain(key);
    }
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

  // The kneehole has no ceiling at all where the top is open — a standing
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

  // #76: items set on the desk sank into it or fell through. The parts
  // stopped at 0.73 m, under a top drawn at 0.75–0.86 m, and 14 cm short
  // of the keyboard tray's front edge, so the tray's front and the 45°
  // corners where it meets each pillar had nothing under them. Read off
  // retro-computer.glb, desk-local metres (the right side; the left
  // mirrors it):
  //
  //   pillar tops and the shelf behind the tray   0.864
  //   monitor                                     1.00 at the back … 1.10 at the screen
  //   keyboard tray, z −0.16 … 0.08               0.75–0.78
  //   its front corner, 45°                       (0.40, 0.08) → (0.48, 0.16)
  //   rim beside the well, x 0.48 … 0.55          0.75, rising to the pillar
  //
  // In front of the tray, between the rims, the well is open from above
  // to the floor: that is the kneehole, and nothing may cover it.
  describe('the top, where it is drawn (#76)', () => {
    const solid = point => parts().some(part => pointInBox(point, part));
    const both = ([x, y, z]) => [[x, y, z], [-x, y, z]];

    it('is solid just under the drawn top: the tray to its front edge, its corners, the rims, the pillars, the shelf and the monitor', () => {
      const underTop = [
        [0, 0.74, -0.1], [0, 0.74, 0.06],          // the tray, middle and front edge
        ...both([0.3, 0.74, 0.06]),
        ...both([0.45, 0.74, 0.1]),                 // the 45° corner, 2 cm inside its edge
        ...both([0.5, 0.74, 0.25]),                 // the rim beside the well
        ...both([0.65, 0.85, 0.3]),                 // the pillar tops
        ...both([0.4, 0.85, -0.3]),                 // the shelf behind the tray
        [0, 1.0, -0.3],                             // the monitor
      ];
      for (const point of underTop) expect(solid(point), point.join(',')).toBe(true);
    });

    it('is open over the well in front of the tray — no invisible surface where the player stands', () => {
      const overWell = [
        [0, 0.12], [0, 0.25], [0, 0.38],
        [0.3, 0.3], [-0.3, 0.3],
        [0.43, 0.2], [-0.43, 0.2],                  // just inside the rim
        [0.4, 0.12], [-0.4, 0.12],                  // just off the 45° corner
      ];
      for (const [x, z] of overWell) {
        for (const y of [0.6, 0.72, 0.76, 0.9]) expect(solid([x, y, z]), [x, y, z].join(',')).toBe(false);
      }
    });

    it('leaves a crouch under the tray: nothing new below 0.72 m', () => {
      for (const point of [[0, 0.7, 0], [0, 0.7, 0.06], ...both([0.3, 0.7, 0.05]), ...both([0.45, 0.7, 0.12])]) {
        expect(solid(point), point.join(',')).toBe(false);
      }
    });

    it('is the desk, solid to everything — drives, drive boxes and the player alike', () => {
      const interacts = (a, b) => ((a >>> 16) & (b & 0xFFFF)) !== 0 && ((b >>> 16) & (a & 0xFFFF)) !== 0;
      const PLAYER = packGroups(['PLAYER'], ['DEFAULT', 'PLAYER']);   // Engine.buildPlayer
      const DRIVE  = packGroups(['SHELF'], ['DEFAULT', 'SHELF']);     // Drive.js
      const BOX    = packGroups(['DEFAULT'], ['DEFAULT', 'SHELF']);   // DriveBox.js
      for (const part of parts()) {
        for (const body of [PLAYER, DRIVE, BOX]) expect(interacts(part.collisionGroups, body)).toBe(true);
      }
    });

    it('stays under the drive reader on the right pillar, so the interact ray still reaches it', () => {
      // MainOffice's DriveReader: 3 cm tall, its base at 0.86 m, x 0.59 … 0.71, z 0.215 … 0.365.
      for (const point of [[0.65, 0.865, 0.29], [0.6, 0.865, 0.36]]) expect(solid(point), point.join(',')).toBe(false);
    });
  });

  it('is closed on the back (-Z), left (-X) and right (+X) at knee height', () => {
    const closed = [[0, 0.3, -0.38], [-0.78, 0.3, 0], [0.78, 0.3, 0]];
    for (const point of closed) {
      expect(parts().some(part => pointInBox(point, part)), point.join(',')).toBe(true);
    }
  });
});
