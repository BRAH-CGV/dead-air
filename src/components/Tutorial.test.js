import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Tutorial, TUTORIAL } from './Tutorial.js';
import { TUTORIAL_STEPS } from '../gameplay/TutorialSteps.js';
import { SignalTarget } from '../gameplay/SignalTarget.js';
import { Stamina } from '../gameplay/Stamina.js';

// ─────────────────────────────────────────────
// Tutorial — night 0's steps on the live scene
// ─────────────────────────────────────────────

/** A controller that announces nights the way GameController does. */
function fakeController(night = 0) {
  const listeners = new Set();
  return {
    state: 'playing',
    nightNumber: night,
    onNightStart: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    startNight(n, opts = {}) {
      this.nightNumber = n;
      this.state = 'playing';
      for (const fn of listeners) fn(n, opts);
    },
  };
}

function fakeClock() {
  return {
    currentTime: -6, paused: false,
    setTime(h) { this.currentTime = h; },
    pause() { this.paused = true; },
    resume() { this.paused = false; },
  };
}

const signal = (id) => new SignalTarget({ id, yaw: 0, pitch: -0.5 });

function rig({ night = 0 } = {}) {
  const camera = new THREE.PerspectiveCamera(70, 2, 0.1, 100);
  camera.position.set(0, 0, 0);       // looking down −z
  camera.updateMatrixWorld();
  const ahead = new THREE.Object3D();
  ahead.position.set(0, 0, -5);
  const behind = new THREE.Object3D();
  behind.position.set(0, 0, 5);
  ahead.updateMatrixWorld();
  behind.updateMatrixWorld();

  const s = {
    controller:    fakeController(night),
    clock:         fakeClock(),
    stamina:       new Stamina(),
    signalManager: { signals: [signal(1), signal(2), signal(3)] },
    terminal:      { state: 'idle', _hoveredSignal: null },
    driveManager:  { driveInserted: false },
    drives:        [],
    driveBoxes:    [],
    quotaDock:     { isQuotaMet: () => false },
    grid:          { on: true },
    suit:          { worn: false },
    nap:           { napping: false },
    bedRest:       { active: false },
    sandstorm:     { summon: vi.fn(() => true) },
    stormOutage:   { force: vi.fn() },
    fade:          { play: vi.fn(onDark => { onDark?.(); return true; }) },
    overlay:       { show: vi.fn(), hide: vi.fn(), setArrow: vi.fn() },
    camera,
    screen:        () => ({ width: 1000, height: 500 }),
    targets: {
      reader:    { object: ahead },
      computer:  { object: ahead },
      box:       { object: ahead },
      dock:      { object: behind },
      locker:    { object: behind },
      generator: { object: behind },
      bed:       { object: behind },
    },
  };
  s.tutorial = new Tutorial(s);
  s.tutorial.onStart();
  return s;
}

/** Run the tutorial past its timed intro cards. */
function pastIntro(s) {
  for (const step of TUTORIAL_STEPS) {
    if (!step.seconds || s.tutorial.runner.step?.id !== step.id) continue;
    s.tutorial.onUpdate(step.seconds + 0.01);
  }
}

describe('Tutorial', () => {
  let s;
  beforeEach(() => { s = rig(); });

  it('on night 0 holds the clock at 7 PM, dark, and opens on the story', () => {
    s.tutorial.onUpdate(0.01);
    expect(s.clock.currentTime).toBe(TUTORIAL.startHour);
    expect(s.clock.paused).toBe(true);
    expect(s.tutorial.active).toBe(true);
    expect(s.overlay.show).toHaveBeenLastCalledWith(expect.objectContaining({ title: TUTORIAL_STEPS[0].title }));
  });

  it('leaves every other night alone', () => {
    s = rig({ night: 1 });
    s.tutorial.onUpdate(0.01);
    expect(s.tutorial.active).toBe(false);
    expect(s.clock.paused).toBe(false);
    expect(s.overlay.show).not.toHaveBeenCalled();
    expect(s.overlay.hide).toHaveBeenCalled();
  });

  it('a night start moves it on or off: sleeping into night 1 ends it', () => {
    s.tutorial.onUpdate(0.01);
    s.controller.startNight(1);
    s.tutorial.onUpdate(0.01);
    expect(s.tutorial.active).toBe(false);
    expect(s.overlay.hide).toHaveBeenCalled();
  });

  it('keeps the player wide awake: no Sleep Demon on night 0', () => {
    s.stamina.value = 0.2;
    s.tutorial.onUpdate(0.01);
    expect(s.stamina.value).toBe(1);
  });

  it('trims the night to one signal, which never fades out', () => {
    s.tutorial.onUpdate(0.01);
    expect(s.signalManager.signals.length).toBe(1);
    const [sig] = s.signalManager.signals;
    expect(sig.yaw).toBeCloseTo(TUTORIAL.signal.yaw);
    expect(sig.pitch).toBeCloseTo(TUTORIAL.signal.pitch);
    expect(sig.lifeSeconds).toBe(Infinity);
  });

  it('shows the signal on the radar once the player is at the computer', () => {
    pastIntro(s);
    const [sig] = s.signalManager.signals;
    expect(sig.appeared).toBe(false);
    s.driveManager.driveInserted = true;
    s.terminal.state = 'radar';
    s.tutorial.onUpdate(0.01);
    expect(s.tutorial.runner.step.id).toBe('aim');
    expect(sig.appeared).toBe(true);
  });

  it('follows what the player does', () => {
    pastIntro(s);
    expect(s.tutorial.runner.step.id).toBe('drive');
    s.driveManager.driveInserted = true;
    s.tutorial.onUpdate(0.01);
    expect(s.tutorial.runner.step.id).toBe('computer');
  });

  it('a drive with the signal, seated in a box, is boxed', () => {
    const drive = { saved: true, corrupted: false };
    s.driveBoxes.push({ receiver: { attachments: [null, { item: drive }] } });
    pastIntro(s);
    const ctx = s.tutorial.readContext();
    expect(ctx.boxed).toBe(true);
    drive.corrupted = true;
    expect(s.tutorial.readContext().boxed).toBe(false);
  });

  it('once the quota is met the clock runs, and the storm comes', () => {
    pastIntro(s);
    s.quotaDock.isQuotaMet = () => true;
    s.driveManager.driveInserted = true;
    s.tutorial.runner.goTo('dock');
    s.tutorial.onUpdate(0.01);
    expect(s.tutorial.runner.step.id).toBe('quota');
    expect(s.clock.paused).toBe(false);
    s.tutorial.onUpdate(TUTORIAL_STEPS.find(t => t.id === 'quota').seconds + 0.01);
    expect(s.tutorial.runner.step.id).toBe('storm');
    expect(s.sandstorm.summon).toHaveBeenCalledTimes(1);
    expect(s.stormOutage.force).toHaveBeenCalledWith(TUTORIAL.outageAt);
  });

  it('the nap step brings the night on to near dawn, under a fade', () => {
    s.tutorial.onUpdate(0.01);
    s.tutorial.runner.goTo('inside');
    s.tutorial.onUpdate(0.01);             // the suit is off: on to the nap
    expect(s.tutorial.runner.step.id).toBe('nap');
    expect(s.fade.play).toHaveBeenCalled();
    expect(s.clock.currentTime).toBe(TUTORIAL.napHour);
    expect(s.clock.paused).toBe(false);
  });

  it('a retry skips the story and starts at the drive', () => {
    s.tutorial.onUpdate(0.01);
    s.controller.startNight(0, { retry: true });
    s.tutorial.onUpdate(0.01);
    expect(s.tutorial.runner.step.id).toBe('drive');
    expect(s.clock.paused).toBe(true);
  });

  it('points the arrow at the step\'s target, on screen or round the edge', () => {
    pastIntro(s);                           // 'drive': the reader, ahead
    s.overlay.setArrow.mockClear();
    s.tutorial.onUpdate(0.01);
    const ahead = s.overlay.setArrow.mock.calls.at(-1)[0];
    expect(ahead.onScreen).toBe(true);
    expect(ahead.x).toBeCloseTo(500);

    s.tutorial.runner.goTo('dock');         // the dock, behind
    s.tutorial.onUpdate(0.01);
    const behind = s.overlay.setArrow.mock.calls.at(-1)[0];
    expect(behind.onScreen).toBe(false);
  });

  it('no arrow on the story cards', () => {
    s.tutorial.onUpdate(0.01);
    expect(s.overlay.setArrow).toHaveBeenLastCalledWith(null);
  });

  it('hides while the night isn\'t being played, and keeps its place', () => {
    pastIntro(s);
    s.controller.state = 'gameOver';
    s.overlay.hide.mockClear();
    s.tutorial.onUpdate(0.01);
    expect(s.overlay.hide).toHaveBeenCalled();
    s.controller.state = 'playing';
    s.tutorial.onUpdate(0.01);
    expect(s.tutorial.runner.step.id).toBe('drive');
  });

  it('hides while the player is in the bunk, under the lids', () => {
    s.tutorial.onUpdate(0.01);
    s.tutorial.runner.goTo('nap');
    s.bedRest.active = true;
    s.overlay.hide.mockClear();
    s.overlay.show.mockClear();
    s.tutorial.onUpdate(0.01);
    expect(s.tutorial.runner.step.id).toBe('wait');
    expect(s.overlay.hide).toHaveBeenCalled();
    expect(s.overlay.show).not.toHaveBeenCalled();
  });

  it('shows in the morning too, for the sleep at the end', () => {
    s.tutorial.onUpdate(0.01);
    s.tutorial.runner.goTo('wait');
    s.controller.state = 'morning';
    s.overlay.show.mockClear();
    s.tutorial.onUpdate(0.01);
    expect(s.tutorial.runner.step.id).toBe('sleep');
    expect(s.overlay.show).toHaveBeenCalled();
  });

  it('lets go of its listener when destroyed', () => {
    s.tutorial.onUpdate(0.01);
    s.tutorial.onDestroy();
    s.controller.startNight(1);
    expect(s.tutorial.active).toBe(true);     // unchanged: not told
  });
});
