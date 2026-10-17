import { describe, it, expect, vi } from 'vitest';
import { TUTORIAL_STEPS, TutorialRunner, COMPUTER_HINT, SKIP_NOTE } from './TutorialSteps.js';

// ─────────────────────────────────────────────
// TutorialSteps — night 0's steps, one at a time (pure)
// ─────────────────────────────────────────────

/** Nothing done yet: the drive out, the computer off, the power on. */
const fresh = (over = {}) => ({
  holdingBox: false, boxOnDesk: false, flashlightOn: false,
  driveIn: false, terminalOpen: false, onSignal: false, scanning: false, scanned: false,
  saved: false, boxed: false, quotaMet: false, powerOn: true, suitOn: false,
  napping: false, morning: false, boxInBuggy: false, dispatched: false, ...over,
});

const ids = () => TUTORIAL_STEPS.map(s => s.id);

/** A runner moved on to the step `id`, each step before it done in turn.
 *  What is done stays done, as in the game: a step already done when it is
 *  reached is passed straight on, so a fresh ctx at every step would run on
 *  past `id`. */
function at(id, ctx = fresh()) {
  const target = ids().indexOf(id);
  if (target < 0) throw new Error(`no step '${id}'`);
  const runner = new TutorialRunner();
  let state = { ...ctx };
  runner.update(0.01, state);
  while (runner.step?.id !== id) {
    if (runner.finished || ids().indexOf(runner.step.id) > target) {
      throw new Error(`ran past '${id}' to '${runner.step?.id ?? 'the end'}'`);
    }
    const step = runner.step;
    state = { ...state, ...doneFor(step) };
    runner.update(step.seconds ? step.seconds + 0.01 : 0.01, state);
  }
  return runner;
}

/** What makes the step `step` done, for walking past it. */
function doneFor(step) {
  return {
    deskBox: { boxOnDesk: true }, flashlight: { flashlightOn: true },
    drive: { driveIn: true }, computer: { terminalOpen: true }, aim: { onSignal: true },
    scan: { scanned: true }, save: { saved: true, terminalOpen: false }, box: { boxed: true },
    dock: { quotaMet: true }, storm: { powerOn: false }, flashlight: { flashlightOn: true },
    suit: { suitOn: true }, generator: { powerOn: true }, inside: { suitOn: false },
    nap: { napping: true }, wait: { morning: true }, buggy: { dispatched: true },
  }[step.id] ?? {};
}

describe('TUTORIAL_STEPS', () => {
  it('teaches the signal game, then the storm, then the nap and the sleep, in that order', () => {
    const order = ['deskBox', 'drive', 'computer', 'aim', 'scan', 'save', 'box', 'dock',
      'storm', 'flashlight', 'suit', 'generator', 'inside', 'nap', 'wait', 'buggy', 'sleep'];
    const positions = order.map(id => ids().indexOf(id));
    expect(positions.every(p => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('opens straight on the first job: the story is the intro animation\'s, not told again here', () => {
    expect(TUTORIAL_STEPS[0].id).toBe('deskBox');
    const firstJob = ids().indexOf('deskBox');
    expect(TUTORIAL_STEPS.slice(0, firstJob)).toEqual([]);
    expect(TUTORIAL_STEPS.some(s => /NIGHT 0|COLONY|LISTEN TO THE SKY/.test(s.title))).toBe(false);
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
  it('plays a timed card for its seconds', () => {
    const runner = at('quota');
    const quota = TUTORIAL_STEPS.find(t => t.id === 'quota');
    runner.update(quota.seconds - 0.1, fresh({ quotaMet: true }));
    expect(runner.step.id).toBe('quota');
    runner.update(0.2, fresh({ quotaMet: true }));
    expect(runner.step.id).toBe('storm');
  });

  it('first a drive box on the desk: the arrow is on the box, then on the desk while it is carried', () => {
    const runner = at('deskBox');
    expect(runner.view(fresh()).target).toBe('box');
    expect(runner.view(fresh({ holdingBox: true })).target).toBe('desk');
    runner.update(0.01, fresh({ holdingBox: true }));
    expect(runner.step.id).toBe('deskBox');
    runner.update(0.01, fresh({ boxOnDesk: true }));
    expect(runner.step.id).toBe('drive');
  });

  it('a drive carried straight to the reader passes the box step too', () => {
    const runner = at('deskBox');
    runner.update(0.01, fresh({ driveIn: true }));
    expect(runner.step.id).toBe('computer');
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
    runner.update(0.01, fresh({ boxOnDesk: true }));
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
    expect(runner.step.id).toBe('flashlight');
    runner.update(0.01, fresh({ powerOn: false, flashlightOn: true }));
    expect(runner.step.id).toBe('suit');
    runner.update(0.01, fresh({ powerOn: false, suitOn: true }));
    expect(runner.step.id).toBe('generator');
    runner.update(0.01, fresh({ powerOn: true, suitOn: true }));
    expect(runner.step.id).toBe('inside');
    runner.update(0.01, fresh());
    expect(runner.step.id).toBe('nap');
  });

  it('the dark asks for the flashlight, unless it is already on', () => {
    const runner = at('storm', fresh({ flashlightOn: true }));
    runner.update(0.01, fresh({ powerOn: false, flashlightOn: true }));
    expect(runner.step.id).toBe('suit');
    const step = TUTORIAL_STEPS.find(t => t.id === 'flashlight');
    expect(step.text).toContain('[F]');
  });

  it('the nap is until 6 AM, and if woken early the player is sent back to bed', () => {
    const nap = TUTORIAL_STEPS.find(t => t.id === 'nap');
    expect(nap.text).toMatch(/6 AM/);
    expect(nap.target).toBe('bed');
    const wait = TUTORIAL_STEPS.find(t => t.id === 'wait');
    expect(wait.text).toMatch(/6 AM/);
    expect(wait.target).toBe('bed');
  });

  it('a nap, or the morning, moves on; the buggy goes off, then it waits at the bed for the next night', () => {
    const runner = at('nap');
    runner.update(0.01, fresh({ napping: true }));
    expect(runner.step.id).toBe('wait');
    runner.update(0.01, fresh({ morning: true }));
    expect(runner.step.id).toBe('buggy');
    runner.update(60, fresh({ morning: true, boxInBuggy: true }));
    expect(runner.step.id).toBe('buggy');           // loaded, not yet sent off
    runner.update(0.01, fresh({ morning: true, boxInBuggy: true, dispatched: true }));
    expect(runner.step.id).toBe('sleep');
    runner.update(60, fresh({ morning: true, dispatched: true }));
    expect(runner.step.id).toBe('sleep');
    expect(runner.finished).toBe(false);
  });

  it('the buggy step points at the dock, then at the buggy once the box is in hand or in its boot', () => {
    const runner = at('buggy', fresh({ morning: true }));
    expect(runner.view(fresh({ morning: true })).target).toBe('dock');
    expect(runner.view(fresh({ morning: true, holdingBox: true })).target).toBe('buggy');
    expect(runner.view(fresh({ morning: true, boxInBuggy: true })).target).toBe('buggy');
    const step = TUTORIAL_STEPS.find(t => t.id === 'buggy');
    expect(step.text).toMatch(/suit/i);
    expect(step.text).toContain('[E]');
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

  it('no arrow on a timed card', () => {
    const runner = at('quota');
    expect(runner.view(fresh({ quotaMet: true })).target).toBe(null);
  });

  it('the skip line is under the first step, and stays, until the nap', () => {
    expect(SKIP_NOTE).toMatch(/6 AM/);
    expect(SKIP_NOTE).toMatch(/skip the tutorial/i);
    const runner = new TutorialRunner();
    runner.update(0.01, fresh());
    expect(runner.view(fresh()).note).toBe(SKIP_NOTE);
    expect(runner.skippable).toBe(true);
    for (const id of ['computer', 'aim', 'quota', 'storm', 'generator', 'inside']) {
      const later = at(id);
      expect(later.view(fresh()).note, id).toBe(SKIP_NOTE);
      expect(later.view(fresh({ terminalOpen: true })).note, `${id}, at the computer`).toBe(SKIP_NOTE);
      expect(later.skippable, id).toBe(true);
    }
  });

  it('from the nap on, sleeping until 6 AM is the lesson itself: no skip line', () => {
    for (const id of ['nap', 'wait', 'buggy', 'sleep']) {
      const runner = at(id);
      expect(runner.view(fresh()).note, id).toBe('');
      expect(runner.skippable, id).toBe(false);
    }
  });

  it('reuses one view object (no garbage a frame)', () => {
    const runner = at('drive');
    expect(runner.view(fresh())).toBe(runner.view(fresh()));
  });
});
