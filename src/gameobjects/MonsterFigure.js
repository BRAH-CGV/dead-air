import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';

// ─────────────────────────────────────────────
// MonsterFigure  –  procedural stand-in for a monster model
// ─────────────────────────────────────────────
// A tall, thin, dark capsule with two small eyes that ignore the lighting,
// so they read in the dark and through the fog, and a pale grin under them,
// hidden until a threat shows it (`smile`). It is a placeholder: swap
// in a real model by replacing what this returns; `placeholderFor` records
// the file it waits for.
//
// Origin on the floor, facing +Z — Object3D.lookAt turns +Z toward its
// target, so a threat aims the figure with one call. Built hidden, with no
// rigid body or collider: monsters are not physics.
//
// The body casts a shadow, and the shadow maps are frozen between redraws
// (ShadowScheduler): whoever moves, shows or hides the figure invalidates
// them. The geometry and materials are fresh per call, so the caller owns
// them (BaseScene._ownResourcesOf).
// ─────────────────────────────────────────────

/**
 * @param {object} [opts]
 * @param {string} [opts.name]
 * @param {number} [opts.height]   metres, floor to crown
 * @param {number} [opts.radius]   metres
 * @param {number} [opts.color]    body colour
 * @param {number} [opts.eyeColor]
 * @param {string|null} [opts.placeholderFor]
 * @param {number} [opts.smileColor]
 * @returns {GameObject & { eyes: THREE.Mesh[], smile: THREE.Mesh, placeholderFor: string|null }}
 */
export function createMonsterFigure({
  name = 'Monster', height = 2.4, radius = 0.2,
  color = 0x0b0a0c, eyeColor = 0xff3a22, smileColor = 0xe8e0cc, placeholderFor = null,
} = {}) {
  const go = new GameObject(name);

  // CapsuleGeometry's `length` is the straight middle; the caps add a
  // radius at each end. Lift it so its lowest point is the floor. Both
  // materials are laid down transparent up front: a fade (the Sleep Demon)
  // never swaps a shader state mid-game.
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(radius, height - radius * 2, 4, 10),
    new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0, transparent: true }),
  );
  body.name = `${name}Body`;
  body.position.y = height / 2;
  body.castShadow = true;
  go.object3d.add(body);

  // One geometry and one material for both eyes.
  const eyeGeometry = new THREE.SphereGeometry(radius * 0.14, 8, 6);
  const eyeMaterial = new THREE.MeshBasicMaterial({ color: eyeColor, fog: false, transparent: true });
  go.eyes = [-1, 1].map(side => {
    const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    eye.name = `${name}Eye`;
    eye.position.set(side * radius * 0.38, height - radius * 0.9, radius * 0.9);
    go.object3d.add(eye);
    return eye;
  });

  // The grin: half a thin torus, turned to a ∪, just proud of the body
  // below the eyes. Unlit like them; hidden, and no shadow, so showing it
  // redraws nothing.
  const grin = radius * 0.4;
  go.smile = new THREE.Mesh(
    new THREE.TorusGeometry(grin, radius * 0.035, 4, 16, Math.PI),
    new THREE.MeshBasicMaterial({ color: smileColor, fog: false, transparent: true }),
  );
  go.smile.name = `${name}Smile`;
  go.smile.rotation.z = Math.PI;
  go.smile.position.set(0, height - radius * 1.45, radius * 1.04);
  go.smile.visible = false;
  go.object3d.add(go.smile);

  go.placeholderFor = placeholderFor;
  go.object3d.visible = false;
  return go;
}
