import { describe, it, expect, beforeEach } from 'vitest';
import { ThreatWatch } from './ThreatWatch.js';
import { RunRecord } from './RunRecord.js';

function fakeController() {
  const starts = [];
  const states = [];
  return {
    nightNumber: 2,
    state: 'playing',
    onNightStart: (fn) => { starts.push(fn); return () => starts.splice(starts.indexOf(fn), 1); },
    onStateChange: (fn) => { states.push(fn); return () => states.splice(states.indexOf(fn), 1); },
    startNight(n, opts = {}) { this.nightNumber = n; this.state = 'playing'; for (const fn of [...starts]) fn(n, opts); },
    setState(s) { const prev = this.state; this.state = s; for (const fn of [...states]) fn(s, prev); },
    get listeners() { return starts.length + states.length; },
  };
}

describe('ThreatWatch', () => {
  let watch, controller, clock, run, on;

  beforeEach(() => {
    controller = fakeController();
    clock = { currentTime: -5 };
    run = new RunRecord();
    on = { storm: false, eyes: false, vents: false };
    watch = new ThreatWatch();
    watch.controller = controller;
    watch.clock = clock;
    watch.run = run;
    watch.sources = { storm: () => on.storm, eyes: () => on.eyes, vents: () => on.vents };
    watch.onStart();
  });

  it('notes the hour each threat first shows, once', () => {
    clock.currentTime = -3;
    on.storm = true;
    watch.onUpdate(0.016);
    clock.currentTime = -2;
    watch.onUpdate(0.016);   // still blowing: not noted again
    on.storm = false;
    clock.currentTime = 1;
    on.eyes = true;
    watch.onUpdate(0.016);
    expect(watch.entries).toEqual([{ kind: 'storm', hour: -3 }, { kind: 'eyes', hour: 1 }]);
  });

  it('writes the night\'s log to the run record as the shift ends', () => {
    on.vents = true;
    watch.onUpdate(0.016);
    controller.setState('morning');
    expect(run.threats(2)).toEqual([{ kind: 'vents', hour: -5 }]);
  });

  it('a quiet night is logged as quiet', () => {
    watch.onUpdate(0.016);
    controller.setState('morning');
    expect(run.threats(2)).toEqual([]);
  });

  it('watches only while the shift is played', () => {
    controller.state = 'morning';
    on.storm = true;
    watch.onUpdate(0.016);
    controller.state = 'gameOver';
    watch.onUpdate(0.016);
    expect(watch.entries).toEqual([]);
  });

  it('a failed night logs nothing, and the retry starts the log afresh', () => {
    on.storm = true;
    watch.onUpdate(0.016);
    controller.setState('gameOver');
    expect(run.threats(2)).toBeNull();
    on.storm = false;
    controller.startNight(2, { retry: true });
    expect(watch.entries).toEqual([]);
    watch.onUpdate(0.016);
    controller.setState('morning');
    expect(run.threats(2)).toEqual([]);
  });

  it('a new night starts a new log', () => {
    on.storm = true;
    watch.onUpdate(0.016);
    controller.setState('morning');
    controller.startNight(3);
    on.storm = false;
    watch.onUpdate(0.016);
    controller.setState('morning');
    expect(run.threats(2)).toHaveLength(1);
    expect(run.threats(3)).toEqual([]);
  });

  it('works without a run record or a clock (a headless scene)', () => {
    const bare = new ThreatWatch();
    bare.controller = fakeController();
    bare.sources = { storm: () => true };
    expect(() => { bare.onStart(); bare.onUpdate(0.016); bare.controller.setState('morning'); bare.onDestroy(); }).not.toThrow();
    expect(bare.entries).toEqual([{ kind: 'storm', hour: null }]);
  });

  it('lets go of the controller when torn down', () => {
    watch.onDestroy();
    expect(controller.listeners).toBe(0);
  });
});
