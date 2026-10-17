import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Tutorial, TUTORIAL } from './Tutorial.js';
import { TUTORIAL_STEPS, SKIP_NOTE } from '../gameplay/TutorialSteps.js';
import { SignalTarget } from '../gameplay/SignalTarget.js';
import { Stamina } from '../gameplay/Stamina.js';
import { NAP } from '../gameplay/Nap.js';

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

function rig({ night = 0, covered } = {}) {
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
    bed:           { napLength: NAP.lengths.indexOf(1) },
    bedRest:       { active: false },
    cargoDock:     { depositedBox: null },
    sendOff:       { active: false },
    flashlight:    { on: false },
    // The desk: anything over x −1…1, z −3…−2, from 0.6 m up.
    onDesk:        (p) => Math.abs(p.x) < 1 && p.z > -3 && p.z < -2 && p.y > 0.6,
    sandstorm:     { summon: vi.fn(() => true) },
    stormOutage:   { force: vi.fn() },
    overlay:       { show: vi.fn(), hide: vi.fn(), setArrow: vi.fn() },
    camera,
    screen:        () => ({ width: 1000, height: 500 }),
    covered,
    targets: {
      reader:    { object: ahead },
      computer:  { object: ahead },
      box:       { object: ahead },
      desk:      { object: ahead },
      dock:      { object: behind },
      locker:    { object: behind },
      generator: { object: behind },
      bed:       { object: behind },
      buggy:     { object: behind },
    },
  };
  s.tutorial = new Tutorial(s);
  s.tutorial.onStart();
  return s;
}

/** Into the tutorial's first step (the first update enters it). */
function firstStep(s) {
  s.tutorial.onUpdate(0.01);
}

describe('Tutorial', () => {
  let s;
  beforeEach(() => { s = rig(); });

  it('on night 0 holds the clock at 7 PM, dark, and opens on the first job, the skip line under it', () => {
    s.tutorial.onUpdate(0.01);
    expect(s.clock.currentTime).toBe(TUTORIAL.startHour);
    expect(s.clock.paused).toBe(true);
    expect(s.tutorial.active).toBe(true);
    expect(s.tutorial.runner.step.id).toBe('deskBox');
    expect(s.overlay.show).toHaveBeenLastCalledWith(expect.objectContaining({
      title: TUTORIAL_STEPS[0].title, note: SKIP_NOTE,
    }));
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
    firstStep(s);
    const [sig] = s.signalManager.signals;
    expect(sig.appeared).toBe(false);
    s.driveManager.driveInserted = true;
    s.terminal.state = 'radar';
    s.tutorial.onUpdate(0.01);
    expect(s.tutorial.runner.step.id).toBe('aim');
    expect(sig.appeared).toBe(true);
  });

  it('follows what the player does', () => {
    firstStep(s);
    expect(s.tutorial.runner.step.id).toBe('deskBox');
    s.driveManager.driveInserted = true;
    s.tutorial.onUpdate(0.01);
    expect(s.tutorial.runner.step.id).toBe('computer');
  });

  it('a drive box set down on the desk is on the desk; carried, it is not', () => {
    const box = { object3d: new THREE.Object3D(), pickupable: { held: false }, receiver: { attachments: [] } };
    box.object3d.position.set(5.7, 0.3, -2);         // on the shelf
    box.object3d.updateMatrixWorld();
    s.driveBoxes.push(box);
    expect(s.tutorial.readContext().boxOnDesk).toBe(false);
    expect(s.tutorial.readContext().holdingBox).toBe(false);
    box.object3d.position.set(0.2, 0.93, -2.5);       // on the desk
    box.object3d.updateMatrixWorld();
    box.pickupable.held = true;
    expect(s.tutorial.readContext().boxOnDesk).toBe(false);
    expect(s.tutorial.readContext().holdingBox).toBe(true);
    box.pickupable.held = false;
    expect(s.tutorial.readContext().boxOnDesk).toBe(true);
  });

  it('reads the flashlight', () => {
    expect(s.tutorial.readContext().flashlightOn).toBe(false);
    s.flashlight.on = true;
    expect(s.tutorial.readContext().flashlightOn).toBe(true);
  });

  it('a drive with the signal, seated in a box, is boxed', () => {
    const drive = { saved: true, corrupted: false };
    s.driveBoxes.push({ object3d: new THREE.Object3D(), receiver: { attachments: [null, { item: drive }] } });
    firstStep(s);
    const ctx = s.tutorial.readContext();
    expect(ctx.boxed).toBe(true);
    drive.corrupted = true;
    expect(s.tutorial.readContext().boxed).toBe(false);
  });

  it('once the quota is met the clock runs, and the storm comes', () => {
    firstStep(s);
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

  it("the nap step sets the bunk's alarm to 6 AM, and leaves the night to run", () => {
    s.tutorial.onUpdate(0.01);
    s.clock.resume();                      // as it is once the quota is met
    s.clock.setTime(-3);
    s.tutorial.runner.goTo('inside');
    s.tutorial.onUpdate(0.01);             // the suit is off: on to the nap
    expect(s.tutorial.runner.step.id).toBe('nap');
    expect(NAP.lengths[s.bed.napLength]).toBe(null);
    expect(s.clock.currentTime).toBe(-3);
    expect(s.clock.paused).toBe(false);
  });

  it('a retry starts over at the drive box, the clock held again', () => {
    s.tutorial.onUpdate(0.01);
    s.controller.startNight(0, { retry: true });
    s.tutorial.onUpdate(0.01);
    expect(s.tutorial.runner.step.id).toBe('deskBox');
    expect(s.clock.paused).toBe(true);
  });

  it('points the arrow at the step\'s target, on screen or round the edge', () => {
    firstStep(s);                           // 'deskBox': a box, ahead
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

  it('hides while the night isn\'t being played, and keeps its place', () => {
    firstStep(s);
    s.controller.state = 'gameOver';
    s.overlay.hide.mockClear();
    s.tutorial.onUpdate(0.01);
    expect(s.overlay.hide).toHaveBeenCalled();
    s.controller.state = 'playing';
    s.tutorial.onUpdate(0.01);
    expect(s.tutorial.runner.step.id).toBe('deskBox');
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

  it("hides while a panel covers the view (the generator's breakers), and keeps following the player", () => {
    let covered = false;
    s = rig({ covered: () => covered });
    s.grid.on = false;                        // the storm took it
    s.suit.worn = true;
    s.tutorial.onUpdate(0.01);
    s.tutorial.runner.goTo('generator');
    s.tutorial.onUpdate(0.01);
    covered = true;
    s.overlay.hide.mockClear();
    s.overlay.show.mockClear();
    s.overlay.setArrow.mockClear();
    s.grid.on = true;                         // the last switch flicked up
    s.tutorial.onUpdate(0.01);
    expect(s.overlay.hide).toHaveBeenCalled();
    expect(s.overlay.show).not.toHaveBeenCalled();
    expect(s.overlay.setArrow).not.toHaveBeenCalled();
    expect(s.tutorial.runner.step.id).toBe('inside');
    covered = false;
    s.tutorial.onUpdate(0.01);
    expect(s.overlay.show).toHaveBeenCalled();
  });

  it('shows in the morning too, for the buggy and the sleep at the end', () => {
    s.tutorial.onUpdate(0.01);
    s.tutorial.runner.goTo('wait');
    s.controller.state = 'morning';
    s.overlay.show.mockClear();
    s.tutorial.onUpdate(0.01);
    expect(s.tutorial.runner.step.id).toBe('buggy');
    expect(s.overlay.show).toHaveBeenCalled();
  });

  it("reads the buggy: a box in its boot, and the controller's send-off", () => {
    s.controller.state = 'morning';
    expect(s.tutorial.readContext()).toMatchObject({ boxInBuggy: false, dispatched: false });
    s.cargoDock.depositedBox = {};
    s.controller.dispatched = true;
    expect(s.tutorial.readContext()).toMatchObject({ boxInBuggy: true, dispatched: true });
  });

  it('hides through the send-off cutscene, and moves on to the sleep once the buggy has gone', () => {
    s.tutorial.onUpdate(0.01);
    s.tutorial.runner.goTo('buggy');
    s.controller.state = 'morning';
    s.sendOff.active = true;
    s.overlay.hide.mockClear();
    s.overlay.show.mockClear();
    s.tutorial.onUpdate(0.01);
    expect(s.overlay.hide).toHaveBeenCalled();
    expect(s.overlay.show).not.toHaveBeenCalled();
    s.sendOff.active = false;
    s.controller.dispatched = true;
    s.tutorial.onUpdate(0.01);
    expect(s.tutorial.runner.step.id).toBe('sleep');
    expect(s.overlay.show).toHaveBeenCalled();
  });

  describe('skipping it: sleep until 6 AM at the bunk', () => {
    it('can be skipped from the first step, while the night is played', () => {
      s.tutorial.onUpdate(0.01);
      expect(s.tutorial.canSkip).toBe(true);
      s.tutorial.runner.goTo('inside');
      expect(s.tutorial.canSkip).toBe(true);
    });

    it('not from the nap on: sleeping until 6 AM is then the lesson itself', () => {
      s.tutorial.onUpdate(0.01);
      for (const id of ['nap', 'wait', 'buggy', 'sleep']) {
        s.tutorial.runner.goTo(id);
        expect(s.tutorial.canSkip, id).toBe(false);
      }
    });

    it('not on another night, nor off the shift, nor while already in the bunk', () => {
      expect(rig({ night: 1 }).tutorial.canSkip).toBe(false);
      s.tutorial.onUpdate(0.01);
      s.controller.state = 'gameOver';
      expect(s.tutorial.canSkip).toBe(false);
      s.controller.state = 'playing';
      s.nap.napping = true;
      expect(s.tutorial.canSkip).toBe(false);
      s.nap.napping = false;
      s.bedRest.active = true;
      expect(s.tutorial.canSkip).toBe(false);
    });

    it('skip() moves on to night 1 the way sleeping does, through the night counter', () => {
      s.controller.nights = { advance: vi.fn(() => s.controller.startNight(1)) };
      s.tutorial.onUpdate(0.01);
      expect(s.tutorial.skip()).toBe(true);
      expect(s.controller.nights.advance).toHaveBeenCalledTimes(1);
      expect(s.controller.nightNumber).toBe(1);
      expect(s.tutorial.active).toBe(false);
      expect(s.overlay.hide).toHaveBeenCalled();
      s.overlay.show.mockClear();
      s.tutorial.onUpdate(0.01);
      expect(s.overlay.show).not.toHaveBeenCalled();
    });

    it('skip() with no night counter starts the next night itself', () => {
      s.tutorial.onUpdate(0.01);
      expect(s.tutorial.skip()).toBe(true);
      expect(s.controller.nightNumber).toBe(1);
    });

    it('skip() does nothing on another night, or off the shift', () => {
      s = rig({ night: 1 });
      s.tutorial.onUpdate(0.01);
      expect(s.tutorial.skip()).toBe(false);
      expect(s.controller.nightNumber).toBe(1);
      s = rig();
      s.tutorial.onUpdate(0.01);
      s.controller.state = 'gameOver';
      expect(s.tutorial.skip()).toBe(false);
      expect(s.controller.nightNumber).toBe(0);
    });
  });

  it('lets go of its listener when destroyed', () => {
    s.tutorial.onUpdate(0.01);
    s.tutorial.onDestroy();
    s.controller.startNight(1);
    expect(s.tutorial.active).toBe(true);     // unchanged: not told
  });
});
