import * as THREE from 'three';

// ─────────────────────────────────────────────
// Fullbright  –  kill the lights, keep the art
// ─────────────────────────────────────────────
// A debug lighting mode, the mappers' "mat_fullbright 1": every surface shown
// at its raw albedo brightness with no shading at all. Useful for checking
// geometry, texture placement and collider overlays in dark corners the level's
// lighting never reaches.
//
// It has to touch three separate things, because "dark" comes from three
// separate places:
//
//   • Lights — every light in the scene graph is hidden (visible = false).
//     Hiding, not removing: restore is a flag flip, and the light keeps its
//     place in the scene for when the mode is switched off.
//   • Fog — exponential distance fog dims distant geometry; it gets nulled
//     out and restored verbatim.
//   • Tone mapping — ACES filmic crushes brights; NoToneMapping while active.
//
// And one thing hiding lights can't fix: a lit material still renders its
// *response* to light — with no light at all, MeshStandardMaterial surfaces
// come out pitch black, not "full bright". So each lit material on each mesh
// is swapped for an unlit MeshBasicMaterial twin that carries the same map and
// colour. Twins are cached per original material, so a texture shared by
// twenty crates gets one twin, and they're all disposed the moment the mode is
// switched off — memory stays flat, and the asset-cache ownership rule is
// respected (the originals are never disposed by us; we only put them back).
//
// Meshes spawned while the mode is active aren't swapped automatically — call
// refresh() after spawning (Engine.spawnModel does).
// ─────────────────────────────────────────────

/** Lit material types whose response to light is what makes them go dark.
 *  Unlit ones (Basic, Shader, Line, Points, Sprite) are left alone. */
function isLit(material) {
  return !!material && (
    material.isMeshStandardMaterial ||
    material.isMeshPhysicalMaterial ||
    material.isMeshPhongMaterial   ||
    material.isMeshLambertMaterial
  );
}

export class Fullbright {
  /** @type {THREE.Scene} */
  scene;
  /** @type {THREE.WebGLRenderer|null} tone mapping only; null in tests */
  renderer;

  active = false;

  /** @type {Map<THREE.Mesh, THREE.Material|THREE.Material[]>} mesh → original */
  _swapped = new Map();
  /** @type {Map<THREE.Material, THREE.MeshBasicMaterial>} original → twin */
  _twins = new Map();
  /** @type {[THREE.Light, boolean][]} light → visible-before */
  _lights = [];
  /** @type {THREE.FogBase|null} */
  _fog = null;
  /** @type {number} */
  _toneMapping = THREE.NoToneMapping;

  /**
   * @param {THREE.Scene} scene
   * @param {THREE.WebGLRenderer|null} [renderer]
   */
  constructor(scene, renderer = null) {
    this.scene    = scene;
    this.renderer = renderer;
  }

  toggle() {
    this.active ? this.disable() : this.enable();
  }

  enable() {
    if (this.active) return;
    this.active = true;

    // Hide every light, remembering which ones were already off (a switched-
    // off flashlight must not come back on when we restore).
    this._lights = [];
    this.scene.traverse((obj) => {
      if (obj.isLight) this._lights.push([obj, obj.visible]);
    });

    for (const [light] of this._lights) light.visible = false;

    this._fog    = this.scene.fog;
    this.scene.fog = null;

    if (this.renderer) {
      this._toneMapping = this.renderer.toneMapping;
      this.renderer.toneMapping = THREE.NoToneMapping;
    }

    this._swapMaterials();
  }

  disable() {
    if (!this.active) return;
    this.active = false;

    for (const [mesh, original] of this._swapped) mesh.material = original;
    this._swapped.clear();

    // Twins are shared across meshes, so they can only die once every mesh is
    // back on its original — restoring first, disposing second, is the whole
    // trick to keeping this safe.
    for (const twin of this._twins.values()) twin.dispose();
    this._twins.clear();

    for (const [light, wasVisible] of this._lights) light.visible = wasVisible;
    this._lights = [];

    this.scene.fog = this._fog;
    this._fog = null;

    if (this.renderer) this.renderer.toneMapping = this._toneMapping;
  }

  /** Re-apply the material swap — picks up meshes spawned since enable().
   *  Idempotent: already-swapped meshes sit on unlit twins, which isLit()
   *  ignores, so only new arrivals move. */
  refresh() {
    if (this.active) this._swapMaterials();
  }

  /** Swap every lit material in the scene for its unlit twin. */
  _swapMaterials() {
    this.scene.traverse((obj) => {
      if (!obj.isMesh) return;
      const material = obj.material;
      if (Array.isArray(material)) {
        if (!material.some(isLit)) return;
        this._swapped.set(obj, material);
        obj.material = material.map((m) => this._twinFor(m));
      } else if (isLit(material)) {
        this._swapped.set(obj, material);
        obj.material = this._twinFor(material);
      }
    });
  }

  /** The unlit twin of [material] — one per original, so shared materials
   *  stay shared and the dispose in disable() runs exactly once per twin. */
  _twinFor(material) {
    if (!isLit(material)) return material;

    let twin = this._twins.get(material);
    if (!twin) {
      twin = new THREE.MeshBasicMaterial({
        map:         material.map ?? null,
        color:       material.color?.clone() ?? new THREE.Color(0xffffff),
        transparent: material.transparent ?? false,
        opacity:     material.opacity ?? 1,
        alphaTest:   material.alphaTest ?? 0,
        side:        material.side ?? THREE.FrontSide,
        vertexColors: material.vertexColors ?? false,
      });
      this._twins.set(material, twin);
    }
    return twin;
  }

  /** Engine teardown: restore whatever state we're holding, then free the
   *  twins (disable() already does both when the mode is on). */
  dispose() {
    if (this.active) this.disable();
  }
}
