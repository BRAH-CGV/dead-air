import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { DevConsole, UsageError } from './DevConsole.js';
import { createCommands, parseToggle, parseUnit, parseHour } from './commands.js';
import { NightManager } from '../../systems/NightManager.js';
import { NightClock } from '../../gameplay/NightClock.js';
import { Stamina } from '../../gameplay/Stamina.js';

/** A flag object whose methods flip it, like the real debug tools. */
function flag(key, on, off) {
  const o = { [key]: false };
  o[on] = vi.fn(() => { o[key] = true; });
  if (off) o[off] = vi.fn(() => { o[key] = false; });
  return o;
}

function fakeScene() {
  const power = { on: true, tripped: false, broken: false };
  const ambience = {
    testTracks: { spooky: 'sfx:spooky', ambient: 'sfx:ambient' },
    testTrack: null,
    testMusic: vi.fn((name) => {
      if (name === null) { ambience.testTrack = null; return true; }
      if (!ambience.testTracks[name]) return false;
      ambience.testTrack = name;
      return true;
    }),
  };
  // Drive manager mock for the signals command.
  const driveManager = { drives: [], addDrive: vi.fn((d) => driveManager.drives.push(d)) };
  // Room mocks for the signals command.
  const mainOfficeRoot = {
    object3d: new THREE.Object3D(),
    addChild: vi.fn(),
  };
  const driveBoxes = [{ addDrive: vi.fn() }, { addDrive: vi.fn() }];
  const rooms = {
    MainOffice: { root: mainOfficeRoot, driveBoxes, driveReader: null, _own: vi.fn((r) => r) },
    ServerRoom: { driveSlot: null },
  };
  const hud = { visible: true, show: vi.fn(() => { hud.visible = true; }), hide: vi.fn(() => { hud.visible = false; }) };
  return {
    nights: new NightManager(),
    nightClock: new NightClock(),
    gameController: { state: 'playing' },
    ufoThreat: { summon: vi.fn(() => true) },
    evilSignal: { summon: vi.fn(() => true) },
    sandstorm: { summon: vi.fn(() => true) },
    dustEyes: { summon: vi.fn(() => true) },
    buggySendOff: { active: false, start: vi.fn() },
    ragno: { summon: vi.fn(() => true), dismiss: vi.fn(), logic: { active: false } },
    ambience,
    power,
    generatorSound: {
      switchOn: vi.fn(() => { if (!power.tripped) power.on = true; }),
      switchOff: vi.fn(() => { power.on = false; }),
    },
    suit: flag('worn', 'putOn', 'takeOff'),
    hud,
    driveManager,
    rooms,
    _sceneRoot: mainOfficeRoot,
    _own: vi.fn((r) => r),
  };
}

/** The occlusion zones, added apart so revealAll can see the object it flips. */
function withZones(scene) {
  const zones = { revealed: false, revealAll: vi.fn((on) => { zones.revealed = on; }) };
  scene.zones = zones;
  return scene;
}

function fakeEngine(scene) {
  const physicsDebug = { visible: false, toggle: vi.fn(() => { physicsDebug.visible = !physicsDebug.visible; }) };
  const levelEditor = { enabled: false, toggle: vi.fn(() => { levelEditor.enabled = !levelEditor.enabled; }) };
  const crosshair = { visible: true, show: vi.fn(() => { crosshair.visible = true; }), hide: vi.fn(() => { crosshair.visible = false; }) };
  // Player with object3d for the signals command.
  const playerObject = new THREE.Object3D();
  playerObject.position.set(0, 0, 0);
  return {
    activeScene: scene,
    player: { name: 'Player', object3d: playerObject },
    debugModels: false,
    physicsDebug,
    levelEditor,
    debugCamera: flag('active', 'enable', 'disable'),
    fullbright: flag('active', 'enable', 'disable'),
    perfStats: flag('visible', 'show', 'hide'),
    crosshair,
    loadScene: vi.fn(),
  };
}

describe('parseToggle', () => {
  it('no argument flips the current state', () => {
    expect(parseToggle(undefined, true)).toBe(false);
    expect(parseToggle(undefined, false)).toBe(true);
  });

  it('on and off set it, in any case', () => {
    expect(parseToggle('on', true)).toBe(true);
    expect(parseToggle('OFF', false)).toBe(false);
  });

  it('takes its own pair of words', () => {
    expect(parseToggle('reveal', false, ['reveal', 'hide'])).toBe(true);
    expect(parseToggle('hide', true, ['reveal', 'hide'])).toBe(false);
  });

  it('anything else is a usage error', () => {
    expect(() => parseToggle('maybe', false)).toThrow(UsageError);
    expect(() => parseToggle('on', false, ['reveal', 'hide'])).toThrow(UsageError);
  });
});

describe('parseUnit', () => {
  it('a number from 0 to 1', () => {
    expect(parseUnit('0.25')).toBe(0.25);
    expect(parseUnit('.5')).toBe(0.5);
    expect(parseUnit('0')).toBe(0);
    expect(parseUnit('1')).toBe(1);
  });

  it('anything else is a usage error', () => {
    for (const bad of ['1.5', '-0.1', 'half', '', undefined, '0.5x']) {
      expect(() => parseUnit(bad), String(bad)).toThrow(UsageError);
    }
  });
});

describe('parseHour', () => {
  /** The shift as NightClock runs it by default: midnight to 6 AM. */
  const SHIFT = { startHour: 0, endHour: 6 };
  /** A clock that starts at dusk, before midnight (negative hours). */
  const DUSK = { startHour: -6, endHour: 6 };

  it('a 12-hour time, with or without minutes or a space', () => {
    expect(parseHour('3:00am', SHIFT)).toBe(3);
    expect(parseHour('3am', SHIFT)).toBe(3);
    expect(parseHour('3:00 am', SHIFT)).toBe(3);
    expect(parseHour('3:30AM', SHIFT)).toBe(3.5);
    expect(parseHour('5:50am', SHIFT)).toBeCloseTo(5 + 50 / 60);
  });

  it('12 AM is midnight, the start of the shift', () => {
    expect(parseHour('12am', SHIFT)).toBe(0);
    expect(parseHour('12:15am', SHIFT)).toBe(0.25);
  });

  it('6 AM, the end of the shift, is in it', () => {
    expect(parseHour('6am', SHIFT)).toBe(6);
  });

  it('a 24-hour time', () => {
    expect(parseHour('03:00', SHIFT)).toBe(3);
    expect(parseHour('0:30', SHIFT)).toBe(0.5);
  });

  it('a plain hour is the clock\'s own', () => {
    expect(parseHour('3', SHIFT)).toBe(3);
    expect(parseHour('2.5', SHIFT)).toBe(2.5);
  });

  it('PM is before midnight, negative on the clock', () => {
    expect(parseHour('11pm', DUSK)).toBe(-1);
    expect(parseHour('6pm', DUSK)).toBe(-6);
    expect(parseHour('10:30 pm', DUSK)).toBe(-1.5);
    expect(parseHour('23:00', DUSK)).toBe(-1);
    expect(parseHour('18:00', DUSK)).toBe(-6);
    expect(parseHour('-2', DUSK)).toBe(-2);
    expect(parseHour('23', DUSK)).toBe(-1);
  });

  it('outside the clock\'s own hours is a usage error', () => {
    for (const bad of ['11pm', '23:00', '-2', '7am', '12pm', '9']) {
      expect(() => parseHour(bad, SHIFT), bad).toThrow(UsageError);
    }
    for (const bad of ['12pm', '7am', '5pm', '13:00', '9']) {
      expect(() => parseHour(bad, DUSK), bad).toThrow(UsageError);
    }
  });

  it('the error names the shift\'s hours', () => {
    expect(() => parseHour('11pm', SHIFT)).toThrow('The shift runs 12:00 AM – 6:00 AM');
  });

  it('not a time is a usage error', () => {
    for (const bad of ['soon', '3:75am', '13pm', '0am', '', '3:5am']) {
      expect(() => parseHour(bad, SHIFT), bad).toThrow(UsageError);
    }
  });
});

describe('createCommands', () => {
  let engine, scene, hooks, c;

  /** Run one line on a fresh log: { ok, out } with the echo left off. */
  const run = (line) => {
    c.lines.length = 0;
    const { ok } = c.run(line);
    return { ok, out: c.lines.slice(1).map(l => l.text) };
  };

  beforeEach(() => {
    scene = withZones(fakeScene());
    engine = fakeEngine(scene);
    hooks = { closeConsole: vi.fn(() => true), rebuild: vi.fn(), settings: null };
    c = new DevConsole();
    for (const command of createCommands(engine, hooks)) c.register(command);
  });

  it('every command has a usage that starts with its name, and a description', () => {
    for (const command of createCommands(engine, hooks)) {
      expect(command.usage.split(' ')[0]).toBe(command.name);
      expect(command.help.length).toBeGreaterThan(0);
    }
  });

  it('registers every old debug key as a command', () => {
    for (const name of ['colliders', 'editor', 'fly', 'noclip', 'fullbright', 'perf', 'fps',
      'night', 'models', 'ufo', 'storm', 'eyes', 'evil', 'ragno', 'music', 'stamina', 'time', 'power', 'suit', 'zones', 'signals']) {
      expect(c.find(name), name).not.toBe(null);
    }
  });

  describe('tool toggles', () => {
    it('colliders: no argument flips the overlay', () => {
      expect(run('colliders')).toEqual({ ok: true, out: ['Colliders on'] });
      expect(engine.physicsDebug.visible).toBe(true);
      expect(run('colliders').out).toEqual(['Colliders off']);
      expect(engine.physicsDebug.visible).toBe(false);
    });

    it('colliders on twice leaves it on', () => {
      run('colliders on');
      run('colliders on');
      expect(engine.physicsDebug.toggle).toHaveBeenCalledOnce();
      expect(engine.physicsDebug.visible).toBe(true);
    });

    it('a bad argument shows the usage', () => {
      const { ok, out } = run('colliders sideways');
      expect(ok).toBe(false);
      expect(out.at(-1)).toBe('Usage: colliders [on|off]');
    });

    it('fly frees the camera from the player, and noclip is the same', () => {
      expect(run('fly').out[0]).toMatch(/^Fly camera on/);
      expect(engine.debugCamera.enable).toHaveBeenCalledWith(engine.player);
      run('noclip off');
      expect(engine.debugCamera.disable).toHaveBeenCalledOnce();
      expect(engine.debugCamera.active).toBe(false);
    });

    it('fullbright', () => {
      expect(run('fullbright on').out).toEqual(['Fullbright on']);
      expect(engine.fullbright.active).toBe(true);
      run('fullbright');
      expect(engine.fullbright.active).toBe(false);
    });

    it('perf shows the readout, and fps is the same', () => {
      expect(run('perf').out).toEqual(['FPS readout on']);
      expect(engine.perfStats.show).toHaveBeenCalledOnce();
      run('fps off');
      expect(engine.perfStats.hide).toHaveBeenCalledOnce();
    });

    it('perf goes through the Show FPS setting when there is one', () => {
      const settings = { values: { showFps: false }, set: vi.fn() };
      c = new DevConsole();
      for (const command of createCommands(engine, { ...hooks, settings })) c.register(command);
      run('perf on');
      expect(settings.set).toHaveBeenCalledWith('showFps', true);
      expect(engine.perfStats.show).not.toHaveBeenCalled();
    });

    it('editor opens the level editor and hands it the mouse', () => {
      expect(run('editor').out).toEqual(['Level editor open']);
      expect(engine.levelEditor.enabled).toBe(true);
      expect(hooks.closeConsole).toHaveBeenCalledWith({ lock: false });
    });

    it('editor is refused where the console can\'t hand it the game (opened from Settings)', () => {
      hooks.closeConsole.mockReturnValue(false);
      const { ok, out } = run('editor');
      expect(ok).toBe(false);
      expect(out.join(' ')).toMatch(/in game/);
      expect(engine.levelEditor.enabled).toBe(false);
    });

    it('editor off closes it and leaves the console be', () => {
      engine.levelEditor.enabled = true;
      expect(run('editor off').out).toEqual(['Level editor closed']);
      expect(engine.levelEditor.enabled).toBe(false);
      expect(hooks.closeConsole).not.toHaveBeenCalled();
    });

    it('a tool the engine lacks is an error, not a crash', () => {
      engine.physicsDebug = null;
      const { ok, out } = run('colliders');
      expect(ok).toBe(false);
      expect(out).toEqual(['Colliders aren\'t available yet']);
    });
  });

  describe('models', () => {
    it('turns model logging on and reloads the scene', () => {
      expect(run('models').out[0]).toMatch(/^Model debug logging on/);
      expect(engine.debugModels).toBe(true);
      expect(hooks.rebuild).toHaveBeenCalledOnce();
    });

    it('off just stops the logging', () => {
      engine.debugModels = true;
      expect(run('models').out).toEqual(['Model debug logging off']);
      expect(engine.debugModels).toBe(false);
      expect(hooks.rebuild).not.toHaveBeenCalled();
    });

    it('without a rebuild hook it reloads the scene itself, fly camera and fullbright off', () => {
      engine.debugCamera.active = true;
      engine.fullbright.active = true;
      c = new DevConsole();
      for (const command of createCommands(engine, {})) c.register(command);
      run('models');
      expect(engine.debugCamera.disable).toHaveBeenCalled();
      expect(engine.fullbright.disable).toHaveBeenCalled();
      expect(engine.loadScene).toHaveBeenCalledWith(scene.constructor);
    });
  });

  describe('night', () => {
    it('no argument advances one night', () => {
      expect(run('night').out).toEqual(['Night 2 of 3']);
      expect(scene.nights.currentNight).toBe(2);
    });

    it('wraps back to night 1 after the last', () => {
      scene.nights.setNight(3);
      run('night');
      expect(scene.nights.currentNight).toBe(1);
    });

    it('jumps to a night', () => {
      expect(run('night 3').out).toEqual(['Night 3 of 3']);
      expect(scene.nights.currentNight).toBe(3);
    });

    it('says so when it is that night already', () => {
      expect(run('night 1')).toEqual({ ok: true, out: ['Already night 1'] });
    });

    it('a night outside the run is a usage error', () => {
      for (const bad of ['0', '4', 'two', '1.5']) {
        const { ok, out } = run(`night ${bad}`);
        expect(ok, bad).toBe(false);
        expect(out[0]).toBe('Night must be 1–3');
      }
      expect(scene.nights.currentNight).toBe(1);
    });

    it('night 0, the tutorial, where the scene has one', () => {
      scene.nights = new NightManager({ minNight: 0 });
      expect(run('night 0').out).toEqual(['Night 0 of 3']);
      expect(scene.nights.currentNight).toBe(0);
      expect(run('night 9').out[0]).toBe('Night must be 0–3');
    });

    it('a scene without nights says so', () => {
      delete scene.nights;
      expect(run('night')).toEqual({ ok: false, out: ['No nights in this scene'] });
    });
  });

  describe('summons', () => {
    it('ufo brings it now', () => {
      expect(run('ufo').out).toEqual(['UFO summoned']);
      expect(scene.ufoThreat.summon).toHaveBeenCalledOnce();
    });

    it('a refused summon says why', () => {
      scene.ufoThreat.summon.mockReturnValue(false);
      const { ok, out } = run('ufo');
      expect(ok).toBe(false);
      expect(out[0]).toMatch(/^UFO not summoned/);
    });

    it('buggy draws everything first, unculled, then sends it off', () => {
      withZones(scene);
      const order = [];
      scene.zones.revealAll.mockImplementation((on) => { scene.zones.revealed = on; order.push(`reveal ${on}`); });
      scene.buggySendOff.start.mockImplementation(() => order.push('start'));
      expect(run('buggy').out).toEqual(['Zones revealed: everything is drawn (zones hide culls again)', 'Buggy sent off']);
      expect(order).toEqual(['reveal true', 'start']);
    });

    it('buggy sends the buggy off now, cutscene and all; not twice at once', () => {
      expect(run('buggy').out.at(-1)).toBe('Buggy sent off');
      expect(scene.buggySendOff.start).toHaveBeenCalledOnce();
      scene.buggySendOff.active = true;
      const { ok, out } = run('buggy');
      expect(ok).toBe(false);
      expect(out[0]).toMatch(/already/i);
      expect(scene.buggySendOff.start).toHaveBeenCalledOnce();
    });

    it('buggy says so when the scene has no send-off', () => {
      delete scene.buggySendOff;
      expect(run('buggy').out).toEqual(['No buggy send-off in this scene']);
    });

    it('storm brings a sandstorm', () => {
      expect(run('storm').out).toEqual(['Sandstorm summoned']);
      scene.sandstorm.summon.mockReturnValue(false);
      expect(run('storm').out[0]).toMatch(/^Sandstorm not summoned/);
    });

    it('eyes brings both by default, or one kind', () => {
      run('eyes');
      expect(scene.dustEyes.summon).toHaveBeenLastCalledWith('both');
      expect(run('eyes window').out).toEqual(['Dust eyes summoned: window']);
      expect(scene.dustEyes.summon).toHaveBeenLastCalledWith('window');
      run('eyes FENCE');
      expect(scene.dustEyes.summon).toHaveBeenLastCalledWith('fence');
    });

    it('eyes with a bad kind is a usage error', () => {
      const { ok, out } = run('eyes everywhere');
      expect(ok).toBe(false);
      expect(out.at(-1)).toBe('Usage: eyes [fence|window|both]');
      expect(scene.dustEyes.summon).not.toHaveBeenCalled();
    });

    it('evil puts the red signal in the sky', () => {
      expect(run('evil')).toEqual({ ok: true, out: ['Evil signal summoned'] });
      expect(scene.evilSignal.summon).toHaveBeenCalledOnce();
      scene.evilSignal.summon.mockReturnValue(false);
      const { ok, out } = run('evil');
      expect(ok).toBe(false);
      expect(out[0]).toMatch(/^Evil signal not summoned/);
    });

    it('ragno brings a night-3 Ragno, from where you say', () => {
      expect(run('ragno window left').out).toEqual(['Ragno summoned: window side, quarters end (left)']);
      expect(scene.ragno.summon).toHaveBeenLastCalledWith({ approach: 'window', side: -1 });
      run('ragno YARD right');
      expect(scene.ragno.summon).toHaveBeenLastCalledWith({ approach: 'yard', side: 1 });
      run('ragno right');
      expect(scene.ragno.summon).toHaveBeenLastCalledWith({ approach: undefined, side: 1 });
      run('ragno');
      expect(scene.ragno.summon).toHaveBeenLastCalledWith({ approach: undefined, side: undefined });
    });

    it('ragno creep brings a creeper, from where you say', () => {
      expect(run('ragno creep yard left').out).toEqual(['Ragno creeping: yard side, quarters end (left)']);
      expect(scene.ragno.summon).toHaveBeenLastCalledWith({ approach: 'yard', side: -1, creep: true });
    });

    it('ragno off sends him away', () => {
      expect(run('ragno off').out).toEqual(['Ragno dismissed']);
      expect(scene.ragno.dismiss).toHaveBeenCalledOnce();
    });

    it('ragno with a bad word is a usage error; a refused one says why', () => {
      const { ok, out } = run('ragno ceiling');
      expect(ok).toBe(false);
      expect(out.at(-1)).toBe('Usage: ragno [creep] [window|yard] [left|right] | ragno off');
      scene.ragno.summon.mockReturnValue(false);
      expect(run('ragno').out[0]).toMatch(/^Ragno not summoned/);
    });

    it('each says when the scene has no such threat', () => {
      delete scene.ufoThreat;
      delete scene.sandstorm;
      delete scene.dustEyes;
      delete scene.evilSignal;
      delete scene.ragno;
      expect(run('ragno').out).toEqual(['No Ragno in this scene']);
      expect(run('ufo').out).toEqual(['No UFO in this scene']);
      expect(run('storm').out).toEqual(['No sandstorms in this scene']);
      expect(run('eyes').out).toEqual(['No dust eyes in this scene']);
      expect(run('evil').out).toEqual(['No evil signal in this scene']);
    });
  });

  describe('music', () => {
    it('swings a test track in, and off takes it out', () => {
      expect(run('music spooky').out).toEqual(['Music: spooky']);
      expect(scene.ambience.testMusic).toHaveBeenLastCalledWith('spooky');
      expect(run('music off').out).toEqual(['Music: off']);
      expect(scene.ambience.testMusic).toHaveBeenLastCalledWith(null);
    });

    it('no argument says which is playing', () => {
      expect(run('music').out).toEqual(['Music: off']);
      run('music ambient');
      expect(run('music').out).toEqual(['Music: ambient']);
    });

    it('an unknown track is a usage error naming the tracks', () => {
      const { ok, out } = run('music jazz');
      expect(ok).toBe(false);
      expect(out[0]).toBe('No track "jazz": spooky, ambient or off');
    });

    it('a build without test tracks says so', () => {
      scene.ambience.testTracks = {};
      expect(run('music spooky')).toEqual({ ok: false, out: ['No test music in this build'] });
    });
  });

  describe('stamina', () => {
    beforeEach(() => { scene.stamina = new Stamina(); });

    it('a scene without stamina says so', () => {
      delete scene.stamina;
      expect(run('stamina')).toEqual({ ok: false, out: ['No stamina in this scene'] });
      expect(run('stamina 0.5')).toEqual({ ok: false, out: ['No stamina in this scene'] });
    });

    it('no argument shows it', () => {
      expect(run('stamina').out).toEqual(['Stamina 1.00 (ok)']);
    });

    it('sets it', () => {
      expect(run('stamina 0.1').out).toEqual(['Stamina 0.10 (critical)']);
      expect(scene.stamina.value).toBe(0.1);
    });

    it('outside 0–1 is a usage error and changes nothing', () => {
      expect(run('stamina 2').ok).toBe(false);
      expect(scene.stamina.value).toBe(1);
    });
  });

  describe('time', () => {
    it('no argument shows the clock', () => {
      expect(run('time').out).toEqual(['Time 6:00 PM']);
    });

    it('takes an evening time, before midnight', () => {
      expect(run('time 11:30 pm').out).toEqual(['Time 11:30 PM']);
      expect(scene.nightClock.currentTime).toBe(-0.5);
    });

    it('sets the clock', () => {
      expect(run('time 3:00am').out).toEqual(['Time 3:00 AM']);
      expect(scene.nightClock.currentTime).toBe(3);
    });

    it('takes a time split by a space', () => {
      run('time 1:30 am');
      expect(scene.nightClock.currentTime).toBe(1.5);
    });

    it('outside the shift is a usage error and leaves the clock', () => {
      for (const bad of ['noon', '5pm', '7am']) {
        const { ok, out } = run(`time ${bad}`);
        expect(ok, bad).toBe(false);
        expect(out.at(-1)).toBe('Usage: time [h:mm am|pm]');
      }
      expect(scene.nightClock.timeString).toBe('6:00 PM');
    });

    it('follows the clock\'s own hours', () => {
      scene.nightClock = new NightClock({ startHour: 0, endHour: 6, nightDuration: 300 });
      expect(run('time 11pm').ok).toBe(false);
      expect(run('time 2am').out).toEqual(['Time 2:00 AM']);
    });

    it('only during a shift', () => {
      scene.gameController.state = 'morning';
      expect(run('time 3am')).toEqual({ ok: false, out: ['The clock only runs during a shift'] });
    });
  });

  describe('power, suit and zones', () => {
    it('power off and on run the generator', () => {
      expect(run('power off').out).toEqual(['Power off']);
      expect(scene.generatorSound.switchOff).toHaveBeenCalledOnce();
      expect(run('power').out).toEqual(['Power on']);
      expect(scene.generatorSound.switchOn).toHaveBeenCalledOnce();
    });

    it('tripped breakers refuse it', () => {
      scene.power.on = false;
      scene.power.tripped = true;
      const { ok, out } = run('power on');
      expect(ok).toBe(false);
      expect(out[0]).toMatch(/breakers tripped/i);
    });

    it('suit on and off', () => {
      expect(run('suit on').out).toEqual(['Suit on']);
      expect(scene.suit.worn).toBe(true);
      expect(run('suit').out).toEqual(['Suit off']);
      expect(scene.suit.takeOff).toHaveBeenCalledOnce();
    });

    it('zones reveal draws everything, and hide culls again', () => {
      expect(run('zones reveal').out[0]).toMatch(/^Zones revealed/);
      expect(scene.zones.revealAll).toHaveBeenLastCalledWith(true);
      run('zones hide');
      expect(scene.zones.revealAll).toHaveBeenLastCalledWith(false);
      run('zones');
      expect(scene.zones.revealed).toBe(true);
    });

    it('zones on is a usage error', () => {
      expect(run('zones on').out.at(-1)).toBe('Usage: zones [reveal|hide]');
    });

    it('hud off hides the overlay and crosshair, on shows them again', () => {
      expect(run('hud off').out).toEqual(['HUD hidden']);
      expect(scene.hud.hide).toHaveBeenCalledOnce();
      expect(scene.hud.visible).toBe(false);
      expect(engine.crosshair.hide).toHaveBeenCalledOnce();
      expect(run('hud on').out).toEqual(['HUD shown']);
      expect(scene.hud.show).toHaveBeenCalledOnce();
      expect(scene.hud.visible).toBe(true);
      expect(engine.crosshair.show).toHaveBeenCalledOnce();
    });

    it('hud with no argument flips visibility', () => {
      expect(scene.hud.visible).toBe(true);
      run('hud');
      expect(scene.hud.visible).toBe(false);
      run('hud');
      expect(scene.hud.visible).toBe(true);
    });
  });

  describe('signals', () => {
    it('spawns one drive with a signal by default', () => {
      const { ok, out } = run('signals');
      expect(ok).toBe(true);
      expect(out[0]).toBe('Spawned 1 drive with signals');
      expect(scene.driveManager.addDrive).toHaveBeenCalledTimes(1);
      const drive = scene.driveManager.drives[0];
      expect(drive.saved).toBe(true);
    });

    it('spawns multiple drives when given a count', () => {
      const { ok, out } = run('signals 5');
      expect(ok).toBe(true);
      expect(out[0]).toBe('Spawned 5 drives with signals');
      expect(scene.driveManager.addDrive).toHaveBeenCalledTimes(5);
      for (const drive of scene.driveManager.drives) {
        expect(drive.saved).toBe(true);
      }
    });

    it('adds drives to the room and snap receivers', () => {
      run('signals 2');
      expect(scene.rooms.MainOffice.root.addChild).toHaveBeenCalledTimes(2);
      for (const box of scene.rooms.MainOffice.driveBoxes) {
        expect(box.addDrive).toHaveBeenCalledTimes(2);
      }
    });

    it('hands each drive to the office, which frees it with the room', () => {
      // Each drive builds its own geometry and material. Unowned, the ones
      // spawned here stayed on the GPU after a rebuild.
      run('signals 3');
      const owned = scene.rooms.MainOffice._own.mock.calls.map(([r]) => r);
      expect(owned).toEqual(scene.driveManager.drives);
    });

    it('hands them to the scene when there is no office', () => {
      delete scene.rooms.MainOffice;
      run('signals 2');
      const owned = scene._own.mock.calls.map(([r]) => r);
      expect(owned).toEqual(scene.driveManager.drives);
    });

    it('refuses non-number arguments', () => {
      const { ok, out } = run('signals many');
      expect(ok).toBe(false);
      expect(out.at(-1)).toBe('Usage: signals [count]');
    });

    it('refuses zero or negative counts', () => {
      expect(run('signals 0').ok).toBe(false);
      expect(run('signals -1').ok).toBe(false);
    });

    it('requires a drive manager', () => {
      delete scene.driveManager;
      const { ok, out } = run('signals');
      expect(ok).toBe(false);
      expect(out[0]).toBe('No drive manager in this scene');
    });

    it('requires a player', () => {
      engine.player = {};
      const { ok, out } = run('signals');
      expect(ok).toBe(false);
      expect(out[0]).toBe('No player to spawn near');
    });
  });

  it('reads the scene live, so a rebuilt scene is the one changed', () => {
    const next = withZones(fakeScene());
    engine.activeScene = next;
    run('night 3');
    expect(next.nights.currentNight).toBe(3);
    expect(scene.nights.currentNight).toBe(1);
  });

  describe('dream (#101)', () => {
    class Dream {}
    beforeEach(() => {
      engine.sceneRegistry = new Map([['DreamScene', Dream]]);
      engine.loadScene = vi.fn();
    });

    it('drops into the dream at the night\'s level, and remembers the night', () => {
      scene.nights.setNight(2);
      const { ok, out } = run('dream');
      expect(ok).toBe(true);
      expect(engine.loadScene).toHaveBeenCalledWith(Dream, { sceneOptions: { level: 2, night: 2 } });
      expect(out.join(' ')).toMatch(/level 2/i);
    });

    it('takes a level 1-3', () => {
      run('dream 3');
      expect(engine.loadScene).toHaveBeenLastCalledWith(Dream, { sceneOptions: { level: 3, night: 1 } });
      expect(run('dream 4').ok).toBe(false);
      expect(run('dream x').ok).toBe(false);
    });

    it('says so when there is no dream scene', () => {
      engine.sceneRegistry = new Map();
      expect(run('dream').ok).toBe(false);
    });
  });

  describe('dreamcrater', () => {
    class DreamCrater {}
    beforeEach(() => {
      engine.sceneRegistry = new Map([['DreamCraterScene', DreamCrater]]);
      engine.loadScene = vi.fn();
    });

    it('drops into the crater dream with the current night', () => {
      scene.nights.setNight(2);
      const { ok, out } = run('dreamcrater');
      expect(ok).toBe(true);
      expect(engine.loadScene).toHaveBeenCalledWith(DreamCrater, { sceneOptions: { night: 2 } });
      expect(out.join(' ')).toMatch(/crater dream/i);
    });

    it('says so when there is no crater dream scene', () => {
      engine.sceneRegistry = new Map();
      expect(run('dreamcrater').ok).toBe(false);
    });
  });
});
