import * as THREE from 'three';
import { describe, it, expect, vi } from 'vitest';
import { sealAgainst } from './ShadowSides.js';

// ─────────────────────────────────────────────
// ShadowSides — one light's shadow map sees both faces of a set of meshes
// ─────────────────────────────────────────────

const call = (mesh, shadowCamera) => {
  const depthMaterial = { side: THREE.BackSide };
  mesh.onBeforeShadow(null, mesh, null, shadowCamera, mesh.geometry, depthMaterial, null);
  return depthMaterial.side;
};

describe('sealAgainst', () => {
  const light = new THREE.SpotLight();
  const other = new THREE.DirectionalLight();

  it('makes every mesh under the root receive shadows — a detail that ignores them is lit through any roof', () => {
    const root = new THREE.Group();
    const led = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    expect(led.receiveShadow).toBe(false);   // three's default
    root.add(led);
    sealAgainst(root, light);
    expect(led.receiveShadow).toBe(true);
  });

  it('makes every mesh under the root draw both faces into that light\'s shadow map', () => {
    const root = new THREE.Group();
    const wall = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const nested = new THREE.Group();
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    nested.add(lamp);
    root.add(wall, nested);

    sealAgainst(root, light);
    expect(call(wall, light.shadow.camera)).toBe(THREE.DoubleSide);
    expect(call(lamp, light.shadow.camera)).toBe(THREE.DoubleSide);
  });

  it('leaves every other light\'s shadow map as it was', () => {
    const root = new THREE.Group();
    const wall = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    root.add(wall);
    sealAgainst(root, light);
    expect(call(wall, other.shadow.camera)).toBe(THREE.BackSide);
  });

  it('keeps a hook the mesh already had', () => {
    const root = new THREE.Group();
    const wall = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const before = vi.fn();
    wall.onBeforeShadow = before;
    root.add(wall);
    sealAgainst(root, light);
    call(wall, other.shadow.camera);
    expect(before).toHaveBeenCalledTimes(1);
  });
});
