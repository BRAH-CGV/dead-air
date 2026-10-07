import * as THREE from 'three';
import { Room } from './Room.js';
import { Interactable } from '../../components/Interactable.js';
import { WallClock } from '../../gameobjects/WallClock.js';
import { SignalAlertLight } from '../../gameobjects/SignalAlertLight.js';
import { WindowGlass } from '../../gameobjects/WindowGlass.js';

// ─────────────────────────────────────────────
// MainOffice  –  the signal lab, open from night 1
// ─────────────────────────────────────────────
// The hub room, carried over from OfficeScene: same 12 × 10 × 3 shell, big
// back window, warm ceiling light and cool desk glow. Scene-wide lighting
// (ambient, moon) belongs to the scene, not the room.
//
// Furnished for the job and nothing else: the computer desk facing the
// window, its chair, a food-ration dispenser (the player eats here, between
// scans), a bin, a shelf of spares, an extinguisher by the door, a poster.
//
// Doorways: front (the original door) → Airlock, and through its hatch to
// Outside; right → ServerRoom; left → LivingQuarters. None of them lock.
// The side doorways sit toward the front, leaving the back half of the
// side walls for the dispenser and the shelf.
//
// A wall clock hangs right of the window. The room builds it; the scene
// hands it the NightClock (`wallClock.clock`), since rooms don't know about
// gameplay. Same for the red signal lamp above the computer desk: the room
// perches it, the scene wires it to the SignalManager and GameController
// (`signalLight.signalManager` / `.gameController`).
// ─────────────────────────────────────────────

/** The bars across the window: mullions at ±x, the crossbar's height, and
 *  the mullions' width. The frame is built from them and the glass is cut
 *  into panes by them. */
const WINDOW_MULLION_X = 1.42;
const WINDOW_CROSSBAR_Y = 1.65;
const WINDOW_BAR = 0.08;

export class MainOffice extends Room {
  /** Hung by buildProps(). @type {WallClock|null} */
  wallClock = null;

  /** Perched by buildProps(). @type {SignalAlertLight|null} */
  signalLight = null;

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
    this.addDoor('ToAirlock',        'front', 'Airlock');
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
    this.ceilingLight = ceiling;

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

    // The terminal screen's own faint green spill. It is a vital function,
    // not a bulb: with the generator running it glows even after the UFO has
    // blown every lamp in the base — the one sign in a dark office that the
    // computer still works (PowerGrid reads `unbreakable`).
    const screenGO = this._addGroup('ScreenGlow');
    screenGO.object3d.userData.unbreakable = true;
    const screen = new THREE.PointLight(0x4dff7a, 0.8, 3, 2);
    screen.position.set(0, 1.0, -2.2);
    screenGO.object3d.add(screen);
    this.screenGlow = screen;
  }

  buildProps() {
    this._buildWindowFrame();
    this._buildWindowGlass();
    this._buildWallClock();
    this._buildSignalLight();

    // rotationY 0 seats the desk facing the back window — the dish tower is
    // out there, and the terminal's whole job is aiming it. The kneehole
    // (the manifest collider's open +Z side) ends up facing the door, which
    // is where the player crouches in from.
    //
    // No Interactable here: BaseScene attaches the ComputerTerminal and its
    // own Interactable to this desk. InteractionSystem resolves
    // getComponent(Interactable) — the first match wins — so a stub of our
    // own would silently shadow the terminal.
    this._spawnProp('model:retro-computer', {
      name: 'ComputerDesk', position: [0, 0, -2.55], rotationY: 0, scale: 0.016,
    });

    // Pulled out to the right and turned toward the door, as if just left:
    // the kneehole (x ±0.545) stays open to crouch into.
    this._spawnProp('model:metal-chair', {
      name: 'DeskChair', position: [0.95, 0, -1.75], rotationY: Math.PI - 0.45,
    });

    // Left wall, behind the doorway: the ration dispenser and a bin for the
    // wrappers.
    this._buildRationDispenser();
    this._spawnProp('model:trash-bin', { name: 'TrashBin', position: [-5.68, 0, 0.05] });

    // Right wall: spare parts on a shelf; a poster where the eye lands
    // walking in from the airlock. The shelf's open sides face ±x.
    this._spawnProp('model:shelf', { name: 'Shelf', position: [5.68, 0, -2.0] });

    // Tiny dynamic crate on the second shelf level to demonstrate collision layers:
    // the crate rests on the SHELF-layer boards, while the player is blocked by
    // the DEFAULT-layer outer box. Toggle physics debug (`) to see the layers.
    // The crate uses explicit groups (DEFAULT membership, not PLAYER) so it
    // passes through the player-only bounding box.
    this._spawnProp('model:crate', {
      name: 'ShelfCube',
      position: [5.68, 1.09, -2.0],  // third shelf level (y≈1.06)
      scale: 0.0016,                  // doubled from 0.0008
      physics: {
        body: 'dynamic',
        mass: 0.5,
        // DEFAULT membership (not PLAYER) so it passes through the player-only box.
        // Filters for DEFAULT + SHELF so it rests on the shelf boards.
        groups: { membership: ['DEFAULT'], filter: ['DEFAULT', 'SHELF'] },
      },
    });

    this._spawnProp('model:poster', {
      name: 'Poster', position: [5.9, 1.05, 0.6], rotationY: -Math.PI / 2, physics: 'none',
    });

    // By the airlock door, where a fire would be fought from.
    this._spawnProp('model:fire-extinguisher', { name: 'FireExtinguisher', position: [3.05, 0, 4.72] });
  }

  /** Where food comes from: a wall-mounted machine that dispenses rations
   *  of nutrient mush. Built here rather than imported — the downloaded
   *  vending machine is a broken fragment. The body is the collider the
   *  interact ray hits; the face details are plain meshes on it. */
  _buildRationDispenser() {
    const body = this._own(new THREE.MeshStandardMaterial({ color: 0x3a4148, roughness: 0.55, metalness: 0.4 }));
    const size = [0.7, 1.9, 0.9];
    const go = this._addStaticBox('VendingMachine', [-5.9 + size[0] / 2, size[1] / 2, -1.0], size, body);

    // Front face is +x, into the room; positions are relative to the body's
    // centre, 0.95 m up.
    const front = size[0] / 2;
    const detail = (geometry, material, position) => {
      const mesh = new THREE.Mesh(this._own(geometry), material);
      mesh.position.set(...position);
      go.object3d.add(mesh);
      return mesh;
    };
    const dark  = this._own(new THREE.MeshStandardMaterial({ color: 0x0c0e10, roughness: 0.9 }));
    const glass = this._own(new THREE.MeshStandardMaterial({
      color: 0x0a140e, emissive: 0x6dff9c, emissiveIntensity: 0.9, roughness: 0.3,
    }));
    const light = this._own(new THREE.MeshStandardMaterial({
      color: 0x200808, emissive: 0xff5a3c, emissiveIntensity: 1.4,
    }));

    detail(new THREE.BoxGeometry(0.02, 0.34, 0.56), glass, [front + 0.01, 0.4, 0]);       // status screen
    detail(new THREE.BoxGeometry(0.03, 0.08, 0.08), light, [front + 0.015, 0.05, 0.2]);   // dispense button
    detail(new THREE.BoxGeometry(0.04, 0.22, 0.5), dark, [front + 0.02, -0.35, 0]);       // hatch
    detail(new THREE.BoxGeometry(0.16, 0.03, 0.56), body, [front + 0.08, -0.47, 0]);      // tray lip

    go.addComponent(new class extends Interactable {
      promptLabel = '[E] Take a food ration';
      onInteract() {
        // TODO: coordinate with Hayden's stamina system.
        console.log('[MainOffice] food ration eaten');
      }
    }());
  }

  /** Right of the window, between its frame (x 4.43) and the side wall
   *  (x 5.9), flush on the back wall's inner face. */
  _buildWallClock() {
    this.wallClock = this._own(new WallClock());
    this.wallClock.object3d.position.set(5.15, 1.95, -4.9);
    this.root.addChild(this.wallClock);
  }

  /** Above the computer desk, where it reads from anywhere in the room. A
   *  placeholder sphere until a proper warning-lamp model is sourced. */
  _buildSignalLight() {
    this.signalLight = this._own(new SignalAlertLight());
    this.signalLight.object3d.position.set(0, 1.3, -2.45);
    this.root.addChild(this.signalLight);
  }

  /** Frame around the back-wall opening. The solid part of the window is
   *  the collider Room puts in every window opening (`BackWindow`); what is
   *  seen of the glass is _buildWindowGlass. */
  _buildWindowFrame() {
    const frame = this._own(new THREE.MeshStandardMaterial({ color: 0x111820, roughness: 0.65 }));
    const parts = [
      ['WindowFrame_Top',           [0, 2.9, -4.84],     [8.75, 0.12, 0.18]],
      ['WindowFrame_Bottom',        [0, 0.4, -4.84],     [8.75, 0.12, 0.18]],
      ['WindowFrame_Left',          [-4.37, 1.65, -4.84], [0.12, 2.6, 0.18]],
      ['WindowFrame_Right',         [4.37, 1.65, -4.84],  [0.12, 2.6, 0.18]],
      ['WindowFrame_Mullion_Left',  [-WINDOW_MULLION_X, 1.65, -4.83], [WINDOW_BAR, 2.35, 0.12]],
      ['WindowFrame_Mullion_Right', [WINDOW_MULLION_X, 1.65, -4.83],  [WINDOW_BAR, 2.35, 0.12]],
      ['WindowFrame_Crossbar',      [0, WINDOW_CROSSBAR_Y, -4.82],    [8.5, 0.06, 0.12]],
    ];
    for (const [name, position, size] of parts) this._addStaticBox(name, position, size, frame);
  }

  /** The glass itself, as much as is drawn of it: a thin film of dust and
   *  smears on a pane in the middle of the wall's thickness — behind the
   *  mullions from inside, set back in the reveal from outside. Cut into
   *  panes where the frame's bars cross it, so the dust lies along them. It
   *  shows by the ceiling light, read live: 1 / (π d) of it reaches the
   *  glass, as the light falls off (its decay is 1). BaseScene adds the
   *  night outside and the UFO's beam.
   *
   *  The glass never writes depth and the desk in front of it does (its
   *  manifest entry), so the desk's transparent materials stay in front
   *  whichever of the two is drawn first — the sorting that kept glass out
   *  of this window before. */
  _buildWindowGlass() {
    const { width, height, offset = 0, sill } = this.openings.find(o => o.side === 'back');
    const centre = [offset, sill + height / 2, this._wallPlane('back')];
    const fromLeft = x => x - offset + width / 2;

    this.windowGlass = this._own(new WindowGlass({
      width, height,
      dividers: {
        x: [fromLeft(-WINDOW_MULLION_X), fromLeft(WINDOW_MULLION_X)],
        y: [WINDOW_CROSSBAR_Y - sill],
        width: WINDOW_BAR,
      },
    }));
    this.windowGlass.object3d.position.set(...centre);
    this.root.addChild(this.windowGlass);

    const reach = this.ceilingLight.position.distanceTo(this.windowGlass.object3d.position);
    this.windowGlass.addLight(this.ceilingLight, 1 / (Math.PI * reach));
  }
}
