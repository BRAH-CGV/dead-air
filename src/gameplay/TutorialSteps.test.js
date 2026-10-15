import { describe, it, expect, vi } from 'vitest';
import { TUTORIAL_STEPS, TutorialRunner, COMPUTER_HINT } from './TutorialSteps.js';

// ─────────────────────────────────────────────
// TutorialSteps — night 0's steps, one at a time (pure)
// ─────────────────────────────────────────────

/** Nothing done yet: the drive out, the computer off, the power on. */
const fresh = (over = {}) => ({
  driveIn: false, terminalOpen: false, onSignal: false, scanning: false, scanned: false,
  saved: false, boxed: false, quotaMet: false, powerOn: true, suitOn: false,
  napping: false, morning: false, ...over,
});

const ids = () => TUTORIAL_STEPS.map(s => s.id);

/** A runner moved on to the step `id`, its intro cards played out. */
function at(id, ctx = fresh()) {
  const runner = new TutorialRunner();
  const intro = TUTORIAL_STEPS.filter(s => s.seconds && ids().indexOf(s.id) < ids().indexOf('drive'));
  for (const card of intro) runner.update(card.seconds + 0.01, ctx);
  while (runner.step.id !== id) runner.update(0.01, { ...ctx, ...doneFor(runner.step) });
  return runner;
}

/** What makes the step `step` done, for walking past it. */
function doneFor(step) {
  return {
    drive: { driveIn: true }, computer: { terminalOpen: true }, aim: { onSignal: true },
    scan: { scanned: true }, save: { saved: true }, box: { boxed: true }, dock: { quotaMet: true },
    storm: { powerOn: false }, suit: { suitOn: true }, generator: { powerOn: true },
  }[step.id] ?? {};
}

describe('TUTORIAL_STEPS', () => {
  it('teaches the signal game, then the storm, then the nap and the sleep, in that order', () => {
    const order = ['drive', 'computer', 'aim', 'scan', 'save', 'box', 'dock', 'storm', 'suit', 'generator', 'inside', 'nap', 'wait', 'sleep'];
    const positions = order.map(id => ids().indexOf(id));
    expect(positions.every(p => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('opens on the story, in timed cards', () => {
    const first = TUTORIAL_STEPS[0];
    expect(first.seconds).toBeGreaterThan(0);
    expect(first.title).toMatch(/NIGHT 0/);
  });

  it('every step has big words and a line under them, and ends on a timer or a test', () => {
    for (const step of TUTORIAL_STEPS) {
      expect(step.title, step.id).toBe(step.title.toUpperCase());
      expect(step.text.length, step.id).toBeGreaterThan(0);
      expect(!!step.seconds !== !!step.done, step.id).toBe(true);
    }
  });

  it('ids are unique', () => {
    expect(new Set(ids()).size).toBe(TUTORIAL_STEPS.length);
  });
});

describe('TutorialRunner', () => {
  it('plays each intro card for its seconds', () => {
    const runner = new TutorialRunner();
    const first = TUTORIAL_STEPS[0];
    runner.update(first.seconds - 0.1, fresh());
    expect(runner.step.id).toBe(first.id);
    runner.update(0.2, fresh());
    expect(runner.step.id).toBe(TUTORIAL_STEPS[1].id);
  });

  it('waits on a step until its test passes', () => {
    const runner = at('drive');
    runner.update(30, fresh());
    expect(runner.step.id).toBe('drive');
    runner.update(0.01, fresh({ driveIn: true }));
    expect(runner.step.id).toBe('computer');
  });

  it('skips past steps the player has already done', () => {
    const runner = at('drive');
    runner.update(0.01, fresh({ driveIn: true, terminalOpen: true }));
    expect(runner.step.id).toBe('aim');
  });

  it('calls onEnter once for every step it enters, the first included', () => {
    const onEnter = vi.fn();
    const runner = new TutorialRunner({ onEnter });
    runner.update(0.01, fresh());
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onEnter.mock.calls[0][0].id).toBe(TUTORIAL_STEPS[0].id);
    runner.update(0.01, fresh());
    expect(onEnter).toHaveBeenCalledTimes(1);
    runner.update(TUTORIAL_STEPS[0].seconds, fresh());
    expect(onEnter).toHaveBeenCalledTimes(2);
    expect(onEnter.mock.calls[1][0].id).toBe(TUTORIAL_STEPS[1].id);
  });

  it('a skip still enters each step on the way', () => {
    const entered = [];
    const runner = at('drive');
    runner.onEnter = step => entered.push(step.id);
    runner.update(0.01, fresh({ driveIn: true, terminalOpen: true }));
    expect(entered).toEqual(['computer', 'aim']);
  });

  it('the storm step waits for the power to go, the suit and generator steps get it back', () => {
    const runner = at('storm');
    runner.update(0.01, fresh());
    expect(runner.step.id).toBe('storm');
    runner.update(0.01, fresh({ powerOn: false }));
    expect(runner.step.id).toBe('suit');
    runner.update(0.01, fresh({ powerOn: false, suitOn: true }));
    expect(runner.step.id).toBe('generator');
    runner.update(0.01, fresh({ powerOn: true, suitOn: true }));
    expect(runner.step.id).toBe('inside');
    runner.update(0.01, fresh());
    expect(runner.step.id).toBe('nap');
  });

  it('a nap, or the morning, moves on; then it waits at the bed for the next night', () => {
    const runner = at('nap');
    runner.update(0.01, fresh({ napping: true }));
    expect(runner.step.id).toBe('wait');
    runner.update(0.01, fresh({ morning: true }));
    expect(runner.step.id).toBe('sleep');
    runner.update(60, fresh({ morning: true }));
    expect(runner.step.id).toBe('sleep');
    expect(runner.finished).toBe(false);
  });

  it('goTo(id) jumps to a step, and enters it', () => {
    const entered = [];
    const runner = new TutorialRunner({ onEnter: step => entered.push(step.id) });
    runner.goTo('box');
    expect(runner.step.id).toBe('box');
    expect(runner.elapsed).toBe(0);
    expect(entered).toEqual(['box']);
    runner.update(0.01, fresh());
    expect(entered).toEqual(['box']);       // not entered twice
  });

  it('reset() starts over', () => {
    const runner = at('box');
    runner.reset();
    expect(runner.step.id).toBe(TUTORIAL_STEPS[0].id);
  });
});

describe('TutorialRunner.view', () => {
  it('shows the step: its words and where its arrow points', () => {
    const runner = at('drive');
    const view = runner.view(fresh());
    expect(view.title).toBe('PUT A DRIVE IN THE READER');
    expect(view.target).toBe('reader');
    expect(view.compact).toBe(false);
  });

  it('small, at the top, while the computer is up, so the radar shows', () => {
    const runner = at('aim', fresh({ driveIn: true, terminalOpen: true }));
    const view = runner.view(fresh({ driveIn: true, terminalOpen: true }));
    expect(view.title).toBe('FIND THE SIGNAL');
    expect(view.compact).toBe(true);
    expect(view.target).toBe(null);
  });

  it('a step at the computer, with the player away from it, points back to it', () => {
    const runner = at('scan', fresh({ driveIn: true, terminalOpen: true }));
    const view = runner.view(fresh({ driveIn: true }));
    expect(view.title).toBe(COMPUTER_HINT.title);
    expect(view.target).toBe('computer');
  });

  it('no arrow on the story cards', () => {
    const runner = new TutorialRunner();
    runner.update(0.01, fresh());
    expect(runner.view(fresh()).target).toBe(null);
  });

  it('reuses one view object (no garbage a frame)', () => {
    const runner = at('drive');
    expect(runner.view(fresh())).toBe(runner.view(fresh()));
  });
});
