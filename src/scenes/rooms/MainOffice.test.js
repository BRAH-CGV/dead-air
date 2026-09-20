import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';

// Recording Rapier fake — see Room.test.js.
vi.mock('@dimforge/rapier3d', () => {
  const bodyDesc = type => {
    const d = {
      type, t: { x: 0, y: 0, z: 0 }, q: { x: 0, y: 0, z: 0, w: 1 },
      setTranslation(x, y, z) { d.t = { x, y, z }; return d; },
      setRotation(q) { d.q = { ...q }; return d; },
    };
    return d;
  };
  return {
    default: {
      RigidBodyDesc: { fixed: () => bodyDesc('fixed') },
      ColliderDesc: {
        cuboid: (x, y, z) => {
          const d = { half: { x, y, z }, sensor: false, setSensor(s) { d.sensor = s; return d; } };
          return d;
        },
      },
    },
  };
});

import { MainOffice } from './MainOffice.js';
import { GameObject } from '../../core/GameObject.js';
import { Interactable } from '../../components/Interactable.js';

let nextHandle = 1;
class FakeWorld {
  _bodies = new Set();
  bodies = { len: () => this._bodies.size };
  createRigidBody(desc) {
    const body = {
      handle: nextHandle++,
      isFixed: () => desc.type === 'fixed',
      translation: () => ({ ...desc.t }),
    };
    this._bodies.add(body);
    return body;
  }
  createCollider(desc) {
    let sensor = desc.sensor;
    return { halfExtents: () => ({ ...desc.half }), isSensor: () => sensor, setSensor: s => { sensor = s; } };
  }
  removeRigidBody(body) { this._bodies.delete(body); }
}

/** Engine stand-in. spawnModel mimics the real one where it matters here:
 *  the body goes where `position` says (world space), and the GameObject is
 *  registered as a root object. */
function makeEngine() {
  const engine = {
    world: new FakeWorld(),
    _rootObjects: [],
    _bodyToGO: new Map(),
    rigidBodyMap: new Map(),
    spawnModel: vi.fn((key, opts = {}) => {
      const go = new GameObject(opts.name ?? key);
      const [x, y, z] = opts.position ?? [0, 0, 0];
      go.object3d.position.set(x, y, z);
      go.object3d.rotation.y = opts.rotationY ?? 0;
      if (opts.physics !== 'none') {
        go.rigidBody = engine.world.createRigidBody({ type: 'fixed', t: { x, y, z } });
        engine._bodyToGO.set(go.rigidBody.handle, go);
      }
      go.physicsAssetKey = key;
      engine._rootObjects.push(go);
      return go;
    }),
  };
  return engine;
}

function pointLights(room) {
  const lights = [];
  room.root.object3d.traverse(o => { if (o.isPointLight) lights.push(o); });
  return lights;
}

function childNames(room) {
  return room.root.children.map(c => c.name);
}

describe('MainOffice', () => {
  let engine, room;

  beforeEach(() => {
    engine = makeEngine();
    room = new MainOffice(engine);
    room.build();
  });

  it('is a 12 × 10 × 3 room named MainOffice, at the origin by default', () => {
    expect(room.root.name).toBe('Room:MainOffice');
    expect([room.width, room.depth, room.height]).toEqual([12, 10, 3]);
    expect(room.root.object3d.position.toArray()).toEqual([0, 0, 0]);
  });

  it('spawns the computer desk, server rack, radar terminal and switchboard', () => {
    for (const name of ['ComputerDesk', 'ServerRack', 'RadarTerminal', 'Switchboard']) {
      expect(room.root.find(name), name).not.toBeNull();
    }
    const keys = engine.spawnModel.mock.calls.map(([key]) => key);
    expect(keys).toEqual(expect.arrayContaining([
      'model:retro-computer', 'model:server-rack', 'model:radar-terminal', 'model:switchboard',
    ]));
  });

  it('spawns the three security cameras without physics', () => {
    const cams = childNames(room).filter(n => n.startsWith('SecurityCamera_'));
    expect(cams.sort()).toEqual(['SecurityCamera_Desk', 'SecurityCamera_Door', 'SecurityCamera_Window']);
    for (const [key, opts] of engine.spawnModel.mock.calls) {
      if (key === 'model:security-camera') expect(opts.physics).toBe('none');
    }
  });

  it('props are room children only — not also root objects (no double update)', () => {
    const computer = room.root.find('ComputerDesk');
    expect(computer.parent).toBe(room.root);
    expect(engine._rootObjects).not.toContain(computer);
  });

  it('has a window opening in the back wall: 4 segments plus the frame', () => {
    const back = childNames(room).filter(n => n.startsWith('BackWall')).sort();
    expect(back).toEqual(['BackWall_A', 'BackWall_B', 'BackWall_Header', 'BackWall_Sill']);
    const frame = childNames(room).filter(n => n.startsWith('WindowFrame_'));
    expect(frame.length).toBe(7);
  });

  it('has a doorway to the server room (right wall) and living quarters (left wall)', () => {
    const right = room.doors.find(d => d.targetRoom === 'ServerRoom');
    const left  = room.doors.find(d => d.targetRoom === 'LivingQuarters');
    expect(right.name).toBe('Door:ToServerRoom');
    expect(right.object3d.position.x).toBeCloseTo(6);
    expect(left.name).toBe('Door:ToLivingQuarters');
    expect(left.object3d.position.x).toBeCloseTo(-6);
    expect(childNames(room)).toEqual(expect.arrayContaining(['RightWall_A', 'RightWall_B', 'RightWall_Header']));
    expect(childNames(room)).toEqual(expect.arrayContaining(['LeftWall_A', 'LeftWall_B', 'LeftWall_Header']));
  });

  it('keeps the original front door, leading outside', () => {
    const front = room.doors.find(d => d.targetRoom === 'Outside');
    expect(front.name).toBe('Door:ToOutside');
    expect(front.object3d.position.x).toBeCloseTo(2);
    expect(front.object3d.position.z).toBeCloseTo(5);
  });

  it('doorways do not collide with the furniture along the side walls', () => {
    // Server rack sits against the right wall around z = -1.35, the
    // switchboard around z = 1.25; the radar against the left at z = -0.55.
    for (const door of room.doors.filter(d => d.targetRoom !== 'Outside')) {
      const [w] = door.doorSize;
      const z = door.object3d.position.z;
      expect(z - w / 2).toBeGreaterThan(2);
    }
  });

  it('lighting matches the original office: warm ceiling light and cool desk glow', () => {
    const lights = pointLights(room);
    expect(lights.length).toBe(2);
    const ceiling = room.root.find('CeilingLight').object3d.children.find(o => o.isPointLight);
    const desk    = room.root.find('DeskGlow').object3d.children.find(o => o.isPointLight);
    expect(ceiling.position.toArray()).toEqual([0, 2.75, 0.4]);
    expect(ceiling.color.getHex()).toBe(0xffd8a8);
    expect(ceiling.castShadow).toBe(true);
    expect(desk.position.toArray()).toEqual([0, 1.1, -2.1]);
    expect(desk.color.getHex()).toBe(0x66ccff);
  });

  it('the computer desk is an Interactable stub for signal collection (phase 10)', () => {
    const interactable = room.root.find('ComputerDesk').getComponent(Interactable);
    expect(interactable).not.toBeNull();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    interactable.onInteract({});
    expect(log).toHaveBeenCalledWith(expect.stringContaining('signal collected'));
    log.mockRestore();
  });

  it('leaves global lights (ambient, moon) to the scene', () => {
    let globals = 0;
    room.root.object3d.traverse(o => { if (o.isAmbientLight || o.isDirectionalLight) globals++; });
    expect(globals).toBe(0);
  });
});

describe('MainOffice placement', () => {
  it('spawns props at world position (room offset + local) but keeps them local under the room', () => {
    const engine = makeEngine();
    const room = new MainOffice(engine, { position: [5, 0, 0] });
    room.build();

    const call = engine.spawnModel.mock.calls.find(([key]) => key === 'model:server-rack');
    call[1].position.forEach((v, i) => expect(v).toBeCloseTo([9.55, 0, -1.35][i]));
    const rack = room.root.find('ServerRack');
    expect(rack.object3d.position.toArray()).toEqual([4.55, 0, -1.35]);
    expect(rack.rigidBody.translation().x).toBeCloseTo(9.55);
  });

  it('dispose removes every body, including the props, and forgets their handles', () => {
    const engine = makeEngine();
    const room = new MainOffice(engine);
    room.build();
    expect(engine._bodyToGO.size).toBeGreaterThan(0);

    room.dispose();
    expect(engine.world.bodies.len()).toBe(0);
    expect(engine._bodyToGO.size).toBe(0);
  });

  it('dispose frees the light fixture it created', () => {
    const engine = makeEngine();
    const room = new MainOffice(engine);
    room.build();
    const fixture = room.root.find('CeilingLight').object3d.children.find(o => o.isMesh);
    let geom = false, mat = false;
    fixture.geometry.addEventListener('dispose', () => { geom = true; });
    fixture.material.addEventListener('dispose', () => { mat = true; });
    room.dispose();
    expect(geom).toBe(true);
    expect(mat).toBe(true);
  });
});

describe('MainOffice window frame', () => {
  it('frame parts are static boxes centred on their pivots', () => {
    const room = new MainOffice(makeEngine());
    room.build();
    for (const go of room.root.children.filter(c => c.name.startsWith('WindowFrame_'))) {
      expect(go.rigidBody.isFixed(), go.name).toBe(true);
      const mesh = go.object3d.children.find(c => c.isMesh);
      expect(mesh.position.equals(new THREE.Vector3()), go.name).toBe(true);
    }
  });
});
