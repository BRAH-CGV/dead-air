import { describe, it, expect, vi } from 'vitest';
import { EvilSignal, EVIL } from './EvilSignal.js';
import { SignalManager, PITCH_MIN, PITCH_MAX, VISIBLE_SECONDS } from './SignalManager.js';

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

function makeRig({ night = 1, drive = null, random = () => 0.5 } = {}) {
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
  const evil = new EvilSignal({ controller, signalManager, terminal, driveManager, satellite, random });
  evil.whiteOut = whiteOut;
  evil.hooks = hooks;
  evil.onStart();
  return { evil, controller, signalManager, terminal, radar, driveManager, satellite, whiteOut, hooks };
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
    for (const [r, pitch] of [[0, PITCH_MIN], [1, PITCH_MAX]]) {
      const { evil, signalManager } = makeRig({ random: () => r });
      evil.summon();
      expect(evilSig(signalManager).pitch).toBeCloseTo(pitch, 9);
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
  it('scans itself the instant the cursor is on it, then pins the dish for 10 s', () => {
    const { evil, signalManager, satellite, radar } = makeRig();
    evil.summon();
    const sig = evilSig(signalManager);

    evil.hover(sig);
    evil.onUpdate(EVIL.pullInSeconds + 0.1);  // complete the pull-in
    expect(sig.scanned).toBe(true);
    expect(evil.locked).toBe(true);
    expect(radar.setInfo).toHaveBeenCalledWith(expect.stringContaining('10'));

    evil.onUpdate(2);
    expect(evil.locked).toBe(true);
    expect(satellite.aimAll).toHaveBeenCalledWith(sig.yaw, sig.pitch);
    expect(radar.setInfo).toHaveBeenCalledWith(expect.stringContaining('8'));

    evil.onUpdate(EVIL.lockSeconds - 2 + 0.1);
    expect(evil.locked).toBe(false);
  });

  it('disappears after the lock ends — no re-hovering, but respawns later', () => {
    const { evil, signalManager } = makeRig();
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

  it('has no night of its own yet — the debug key is the way in', () => {
    expect(EVIL.nights).toEqual([]);
  });
});

describe('EvilSignal respawn — no drive means it comes back', () => {
  it('respawns at a new position after the delay when no drive was used', () => {
    const { evil, signalManager } = makeRig();
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
  it('game over ("You were silenced") if the corrupted drive is not wiped in 10 s', () => {
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
      'You were silenced. [E] to retry',
      expect.objectContaining({ retryAfter: expect.any(Number) }),
    );
    expect(terminal.exit).toHaveBeenCalled();
    expect(whiteOut.play).toHaveBeenCalledWith(
      'You were silenced. [E] to retry',
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
    expect(evil._driveHopTimer).toBe(EVIL.driveHopSeconds);

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
    expect(evil._driveHopTimer).toBe(EVIL.driveHopSeconds);

    // Tick just under 1 s — no kick yet.
    evil.onUpdate(EVIL.driveHopSeconds - 0.05);
    expect(setLinvel).not.toHaveBeenCalled();

    // Tick past the hop interval — the drive gets kicked.
    evil.onUpdate(0.1);
    expect(setLinvel).toHaveBeenCalledTimes(1);
    expect(applyAngularImpulse).toHaveBeenCalledTimes(1);
    // The timer resets for the next hop.
    expect(evil._driveHopTimer).toBe(EVIL.driveHopSeconds);
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
    evil.onUpdate(EVIL.driveHopSeconds + 0.1);
    expect(setLinvel).not.toHaveBeenCalled();
  });

  it('ramps the doom glow on the corrupted drive as the timer counts down', () => {
    const drive = makeDrive();
    const setDoomGlow = vi.fn();
    const clearDoomGlow = vi.fn();
    drive.setDoomGlow = setDoomGlow;
    drive.clearDoomGlow = clearDoomGlow;
    const { evil, signalManager } = makeRig({ drive });
    evil.summon();
    const sig = evilSig(signalManager);

    evil.hover(sig);  // starts silence timer
    evil.onUpdate(EVIL.pullInSeconds + 0.1);  // complete the pull-in

    // After half the timer, the glow fraction should be ~0.5.
    evil.onUpdate(EVIL.silenceSeconds / 2);
    expect(setDoomGlow).toHaveBeenCalledWith(expect.closeTo(0.5, 1));

    // Wipe the drive — the glow should clear.
    drive.setSaved(false);
    evil.onUpdate(0.1);
    expect(clearDoomGlow).toHaveBeenCalled();
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
