import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';

// ─────────────────────────────────────────────
// CoffeeCup  –  the mug under the bedroom's coffee machine
// ─────────────────────────────────────────────
// A chunky glazed mug, built here: its outside wears one picture all the
// way round (`tex:mug-hang-in-there`, from scripts/make-mug-picture.mjs —
// a ginger cat hanging off a branch over HANG IN THERE), the middle of it
// on the front (+z), the seam at the back, the handle on its right (+x).
// Inside, the coffee is a disc that rises as it brews (setFill). Given the
// machine's spouts, a thin stream falls straight down from each onto the
// coffee while it pours (setPouring), shorter as it fills.
//
//   const cup = new CoffeeCup({ picture: assets.get('tex:mug-hang-in-there'), spouts });
//   machineModel.addChild(cup);           // on the drip tray
//   cup.setPouring(true);
//   cup.setFill(0.5);                     // half brewed
//
// The CoffeeMachine shows it while a cup brews and while one waits.
// The origin is the middle of its foot. It casts no shadow: it comes and
// goes, and the shadow maps are frozen. It owns its geometries and
// materials; dispose() frees them, never the picture, which is the asset
// cache's.
// ─────────────────────────────────────────────

/** Metres: height, radius at the rim and at the foot, the glaze's thickness,
 *  the floor's, and the handle's loop and its thickness. */
export const CUP = Object.freeze({
  height: 0.1,
  radius: 0.052,
  footRadius: 0.048,
  wall: 0.004,
  floor: 0.006,
  handle: 0.024,
  handleTube: 0.007,
});

const GLAZE = 0xe8dcc4;
const COFFEE = 0x3b2314;
const STREAM = 0x5a3418;
/** A stream's radius, metres. */
const STREAM_RADIUS = 0.0022;
/** How far under the rim a full cup's coffee stands. */
const HEADROOM = 0.012;

export class CoffeeCup extends GameObject {
  /**
   * @param {object} [opts]
   * @param {THREE.Texture|null} [opts.picture]  The wrap round its outside.
   * @param {number[][]} [opts.spouts]  Where the coffee pours from, [x, y, z] in the cup's own space.
   * @param {string} [opts.name]
   */
  constructor({ picture = null, spouts = [], name = 'CoffeeCup' } = {}) {
    super(name);
    this._build(picture, spouts);
    this.setFill(0);
  }

  /** The streams from the spouts, on or off. */
  setPouring(on) {
    for (const stream of this.streams) stream.visible = on;
  }

  /** How full, 0 (just the first drops) … 1 (a full cup). */
  setFill(t) {
    const { height, radius, footRadius, wall, floor } = CUP;
    const fill = Math.min(1, Math.max(0, t));
    const lowest = floor + 0.002;
    const y = lowest + fill * (height - HEADROOM - lowest);
    this.coffee.position.y = y;
    // The wall leans out as it rises: the disc is as wide as the inside there.
    const inside = footRadius + (radius - footRadius) * (y / height) - wall;
    this.coffee.scale.set(inside, 1, inside);

    // Each stream straight down from its spout to the surface.
    for (const stream of this.streams) stream.scale.y = stream.position.y - y;
  }

  /** Free every geometry and material the cup built. */
  dispose() {
    const resources = new Set();
    this.object3d.traverse(o => {
      if (o.isMesh) { resources.add(o.geometry); resources.add(o.material); }
    });
    for (const resource of resources) resource.dispose();
  }

  _build(picture, spouts) {
    const { height, radius, footRadius, wall, floor, handle, handleTube } = CUP;
    const outside = new THREE.MeshStandardMaterial({ color: picture ? 0xffffff : GLAZE, map: picture, roughness: 0.35 });
    const glaze = new THREE.MeshStandardMaterial({ color: GLAZE, roughness: 0.35 });
    const inside = new THREE.MeshStandardMaterial({ color: GLAZE, roughness: 0.35, side: THREE.BackSide });
    const add = (name, geometry, material, setup) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      setup?.(mesh);
      this.object3d.add(mesh);
      return mesh;
    };

    // Open, so the picture is on the outside alone; thetaStart −π puts u 0.5
    // on +z, and u grows to the right seen from the front.
    add('CupWall', new THREE.CylinderGeometry(radius, footRadius, height, 40, 1, true, -Math.PI, Math.PI * 2), outside,
      m => { m.position.y = height / 2; });
    // The inside wall, seen from within.
    add('CupInside', new THREE.CylinderGeometry(radius - wall, footRadius - wall, height - floor, 40, 1, true), inside,
      m => { m.position.y = floor + (height - floor) / 2; });
    add('CupRim', new THREE.TorusGeometry(radius - wall / 2, wall / 2, 6, 40), glaze, m => {
      m.rotation.x = Math.PI / 2;
      m.position.y = height;
    });
    add('CupFoot', new THREE.CircleGeometry(footRadius, 40), glaze, m => { m.rotation.x = Math.PI / 2; });
    add('CupFloor', new THREE.CircleGeometry(footRadius - wall, 40), glaze, m => {
      m.rotation.x = -Math.PI / 2;
      m.position.y = floor;
    });
    // Half a ring, turned from the top half to the right.
    add('CupHandle', new THREE.TorusGeometry(handle, handleTube, 10, 20, Math.PI), glaze, m => {
      m.rotation.z = -Math.PI / 2;
      m.position.set(radius, height / 2, 0);
    });

    // A unit disc, scaled to the inside wherever it stands (setFill). Laid
    // flat in its geometry, not by a rotation, so x and z are its width.
    this.coffee = add('CupCoffee', new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: COFFEE, roughness: 0.25 }));

    // One metre long, hanging down from its top: scaled to length.
    const stream = new THREE.CylinderGeometry(STREAM_RADIUS, STREAM_RADIUS * 0.8, 1, 8, 1, true).translate(0, -0.5, 0);
    const pour = new THREE.MeshStandardMaterial({ color: STREAM, roughness: 0.2 });
    this.streams = spouts.map(at => add('CupStream', stream, pour, m => {
      m.position.set(...at);
      m.visible = false;
    }));
  }
}
