import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { FreeCam } from './FreeCam.js';

const DT = 1 / 60;

function buildFreeCamHarness(keys = {}) {
  const setGravityScale = vi.fn();
  const setNextKinematicTranslation = vi.fn();
  const rb = {
    translation: vi.fn(() => ({ x: 1, y: 2, z: 3 })),
    setGravityScale,
    setNextKinematicTranslation,
  };
  const engine = {
    input: { keys, pressed: {} },
    keyBinds: {
      forward: 'KeyW',
      back: 'KeyS',
      left: 'KeyA',
      right: 'KeyD',
    },
  };
  const freeCam = new FreeCam({ speed: 6 });
  freeCam.camera = new THREE.PerspectiveCamera();
  freeCam.gameObject = {
    rigidBody: rb,
    scene: { userData: { engine } },
  };

  return { freeCam, rb, engine, setGravityScale, setNextKinematicTranslation };
}

describe('FreeCam', () => {
  it('toggles active state and gravity with V edge input', () => {
    const { freeCam, engine, setGravityScale } = buildFreeCamHarness({
      KeyV: true,
    });
    engine.input.pressed.KeyV = true;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    freeCam.onUpdate(DT);
    expect(freeCam.active).toBe(true);
    expect(setGravityScale).toHaveBeenLastCalledWith(0, true);

    engine.input.pressed = {};
    freeCam.onUpdate(DT);
    expect(freeCam.active).toBe(true);
    expect(setGravityScale).toHaveBeenCalledTimes(1);
    
    engine.input.keys.KeyV = false;
    engine.input.pressed = {};
    freeCam.onUpdate(DT);
    engine.input.keys.KeyV = true;
    engine.input.pressed.KeyV = true;
    freeCam.onUpdate(DT);
    expect(freeCam.active).toBe(false);
    expect(setGravityScale).toHaveBeenLastCalledWith(1, true);

    log.mockRestore();
  });

  it('moves in fixed update when active so physics sees the freecam translation', () => {
    const { freeCam, setNextKinematicTranslation } = buildFreeCamHarness({
      KeyW: true,
      KeyE: true,
    });
    freeCam.active = true;

    freeCam.onFixedUpdate(DT);

    expect(setNextKinematicTranslation).toHaveBeenCalledTimes(1);
    const next = setNextKinematicTranslation.mock.calls[0][0];
    expect(next.x).toBeCloseTo(1, 10);
    expect(next.y).toBeCloseTo(2 + Math.sqrt(18) / 60, 10);
    expect(next.z).toBeCloseTo(3 - Math.sqrt(18) / 60, 10);
  });

  it('does not move the player while inactive', () => {
    const { freeCam, setNextKinematicTranslation } = buildFreeCamHarness({
      KeyW: true,
      KeyE: true,
    });

    freeCam.onFixedUpdate(DT);

    expect(setNextKinematicTranslation).not.toHaveBeenCalled();
  });

  it('restores gravity when destroyed', () => {
    const { freeCam, setGravityScale } = buildFreeCamHarness();
    freeCam.active = true;

    freeCam.onDestroy();

    expect(freeCam.active).toBe(false);
    expect(setGravityScale).toHaveBeenLastCalledWith(1, true);
  });
});
