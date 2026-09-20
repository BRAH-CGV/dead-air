import * as THREE from 'three';
import { Room } from './Room.js';
import { Interactable } from '../../components/Interactable.js';

// ─────────────────────────────────────────────
// MainOffice  –  the signal lab, open from night 1
// ─────────────────────────────────────────────
// The hub room, carried over from OfficeScene: same 12 × 10 × 3 shell, big
// back window, computer desk, server rack, radar terminal, switchboard,
// security cameras, warm ceiling light and cool desk glow. Scene-wide
// lighting (ambient, moon) belongs to the scene, not the room.
//
// Doorways: front (the original door) → Outside, right → ServerRoom,
// left → LivingQuarters. The side doorways sit toward the front so they
// clear the server rack, switchboard and radar along those walls.
// ─────────────────────────────────────────────

export class MainOffice extends Room {
  /**
   * @param {import('../../core/Engine.js').Engine} engine
   * @param {object} [opts]
   * @param {number[]} [opts.position=[0,0,0]]
   * @param {THREE.Material} [opts.material]  Wall material (caller-owned)
   */
  constructor(engine, { position = [0, 0, 0], material } = {}) {
    super(engine, {
      name: 'MainOffice',
      width: 12, depth: 10, height: 3, wallThick: 0.2,
      position, material,
      openings: [
        // Window centred 1.65 m up, 2.35 m tall → sill at 0.475 m.
        { side: 'back',  width: 8.5, height: 2.35, sill: 0.475 },
        { side: 'front', width: 1,   height: 2.2,  offset: 2 },
        { side: 'right', width: 1.2, height: 2.2,  offset: 3.5 },
        { side: 'left',  width: 1.2, height: 2.2,  offset: 3.5 },
      ],
    });
  }

  buildDoors() {
    this.addDoor('ToOutside',        'front', 'Outside');
    this.addDoor('ToServerRoom',     'right', 'ServerRoom');
    this.addDoor('ToLivingQuarters', 'left',  'LivingQuarters');
  }

  buildLighting() {
    const ceilingGO = this._addGroup('CeilingLight');
    const ceiling = new THREE.PointLight(0xffd8a8, 14.0, 24, 1.0);
    ceiling.position.set(0, 2.75, 0.4);
    ceiling.castShadow = true;
    ceiling.shadow.mapSize.set(1024, 1024);
    ceilingGO.object3d.add(ceiling);

    const fixture = new THREE.Mesh(
      this._own(new THREE.CylinderGeometry(0.35, 0.45, 0.08, 24)),
      this._own(new THREE.MeshStandardMaterial({
        color: 0x2a2a2a,
        emissive: 0xffc36b,
        emissiveIntensity: 1.8,
      })),
    );
    fixture.position.copy(ceiling.position);
    ceilingGO.object3d.add(fixture);

    const deskGO = this._addGroup('DeskGlow');
    const desk = new THREE.PointLight(0x66ccff, 4.0, 6, 1.6);
    desk.position.set(0, 1.1, -2.1);
    deskGO.object3d.add(desk);
  }

  buildProps() {
    this._buildWindowFrame();

    const computerDesk = this._spawnProp('model:retro-computer', {
      name: 'ComputerDesk', position: [0, 0, -2.55], rotationY: Math.PI, scale: 0.016,
    });
    computerDesk.addComponent(new class extends Interactable {
      promptLabel = '[E] Collect signal';
      onInteract() { console.log('[MainOffice] signal collected'); }
    }());
    this._spawnProp('model:server-rack', {
      name: 'ServerRack', position: [4.55, 0, -1.35], rotationY: -Math.PI / 2, scale: 0.333,
    });
    this._spawnProp('model:radar-terminal', {
      name: 'RadarTerminal', position: [-4.45, 0, -0.55], rotationY: Math.PI / 2, scale: 0.478,
    });
    this._spawnProp('model:switchboard', {
      name: 'Switchboard', position: [5.72, 1.15, 1.25], rotationY: -Math.PI / 2, scale: 0.638,
    });

    const cameras = [
      { name: 'SecurityCamera_Window', position: [-2.2, 2.75, -4.65], rotation: [Math.PI / 5, -Math.PI / 8, 0] },
      { name: 'SecurityCamera_Door',   position: [4.9, 2.65, 3.9],    rotation: [Math.PI / 4, -Math.PI * 0.78, 0] },
      { name: 'SecurityCamera_Desk',   position: [-4.7, 2.55, 2.2],   rotation: [Math.PI / 4, Math.PI * 0.65, 0] },
    ];
    for (const cam of cameras) {
      const go = this._spawnProp('model:security-camera', {
        name: cam.name, position: cam.position, scale: 0.339, physics: 'none',
      });
      go.object3d.rotation.set(...cam.rotation);
    }
  }

  /** Frame around the back-wall opening. Left clear of glass: imported desk
   *  materials use transparency, and a glass plane sorts badly against them
   *  from inside the room. */
  _buildWindowFrame() {
    const frame = this._own(new THREE.MeshStandardMaterial({ color: 0x111820, roughness: 0.65 }));
    const parts = [
      ['WindowFrame_Top',           [0, 2.9, -4.84],     [8.75, 0.12, 0.18]],
      ['WindowFrame_Bottom',        [0, 0.4, -4.84],     [8.75, 0.12, 0.18]],
      ['WindowFrame_Left',          [-4.37, 1.65, -4.84], [0.12, 2.6, 0.18]],
      ['WindowFrame_Right',         [4.37, 1.65, -4.84],  [0.12, 2.6, 0.18]],
      ['WindowFrame_Mullion_Left',  [-1.42, 1.65, -4.83], [0.08, 2.35, 0.12]],
      ['WindowFrame_Mullion_Right', [1.42, 1.65, -4.83],  [0.08, 2.35, 0.12]],
      ['WindowFrame_Crossbar',      [0, 1.65, -4.82],     [8.5, 0.06, 0.12]],
    ];
    for (const [name, position, size] of parts) this._addStaticBox(name, position, size, frame);
  }
}
