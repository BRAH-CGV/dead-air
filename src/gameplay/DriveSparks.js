import * as THREE from 'three';

// ─────────────────────────────────────────────
// DriveSparks  –  sparks flying from the corrupted drive
// ─────────────────────────────────────────────
// A CPU-managed particle pool rendered as THREE.Points. The emission rate
// scales with doomFraction (0 at infection → 1 at expiry), so sparks go
// from a gentle trickle to a dense spray as the silence timer runs out.
// Each drive hop triggers an extra burst on top of the continuous emission.
//
// EvilSignal owns the lifecycle: it creates the sparks when a drive is
// infected, ticks them each frame, and disposes them when the drive is
// wiped or the night resets. The Points object is added directly to the
// scene root (not the GameObject hierarchy) since it needs no physics.
//
//   const sparks = new DriveSparks();
//   scene.object3d.add(sparks.points);
//   sparks.tick(dt, drive, doomFraction);   // each frame
//   sparks.burst(20);                       // on each hop
//   sparks.dispose();                       // when done
// ─────────────────────────────────────────────

/** Tuning. Metres and seconds unless stated. */
export const SPARKS = {
  /** Maximum live particles at any time. */
  count: 200,
  /** Warm orange-red. */
  color: 0xff7722,
  /** Point size in pixels at 1 m distance. */
  size: 20,
  /** Largest a spark is ever drawn, in pixels. */
  maxSize: 10,
  /** Downward acceleration, m/s². */
  gravity: 6,
  /** Per-frame velocity multiplier (0 = full stop, 1 = no drag). */
  drag: 0.97,
  /** Initial speed range, m/s [min, max]. */
  speed: [1.5, 3.5],
  /** Particle lifetime range, seconds [min, max]. */
  life: [0.4, 1.2],
  /** Sparks per second at doomFraction 1 (after the delay). */
  peakRate: 80,
  /** Burst size range on each drive hop [min, max]. */
  burstCount: [15, 25],
  /** Seconds before continuous emission starts (the first few hops only
   *  produce bursts). */
  delaySeconds: 3,
};

const VERT = /* glsl */ `
  attribute float aLife;     // remaining life (0 = dead, off-screen)
  attribute float aMaxLife;  // total lifetime (for fade calculation)
  uniform float uSize;
  uniform float uMaxSize;
  varying float vAlpha;

  void main() {
    // Dead particles are pushed off-screen.
    if (aLife <= 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      vAlpha = 0.0;
      return;
    }
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float dist = max(-mv.z, 0.05);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(uSize / dist, uMaxSize);
    // Fade out in the last 30 % of life.
    vAlpha = smoothstep(0.0, 0.3, aLife / aMaxLife);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float soft = 1.0 - smoothstep(0.3, 1.0, d);
    float alpha = soft * vAlpha;
    if (alpha <= 0.002) discard;
    gl_FragColor = vec4(uColor * (0.6 + 0.4 * vAlpha), alpha);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Reusable vector for world-position reads. */
const _pos = new THREE.Vector3();

export class DriveSparks {
  /** The particle pool. */
  _pool;
  /** THREE.Points object (read-only via getter). */
  _points;
  /** Geometry and material (for dispose). */
  _geometry;
  _material;
  /** Fractional spark accumulator between ticks. */
  _carry = 0;
  /** Seconds since the first tick — continuous emission is delayed. */
  _elapsed = 0;
  /** Drive reference for position tracking. */
  _drive = null;

  constructor() {
    const n = SPARKS.count;
    this._pool = Array.from({ length: n }, () => ({
      pos: new THREE.Vector3(0, -1000, 0),
      vel: new THREE.Vector3(),
      life: 0,
      maxLife: 1,
    }));

    const positions = new Float32Array(n * 3);
    const lifes = new Float32Array(n);
    const maxLifes = new Float32Array(n);
    // Initialise all dead.
    for (let i = 0; i < n; i++) {
      positions[i * 3 + 1] = -1000;
      lifes[i] = 0;
      maxLifes[i] = 1;
    }

    this._geometry = new THREE.BufferGeometry();
    this._geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this._geometry.setAttribute('aLife', new THREE.BufferAttribute(lifes, 1));
    this._geometry.setAttribute('aMaxLife', new THREE.BufferAttribute(maxLifes, 1));

    this._material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(SPARKS.color) },
        uSize: { value: SPARKS.size },
        uMaxSize: { value: SPARKS.maxSize },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this._points = new THREE.Points(this._geometry, this._material);
    this._points.name = 'DriveSparks';
    this._points.frustumCulled = false;
  }

  /** The THREE.Points — add/remove from the scene. */
  get points() { return this._points; }

  /**
   * Advance the simulation: emit new sparks, update existing ones.
   * @param {number} dt  Seconds since last frame.
   * @param {object} drive  The corrupted Drive (has rigidBody / object3d).
   * @param {number} doomFraction  0..1 — how close to expiry.
   */
  tick(dt, drive, doomFraction) {
    this._drive = drive;
    const origin = this._getDrivePosition(drive);
    if (!origin) return;

    // Continuous emission: only after the delay, with an exponential ramp
    // so the sparks stay sparse for most of the countdown then spike.
    this._elapsed += dt;
    if (this._elapsed >= SPARKS.delaySeconds) {
      const ramp = Math.pow(doomFraction, 3);
      const rate = ramp * SPARKS.peakRate;
      this._carry += rate * dt;
      const toEmit = Math.floor(this._carry);
      this._carry -= toEmit;
      for (let i = 0; i < toEmit; i++) {
        this._emitOne(origin);
      }
    }

    // Advance all live particles.
    const posAttr = this._geometry.getAttribute('position');
    const lifeAttr = this._geometry.getAttribute('aLife');
    for (let i = 0; i < this._pool.length; i++) {
      const p = this._pool[i];
      if (p.life <= 0) continue;

      p.life -= dt;
      if (p.life <= 0) {
        // Kill: move off-screen.
        p.pos.set(0, -1000, 0);
        lifeAttr.array[i] = 0;
        posAttr.array[i * 3] = 0;
        posAttr.array[i * 3 + 1] = -1000;
        posAttr.array[i * 3 + 2] = 0;
        continue;
      }

      // Gravity.
      p.vel.y -= SPARKS.gravity * dt;
      // Drag.
      p.vel.x *= SPARKS.drag;
      p.vel.y *= SPARKS.drag;
      p.vel.z *= SPARKS.drag;
      // Integrate.
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
      p.pos.z += p.vel.z * dt;

      // Upload.
      posAttr.array[i * 3] = p.pos.x;
      posAttr.array[i * 3 + 1] = p.pos.y;
      posAttr.array[i * 3 + 2] = p.pos.z;
      lifeAttr.array[i] = p.life;
    }

    posAttr.needsUpdate = true;
    lifeAttr.needsUpdate = true;
  }

  /**
   * Emit a burst of sparks immediately (called on each drive hop).
   * @param {number} count  How many sparks to emit.
   */
  burst(count) {
    const origin = this._getDrivePosition(this._drive);
    if (!origin) return;
    for (let i = 0; i < count; i++) {
      this._emitOne(origin);
    }
  }

  /** Free geometry and material. */
  dispose() {
    this._geometry.dispose();
    this._material.dispose();
  }

  // ── Private ──────────────────────────────

  /** Find a dead particle in the pool and bring it to life at `origin`. */
  _emitOne(origin) {
    for (const p of this._pool) {
      if (p.life > 0) continue;
      // Respawn at the drive.
      p.pos.copy(origin);
      // Random direction, random speed.
      const speed = SPARKS.speed[0] + Math.random() * (SPARKS.speed[1] - SPARKS.speed[0]);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;  // full sphere
      p.vel.set(
        Math.sin(phi) * Math.cos(theta) * speed,
        Math.cos(phi) * speed + 1,  // slight upward bias
        Math.sin(phi) * Math.sin(theta) * speed,
      );
      p.maxLife = SPARKS.life[0] + Math.random() * (SPARKS.life[1] - SPARKS.life[0]);
      p.life = p.maxLife;
      return;
    }
    // Pool full — silently drop.
  }

  /** Read the drive's world position from the physics body or the Object3D. */
  _getDrivePosition(drive) {
    if (!drive) return null;
    if (drive.rigidBody) {
      const t = drive.rigidBody.translation();
      _pos.set(t.x, t.y, t.z);
      return _pos;
    }
    if (drive.object3d) {
      drive.object3d.getWorldPosition(_pos);
      return _pos;
    }
    return null;
  }
}
