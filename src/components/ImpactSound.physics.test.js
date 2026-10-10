import { describe, it, expect } from 'vitest';
import RAPIER from '@dimforge/rapier3d';
import { ImpactSound, IMPACT } from './ImpactSound.js';

// ─────────────────────────────────────────────
// The real physics engine, a floor, and a body built the way DriveBox and
// Drive build theirs. ImpactSound reads a knock off the change in velocity
// from one step to the next; these pin that Rapier really does take a
// landing in one step, and really does leave a resting body alone.
// ─────────────────────────────────────────────
import { GameObject } from '../core/GameObject.js';

const DT = 1 / 60;

/** A prop `y` above the floor (its centre), tipped `tilt` radians, with a
 *  sound that only notes when it was played and how loud. */
function rig({ size, y, linDamp, angDamp, restitution, friction, density, tilt = 0 }) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.cuboid(10, 0.5, 10).setTranslation(0, -0.5, 0));
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(0, y, 0).setRotation({ x: Math.sin(tilt / 2), y: 0, z: 0, w: Math.cos(tilt / 2) })
    .setLinearDamping(linDamp).setAngularDamping(angDamp).setCcdEnabled(true));
  world.createCollider(RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2)
    .setFriction(friction).setRestitution(restitution).setDensity(density), body);
  const prop = new GameObject('Prop');
  prop.rigidBody = body;
  const plays = [];
  const sound = { isPlaying: false, play: () => { plays.push({ t: time, v: sound.volume }); }, stop() {}, setBuffer() {}, setVolume(v) { sound.volume = v; } };
  const voice = prop.addComponent(new ImpactSound({ buffers: ['a', 'b', 'c'], sound }));
  let time = 0;
  const run = (seconds) => { for (let i = 0; i < seconds / DT; i++) { voice.onFixedUpdate(DT); world.step(); time += DT; } };
  return { world, body, voice, plays, run };
}
const BOX = { size: [0.32, 0.12, 0.28], linDamp: 0.8, angDamp: 1.2, restitution: 0.05, friction: 0.7, density: 1.2 / (0.32 * 0.12 * 0.28) };
const DRIVE = { size: [0.08, 0.02, 0.12], linDamp: 0.5, angDamp: 1.0, restitution: 0.1, friction: 0.6, density: 800 };

/** A box's centre when it stands on the floor. */
const onFloor = spec => spec.size[1] / 2;

describe.each([['drive box', BOX], ['drive', DRIVE]])('ImpactSound on a real %s', (_name, spec) => {
  it('is silent resting on the floor', () => {
    const { plays, run } = rig({ ...spec, y: onFloor(spec) });
    run(3);
    expect(plays).toEqual([]);
  });

  it('knocks once, softly, put down from just above it', () => {
    const { plays, run } = rig({ ...spec, y: onFloor(spec) + 0.08 });
    run(3);
    expect(plays).toHaveLength(1);
    expect(plays[0].v).toBeGreaterThanOrEqual(IMPACT.minLevel);
    expect(plays[0].v).toBeLessThan(0.7);
  });

  it('knocks once, hard, dropped flat from the hand', () => {
    const { plays, run } = rig({ ...spec, y: 0.8 });
    run(3);
    expect(plays).toHaveLength(1);
    expect(plays[0].v).toBeGreaterThan(0.9);
    // As it lands, not before: 0.8 m is 0.4 s of falling.
    expect(plays[0].t).toBeGreaterThan(0.35);
    expect(plays[0].t).toBeLessThan(0.5);
  });

  it('clatters, but only a few times, dropped on an edge', () => {
    const { plays, run } = rig({ ...spec, y: 1.2, tilt: 1.3 });
    run(4);
    expect(plays.length).toBeGreaterThanOrEqual(1);
    expect(plays.length).toBeLessThanOrEqual(4);
    expect(plays[0].v).toBeGreaterThan(0.9);
    // And then lies still.
    expect(plays.at(-1).t).toBeLessThan(2);
  });
});
