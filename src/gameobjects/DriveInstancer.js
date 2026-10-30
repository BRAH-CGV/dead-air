import * as THREE from 'three';
import { Drive } from './Drive.js';

// ─────────────────────────────────────────────
// DriveInstancer  –  every drive in two draw calls (#175)
// ─────────────────────────────────────────────
// A drive is two meshes, its casing and its LED, each with a material of
// its own: two draw calls a drive, 64 for the four boxes on the office
// shelf. Every casing is the same box in the same skin, and an LED differs
// only in what it glows, so this draws all the casings as one
// InstancedMesh and all the LEDs as another.
//
// The drives don't know. Each still builds, moves and colours its own
// meshes; once adopted, those are hidden (still marked as shadow casters:
// the shadow scheduler redraws a map when a casting mesh moves), and every
// frame, just before the main view is drawn (engine.beforeRender, after
// the world matrices are brought up to date), this copies each drive's
// casing and LED matrix into its instance and its LED's emissive colour
// times intensity into a per-instance attribute. The LED's shader takes
// its emissive from that attribute. Whatever sets a drive's LED today — a
// save, a level, the red signal's ramp and fade — shows as it did.
//
// A drive is drawn while it and every parent are visible and it is in this
// scene; otherwise its instance is scaled to nothing. The materials copy
// the drives' own whenever those change (the skin at _init, fog switched
// off for the rooms), so they draw the same.
// ─────────────────────────────────────────────

const _toRoot = new THREE.Matrix4();
const _matrix = new THREE.Matrix4();
const NOTHING = new THREE.Matrix4().makeScale(0, 0, 0);

/** The LED's emissive from the instance, in place of the material's. */
function emissivePerInstance(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aEmissive;\nvarying vec3 vEmissive;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEmissive = aEmissive;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vEmissive;')
      .replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = vEmissive;');
  };
  material.customProgramCacheKey = () => 'drive-led-instanced';
}

export class DriveInstancer {
  /** @type {THREE.InstancedMesh|null} Every casing. */
  body = null;
  /** @type {THREE.InstancedMesh|null} Every LED. */
  led = null;

  /**
   * @param {object} opts
   * @param {THREE.Object3D} opts.root  The meshes hang here; drives under the same scene are drawn
   * @param {() => Iterable<Drive>} [opts.drives]
   * @param {number} [opts.capacity]   Instances to start with; doubles as needed
   */
  constructor({ root, drives = () => Drive.live, capacity = 64 }) {
    this.root = root;
    this.drives = drives;
    this.capacity = capacity;
    this._adopted = new Set();
    this._template = null;
    this._bodyVersion = -1;
    this._ledVersion = -1;
  }

  /** Copy every drive into its instance. Matrices must be current. */
  update() {
    const top = topOf(this.root);
    let count = 0;
    for (const drive of this.drives()) {
      const shown = this._shown(drive, top);
      if (shown === null) continue;   // not in this scene
      if (!this._adopt(drive)) continue;
      if (count >= this.capacity) this._grow();
      this._write(count++, drive, shown);
    }
    if (!this.body) return;
    this.body.count = count;
    this.led.count = count;
    this.body.instanceMatrix.needsUpdate = true;
    this.led.instanceMatrix.needsUpdate = true;
    this.led.geometry.attributes.aEmissive.needsUpdate = true;
  }

  /** Hand the drives their own meshes back, and free what this made. */
  dispose() {
    for (const drive of this._adopted) {
      if (drive._mesh) drive._mesh.visible = true;
      if (drive._led) drive._led.visible = true;
    }
    this._adopted.clear();
    for (const mesh of [this.body, this.led]) {
      if (!mesh) continue;
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.dispose();
    }
    this.body = this.led = null;
  }

  // ── Per drive ─────────────────────────────

  /** True if it and every parent are visible, false if not, null if it
   *  isn't in this scene. Its own (hidden) meshes don't count. */
  _shown(drive, top) {
    let shown = true;
    let o = drive.object3d;
    for (; o.parent; o = o.parent) if (!o.visible) shown = false;
    return o === top ? shown : null;
  }

  /** Take a drive over: the first one is the template. False if it can't be
   *  drawn as an instance (another size). */
  _adopt(drive) {
    if (this._adopted.has(drive)) return true;
    if (!this._template) this._build(drive);
    const [w, h, d] = drive._size;
    const [tw, th, td] = this._template._size;
    if (w !== tw || h !== th || d !== td) return false;
    drive._mesh.visible = false;
    drive._led.visible = false;
    this._adopted.add(drive);
    return true;
  }

  _write(i, drive, shown) {
    if (!shown) {
      this.body.setMatrixAt(i, NOTHING);
      this.led.setMatrixAt(i, NOTHING);
    } else {
      _toRoot.copy(this.root.matrixWorld).invert();
      this.body.setMatrixAt(i, _matrix.multiplyMatrices(_toRoot, drive._mesh.matrixWorld));
      this.led.setMatrixAt(i, _matrix.multiplyMatrices(_toRoot, drive._led.matrixWorld));
    }
    const { emissive, emissiveIntensity } = drive._material;
    this.led.geometry.attributes.aEmissive.setXYZ(
      i, emissive.r * emissiveIntensity, emissive.g * emissiveIntensity, emissive.b * emissiveIntensity,
    );
    if (drive === this._template) this._syncMaterials();
  }

  // ── The two meshes ────────────────────────

  _build(template) {
    this._template = template;
    const body = template._mesh.geometry.clone();
    const led = template._led.geometry.clone();
    led.setAttribute('aEmissive', new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 3), 3));
    this.body = this._mesh(body, new THREE.MeshStandardMaterial(), template._mesh, 'DriveBodies');
    const ledMaterial = new THREE.MeshStandardMaterial();
    emissivePerInstance(ledMaterial);
    this.led = this._mesh(led, ledMaterial, template._led, 'DriveLEDs');
    this._syncMaterials();
  }

  _mesh(geometry, material, like, name) {
    const mesh = new THREE.InstancedMesh(geometry, material, this.capacity);
    mesh.name = name;
    mesh.count = 0;
    mesh.castShadow = like.castShadow;
    mesh.receiveShadow = like.receiveShadow;
    // Drives go anywhere: drawn whatever the bounds, the GPU drops what is off screen.
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.root.add(mesh);
    return mesh;
  }

  /** Twice the room, the instances so far kept. */
  _grow() {
    const capacity = this.capacity * 2;
    const swap = (old, geometry) => {
      const mesh = new THREE.InstancedMesh(geometry, old.material, capacity);
      mesh.name = old.name;
      mesh.castShadow = old.castShadow;
      mesh.receiveShadow = old.receiveShadow;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceMatrix.array.set(old.instanceMatrix.array);
      old.removeFromParent();
      old.dispose();
      this.root.add(mesh);
      return mesh;
    };
    const emissive = this.led.geometry.attributes.aEmissive;
    const grown = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    grown.array.set(emissive.array);
    this.led.geometry.setAttribute('aEmissive', grown);
    this.body = swap(this.body, this.body.geometry);
    this.led = swap(this.led, this.led.geometry);
    this.capacity = capacity;
  }

  /** Wear what the template drive wears, whenever that changes. */
  _syncMaterials() {
    const { _bodyMaterial: body, _material: led } = this._template;
    if (body.version !== this._bodyVersion) {
      this.body.material.copy(body);
      this.body.material.needsUpdate = true;
      this._bodyVersion = body.version;
    }
    if (led.version !== this._ledVersion) {
      this.led.material.copy(led);
      this.led.material.needsUpdate = true;
      this._ledVersion = led.version;
    }
  }
}

function topOf(object) {
  let o = object;
  while (o.parent) o = o.parent;
  return o;
}
