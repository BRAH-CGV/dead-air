import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three';
import { Drive } from './Drive.js';
import { DriveInstancer } from './DriveInstancer.js';

// ─────────────────────────────────────────────
// Every drive was two draw calls, its casing and its LED: 64 for the four
// boxes on the office shelf. The instancer draws every drive's casing as
// one InstancedMesh and every LED as another, each frame copying where
// each drive is and what its LED shows from the drive itself (#175).
// ─────────────────────────────────────────────

const made = [];
afterEach(() => { for (const d of made.splice(0)) d.dispose(); });

function world(count = 3) {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.name = 'SceneRoot';
  const room = new THREE.Group();
  room.position.set(4, 0, -2);
  scene.add(root);
  root.add(room);
  const drives = Array.from({ length: count }, (_, i) => {
    const drive = new Drive(`D${i}`);
    made.push(drive);
    drive.object3d.position.set(i * 0.3, 0.8, 0);
    drive.object3d.rotation.y = i * 0.4;
    room.add(drive.object3d);
    return drive;
  });
  const instancer = new DriveInstancer({ root, drives: () => drives });
  scene.updateMatrixWorld(true);
  return { scene, root, room, drives, instancer };
}

const matrixOf = (mesh, i) => { const m = new THREE.Matrix4(); mesh.getMatrixAt(i, m); return m; };
/** Instance matrices are float32: equal to the world matrix to that precision. */
const same = (a, b) => a.elements.every((v, k) => Math.abs(v - b.elements[k]) < 1e-5);
const emissiveOf = (instancer, i) => {
  const a = instancer.led.geometry.attributes.aEmissive;
  return [a.getX(i), a.getY(i), a.getZ(i)];
};

describe('DriveInstancer', () => {
  it('draws every drive in two meshes, each instance where its drive is', () => {
    const { instancer, drives } = world(3);
    instancer.update();
    expect(instancer.body.count).toBe(3);
    expect(instancer.led.count).toBe(3);
    drives.forEach((drive, i) => {
      expect(same(matrixOf(instancer.body, i), drive._mesh.matrixWorld)).toBe(true);
      expect(same(matrixOf(instancer.led, i), drive._led.matrixWorld)).toBe(true);
    });
  });

  it('hides the drives\' own meshes, which still say they cast a shadow (the shadow scheduler reads that)', () => {
    const { instancer, drives } = world(2);
    instancer.update();
    for (const drive of drives) {
      expect(drive._mesh.visible).toBe(false);
      expect(drive._led.visible).toBe(false);
      expect(drive._mesh.castShadow).toBe(true);
    }
    expect(instancer.body.castShadow).toBe(true);
    expect(instancer.body.receiveShadow).toBe(true);
  });

  it('follows a drive as it moves', () => {
    const { instancer, drives, scene } = world(2);
    instancer.update();
    drives[1].object3d.position.set(1, 1.5, 2);
    scene.updateMatrixWorld(true);
    instancer.update();
    expect(same(matrixOf(instancer.body, 1), drives[1]._mesh.matrixWorld)).toBe(true);
  });

  it("lights each LED with its drive's emissive colour times intensity: blank, saved, processed, red", () => {
    const { instancer, drives } = world(4);
    drives[1].setSaved(true);
    drives[2].setSaved(true);
    drives[2].setSignalLevel(2);
    drives[3].setSaved(true, { corrupted: true });
    instancer.update();
    drives.forEach((drive, i) => {
      const m = drive._material;
      const want = [m.emissive.r, m.emissive.g, m.emissive.b].map(c => c * m.emissiveIntensity);
      emissiveOf(instancer, i).forEach((v, k) => expect(v).toBeCloseTo(want[k], 5));
    });
    expect(emissiveOf(instancer, 0)).toEqual([0, 0, 0]);
  });

  it('draws nothing for a drive that is hidden, or whose room is', () => {
    const { instancer, drives, room } = world(2);
    drives[0].object3d.visible = false;
    instancer.update();
    expect(new THREE.Vector3().setFromMatrixScale(matrixOf(instancer.body, 0)).length()).toBe(0);
    room.visible = false;
    instancer.update();
    expect(new THREE.Vector3().setFromMatrixScale(matrixOf(instancer.body, 1)).length()).toBe(0);
  });

  it('leaves out a drive in another scene, or not in one', () => {
    const { instancer, drives } = world(2);
    drives[1].object3d.removeFromParent();
    instancer.update();
    expect(instancer.body.count).toBe(1);
    expect(drives[1]._mesh.visible).toBe(true);
  });

  it('grows past its first size', () => {
    const { root } = world(0);
    const many = Array.from({ length: 70 }, (_, i) => {
      const d = new Drive(`M${i}`);
      made.push(d);
      root.add(d.object3d);
      return d;
    });
    const instancer = new DriveInstancer({ root, drives: () => many, capacity: 8 });
    root.updateMatrixWorld(true);
    instancer.update();
    expect(instancer.body.count).toBe(70);
    expect(instancer.body.parent).toBe(root);
    expect(root.children.filter(c => c.isInstancedMesh)).toHaveLength(2);
  });

  it('wears what the drives wear: their casing material, fog setting and all', () => {
    const { instancer, drives } = world(1);
    const skin = new THREE.Texture();
    drives[0]._applySkin(skin);
    drives[0]._bodyMaterial.fog = false;
    drives[0]._bodyMaterial.needsUpdate = true;
    instancer.update();
    expect(instancer.body.material.map).toBe(skin);
    expect(instancer.body.material.fog).toBe(false);
  });

  it('dispose gives the drives their meshes back and frees what it made', () => {
    const { instancer, drives, root } = world(2);
    instancer.update();
    instancer.dispose();
    expect(drives.every(d => d._mesh.visible && d._led.visible)).toBe(true);
    expect(root.children.filter(c => c.isInstancedMesh)).toHaveLength(0);
  });
});

describe('Drive.live', () => {
  it('holds every drive until it is disposed', () => {
    const drive = new Drive('Live');
    expect(Drive.live.has(drive)).toBe(true);
    drive.dispose();
    expect(Drive.live.has(drive)).toBe(false);
  });
});

describe('the LED shader', () => {
  it("takes its glow from the instance, patched into three's own standard shader", () => {
    const { instancer } = world(1);
    instancer.update();
    const shader = {
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
      uniforms: {},
    };
    instancer.led.material.onBeforeCompile(shader);
    expect(shader.vertexShader).toContain('vEmissive = aEmissive;');
    expect(shader.fragmentShader).toContain('vec3 totalEmissiveRadiance = vEmissive;');
    expect(shader.fragmentShader).not.toContain('vec3 totalEmissiveRadiance = emissive;');
  });
});
