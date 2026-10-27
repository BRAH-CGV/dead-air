// ─────────────────────────────────────────────
// DriveReader  –  the drive readers' shape, slot and look (#188)
// ─────────────────────────────────────────────
// Three readers take drives: the office computer's and the server room's two
// consoles'. Each is a small static box the rooms build; this is what they
// share. A drive slides into the slot on the reader's front (+z) connector
// end first — the drive's pins (its +z end) go in, so it is turned half round
// — and stands half out of it, its LED end out where it is seen and taken.
//
//   const go = room._addStaticBox('DriveReader', pos, READER_SIZE, readerMaterial());
//   skinReader(go.object3d.children[0], engine.assets);
//   go.addComponent(new DriveSlot({ snapOffset: READER_SLOT.offset, snapRotation: READER_SLOT.rotation }));
// ─────────────────────────────────────────────
import * as THREE from 'three';
import { READER_ATLAS, skinBox, assetTexture } from './propAtlases.js';

/** Full metres: across, tall, front to back. */
export const READER_SIZE = Object.freeze([0.12, 0.03, 0.15]);

/** The drive (Drive's default size) and how far of it goes in. */
const DRIVE_SIZE = [0.08, 0.02, 0.12];
const INSERT_DEPTH = 0.07;

/** Where a seated drive sits in the reader's own space: level in its slot,
 *  INSERT_DEPTH of it inside, turned half round so its pins lead in. */
export const READER_SLOT = Object.freeze({
  offset: Object.freeze({ x: 0, y: 0, z: READER_SIZE[2] / 2 + DRIVE_SIZE[2] / 2 - INSERT_DEPTH }),
  rotation: Object.freeze({ x: 0, y: Math.PI, z: 0 }),
});

/** The reader's material: plain dark casing until skinReader dresses it. */
export function readerMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6, metalness: 0.45 });
}

/** Lay the reader's atlas on its box, and its picture and relief on its
 *  material when they are loaded (the cache owns both). */
export function skinReader(mesh, assets) {
  return skinBox(mesh, assetTexture(assets, 'tex:drive-reader'), READER_ATLAS,
    assetTexture(assets, 'tex:drive-reader-normal'));
}
