import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BedroomPC } from './BedroomPC.js';
import { RunRecord } from '../gameplay/RunRecord.js';

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
  pc.controller = { nightNumber: 1, state: 'playing' };
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
    expect(pc.panel.show).toHaveBeenCalledWith({ array: 'ARRAY K-17', map: MAP, findings: [] });
    expect(engine.playerController.inputLocked).toBe(true);
  });

  it('does not slow time: the night goes on while you read', () => {
    pc.onInteract();
    expect(engine.timeScale).toBe(1);
  });

  it("shows what the hub sent back from earlier nights' send-offs, not tonight's", () => {
    run.deliver(1, 2);
    run.deliver(2, 1);
    pc.controller.nightNumber = 2;
    pc.onInteract();
    expect(pc.panel.show.mock.calls[0][0].findings).toEqual([{ night: 1, index: 1 }, { night: 1, index: 2 }]);
  });

  it('works without a run record: no name, nothing back', () => {
    pc.run = null;
    pc.onInteract();
    expect(pc.panel.show).toHaveBeenCalledWith({ array: null, map: MAP, findings: [] });
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

  it('1, 2 and 3 pick a screen; ← and → step through them', () => {
    pc.onInteract();
    press(engine, pc, 'Digit2');
    expect(pc.panel.setScreen).toHaveBeenLastCalledWith('findings');
    press(engine, pc, 'Digit3');
    expect(pc.panel.setScreen).toHaveBeenLastCalledWith('forecast');
    press(engine, pc, 'Digit1');
    expect(pc.panel.setScreen).toHaveBeenLastCalledWith('colony');
    press(engine, pc, 'ArrowRight');
    expect(pc.panel.step).toHaveBeenLastCalledWith(1);
    press(engine, pc, 'ArrowLeft');
    expect(pc.panel.step).toHaveBeenLastCalledWith(-1);
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
});
