// ─────────────────────────────────────────────
// text  –  menu copy the team may want to change
// ─────────────────────────────────────────────
// Kept apart from the code that lays it out, so a new tagline or a team
// change is a one-line edit.
// ─────────────────────────────────────────────

/** Typed in under the title, one line after another. "Dead air" is when a
 *  radio goes silent; the operator's job is to keep listening through it. */
export const TAGLINE = [
  '> KEEP LISTENING.',
  '> MEET THE QUOTA.',
  '> SURVIVE THE NIGHT.',
];

/** Shown on the credits as `handle (Name): role`. Agreed by the team. */
export const TEAM = [
  { handle: 'drax9207',               name: 'Adrian Draxl',             role: 'Scene design, level editor, architecture' },
  { handle: 'mortalnumbnut',          name: 'Ryan Fletcher',            role: 'Skybox, terrain, environment' },
  { handle: 'thotslayer666',          name: 'Bruno',                    role: 'Model sourcing, asset consistency' },
  { handle: 'haydnrad',               name: 'Hayden RadCooke',          role: 'Stamina and sleep systems, debug camera' },
  { handle: 'siboneloblessingmaduna', name: 'Sibonelo Blessing Maduna', role: 'Menus, pause, settings' },
];

/** Libraries the game is built on, with their licences. */
export const BUILT_WITH = [
  { name: 'three.js', licence: 'MIT', url: 'https://threejs.org' },
  { name: 'Rapier (@dimforge/rapier3d)', licence: 'Apache-2.0', url: 'https://rapier.rs' },
  { name: 'Vite', licence: 'MIT', url: 'https://vitejs.dev' },
  { name: 'vite-plugin-wasm', licence: 'MIT', url: 'https://github.com/Menci/vite-plugin-wasm' },
];

/** Inspirations, not assets used. */
export const INSPIRED_BY = ['Five Nights at Freddy’s', 'Voices of the Void'];

export const COURSE_LINE = 'Wits University — COMS3006A / COMS3025A Computer Graphics & Visualisation';

export const COPY = {
  title: 'DEAD AIR',
  paused: 'PAUSED',
  resumeRetry: 'Click RESUME again to continue.',
  lockRefused: 'Click again to take control of the mouse.',
  nightFailedTitle: 'SIGNAL LOST',
  runCompleteTitle: 'You made it through every shift.',
  restartConfirm: (night) => `Restart night ${night}? Progress on this night will be lost.`,
  quitConfirm: 'Quit to the main menu? Progress on this night will be lost.',
};
