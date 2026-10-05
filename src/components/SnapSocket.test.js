import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { SnapSocket } from './SnapSocket.js';
import { Pickupable } from './Pickupable.js';

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
});
