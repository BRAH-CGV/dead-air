import { describe, it, expect, vi } from 'vitest';
import { EvilSignal, EVIL, SPARK_SOUNDS, HUM } from './EvilSignal.js';
import { ASSETS, PRELOAD } from '../assets/manifest.js';
import { SignalManager, PITCH_MIN, PITCH_MAX, VISIBLE_SECONDS } from './SignalManager.js';
import { skyToCursor, cursorToSky } from '../gameobjects/DishRig.js';

// Mock the DriveSparks module so EvilSignal tests don't build real Three.js objects.
let _sparksMock;
vi.mock('./DriveSparks.js', () => ({
  DriveSparks: vi.fn(function () { return _sparksMock; }),
  SPARKS: { burstCount: [15, 25] },
}));

// ─────────────────────────────────────────────
// EvilSignal — the red signal: instant scan, dish hold, corrupted drives
// ─────────────────────────────────────────────

/** A drive-shaped fake with the same saved/corrupted contract as Drive. */
function makeDrive() {
  return {
    saved: false,
    corrupted: false,
    setSaved(saved, { corrupted = false } = {}) {
      this.saved = saved;
      this.corrupted = saved && corrupted;
    },
    setEjected() { this.setSaved(false); },
  };
}

function makeRig({ night = 1, drive = null, random = () => 0.5, soundVoice, humVoice } = {}) {
  const controller = {
    state: 'playing',
    nightNumber: night,
    _listeners: new Set(),
    fail: vi.fn(),
    onNightStart(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); },
    startNight(n) {
      this.nightNumber = n;
      signalManager.startNight(n);          // the real controller rebuilds the sky first
      for (const fn of [...this._listeners]) fn(n, { retry: false });
    },
  };
  const signalManager = new SignalManager({ signalsPerNight: 5, payloadPool: ['signal-1.png'] });
  signalManager.startNight(night);
  const radar = { setInfo: vi.fn() };
  const terminal = {
    radar, exit: vi.fn(),
    get cursorPosition() { return { x: 0, y: 0 }; },
    setCursorPosition: vi.fn(),
  };
  const drives = drive ? [drive] : [];
  const driveManager = {
    drives,
    insertedDrive: drive,
    get driveInserted() { return this.insertedDrive !== null; },
    get insertedDriveHasSignal() { return this.insertedDrive?.saved === true; },
    saveEvilToDrive: vi.fn(function () {
      this.insertedDrive.setSaved(true, { corrupted: true });
    }),
    ejectInsertedDrive: vi.fn(),
  };
  const satellite = { aimAll: vi.fn() };
  const whiteOut = { play: vi.fn(), clear: vi.fn() };
  const hooks = { setPlayerLocked: vi.fn() };
  const redOut = { setIntensity: vi.fn(), clear: vi.fn() };
  const engine = { timeScale: 1, realDt: 0 };
  const sparks = { tick: vi.fn(), burst: vi.fn(), dispose: vi.fn(), points: { removeFromParent: vi.fn() } };
  _sparksMock = sparks;
  const voice = soundVoice ?? { play: vi.fn(() => true), dispose: vi.fn() };
  const hum = humVoice ?? { set: vi.fn(() => true), dispose: vi.fn() };
  const evil = new EvilSignal({ controller, signalManager, terminal, driveManager, satellite, random, voice, hum });
  evil.whiteOut = whiteOut;
  evil.hooks = hooks;
  evil.redOut = redOut;
  evil.gameObject = { scene: { userData: { engine }, add: vi.fn() } };
  evil.onStart();
  return { evil, controller, signalManager, terminal, radar, driveManager, satellite, whiteOut, hooks, redOut, sparks, voice, hum, engine };
}

/** The single red target in the manager's list. */
const evilSig = mgr => mgr.signals.find(s => s.evil) ?? null;

describe('EvilSignal summon()', () => {
  it('puts one red signal in the sky, anywhere a dish can see it', () => {
    const { evil, signalManager } = makeRig();
    expect(evil.summon()).toBe(true);
    const sig = evilSig(signalManager);
    expect(sig).toBeTruthy();
    expect(sig.evil).toBe(true);
    expect(sig.id).toBe(EVIL.id);
    expect(sig.scanned).toBe(false);
    expect(sig.pitch).toBeGreaterThanOrEqual(PITCH_MIN);
    expect(sig.pitch).toBeLessThanOrEqual(PITCH_MAX);
    expect(Math.abs(sig.yaw)).toBeLessThanOrEqual(Math.PI);
    expect(sig.visibleSeconds).toBe(Math.round(1.5 * VISIBLE_SECONDS));   // 1.5× a normal signal
  });

  it('spans the whole spawn band with its own dice', () => {
    for (const dice of [0, 1]) {
      const { evil, signalManager } = makeRig({ random: () => dice });
      evil.summon();
      // Two dice calls: yaw first, then the radius inside the band.
      const r = EVIL.spawnRadius[dice];
      expect(evilSig(signalManager).pitch).toBeCloseTo(cursorToSky(0, -r).pitch, 9);
    }
  });

  it('spawns only in the middle 2/3 of the radar radius', () => {
    const { evil, signalManager } = makeRig();
    for (let i = 0; i < 100; i++) {
      expect(evil.summon()).toBe(true);
      const sig = evilSig(signalManager);
      const { x, y } = skyToCursor(sig.yaw, sig.pitch);
      const r = Math.hypot(x, y);
      expect(r).toBeGreaterThanOrEqual(EVIL.spawnRadius[0] - 1e-9);
      expect(r).toBeLessThanOrEqual(EVIL.spawnRadius[1] + 1e-9);
      sig.deleted = true;   // spent, so the next summon is allowed
    }
  });

  it('is refused while the one up is still unresolved, and allowed once it is spent', () => {
    const drive = makeDrive();
    const { evil, signalManager } = makeRig({ drive });
    expect(evil.summon()).toBe(true);
    expect(evil.summon()).toBe(false);

    const sig = evilSig(signalManager);
    evil.hover(sig);                        // saves red immediately, locks for 5 s
    evil.onUpdate(EVIL.pullInSeconds + 0.1);  // complete the pull-in
    expect(sig.resolved).toBe(true);  // resolved right away

    expect(evil.summon()).toBe(true);
    expect(signalManager.signals.filter(s => s.evil)).toHaveLength(1);   // replaced, never stacked
  });

  it('is refused outside a shift in progress', () => {
    const { evil, controller } = makeRig();
    controller.state = 'morning';
    expect(evil.summon()).toBe(false);
  });
});

describe('EvilSignal hover — the dish hold', () => {
  it('scans itself the instant the cursor is on it, then pins the dish for 5 s', () => {
    const { evil, signalManager, satellite, radar } = makeRig();
    evil.summon();
    const sig = evilSig(signalManager);

    evil.hover(sig);
    evil.onUpdate(EVIL.pullInSeconds + 0.1);  // complete the pull-in
    expect(sig.scanned).toBe(true);
    expect(evil.locked).toBe(true);
    expect(radar.setInfo).toHaveBeenCalledWith(expect.stringContaining('5'));

    evil.onUpdate(2);
    expect(evil.locked).toBe(true);
    expect(satellite.aimAll).toHaveBeenCalledWith(sig.yaw, sig.pitch);
    expect(radar.setInfo).toHaveBeenCalledWith(expect.stringContaining('3'));

    evil.onUpdate(EVIL.lockWithDriveSeconds - 2 + 0.1);
    expect(evil.locked).toBe(false);
  });

  it('disappears after the lock ends — no re-hovering, but respawns later', () => {
    const { evil, signalManager } = makeRig();
    evil._spawnsRemaining = 2;   // simulate a scheduled night
    evil.summon();
    const sig = evilSig(signalManager);

    evil.hover(sig);
    evil.onUpdate(EVIL.pullInSeconds + 0.1);  // complete the pull-in
    evil.onUpdate(EVIL.lockSeconds + 0.1);
    expect(evil.locked).toBe(false);
    expect(sig.deleted).toBe(true);  // the signal is gone
    expect(sig.resolved).toBe(true);  // so the radar skips it

    // Hovering it again does nothing — it's resolved.
    evil.hover(sig);
    expect(evil.locked).toBe(false);

    // But a respawn timer is counting down.
    expect(evil._respawnTimer).not.toBeNull();
  });

  it('lets go when the shift ends mid-hold', () => {
    const { evil, controller, signalManager } = makeRig();
    evil.summon();
    evil.hover(evilSig(signalManager));
    evil.onUpdate(EVIL.pullInSeconds + 0.1);  // complete the pull-in
    expect(evil.locked).toBe(true);

    controller.state = 'morning';
    evil.onUpdate(0.1);
    expect(evil.locked).toBe(false);
  });

  it('sets radar.evilLock while locked, clears it on release', () => {
    const { evil, signalManager, radar } = makeRig();
    evil.summon();
    const sig = evilSig(signalManager);

    evil.hover(sig);
    evil.onUpdate(EVIL.pullInSeconds + 0.1);  // complete the pull-in
    expect(evil.locked).toBe(true);
    evil.onUpdate(0.1);  // trigger the evilLock setup
    expect(radar.evilLock).not.toBeNull();
    expect(radar.evilLock.active).toBe(true);
    expect(radar.evilLock.yaw).toBe(sig.yaw);
    expect(radar.evilLock.pitch).toBe(sig.pitch);

    evil.onUpdate(EVIL.lockSeconds + 0.1);
    expect(evil.locked).toBe(false);
    expect(radar.evilLock).toBeNull();
  });

  it('ignores a signal that is not the red one', () => {
    const { evil, signalManager } = makeRig();
    evil.summon();
    const other = signalManager.signals.find(s => !s.evil);
    evil.hover(other);
    expect(evil.locked).toBe(false);
    expect(other.scanned).toBe(false);
  });
});

describe('EvilSignal hover — the red save', () => {
  it('saves to a blank drive immediately, then locks for 5 s', () => {
    const drive = makeDrive();
    const { evil, signalManager, driveManager, satellite, radar } = makeRig({ drive });
    evil.summon();
    const sig = evilSig(signalManager);

    evil.hover(sig);
    evil.onUpdate(EVIL.pullInSeconds + 0.1);  // complete the pull-in
    expect(sig.scanned).toBe(true);
    expect(sig.saved).toBe(true);  // saved immediately
    expect(sig.resolved).toBe(true);
    expect(driveManager.saveEvilToDrive).toHaveBeenCalledTimes(1);
    expect(driveManager.ejectInsertedDrive).toHaveBeenCalledTimes(1);
    expect(drive.saved).toBe(true);
    expect(drive.corrupted).toBe(true);
    expect(evil.locked).toBe(true);  // but the lock still runs
    expect(radar.setInfo).toHaveBeenCalledWith(expect.stringContaining('5'));

    // The lock runs for the full duration.
    evil.onUpdate(EVIL.lockWithDriveSeconds + 0.1);
    expect(evil.locked).toBe(false);
  });

  it('a drive that already holds a signal overwrites it red immediately, then locks for 5 s', () => {
    const drive = makeDrive();
    drive.setSaved(true);                   // green signal already on it
    const { evil, signalManager, driveManager, radar } = makeRig({ drive });
    evil.summon();
    const sig = evilSig(signalManager);

    evil.hover(sig);
    evil.onUpdate(EVIL.pullInSeconds + 0.1);  // complete the pull-in
    expect(sig.scanned).toBe(true);
    expect(sig.saved).toBe(true);  // saved immediately (overwrites green)
    expect(driveManager.saveEvilToDrive).toHaveBeenCalledTimes(1);
    expect(driveManager.ejectInsertedDrive).toHaveBeenCalledTimes(1);
    expect(drive.saved).toBe(true);
    expect(drive.corrupted).toBe(true);  // now red
    expect(evil.locked).toBe(true);  // but the lock still runs
    expect(radar.setInfo).toHaveBeenCalledWith(expect.stringContaining('5'));

    // The lock runs for the full duration.
    evil.onUpdate(EVIL.lockWithDriveSeconds + 0.1);
    expect(evil.locked).toBe(false);
  });

  it('forces the player out of the computer screen after ejecting the corrupted drive', () => {
    const drive = makeDrive();
    const { evil, signalManager, terminal } = makeRig({ drive });
    evil.summon();
    const sig = evilSig(signalManager);

    evil.hover(sig);  // saves red, ejects drive
    evil.onUpdate(EVIL.pullInSeconds + 0.1);  // complete the pull-in
    expect(terminal.exit).toHaveBeenCalledTimes(1);
  });

  it('a resolved red signal never engages again', () => {
    const drive = makeDrive();
    const { evil, signalManager, radar } = makeRig({ drive });
    evil.summon();
    const sig = evilSig(signalManager);

    evil.hover(sig);                        // saves red immediately, locks for 5 s
    evil.onUpdate(EVIL.pullInSeconds + 0.1);  // complete the pull-in
    expect(sig.resolved).toBe(true);

    // Wait for the lock to end.
    evil.onUpdate(EVIL.lockWithDriveSeconds + 0.1);
    expect(evil.locked).toBe(false);

    radar.setInfo.mockClear();
    evil.hover(sig);                        // resolved signal never engages
    expect(evil.locked).toBe(false);
    expect(radar.setInfo).not.toHaveBeenCalled();
  });

  it('infects a drive inserted during the lock phase (after pull-in with no drive)', () => {
    const { evil, signalManager, driveManager } = makeRig();  // no drive
    evil.summon();
    const sig = evilSig(signalManager);

    // Complete pull-in with no drive inserted
    evil.hover(sig);
    evil.onUpdate(EVIL.pullInSeconds + 0.1);
    expect(evil.locked).toBe(true);
    expect(evil._driveInfected).toBe(false);
    expect(driveManager.saveEvilToDrive).not.toHaveBeenCalled();

    // Now insert a drive during the lock phase
    const drive = makeDrive();
    driveManager.insertedDrive = drive;
    driveManager.drives.push(drive);

    // Tick — should infect the newly inserted drive
    evil.onUpdate(0.1);
    expect(evil._driveInfected).toBe(true);
    expect(drive.corrupted).toBe(true);
    expect(driveManager.saveEvilToDrive).toHaveBeenCalledTimes(1);
    expect(driveManager.ejectInsertedDrive).toHaveBeenCalledTimes(1);
  });

  it('a successive signal in the same night infects a drive again', () => {
    const { evil, signalManager, driveManager } = makeRig();  // no drive yet
    evil.summon();
    const sig1 = evilSig(signalManager);

    // First signal: a drive is inserted and infected.
    const drive1 = makeDrive();
    driveManager.insertedDrive = drive1;
    driveManager.drives.push(drive1);
    evil.hover(sig1);
    evil.onUpdate(EVIL.pullInSeconds + 0.1);  // complete the pull-in
    expect(drive1.corrupted).toBe(true);
    expect(evil._driveInfected).toBe(true);

    // The player wipes it and the first lock runs out.
    drive1.setSaved(false);
    evil.onUpdate(EVIL.lockWithDriveSeconds + 0.1);
    expect(evil.locked).toBe(false);

    // A second signal arrives the same night, replacing the spent one.
    expect(evil.summon()).toBe(true);
    const sig2 = evilSig(signalManager);
    expect(sig2).not.toBe(sig1);

    // A fresh drive goes in: the second signal must infect it too.
    const drive2 = makeDrive();
    driveManager.insertedDrive = drive2;
    driveManager.drives.push(drive2);
    evil.hover(sig2);
    evil.onUpdate(EVIL.pullInSeconds + 0.1);  // complete the pull-in
    expect(drive2.corrupted).toBe(true);
    expect(driveManager.saveEvilToDrive).toHaveBeenCalledTimes(2);
    expect(driveManager.ejectInsertedDrive).toHaveBeenCalledTimes(2);
  });
});

describe('EvilSignal nights', () => {
  it('a new night drops the target and any hold', () => {
    const { evil, controller, signalManager } = makeRig();
    evil.summon();
    evil.hover(evilSig(signalManager));
    evil.onUpdate(EVIL.pullInSeconds + 0.1);  // complete the pull-in
    expect(evil.locked).toBe(true);

    controller.startNight(2);
    expect(evil.locked).toBe(false);
    expect(evilSig(signalManager)).toBe(null);   // startNight rebuilt the sky
  });

  it('is scheduled for night 3', () => {
    expect(EVIL.nights).toEqual([3]);
  });

  it('summons the signal on night 3 (guaranteed one appearance)', () => {
    const { evil, controller, signalManager } = makeRig({ random: () => 0.99 });
    // Night 3 with high random (>= 0.25) → 1 spawn only.
    controller.startNight(3);
    expect(evil._spawnsRemaining).toBe(0);   // summon() already decremented
    expect(evilSig(signalManager)).not.toBeNull();
  });

  it('allows a second appearance on night 3 when random < doubleChance', () => {
    const { evil, controller } = makeRig({ random: () => 0.1 });
    // Night 3 with low random (< 0.25) → 2 spawns.
    controller.startNight(3);
    // First summon already ran; _spawnsRemaining was 2, summon decremented to 1.
    expect(evil._spawnsRemaining).toBe(1);
  });

  it('does not summon on nights 1 or 2', () => {
    const { evil, controller, signalManager } = makeRig();
    controller.startNight(1);
    expect(evil._spawnsRemaining).toBe(0);
    expect(evilSig(signalManager)).toBeNull();

    controller.startNight(2);
    expect(evil._spawnsRemaining).toBe(0);
    expect(evilSig(signalManager)).toBeNull();
  });
});

describe('EvilSignal respawn — no drive means it comes back', () => {
  it('respawns at a new position after the delay when no drive was used', () => {
    const { evil, signalManager } = makeRig();
    evil._spawnsRemaining = 2;   // simulate a scheduled night with two appearances
    evil.summon();
    const sig1 = evilSig(signalManager);

    evil.hover(sig1);
    evil.onUpdate(EVIL.pullInSeconds + 0.1);  // complete the pull-in
    evil.onUpdate(EVIL.lockSeconds + 0.1);
    expect(evil.locked).toBe(false);
    expect(sig1.deleted).toBe(true);
    expect(evil._respawnTimer).toBe(EVIL.respawnDelaySeconds);

    // Tick most of the timer — still gone.
    evil.onUpdate(EVIL.respawnDelaySeconds - 0.1);
    expect(evil._respawnTimer).toBeCloseTo(0.1, 5);
    expect(signalManager.signals.filter(s => s.evil)).toHaveLength(1);  // old one still in list

    // The last tick fires the respawn.
    evil.onUpdate(0.2);
    expect(evil._respawnTimer).toBeNull();
    const sigs = signalManager.signals.filter(s => s.evil);
    expect(sigs).toHaveLength(1);   // replaced, never stacked
    expect(sigs[0]).not.toBe(sig1); // a new target
    expect(sigs[0].deleted).toBe(false);
    expect(sigs[0].resolved).toBe(false);
  });

  it('does not respawn when a drive was used', () => {
    const drive = makeDrive();
    const { evil, signalManager } = makeRig({ drive });
    evil.summon();
    const sig = evilSig(signalManager);

    evil.hover(sig);  // saves to drive immediately, locks for 5 s
    evil.onUpdate(EVIL.pullInSeconds + 0.1);  // complete the pull-in
    expect(sig.saved).toBe(true);

    evil.onUpdate(EVIL.lockWithDriveSeconds + 0.1);
    expect(evil.locked).toBe(false);
    expect(evil._respawnTimer).toBeNull();  // no respawn — drive carries it
  });

  it('a new night cancels the respawn timer', () => {
    const { evil, controller, signalManager } = makeRig();
    evil._spawnsRemaining = 2;   // simulate a scheduled night
    evil.summon();
    evil.hover(evilSig(signalManager));
    evil.onUpdate(EVIL.pullInSeconds + 0.1);  // complete the pull-in
    evil.onUpdate(EVIL.lockSeconds + 0.1);
    expect(evil._respawnTimer).not.toBeNull();

    controller.startNight(2);
    expect(evil._respawnTimer).toBeNull();
  });
});

describe('EvilSignal silence timer — wipe the corrupted drive or lose', () => {
  it('game over ("You were silenced") if the corrupted drive is not wiped in time', () => {
    const drive = makeDrive();
    const { evil, controller, signalManager, terminal, whiteOut, hooks } = makeRig({ drive });
    evil.summon();
    const sig = evilSig(signalManager);

    evil.hover(sig);                        // saves red, starts silence timer
    evil.onUpdate(EVIL.pullInSeconds + 0.1);  // complete the pull-in
    expect(evil._silenceTimer).toBe(EVIL.silenceSeconds);

    // Wait for the silence timer to expire.
    evil.onUpdate(EVIL.silenceSeconds + 0.1);
    expect(controller.fail).toHaveBeenCalledWith(
      '',
      expect.objectContaining({ promptAfter: expect.any(Number) }),
    );
    expect(terminal.exit).toHaveBeenCalled();
    expect(whiteOut.play).toHaveBeenCalledWith(
      'You were silenced.',
      expect.objectContaining({ tone: 'blood' }),
    );
    expect(hooks.setPlayerLocked).toHaveBeenCalledWith(true);
  });

  it('wiping the corrupted drive before the timer expires cancels the game over', () => {
    const drive = makeDrive();
    const { evil, controller, signalManager } = makeRig({ drive });
    evil.summon();
    const sig = evilSig(signalManager);

    evil.hover(sig);                        // saves red, starts silence timer
    evil.onUpdate(EVIL.pullInSeconds + 0.1);  // complete the pull-in
    expect(evil._silenceTimer).toBe(EVIL.silenceSeconds);

    // Simulate wiping the drive at the ServerRoom console.
    drive.setSaved(false);
    expect(drive.corrupted).toBe(false);

    // Tick past the silence deadline — no game over.
    evil.onUpdate(EVIL.silenceSeconds + 0.1);
    expect(controller.fail).not.toHaveBeenCalled();
    expect(evil._silenceTimer).toBeNull();
  });

  it('the silence timer resets on a new night', () => {
    const drive = makeDrive();
    const { evil, controller, signalManager } = makeRig({ drive });
    evil.summon();
    const sig = evilSig(signalManager);

    evil.hover(sig);                        // saves red, starts silence timer
    evil.onUpdate(EVIL.pullInSeconds + 0.1);  // complete the pull-in
    expect(evil._silenceTimer).toBe(EVIL.silenceSeconds);
    expect(evil._driveHopTimer).toBe(EVIL.driveHopStart);

    controller.startNight(2);
    expect(evil._silenceTimer).toBeNull();
    expect(evil._driveHopTimer).toBeNull();
  });

  it('clears the whiteOut and unlocks the player when a new night starts (retry)', () => {
    const drive = makeDrive();
    const { evil, controller, signalManager, whiteOut, hooks } = makeRig({ drive });
    evil.summon();
    const sig = evilSig(signalManager);

    evil.hover(sig);
    evil.onUpdate(EVIL.pullInSeconds + 0.1);  // complete the pull-in
    evil.onUpdate(EVIL.silenceSeconds + 0.1);  // game over, whiteOut plays
    expect(whiteOut.play).toHaveBeenCalled();
    expect(hooks.setPlayerLocked).toHaveBeenCalledWith(true);

    // Retry: a new night starts — the whiteOut must clear and the player
    // must be unlocked.
    controller.startNight(1, { retry: true });
    expect(whiteOut.clear).toHaveBeenCalled();
    expect(hooks.setPlayerLocked).toHaveBeenCalledWith(false);
  });

  it('the corrupted drive hops in a random direction every second', () => {
    const drive = makeDrive();
    const setLinvel = vi.fn();
    const applyAngularImpulse = vi.fn();
    drive.rigidBody = { setLinvel, setAngvel: applyAngularImpulse };
    const { evil, signalManager } = makeRig({ drive });
    evil.summon();
    const sig = evilSig(signalManager);

    evil.hover(sig);                        // saves red, starts silence + hop timers
    evil.onUpdate(EVIL.pullInSeconds + 0.1);  // complete the pull-in
    expect(evil._driveHopTimer).toBe(EVIL.driveHopStart);

    // Tick just under 1 s — no kick yet.
    evil.onUpdate(EVIL.driveHopStart - 0.05);
    expect(setLinvel).not.toHaveBeenCalled();

    // Tick past the hop interval — the drive gets kicked.
    evil.onUpdate(0.1);
    expect(setLinvel).toHaveBeenCalledTimes(1);
    expect(applyAngularImpulse).toHaveBeenCalledTimes(1);
    // The timer resets for the next hop — shortened by the doom ramp.
    expect(evil._driveHopTimer).toBeLessThan(EVIL.driveHopStart);
    expect(evil._driveHopTimer).toBeGreaterThanOrEqual(EVIL.driveHopEnd);
  });

  it('wiping the drive stops the hopping', () => {
    const drive = makeDrive();
    const setLinvel = vi.fn();
    drive.rigidBody = { setLinvel, setAngvel: vi.fn() };
    const { evil, signalManager } = makeRig({ drive });
    evil.summon();
    const sig = evilSig(signalManager);

    evil.hover(sig);
    evil.onUpdate(EVIL.pullInSeconds + 0.1);  // complete the pull-in
    drive.setSaved(false);                  // wipe the drive
    // The hop timer clears on the next tick, when _findCorruptedDrive()
    // returns null.
    evil.onUpdate(0.1);
    expect(evil._driveHopTimer).toBeNull();

    // Even after a full second more, no kick — the timer is gone.
    evil.onUpdate(EVIL.driveHopStart + 0.1);
    expect(setLinvel).not.toHaveBeenCalled();
  });

  it('ramps the doom glow on the corrupted drive as the timer counts down', () => {
    const drive = makeDrive();
    const setDoomGlow = vi.fn();
    const clearDoomGlow = vi.fn();
    const startDoomFadeOut = vi.fn();
    drive.setDoomGlow = setDoomGlow;
    drive.clearDoomGlow = clearDoomGlow;
    drive.startDoomFadeOut = startDoomFadeOut;
    const { evil, signalManager } = makeRig({ drive });
    evil.summon();
    const sig = evilSig(signalManager);

    evil.hover(sig);  // starts silence timer
    evil.onUpdate(EVIL.pullInSeconds + 0.1);  // complete the pull-in

    // After half the timer, the glow fraction should be ~0.5.
    evil.onUpdate(EVIL.silenceSeconds / 2);
    expect(setDoomGlow).toHaveBeenCalledWith(expect.closeTo(0.5, 1));

    // Wipe the drive — the glow fades out on the drive instead of cutting.
    drive.setSaved(false);
    evil.onUpdate(0.1);
    expect(startDoomFadeOut).toHaveBeenCalled();
    expect(clearDoomGlow).not.toHaveBeenCalled();
  });

  it('clears the doom glow on night reset', () => {
    const drive = makeDrive();
    const clearDoomGlow = vi.fn();
    drive.setDoomGlow = vi.fn();
    drive.clearDoomGlow = clearDoomGlow;
    const { evil, controller, signalManager } = makeRig({ drive });
    evil.summon();
    const sig = evilSig(signalManager);

    evil.hover(sig);  // starts silence timer, sets _lastCorruptedDrive
    evil.onUpdate(EVIL.pullInSeconds + 0.1);  // complete the pull-in
    evil.onUpdate(0.5);
    expect(drive.setDoomGlow).toHaveBeenCalled();

    controller.startNight(2);
    expect(clearDoomGlow).toHaveBeenCalled();
  });
});

describe('EvilSignal pull-in — cursor drag before engage', () => {
  it('hovering the evil signal starts a pull-in instead of engaging immediately', () => {
    const { evil, signalManager, terminal } = makeRig();
    evil.summon();
    const sig = evilSig(signalManager);

    evil.hover(sig);
    expect(evil.pullingIn).toBe(true);
    expect(evil.locked).toBe(false);           // not yet engaged
    expect(evil._pullTimer).toBe(EVIL.pullInSeconds);
    expect(terminal.setCursorPosition).not.toHaveBeenCalled();  // not yet — needs an update tick
  });

  it('the pull-in completes and then engages', () => {
    const { evil, signalManager, terminal } = makeRig();
    evil.summon();
    const sig = evilSig(signalManager);

    evil.hover(sig);   // starts pull-in
    expect(evil.pullingIn).toBe(true);

    // Tick past the pull-in duration — the cursor should have been animated
    // and _engage should have fired (locked = true for the no-drive path).
    evil.onUpdate(EVIL.pullInSeconds + 0.1);
    expect(evil.pullingIn).toBe(false);
    expect(evil.locked).toBe(true);            // _engage ran
    expect(terminal.setCursorPosition).toHaveBeenCalled();
  });

  it('a new night cancels the pull-in', () => {
    const { evil, controller, signalManager } = makeRig();
    evil.summon();
    evil.hover(evilSig(signalManager));
    expect(evil.pullingIn).toBe(true);

    controller.startNight(2);
    expect(evil.pullingIn).toBe(false);
    expect(evil._pullTarget).toBeNull();
  });
});

describe('EvilSignal redOut — red filter', () => {
  it('redOut intensity is 0 while the silence timer is above the redout window', () => {
    const drive = makeDrive();
    const { evil, signalManager, redOut } = makeRig({ drive });
    evil.summon();
    const sig = evilSig(signalManager);

    evil.hover(sig);
    evil.onUpdate(EVIL.pullInSeconds + 0.1);  // complete pull-in, starts silence timer
    expect(evil._silenceTimer).toBe(EVIL.silenceSeconds);

    // Tick 1 s — still well above the redout window.
    evil.onUpdate(1);
    expect(redOut.setIntensity).toHaveBeenCalledWith(0);
  });

  it('ramps redOut when the timer enters the redout window', () => {
    const drive = makeDrive();
    const { evil, signalManager, redOut } = makeRig({ drive });
    evil.summon();
    const sig = evilSig(signalManager);

    evil.hover(sig);
    evil.onUpdate(EVIL.pullInSeconds + 0.1);  // complete pull-in

    // Tick past most of the timer so ~1.0 s remains (at the redout window edge).
    evil.onUpdate(EVIL.silenceSeconds - 1.0);

    // Tick closer to expiry — intensity ramps with the silence timer.
    evil.onUpdate(0.5);
    const lastCall = redOut.setIntensity.mock.calls.at(-1)[0];
    // silenceTimer ≈ 0.5, intensity ≈ 1 - 0.5/redoutWindow
    expect(lastCall).toBeCloseTo(1 - 0.5 / EVIL.redoutWindow, 1);
  });

  it('redOut is cleared on night reset', () => {
    const drive = makeDrive();
    const { evil, controller, signalManager, redOut } = makeRig({ drive });
    evil.summon();
    const sig = evilSig(signalManager);

    evil.hover(sig);
    evil.onUpdate(EVIL.pullInSeconds + 0.1);

    // Enter the redout window.
    evil.onUpdate(EVIL.silenceSeconds - 0.5);

    controller.startNight(2);
    expect(redOut.clear).toHaveBeenCalled();
  });
});

describe('EvilSignal hum — the countdown', () => {
  const level = rig => rig.hum.set.mock.calls.at(-1)[0];

  function infect(rig) {
    rig.evil.summon();
    rig.evil.hover(evilSig(rig.signalManager));
    rig.evil.onUpdate(EVIL.pullInSeconds + 0.1);
  }

  it('is off until a drive is corrupted', () => {
    const rig = makeRig({ drive: makeDrive() });
    rig.evil.onUpdate(0.1);
    expect(rig.hum.set).toHaveBeenCalled();
    expect(level(rig)).toBe(0);
  });

  it('is faint while the drive is corrupted, and a little louder as the timer runs down', () => {
    const rig = makeRig({ drive: makeDrive() });
    infect(rig);
    rig.evil.onUpdate(0.5);
    const early = level(rig);
    expect(early).toBeGreaterThan(0);
    rig.evil.onUpdate(EVIL.silenceSeconds * 0.8);
    const late = level(rig);
    expect(late).toBeGreaterThan(early);
    // Subtle: never more than a faint level, even at the end.
    expect(late).toBeLessThanOrEqual(HUM.volume);
    expect(HUM.volume).toBeLessThanOrEqual(0.2);
    // A real climb, if a gentle one: the end is at least half as loud again.
    expect(HUM.minLevel).toBeLessThanOrEqual(0.5);
    expect(early).toBeGreaterThanOrEqual(HUM.volume * HUM.minLevel * 0.99);
  });

  it('is heard from the corrupted drive, at the frame time', () => {
    const drive = makeDrive();
    const rig = makeRig({ drive });
    infect(rig);
    rig.evil.onUpdate(0.25);
    const [, dt, host] = rig.hum.set.mock.calls.at(-1);
    expect(dt).toBe(0.25);
    expect(host).toBe(drive);
  });

  it('fades out where the drive was, rather than jumping to the player', () => {
    const drive = makeDrive();
    const rig = makeRig({ drive });
    infect(rig);
    rig.evil.onUpdate(0.25);
    drive.setEjected();
    rig.evil.onUpdate(0.1);
    expect(rig.hum.set.mock.calls.at(-1)[2]).toBe(drive);
  });

  it('is pitched down', () => {
    expect(HUM.detune).toBeLessThan(0);
  });

  it('is placed on the drive, not all around you', () => {
    expect(HUM.placed.refDistance).toBeGreaterThan(0);
  });

  it('goes away when the drive is wiped, the shift ends, or the scene is torn down', () => {
    const drive = makeDrive();
    const rig = makeRig({ drive });
    infect(rig);
    rig.evil.onUpdate(0.5);
    expect(level(rig)).toBeGreaterThan(0);
    drive.setEjected();
    rig.evil.onUpdate(0.1);
    expect(level(rig)).toBe(0);

    const second = makeRig({ drive: makeDrive() });
    infect(second);
    second.evil.onUpdate(0.5);
    second.controller.state = 'morning';
    second.evil.onUpdate(0.1);
    expect(level(second)).toBe(0);

    second.evil.onDestroy();
    expect(second.hum.dispose).toHaveBeenCalled();
  });

  it('has its clip ready before the first infection', () => {
    expect(ASSETS[HUM.key]).toMatchObject({ type: 'audio', url: 'assets/audio/evil-hum.mp3' });
    expect(PRELOAD).toContain(HUM.key);
  });
});

describe('EvilSignal sparks — sound', () => {
  /** Infect a drive, then run one hop interval. */
  function hopOnce(rig) {
    rig.evil.summon();
    rig.evil.hover(evilSig(rig.signalManager));
    rig.evil.onUpdate(EVIL.pullInSeconds + 0.1);
    rig.voice.play.mockClear();
    rig.evil.onUpdate(EVIL.driveHopStart + 0.01);
  }

  it('sparks with one of three clips, from the drive, on each hop', () => {
    const drive = makeDrive();
    drive.corrupted = true;
    const rig = makeRig({ drive });
    hopOnce(rig);
    expect(rig.voice.play).toHaveBeenCalledTimes(1);
    const [from, set, volume] = rig.voice.play.mock.calls[0];
    expect(from).toBe(drive);
    expect(set.keys).toEqual(SPARK_SOUNDS.clips);
    expect(SPARK_SOUNDS.clips).toHaveLength(3);
    expect(volume).toBeGreaterThan(0);
  });

  it('is louder as the countdown runs out', () => {
    const rig = makeRig({ drive: makeDrive() });
    hopOnce(rig);
    const first = rig.voice.play.mock.calls[0][2];
    rig.voice.play.mockClear();
    rig.evil.onUpdate(EVIL.silenceSeconds * 0.8);
    rig.evil.onUpdate(EVIL.driveHopStart + 0.01);
    const lateCalls = rig.voice.play.mock.calls;
    expect(lateCalls.at(-1)[2]).toBeGreaterThan(first);
    expect(lateCalls.at(-1)[2]).toBeLessThanOrEqual(1);
  });

  it('is silent when the drive is wiped, and lets go of its voice with the scene', () => {
    const drive = makeDrive();
    const rig = makeRig({ drive });
    hopOnce(rig);
    drive.setEjected();
    rig.voice.play.mockClear();
    rig.evil.onUpdate(EVIL.driveHopStart * 3);
    expect(rig.voice.play).not.toHaveBeenCalled();
    rig.evil.onDestroy();
    expect(rig.voice.dispose).toHaveBeenCalled();
  });

  it('has its clips ready before the first hop', () => {
    for (const key of SPARK_SOUNDS.clips) {
      expect(ASSETS[key], key).toMatchObject({ type: 'audio', url: `assets/audio/${key.slice(4)}.mp3` });
      expect(PRELOAD, key).toContain(key);
    }
  });
});

describe('EvilSignal sparks — corrupted drive particle effects', () => {
  it('sparks are created when a drive is infected', async () => {
    const { DriveSparks } = await import('./DriveSparks.js');
    const drive = makeDrive();
    const { evil, signalManager } = makeRig({ drive });
    evil.summon();
    const sig = evilSig(signalManager);

    evil.hover(sig);
    evil.onUpdate(EVIL.pullInSeconds + 0.1);  // complete pull-in → engage → infect

    expect(DriveSparks).toHaveBeenCalled();
  });

  it('sparks are ticked each frame with the doom fraction', () => {
    const drive = makeDrive();
    const { evil, signalManager, sparks } = makeRig({ drive });
    evil.summon();
    const sig = evilSig(signalManager);

    evil.hover(sig);
    evil.onUpdate(EVIL.pullInSeconds + 0.1);  // complete pull-in

    // Tick one frame — sparks should be ticked with (dt, corrupted, doomFraction).
    evil.onUpdate(0.016);
    expect(sparks.tick).toHaveBeenCalled();
    const lastCall = sparks.tick.mock.calls.at(-1);
    expect(lastCall[0]).toBe(0.016);            // dt
    expect(lastCall[1]).toBe(drive);            // the corrupted drive
    expect(lastCall[2]).toBeGreaterThanOrEqual(0);  // doomFraction >= 0
  });

  it('sparks burst on each drive hop', () => {
    const drive = makeDrive();
    const { evil, signalManager, sparks } = makeRig({ drive });
    evil.summon();
    const sig = evilSig(signalManager);

    evil.hover(sig);
    evil.onUpdate(EVIL.pullInSeconds + 0.1);  // complete pull-in

    // Tick past the hop interval so the drive jumps.
    evil.onUpdate(EVIL.driveHopStart + 0.01);
    expect(sparks.burst).toHaveBeenCalled();
  });

  it('sparks are disposed when the drive is wiped', () => {
    const drive = makeDrive();
    const { evil, signalManager, sparks } = makeRig({ drive });
    evil.summon();
    const sig = evilSig(signalManager);

    evil.hover(sig);
    evil.onUpdate(EVIL.pullInSeconds + 0.1);  // complete pull-in → infect

    // Wipe the drive.
    drive.setSaved(false);
    // One tick to detect the corrupted drive is gone.
    evil.onUpdate(0.016);
    expect(sparks.dispose).toHaveBeenCalled();
  });

  it('sparks are disposed on night reset', () => {
    const drive = makeDrive();
    const { evil, controller, signalManager, sparks } = makeRig({ drive });
    evil.summon();
    const sig = evilSig(signalManager);

    evil.hover(sig);
    evil.onUpdate(EVIL.pullInSeconds + 0.1);  // complete pull-in → infect

    controller.startNight(2);
    expect(sparks.dispose).toHaveBeenCalled();
  });
});
