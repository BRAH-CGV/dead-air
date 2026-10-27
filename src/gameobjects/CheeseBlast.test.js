import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createCheeseBlast, BLAST } from './CheeseBlast.js';

/** Each instance's world position and scale, read off its matrix. */
function instances(mesh) {
  mesh.updateMatrixWorld(true);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  return Array.from({ length: mesh.count }, (_, i) => {
    mesh.getMatrixAt(i, m);
    m.premultiply(mesh.matrixWorld).decompose(p, q, s);
    return { p: p.clone(), scale: s.x };
  });
}

/** Each spark's world position. */
function sparks(blast) {
  const a = blast.sparks.geometry.attributes.position;
  return Array.from({ length: a.count }, (_, i) => new THREE.Vector3(a.getX(i), a.getY(i), a.getZ(i)).add(blast.position));
}

function run(blast, seconds) {
  for (let i = 0; i < Math.round(seconds * 60); i++) blast.update(1 / 60);
}

/** An office-sized room, and a desk-top point in it off to one side. */
const ROOM = new THREE.Box3(new THREE.Vector3(-6, 0, -5), new THREE.Vector3(6, 3, 5));
const AT = new THREE.Vector3(1.1, 1, -2.6);
const inRoom = p => ROOM.clone().expandByScalar(1e-6).containsPoint(p);

describe('createCheeseBlast', () => {
  it('waits hidden until it is played', () => {
    const blast = createCheeseBlast();
    expect(blast.visible).toBe(false);
    expect(blast.playing).toBe(false);
    blast.dispose();
  });

  it('five draws: shockwave, fire, smoke, debris, and thousands of sparks', () => {
    const blast = createCheeseBlast();
    expect(blast.fire).toBeInstanceOf(THREE.InstancedMesh);
    expect(blast.smoke).toBeInstanceOf(THREE.InstancedMesh);
    expect(blast.debris.count).toBe(BLAST.debris.count);
    expect(blast.sparks).toBeInstanceOf(THREE.Points);
    expect(blast.sparks.geometry.attributes.position.count).toBeGreaterThanOrEqual(2000);
    blast.dispose();
  });

  it('the fire and sparks are unlit and drawn from both sides, so a view inside is filled', () => {
    const blast = createCheeseBlast();
    expect(blast.fire.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(blast.fire.material.side).toBe(THREE.DoubleSide);
    expect(blast.sparks.material.blending).toBe(THREE.AdditiveBlending);
    blast.dispose();
  });

  it('goes off where it is told, in world space', () => {
    const blast = createCheeseBlast();
    blast.play(AT, { bounds: ROOM });
    expect(blast.position.equals(AT)).toBe(true);
    blast.dispose();
  });

  it('the shockwave tears out past the walls in a moment, and is gone', () => {
    const blast = createCheeseBlast();
    blast.play(AT, { bounds: ROOM });
    run(blast, BLAST.shock.seconds * 0.6);
    expect(blast.shock.scale.x).toBeGreaterThan(4);
    run(blast, BLAST.shock.seconds);
    expect(blast.shock.visible).toBe(false);
    blast.dispose();
  });

  it('the fire fills the room, metres out, and stops at its walls and ceiling', () => {
    const blast = createCheeseBlast();
    blast.play(AT, { bounds: ROOM });
    let far = 0;
    for (let i = 0; i < 40; i++) {
      blast.update(1 / 60);
      for (const f of instances(blast.fire)) {
        far = Math.max(far, f.p.distanceTo(AT));
        expect(inRoom(f.p)).toBe(true);
      }
    }
    expect(far).toBeGreaterThan(3);
    blast.dispose();
  });

  it('sparks fly fast and far but never leave the room: they bounce', () => {
    const blast = createCheeseBlast();
    blast.play(AT, { bounds: ROOM });
    run(blast, 0.5);
    const at = sparks(blast);
    expect(at.every(inRoom)).toBe(true);
    expect(Math.max(...at.map(p => p.distanceTo(AT)))).toBeGreaterThan(4);
    // Some reached a wall or the ceiling and were turned back.
    const onASide = at.filter(p => p.x <= ROOM.min.x + 0.3 || p.x >= ROOM.max.x - 0.3
      || p.z <= ROOM.min.z + 0.3 || p.z >= ROOM.max.z - 0.3 || p.y >= ROOM.max.y - 0.3);
    expect(onASide.length).toBeGreaterThan(0);
    blast.dispose();
  });

  it('sparks cool to nothing', () => {
    const blast = createCheeseBlast();
    blast.play(AT, { bounds: ROOM });
    run(blast, BLAST.sparks.life[1] + 0.1);
    const c = blast.sparks.geometry.attributes.color.array;
    expect(Math.max(...c)).toBeLessThan(0.01);
    blast.dispose();
  });

  it('the debris ends up lying on the floor, inside the room', () => {
    const blast = createCheeseBlast();
    blast.play(AT, { bounds: ROOM });
    run(blast, BLAST.seconds - 0.1);
    const pieces = instances(blast.debris);
    expect(pieces.every(d => inRoom(d.p))).toBe(true);
    expect(pieces.filter(d => d.p.y < 0.05).length).toBeGreaterThan(pieces.length * 0.8);
    blast.dispose();
  });

  it('flares the room light orange and puts it back as it was', () => {
    const light = new THREE.PointLight(0xffd8a8, 14);
    const blast = createCheeseBlast();
    blast.play(AT, { bounds: ROOM, light });
    run(blast, 0.1);
    expect(light.intensity).toBeGreaterThan(100);
    expect(light.color.getHex()).not.toBe(0xffd8a8);
    run(blast, BLAST.light.seconds);
    expect(light.intensity).toBe(14);
    expect(light.color.getHex()).toBe(0xffd8a8);
    blast.dispose();
  });

  it('without bounds nothing stops it', () => {
    const blast = createCheeseBlast();
    blast.play(new THREE.Vector3());
    run(blast, 1);
    expect(Math.min(...sparks(blast).map(p => p.y))).toBeLessThan(-1);
    blast.dispose();
  });

  it('is gone again after, and can be played again', () => {
    const blast = createCheeseBlast();
    blast.play(AT, { bounds: ROOM });
    run(blast, BLAST.seconds + 0.1);
    expect(blast.visible).toBe(false);
    expect(blast.playing).toBe(false);
    blast.play(AT, { bounds: ROOM });
    expect(blast.visible).toBe(true);
    blast.dispose();
  });

  it('casts no shadow', () => {
    const blast = createCheeseBlast();
    for (const m of [blast.shock, blast.fire, blast.smoke, blast.debris, blast.sparks]) expect(m.castShadow).toBe(false);
    blast.dispose();
  });
});
