// ─────────────────────────────────────────────
// commands  –  what the developer console can do
// ─────────────────────────────────────────────
// Every debug key the game had now lives here as a command, beside a few that
// set values a key never could (stamina, the time, the power). Each one reads
// engine.activeScene when it runs, so it follows a rebuilt scene; a scene
// without the system it needs (OfficeScene has no nights, and no scene has
// stamina until that system lands) says so.
//
// Toggles take on|off, or flip with no argument, as their key did.
//
// Hooks, from App:
//   closeConsole({ lock })  the editor wants the mouse: close into play without
//                           the lock; false if the console wasn't opened from play
//   rebuild()               `models` reloads the scene through App, keeping the
//                           night (without it, the scene is reloaded here)
//   settings                the SettingsStore: `perf` writes Show FPS, so the
//                           next applySettings doesn't undo it
// ─────────────────────────────────────────────

import { UsageError, CommandError } from './DevConsole.js';
import { NightClock } from '../../gameplay/NightClock.js';
import { SignalTarget } from '../../gameplay/SignalTarget.js';
import { SIGNAL_FADE_SECONDS, VISIBLE_SECONDS, PITCH_MIN, PITCH_MAX } from '../../gameplay/SignalManager.js';

/**
 * on|off (or a pair of words of its own) → true|false; nothing flips `current`.
 * @param {string|undefined} arg @param {boolean} current @param {[string, string]} [words]
 */
export function parseToggle(arg, current, words = ['on', 'off']) {
  if (arg === undefined) return !current;
  const word = arg.toLowerCase();
  if (word === words[0]) return true;
  if (word === words[1]) return false;
  throw new UsageError(`"${arg}": ${words[0]} or ${words[1]}`);
}

/** A number from 0 to 1. @param {string|undefined} arg */
export function parseUnit(arg) {
  const value = /^(\d+(\.\d*)?|\.\d+)$/.test(arg ?? '') ? Number(arg) : NaN;
  if (!(value >= 0 && value <= 1)) throw new UsageError('Give a number from 0 to 1');
  return value;
}

/**
 * A time of the shift → the clock's hour, which counts from midnight (0 at
 * 12 AM, 6 at 6 AM, negative before midnight). Takes `3:00am`, `3 am`, a
 * 24-hour `03:00`, or a plain hour of the clock's own (`3`). Anything outside
 * the clock's own hours is refused.
 * @param {string} text
 * @param {{ startHour: number, endHour: number }} shift  The clock's range.
 */
export function parseHour(text, { startHour, endHour }) {
  const s = String(text ?? '').trim().toLowerCase();
  const notATime = () => new UsageError(`"${text}" isn't a time`);
  let hour;
  let m;
  if ((m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/))) {
    const h = Number(m[1]), min = Number(m[2] ?? 0);
    if (h < 1 || h > 12 || min > 59) throw notATime();
    hour = (h % 12) + (m[3] === 'pm' ? 12 : 0) + min / 60;
  } else if ((m = s.match(/^(\d{1,2}):(\d{2})$/))) {
    const h = Number(m[1]), min = Number(m[2]);
    if (h > 23 || min > 59) throw notATime();
    hour = h + min / 60;
  } else if (/^-?\d+(\.\d+)?$/.test(s)) {
    hour = Number(s);
  } else {
    throw notATime();
  }
  // Noon onwards is the evening before midnight: negative on the clock.
  if (hour >= 12) hour -= 24;
  if (hour < startHour || hour > endHour) {
    throw new UsageError(`The shift runs ${NightClock.formatTime(startHour)} – ${NightClock.formatTime(endHour)}`);
  }
  return hour;
}

const EYE_KINDS = ['fence', 'window', 'both'];
const RAGNO_APPROACHES = ['window', 'yard'];
const RAGNO_SIDES = { left: -1, right: 1 };

/**
 * @param {import('../../core/Engine.js').Engine} engine
 * @param {{ closeConsole?: (opts: { lock: boolean }) => boolean,
 *           rebuild?: () => void,
 *           settings?: { set: (key: string, value: unknown) => void }|null }} [hooks]
 * @returns {import('./DevConsole.js').Command[]}
 */
export function createCommands(engine, { closeConsole, rebuild, settings } = {}) {
  /** One of the scene's systems, or "not in this scene". */
  const system = (key, label) => {
    const found = engine.activeScene?.[key];
    if (!found) throw new CommandError(`No ${label} in this scene`);
    return found;
  };
  /** One of the engine's debug tools, built with the first scene. */
  const tool = (found, missing) => {
    if (!found) throw new CommandError(missing);
    return found;
  };
  const reload = rebuild ?? (() => {
    const scene = tool(engine.activeScene, 'No scene to reload');
    engine.debugCamera?.disable();
    engine.fullbright?.disable();
    engine.loadScene(scene.constructor);
  });

  return [
    toggle({
      name: 'colliders', help: 'Collider wireframes over the scene',
      target: () => tool(engine.physicsDebug, 'Colliders aren\'t available yet'),
      get: (debug) => debug.visible,
      set: (debug) => debug.toggle(),
      say: (on) => `Colliders ${on ? 'on' : 'off'}`,
    }),
    toggle({
      name: 'editor', help: 'The level editor (closes the console)',
      target: () => tool(engine.levelEditor, 'The level editor isn\'t available yet'),
      get: (editor) => editor.enabled,
      set: (editor, on) => {
        // The editor needs the game behind it, unpaused: only a console
        // opened from play can hand it over.
        if (on && closeConsole && !closeConsole({ lock: false })) {
          throw new CommandError('Open the console in game (`) to use the editor');
        }
        editor.toggle();
      },
      say: (on) => `Level editor ${on ? 'open' : 'closed'}`,
    }),
    toggle({
      name: 'fly', aliases: ['noclip'], help: 'Free-fly camera; the player freezes',
      target: () => tool(engine.debugCamera, 'The fly camera isn\'t available yet'),
      get: (camera) => camera.active,
      set: (camera, on) => (on ? camera.enable(engine.player) : camera.disable()),
      say: (on) => (on ? 'Fly camera on: WASD to fly, Space up, C down, Shift faster' : 'Fly camera off'),
    }),
    toggle({
      name: 'fullbright', help: 'Unlit lighting: everything at full brightness',
      target: () => tool(engine.fullbright, 'Fullbright isn\'t available yet'),
      get: (bright) => bright.active,
      set: (bright, on) => (on ? bright.enable() : bright.disable()),
      say: (on) => `Fullbright ${on ? 'on' : 'off'}`,
    }),
    toggle({
      name: 'perf', aliases: ['fps'], help: 'FPS, draw calls and memory readout',
      target: () => tool(engine.perfStats, 'The FPS readout isn\'t available yet'),
      get: (stats) => stats.visible,
      set: (stats, on) => {
        if (settings) settings.set('showFps', on);
        else if (on) stats.show();
        else stats.hide();
      },
      say: (on) => `FPS readout ${on ? 'on' : 'off'}`,
    }),
    toggle({
      name: 'models', help: 'Log each model as it spawns, and reload the scene to show them',
      target: () => engine,
      get: () => engine.debugModels,
      set: (_, on) => {
        engine.debugModels = on;
        if (on) reload();
      },
      say: (on) => (on ? 'Model debug logging on: reloading the scene' : 'Model debug logging off'),
    }),

    {
      name: 'night', usage: 'night [n]', help: 'Jump to a night, or on to the next (wraps to 1)',
      run: ([arg]) => {
        const nights = system('nights', 'nights');
        let night;
        if (arg === undefined) {
          night = nights.isLastNight() ? 1 : nights.currentNight + 1;
        } else {
          night = /^\d+$/.test(arg) ? Number(arg) : NaN;
          const first = nights.minNight ?? 1;   // 0 where there is a tutorial
          if (!(night >= first && night <= nights.maxNight)) throw new UsageError(`Night must be ${first}–${nights.maxNight}`);
          if (night === nights.currentNight) return `Already night ${night}`;
        }
        nights.setNight(night);
        return `Night ${nights.currentNight} of ${nights.maxNight}`;
      },
    },

    // Testing only, as their keys were: bring a threat now.
    {
      name: 'ufo', usage: 'ufo', help: 'Bring the UFO now, on any night',
      run: () => {
        if (!system('ufoThreat', 'UFO').summon()) {
          throw new CommandError('UFO not summoned: a visit is under way, or no shift is');
        }
        return 'UFO summoned';
      },
    },
    {
      name: 'storm', usage: 'storm', help: 'Start a sandstorm now, on any night',
      run: () => {
        if (!system('sandstorm', 'sandstorms').summon()) {
          throw new CommandError('Sandstorm not summoned: one is blowing, or no shift is');
        }
        return 'Sandstorm summoned';
      },
    },
    {
      name: 'evil', usage: 'evil', help: 'Put the evil signal in the sky now, on any night',
      run: () => {
        if (!system('evilSignal', 'evil signal').summon()) {
          throw new CommandError('Evil signal not summoned: one is already up, or no shift is');
        }
        return 'Evil signal summoned';
      },
    },
    {
      name: 'eyes', usage: `eyes [${EYE_KINDS.join('|')}]`, help: 'Bring dust eyes now (and a storm, if none is blowing)',
      run: ([arg]) => {
        const eyes = system('dustEyes', 'dust eyes');
        const kind = (arg ?? 'both').toLowerCase();
        if (!EYE_KINDS.includes(kind)) throw new UsageError(`No eyes "${arg}"`);
        if (!eyes.summon(kind)) {
          throw new CommandError('Dust eyes not summoned: no shift, the UFO is over the base, or the yard is full');
        }
        return `Dust eyes summoned: ${kind}`;
      },
    },
    {
      name: 'ragno', usage: 'ragno [creep] [window|yard] [left|right] | ragno off',
      help: 'Bring a night-3 Ragno now (or a creep: partway in, linger, back out), by the window side or the yard, at the quarters (left) or server (right) end',
      run: (args) => {
        const ragno = system('ragno', 'Ragno');
        const words = args.map(a => a.toLowerCase());
        if (words[0] === 'off') {
          ragno.dismiss();
          return 'Ragno dismissed';
        }
        let approach, side, creep = false;
        for (const w of words) {
          if (w === 'creep' && !creep) creep = true;
          else if (RAGNO_APPROACHES.includes(w) && approach === undefined) approach = w;
          else if (w in RAGNO_SIDES && side === undefined) side = RAGNO_SIDES[w];
          else throw new UsageError(`"${w}": window or yard, left or right`);
        }
        if (!ragno.summon(creep ? { approach, side, creep: true } : { approach, side })) {
          throw new CommandError('Ragno not summoned: no shift, the UFO is over the base, or he is already out');
        }
        const from = approach ? `${approach} side` : 'either side';
        const end = side === undefined ? 'either end' : side < 0 ? 'quarters end (left)' : 'server end (right)';
        return `Ragno ${creep ? 'creeping' : 'summoned'}: ${from}, ${end}`;
      },
    },
    {
      name: 'music', usage: 'music [spooky|ambient|off]', help: 'Swing a music track in under the game, or take it out',
      run: ([arg]) => {
        const ambience = system('ambience', 'ambience');
        const names = Object.keys(ambience.testTracks ?? {});
        if (names.length === 0) throw new CommandError('No test music in this build');
        if (arg === undefined) return `Music: ${ambience.testTrack ?? 'off'}`;
        const name = arg.toLowerCase();
        if (name !== 'off' && !names.includes(name)) {
          throw new UsageError(`No track "${arg}": ${names.join(', ')} or off`);
        }
        ambience.testMusic(name === 'off' ? null : name);
        return `Music: ${name}`;
      },
    },

    {
      name: 'signal', usage: 'signal [name]', help: 'Summon a signal blip on the radar (random if not specified)',
      run: ([arg]) => {
        const scene = tool(engine.activeScene, 'No scene');
        const registry = scene.signalRegistry;
        const signalManager = scene.signalManager;
        if (!registry) throw new CommandError('No signal registry in this scene');
        if (!signalManager) throw new CommandError('No signal manager in this scene');

        const names = registry.names;
        if (names.length === 0) throw new CommandError('No signals available');

        const signalName = arg ?? names[Math.floor(Math.random() * names.length)];
        if (!names.includes(signalName)) {
          throw new UsageError(`No signal "${arg}": available: ${names.join(', ')}`);
        }

        // Create a signal target and add it to the manager.
        const id = signalManager.signals.length + 1;
        const yaw = Math.random() * Math.PI * 2 - Math.PI;
        const pitch = PITCH_MIN + Math.random() * (PITCH_MAX - PITCH_MIN);
        const target = new SignalTarget({
          id,
          yaw,
          pitch,
          name: signalName,
          appearAt: 0,  // appear immediately
          fadeSeconds: SIGNAL_FADE_SECONDS,
          visibleSeconds: VISIBLE_SECONDS,
        });
        target.appeared = true;
        signalManager.signals.push(target);

        return `Signal summoned: ${signalName} (blip #${id})`;
      },
    },

    {
      name: 'stamina', usage: 'stamina [0–1]', help: 'Show stamina, or set it',
      run: ([arg]) => {
        const stamina = system('stamina', 'stamina');
        if (arg !== undefined) stamina.value = parseUnit(arg);
        return `Stamina ${stamina.value.toFixed(2)} (${stamina.level})`;
      },
    },
    {
      name: 'time', usage: 'time [h:mm am|pm]', help: 'Show the clock, or set it (6:00 AM ends the night)',
      run: (args) => {
        const clock = system('nightClock', 'night clock');
        if (args.length > 0) {
          const hour = parseHour(args.join(' '), clock);
          const state = engine.activeScene?.gameController?.state;
          if (state && state !== 'playing') throw new CommandError('The clock only runs during a shift');
          clock.setTime(hour);
        }
        return `Time ${clock.timeString}`;
      },
    },
    toggle({
      name: 'power', help: 'Start or stop the generator',
      target: () => ({ grid: system('power', 'power grid'), generator: system('generatorSound', 'generator') }),
      get: ({ grid }) => grid.on,
      set: ({ grid, generator }, on) => {
        if (!on) return generator.switchOff();
        generator.switchOn();
        if (!grid.on) {
          throw new CommandError(grid.tripped
            ? 'Breakers tripped: reset them at the generator\'s panel'
            : 'The generator didn\'t start');
        }
      },
      say: (on) => `Power ${on ? 'on' : 'off'}`,
    }),
    toggle({
      name: 'suit', help: 'Put the EVA suit on or take it off',
      target: () => system('suit', 'EVA suit'),
      get: (suit) => suit.worn,
      set: (suit, on) => (on ? suit.putOn() : suit.takeOff()),
      say: (on) => `Suit ${on ? 'on' : 'off'}`,
    }),
    toggle({
      name: 'zones', words: ['reveal', 'hide'], help: 'Draw everything, ignoring the occlusion zones, or cull again',
      target: () => system('zones', 'occlusion zones'),
      get: (zones) => zones.revealed,
      set: (zones, on) => zones.revealAll(on),
      say: (on) => (on ? 'Zones revealed: everything is drawn' : 'Zones hidden: culled as normal'),
    }),
  ];
}

/**
 * A command that turns something on or off: an argument sets it, none flips it.
 * `target()` finds the thing (or throws), `get` reads it, `set` changes it.
 */
function toggle({ name, aliases, help, words = ['on', 'off'], target, get, set, say }) {
  return {
    name, aliases, help,
    usage: `${name} [${words.join('|')}]`,
    run: ([arg]) => {
      const thing = target();
      const on = parseToggle(arg, get(thing), words);
      if (on !== get(thing)) set(thing, on);
      return say(on);
    },
  };
}
