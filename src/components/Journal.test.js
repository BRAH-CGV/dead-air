import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Journal, READING_TIME_SCALE } from './Journal.js';
import { journalEntry } from '../gameplay/journal.js';

function setup() {
  const engine = {
    timeScale: 1,
    input: { keys: {}, pressed: {} },
    keyBinds: { interact: 'KeyE' },
    playerController: { inputLocked: false },
  };
  const material = new THREE.MeshStandardMaterial();
  const journal = new Journal();
  journal.controller = { nightNumber: 1, state: 'playing' };
  journal.panel = { show: vi.fn(), hide: vi.fn(), visible: false };
  journal.material = material;
  journal.gameObject = { scene: { userData: { engine } } };
  return { engine, journal, material };
}

/** One frame with `code` pressed this frame (and held). */
function press(engine, journal, code) {
  engine.input.keys[code] = true;
  engine.input.pressed[code] = true;
  journal.onUpdate(1 / 60);
  engine.input.pressed = {};
}
function release(engine, journal, code) {
  engine.input.keys[code] = false;
  journal.onUpdate(1 / 60);
}

describe('Journal (#79)', () => {
  let engine, journal, material;
  beforeEach(() => ({ engine, journal, material } = setup()));

  it('offers to be read', () => {
    expect(journal.promptLabel).toMatch(/\[E\] Read/);
  });

  it('opens tonight\'s entry, slows time, and holds the player still', () => {
    journal.controller.nightNumber = 2;
    journal.onInteract();
    expect(journal.panel.show).toHaveBeenCalledWith(journalEntry(2));
    expect(journal.open).toBe(true);
    expect(engine.timeScale).toBe(READING_TIME_SCALE);
    expect(READING_TIME_SCALE).toBeLessThan(1);
    expect(engine.playerController.inputLocked).toBe(true);
  });

  it('the E press that opened it does not close it again', () => {
    engine.input.keys.KeyE = true;
    engine.input.pressed.KeyE = true;
    journal.onInteract();
    journal.onUpdate(1 / 60);
    expect(journal.open).toBe(true);
  });

  it('a fresh E press puts it down: time and the player back to normal', () => {
    journal.onInteract();
    release(engine, journal, 'KeyE');
    press(engine, journal, 'KeyE');
    expect(journal.open).toBe(false);
    expect(journal.panel.hide).toHaveBeenCalled();
    expect(engine.timeScale).toBe(1);
    expect(engine.playerController.inputLocked).toBe(false);
  });

  it('Q puts it down too, like the terminal', () => {
    journal.onInteract();
    press(engine, journal, 'KeyQ');
    expect(journal.open).toBe(false);
  });

  it('glows until tonight\'s entry is read, then stops', () => {
    for (let i = 0; i < 20; i++) journal.onUpdate(1 / 60);
    expect(material.emissiveIntensity).toBeGreaterThan(0);
    journal.onInteract();
    journal.close();
    journal.onUpdate(1 / 60);
    expect(material.emissiveIntensity).toBe(0);
  });

  it('glows again for a new night\'s entry', () => {
    journal.onInteract();
    journal.close();
    journal.controller.nightNumber = 2;
    for (let i = 0; i < 20; i++) journal.onUpdate(1 / 60);
    expect(material.emissiveIntensity).toBeGreaterThan(0);
  });

  it('closes, and gives time back, if it goes while open (a scene rebuild)', () => {
    journal.onInteract();
    journal.onDestroy();
    expect(engine.timeScale).toBe(1);
    expect(engine.playerController.inputLocked).toBe(false);
  });

  it('opening twice is harmless', () => {
    journal.onInteract();
    journal.onInteract();
    expect(journal.panel.show).toHaveBeenCalledOnce();
  });
});
