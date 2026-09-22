import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';

// ─────────────────────────────────────────────
// DishPad  –  the concrete the dish stands on, lit from below
// ─────────────────────────────────────────────
// A square slab under the satellite tower with a handful of small floods
// around its edge, aimed up the structure. It is the only warm light in the
// landscape and the only lit thing outside the base, which is most of the
// point: it makes the dish read as maintained equipment someone walks out to
// rather than as scenery, and it gives the window a place to look.
//
//   this._outside.addChild(createDishPad({ position: satellitePosition }));
//
// ── Why the floods do not cast shadows ──
// The moon already owns the one shadow map this scene can afford, and its
// camera only covers the base. Four shadow-casting spots out here would each
// want their own, for a structure nobody stands close enough to read shadow
// detail on. They light the tower and nothing else.
// ─────────────────────────────────────────────

export const DISH_PAD = {
  /** Metres. Square, and deliberately only a little wider than the tower's
   *  legs — it should read as a footing poured for the mast, not as a plaza. */
  size: 9,
  thickness: 0.3,
  /** Lifted a hair proud of the terrain, the same trick the office floor uses:
   *  coplanar faces z-fight, and the ground here is dead flat. */
  lift: 0.02,
  colour: 0x51504c,
  /** Floods, spaced evenly around the slab. Four is enough to wrap the mast
   *  in light without the pad turning into a stage. */
  lights: 4,
  /** How far in from the slab's edge the fittings sit. */
  inset: 0.9,
  light: {
    /** Sodium-ish. The whole valley is blue-grey moonlight, so a warm source
     *  is what separates this from everything around it. Kept modest — this
     *  is a small installation, not a stage, and the first pass at 14 read as
     *  a wash rather than a few floods. */
    colour: 0xffcc88,
    intensity: 9,
    distance: 26,
    angle: Math.PI / 7,
    penumbra: 0.55,
    /** Metres up the tower the beams converge on. */
    aimHeight: 7,
    fittingSize: 0.22,
  },
};

/**
 * Build the pad.
 *
 * @param {Object} [opts]
 * @param {THREE.Vector3|{x: number, y: number, z: number}} [opts.position]
 *        where the tower stands — pass the satellite's own position so the two
 *        cannot drift apart
 * @returns {GameObject} a group carrying the slab, the floods and their fittings
 */
export function createDishPad(opts = {}) {
  const { position = { x: 0, y: 0, z: 0 } } = opts;

  const pad = new GameObject('DishPad');
  // A group, for the same reason the other outdoor pieces are: the editor
  // should not measure or list a slab and four lights as separate entries.
  pad.makeGroup();
  pad.object3d.position.set(position.x, position.y, position.z);

  const { size, thickness, lift, colour, lights, inset, light } = DISH_PAD;

  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(size, thickness, size),
    new THREE.MeshStandardMaterial({ color: colour, roughness: 0.95, metalness: 0 }),
  );
  slab.name = 'DishPadSlab';
  // Sunk so only `lift` of it stands above the ground — a poured footing, not
  // a block dropped on the sand.
  slab.position.y = lift - thickness / 2;
  slab.castShadow = false;
  slab.receiveShadow = true;
  pad.object3d.add(slab);

  // What every flood aims at: a point up the mast, shared, so the beams
  // converge rather than running parallel.
  const target = new THREE.Object3D();
  target.name = 'DishPadAim';
  target.position.set(0, light.aimHeight, 0);
  pad.object3d.add(target);

  const reach = size / 2 - inset;
  const fittingGeometry = new THREE.CylinderGeometry(
    light.fittingSize, light.fittingSize * 1.3, light.fittingSize * 1.6, 8,
  );
  const fittingMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a2a28,
    emissive: new THREE.Color(light.colour),
    emissiveIntensity: 1.4,
    roughness: 0.6,
  });

  for (let i = 0; i < lights; i++) {
    // Set on the diagonals, so none of them sits in the line between the
    // window and the dish.
    const angle = (i + 0.5) * ((Math.PI * 2) / lights);
    const x = Math.cos(angle) * reach;
    const z = Math.sin(angle) * reach;

    const flood = new THREE.SpotLight(
      light.colour, light.intensity, light.distance, light.angle, light.penumbra, 1.4,
    );
    flood.name = `DishFlood_${i}`;
    flood.position.set(x, lift + light.fittingSize, z);
    flood.target = target;
    // See the header: the moon owns the only shadow map worth paying for.
    flood.castShadow = false;
    pad.object3d.add(flood);

    const fitting = new THREE.Mesh(fittingGeometry, fittingMaterial);
    fitting.name = `DishFloodFitting_${i}`;
    fitting.position.copy(flood.position);
    // Tilted to face the way the beam actually goes, so the fitting does not
    // read as a bollard with a light mysteriously above it.
    fitting.lookAt(target.position);
    fitting.rotateX(Math.PI / 2);
    fitting.castShadow = false;
    pad.object3d.add(fitting);
  }

  return pad;
}
