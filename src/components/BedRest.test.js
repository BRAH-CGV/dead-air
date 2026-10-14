import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';
import { Bed } from './Bed.js';
import { BedRest } from './BedRest.js';
import { BED_TRANSITION } from '../gameplay/BedTransition.js';
import { PLAYER_BODY } from './PlayerBody.js';

// ─────────────────────────────────────────────
// BedRest — the bed animation on the camera, the lids and the player
// ─────────────────────────────────────────────

const T = BED_TRANSITION;
const FRAME = 1 / 60;

function makeRig({ timeScale = 15 } = {}) {
  // The player as Engine.buildPlayer makes it: the capsule's centre at the
  // body's origin, the camera at eye height on a pivot under it.
  const player = new GameObject('Player');
  player.object3d.position.set(1, PLAYER_BODY.standHeight / 2, 2);
  const pivot = new THREE.Object3D();
  player.object3d.add(pivot);
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 500);
  camera.rotation.order = 'YXZ';
  camera.position.set(0, PLAYER_BODY.standEyeHeight - PLAYER_BODY.standHeight / 2, 0);
  camera.rotation.set(-0.1, 0.4, 0);
  pivot.add(camera);

  const ctrl = {
    enabled: true,
    yaw: 0.4,
    pitch: -0.1,
    teleport: vi.fn(([x, y, z], { yaw = 0, pitch = 0 } = {}) => {
      player.object3d.position.set(x, y, z);
      ctrl.yaw = yaw;
      ctrl.pitch = pitch;
      camera.rotation.set(pitch, yaw, 0);
    }),
  };
  const interaction = { enabled: true, resetPrompt: vi.fn() };

  const bunk = new GameObject('Bunk');
  bunk.object3d.position.set(-2, 0, -3);
  const bed = bunk.addComponent(new Bed());

  const engine = { timeScale, realDt: FRAME, paused: false, crosshair: { hide: vi.fn(), show: vi.fn() } };
  const overlay = { set: vi.fn(), clear: vi.fn() };
  const starts = new Set();
  const controller = {
    state: 'playing',
    onNightStart: fn => { starts.add(fn); return () => starts.delete(fn); },
    startNight: (opts = {}) => { for (const fn of starts) fn(1, opts); },
  };
  const setPlayerLocked = vi.fn();
  let frozen = false;
  const rest = new BedRest({
    engine, camera, player: ctrl, interaction, overlay, bed, controller, setPlayerLocked,
    isFrozen: () => frozen,
  });
  rest.onStart();
  const freeze = on => { frozen = on; };
  return { rest, engine, camera, player, ctrl, interaction, bed, overlay, controller, setPlayerLocked, freeze };
}

/** Frames of `seconds` real time, each handed the engine's scaled game time. */
function run(rig, seconds) {
  const { rest, engine } = rig;
  for (let t = 0; t < seconds - 1e-9; t += FRAME) {
    engine.realDt = Math.min(FRAME, seconds - t);
    rest.onUpdate(engine.realDt * engine.timeScale);
    rest.onLateUpdate(engine.realDt * engine.timeScale);
  }
}

const world = camera => camera.getWorldPosition(new THREE.Vector3());
const angles = camera => new THREE.Euler().setFromQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()), 'YXZ');
const lastLid = overlay => overlay.set.mock.calls.at(-1)?.[1];

describe('BedRest', () => {
  let rig;
  beforeEach(() => { rig = makeRig(); });

  describe('getting in', () => {
    it('takes the player over for the whole animation: input locked, controls and interaction off, no prompt or crosshair', () => {
      const { rest, ctrl, interaction, setPlayerLocked, engine } = rig;
      expect(rest.lieDown(() => {})).toBe(true);
      expect(rest.active).toBe(true);
      expect(setPlayerLocked).toHaveBeenLastCalledWith(true);
      expect(ctrl.enabled).toBe(false);
      expect(interaction.enabled).toBe(false);
      expect(interaction.resetPrompt).toHaveBeenCalledOnce();     // '[E] Nap' gone while lying there
      expect(engine.crosshair.hide).toHaveBeenCalled();
      rest.cancel();
      expect(interaction.resetPrompt).toHaveBeenCalledTimes(2);   // shown afresh once back
      expect(engine.crosshair.show).toHaveBeenCalled();
    });

    it('moves the eye from where it stood to the pillow, looking up and tipped over', () => {
      const { rest, camera, bed } = rig;
      const start = world(camera);
      rest.lieDown(() => {});
      run(rig, T.lieDown / 2);
      const pillow = bed.pillowPose();
      const mid = world(camera);
      expect(mid.distanceTo(start)).toBeGreaterThan(0.1);
      expect(mid.distanceTo(pillow.position)).toBeGreaterThan(0.1);
      run(rig, T.lieDown / 2 + 0.05);
      expect(world(camera).distanceTo(pillow.position)).toBeLessThan(1e-6);
      const a = angles(camera);
      expect(a.x).toBeCloseTo(pillow.pitch);
      expect(a.z).toBeCloseTo(pillow.roll);
    });

    it('in real time, not the nap\'s game time: fifteen times faster game time still takes two seconds', () => {
      const { rest, engine } = rig;
      expect(engine.timeScale).toBe(15);
      const asleep = vi.fn();
      rest.lieDown(asleep);
      run(rig, T.lieDown * 0.9);
      expect(asleep).not.toHaveBeenCalled();
      run(rig, T.lieDown * 0.1 + 0.05);
      expect(asleep).toHaveBeenCalledOnce();
    });

    it('the lids close slowly over it, written after the fatigue effects (late update), and shut', () => {
      const { rest, overlay } = rig;
      rest.lieDown(() => {});
      run(rig, T.lieDown * 0.7);
      expect(lastLid(overlay)).toBeGreaterThan(0);
      expect(lastLid(overlay)).toBeLessThan(1);
      run(rig, T.lieDown * 0.3 + 0.05);                   // just asleep: before the first peek
      expect(lastLid(overlay)).toBe(1);
      expect(overlay.set.mock.calls.at(-1)[0]).toBe(0);   // no tunnel in bed
    });

    it('not twice', () => {
      rig.rest.lieDown(() => {});
      expect(rig.rest.lieDown(() => {})).toBe(false);
    });
  });

  describe('getting out', () => {
    function asleep() {
      rig.rest.lieDown(() => {});
      run(rig, T.lieDown + 0.05);
      expect(rig.rest.asleep).toBe(true);
    }

    it('calm: the eyes open, sit up, stand — then the capsule is put beside the bunk, facing the room', () => {
      const { rest, ctrl, player, bed, camera, interaction, setPlayerLocked } = rig;
      asleep();
      const up = vi.fn();
      expect(rest.getUp('calm', up)).toBe(true);
      run(rig, T.calm.open * 0.5);
      expect(world(camera).distanceTo(bed.pillowPose().position)).toBeLessThan(1e-6);   // still lying
      run(rig, T.calm.open + T.calm.sitUp + T.calm.standUp);
      expect(up).toHaveBeenCalledOnce();
      expect(rest.active).toBe(false);

      const spot = bed.getOutSpot();
      expect(ctrl.teleport).toHaveBeenCalledOnce();
      const [centre, facing] = ctrl.teleport.mock.calls[0];
      expect(centre[0]).toBeCloseTo(spot.position.x);
      expect(centre[2]).toBeCloseTo(spot.position.z);
      expect(centre[1] - PLAYER_BODY.standHeight / 2).toBeGreaterThanOrEqual(spot.position.y);   // feet on (or just above) the floor
      expect(centre[1] - PLAYER_BODY.standHeight / 2).toBeLessThan(spot.position.y + 0.1);
      expect(facing.yaw).toBeCloseTo(spot.yaw);
      expect(facing.pitch).toBe(0);
      expect(player.object3d.position.x).toBeCloseTo(spot.position.x);

      // Handed back cleanly: the controls on, the input unlocked, the
      // camera at the eye on the capsule, level.
      expect(ctrl.enabled).toBe(true);
      expect(interaction.enabled).toBe(true);
      expect(setPlayerLocked).toHaveBeenLastCalledWith(false);
      expect(camera.position.toArray()).toEqual([0, PLAYER_BODY.standEyeHeight - PLAYER_BODY.standHeight / 2, 0]);
      expect(angles(camera).z).toBeCloseTo(0);
      expect(world(camera).y).toBeCloseTo(spot.position.y + PLAYER_BODY.standEyeHeight, 1);
    });

    it('no jump as the view is handed back: the last frame of the animation is where the eye stands', () => {
      const { rest, camera } = rig;
      asleep();
      rest.getUp('calm');
      run(rig, T.calm.open + T.calm.sitUp + T.calm.standUp - 0.02);
      const before = world(camera);
      run(rig, 0.1);
      expect(rest.active).toBe(false);
      expect(world(camera).distanceTo(before)).toBeLessThan(0.05);
    });

    it('calm takes about two seconds of real time; startled is up in under one', () => {
      const calm = makeRig();
      calm.rest.lieDown(() => {});
      run(calm, T.lieDown + 0.05);
      const upCalm = vi.fn();
      calm.rest.getUp('calm', upCalm);
      run(calm, 1.5);
      expect(upCalm).not.toHaveBeenCalled();
      run(calm, 0.6);
      expect(upCalm).toHaveBeenCalledOnce();

      const startled = makeRig();
      startled.rest.lieDown(() => {});
      run(startled, T.lieDown + 0.05);
      const upStartled = vi.fn();
      startled.rest.getUp('startled', upStartled);
      run(startled, 0.95);
      expect(upStartled).toHaveBeenCalledOnce();
    });

    it('startled: the lids snap open', () => {
      const { rest, overlay } = rig;
      asleep();
      rest.getUp('startled');
      run(rig, 0.1);
      expect(lastLid(overlay)).toBe(0);
    });

    it('woken while still getting in: turns straight into getting out, and ends beside the bunk', () => {
      const { rest, ctrl, bed } = rig;
      const asleepCb = vi.fn();
      rest.lieDown(asleepCb);
      run(rig, T.lieDown * 0.5);
      rest.getUp('calm');
      run(rig, 3);
      expect(asleepCb).not.toHaveBeenCalled();
      expect(rest.active).toBe(false);
      expect(ctrl.teleport.mock.calls[0][0][0]).toBeCloseTo(bed.getOutSpot().position.x);
      expect(ctrl.enabled).toBe(true);
    });
  });

  describe('interruptions', () => {
    /** Halfway into bed: the camera nowhere near the capsule's eye. */
    function midway() {
      rig.rest.lieDown(() => {});
      run(rig, T.lieDown * 0.6);
    }

    /** The camera is back on the capsule: its own eye, level, the controls on. */
    function expectHandedBack() {
      const { rest, camera, ctrl, interaction, setPlayerLocked, overlay } = rig;
      expect(rest.active).toBe(false);
      expect(camera.position.toArray()).toEqual([0, PLAYER_BODY.standEyeHeight - PLAYER_BODY.standHeight / 2, 0]);
      expect(camera.rotation.x).toBeCloseTo(ctrl.pitch);
      expect(camera.rotation.y).toBeCloseTo(ctrl.yaw);
      expect(camera.rotation.z).toBe(0);
      expect(ctrl.enabled).toBe(true);
      expect(interaction.enabled).toBe(true);
      expect(setPlayerLocked).toHaveBeenLastCalledWith(false);
      expect(overlay.clear).toHaveBeenCalled();
    }

    it('paused, it holds where it is', () => {
      const { rest, engine, camera } = rig;
      midway();
      const at = world(camera);
      const lid = lastLid(rig.overlay);
      engine.paused = true;
      run(rig, 1);
      expect(world(camera).distanceTo(at)).toBe(0);
      expect(lastLid(rig.overlay)).toBe(lid);
      engine.paused = false;
      run(rig, 0.1);
      expect(world(camera).distanceTo(at)).toBeGreaterThan(0);
      expect(rest.active).toBe(true);
    });

    it('the scene torn down mid-animation (main menu, restart): the camera and the player are given back', () => {
      midway();
      rig.rest.onDestroy();
      expectHandedBack();
    });

    it('a failed night mid-animation: not left at the pillow', () => {
      midway();
      rig.controller.state = 'gameOver';
      run(rig, FRAME);
      expectHandedBack();
    });

    it('likewise asleep, and the run complete', () => {
      rig.rest.lieDown(() => {});
      run(rig, T.lieDown + 0.05);
      rig.controller.state = 'finished';
      run(rig, FRAME);
      expectHandedBack();
    });

    it('a retry (the night started over) hands it back too', () => {
      midway();
      rig.controller.startNight({ retry: true });
      expectHandedBack();
    });

    it('the morning is no interruption: the shift ending under a nap still gets you up, and the morning sleep runs in it', () => {
      const { rest, controller } = rig;
      midway();
      controller.state = 'morning';
      run(rig, 0.1);
      expect(rest.active).toBe(true);
      // Nor is the next night after sleeping (only a retry is).
      controller.startNight();
      expect(rest.active).toBe(true);
    });

    it('cancel() is safe when idle', () => {
      rig.rest.cancel();
      expect(rig.ctrl.enabled).toBe(true);
      expect(rig.setPlayerLocked).not.toHaveBeenCalled();
    });

    it('holds while the fly camera has it, and leaves the player to the fly camera on a cancel', () => {
      const { rest, camera, ctrl, freeze } = rig;
      midway();
      const at = world(camera);
      freeze(true);
      run(rig, 1);
      expect(world(camera).distanceTo(at)).toBe(0);
      rest.cancel();
      expect(ctrl.enabled).toBe(false);          // the fly camera hands its components back itself
    });
  });

  it('passes the peeks through', () => {
    const { rest } = rig;
    expect(rest.peeking).toBe(false);
    rest.lieDown(() => {});
    run(rig, T.lieDown + 0.05);
    let peeked = false;
    for (let i = 0; i < 60 * 20 && !peeked; i++) {
      run(rig, FRAME);
      peeked = rest.peeking;
    }
    expect(peeked).toBe(true);
    expect(lastLid(rig.overlay)).toBeLessThan(1);
  });
});
