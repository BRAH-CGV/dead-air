// ─────────────────────────────────────────────
// PowerGrid  –  the base's lights, on one switch at the generator
// ─────────────────────────────────────────────
// Every lamp in the base runs off the generator outside. The grid remembers
// what each one was built at and rewrites it every frame from one level:
//
//   const grid = new PowerGrid();
//   grid.collect(room.root.object3d);   // every light + glowing fitting under it
//   grid.collect(dishPad, { breakable: false });
//   grid.addConsumer(ledStrip);         // things that drive their own glow
//   grid.setOn(false);                  // the generator's switch
//   grid.breakLights();                 // the UFO's surge: bulbs gone for the night
//   grid.surge = 0.8;                   // overdrive + flicker as it closes in
//   grid.update(dt);                    // once a frame
//
// Two separate things can be wrong with the power:
//   on      the generator's switch. Off kills every lamp AND the vital
//           functions (the computer terminal) — `on` is what they read.
//   broken  the bulbs. Broken lamps stay dark with the power on; only
//           repair() brings them back.
//   tripped the breakers, thrown by the same surge. While tripped the switch
//           does nothing: resetBreakers() (the breaker-panel minigame at the
//           generator) has to come first. Cutting the power by hand never
//           trips them. Unbreakable lamps — the dish pad's
//           floods, the desk screen's glow (`userData.unbreakable`, or
//           collect(…, { breakable: false })) — only care about the switch.
// `lit` is the two together: are the base's ordinary lamps shining.
//
// Lights are never hidden, only zeroed — hiding one changes the light count
// every lit shader was compiled for (AGENTS.md, performance). A subtree whose
// object3d carries `userData.offGrid` is skipped by collect(): the airlock's
// beacon runs off its own battery so the interlock can never strand anyone,
// and components that animate their own glow (LEDStrip, SignalAlertLight)
// are added as consumers instead, so the two never fight over a material.
// ─────────────────────────────────────────────

/** How far past normal brightness a full surge drives the lamps. */
const SURGE_GAIN = 3.5;
/** Level a lamp drops to when the surge makes it gutter. */
const DROPOUT_LEVEL = 0.1;
/** Seconds each flicker state holds, min and max. */
const FLICKER_MIN = 0.03;
const FLICKER_MAX = 0.14;

export class PowerGrid {
  /** The generator's switch. Read by the vital functions. */
  on = true;
  /** The bulbs blew. Breakable lamps stay dark whatever the switch says. */
  broken = false;
  /** The UFO's surge threw the breakers: setOn(true) is refused until
   *  resetBreakers(). */
  tripped = false;
  /** 0..1 — how hard the UFO's field is pushing current through the lamps. */
  surge = 0;
  /** The level last written to the breakable lamps. */
  level = 1;

  /** @type {{ light: import('three').Light, base: number, breakable: boolean }[]} */
  _lights = [];
  /** @type {{ material: import('three').Material, base: number|import('three').Color, breakable: boolean }[]} */
  _materials = [];
  /** @type {{ powerLevel: number }[]} */
  _consumers = [];
  _known = new Set();
  _listeners = new Set();

  _flickerTimer = 0;
  _flicker = 1;

  /**
   * @param {object} [opts]
   * @param {() => number} [opts.random=Math.random]  Dice for the flicker.
   */
  constructor({ random = Math.random } = {}) {
    this.random = random;
  }

  /** Are the base's ordinary (breakable) lamps shining? */
  get lit() { return this.on && !this.broken; }

  /** @param {import('three').Light} light  @param {{ breakable?: boolean }} [opts] */
  addLight(light, { breakable = true } = {}) {
    if (this._known.has(light)) return;
    this._known.add(light);
    this._lights.push({ light, base: light.intensity, breakable });
  }

  /** A glowing material: its emissiveIntensity, or for an unlit (Basic)
   *  material its colour, follows the level. */
  addMaterial(material, { breakable = true } = {}) {
    if (this._known.has(material)) return;
    this._known.add(material);
    const base = material.isMeshBasicMaterial ? material.color.clone() : material.emissiveIntensity;
    this._materials.push({ material, base, breakable });
  }

  /** Anything with a `powerLevel` it scales its own brightness by. Consumers
   *  are breakable: they go dark with the bulbs. */
  addConsumer(consumer) {
    if (this._known.has(consumer)) return;
    this._known.add(consumer);
    this._consumers.push(consumer);
  }

  /** Every light and glowing material under `root`, skipping `offGrid`
   *  subtrees. A subtree with `userData.unbreakable` (or the whole root, with
   *  `breakable: false`) survives a blow-out.
   *  @param {import('three').Object3D} root  @param {{ breakable?: boolean }} [opts] */
  collect(root, { breakable = true } = {}) {
    const visit = (o, canBreak) => {
      if (o.userData?.offGrid) return;
      if (o.userData?.unbreakable) canBreak = false;
      const opts = { breakable: canBreak };
      if (o.isLight && !o.isAmbientLight) this.addLight(o, opts);
      const materials = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of materials) {
        if (m.isMeshBasicMaterial || (m.emissive && m.emissiveIntensity > 0 && m.emissive.getHex() !== 0)) {
          this.addMaterial(m, opts);
        }
      }
      for (const child of o.children) visit(child, canBreak);
    };
    visit(root, breakable);
  }

  /** The generator's switch. Turning it on does nothing while the breakers
   *  are tripped. */
  setOn(on) {
    if (this.on === on) return;
    if (on && this.tripped) return;
    this.on = on;
    this._emit();
  }

  /** Blow every breakable bulb on the grid, throw the breakers and trip
   *  the generator. */
  breakLights() {
    if (this.broken && this.tripped && !this.on) return;
    this.broken = true;
    this.tripped = true;
    this.on = false;
    this._emit();
  }

  /** The breakers are back in: the switch works again. The bulbs stay blown. */
  resetBreakers() {
    if (!this.tripped) return;
    this.tripped = false;
    this._emit();
  }

  /** New bulbs and breakers (a new night, or a retry). The switch is left
   *  as it is. */
  repair() {
    if (!this.broken && !this.tripped) return;
    this.broken = false;
    this.tripped = false;
    this._emit();
  }

  /** @param {(grid: PowerGrid) => void} fn  @returns {() => void} unsubscribe */
  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /** Write the levels to everything. Allocates nothing. */
  update(dt) {
    const powered = this.on ? this._surgeLevel(dt) : 0;
    const level = this.broken ? 0 : powered;
    this.level = level;
    for (const { light, base, breakable } of this._lights) {
      light.intensity = base * (breakable ? level : powered);
    }
    for (const { material, base, breakable } of this._materials) {
      const l = breakable ? level : powered;
      if (material.isMeshBasicMaterial) material.color.copy(base).multiplyScalar(Math.min(l, 1));
      else material.emissiveIntensity = base * l;
    }
    for (const consumer of this._consumers) consumer.powerLevel = level;
  }

  /** 1 at rest; under a surge, held flicker states — mostly flaring well
   *  past normal, sometimes guttering out — rerolled every few frames. */
  _surgeLevel(dt) {
    const surge = this.surge;
    if (surge <= 0) {
      this._flickerTimer = 0;
      this._flicker = 1;
      return 1;
    }
    this._flickerTimer -= dt;
    if (this._flickerTimer <= 0) {
      this._flickerTimer = FLICKER_MIN + this.random() * (FLICKER_MAX - FLICKER_MIN) * (1.2 - surge);
      const roll = this.random();
      this._flicker = roll < 0.3 * surge
        ? DROPOUT_LEVEL
        : 1 + surge * (SURGE_GAIN - 1) * (0.6 + 0.4 * roll);
    }
    return this._flicker;
  }

  _emit() {
    for (const fn of this._listeners) fn(this);
  }
}
