import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { framePose, ScreenFocusMotion, SCREEN_FOCUS } from './ScreenFocus.js';

const v = (x, y, z) => new THREE.Vector3(x, y, z);

/** A 0.4 × 0.3 m screen at z = −2, upright, facing +z. */
const upright = [v(-0.2, 1.15, -2), v(0.2, 1.15, -2), v(0.2, 0.85, -2), v(-0.2, 0.85, -2)];

/** Where each corner lands in normalised device coords, seen from a pose. */
function project(pose, corners, fov, aspect) {
  const cam = new THREE.PerspectiveCamera(fov, aspect, 0.01, 100);
  cam.position.copy(pose.position);
  cam.quaternion.copy(pose.quaternion);
  cam.updateMatrixWorld();
  return corners.map(c => c.clone().project(cam));
}

describe('framePose', () => {
  it('stands in front of the screen, on its normal, looking straight at it', () => {
    const pose = framePose(upright, { fov: 40, aspect: 16 / 9, fill: 0.9 });
    expect(pose.position.x).toBeCloseTo(0);
    expect(pose.position.y).toBeCloseTo(1.0);
    expect(pose.position.z).toBeGreaterThan(-2);
    const forward = v(0, 0, -1).applyQuaternion(pose.quaternion);
    expect(forward.z).toBeCloseTo(-1);
  });

  it('fills `fill` of the view in the tighter direction, the screen the right way up', () => {
    const fill = 0.9;
    // 4:3 screen in a 16:9 view: height is the tighter.
    const pose = framePose(upright, { fov: 40, aspect: 16 / 9, fill });
    const [tl, tr, br, bl] = project(pose, upright, 40, 16 / 9);
    expect(tl.y - bl.y).toBeCloseTo(2 * fill, 3);   // NDC spans 2
    expect(tr.x - tl.x).toBeLessThan(2 * fill);
    expect(tl.x).toBeLessThan(tr.x);                 // not mirrored
    expect(tl.y).toBeGreaterThan(bl.y);              // not upside down
    expect(br.x).toBeCloseTo(tr.x, 5);
  });

  it('a wide screen in a narrow view is held by its width', () => {
    const wide = [v(-0.5, 1.1, -2), v(0.5, 1.1, -2), v(0.5, 0.9, -2), v(-0.5, 0.9, -2)];
    const pose = framePose(wide, { fov: 40, aspect: 1, fill: 0.8 });
    const [tl, tr] = project(pose, wide, 40, 1);
    expect(tr.x - tl.x).toBeCloseTo(1.6, 3);
  });

  it('follows a screen tilted back, looking down onto it', () => {
    // Tilted 30° back: the top is further away than the bottom.
    const s = Math.sin(Math.PI / 6) * 0.3, c = Math.cos(Math.PI / 6) * 0.3;
    const tilted = [v(-0.2, 0.9 + c, -2 - s), v(0.2, 0.9 + c, -2 - s), v(0.2, 0.9, -2), v(-0.2, 0.9, -2)];
    const pose = framePose(tilted, { fov: 40, aspect: 16 / 9, fill: 0.9 });
    const forward = v(0, 0, -1).applyQuaternion(pose.quaternion);
    expect(forward.y).toBeCloseTo(-Math.sin(Math.PI / 6), 5);
    const [tl, tr, br, bl] = project(pose, tilted, 40, 16 / 9);
    // Square on: the top edge as wide as the bottom.
    expect(tr.x - tl.x).toBeCloseTo(br.x - bl.x, 5);
  });
});

describe('ScreenFocusMotion', () => {
  it('rests idle, out of the screen', () => {
    const m = new ScreenFocusMotion();
    expect(m.phase).toBe('idle');
    expect(m.t).toBe(0);
    expect(m.active).toBe(false);
  });

  it('moves in over inSeconds, eased, then holds on the screen', () => {
    const m = new ScreenFocusMotion();
    m.enter();
    expect(m.phase).toBe('in');
    expect(m.active).toBe(true);
    m.update(SCREEN_FOCUS.inSeconds / 2);
    expect(m.t).toBeCloseTo(0.5);         // smoothstep is symmetric
    m.update(SCREEN_FOCUS.inSeconds);
    expect(m.phase).toBe('on');
    expect(m.t).toBe(1);
  });

  it('starts slow: eased, not linear', () => {
    const m = new ScreenFocusMotion();
    m.enter();
    m.update(SCREEN_FOCUS.inSeconds * 0.1);
    expect(m.t).toBeLessThan(0.1);
  });

  it('moves back out, and says when it is done', () => {
    const m = new ScreenFocusMotion();
    m.enter();
    m.update(10);
    m.leave();
    expect(m.phase).toBe('out');
    expect(m.update(SCREEN_FOCUS.outSeconds / 2)).toBe(false);
    expect(m.t).toBeCloseTo(0.5);
    expect(m.update(SCREEN_FOCUS.outSeconds)).toBe(true);   // just closed
    expect(m.phase).toBe('idle');
    expect(m.t).toBe(0);
    expect(m.update(1)).toBe(false);
  });

  it('turns back from wherever it got to', () => {
    const m = new ScreenFocusMotion();
    m.enter();
    m.update(SCREEN_FOCUS.inSeconds / 2);
    m.leave();
    m.update(SCREEN_FOCUS.outSeconds / 4);
    const t = m.t;
    m.enter();
    expect(m.t).toBeCloseTo(t);
    m.update(0.0001);
    expect(m.phase).toBe('in');
  });

  it('leaving from idle does nothing', () => {
    const m = new ScreenFocusMotion();
    m.leave();
    expect(m.phase).toBe('idle');
  });

  it('cut() drops straight back to idle', () => {
    const m = new ScreenFocusMotion();
    m.enter();
    m.update(10);
    m.cut();
    expect(m.phase).toBe('idle');
    expect(m.t).toBe(0);
  });
});
