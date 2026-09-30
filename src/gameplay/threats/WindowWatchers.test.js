import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { GameObject } from '../../core/GameObject.js';
import { SightlineZone } from '../../gameobjects/SightlineZone.js';
import { createMonsterFigure } from '../../gameobjects/MonsterFigure.js';
import { WindowWatchers, WINDOW_WATCHER_KILL, DARK_SIGHT } from './WindowWatchers.js';
import { WINDOW_WATCHERS as T } from './WindowWatcherLogic.js';
import { fakeAudioSystem } from '../../test/fakeAudio.js';

// MarsTerrain (ground height) imports Rapier, whose WASM won't load here.
vi.mock('@dimforge/rapier3d', async () => (await import('../../test/fakeRapier.js')).rapierModule());

// An office moved off the origin, so every point has to go through the
// room's transform. With rand() = 0 the first visit is fully known:
//   idle 25 s; glassX −3; farDistance 15; side −1, farLateral −5.
const OFFSET = [10, 0, 5];
const GLASS = new THREE.Vector3(10 - 3, 0, 5 - 5.6);          // (7, 0, −0.6)
const FAR   = new THREE.Vector3(10 - 3 - 5, 0, 5 - 5.6 - 15); // (2, 0, −15.6)

function makeOffice() {
  const root = new GameObject('MainOffice');
  root.object3d.position.set(...OFFSET);
  const underDesk = new SightlineZone('UnderDesk', { position: [0, 0.35, -2.45], size: [1, 0.7, 0.9] });
  root.addChild(underDesk);
  root.object3d.updateMatrixWorld(true);
  return { root, underDesk, threatAnchors: { windowGlass: [0, 0, -5.6] } };
}

/** Put the camera at an office-local point, looking at a world point. */
function place(camera, local, lookAt) {
  camera.position.set(local[0] + OFFSET[0], local[1] + OFFSET[1], local[2] + OFFSET[2]);
  camera.lookAt(lookAt);
  camera.updateMatrixWorld(true);
}

const STANDING = [0, 1.24, 0];
const UNDER_DESK = [0, 0.55, -2.35];
const INTO_ROOM = new THREE.Vector3(10, 1.24, 50);   // facing away from the window

function run(threat, seconds, each = () => {}, dt = 0.05) {
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    each();
    threat.update(Math.min(dt, seconds - t));
  }
}

describe('WindowWatchers', () => {
  let office, camera, figure, controller, ctx, threat;

  beforeEach(() => {
    office = makeOffice();
    camera = new THREE.PerspectiveCamera();
    figure = createMonsterFigure({ name: 'WindowWatcher' });
    controller = { fail: vi.fn() };
    ctx = {
      engine: { camera },
      rooms: { MainOffice: office },
      transitions: { currentRoom: office },
      controller,
    };
    place(camera, STANDING, INTO_ROOM);
    threat = new WindowWatchers({ figure, rand: () => 0 });
    threat.start(ctx);
  });

  it('tells the player what to do, and starts with nothing at the window', () => {
    expect(threat.objective).toMatch(/desk/i);
    expect(figure.object3d.visible).toBe(false);
    expect(threat.logic.phase).toBe('idle');
  });

  it('walks in from far out to the glass, through the room transform', () => {
    run(threat, 25.01);
    expect(figure.object3d.visible).toBe(true);
    expect(figure.object3d.position.distanceTo(FAR)).toBeLessThan(0.1);

    run(threat, T.approachTime / 2);
    const halfway = new THREE.Vector3().lerpVectors(FAR, GLASS, 0.5);
    expect(figure.object3d.position.distanceTo(halfway)).toBeLessThan(0.2);
    expect(figure.object3d.position.y).toBe(0);
  });

  it('stands at the glass facing into the room while it peers', () => {
    run(threat, 25 + T.approachTime + 0.1);
    expect(threat.logic.phase).toBe('peer');
    expect(figure.object3d.position.distanceTo(GLASS)).toBeLessThan(1e-6);
    const facing = figure.object3d.getWorldDirection(new THREE.Vector3());
    expect(facing.z).toBeGreaterThan(0.99);
  });

  it('ends the night when it sees a player standing in the office', () => {
    run(threat, 25 + T.approachTime + T.peerGrace + 0.1);
    expect(controller.fail).toHaveBeenCalledTimes(1);
    expect(controller.fail).toHaveBeenCalledWith(WINDOW_WATCHER_KILL);
    expect(WINDOW_WATCHER_KILL).toBe('Something saw you through the window.');
  });

  it('misses a player crouched under the desk', () => {
    place(camera, UNDER_DESK, INTO_ROOM);
    run(threat, 25 + T.approachTime + T.peerTime + T.leaveTime + 1);
    expect(controller.fail).not.toHaveBeenCalled();
    expect(threat.logic.visits).toBe(1);
  });

  it('misses a player who is out of the office', () => {
    ctx.transitions.currentRoom = null;
    run(threat, 25 + T.approachTime + T.peerTime + 1);
    expect(controller.fail).not.toHaveBeenCalled();
  });

  it('comes straight to the glass if you stare at it on its way in', () => {
    run(threat, 25.01);
    const head = new THREE.Vector3();
    const stare = () => {
      head.copy(figure.object3d.position).setY(2.2);
      place(camera, STANDING, head);
    };
    run(threat, T.lookHold + 0.1, stare);
    expect(threat.logic.phase).toBe('peer');
    expect(threat.logic.timer).toBeLessThan(T.approachTime / 2);
  });

  it('staring from outside the office does nothing', () => {
    run(threat, 25.01);
    ctx.transitions.currentRoom = null;
    const head = new THREE.Vector3();
    run(threat, T.lookHold + 0.5, () => {
      head.copy(figure.object3d.position).setY(2.2);
      place(camera, STANDING, head);
    });
    expect(threat.logic.phase).toBe('approach');
  });

  it('misses a player standing in a dark office, away from the glass', () => {
    ctx.lights = { dark: true };                        // the power is cut
    run(threat, 25 + T.approachTime + T.peerTime + T.leaveTime + 1);
    expect(controller.fail).not.toHaveBeenCalled();
    expect(threat.logic.visits).toBe(1);
  });

  it('still sees a player within DARK_SIGHT of the glass, dark or not', () => {
    expect(DARK_SIGHT).toBe(2);
    ctx.lights = { dark: true };
    place(camera, [0, 1.24, -5.6 + DARK_SIGHT - 0.4], INTO_ROOM);
    run(threat, 25 + T.approachTime + T.peerGrace + 0.1);
    expect(controller.fail).toHaveBeenCalledWith(WINDOW_WATCHER_KILL);
  });

  it('a lit office hides nothing', () => {
    ctx.lights = { dark: false };
    run(threat, 25 + T.approachTime + T.peerGrace + 0.1);
    expect(controller.fail).toHaveBeenCalledTimes(1);
  });

  it('tells the player the dark is a way to hide', () => {
    expect(threat.objective).toMatch(/dark/i);
  });

  it('stop() hides the figure and it does nothing more', () => {
    run(threat, 26);
    threat.stop();
    expect(figure.object3d.visible).toBe(false);
    run(threat, 30);
    expect(controller.fail).not.toHaveBeenCalled();
    expect(figure.object3d.visible).toBe(false);
  });

  it('a retried night starts over, hidden', () => {
    run(threat, 25 + T.approachTime + 1);
    threat.stop();
    threat.start(ctx);
    expect(threat.logic.phase).toBe('idle');
    expect(figure.object3d.visible).toBe(false);
  });
});

describe('WindowWatchers sound', () => {
  it('taps on the glass, from the glass, the moment it looks in, and only then', () => {
    const office = makeOffice();
    const camera = new THREE.PerspectiveCamera();
    place(camera, UNDER_DESK, INTO_ROOM);
    const figure = createMonsterFigure({ name: 'WindowWatcher' });
    const audio = fakeAudioSystem(vi);
    const threat = new WindowWatchers({ figure, rand: () => 0 });
    threat.start({
      engine: { camera }, rooms: { MainOffice: office },
      transitions: { currentRoom: office }, controller: { fail: vi.fn() }, audio,
    });

    run(threat, 25 + T.approachTime - 0.1);
    expect(audio.play).not.toHaveBeenCalled();
    run(threat, 0.2);
    expect(threat.logic.phase).toBe('peer');
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(audio.play).toHaveBeenCalledWith('sfx:glass-tap', expect.objectContaining({ at: figure.object3d }));
    run(threat, T.peerTime + T.leaveTime);
    expect(audio.play).toHaveBeenCalledTimes(1);
  });
});
