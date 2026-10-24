import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GameObject } from '../core/GameObject.js';
import { Pickupable } from '../components/Pickupable.js';
import { ImpactSound, IMPACT_SOUNDS } from '../components/ImpactSound.js';
import { packGroups } from '../core/PhysicsLayers.js';

// ─────────────────────────────────────────────
// CoffeeGoods  –  the coffee you carry (#168)
// ─────────────────────────────────────────────
// Two things picked up and carried like the drives:
//
//   CoffeeBeans  a pile of ripe beans, picked off a bush at the grow rack,
//                stuck together as one heap, carried to the bean
//                processor's hopper.
//   CoffeeBag    a kraft bag of ground coffee, out of the processor's bay,
//                carried to the bedroom's coffee machine.
//
// Each is a dynamic body (a box round it, the drives' collision groups)
// that rests where it is put and falls when dropped, and sounds as it is
// knocked or handled (ImpactSound: IMPACT_SOUNDS.beans, .bag). The body's
// origin is the item's middle, so the hand (which holds a body by its
// origin) holds it centred in the view; place() still takes its feet. There are only ever a
// couple of each in play, so the scene builds them once (CoffeeItems) and
// they are parked out of play, under the floor, hidden and still, until a
// bush is picked or a batch ground: place() brings one into the world,
// park() puts it away. A parked body is disabled, so nothing hits it.
//
// Built with its feet at the mesh's origin, the mesh then lowered by half
// its height. Each owns its geometry and material: `own` hands them
// to the room to free. No fog, like everything indoors (they are built after
// BaseScene strips it from the rooms).
// ─────────────────────────────────────────────

/** The drives' groups: solid to the room and the shelves, not the player's
 *  shelf envelopes. */
const GROUPS = packGroups(['SHELF'], ['DEFAULT', 'SHELF']);

/** Where a parked item waits, world space: well under the floor. */
const PARKED = Object.freeze({ x: 0, y: -50, z: 0 });

/** The beans' colour off the bush, a dull brownish red. */
export const BEANS_COLOUR = 0x7a3a22;

export const COFFEE_BEANS = Object.freeze({ size: [0.13, 0.055, 0.13], beans: 34 });
export const COFFEE_BAG = Object.freeze({ size: [0.1, 0.17, 0.125], colour: 0x9a7348 });

class CarriedItem extends GameObject {
  /** Out in the world (true) or parked away (false). */
  inPlay = false;

  /**
   * @param {string} name
   * @param {{ kind: string, size: number[], mesh: THREE.Mesh }} opts
   */
  constructor(name, { kind, size, mesh }) {
    super(name);
    this.coffeeKind = kind;
    this._size = size;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.y = -size[1] / 2;          // its middle on the body's origin
    this.object3d.add(mesh);
    this.mesh = mesh;
    this.pickupable = this.addComponent(new Pickupable());
    this.addComponent(new ImpactSound(IMPACT_SOUNDS[kind]));
    this.object3d.visible = false;
  }

  _init(scene, world) {
    super._init(scene, world);
    const engine = scene.userData.engine;
    if (!engine?.RAPIER) return;
    const RAPIER = engine.RAPIER;
    this.rigidBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(PARKED.x, PARKED.y, PARKED.z)
        .setLinearDamping(0.5)
        .setAngularDamping(1.0)
        .setCcdEnabled(true),
    );
    const [w, h, d] = this._size;
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)
        .setFriction(0.8)
        .setRestitution(0.05)
        .setDensity(600)
        .setCollisionGroups(GROUPS),
      this.rigidBody,
    );
    this.colliders = [this.collider];
    engine._bodyToGO.set(this.rigidBody.handle, this);
    engine.rigidBodyMap.set(this.rigidBody.handle, this);
    if (this._placeAt) this.place(this._placeAt);
    else this.park();
  }

  /** Into the world, standing on `at` (world space), upright and still. */
  place(at) {
    this.inPlay = true;
    this.object3d.visible = true;
    const parent = this.object3d.parent;
    const y = at.y + this._size[1] / 2;
    const local = new THREE.Vector3(at.x, y, at.z);
    if (parent) {
      parent.updateMatrixWorld(true);
      parent.worldToLocal(local);
    }
    this.object3d.position.copy(local);
    this.object3d.quaternion.identity();
    const body = this.rigidBody;
    if (!body) {
      this._placeAt = new THREE.Vector3(at.x, at.y, at.z);
      return;
    }
    body.setEnabled?.(true);
    body.setTranslation({ x: at.x, y, z: at.z }, true);
    body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this._still(1);
  }

  /** Seated in a socket (SnapSocket, the coffee machine's top): placed by
   *  it each frame, so kinematic. */
  makeKinematic() {
    this._setType('KinematicPositionBased');
  }

  /** Out of a socket again: falls, and can be knocked. */
  makeDynamic() {
    this._setType('Dynamic');
  }

  _setType(name) {
    const type = this.scene?.userData?.engine?.RAPIER?.RigidBodyType?.[name];
    if (type !== undefined) this.rigidBody?.setBodyType?.(type, true);
  }

  /** Out of play: out of any socket, under the floor, hidden, still, disabled. */
  park() {
    this._snapOwner?.detach(this, { playSound: false });
    this.inPlay = false;
    this._placeAt = null;
    this.object3d.visible = false;
    const body = this.rigidBody;
    if (!body) return;
    body.setTranslation(PARKED, true);
    this._still(0);
    body.setEnabled?.(false);
  }

  _still(gravity) {
    const body = this.rigidBody;
    body.setGravityScale(gravity, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}

/** Mulberry32: the same heap every build. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class CoffeeBeans extends CarriedItem {
  /** @param {string} name @param {{ own?: (r: any) => any }} [opts] */
  constructor(name = 'CoffeeBeans', { own = r => r } = {}) {
    const { size, beans } = COFFEE_BEANS;
    const rand = rng(11);
    const parts = [];
    const colour = new THREE.Color(), base = new THREE.Color(BEANS_COLOUR);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    // A low heap: beans on the bottom spread to the box's edge, the rest
    // stacked over the middle.
    for (let i = 0; i < beans; i++) {
      const t = i / beans;
      const r = (size[0] / 2 - 0.012) * Math.sqrt(1 - t) * Math.sqrt(rand());
      const a = rand() * Math.PI * 2;
      const y = 0.009 + (size[1] - 0.022) * t * (0.6 + 0.4 * rand());
      const g = new THREE.IcosahedronGeometry(0.011, 0).toNonIndexed();
      m.compose(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r),
        q.setFromEuler(e.set(rand() * 3, rand() * 3, rand() * 3)), new THREE.Vector3(1, 0.75, 1.3));
      g.applyMatrix4(m);
      colour.copy(base).offsetHSL((rand() - 0.5) * 0.02, 0, (rand() - 0.5) * 0.08);
      const c = new Float32Array(g.attributes.position.count * 3);
      for (let k = 0; k < c.length; k += 3) { c[k] = colour.r; c[k + 1] = colour.g; c[k + 2] = colour.b; }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      parts.push(g);
    }
    const geometry = own(mergeGeometries(parts));
    parts.forEach(g => g.dispose());
    const mesh = new THREE.Mesh(geometry, own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, fog: false })));
    mesh.name = 'CoffeeBeansHeap';
    super(name, { kind: 'beans', size, mesh });
  }
}

export class CoffeeBag extends CarriedItem {
  /** @param {string} name @param {{ own?: (r: any) => any }} [opts] */
  constructor(name = 'CoffeeBag', { own = r => r } = {}) {
    const [w, h, d] = COFFEE_BAG.size;
    // The bag and its top rolled over.
    const parts = [
      new THREE.BoxGeometry(w * 0.9, h * 0.86, d * 0.95).translate(0, h * 0.43, 0),
      new THREE.BoxGeometry(w, h * 0.14, d).translate(0, h * 0.93, 0),
    ].map(g => g.toNonIndexed());
    const geometry = own(mergeGeometries(parts));
    parts.forEach(g => g.dispose());
    const mesh = new THREE.Mesh(geometry, own(new THREE.MeshStandardMaterial({ color: COFFEE_BAG.colour, roughness: 0.9, fog: false })));
    mesh.name = 'CoffeeBagBody';
    super(name, { kind: 'bag', size: COFFEE_BAG.size, mesh });
  }
}
