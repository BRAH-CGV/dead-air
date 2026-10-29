import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createVentHood, createVentGrille, createCameraPole } from './WallVent.js';

// ─────────────────────────────────────────────
// The vents and the camera poles are pieces of steel and black; each piece
// was its own mesh, its own draw call. Baked together by material and
// shadow setting, they draw the same in a few (#175).
// ─────────────────────────────────────────────

const meshesOf = (go) => {
  const out = [];
  go.object3d.traverse(o => { if (o.isMesh) out.push(o); });
  return out;
};
const sizeOf = (o) => new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());

describe('WallVent pieces, baked (#175)', () => {
  it('the hood is three meshes: its steel, the black duct, and the grate across its mouth', () => {
    const hood = createVentHood({ width: 0.8, height: 0.55, depth: 0.45 });
    const meshes = meshesOf(hood);
    expect(meshes).toHaveLength(3);
    const grate = hood.object3d.getObjectByName('VentGrate');
    expect(grate.isMesh).toBe(true);
    expect(sizeOf(grate).x).toBeGreaterThan(0.6);   // bars right across the mouth
    expect(meshes.every(m => m.receiveShadow && !m.castShadow)).toBe(true);
  });

  it('the grille is three: the black behind, the frame, and the slats (which take no shadow, as before)', () => {
    const grille = createVentGrille({ width: 0.8, height: 0.55 });
    const meshes = meshesOf(grille);
    expect(meshes).toHaveLength(3);
    expect(meshes.filter(m => m.receiveShadow)).toHaveLength(2);
    const slats = meshes.find(m => !m.receiveShadow);
    expect(sizeOf(slats).x).toBeCloseTo(0.8, 2);
  });

  it('the camera pole is one mesh, casting and taking shadows', () => {
    const pole = createCameraPole({ height: 3.6 });
    const meshes = meshesOf(pole);
    expect(meshes).toHaveLength(1);
    expect(meshes[0].castShadow && meshes[0].receiveShadow).toBe(true);
    expect(sizeOf(meshes[0]).y).toBeCloseTo(3.6 + 0.2 + 0.03, 1);
  });

  it('hands over every geometry and material it draws with, to be freed', () => {
    for (const go of [createVentHood(), createVentGrille(), createCameraPole()]) {
      for (const mesh of meshesOf(go)) {
        expect(go.resources).toContain(mesh.geometry);
        expect(go.resources).toContain(mesh.material);
      }
    }
  });
});
