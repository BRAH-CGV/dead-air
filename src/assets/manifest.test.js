import { describe, it, expect } from 'vitest';
import { statSync, readdirSync, readFileSync, openSync, readSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ASSETS, PRELOAD, validateManifest } from './manifest.js';
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

  it('preloads the models the vegetation belt draws on every load', () => {
    // These lived in LIBRARY, which is fetched on demand — so assets.get()
    // came back empty during build and the belt grew grass and no trees at
    // all. Nothing failed loudly; the trees were simply absent.
    // The scrub is built rather than loaded, so it has no key here.
    for (const key of ['model:tree-birch', 'model:tree-pine', 'model:tree-dead']) {
      expect(PRELOAD, key).toContain(key);
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

  it('knows audio: a sound under assets/audio/ is a clean entry, and gets no physics', () => {
    expect(validateManifest({
      'sfx:door': { type: 'audio', url: 'assets/audio/door.wav' },
      'amb:wind': { type: 'audio', url: 'assets/audio/wind.wav' },
    })).toEqual([]);
    expect(validateManifest({
      'sfx:door': { type: 'audio', url: 'assets/audio/door.wav', physics: 'static' },
    })).toContainEqual(expect.stringContaining("only models can have 'physics'"));
  });

  it("the base's two ambience beds are the team's recordings, as .mp3 files", () => {
    for (const key of ['amb:base-interior', 'amb:outside-wind']) {
      expect(ASSETS[key], key).toEqual({ type: 'audio', url: `assets/audio/${key.slice(4)}.mp3` });
      expect(statSync(new URL(`../../public/${ASSETS[key].url}`, import.meta.url)).size, key).toBeGreaterThan(0);
    }
    // The outside recording replaced the synthesised wind.
    expect(ASSETS['amb:wind']).toBeUndefined();
  });

  it('preloads every sound, and keeps them under the 10 MB download budget', () => {
    const audio = Object.entries(ASSETS).filter(([, e]) => e.type === 'audio');
    expect(audio.length).toBeGreaterThan(0);
    let bytes = 0;
    for (const [key, entry] of audio) {
      expect(PRELOAD, key).toContain(key);
      expect(entry.url, key).toMatch(/^assets\/audio\//);
      bytes += statSync(new URL(`../../public/${entry.url}`, import.meta.url)).size;
    }
    expect(bytes).toBeLessThan(10 * 1024 * 1024);
  });

  it('has no validation problems', () => {
    expect(validateManifest(ASSETS)).toEqual([]);
  });
});

// Everything under public/ ships in the Moodle zip, so a file nothing loads
// is dead weight in it. Sources kept for later (unused models, the monster
// downloads) live in source-assets/ instead.
describe('what ships in public/', () => {
  const PUBLIC = new URL('../../public/', import.meta.url);
  /** Every file under public/, as a url relative to it. */
  const shipped = readdirSync(PUBLIC, { recursive: true, withFileTypes: true })
    .filter(d => d.isFile())
    .map(d => `${d.parentPath ?? d.path}/${d.name}`.replaceAll('\\', '/').split('/public/').pop());
  /** Loaded by path rather than by key: the signal images, numbered. */
  const LOADED_BY_PATH = /^assets\/signals\/signal-\d+\.png$/;

  it('is only what the game loads: every file is a manifest url or a signal image', () => {
    const urls = new Set(Object.values(ASSETS).map(e => e.url));
    expect(shipped.length).toBeGreaterThan(0);
    const unused = shipped.filter(f => !urls.has(f) && !LOADED_BY_PATH.test(f));
    expect(unused).toEqual([]);
  });

  // The Linux server is case-sensitive and Windows isn't: a url that differs
  // from its file only in case loads here and 404s there. `shipped` is the
  // real directory listing, so this compares exact names.
  it('has a file for every manifest url, spelt with the same case', () => {
    const files = new Set(shipped);
    const missing = Object.values(ASSETS).map(e => e.url).filter(url => !files.has(url));
    expect(missing).toEqual([]);
  });

  // It hashes all of public/ (~100 MB): a fraction of a second once the disk
  // cache is warm, but past the default 5 s on a cold first run.
  it('holds no two identical files', { timeout: 30_000 }, () => {
    const seen = new Map();
    const duplicates = [];
    for (const file of shipped) {
      const hash = createHash('sha1').update(readFileSync(new URL(file, PUBLIC))).digest('hex');
      if (seen.has(hash)) duplicates.push(`${file} = ${seen.get(hash)}`);
      else seen.set(hash, file);
    }
    expect(duplicates).toEqual([]);
  });

  // The credits screen is built from ATTRIBUTIONS.md, so it has to name what
  // actually ships — not the candidate link someone meant to download.
  describe('ATTRIBUTIONS.md', () => {
    const doc = readFileSync(new URL('../../ATTRIBUTIONS.md', import.meta.url), 'utf8');
    /** Every `public/…` file the doc names, as a pattern — `*` is a wildcard. */
    const named = [...doc.matchAll(/`public\/([^`]+\.[a-z0-9]+)`/g)].map(m => m[1]);
    const matches = (pattern, file) =>
      new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[^/]*')}$`).test(file);
    /** The `### ` section that names `file` by its exact path. */
    const sectionFor = file => doc.split(/^### /m).filter(s => s.includes(`\`public/${file}\``));
    /** A .glb's asset block: Sketchfab writes the download's source into its
     *  extras. Only the JSON chunk is read — the header says how long it is. */
    const glbAsset = file => {
      const fd = openSync(new URL(file, PUBLIC));
      try {
        const header = Buffer.alloc(20);
        readSync(fd, header, 0, 20, 0);
        const json = Buffer.alloc(header.readUInt32LE(12));
        readSync(fd, json, 0, json.length, 20);
        return JSON.parse(json.toString()).asset ?? {};
      } finally {
        closeSync(fd);
      }
    };

    it('names every shipped file, except the synthesised .wav sounds', () => {
      const unnamed = shipped.filter(f => !f.endsWith('.wav') && !named.some(p => matches(p, f)));
      expect(unnamed).toEqual([]);
    });

    it('names no file that does not ship', () => {
      const stale = named.filter(p => !shipped.some(f => matches(p, f)));
      expect(stale).toEqual([]);
    });

    it("credits each Sketchfab download with the source, author and licence its own file records", () => {
      const wrong = [];
      for (const file of shipped.filter(f => f.endsWith('.glb'))) {
        const extras = glbAsset(file).extras;
        if (!extras?.source) continue;
        const sections = sectionFor(file);
        const author = extras.author.replace(/\s*\(https?:[^)]*\)$/, '');
        const licence = extras.license.match(/\((https?:[^)]+)\)/)[1];
        if (sections.length !== 1) { wrong.push(`${file}: ${sections.length} entries`); continue; }
        for (const [what, text] of [['source', extras.source], ['author', author], ['licence', licence]]) {
          if (!sections[0].includes(text)) wrong.push(`${file}: ${what} ${text}`);
        }
      }
      expect(wrong).toEqual([]);
    });
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
