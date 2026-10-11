import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createMonsterFigure } from './MonsterFigure.js';

describe('createMonsterFigure', () => {
  it('stands on its origin, as tall as asked', () => {
    const figure = createMonsterFigure({ name: 'Watcher', height: 2.4 });
    const box = new THREE.Box3().setFromObject(figure.object3d);
    expect(box.min.y).toBeCloseTo(0, 5);
    expect(box.max.y).toBeCloseTo(2.4, 5);
    expect(figure.name).toBe('Watcher');
  });

  it('is built hidden, with no body — a monster is not physics', () => {
    const figure = createMonsterFigure();
    expect(figure.object3d.visible).toBe(false);
    expect(figure.rigidBody).toBeNull();
    expect(figure.collider).toBeNull();
  });

  it('has two unlit eyes near the top, facing +Z (the way lookAt turns it)', () => {
    const figure = createMonsterFigure({ height: 2 });
    expect(figure.eyes).toHaveLength(2);
    for (const eye of figure.eyes) {
      expect(eye.material).toBeInstanceOf(THREE.MeshBasicMaterial);
      expect(eye.position.y).toBeGreaterThan(2 * 0.8);
      expect(eye.position.z).toBeGreaterThan(0);
    }
    expect(Math.sign(figure.eyes[0].position.x)).toBe(-Math.sign(figure.eyes[1].position.x));
  });

  it('has a grin below the eyes, hidden until someone shows it, that fades with it', () => {
    const figure = createMonsterFigure({ height: 2, radius: 0.25 });
    const { smile } = figure;
    expect(smile).toBeInstanceOf(THREE.Mesh);
    expect(smile.parent).toBe(figure.object3d);
    expect(smile.visible).toBe(false);
    expect(smile.castShadow).toBe(false);
    expect(smile.material.transparent).toBe(true);
    smile.updateMatrixWorld();
    const box = new THREE.Box3().setFromObject(smile);
    expect(box.max.y).toBeLessThan(figure.eyes[0].position.y);
    expect(box.min.y).toBeGreaterThan(2 * 0.6);
  });

  it('the grin is a wide crescent of teeth, wrapped round the face: a band on the body drawn by its own shader', () => {
    const radius = 0.25;
    const figure = createMonsterFigure({ height: 2, radius });
    const { smile } = figure;
    smile.updateMatrixWorld();
    const box = new THREE.Box3().setFromObject(smile);
    expect(box.max.x - box.min.x).toBeGreaterThan(radius * 1.4);   // most of the face across
    // It sits on the body's surface all the way round: never inside it, never floating off.
    const at = new THREE.Vector3();
    const positions = smile.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      at.fromBufferAttribute(positions, i).applyMatrix4(smile.matrixWorld);
      expect(Math.hypot(at.x, at.z)).toBeGreaterThan(radius * 0.98);
      expect(Math.hypot(at.x, at.z)).toBeLessThan(radius * 1.15);
      expect(at.z).toBeGreaterThan(0);                 // on the face, not the back
    }
    expect(smile.geometry.attributes.uv).toBeDefined();
    // The teeth are the shader's: unlit, never fogged, bone-pale, a row above
    // and a row below, many of them.
    const material = smile.material;
    expect(material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(material.lights).toBe(false);
    expect(material.fog).toBe(false);
    expect(material.transparent).toBe(true);
    expect(material.uniforms.uTeeth.value).toBeGreaterThanOrEqual(10);
    expect(material.fragmentShader).toMatch(/discard/);   // outside the crescent: nothing
  });

  it('the grin fades by its opacity, like the rest of the figure', () => {
    const { smile } = createMonsterFigure();
    expect(smile.material.opacity).toBe(1);
    smile.material.opacity = 0.4;
    expect(smile.material.uniforms.opacity.value).toBeCloseTo(0.4);
  });

  it('as a shade, its body is a pitch-black, unlit silhouette: no light or fog reaches it', () => {
    const figure = createMonsterFigure({ shade: true, castShadow: false });
    const body = figure.object3d.children.find(c => c.name.endsWith('Body'));
    const material = body.material;
    expect(material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(material.lights).toBe(false);
    expect(material.fog).toBe(false);
    expect(material.transparent).toBe(true);
    expect(material.fragmentShader).toMatch(/vec4\(\s*vec3\(\s*0\.0\s*\)/);   // black, always
    // Its edges thin out to nothing: a shadow, not a solid thing.
    expect(material.uniforms.uEdge.value).toBeGreaterThan(0);
    expect(material.fragmentShader).toMatch(/uEdge/);
  });

  it("a shade fades by its material's opacity, like any other", () => {
    const figure = createMonsterFigure({ shade: true });
    const body = figure.object3d.children.find(c => c.name.endsWith('Body'));
    expect(body.material.opacity).toBe(1);
    body.material.opacity = 0.3;
    expect(body.material.uniforms.opacity.value).toBeCloseTo(0.3);
  });

  it('is a solid, lit body unless asked to be a shade', () => {
    const figure = createMonsterFigure();
    const body = figure.object3d.children.find(c => c.name.endsWith('Body'));
    expect(body.material).toBeInstanceOf(THREE.MeshStandardMaterial);
  });

  it('casts a shadow by default, and none when asked', () => {
    const casting = createMonsterFigure();
    const body = casting.object3d.children.find(c => c.name.endsWith('Body'));
    expect(body.castShadow).toBe(true);
    const shadowless = createMonsterFigure({ castShadow: false });
    shadowless.object3d.traverse(node => {
      if (node.isMesh) expect(node.castShadow).toBe(false);
    });
  });

  it('records the file it stands in for', () => {
    const figure = createMonsterFigure({ placeholderFor: 'sleep-demon.glb' });
    expect(figure.placeholderFor).toBe('sleep-demon.glb');
  });
});

/** A stand-in for a loaded model: a 'Body' mesh standing on the origin and
 *  the four markers the bake script writes (scripts/bake-sleep-demon.mjs). */
function fakeModel() {
  const root = new THREE.Group();
  const geometry = new THREE.BoxGeometry(0.4, 1.8, 0.3).translate(0, 0.9, 0);
  const body = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  body.name = 'Body';
  root.add(body);
  const mark = (name, x, y, z) => {
    const node = new THREE.Object3D();
    node.name = name;
    node.position.set(x, y, z);
    root.add(node);
  };
  mark('EyeL', -0.05, 1.66, 0.14);
  mark('EyeR', 0.05, 1.66, 0.14);
  mark('Mouth', 0.02, 1.55, 0.15);
  mark('MouthAxis', 0.02, 1.55, 0.03);
  return root;
}

describe('createMonsterFigure with a model', () => {
  it("wears the model's body, on a copy of its geometry, so the figure owns what it disposes", () => {
    const model = fakeModel();
    const source = model.getObjectByName('Body');
    const figure = createMonsterFigure({ name: 'Demon', model, shade: true });
    const body = figure.object3d.children.find(c => c.name === 'DemonBody');
    expect(body.geometry).not.toBe(source.geometry);
    expect(body.geometry.attributes.position.count).toBe(source.geometry.attributes.position.count);
    expect(body.material).not.toBe(source.material);
    expect(body.material.fragmentShader).toMatch(/uEdge/);   // the shade
    expect(source.parent).toBe(model);                       // the cached model is left as it was
  });

  it('stands as tall as the model, its origin on the floor', () => {
    const figure = createMonsterFigure({ model: fakeModel() });
    figure.object3d.updateMatrixWorld(true);
    const body = figure.object3d.children.find(c => c.name.endsWith('Body'));
    const box = new THREE.Box3().setFromObject(body);
    expect(box.min.y).toBeCloseTo(0, 5);
    expect(box.max.y).toBeCloseTo(1.8, 5);
  });

  it("puts its eyes where the model's were", () => {
    const figure = createMonsterFigure({ model: fakeModel() });
    expect(figure.eyes).toHaveLength(2);
    expect(figure.eyes[0].position.toArray()).toEqual([-0.05, 1.66, 0.14]);
    expect(figure.eyes[1].position.toArray()).toEqual([0.05, 1.66, 0.14]);
    for (const eye of figure.eyes) expect(eye.material).toBeInstanceOf(THREE.MeshBasicMaterial);
  });

  it('wraps its grin round the head at the mouth: centred on the axis, its front on the face', () => {
    const figure = createMonsterFigure({ model: fakeModel() });
    const { smile } = figure;
    expect(smile.visible).toBe(false);
    smile.updateMatrixWorld();
    const radius = 0.12;   // Mouth to MouthAxis
    const at = new THREE.Vector3();
    const positions = smile.geometry.attributes.position;
    let front = -Infinity;
    for (let i = 0; i < positions.count; i++) {
      at.fromBufferAttribute(positions, i).applyMatrix4(smile.matrixWorld);
      const r = Math.hypot(at.x - 0.02, at.z - 0.03);
      expect(r).toBeGreaterThan(radius * 0.98);
      expect(r).toBeLessThan(radius * 1.1);
      front = Math.max(front, at.z);
    }
    expect(front).toBeGreaterThan(0.15);
    const box = new THREE.Box3().setFromObject(smile);
    expect(box.max.y).toBeLessThan(1.66);                    // under the eyes
    expect((box.min.y + box.max.y) / 2).toBeCloseTo(1.55, 1); // about the mouth
  });

  it('is no placeholder', () => {
    expect(createMonsterFigure({ model: fakeModel() }).placeholderFor).toBeNull();
  });
});

describe('sleep-demon.glb (scripts/bake-sleep-demon.mjs)', () => {
  const file = readFileSync(new URL('../../public/assets/models/sleep-demon.glb', import.meta.url));
  const load = () => new Promise((resolve, reject) => {
    new GLTFLoader().parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '', resolve, reject);
  });

  it('is one light mesh, 1.8 m tall, feet on the origin, facing +Z, with its eyes and mouth marked', async () => {
    const { scene } = await load();
    const body = scene.getObjectByName('Body');
    expect(body.isMesh).toBe(true);
    let meshes = 0;
    scene.traverse(node => { if (node.isMesh) meshes++; });
    expect(meshes).toBe(1);
    expect(body.geometry.index.count / 3).toBeLessThanOrEqual(4000);
    expect(body.geometry.attributes.uv).toBeUndefined();     // the shade needs no textures
    body.geometry.computeBoundingBox();
    const box = body.geometry.boundingBox;
    expect(box.min.y).toBeCloseTo(0, 2);
    expect(box.max.y).toBeCloseTo(1.8, 2);
    const eyeL = scene.getObjectByName('EyeL').position;
    const eyeR = scene.getObjectByName('EyeR').position;
    const mouth = scene.getObjectByName('Mouth').position;
    const axis = scene.getObjectByName('MouthAxis').position;
    for (const eye of [eyeL, eyeR]) {
      expect(eye.y).toBeGreaterThan(1.5);
      expect(eye.z).toBeGreaterThan(0);
    }
    expect(eyeL.x).toBeLessThan(eyeR.x);
    expect(mouth.y).toBeLessThan(eyeL.y);
    expect(mouth.z).toBeGreaterThan(axis.z);                 // the face is in front of the axis
  });
});
