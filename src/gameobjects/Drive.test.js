import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Drive } from './Drive.js';
import { Pickupable } from '../components/Pickupable.js';

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
          setFriction() { return d; },
          setRestitution() { return d; },
          setDensity() { return d; },
          setTranslation() { return d; },
          setRotation() { return d; },
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
});
