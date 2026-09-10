import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SkyFollow } from './SkyFollow.js';
import { GameObject } from '../core/GameObject.js';

// ─────────────────────────────────────────────
// SkyFollow  –  sky dome camera tracking
// ─────────────────────────────────────────────
// Built by hand rather than through the Engine, which would drag in Rapier's
// WASM for a component that only reads a camera transform.

/** A GameObject with a component attached and a camera reachable the way the
 *  engine exposes one, at scene.userData.engine.camera. */
function buildSky(camera) {
  const go = new GameObject('MarsSky');
  go.scene = { userData: { engine: { camera } } };

  const follow = new SkyFollow();
  go.addComponent(follow);
  return { go, follow };
}

describe('SkyFollow tracking', () => {
  it('recentres the dome on the camera', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(3, 4, 5);

    const { go, follow } = buildSky(camera);
    follow.onLateUpdate(1 / 60);

    expect(go.object3d.position.toArray()).toEqual([3, 4, 5]);
  });

  it('uses the camera world position, not its local one', () => {
    // The camera normally hangs off the player, so its local position is only
    // an eye offset — following that would leave the dome at the origin.
    const rig = new THREE.Object3D();
    rig.position.set(10, 0, -20);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 1.6, 0);
    rig.add(camera);
    rig.updateMatrixWorld(true);

    const { go, follow } = buildSky(camera);
    follow.onLateUpdate(1 / 60);

    expect(go.object3d.position.toArray()).toEqual([10, 1.6, -20]);
  });

  it('does not rotate the dome, which would drag the stars along', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.rotation.set(0.3, 0.4, 0.5);

    const { go, follow } = buildSky(camera);
    follow.onLateUpdate(1 / 60);

    expect(go.object3d.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
  });
});

describe('SkyFollow shader time', () => {
  it('advances uTime by the elapsed time', () => {
    const { go, follow } = buildSky(new THREE.PerspectiveCamera());
    go.skyUniforms = { uTime: { value: 0 } };

    follow.onLateUpdate(0.5);
    follow.onLateUpdate(0.25);

    expect(go.skyUniforms.uTime.value).toBeCloseTo(0.75);
  });

  it('runs on a GameObject with no uniforms attached', () => {
    const { follow } = buildSky(new THREE.PerspectiveCamera());
    expect(() => follow.onLateUpdate(1 / 60)).not.toThrow();
  });
});

describe('SkyFollow before the scene is wired up', () => {
  it('waits quietly when there is no scene yet', () => {
    const go = new GameObject('MarsSky');
    const follow = new SkyFollow();
    go.addComponent(follow);

    expect(() => follow.onLateUpdate(1 / 60)).not.toThrow();
    expect(go.object3d.position.toArray()).toEqual([0, 0, 0]);
  });

  it('waits quietly when the scene carries no engine', () => {
    const go = new GameObject('MarsSky');
    go.scene = { userData: {} };
    const follow = new SkyFollow();
    go.addComponent(follow);

    expect(() => follow.onLateUpdate(1 / 60)).not.toThrow();
  });
});
