import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { CameraTerminal, createCameraInteractable, CAMERA_FLASH, CAMERA_SOUNDS } from './CameraTerminal.js';
import { SecurityCamera } from '../gameobjects/SecurityCamera.js';
import { GameObject } from '../core/GameObject.js';
import { Interactable } from './Interactable.js';
import { CCTV } from '../gameplay/CameraFeed.js';
import { SIGNAL } from '../gameplay/CameraTransition.js';

// ─────────────────────────────────────────────
// CameraTerminal  –  the security monitor on the desk's left wing
// ─────────────────────────────────────────────

const KEY_BINDS = { forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', flashlight: 'KeyF', interact: 'KeyE' };

function makeEngine() {
  const engine = {
    input: { keys: {}, pressed: {} },
    keyBinds: { ...KEY_BINDS },
    camera: new THREE.PerspectiveCamera(75, 1.5, 0.1, 600),
    viewCamera: null,
    consumeAction: vi.fn((action) => { engine.input.pressed[engine.keyBinds[action]] = false; }),
  };
  return engine;
}

function fakeOverlay() {
  return {
    show: vi.fn(), hide: vi.fn(), setCamera: vi.fn(), setConnecting: vi.fn(),
    setFlash: vi.fn(), setHint: vi.fn(), onSelect: null,
  };
}

/** A THREE.Audio stand-in: play / stop and whether it is playing. */
function fakeSound() {
  const sound = {
    isPlaying: false, plays: 0, volume: 1,
    play: vi.fn(() => { sound.isPlaying = true; sound.plays++; return sound; }),
    stop: vi.fn(() => { sound.isPlaying = false; return sound; }),
    setVolume: vi.fn((v) => { sound.volume = v; return sound; }),
  };
  return sound;
}

describe('CameraTerminal', () => {
  let engine, cameras, flash, overlay, hooks, crosshair, terminal, ready, sounds;

  /** A frame with these keys pressed this frame (and held). */
  function frame(pressed = [], dt = 1 / 60) {
    for (const code of pressed) { engine.input.keys[code] = true; engine.input.pressed[code] = true; }
    terminal.onUpdate(dt);
    engine.input.pressed = {};
  }
  function release(...codes) { for (const c of codes) engine.input.keys[c] = false; }
  function run(seconds) { for (let t = 0; t < seconds; t += 1 / 60) frame(); }

  beforeEach(() => {
    engine = makeEngine();
    const root = new GameObject('Root').makeGroup();
    cameras = [
      new SecurityCamera({ name: 'CamA', label: 'ROOM', position: [0, 3, 0], target: [3, 0, 3], zones: ['interior'], flashReach: 9 }),
      new SecurityCamera({ name: 'CamB', label: 'YARD', position: [10, 3, 0], target: [10, 0, 6], zones: ['yard', 'unseen'], flashReach: 20 }),
    ];
    for (const cam of cameras) root.addChild(cam);
    root.object3d.updateMatrixWorld(true);

    flash = new THREE.SpotLight(0xffffff, 0);
    overlay = fakeOverlay();
    ready = new Set(['interior']);
    hooks = {
      setViewZones: vi.fn(),
      isReady: zone => ready.has(zone),
      holdPlayer: vi.fn(),
      listenFrom: vi.fn(),
    };
    crosshair = { show: vi.fn(), hide: vi.fn() };

    sounds = { servo: fakeSound(), static: fakeSound(), spotlight: fakeSound(), spotlightOff: fakeSound() };
    terminal = new CameraTerminal({ cameras, flash, overlay, hooks, crosshair, sounds });
    const desk = new GameObject('CameraTerminal');
    desk.scene = { userData: { engine } };
    desk.addComponent(terminal);
  });

  describe('entering and leaving', () => {
    it('starts idle, drawing through the player’s eyes', () => {
      expect(terminal.state).toBe('idle');
      expect(engine.viewCamera).toBeNull();
    });

    it('[E] on it puts the first camera on screen and holds the player still', () => {
      terminal.enter();
      expect(terminal.state).toBe('viewing');
      expect(engine.viewCamera).toBe(cameras[0].lens);
      expect(hooks.holdPlayer).toHaveBeenLastCalledWith(true);
      expect(hooks.setViewZones).toHaveBeenLastCalledWith(['interior']);
      expect(overlay.show).toHaveBeenCalled();
      expect(overlay.setCamera).toHaveBeenLastCalledWith({ index: 0, count: 2, label: 'ROOM' });
      expect(crosshair.hide).toHaveBeenCalled();
    });

    it('fits the lens to the screen and the render distance', () => {
      terminal.enter();
      frame();
      expect(cameras[0].lens.aspect).toBe(1.5);
      expect(cameras[0].lens.far).toBe(600);
    });

    it('Q steps back from the monitor and gives everything back', () => {
      terminal.enter();
      frame(['KeyQ']);
      expect(terminal.state).toBe('idle');
      expect(engine.viewCamera).toBeNull();
      expect(hooks.holdPlayer).toHaveBeenLastCalledWith(false);
      expect(hooks.setViewZones).toHaveBeenLastCalledWith(null);
      expect(overlay.hide).toHaveBeenCalled();
      expect(crosshair.show).toHaveBeenCalled();
    });

    it('a quick tap of Q counts, even when it is let go before the frame runs', () => {
      terminal.enter();
      engine.input.pressed.KeyQ = true;   // down and up between two frames
      terminal.onUpdate(1 / 60);
      expect(terminal.state).toBe('idle');
    });

    it('Esc steps back too', () => {
      terminal.enter();
      frame(['Escape']);
      expect(terminal.state).toBe('idle');
    });

    it('exit() while idle does nothing — it never takes a view camera it did not set', () => {
      engine.viewCamera = 'someone else';
      terminal.exit();
      expect(engine.viewCamera).toBe('someone else');
      expect(hooks.holdPlayer).not.toHaveBeenCalled();
    });

    it('a second enter while watching changes nothing', () => {
      terminal.enter();
      frame(['Digit2']);
      terminal.enter();
      expect(engine.viewCamera).toBe(cameras[1].lens);
    });
  });

  describe('power', () => {
    it('is dead without power, and says so', () => {
      const interact = createCameraInteractable(terminal);
      expect(interact).toBeInstanceOf(Interactable);
      terminal.setPowered(false);
      expect(interact.promptLabel).toMatch(/no power/i);
      terminal.enter();
      expect(terminal.state).toBe('idle');
      terminal.setPowered(true);
      expect(interact.promptLabel).toBe(terminal.promptLabel);
    });

    it('losing the power mid-watch drops the picture', () => {
      terminal.enter();
      terminal.setPowered(false);
      expect(terminal.state).toBe('idle');
      expect(engine.viewCamera).toBeNull();
    });

    it('the Interactable opens it', () => {
      const interact = createCameraInteractable(terminal);
      interact.onInteract({});
      expect(terminal.state).toBe('viewing');
    });
  });

  describe('switching cameras', () => {
    beforeEach(() => terminal.enter());

    it('a number key picks that camera, and asks for the zones it sees', () => {
      frame(['Digit2']);
      expect(engine.viewCamera).toBe(cameras[1].lens);
      expect(hooks.setViewZones).toHaveBeenLastCalledWith(['yard', 'unseen']);
      expect(overlay.setCamera).toHaveBeenLastCalledWith({ index: 1, count: 2, label: 'YARD' });
    });

    it('forward / back step through them', () => {
      frame(['KeyW']);
      expect(engine.viewCamera).toBe(cameras[1].lens);
      release('KeyW');
      frame(['KeyS']);
      expect(engine.viewCamera).toBe(cameras[0].lens);
    });

    it('a click on the map picks that camera', () => {
      expect(typeof overlay.onSelect).toBe('function');
      overlay.onSelect(1);
      expect(engine.viewCamera).toBe(cameras[1].lens);
      expect(overlay.setCamera).toHaveBeenLastCalledWith({ index: 1, count: 2, label: 'YARD' });
    });

    it('a click while away from the monitor does nothing', () => {
      terminal.exit();
      overlay.onSelect(1);
      expect(engine.viewCamera).toBeNull();
    });

    it('a number past the last camera is ignored', () => {
      frame(['Digit9']);
      expect(engine.viewCamera).toBe(cameras[0].lens);
    });
  });

  describe('the switch', () => {
    beforeEach(() => terminal.enter());

    it('plays a switch, then goes idle once the camera’s zones are in', () => {
      frame();
      expect(terminal.transition.active).toBe(true);
      run(CCTV.minStatic + SIGNAL.drop + SIGNAL.resolve + 0.1);
      expect(terminal.feed.live).toBe(true);
      expect(terminal.transition.phase).toBe('idle');
    });

    it('a yard camera holds the frozen frame until the yard has loaded, however long', () => {
      frame(['Digit2']);
      run(CCTV.minStatic * 4);
      expect(terminal.transition.phase).toBe('wait');
      expect(terminal.transition.frozen).toBe(true);
      ready.add('yard'); ready.add('unseen');
      frame();
      expect(terminal.transition.phase).toBe('resolve');
    });

    it('a long wait says CONNECTING, and stops saying it once the picture is in', () => {
      frame(['Digit2']);
      run(SIGNAL.drop + SIGNAL.longWait + 0.1);
      expect(overlay.setConnecting).toHaveBeenLastCalledWith(true);
      ready.add('yard'); ready.add('unseen');
      frame();
      expect(overlay.setConnecting).toHaveBeenLastCalledWith(false);
    });
  });

  describe('the switch, drawn (CameraSignalPass)', () => {
    let signal;
    /** A pass stand-in: holds the switch until the frame is "drawn". */
    function fakeSignal() {
      const pass = {
        pending: null,
        capture: vi.fn(fn => { pass.pending = fn; }),
        cancel: vi.fn(() => { pass.pending = null; }),
        set: vi.fn(), tick: vi.fn(),
        draw() { const fn = pass.pending; pass.pending = null; fn?.(); },
      };
      return pass;
    }

    beforeEach(() => {
      signal = fakeSignal();
      terminal.signal = signal;
    });

    it('sitting down covers the screen with blank grain at once: no frozen desk, nothing to capture', () => {
      terminal.enter();
      expect(signal.capture).not.toHaveBeenCalled();
      expect(terminal.transition.blank).toBe(true);
      expect(terminal.transition.active).toBe(true);
      // The cover is handed to the pass before the frame is drawn, so the
      // camera can go on screen at once underneath it.
      expect(signal.set).toHaveBeenLastCalledWith(terminal.transition);
      expect(engine.viewCamera).toBe(cameras[0].lens);
      expect(hooks.setViewZones).toHaveBeenLastCalledWith(['interior']);
    });

    it('a switch captures the old camera first, keeping its zones drawn for that frame', () => {
      terminal.enter();
      frame(['Digit2']);
      expect(engine.viewCamera).toBe(cameras[0].lens);
      expect(hooks.setViewZones).toHaveBeenLastCalledWith(['interior']);
      signal.draw();
      expect(engine.viewCamera).toBe(cameras[1].lens);
      expect(hooks.setViewZones).toHaveBeenLastCalledWith(['yard', 'unseen']);
    });

    it('the label changes at once; only the picture waits for its frame', () => {
      terminal.enter();
      frame(['Digit2']);
      expect(overlay.setCamera).toHaveBeenLastCalledWith({ index: 1, count: 2, label: 'YARD' });
    });

    it('hands the timeline to the pass every frame, with the frame time', () => {
      terminal.enter();
      frame();
      expect(signal.set).toHaveBeenLastCalledWith(terminal.transition);
      expect(signal.tick).toHaveBeenLastCalledWith(1 / 60);
    });

    it('leaving before the frame is drawn drops the switch: the player’s eyes stay', () => {
      terminal.enter();
      frame(['Digit2']);
      frame(['KeyQ']);
      expect(signal.cancel).toHaveBeenCalled();
      signal.draw();
      expect(engine.viewCamera).toBeNull();
      expect(terminal.transition.active).toBe(false);
      expect(signal.set).toHaveBeenLastCalledWith(terminal.transition);
    });
  });

  describe('panning', () => {
    beforeEach(() => terminal.enter());

    it('A turns the camera left, D right, within its range', () => {
      const before = cameras[0].lens.getWorldDirection(new THREE.Vector3());
      engine.input.keys.KeyA = true;
      run(0.3);
      release('KeyA');
      const after = cameras[0].lens.getWorldDirection(new THREE.Vector3());
      expect(cameras[0].pan.rotation.y).toBeGreaterThan(0);
      expect(after.angleTo(before)).toBeGreaterThan(0.1);

      engine.input.keys.KeyD = true;
      run(10);
      expect(cameras[0].pan.rotation.y).toBeCloseTo(-cameras[0].panRange);
    });

    it('the arrow keys pan too', () => {
      engine.input.keys.ArrowLeft = true;
      run(0.2);
      expect(cameras[0].pan.rotation.y).toBeGreaterThan(0);
    });
  });

  describe('the flash', () => {
    beforeEach(() => terminal.enter());

    it('F lights a bright spotlight from the camera, along its view', () => {
      frame(['KeyF']);
      expect(flash.intensity).toBe(CAMERA_FLASH.intensity);
      expect(flash.distance).toBe(9);
      const lens = cameras[0].lens;
      const at = lens.getWorldPosition(new THREE.Vector3());
      expect(flash.position.distanceTo(at)).toBeLessThan(1e-6);
      const aim = flash.target.position.clone().sub(flash.position).normalize();
      expect(aim.distanceTo(lens.getWorldDirection(new THREE.Vector3()))).toBeLessThan(1e-6);
      expect(overlay.setFlash).toHaveBeenLastCalledWith(true);
    });

    it('uses up the F press, so the player’s own torch does not toggle with it', () => {
      frame(['KeyF']);
      expect(engine.consumeAction).toHaveBeenCalledWith('flashlight');
    });

    it('follows the camera as it pans', () => {
      frame(['KeyF']);
      engine.input.keys.KeyA = true;
      run(0.3);
      const aim = flash.target.position.clone().sub(flash.position).normalize();
      expect(aim.distanceTo(cameras[0].lens.getWorldDirection(new THREE.Vector3()))).toBeLessThan(1e-6);
    });

    it('F again puts it out', () => {
      frame(['KeyF']);
      release('KeyF');
      frame(['KeyF']);
      expect(flash.intensity).toBe(0);
    });

    it('goes out when the view moves to another camera', () => {
      frame(['KeyF']);
      frame(['Digit2']);
      expect(flash.intensity).toBe(0);
      expect(overlay.setFlash).toHaveBeenLastCalledWith(false);
    });

    it('goes out when the player leaves the monitor', () => {
      frame(['KeyF']);
      release('KeyF');
      frame(['KeyQ']);
      expect(flash.intensity).toBe(0);
    });

    it('is zeroed, never hidden: the light count stays what the shaders were built for', () => {
      frame(['KeyF']);
      frame(['KeyQ']);
      expect(flash.visible).toBe(true);
    });
  });

  describe('sound', () => {
    it('the hiss follows the picture: up through the wait, dying away as it resolves, gone after', () => {
      terminal.enter();
      frame(['Digit2']);                         // the yard: a wait
      run(SIGNAL.drop + 0.3);
      expect(sounds.static.isPlaying).toBe(true);
      expect(sounds.static.volume).toBeCloseTo(CAMERA_SOUNDS.static, 2);
      ready.add('yard'); ready.add('unseen');
      frame();
      run(SIGNAL.hissOut + 0.1);                // a short tail, not a long fade
      expect(sounds.static.isPlaying).toBe(false);
    });

    it('is quiet: a hiss under the picture', () => {
      expect(CAMERA_SOUNDS.static).toBeLessThanOrEqual(0.2);
    });

    it('a switch brings the hiss back', () => {
      terminal.enter();
      run(CCTV.minStatic + SIGNAL.drop + SIGNAL.resolve + 0.3);
      expect(sounds.static.isPlaying).toBe(false);
      frame(['Digit2']);
      run(0.1);
      expect(sounds.static.isPlaying).toBe(true);
    });

    it('the servo whirs while a camera turns, faintly, and not once it stops', () => {
      terminal.enter();
      engine.input.keys.KeyA = true;
      frame();
      expect(sounds.servo.isPlaying).toBe(true);
      release('KeyA');
      frame();
      expect(sounds.servo.isPlaying).toBe(false);
    });

    it('at the levels asked for: the servo faint, the flash softer than its file', () => {
      expect(CAMERA_SOUNDS.servo).toBe(0.14);
      expect(CAMERA_SOUNDS.spotlight).toBe(0.4);
      expect(sounds.servo.volume).toBe(0.14);
      expect(sounds.spotlight.volume).toBe(0.4);
      expect(sounds.spotlightOff.volume).toBe(CAMERA_SOUNDS.spotlightOff);
    });

    it('nor while a key is held against the end of the camera’s travel', () => {
      terminal.enter();
      engine.input.keys.KeyD = true;
      run(10);
      expect(sounds.servo.isPlaying).toBe(false);
    });

    it('the flash clicks on as it lights, and clicks off as F puts it out', () => {
      terminal.enter();
      frame(['KeyF']);
      expect(sounds.spotlight.plays).toBe(1);
      expect(sounds.spotlightOff.plays).toBe(0);
      release('KeyF');
      frame(['KeyF']);
      expect(sounds.spotlight.plays).toBe(1);
      expect(sounds.spotlightOff.plays).toBe(1);
    });

    it('a flash put out by a switch or by leaving clicks off too, cutting the on sound short', () => {
      terminal.enter();
      frame(['KeyF']);
      frame(['Digit2']);
      expect(sounds.spotlightOff.plays).toBe(1);
      expect(sounds.spotlight.isPlaying).toBe(false);
      release('KeyF', 'Digit2');
      frame(['KeyF']);
      frame(['KeyQ']);
      expect(sounds.spotlightOff.plays).toBe(2);
    });

    it('no off click when the flash was never on', () => {
      terminal.enter();
      frame(['Digit2']);
      frame(['KeyQ']);
      expect(sounds.spotlightOff.plays).toBe(0);
    });

    it('leaving the monitor stops every loop', () => {
      terminal.enter();
      engine.input.keys.KeyA = true;
      frame();
      frame(['KeyQ']);
      expect(sounds.static.isPlaying).toBe(false);
      expect(sounds.servo.isPlaying).toBe(false);
    });

    it('silence() stops the loops (the game paused: nothing updates, the audio clock runs on)', () => {
      terminal.enter();
      frame(['Digit2']);                         // a wait, so a hiss
      run(0.2);
      expect(sounds.static.isPlaying).toBe(true);
      terminal.silence();
      expect(sounds.static.isPlaying).toBe(false);
      frame();                                   // resumed, still coming in
      expect(sounds.static.isPlaying).toBe(true);
    });

    describe('hearing what the camera on screen hears (hooks.listenFrom)', () => {
      const heard = () => hooks.listenFrom.mock.lastCall;

      it('from its lens, in full once its picture is live', () => {
        terminal.enter();
        run(CCTV.minStatic + SIGNAL.drop + SIGNAL.resolve + 0.3);
        expect(heard()).toEqual([cameras[0].lens, 1]);
      });

      it('cut under the static of a switch, and back from the new camera with its picture', () => {
        terminal.enter();
        run(CCTV.minStatic + SIGNAL.drop + SIGNAL.resolve + 0.3);
        frame(['Digit2']);
        run(0.3);                                // the yard is still loading
        expect(heard()[1]).toBe(0);
        ready.add('yard'); ready.add('unseen');
        run(SIGNAL.resolve + 0.1);
        expect(heard()).toEqual([cameras[1].lens, 1]);
      });

      it('the player’s own ears again on leaving the monitor', () => {
        terminal.enter();
        run(0.5);
        frame(['KeyQ']);
        expect(heard()).toEqual([null, 0]);
      });
    });

    it('works with no sounds at all (tests, a failed load)', () => {
      const bare = new CameraTerminal({ cameras, hooks });
      const go = new GameObject('Bare');
      go.scene = { userData: { engine } };
      go.addComponent(bare);
      bare.enter();
      expect(() => { bare.onUpdate(1 / 60); bare.silence(); bare.exit(); }).not.toThrow();
    });
  });
});
