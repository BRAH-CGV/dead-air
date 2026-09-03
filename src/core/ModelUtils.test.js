import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  prepareModel, measure, extractColliderMeshes, collectGeometry,
} from './ModelUtils.js';
import { mergePhysics, resolvePhysics } from './ColliderSpec.js';

// The load-time helpers all depend on one property of the cached model: the
// root has no parent, so a child's matrixWorld is already in the space the
// spawned GameObject provides. These tests pin that down — if it ever stops
// holding, colliders drift away from the geometry they're meant to wrap.

function meshAt(name, position = [0, 0, 0], size = 1) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size));
  mesh.name = name;
  mesh.position.set(...position);
  return mesh;
}

describe('extractColliderMeshes', () => {
  it('pulls collision proxies out of the render tree and leaves the art', () => {
    const root = new THREE.Group();
    root.add(meshAt('Desk_Top'), meshAt('UCX_Desk_Top'), meshAt('collider_leg'));

    const hulls = extractColliderMeshes(root);

    expect(hulls).toHaveLength(2);
    expect(root.children.map(c => c.name)).toEqual(['Desk_Top']);
  });

  it('recognises every spelling of the naming convention', () => {
    const root = new THREE.Group();
    root.add(
      meshAt('UCX_a'), meshAt('ucx_b'), meshAt('Collider_c'),
      meshAt('desk_collider'), meshAt('UCX.d'),
    );
    expect(extractColliderMeshes(root)).toHaveLength(5);
  });

  it('leaves names that merely contain the word alone', () => {
    const root = new THREE.Group();
    root.add(meshAt('ColliderTest'), meshAt('my_collider_thing'));
    expect(extractColliderMeshes(root)).toHaveLength(0);
    expect(root.children).toHaveLength(2);
  });

  it('bakes nested node transforms into the points', () => {
    const root = new THREE.Group();
    const pivot = new THREE.Group();
    pivot.position.set(10, 0, 0);
    pivot.add(meshAt('UCX_box', [0, 5, 0]));
    root.add(pivot);

    const [points] = extractColliderMeshes(root);

    // A unit cube at pivot(10,0,0) + local(0,5,0) spans x 9.5..10.5, y 4.5..5.5.
    const xs = points.filter((_, i) => i % 3 === 0);
    const ys = points.filter((_, i) => i % 3 === 1);
    expect(Math.min(...xs)).toBeCloseTo(9.5);
    expect(Math.max(...xs)).toBeCloseTo(10.5);
    expect(Math.min(...ys)).toBeCloseTo(4.5);
  });

  it('carries the manifest scale that prepareModel baked in', () => {
    const root = new THREE.Group();
    root.add(meshAt('UCX_box'));
    prepareModel(root, { scale: 3 });

    const [points] = extractColliderMeshes(root);
    expect(Math.max(...points)).toBeCloseTo(1.5);   // half of a 3 m cube
  });

  it('keeps proxies out of the measured bounds', () => {
    const root = new THREE.Group();
    root.add(meshAt('Desk', [0, 0, 0], 1), meshAt('UCX_huge', [0, 0, 0], 10));

    extractColliderMeshes(root);
    expect(measure(root).size.x).toBeCloseTo(1);
  });

  it('frees the proxy geometry — nothing else can reach it once detached', () => {
    const root = new THREE.Group();
    const proxy = meshAt('UCX_box');
    root.add(proxy);

    let disposed = false;
    proxy.geometry.addEventListener('dispose', () => { disposed = true; });
    extractColliderMeshes(root);
    expect(disposed).toBe(true);
  });
});

describe('collectGeometry', () => {
  it('merges meshes and shifts each one\'s indices into the merged buffer', () => {
    const root = new THREE.Group();
    root.add(meshAt('a'), meshAt('b', [5, 0, 0]));

    const { vertices, indices } = collectGeometry(root);
    const boxVerts = new THREE.BoxGeometry().getAttribute('position').count;

    expect(vertices.length).toBe(boxVerts * 2 * 3);
    expect(Math.max(...indices)).toBe(boxVerts * 2 - 1);
    // Nothing may point past the end of the vertex buffer, or Rapier reads junk.
    expect(Math.max(...indices) * 3 + 2).toBeLessThan(vertices.length);
  });

  it('treats a non-indexed geometry as triangle soup', () => {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry().toNonIndexed());
    root.add(mesh);

    const { vertices, indices } = collectGeometry(root);
    expect(indices.length).toBe(vertices.length / 3);
    expect(indices.length % 3).toBe(0);
  });

  it('returns null for a model with no geometry at all', () => {
    expect(collectGeometry(new THREE.Group())).toBeNull();
  });
});

describe('the real desk.glb, end to end', () => {
  // The stand-in desk ships no UCX_ meshes, so it exercises exactly the tier-1
  // path the manifest asks for: measure the bounds, fit one box.
  const gltf = new GLTFLoader().parseAsync(
    toArrayBuffer(readFileSync('public/assets/models/desk.glb')), '',
  );

  it('resolves to a single box that actually wraps the desk', async () => {
    const { scene } = await gltf;
    prepareModel(scene);

    const hulls = extractColliderMeshes(scene);
    const { size, center } = measure(scene);
    expect(hulls).toHaveLength(0);          // no proxies authored yet

    const collision = { bounds: { size: size.toArray(), center: center.toArray() }, hulls };
    const resolved = resolvePhysics(mergePhysics('static'), collision);

    expect(resolved.body).toBe('static');
    expect(resolved.parts).toHaveLength(1);
    expect(resolved.parts[0].kind).toBe('cuboid');

    // Authored origin-on-floor, so the box has to be lifted to half its height
    // — otherwise it sinks and the player walks through the top of the desk.
    const [box] = resolved.parts;
    expect(box.halfExtents[1]).toBeCloseTo(size.y / 2);
    expect(box.position[1]).toBeCloseTo(size.y / 2, 1);
    expect(box.position[1]).toBeGreaterThan(0);
  });
});

function toArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
