// ─────────────────────────────────────────────
// CoffeeHarvest  –  the night's coffee, from the bush to the grinder (#168)
// ─────────────────────────────────────────────
// The grow rack's plants are coffee bushes. Each night `ripePerNight` of
// them, picked at random, carry ripe beans; the rest are not ripe. So the
// bushes are the count of tonight's cups: a ripe bush is one cup still to
// come.
//
//   bush ──harvest()──▶ a pile of beans (carried, a CoffeeBeans)
//        ──load()──▶ hopper ──start() ([E])──▶ processSeconds a pile
//        ──▶ onBatch: a bag of ground coffee in the bay (carried to the
//        coffee machine)
//
// The processor takes piles in while it is idle or loaded, then grinds
// them all, one at a time, once started; nothing goes in while it grinds.
// The piles and bags are things in the world (CoffeeItems); this keeps only
// the rules. A new night (or a retry) calls newNight(): two fresh bushes,
// the hopper emptied.
//
// Pure: no three, no engine. onChange tells the rack and the processor when
// to redraw; onBatch the scene when a bag is ready.
// ─────────────────────────────────────────────

export const COFFEE_HARVEST = Object.freeze({
  /** Bushes with ripe beans each night: a cup each. */
  ripePerNight: 2,
  /** Seconds the processor takes over one pile. */
  processSeconds: 5,
});

export class CoffeeHarvest {
  /** Per bush: 'ripe' | 'unripe' | 'picked'. @type {string[]} */
  bushes = [];
  /** Piles in the hopper waiting to be ground (not counting the one grinding). */
  hopper = 0;
  /** Seconds left on the pile grinding; 0 when none is. */
  processLeft = 0;

  /**
   * @param {{ bushes: number, random?: () => number }} opts
   */
  constructor({ bushes, random = Math.random }) {
    this._count = bushes;
    this._random = random;
    this._listeners = new Set();
    this._batch = new Set();
    this.newNight();
  }

  /** @param {() => void} fn @returns {() => void} unsubscribe */
  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /** Told once for every pile ground. @param {() => void} fn @returns {() => void} */
  onBatch(fn) {
    this._batch.add(fn);
    return () => this._batch.delete(fn);
  }

  /** Ripe bushes not yet picked. */
  get ripeLeft() {
    return this.bushes.filter(b => b === 'ripe').length;
  }

  /** 'idle' (empty) | 'loaded' (beans in, waiting for [E]) | 'processing'. */
  get processor() {
    if (this.processLeft > 0) return 'processing';
    return this.hopper > 0 ? 'loaded' : 'idle';
  }

  /** Two fresh bushes; the hopper emptied. */
  newNight() {
    this.bushes = Array.from({ length: this._count }, () => 'unripe');
    const free = this.bushes.map((_, i) => i);
    for (let n = 0; n < Math.min(COFFEE_HARVEST.ripePerNight, this._count); n++) {
      const [i] = free.splice(Math.min(free.length - 1, Math.floor(this._random() * free.length)), 1);
      this.bushes[i] = 'ripe';
    }
    this.hopper = 0;
    this.processLeft = 0;
    this._changed();
  }

  /** Pick bush `i`. @returns {boolean} whether there was anything to pick. */
  harvest(i) {
    if (this.bushes[i] !== 'ripe') return false;
    this.bushes[i] = 'picked';
    this._changed();
    return true;
  }

  /** A pile of beans into the hopper. @returns {boolean} false while it grinds. */
  load() {
    if (this.processLeft > 0) return false;
    this.hopper++;
    this._changed();
    return true;
  }

  /** Grind what is in the hopper. @returns {boolean} whether it started. */
  start() {
    if (this.processLeft > 0 || this.hopper === 0) return false;
    this._next();
    this._changed();
    return true;
  }

  /** Grind on. Time left over from a finished pile goes on to the next, so
   *  a long frame (a nap's fast-forward) grinds as much as the time allows. */
  update(dt) {
    if (this.processLeft === 0) return;
    let left = dt, done = 0;
    while (this.processLeft > 0 && left > 0) {
      const step = Math.min(left, this.processLeft);
      this.processLeft -= step;
      left -= step;
      if (this.processLeft > 1e-9) break;
      this.processLeft = 0;
      done++;
      this._next();
    }
    if (done === 0) return;
    for (let k = 0; k < done; k++) for (const fn of this._batch) fn();
    this._changed();
  }

  _next() {
    if (this.hopper === 0) return;
    this.hopper--;
    this.processLeft = COFFEE_HARVEST.processSeconds;
  }

  _changed() {
    for (const fn of this._listeners) fn();
  }
}
