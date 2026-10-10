import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Drive } from './Drive.js';
import { Pickupable } from '../components/Pickupable.js';
import { packGroups } from '../core/PhysicsLayers.js';

// ── Fake Rapier setup for Drive physics tests ──

let nextHandle = 1;

function makeFakeBody(desc) {
  return {
    handle: nextHandle++,
    _type: desc.type,
    _gravityScale: desc.gravityScale ?? 1,
    _linearDamping: desc.linearDamping ?? 0,
    _angularDamping: desc.angularDamping ?? 0,
    _ccd: desc.ccdEnabled ?? false,
    _linvel: { x: 0, y: 0, z: 0 },
    _angvel: { x: 0, y: 0, z: 0 },
    _translation: { ...desc.t },
    _rotation: { ...desc.q },
    translation() { return { ...this._translation }; },
    rotation() { return { ...this._rotation }; },
    bodyType() { return this._type; },
    mass() { return 0.5; },
    linvel() { return { ...this._linvel }; },
    setGravityScale(s) { this._gravityScale = s; },
    setLinearDamping(d) { this._linearDamping = d; },
    setAngularDamping(d) { this._angularDamping = d; },
    setLinvel(v) { this._linvel = { ...v }; },
    setAngvel(v) { this._angvel = { ...v }; },
    resetForces: vi.fn(),
    addForce: vi.fn(),
    applyImpulse: vi.fn(),
  };
}

function makeFakeWorld() {
  const bodies = new Set();
  const colliders = new Set();
  return {
    _bodies: bodies,
    _colliders: colliders,
    createRigidBody(desc) {
      const body = makeFakeBody(desc);
      bodies.add(body);
      return body;
    },
    createCollider(desc, body) {
      const col = { _body: body, _desc: desc, handle: nextHandle++ };
      colliders.add(col);
      return col;
    },
    removeRigidBody(body) { bodies.delete(body); },
    removeCollider(col) { colliders.delete(col); },
  };
}

function makeFakeRAPIER() {
  function bodyDesc(type) {
    const d = {
      type, t: { x: 0, y: 0, z: 0 }, q: { x: 0, y: 0, z: 0, w: 1 },
      gravityScale: 1, linearDamping: 0, angularDamping: 0, ccdEnabled: false,
      setTranslation(x, y, z) { d.t = { x, y, z }; return d; },
      setRotation(q) { d.q = { ...q }; return d; },
      setGravityScale(s) { d.gravityScale = s; return d; },
      setLinearDamping(v) { d.linearDamping = v; return d; },
      setAngularDamping(v) { d.angularDamping = v; return d; },
      setCcdEnabled(v) { d.ccdEnabled = v; return d; },
    };
    return d;
  }
  return {
    RigidBodyDesc: {
      fixed: () => bodyDesc('fixed'),
      dynamic: () => bodyDesc('dynamic'),
      kinematicPositionBased: () => bodyDesc('kinematic'),
    },
    ColliderDesc: {
      cuboid: (x, y, z) => {
        const d = {
          half: { x, y, z },
          _collisionGroups: undefined,
          setFriction() { return d; },
          setRestitution() { return d; },
          setDensity() { return d; },
          setTranslation() { return d; },
          setRotation() { return d; },
          setCollisionGroups(g) { d._collisionGroups = g; return d; },
        };
        return d;
      },
    },
    RigidBodyType: { Fixed: 0, Dynamic: 1, KinematicPositionBased: 2 },
  };
}

function makeFakeEngine() {
  const world = makeFakeWorld();
  const RAPIER = makeFakeRAPIER();
  return {
    world,
    RAPIER,
    _bodyToGO: new Map(),
    rigidBodyMap: new Map(),
  };
}

function makeFakeScene(engine) {
  return {
    userData: { engine },
    add: vi.fn(),
  };
}

// ── Tests ────────────────────────────────────────────────────

describe('Drive', () => {
  it('creates a small box mesh on construction', () => {
    const drive = new Drive('TestDrive');
    expect(drive.name).toBe('TestDrive');
    const mesh = drive.object3d.children.find(c => c.name === 'DriveMesh');
    expect(mesh).toBeDefined();
    expect(mesh).toBeInstanceOf(THREE.Mesh);
    expect(mesh.geometry).toBeInstanceOf(THREE.BoxGeometry);
  });

  it('starts in the default (unsaved) state', () => {
    const drive = new Drive();
    expect(drive.saved).toBe(false);
    expect(drive.corrupted).toBe(false);
    expect(drive._material.emissive.getHex()).toBe(0x000000);
    expect(drive._material.emissiveIntensity).toBe(0);
  });

  it('setSaved(true) turns the material green', () => {
    const drive = new Drive();
    drive.setSaved(true);
    expect(drive.saved).toBe(true);
    expect(drive._material.emissive.getHex()).toBe(0x22cc44);
    expect(drive._material.emissiveIntensity).toBeGreaterThan(0);
  });

  it('setSaved(false) resets to default', () => {
    const drive = new Drive();
    drive.setSaved(true);
    drive.setSaved(false);
    expect(drive.saved).toBe(false);
    expect(drive._material.emissive.getHex()).toBe(0x000000);
    expect(drive._material.emissiveIntensity).toBe(0);
  });

  it('setEjected resets the indicator', () => {
    const drive = new Drive();
    drive.setSaved(true);
    drive.setEjected();
    expect(drive.saved).toBe(false);
    expect(drive._material.emissive.getHex()).toBe(0x000000);
  });

  it('setSaved(true, { corrupted: true }) turns the material red', () => {
    const drive = new Drive();
    drive.setSaved(true, { corrupted: true });
    expect(drive.saved).toBe(true);
    expect(drive.corrupted).toBe(true);
    expect(drive._material.emissive.getHex()).toBe(0xcc2222);
    expect(drive._material.emissiveIntensity).toBeGreaterThan(0);
  });

  it('a plain setSaved(true) stays green and clears any corruption', () => {
    const drive = new Drive();
    drive.setSaved(true, { corrupted: true });
    drive.setSaved(true);
    expect(drive.corrupted).toBe(false);
    expect(drive._material.emissive.getHex()).toBe(0x22cc44);
  });

  it('setSaved(false) wipes the red indicator too', () => {
    const drive = new Drive();
    drive.setSaved(true, { corrupted: true });
    drive.setSaved(false);
    expect(drive.saved).toBe(false);
    expect(drive.corrupted).toBe(false);
    expect(drive._material.emissive.getHex()).toBe(0x000000);
  });

  it('setEjected clears a red drive back to the default', () => {
    const drive = new Drive();
    drive.setSaved(true, { corrupted: true });
    drive.setEjected();
    expect(drive.saved).toBe(false);
    expect(drive.corrupted).toBe(false);
    expect(drive._material.emissive.getHex()).toBe(0x000000);
  });

  it('accepts a custom size', () => {
    const drive = new Drive('Big', { size: [0.2, 0.05, 0.3] });
    const mesh = drive.object3d.children.find(c => c.name === 'DriveMesh');
    const params = mesh.geometry.parameters;
    expect(params.width).toBeCloseTo(0.2);
    expect(params.height).toBeCloseTo(0.05);
    expect(params.depth).toBeCloseTo(0.3);
  });

  it('dispose frees geometry and material', () => {
    const drive = new Drive();
    const geomDispose = vi.fn();
    const matDispose = vi.fn();
    drive._mesh.geometry.dispose = geomDispose;
    drive._material.dispose = matDispose;

    drive.dispose();
    expect(geomDispose).toHaveBeenCalled();
    expect(matDispose).toHaveBeenCalled();
  });

  // ── Physics body (Phase 3) ──

  describe('physics body', () => {
    let engine, scene, world;

    beforeEach(() => {
      engine = makeFakeEngine();
      world = engine.world;
      scene = makeFakeScene(engine);
    });

    it('_init creates a dynamic rigid body and collider', () => {
      const drive = new Drive('PhysDrive');
      drive.object3d.position.set(1, 0.5, -2);
      drive._init(scene, world);

      expect(drive.rigidBody).not.toBeNull();
      expect(drive.rigidBody._type).toBe('dynamic');
      expect(drive.collider).not.toBeNull();
      expect(drive.colliders).toHaveLength(1);
    });

    it('_init registers with engine body maps', () => {
      const drive = new Drive('PhysDrive');
      drive._init(scene, world);

      expect(engine._bodyToGO.get(drive.rigidBody.handle)).toBe(drive);
      expect(engine.rigidBodyMap.get(drive.rigidBody.handle)).toBe(drive);
    });

    it('_init starts with gravity on and rest damping (rests on the floor)', () => {
      const drive = new Drive('PhysDrive');
      drive._init(scene, world);

      expect(drive.rigidBody._gravityScale).toBe(1);
      expect(drive.rigidBody._linearDamping).toBe(0.5);
      expect(drive.rigidBody._angularDamping).toBe(1.0);
      expect(drive.rigidBody._ccd).toBe(true);
    });

    it('_init adds a Pickupable component', () => {
      const drive = new Drive('PhysDrive');
      drive._init(scene, world);

      const pickupable = drive.getComponent(Pickupable);
      expect(pickupable).not.toBeNull();
      expect(pickupable.held).toBe(false);
    });

    it('_init sets collision groups for shelf placement (SHELF membership, DEFAULT+SHELF filter)', () => {
      const drive = new Drive('PhysDrive');
      drive._init(scene, world);

      // SHELF membership (bit 2) = 0x0004, DEFAULT|SHELF filter (bits 0,2) = 0x0005
      // packed: (0x0004 << 16) | 0x0005 = 0x00040005
      const expected = packGroups(['SHELF'], ['DEFAULT', 'SHELF']);
      expect(expected).toBe(0x00040005);
      expect(drive.collider._desc._collisionGroups).toBe(expected);
    });

    it('makeKinematic switches to socketed groups (SHELF member, SHELF filter)', () => {
      const drive = new Drive('PhysDrive');
      drive._init(scene, world);
      drive.makeKinematic();

      // SHELF membership (bit 2) = 0x0004, SHELF filter = 0x0004
      // packed: (0x0004 << 16) | 0x0004 = 0x00040004
      const expected = packGroups(['SHELF'], ['SHELF']);
      expect(expected).toBe(0x00040004);
      expect(drive.collider._desc._collisionGroups).toBe(expected);
    });

    it('makeDynamic preserves collision groups', () => {
      const drive = new Drive('PhysDrive');
      drive._init(scene, world);
      drive.makeKinematic();
      drive.makeDynamic();

      const expected = packGroups(['SHELF'], ['DEFAULT', 'SHELF']);
      expect(drive.collider._desc._collisionGroups).toBe(expected);
    });

    // ── Build-time socketing ──

    it('defers a bodyless makeKinematic: _init finishes kinematic at the seated pose', () => {
      const drive = new Drive('SocketedDrive');
      drive.object3d.position.set(0.3, 0.9, -1.7);
      // A snap receiver attaching the drive during scene build, before _init.
      drive.makeKinematic();

      drive._init(scene, world);

      expect(drive.rigidBody._type).toBe('kinematic');
      expect(drive.collider._desc._collisionGroups).toBe(packGroups(['SHELF'], ['SHELF']));
      expect(drive.rigidBody._translation).toEqual({ x: 0.3, y: 0.9, z: -1.7 });
    });

    it('a bodyless makeDynamic cancels the deferred kinematic', () => {
      const drive = new Drive('FreedDrive');
      drive.makeKinematic();
      drive.makeDynamic();

      drive._init(scene, world);

      expect(drive.rigidBody._type).toBe('dynamic');
      expect(drive.collider._desc._collisionGroups)
        .toBe(packGroups(['SHELF'], ['DEFAULT', 'SHELF']));
    });

    it('has a Pickupable as soon as it is constructed (build-time attach)', () => {
      const drive = new Drive('EarlyDrive');

      const pickupable = drive.getComponent(Pickupable);
      expect(pickupable).not.toBeNull();
    });

    it('enablePhysics enables gravity, lowers damping and restores angular damping', () => {
      const drive = new Drive('PhysDrive');
      drive._init(scene, world);
      drive.enablePhysics();

      expect(drive.rigidBody._gravityScale).toBe(1);
      expect(drive.rigidBody._linearDamping).toBe(0.5);
      expect(drive.rigidBody._angularDamping).toBe(1.0);
    });

    it('disablePhysics disables gravity and raises damping', () => {
      const drive = new Drive('PhysDrive');
      drive._init(scene, world);
      drive.enablePhysics();
      drive.disablePhysics();

      expect(drive.rigidBody._gravityScale).toBe(0);
      expect(drive.rigidBody._linearDamping).toBe(5.0);
    });

    it('makeKinematic replaces the body with a kinematic one', () => {
      const drive = new Drive('PhysDrive');
      drive._init(scene, world);
      const oldHandle = drive.rigidBody.handle;

      drive.makeKinematic();

      expect(drive.rigidBody).not.toBeNull();
      expect(drive.rigidBody._type).toBe('kinematic');
      expect(drive.rigidBody.handle).not.toBe(oldHandle);
      expect(engine._bodyToGO.get(drive.rigidBody.handle)).toBe(drive);
    });

    it('makeDynamic replaces the body with a dynamic one that falls', () => {
      const drive = new Drive('PhysDrive');
      drive._init(scene, world);
      drive.makeKinematic();
      drive.makeDynamic();

      expect(drive.rigidBody._type).toBe('dynamic');
      expect(drive.rigidBody._gravityScale).toBe(1);
      expect(drive.rigidBody._angularDamping).toBe(1.0);
    });

    it('dispose clears physics references', () => {
      const drive = new Drive('PhysDrive');
      drive._init(scene, world);
      expect(drive.rigidBody).not.toBeNull();

      drive.dispose();
      expect(drive.rigidBody).toBeNull();
      expect(drive.collider).toBeNull();
      expect(drive.colliders).toHaveLength(0);
    });
  });

  describe('doom glow', () => {
    it('setDoomGlow ramps emissive intensity exponentially and creates a PointLight', () => {
      const drive = new Drive('DoomDrive');
      expect(drive._doomLight).toBeUndefined();

      drive.setDoomGlow(0);
      expect(drive._material.emissiveIntensity).toBe(1.5);  // DOOM_BASE
      expect(drive._doomLight).toBeTruthy();
      expect(drive._doomLight.intensity).toBe(0);

      // Exponential curve (pow 6): at t=0.5 the curve is only ~1.6%.
      drive.setDoomGlow(0.5);
      expect(drive._material.emissiveIntensity).toBeCloseTo(38.97, 0);
      expect(drive._doomLight.intensity).toBeCloseTo(0.625, 2);

      // At the peak (t=1) the glow is 100× the old linear peak.
      drive.setDoomGlow(1);
      expect(drive._material.emissiveIntensity).toBe(2400.0);
      expect(drive._doomLight.intensity).toBeCloseTo(40);
    });

    it('clearDoomGlow removes the PointLight', () => {
      const drive = new Drive('DoomDrive');
      drive.setDoomGlow(0.5);
      expect(drive._doomLight).toBeTruthy();

      drive.clearDoomGlow();
      expect(drive._doomLight).toBeNull();
    });

    it('dispose clears the doom glow', () => {
      const drive = new Drive('DoomDrive');
      drive.setDoomGlow(1);
      expect(drive._doomLight).toBeTruthy();

      drive.dispose();
      expect(drive._doomLight).toBeNull();
    });

    it('startDoomFadeOut eases the glow down over the duration, then clears', () => {
      const drive = new Drive('DoomDrive');
      drive.setDoomGlow(1);  // emissive 2400, light 40
      drive.startDoomFadeOut(3);

      // Halfway through the fade the glow is half of what the ramp left.
      drive._tickDoomFade(1.5);
      expect(drive._material.emissive.getHex()).toBe(0xcc2222);
      expect(drive._material.emissiveIntensity).toBeCloseTo(1200, 0);
      expect(drive._doomLight.intensity).toBeCloseTo(20, 0);

      // Past the end the glow is gone entirely: light removed, material
      // back to the unmarked look.
      drive._tickDoomFade(1.6);
      expect(drive._doomLight).toBeNull();
      expect(drive._material.emissive.getHex()).toBe(0x000000);
      expect(drive._material.emissiveIntensity).toBe(0);
    });

    it('startDoomFadeOut after a hard clear has nothing to fade', () => {
      const drive = new Drive('DoomDrive');
      drive.setDoomGlow(0.5);
      drive.clearDoomGlow();
      drive.startDoomFadeOut(3);  // no stored glow — just clears
      expect(drive._doomLight).toBeNull();
    });

    it('the wipe re-applies the glow through the fade instead of going dark at once', () => {
      const drive = new Drive('DoomDrive');
      drive.setDoomGlow(0.5);
      drive.setSaved(false);      // the ServerRoom console wipe
      expect(drive._material.emissive.getHex()).toBe(0x000000);
      drive.startDoomFadeOut(3);  // EvilSignal starts the fade next tick
      drive._tickDoomFade(0.1);
      // The red is back, easing down from where the ramp left it.
      expect(drive._material.emissive.getHex()).toBe(0xcc2222);
      expect(drive._material.emissiveIntensity).toBeGreaterThan(0);
    });

    it('a state change during the fade cancels it', () => {
      const drive = new Drive('DoomDrive');
      drive.setDoomGlow(1);
      drive.startDoomFadeOut(3);
      drive.setSaved(true);   // a fresh signal saved mid-fade
      drive._tickDoomFade(1);
      // The green stands — the fade no longer re-applies the red.
      expect(drive._material.emissive.getHex()).toBe(0x22cc44);
      expect(drive._material.emissiveIntensity).toBe(1.5);
    });
  });
});
