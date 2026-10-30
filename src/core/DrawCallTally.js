// ─────────────────────────────────────────────
// DrawCallTally  –  one frame's draw calls, by pass and by what drew them
// ─────────────────────────────────────────────
// The console's `drawcalls`. `perf` gives a total; this says where it comes
// from. three sends every draw through renderer.renderBufferDirect — the
// main pass with the scene, a shadow map with null for the scene — so the
// tally wraps it for the length of one frame and puts it back after.
//
// What drew it is the object's path below the scene, a few levels deep, so
// a room's props add up under the room; the base's own wrapper (SceneRoot)
// is left out. A split instanced mesh's parts ('MarsGrass:always#3/1') are
// counted under their mesh ('MarsGrass'); a room keeps its name ('Room:MainOffice'). rollUp adds the lines up a level
// or two, for a list short enough to read in game.
// ─────────────────────────────────────────────

/** Levels below the scene a draw is filed under. */
const DEPTH = 3;
/** Nodes that only wrap a scene, left out of a path. */
const WRAPPERS = new Set(['SceneRoot']);

/**
 * Run `draw` (a frame) with every draw call counted.
 * @param {{ renderBufferDirect: Function, getRenderTarget: () => any }} renderer
 * @param {() => void} draw
 * @returns {{ passes: { main: number, shadow: number, screen: number }, by: Map<string, number> }}
 *          `by` is keyed `pass\tpath`.
 */
export function tallyDrawCalls(renderer, draw) {
  const passes = { main: 0, shadow: 0, screen: 0 };
  const by = new Map();
  const original = renderer.renderBufferDirect;
  renderer.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    const pass = scene === null ? 'shadow' : renderer.getRenderTarget() ? 'screen' : 'main';
    passes[pass]++;
    const key = `${pass}\t${pathOf(object)}`;
    by.set(key, (by.get(key) ?? 0) + 1);
    return original.call(this, camera, scene, geometry, material, object, group);
  };
  try {
    draw();
  } finally {
    renderer.renderBufferDirect = original;
  }
  return { passes, by };
}

/**
 * The tally as console lines: the totals, then the heaviest `limit` lines.
 * @param {{ passes: { main: number, shadow: number, screen: number }, by: Map<string, number> }} tally
 * @param {number} [limit]
 * @returns {string[]}
 */
export function formatTally({ passes, by }, limit = Infinity) {
  const total = passes.main + passes.shadow + passes.screen;
  const rows = [...by].sort((a, b) => b[1] - a[1]);
  const lines = [`${total} draw calls: main ${passes.main}, shadow maps ${passes.shadow}, screen passes ${passes.screen}`];
  for (const [key, count] of rows.slice(0, limit)) {
    const [pass, path] = key.split('\t');
    lines.push(`${String(count).padStart(3)}  ${pass.padEnd(6)}  ${path}`);
  }
  if (rows.length > limit) lines.push(`  … ${rows.length - limit} more lines`);
  return lines;
}

/**
 * The tally with each path cut to its first `depth` levels, the lines that
 * then share a pass and a path added together.
 * @param {{ passes: object, by: Map<string, number> }} tally
 * @param {number} depth
 */
export function rollUp({ passes, by }, depth) {
  const up = new Map();
  for (const [key, count] of by) {
    const [pass, path] = key.split('\t');
    const short = `${pass}\t${path.split('/').slice(0, depth).join('/')}`;
    up.set(short, (up.get(short) ?? 0) + count);
  }
  return { passes, by: up };
}

function pathOf(object) {
  const names = [];
  for (let o = object; o?.parent; o = o.parent) {
    if (WRAPPERS.has(o.name) && !o.parent.parent) continue;
    const name = o.name || o.type;
    // A split instanced mesh's part ('MarsGrass:always#3/1') under its mesh;
    // other names keep theirs ('Room:MainOffice').
    names.push(o.isInstancedMesh ? name.split(':')[0] : name);
  }
  return names.reverse().slice(0, DEPTH).join('/') || '(no parent)';
}
