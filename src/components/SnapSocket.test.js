import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { SnapSocket } from './SnapSocket.js';
import { Pickupable } from './Pickupable.js';
import { ImpactSound, IMPACT } from './ImpactSound.js';

function makeItem(name = 'Item', position = [0, 0, 0], held = false) {
  const pickupable = new Pickupable();
  pickupable.held = held;
  pickupable.promptLabel = '[E] Pick up';
  const object3d = new THREE.Object3D();
  object3d.name = name;
  object3d.position.set(...position);
  return {
    name,
    object3d,
    components: [pickupable],
    rigidBody: {
      setTranslation: vi.fn(),
      setRotation: vi.fn(),
    },
    makeKinematic: vi.fn(),
    makeDynamic: vi.fn(),
    getComponent(Type) {
      return this.components.find(c => c instanceof Type) ?? null;
    },
    _pickupable: pickupable,
  };
}

function makeSocket(opts = {}) {
  const socket = new SnapSocket({ playSounds: false, ...opts });
  const object3d = new THREE.Object3D();
  socket.gameObject = {
    object3d,
    scene: { userData: { engine: null } },
  };
  return socket;
}

describe('SnapSocket', () => {
  it('snaps a nearby unheld registered item', () => {
    const socket = makeSocket({ snapDistance: 0.5 });
    const item = makeItem('Drive', [0.1, 0, 0]);
    socket.addCandidate(item);

    socket.onUpdate(0.016);

    expect(socket.firstAttached).toBe(item);
    expect(item.makeKinematic).toHaveBeenCalledTimes(1);
    expect(item._snapOwner).toBe(socket);
  });

  it('snaps into a later slot when an earlier empty slot is out of reach', () => {
    const socket = makeSocket({
      snapDistance: 0.05,
      slots: [{ offset: { x: -0.12 } }, { offset: { x: 0.12 } }],
    });
    const item = makeItem('Drive', [0.12, 0, 0]);
    socket.addCandidate(item);

    socket.onUpdate(0.016);

    expect(socket.firstAttached).toBe(item);
    expect(item._snapSlotIndex).toBe(1);
  });

  it('applies a slot rotation to the snapped item', () => {
    const rotation = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const socket = makeSocket({
      snapDistance: 0.5,
      slots: [{ offset: { y: 0.1 }, rotation }],
    });
    const item = makeItem('Drive', [0, 0.1, 0]);
    socket.addCandidate(item);

    socket.onUpdate(0.016);

    const calls = item.rigidBody.setRotation.mock.calls;
    const [q] = calls[calls.length - 1];
    const forward = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
    expect(forward.x).toBeCloseTo(1);
    expect(forward.y).toBeCloseTo(0);
    expect(forward.z).toBeCloseTo(0);
  });

  it('ignores held items', () => {
    const socket = makeSocket({ snapDistance: 0.5 });
    const item = makeItem('Drive', [0.1, 0, 0], true);
    socket.addCandidate(item);

    socket.onUpdate(0.016);

    expect(socket.firstAttached).toBeNull();
    expect(item.makeKinematic).not.toHaveBeenCalled();
  });

  it('ignores items owned by another socket', () => {
    const socket = makeSocket({ snapDistance: 0.5 });
    const other = makeSocket({ snapDistance: 0.5 });
    const item = makeItem('Drive', [0.1, 0, 0]);
    item._snapOwner = other;
    socket.addCandidate(item);

    socket.onUpdate(0.016);

    expect(socket.firstAttached).toBeNull();
    expect(item.makeKinematic).not.toHaveBeenCalled();
  });

  it('installs and clears onBeforePickUp while restoring physics', () => {
    const socket = makeSocket({ snapDistance: 0.5 });
    const item = makeItem('Drive', [0.1, 0, 0]);
    socket.addCandidate(item);
    socket.onUpdate(0.016);

    expect(item._pickupable.onBeforePickUp).toEqual(expect.any(Function));
    item._pickupable.onBeforePickUp();

    expect(socket.firstAttached).toBeNull();
    expect(item.makeDynamic).toHaveBeenCalledTimes(1);
    expect(item._pickupable.onBeforePickUp).toBeNull();
    expect(item._snapOwner).toBeNull();
  });

  it('updates an attached item transform when the host moves', () => {
    const socket = makeSocket({
      snapDistance: 0.5,
      slots: [{ offset: { x: 0, y: 0.2, z: 0 } }],
    });
    const item = makeItem('Drive', [0, 0.1, 0]);
    socket.addCandidate(item);
    socket.onUpdate(0.016);

    socket.gameObject.object3d.position.set(1, 2, 3);
    socket.onUpdate(0.016);

    const calls = item.rigidBody.setTranslation.mock.calls;
    const [pos] = calls[calls.length - 1];
    expect(pos.x).toBeCloseTo(1);
    expect(pos.y).toBeCloseTo(2.2);
    expect(pos.z).toBeCloseTo(3);
  });

  it('supports independent receivers without stealing', () => {
    const first = makeSocket({ snapDistance: 0.5 });
    const second = makeSocket({ snapDistance: 0.5 });
    const item = makeItem('Drive', [0.1, 0, 0]);
    first.addCandidate(item);
    second.addCandidate(item);

    first.onUpdate(0.016);
    second.onUpdate(0.016);

    expect(first.firstAttached).toBe(item);
    expect(second.firstAttached).toBeNull();
  });

  it('sets and restores an attached prompt label', () => {
    const socket = makeSocket({ snapDistance: 0.5, attachedPromptLabel: '[E] Take drive' });
    const item = makeItem('Drive', [0.1, 0, 0]);
    socket.addCandidate(item);

    socket.onUpdate(0.016);
    expect(item._pickupable.promptLabel).toBe('[E] Take drive');

    socket.detach(item);
    expect(item._pickupable.promptLabel).toBe('[E] Pick up');
  });

  describe('sounds', () => {
    /** An item that carries its own knock. */
    function makeLoudItem(name, position) {
      const item = makeItem(name, position);
      const impact = new ImpactSound();
      impact.handle = vi.fn();
      item.components.push(impact);
      return { item, impact };
    }

    it('beeps by default, and leaves the item quiet', () => {
      const socket = makeSocket({ playSounds: true });
      const beep = vi.spyOn(socket, '_playBeep').mockImplementation(() => {});
      const { item, impact } = makeLoudItem('Drive', [0, 0, 0]);

      socket.attach(item);
      socket.detach(item);

      expect(beep.mock.calls).toEqual([['insert'], ['eject']]);
      expect(impact.handle).not.toHaveBeenCalled();
    });

    it("plays the item's own knock instead, seating it and taking it out, when set to 'item'", () => {
      const socket = makeSocket({ playSounds: true, sounds: 'item' });
      const beep = vi.spyOn(socket, '_playBeep').mockImplementation(() => {});
      const { item, impact } = makeLoudItem('Drive', [0, 0, 0]);

      socket.attach(item);
      expect(impact.handle).toHaveBeenCalledTimes(1);
      expect(impact.handle).toHaveBeenLastCalledWith(IMPACT.seatLevel);

      socket.detach(item);
      expect(impact.handle).toHaveBeenCalledTimes(2);
      expect(beep).not.toHaveBeenCalled();
    });

    it("stays quiet for a silent detach, and with sounds off, in 'item' mode too", () => {
      const socket = makeSocket({ playSounds: true, sounds: 'item' });
      const { item, impact } = makeLoudItem('Drive', [0, 0, 0]);
      socket.attach(item);
      impact.handle.mockClear();
      socket.detach(item, { playSound: false });
      expect(impact.handle).not.toHaveBeenCalled();

      const mute = makeSocket({ playSounds: false, sounds: 'item' });
      mute.attach(item);
      mute.detach(item);
      expect(impact.handle).not.toHaveBeenCalled();
    });

    describe('clips of its own', () => {
      const SOUNDS = { insert: ['sfx:in-1', 'sfx:in-2'], remove: ['sfx:out-1', 'sfx:out-2'], volume: 0.8 };
      const LOADED = { 'sfx:in-1': 'IN1', 'sfx:in-2': 'IN2', 'sfx:out-1': 'OUT1', 'sfx:out-2': 'OUT2' };

      function fakeSound() {
        const sound = {
          isPlaying: false,
          volume: 1,
          buffer: null,
          played: [],
          play: vi.fn(() => { sound.isPlaying = true; sound.played.push(sound.buffer); }),
          stop: vi.fn(() => { sound.isPlaying = false; }),
          setVolume: vi.fn((v) => { sound.volume = v; }),
          setBuffer: vi.fn((b) => { sound.buffer = b; }),
          disconnect: vi.fn(),
          removeFromParent: vi.fn(),
        };
        return sound;
      }

      /** A socket with clips, a sound to play them on and a cache holding them. */
      function makeReader(opts = {}) {
        const sound = fakeSound();
        const socket = makeSocket({ playSounds: true, sounds: SOUNDS, sound, ...opts });
        socket.gameObject.scene.userData.engine = { assets: { has: key => key in LOADED, get: key => LOADED[key] } };
        const beep = vi.spyOn(socket, '_playBeep').mockImplementation(() => {});
        return { socket, sound, beep };
      }

      it('plays one of its insert clips as an item is seated, and no beep', () => {
        const { socket, sound, beep } = makeReader();
        socket.attach(makeItem('Drive', [0, 0, 0]));
        expect(sound.played).toHaveLength(1);
        expect(['IN1', 'IN2']).toContain(sound.played[0]);
        expect(sound.volume).toBe(0.8);
        expect(beep).not.toHaveBeenCalled();
      });

      it('plays one of its remove clips as the item is taken out', () => {
        const { socket, sound, beep } = makeReader();
        const item = makeItem('Drive', [0, 0, 0]);
        socket.attach(item);
        socket.detach(item);
        expect(sound.played).toHaveLength(2);
        expect(['OUT1', 'OUT2']).toContain(sound.played[1]);
        expect(beep).not.toHaveBeenCalled();
      });

      it('picks at random, never the same clip twice running', () => {
        const { socket, sound } = makeReader();
        const item = makeItem('Drive', [0, 0, 0]);
        for (let i = 0; i < 30; i++) { socket.attach(item); socket.detach(item); }
        const ins = sound.played.filter((_, i) => i % 2 === 0);
        const outs = sound.played.filter((_, i) => i % 2 === 1);
        expect(new Set(ins)).toEqual(new Set(['IN1', 'IN2']));
        expect(new Set(outs)).toEqual(new Set(['OUT1', 'OUT2']));
        expect(ins.every((clip, i) => clip !== ins[i - 1])).toBe(true);
        expect(outs.every((clip, i) => clip !== outs[i - 1])).toBe(true);
      });

      it("hushes the item's own sound, so being lifted out is one sound", () => {
        const { socket } = makeReader();
        const { item, impact } = makeLoudItem('Drive', [0, 0, 0]);
        impact.hush = vi.fn();
        socket.attach(item);
        expect(impact.hush).toHaveBeenCalledTimes(1);
        socket.detach(item);
        expect(impact.hush).toHaveBeenCalledTimes(2);
        expect(impact.handle).not.toHaveBeenCalled();
      });

      it('stays quiet for a silent detach, and with sounds off', () => {
        const { socket, sound } = makeReader();
        const item = makeItem('Drive', [0, 0, 0]);
        socket.attach(item);
        socket.detach(item, { playSound: false });
        expect(sound.played).toHaveLength(1);

        const mute = makeReader({ playSounds: false });
        mute.socket.attach(item);
        mute.socket.detach(item);
        expect(mute.sound.play).not.toHaveBeenCalled();
      });

      it('falls silent and unhooks when the scene is torn down', () => {
        const { socket, sound } = makeReader();
        socket.attach(makeItem('Drive', [0, 0, 0]));
        socket.onDestroy();
        expect(sound.isPlaying).toBe(false);
        expect(sound.disconnect).toHaveBeenCalled();
        expect(() => makeSocket().onDestroy()).not.toThrow();
      });
    });

    it("carries on in 'item' mode with an item that has no knock", () => {
      const socket = makeSocket({ playSounds: true, sounds: 'item' });
      const item = makeItem('Drive', [0, 0, 0]);
      expect(() => { socket.attach(item); socket.detach(item); }).not.toThrow();
    });
  });
});
