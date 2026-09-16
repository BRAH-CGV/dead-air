import * as THREE from 'three';
import { Room } from './Room.js';
import { Interactable } from '../../components/Interactable.js';

// ─────────────────────────────────────────────
// LivingQuarters  –  break room, open from night 3
// ─────────────────────────────────────────────
// Sleep, eat, recover stamina. The "safe" room — but never truly safe.
// The vending machine is where coffee (stamina) will come from.
//
// Bunk, vending machine and lockers are procedural stand-ins until the
// models on the asset list arrive. Each records the file it's waiting for
// in `placeholderFor`, so swapping one is: add the model to the manifest,
// replace the _placeholder call with a _spawnProp.
//
// The doorway is in the right wall, leading back toward the office.
// `doorOffset` slides it along the wall so BaseScene can line it up with
// the corridor.
// ─────────────────────────────────────────────

export class LivingQuarters extends Room {
  /**
   * @param {import('../../core/Engine.js').Engine} engine
   * @param {object} [opts]
   * @param {number[]} [opts.position=[0,0,0]]
   * @param {THREE.Material} [opts.material]  Caller-owned; omit for the warm default
   * @param {number} [opts.doorOffset=0]      Doorway position along the right wall (z)
   */
  constructor(engine, { position = [0, 0, 0], material, doorOffset = 0 } = {}) {
    const ownsMaterial = !material;
    super(engine, {
      name: 'LivingQuarters',
      width: 6, depth: 8, height: 3, wallThick: 0.2,
      position,
      material: material ?? new THREE.MeshStandardMaterial({ color: 0x3b3530, roughness: 0.95 }),
      openings: [{ side: 'right', width: 1.2, height: 2.2, offset: doorOffset }],
    });
    if (ownsMaterial) this._own(this.material);
  }

  buildDoors() {
    this.addDoor('ToMainOffice', 'right', 'MainOffice');
  }

  buildLighting() {
    // No shadows: the office ceiling light already casts them, and
    // shadow-casting lights are the expensive kind.
    const lampGO = this._addGroup('CeilingLamp');
    const lamp = new THREE.PointLight(0xffc48a, 6, 10, 1.4);
    lamp.position.set(0, 2.7, 0);
    lampGO.object3d.add(lamp);

    const shade = new THREE.Mesh(
      this._own(new THREE.CylinderGeometry(0.25, 0.3, 0.06, 20)),
      this._own(new THREE.MeshStandardMaterial({ color: 0x2a2520, emissive: 0xffb070, emissiveIntensity: 1.2 })),
    );
    shade.position.set(0, 2.94, 0);
    lampGO.object3d.add(shade);
  }

  buildProps() {
    const inX = this.width / 2 - this.wallThick / 2;   // inner face of the side walls
    const inZ = this.depth / 2 - this.wallThick / 2;   // inner face of back/front

    // Back-left corner.
    this._placeholder('Bunk', 'bed-bunk.glb',
      [-inX + 0.45, 0.85, -inZ + 1.0], [0.9, 1.7, 2.0], 0x4a5058);

    // Against the back wall, right side. Faint glow from the lit front.
    const vending = this._placeholder('VendingMachine', 'vending-machine.glb',
      [1.8, 0.95, -inZ + 0.4], [1.0, 1.9, 0.8], 0x6b2a24, { emissive: 0x335577, emissiveIntensity: 0.4 });
    vending.addComponent(new class extends Interactable {
      promptLabel = '[E] Get coffee';
      onInteract() {
        // TODO: coordinate with Hayden's stamina system.
        console.log('[LivingQuarters] coffee consumed');
      }
    }());

    // Row of lockers along the left wall.
    [0.5, 1.02, 1.54].forEach((z, i) => {
      this._placeholder(`Locker_${i + 1}`, 'locker.glb',
        [-inX + 0.25, 0.95, z], [0.5, 1.9, 0.5], 0x56606a);
    });

    // Front-right, clear of the doorway.
    this._spawnProp('model:desk', { name: 'Desk', position: [1.6, 0, inZ - 1.0], rotationY: Math.PI });
  }

  /** Solid stand-in box for a model that hasn't been sourced yet. */
  _placeholder(name, file, position, size, color, { emissive = 0x000000, emissiveIntensity = 1 } = {}) {
    const material = this._own(new THREE.MeshStandardMaterial({ color, roughness: 0.8, emissive, emissiveIntensity }));
    const go = this._addStaticBox(name, position, size, material);
    go.placeholderFor = file;
    return go;
  }
}
