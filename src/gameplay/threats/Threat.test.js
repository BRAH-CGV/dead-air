import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Threat } from './Threat.js';
import { fakeAudioSystem } from '../../test/fakeAudio.js';

describe('Threat sound', () => {
  it('a loop is null while the scene has no audio', () => {
    const threat = new Threat();
    threat.start({ audio: null });
    expect(threat.loop('amb:breathing', new THREE.Object3D())).toBeNull();
  });

  it('makes each loop once, on the object it rides, and keeps it for later nights', () => {
    const audio = fakeAudioSystem(vi);
    const body = new THREE.Object3D();
    const threat = new Threat();
    threat.start({ audio });
    const breath = threat.loop('amb:breathing', body, { refDistance: 1.5 });
    expect(breath.object3d).toBe(body);
    expect(breath.opts).toEqual({ refDistance: 1.5 });
    threat.stop();
    threat.start({ audio });
    expect(threat.loop('amb:breathing', body)).toBe(breath);
    expect(audio.positional).toHaveBeenCalledTimes(1);
  });

  it('stop() silences every loop it made, whatever onStop forgot', () => {
    const audio = fakeAudioSystem(vi);
    const threat = new Threat();
    threat.start({ audio });
    const a = threat.loop('amb:camera-servo', new THREE.Object3D()).setLevel(1);
    const b = threat.loop('amb:camera-tone', new THREE.Object3D()).setLevel(0.5);
    threat.stop();
    expect(a.level).toBe(0);
    expect(b.level).toBe(0);
  });
});
