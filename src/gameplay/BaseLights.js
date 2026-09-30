// ─────────────────────────────────────────────
// BaseLights  –  the one writer of the base's interior light levels
// ─────────────────────────────────────────────
// Rooms build their lights at full brightness and register them here. Every
// system that dims the base — the power (a cut), fatigue (a tired player's
// view), a threat — owns one named factor, and each light shows
//
//   base intensity × every factor multiplied together
//
// so two systems dimming at once compose instead of fighting over the same
// number, and every factor back at 1 puts the exact base value back.
//
// A registered Light has its `intensity` driven; a Mesh with an emissive
// material (a ceiling fixture, a lamp shade) has its material's
// `emissiveIntensity` driven, so the glowing panel dims with the light it
// stands for. A material shared by several meshes is counted once.
//
// Only this class writes interior intensities. Daylight owns the ambient
// light, the moon and the fog; LEDStrip owns the rack LEDs; the airlock's
// beacon runs on its own battery. None of those are registered.
// ─────────────────────────────────────────────

/** Below this overall level the base counts as dark (see `dark`). */
export const DARK_LEVEL = 0.25;

export class BaseLights {
  constructor() {
    /** @type {Map<object, number>} target → its index in the arrays below */
    this._index = new Map();
    this._targets = [];
    this._props = [];
    this._bases = [];
    /** @type {Record<string, number>} */
    this._factors = {};
    /** Every factor multiplied together: 1 is full brightness. */
    this.level = 1;
  }

  /**
   * Take over lights and glowing meshes. Each is set to its base × the
   * current level straight away, so a room built mid-cut comes up dimmed.
   * @param {Iterable<import('three').Object3D>} objects
   */
  register(objects) {
    for (const obj of objects) {
      if (obj?.isLight) this._add(obj, 'intensity');
      else if (obj?.material) {
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of materials) if (m.emissive) this._add(m, 'emissiveIntensity');
      }
    }
    return this;
  }

  _add(target, prop) {
    if (this._index.has(target)) return;
    this._index.set(target, this._targets.length);
    this._targets.push(target);
    this._props.push(prop);
    this._bases.push(target[prop]);
    target[prop] = target[prop] * this.level;
  }

  /** Is this light (or this mesh's material) driven here? */
  has(obj) {
    return this._index.has(obj?.isLight ? obj : obj?.material);
  }

  getFactor(key) {
    return this._factors[key] ?? 1;
  }

  /**
   * Set one system's dimming factor and relight everything. Never below 0.
   * @param {string} key  'power', 'fatigue', …
   * @param {number} value  1 is no dimming.
   */
  setFactor(key, value) {
    value = Math.max(0, value);
    if (this._factors[key] === value) return;
    this._factors[key] = value;
    let level = 1;
    for (const k in this._factors) level *= this._factors[k];
    this.level = level;
    this._apply();
  }

  /** Dark enough to hide in. */
  get dark() {
    return this.level < DARK_LEVEL;
  }

  _apply() {
    for (let i = 0; i < this._targets.length; i++) {
      this._targets[i][this._props[i]] = this._bases[i] * this.level;
    }
  }

  /** Put every base value back and let go of everything (teardown). */
  restore() {
    this.level = 1;
    this._apply();
    this._index.clear();
    this._targets.length = this._props.length = this._bases.length = 0;
    this._factors = {};
  }
}
