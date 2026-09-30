import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { FatigueEffects } from './FatigueEffects.js';
import { Stamina } from '../gameplay/Stamina.js';
import { FATIGUE, tunnel, heartbeat } from '../gameplay/Fatigue.js';
import { fakeAudioSystem } from '../test/fakeAudio.js';

describe('FatigueEffects', () => {
  let stamina, controller, overlay, audio, lights, camera, engine, fx;

  beforeEach(() => {
    stamina = new Stamina();
    controller = { state: 'playing', nightNumber: 1 };
    overlay = { set: vi.fn() };
    audio = fakeAudioSystem(vi);
    lights = { setFactor: vi.fn() };
    camera = new THREE.Object3D();
    engine = { debugCamera: { active: false } };
    fx = new FatigueEffects({ stamina, controller, overlay, audio, lights, listener: camera, engine, rand: () => 0 });
  });

  function run(seconds, dt = 0.05) {
    for (let t = 0; t < seconds - 1e-9; t += dt) fx.onUpdate(dt);
  }

  it('narrows the view as stamina falls', () => {
    stamina.value = 0.2;
    fx.onUpdate(0.016);
    expect(overlay.set).toHaveBeenLastCalledWith(tunnel(0.2), 0);
  });

  it('yawns out loud when tired', () => {
    stamina.value = 0.4;
    run(FATIGUE.firstYawn[0] + 0.1);
    expect(audio.play).toHaveBeenCalledWith('sfx:yawn', expect.any(Object));
  });

  it('blinks when critical: the overlay gets the lids', () => {
    stamina.value = 0.15;
    let shut = 0;
    for (let t = 0; t < FATIGUE.blinkGap[0] + 0.3; t += 0.01) {
      fx.onUpdate(0.01);
      shut = Math.max(shut, overlay.set.mock.lastCall[1]);
    }
    expect(shut).toBeGreaterThan(0.9);
  });

  it("writes the lights' 'dread' factor: 1, stuttering when critical", () => {
    fx.onUpdate(0.016);
    expect(lights.setFactor).toHaveBeenLastCalledWith('dread', 1);
    stamina.value = 0.1;
    const seen = new Set();
    for (let t = 0; t < 20; t += 0.01) {
      fx.onUpdate(0.01);
      seen.add(lights.setFactor.mock.lastCall[1]);
    }
    expect(seen).toEqual(new Set([1, FATIGUE.dreadMin]));
  });

  it('a heartbeat on the listener, rising and quickening through critical', () => {
    const beat = audio.loop('amb:heartbeat');
    expect(beat.object3d).toBe(camera);
    stamina.value = 0.5;
    fx.onUpdate(0.016);
    expect(beat.level).toBe(0);
    stamina.value = 0.1;
    fx.onUpdate(0.016);
    expect(beat.level).toBeCloseTo(heartbeat(0.1));
    const slow = beat.rate;
    stamina.value = 0.02;
    fx.onUpdate(0.016);
    expect(beat.rate).toBeGreaterThan(slow);
  });

  it('off shift: eyes open, lights steady, heart quiet', () => {
    stamina.value = 0.05;
    run(FATIGUE.blinkGap[0] + 0.05, 0.01);
    controller.state = 'morning';
    audio.play.mockClear();
    fx.onUpdate(0.016);
    expect(overlay.set.mock.lastCall[1]).toBe(0);
    expect(lights.setFactor).toHaveBeenLastCalledWith('dread', 1);
    expect(audio.loop('amb:heartbeat').level).toBe(0);
    run(60);
    expect(audio.play).not.toHaveBeenCalledWith('sfx:yawn', expect.anything());
  });

  it('a new night starts the clocks again: no yawn until tiredness sets in anew', () => {
    stamina.value = 0.4;
    run(1);
    controller.nightNumber = 2;
    run(FATIGUE.firstYawn[0] - 0.2);
    expect(audio.play).not.toHaveBeenCalled();
  });

  it('the fly camera sees the scene clear: no tunnel, no lids', () => {
    stamina.value = 0.1;
    engine.debugCamera.active = true;
    fx.onUpdate(0.016);
    expect(overlay.set).toHaveBeenLastCalledWith(0, 0);
  });

  it('leaves the view clear when the scene is torn down', () => {
    overlay.clear = vi.fn();
    fx.onDestroy();
    expect(overlay.clear).toHaveBeenCalled();
  });

  it('runs without audio, overlay or lights', () => {
    const bare = new FatigueEffects({ stamina, controller });
    expect(() => bare.onUpdate(0.016)).not.toThrow();
  });
});
