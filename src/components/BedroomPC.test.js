import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BedroomPC, PC_CLICK } from './BedroomPC.js';
import { RunRecord } from '../gameplay/RunRecord.js';

vi.mock('../ui/paintDom.js', () => ({ paintDom: vi.fn() }));
import { paintDom } from '../ui/paintDom.js';

const MAP = { base: { x: 100, y: 100 }, neighbours: [], route: [], hub: null };

function setup() {
  const consumed = new Set();
  const engine = {
    timeScale: 1,
    input: { keys: {}, pressed: {} },
    keyBinds: { interact: 'KeyE' },
    playerController: { inputLocked: false },
    consumeAction: vi.fn((action) => {
      const code = engine.keyBinds[action];
      engine.input.pressed[code] = false;
      consumed.add(code);
    }),
  };
  const run = new RunRecord();
  run.reset({ array: 'ARRAY K-17' });
  const pc = new BedroomPC();
  pc.controller = { nightNumber: 1, state: 'playing', nights: { isLastNight: () => false } };
  pc.forecast = vi.fn((night) => (night >= 2 ? ['storm', 'eyes'] : ['storm']));
  pc.panel = { show: vi.fn(), hide: vi.fn(), setScreen: vi.fn(), step: vi.fn(), visible: false };
  pc.run = run;
  pc.map = MAP;
  pc.gameObject = { scene: { userData: { engine } } };
  return { engine, pc, run };
}

/** One frame with `code` freshly pressed (and held), then let go. */
function press(engine, pc, code) {
  engine.input.keys[code] = true;
  engine.input.pressed[code] = true;
  pc.onUpdate(1 / 60);
  engine.input.pressed = {};
  engine.input.keys[code] = false;
}

describe('BedroomPC (#114)', () => {
  let engine, pc, run;
  beforeEach(() => ({ engine, pc, run } = setup()));

  it('offers to be used', () => {
    expect(pc.promptLabel).toBe('[E] Use the computer');
  });

  it('opens the panel on the colony map, under the array\'s name, and holds the player still', () => {
    pc.onInteract();
    expect(pc.open).toBe(true);
    expect(pc.panel.show).toHaveBeenCalledWith({
      array: 'ARRAY K-17',
      map: MAP,
      log: { night: 0, entries: null },
      forecast: { night: 1, tonight: true, kinds: ['storm'] },
    });
    expect(engine.playerController.inputLocked).toBe(true);
  });

  it('does not slow time: the night goes on while you read', () => {
    pc.onInteract();
    expect(engine.timeScale).toBe(1);
  });

  it("through the shift: last night's log, and tonight's forecast", () => {
    run.logThreats(1, [{ kind: 'storm', hour: -2 }]);
    pc.controller.nightNumber = 2;
    pc.onInteract();
    const { log, forecast } = pc.panel.show.mock.calls[0][0];
    expect(log).toEqual({ night: 1, entries: [{ kind: 'storm', hour: -2 }] });
    expect(forecast).toEqual({ night: 2, tonight: true, kinds: ['storm', 'eyes'] });
  });

  it("in the morning: the night just survived, and the next shift's forecast", () => {
    run.logThreats(2, [{ kind: 'eyes', hour: 3 }]);
    pc.controller.nightNumber = 2;
    pc.controller.state = 'morning';
    pc.onInteract();
    const { log, forecast } = pc.panel.show.mock.calls[0][0];
    expect(log).toEqual({ night: 2, entries: [{ kind: 'eyes', hour: 3 }] });
    expect(forecast).toEqual({ night: 3, tonight: false, kinds: ['storm', 'eyes'] });
  });

  it('the morning after the last shift forecasts nothing', () => {
    pc.controller.nightNumber = 3;
    pc.controller.state = 'morning';
    pc.controller.nights.isLastNight = () => true;
    pc.onInteract();
    expect(pc.panel.show.mock.calls[0][0].forecast).toBeNull();
  });

  it('night 0 has no night before it', () => {
    pc.controller.nightNumber = 0;
    pc.onInteract();
    expect(pc.panel.show.mock.calls[0][0].log).toBeNull();
  });

  it('works without a run record or a forecast: no name, no log, no forecast', () => {
    pc.run = null;
    pc.forecast = null;
    pc.onInteract();
    expect(pc.panel.show).toHaveBeenCalledWith({ array: null, map: MAP, log: { night: 0, entries: null }, forecast: null });
  });

  it('uses up the press that opened it, so it neither closes again nor reaches anything else', () => {
    engine.input.keys.KeyE = true;
    engine.input.pressed.KeyE = true;
    pc.onInteract();
    expect(engine.consumeAction).toHaveBeenCalledWith('interact');
    pc.onUpdate(1 / 60);
    expect(pc.open).toBe(true);
  });

  it('a fresh E puts it away, the player free again, and that press is used up', () => {
    pc.onInteract();
    engine.consumeAction.mockClear();
    press(engine, pc, 'KeyE');
    expect(pc.open).toBe(false);
    expect(pc.panel.hide).toHaveBeenCalled();
    expect(engine.playerController.inputLocked).toBe(false);
    expect(engine.consumeAction).toHaveBeenCalledWith('interact');
  });

  it('Q puts it away too, as at the terminal', () => {
    pc.onInteract();
    press(engine, pc, 'KeyQ');
    expect(pc.open).toBe(false);
  });

  it('1 and 2 pick a screen; ← and → step through them', () => {
    pc.onInteract();
    press(engine, pc, 'Digit2');
    expect(pc.panel.setScreen).toHaveBeenLastCalledWith('threats');
    press(engine, pc, 'Digit3');   // no third screen
    expect(pc.panel.setScreen).toHaveBeenCalledTimes(1);
    press(engine, pc, 'Digit1');
    expect(pc.panel.setScreen).toHaveBeenLastCalledWith('colony');
    press(engine, pc, 'ArrowRight');
    expect(pc.panel.step).toHaveBeenLastCalledWith(1);
    press(engine, pc, 'ArrowLeft');
    expect(pc.panel.step).toHaveBeenLastCalledWith(-1);
  });

  describe('a key click as the screen changes', () => {
    const SCREENS = ['colony', 'threats'];
    let click;
    beforeEach(() => {
      click = { isPlaying: false, play: vi.fn(function () { this.isPlaying = true; }), stop: vi.fn(function () { this.isPlaying = false; }),
        setVolume: vi.fn(), setDetune: vi.fn() };
      pc.click = click;
      pc.panel.screen = 'colony';
      pc.panel.setScreen = vi.fn(n => { pc.panel.screen = n; });
      pc.panel.step = vi.fn(d => { pc.panel.screen = SCREENS[(SCREENS.indexOf(pc.panel.screen) + d + 2) % 2]; });
      pc.onInteract();
    });

    it('clicks when a number or an arrow changes the screen', () => {
      press(engine, pc, 'Digit2');
      expect(click.play).toHaveBeenCalledTimes(1);
      press(engine, pc, 'ArrowRight');
      expect(click.play).toHaveBeenCalledTimes(2);
    });

    it('not when the screen asked for is the one already up', () => {
      press(engine, pc, 'Digit1');
      expect(click.play).not.toHaveBeenCalled();
    });

    it('quiet, and each press a touch apart in pitch, as real keys are', () => {
      press(engine, pc, 'Digit2');
      press(engine, pc, 'Digit1');
      expect(click.setVolume.mock.lastCall[0]).toBeLessThanOrEqual(0.2);
      for (const [cents] of click.setDetune.mock.calls) {
        expect(Math.abs(cents - PC_CLICK.detune)).toBeLessThanOrEqual(PC_CLICK.spread);
      }
    });

    it('a click still sounding is started over, not doubled', () => {
      press(engine, pc, 'Digit2');
      press(engine, pc, 'Digit1');
      expect(click.stop).toHaveBeenCalledTimes(1);
    });
  });

  it('reads no keys while it is put away', () => {
    press(engine, pc, 'Digit2');
    press(engine, pc, 'KeyQ');
    expect(pc.panel.setScreen).not.toHaveBeenCalled();
    expect(pc.panel.hide).not.toHaveBeenCalled();
  });

  it('can be used in the morning as well as through the shift', () => {
    pc.controller.state = 'morning';
    pc.onInteract();
    expect(pc.open).toBe(true);
  });

  it('will not open behind a failed night', () => {
    pc.controller.state = 'gameOver';
    pc.onInteract();
    expect(pc.open).toBe(false);
    expect(pc.panel.show).not.toHaveBeenCalled();
  });

  it('puts itself away when the night fails under it (a threat while reading)', () => {
    pc.onInteract();
    pc.controller.state = 'gameOver';
    pc.onUpdate(1 / 60);
    expect(pc.open).toBe(false);
    expect(engine.playerController.inputLocked).toBe(false);
  });

  it("its state is 'reading' while open and 'idle' otherwise, like the desk's screens", () => {
    expect(pc.state).toBe('idle');
    pc.onInteract();
    expect(pc.state).toBe('reading');
    pc.close();
    expect(pc.state).toBe('idle');
  });

  it('a second interact while open changes nothing', () => {
    pc.onInteract();
    pc.onInteract();
    expect(pc.panel.show).toHaveBeenCalledTimes(1);
  });

  it('puts itself away when the scene is torn down', () => {
    pc.onInteract();
    pc.onDestroy();
    expect(pc.open).toBe(false);
    expect(pc.panel.hide).toHaveBeenCalled();
    expect(engine.playerController.inputLocked).toBe(false);
  });

  it('works with no panel or engine (a headless room)', () => {
    const bare = new BedroomPC();
    expect(() => { bare.onInteract(); bare.onUpdate(1 / 60); bare.close(); bare.onDestroy(); }).not.toThrow();
  });

  describe('on its own screen (#161)', () => {
    let view, surface;
    beforeEach(() => {
      view = { open: vi.fn(), close: vi.fn() };
      surface = {};
      pc.panel.root = {};
      pc.panel.render = vi.fn();
      pc.screenView = view;
      pc.screen = surface;
      paintDom.mockClear();
    });

    it('leans in to its screen, the panel on it', () => {
      pc.onInteract();
      expect(view.open).toHaveBeenCalledWith(surface, pc.panel.root);
    });

    it('keeps the panel up while leaning back out, and puts it away once out', () => {
      pc.onInteract();
      pc.close();
      expect(view.close).toHaveBeenCalledTimes(1);
      expect(pc.panel.hide).not.toHaveBeenCalled();
      view.close.mock.calls[0][0]();
      expect(pc.panel.hide).toHaveBeenCalled();
      expect(engine.playerController.inputLocked).toBe(false);   // free at once
    });

    it('its screen shows the panel, drawn for tonight, whether or not anyone is at it', () => {
      const ctx = {};
      pc.paintScreen(ctx, 1226, 720);
      expect(pc.panel.render).toHaveBeenCalledWith(pc._data());
      expect(paintDom).toHaveBeenCalledWith(pc.panel.root, ctx, 1226, 720);
    });

    it('draws the panel again only when what it shows changes', () => {
      pc.paintScreen({}, 1226, 720);
      pc.paintScreen({}, 1226, 720);
      expect(pc.panel.render).toHaveBeenCalledTimes(1);
      pc.controller.nightNumber = 2;
      pc.paintScreen({}, 1226, 720);
      expect(pc.panel.render).toHaveBeenCalledTimes(2);
      pc.controller.state = 'morning';   // the log and forecast move on a night
      pc.paintScreen({}, 1226, 720);
      expect(pc.panel.render).toHaveBeenCalledTimes(3);
      run.logThreats(2, [{ kind: 'storm', hour: 0 }]);   // the night's log written
      pc.paintScreen({}, 1226, 720);
      expect(pc.panel.render).toHaveBeenCalledTimes(4);
    });

    it('works the forecast out only when it redraws, not every frame', () => {
      pc.paintScreen({}, 1226, 720);
      pc.paintScreen({}, 1226, 720);
      pc.paintScreen({}, 1226, 720);
      expect(pc.forecast).toHaveBeenCalledTimes(1);
    });
  });
});
