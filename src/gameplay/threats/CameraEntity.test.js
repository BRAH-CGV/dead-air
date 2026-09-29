import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';

vi.mock('@dimforge/rapier3d', async () => (await import('../../test/fakeRapier.js')).rapierModule());

import { ServerRoom } from '../../scenes/rooms/ServerRoom.js';
import { makeEngine } from '../../test/fakeRapier.js';
import { CameraEntity, CAMERA_ENTITY_KILL } from './CameraEntity.js';
import { CAMERA_ENTITY as T } from './CameraEntityLogic.js';

// A real ServerRoom, moved off the origin so every point goes through its
// transform. Its rig starts at the racks (minYaw) and sweeps to the console.
const OFFSET = [12, 0, 4];
const AT_CONSOLE = [-1, 1.24, -1.8];
const BEHIND_RACKS = [2.4, 1.24, 0.9];
const NEAR_RACKS = [0.6, 1.24, 0.9];      // in the aisle, off the console's line

function run(threat, seconds, each = () => {}, dt = 1 / 30) {
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    each();
    threat.update(Math.min(dt, seconds - t));
  }
}

describe('CameraEntity', () => {
  let room, rig, camera, controller, ctx, threat, isOccluded;

  function stand(local) {
    camera.position.set(local[0] + OFFSET[0], local[1] + OFFSET[1], local[2] + OFFSET[2]);
    camera.updateMatrixWorld(true);
  }

  beforeEach(() => {
    room = new ServerRoom(makeEngine(), { position: OFFSET });
    room.build();
    room.root.object3d.position.set(...OFFSET);
    room.root.object3d.updateMatrixWorld(true);
    rig = room.securityCamera;
    camera = new THREE.PerspectiveCamera();
    controller = { fail: vi.fn() };
    ctx = { engine: { camera }, rooms: { ServerRoom: room }, controller };
    isOccluded = vi.fn(() => false);
    threat = new CameraEntity({ isOccluded });
    stand(BEHIND_RACKS);
    threat.start(ctx);
  });

  it('tells the player what night 3 asks', () => {
    expect(threat.objective).toMatch(/server console/i);
    expect(threat.objective).toMatch(/camera/i);
  });

  it('starts at the racks end of its sweep, cone on and calm, sized to the rules', () => {
    expect(rig.yaw).toBeCloseTo(rig.minYaw);
    expect(rig.tilt).toBeCloseTo(rig.restTilt);
    expect(rig.cone.visible).toBe(true);
    expect(rig.range).toBe(T.range);
    expect(rig.halfAngle).toBe(T.halfAngle);
    expect(threat.exposure.exposure).toBe(0);
  });

  it('sweeps to the console end and back while nobody is in view', () => {
    run(threat, T.pauseTime + T.sweepTime + 0.5);
    expect(rig.yaw).toBeCloseTo(rig.maxYaw, 2);
    run(threat, T.pauseTime + T.sweepTime);
    expect(rig.yaw).toBeCloseTo(rig.minYaw, 2);
  });

  it('ends the night when it catches the player standing at the console', () => {
    stand(AT_CONSOLE);
    run(threat, 2 * (T.pauseTime + T.sweepTime));
    expect(controller.fail).toHaveBeenCalledTimes(1);
    expect(controller.fail).toHaveBeenCalledWith(CAMERA_ENTITY_KILL);
    expect(CAMERA_ENTITY_KILL).toBe('The camera found you.');
  });

  it('never sees a player behind the racks', () => {
    run(threat, 3 * (T.pauseTime + T.sweepTime));
    expect(controller.fail).not.toHaveBeenCalled();
    expect(isOccluded).not.toHaveBeenCalled();   // out of the zone: no ray cast
  });

  it('cover blocks it: an occluded player at the console is safe', () => {
    isOccluded.mockReturnValue(true);
    stand(AT_CONSOLE);
    run(threat, 2 * (T.pauseTime + T.sweepTime));
    expect(controller.fail).not.toHaveBeenCalled();
    expect(isOccluded).toHaveBeenCalled();
  });

  it('casts its line of sight from the lens to the eye', () => {
    stand(AT_CONSOLE);
    run(threat, T.pauseTime + T.sweepTime + 0.2);
    const [from, to] = isOccluded.mock.calls.at(-1);
    expect(from.distanceTo(rig.getLensPosition(new THREE.Vector3()))).toBeLessThan(1e-6);
    expect(to.distanceTo(camera.getWorldPosition(new THREE.Vector3()))).toBeLessThan(1e-6);
  });

  it('the tally and cone warm up as it sees the player', () => {
    const calm = rig.tally.material.color.r;
    stand(AT_CONSOLE);
    run(threat, T.pauseTime + T.sweepTime + 0.3);
    expect(threat.exposure.exposure).toBeGreaterThan(0);
    expect(rig.tally.material.color.r).toBeGreaterThan(calm);
  });

  /** Frame by frame until the camera locks on — before it kills. */
  function untilLocked() {
    for (let i = 0; i < 3000 && !threat.exposure.locked; i++) threat.update(1 / 60);
  }

  it('locks on past 0.6: stops sweeping and turns to follow the player', () => {
    stand(AT_CONSOLE);
    untilLocked();
    expect(threat.exposure.locked).toBe(true);
    expect(controller.fail).not.toHaveBeenCalled();
    const sweepTime = threat.sweep.time;

    // The player ducks out to a spot off the sweep's line; cover hides them
    // so the exposure only decays, and the camera keeps hunting.
    isOccluded.mockReturnValue(true);
    stand(NEAR_RACKS);
    const before = Math.abs(rig.yaw - threat.yawTo(camera.getWorldPosition(new THREE.Vector3())));
    run(threat, 0.4, () => {}, 1 / 60);
    const after = Math.abs(rig.yaw - threat.yawTo(camera.getWorldPosition(new THREE.Vector3())));
    expect(after).toBeLessThan(before);
    expect(threat.sweep.time).toBe(sweepTime);      // the sweep waits
  });

  it('lets go once exposure has decayed, and goes back to sweeping', () => {
    stand(AT_CONSOLE);
    untilLocked();
    expect(threat.exposure.locked).toBe(true);
    stand(BEHIND_RACKS);
    run(threat, 3);
    expect(threat.exposure.locked).toBe(false);
    const t = threat.sweep.time;
    run(threat, 1);
    expect(threat.sweep.time).toBeGreaterThan(t);
  });

  it('stop() switches the cone off; a retried night starts calm at the racks', () => {
    stand(AT_CONSOLE);
    untilLocked();
    threat.stop();
    expect(rig.cone.visible).toBe(false);
    run(threat, 5);
    expect(controller.fail).not.toHaveBeenCalled();

    threat.start(ctx);
    expect(threat.exposure.exposure).toBe(0);
    expect(rig.yaw).toBeCloseTo(rig.minYaw);
    expect(threat.sweep.time).toBe(0);
  });

  describe('default line of sight', () => {
    it('casts a solid ray that ignores sensors and the player, stopping short of the eye', () => {
      const castRay = vi.fn(() => null);
      const body = { handle: 7 };
      const scoped = new CameraEntity();
      scoped.start({ ...ctx, engine: { camera, world: { castRay } }, player: { rigidBody: body } });

      const from = new THREE.Vector3(0, 3, 0);
      const to = new THREE.Vector3(0, 3, 4);
      expect(scoped.isOccluded(from, to)).toBe(false);

      const [ray, maxToi, solid, flags, , , excludeBody] = castRay.mock.calls[0];
      expect(ray.origin).toMatchObject({ x: 0, y: 3, z: 0 });
      expect(ray.dir).toMatchObject({ x: 0, y: 0, z: 1 });
      expect(maxToi).toBeLessThan(4);
      expect(maxToi).toBeGreaterThan(3.5);
      expect(solid).toBe(true);
      expect(flags).toBe(8);                         // EXCLUDE_SENSORS: open doorways block nothing
      expect(excludeBody).toBe(body);

      castRay.mockReturnValue({ timeOfImpact: 1 });
      expect(scoped.isOccluded(from, to)).toBe(true);
    });

    it('without a physics world nothing is in the way', () => {
      const scoped = new CameraEntity();
      scoped.start(ctx);
      expect(scoped.isOccluded(new THREE.Vector3(), new THREE.Vector3(0, 0, 1))).toBe(false);
    });
  });
});
