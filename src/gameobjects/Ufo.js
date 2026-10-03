import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';

// ─────────────────────────────────────────────
// Ufo  –  the saucer, its searchlight and the beam you can see
// ─────────────────────────────────────────────
// Built once with the scene, hidden, and flown about by UfoThreat:
//
//   const ufo = new Ufo({ model: assets.instantiate('model:ufo') });
//   ufo.setPose(position);       // the beam always reaches the ground below
//   ufo.setVisible(true);
//   ufo.setBeam(1, 1.5);         // level, and the beam's radius on the ground:
//   ufo.setBeam(1, 32);          //   a thin shaft, or the whole facility
//   ufo.tick(dt);                // spin, bob, beam animation, teleport flash
//   ufo.teleport();              // a flash where it was
//
//   object3d
//   ├─ body         the model, spinning and bobbing — shown and hidden
//   ├─ beamMesh     open cone down to the ground, additive ShaderMaterial
//   ├─ searchlight  SpotLight pointing straight down — never hidden, zeroed
//   └─ flash        additive sphere for the teleport, shown for a moment
//
// The searchlight casts shadows. From overhead its cone covers the whole
// base, and a light without a shadow map shines through roofs: the shadow
// map is what keeps the office dark under it, so the only way its light gets
// in is the scene's window flood (BaseScene). The ShadowScheduler redraws the
// map when the light moves; a change of cone (setBeam) redraws it here. Only
// the body bobs and spins, so a hovering UFO costs no shadow redraws.
//
// The light is never hidden: the number of lights is compiled into every lit
// shader, so hiding it would recompile the scene (AGENTS.md). It sits at
// intensity 0 while the beam is off.
//
// The beam shader (BEAM_*_SHADER) builds the cone from a unit cylinder — its
// length (uLength) and the radii at the hull and on the ground are uniforms,
// so one geometry serves a thin shaft from a hundred metres up and a flood
// over the whole base — and fakes a volume of lit dust: brightest at the
// hull, soft at its silhouette, with bands of dust drifting down it.
// ─────────────────────────────────────────────

/** Candela with the beam fully on. decay 1: still blinding from 35 m up. */
const SEARCHLIGHT_INTENSITY = 2600;
const BEAM_COLOR = 0xdcefff;
const BEAM_TOP_RADIUS = 0.9;
/** The cone is drawn this much wider than the beam's radius on the ground,
 *  so the edge of the light is the penumbra, not a hard ring. */
const CONE_MARGIN = 1.15;
const SPIN_RATE = 0.6;   // rad/s
const BOB = { height: 0.3, rate: 1.4 };
const FLASH_SECONDS = 0.35;
/** Boxes the beam shader can cut out — one per room and corridor. */
const MAX_CUTOUTS = 8;
/** The beacon's on-screen size (sprite scale with sizeAttenuation off). */
const BEACON_SIZE = 0.11;

const BEAM_VERTEX_SHADER = /* glsl */ `
  uniform float uLength;
  uniform float uTopRadius;
  uniform float uBottomRadius;
  varying float vHeight;   // 0 at the ground, 1 at the hull
  varying float vFacing;   // 1 facing the camera, 0 edge-on
  varying float vAngle;
  varying vec3  vWorld;    // for the building cutouts

  void main() {
    // The geometry is a unit cylinder hanging from y = 0 to y = -1.
    vHeight = 1.0 + position.y;
    float r = mix(uBottomRadius, uTopRadius, vHeight);
    vec3 p = vec3(position.x * r, position.y * uLength, position.z * r);
    vAngle = atan(position.x, position.z);
    vWorld = (modelMatrix * vec4(p, 1.0)).xyz;

    vec4 viewPos = modelViewMatrix * vec4(p, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    vFacing = abs(dot(n, normalize(-viewPos.xyz)));
    gl_Position = projectionMatrix * viewPos;
  }
`;

const BEAM_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3  uColor;
  uniform vec3  uCutoutMin[${MAX_CUTOUTS}];
  uniform vec3  uCutoutMax[${MAX_CUTOUTS}];
  uniform int   uCutoutCount;
  varying float vHeight;
  varying float vFacing;
  varying float vAngle;
  varying vec3  vWorld;

  void main() {
    // Nothing of the beam inside the building: it stops on the roof, and
    // never shows in a room. Each cutout is a room's or a corridor's box.
    for (int i = 0; i < ${MAX_CUTOUTS}; i++) {
      if (i >= uCutoutCount) break;
      if (all(greaterThan(vWorld, uCutoutMin[i])) && all(lessThan(vWorld, uCutoutMax[i]))) discard;
    }

    // Brightest at the hull, thinning out toward the ground.
    float fall = mix(0.25, 1.0, vHeight * vHeight);
    // Soft silhouette: the edges of the cone are seen through less dust.
    float edge = smoothstep(0.0, 0.6, vFacing);
    // Dust bands drifting down the beam, a little different round it.
    float bands = 0.75 + 0.25 * sin(vHeight * 28.0 + uTime * 6.0 + sin(vAngle * 3.0 + uTime) * 1.5);
    // Flutter, as if the source were unstable.
    float flutter = 0.9 + 0.1 * sin(uTime * 37.0);
    float a = uIntensity * fall * edge * bands * flutter * 0.35;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

export class Ufo extends GameObject {
  _owned = [];
  _flashLeft = 0;
  _beam = 0;
  _radius = 1;
  _visible = false;
  _time = 0;

  /**
   * @param {object} [opts]
   * @param {THREE.Object3D} [opts.model]  From the asset cache; a plain disc
   *        stands in without one (tests).
   * @param {string} [name='Ufo']
   */
  constructor({ model = null } = {}, name = 'Ufo') {
    super(name);

    this.body = new THREE.Group();
    this.body.name = 'UfoBody';
    this.body.add(model ?? this._standIn());
    this.body.visible = false;
    this.object3d.add(this.body);
    this._buildBeacon();

    this._buildBeam();
    this._buildSearchlight();
    this._buildFlash();
    this.setPose(new THREE.Vector3(0, 35, 0));
  }

  /** Move it. The beam and the searchlight always reach the ground below. */
  setPose(position) {
    this.object3d.position.copy(position);
    const altitude = Math.max(position.y, 1);
    this.beamMesh.material.uniforms.uLength.value = altitude;
    this.searchlight.target.position.set(0, -altitude, 0);
    this.searchlight.distance = altitude * 1.8 + 10;
    this._aim();
  }

  setVisible(visible) {
    this._visible = visible;
    this.body.visible = visible;
    this.beamMesh.visible = visible && this._beam > 0;
  }

  /** @param {number} level   0..1 — searchlight and visible beam together.
   *  @param {number} [radius] Metres the beam covers on the ground. */
  setBeam(level, radius = this._radius) {
    this._beam = level;
    this.searchlight.intensity = SEARCHLIGHT_INTENSITY * level;
    // A wide beam is the same light spread thin: the dust reads fainter.
    const spread = Math.min(1, radius / 20);
    this.beamMesh.material.uniforms.uIntensity.value = level * (1 - 0.6 * spread);
    this.beamMesh.visible = this._visible && level > 0;
    if (radius !== this._radius) {
      this._radius = radius;
      this.beamMesh.material.uniforms.uBottomRadius.value = radius;
      this._aim();
    }
  }

  /** World boxes the visible beam is cut out of — the building, so the
   *  beam ends on its roofs instead of running down through the rooms.
   *  @param {THREE.Box3[]} boxes  At most MAX_CUTOUTS are used. */
  setCutouts(boxes) {
    const u = this.beamMesh.material.uniforms;
    const n = Math.min(boxes.length, MAX_CUTOUTS);
    for (let i = 0; i < n; i++) {
      u.uCutoutMin.value[i].copy(boxes[i].min);
      u.uCutoutMax.value[i].copy(boxes[i].max);
    }
    u.uCutoutCount.value = n;
  }

  /** A burst of light where it was — the teleport. */
  teleport() {
    this._flashLeft = FLASH_SECONDS;
    this.flash.scale.setScalar(1);
    this.flash.material.opacity = 1;
    this.flash.visible = true;
  }

  tick(dt) {
    this._time += dt;
    this.beamMesh.material.uniforms.uTime.value += dt;
    if (this._visible) {
      this.body.rotation.y += SPIN_RATE * dt;
      this.body.position.y = Math.sin(this._time * BOB.rate) * BOB.height;
    }

    if (this._flashLeft > 0) {
      this._flashLeft = Math.max(0, this._flashLeft - dt);
      const k = 1 - this._flashLeft / FLASH_SECONDS;   // 0 → 1
      this.flash.scale.setScalar(1 + k * 8);
      this.flash.material.opacity = 1 - k;
      if (this._flashLeft === 0) this.flash.visible = false;
    }
  }

  /** Free what this built. The model belongs to the asset cache. */
  dispose() {
    for (const resource of this._owned) resource.dispose();
    this._owned.length = 0;
    this.searchlight.shadow.dispose();
  }

  // ── Building ────────────────────────────

  /** Fit the spotlight's cone to the beam's ground radius from this height.
   *  A new cone is a new shadow camera: redraw its map. */
  _aim() {
    const altitude = this.beamMesh.material.uniforms.uLength.value;
    const angle = Math.min(Math.atan(this._radius / altitude) * CONE_MARGIN, 1.3);
    if (angle !== this.searchlight.angle) {
      this.searchlight.angle = angle;
      this.searchlight.shadow.needsUpdate = true;
    }
  }

  _own(resource) {
    this._owned.push(resource);
    return resource;
  }

  _buildBeam() {
    const geometry = this._own(new THREE.CylinderGeometry(1, 1, 1, 48, 1, true));
    geometry.translate(0, -0.5, 0);   // hang from the hull: y 0 … -1
    const material = this._own(new THREE.ShaderMaterial({
      uniforms: {
        uTime:         { value: 0 },
        uIntensity:    { value: 0 },
        uLength:       { value: 35 },
        uTopRadius:    { value: BEAM_TOP_RADIUS },
        uBottomRadius: { value: this._radius },
        uColor:        { value: new THREE.Color(BEAM_COLOR) },
        uCutoutMin:    { value: Array.from({ length: MAX_CUTOUTS }, () => new THREE.Vector3()) },
        uCutoutMax:    { value: Array.from({ length: MAX_CUTOUTS }, () => new THREE.Vector3()) },
        uCutoutCount:  { value: 0 },
      },
      vertexShader: BEAM_VERTEX_SHADER,
      fragmentShader: BEAM_FRAGMENT_SHADER,
      transparent: true,
      premultipliedAlpha: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }));
    this.beamMesh = new THREE.Mesh(geometry, material);
    this.beamMesh.name = 'UfoBeam';
    // The shader sizes it; the geometry's own bounds mean nothing.
    this.beamMesh.frustumCulled = false;
    this.beamMesh.castShadow = this.beamMesh.receiveShadow = false;
    this.beamMesh.visible = false;
    this.object3d.add(this.beamMesh);
  }

  _buildSearchlight() {
    const light = new THREE.SpotLight(BEAM_COLOR, 0, 80, 0.05, 0.35, 1);
    light.name = 'UfoSearchlight';
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    // Depth bias is in the shadow camera's non-linear depth, so its size in
    // metres grows with distance² / near. With near = 1, -0.0005 was ~0.5 m
    // at the roofs' 31 m: more than a 0.2 m ceiling slab, and the tops of the
    // walls under it lit up as if the light came through the roof. Nothing
    // it shadows is within 10 m of the hull; out there -0.0001 is ~1 cm, and
    // the normal bias keeps the roofs free of acne.
    light.shadow.camera.near = 10;
    light.shadow.bias = -0.0001;
    light.shadow.normalBias = 0.05;
    light.position.set(0, -0.8, 0);
    this.object3d.add(light, light.target);
    this.searchlight = light;
  }

  /** The light under the hull — what you actually see of it from the far
   *  side of the valley, where the haze eats a dark saucer against a dark
   *  sky. A sprite with sizeAttenuation off holds the same size on screen at
   *  any distance, and fog off keeps it bright through the haze. It still
   *  depth-tests, so the roof hides it once it is overhead. */
  _buildBeacon() {
    const size = 64;
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const r = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
        const a = Math.max(0, 1 - r);
        const i = (y * size + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 255;
        data[i + 3] = Math.round(255 * a * a * a);   // a hot core, soft halo
      }
    }
    const texture = this._own(new THREE.DataTexture(data, size, size));
    texture.needsUpdate = true;
    this.beacon = new THREE.Sprite(this._own(new THREE.SpriteMaterial({
      map: texture,
      color: 0xd8ecff,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      sizeAttenuation: false,
    })));
    this.beacon.name = 'UfoBeacon';
    this.beacon.scale.setScalar(BEACON_SIZE);
    this.beacon.position.y = -1.4;
    this.body.add(this.beacon);
  }

  _buildFlash() {
    this.flash = new THREE.Mesh(
      this._own(new THREE.SphereGeometry(1.5, 16, 12)),
      this._own(new THREE.MeshBasicMaterial({
        color: 0xe8f4ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      })),
    );
    this.flash.name = 'UfoTeleportFlash';
    this.flash.visible = false;
    // On the UFO's own origin: once it has gone, nothing moves it, so the
    // flash blooms exactly where it vanished.
    this.object3d.add(this.flash);
  }

  _standIn() {
    const mesh = new THREE.Mesh(
      this._own(new THREE.CylinderGeometry(4, 5, 1.2, 24)),
      this._own(new THREE.MeshStandardMaterial({ color: 0x8a9099, metalness: 0.8, roughness: 0.35 })),
    );
    mesh.name = 'UfoStandIn';
    return mesh;
  }
}
