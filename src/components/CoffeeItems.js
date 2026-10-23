import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// CoffeeItems  –  the coffee in the player's hands (#168)
// ─────────────────────────────────────────────
// The scene's few piles of beans and bags of ground coffee (CoffeeGoods),
// built once and handed out as the coffee is made:
//
//   spawnBeans(at)  a bush picked: a pile, straight into empty hands (or
//                   left where it was picked, with the hands full)
//   spawnBag(at)    a batch ground: a bag, standing in the processor's bay
//   take(item)      the hopper or the coffee machine uses one up: out of
//                   the hands, parked away
//   reset()         a new night (or a retry): everything parked
//
// held(kind) is the one in hand, or the one let go on this very press:
// [E] with something held always drops it (PickupSystem), and whether that
// runs before or after the hopper's or the machine's onInteract depends on
// the player's component order. So the end of each frame remembers what
// was in hand (onLateUpdate), and the press that dropped it still counts.
//
// A press that spends or hands over an item is used up (consumeAction), so
// the same press doesn't then drop or pick up something else.
// ─────────────────────────────────────────────

export class CoffeeItems extends Component {
  /**
   * @param {object} opts
   * @param {import('../gameobjects/CoffeeGoods.js').CoffeeBeans[]} opts.beans
   * @param {import('../gameobjects/CoffeeGoods.js').CoffeeBag[]} opts.bags
   * @param {import('./PickupSystem.js').PickupSystem} opts.pickup
   * @param {{ consumeAction?(action: string): void }} [opts.engine]
   */
  constructor({ beans, bags, pickup, engine = null }) {
    super();
    this.beans = beans;
    this.bags = bags;
    this.hands = pickup;
    this.engine = engine;
    this._last = null;
    /** Bags put in the bay and not yet picked up. */
    this._inBay = new Set();
    this._next = { beans: 0, bag: 0 };
  }

  /** Bags waiting in the bay. */
  get waiting() {
    return this._inBay.size;
  }

  /** The item of `kind` in hand, or let go on this press; else null. */
  held(kind) {
    const now = this._holding();
    if (now) return now.coffeeKind === kind ? now : null;
    const last = this._last;
    return last?.coffeeKind === kind && last.inPlay && !last.pickupable.held ? last : null;
  }

  /** In play, not in hand. */
  loose(kind) {
    return this._pool(kind).filter(it => it.inPlay && !it.pickupable.held);
  }

  spawnBeans(at) {
    const pile = this._take('beans');
    pile.place(at);
    if (!this.hands?.heldPickupable && this.hands?.pickUp(pile.pickupable)) this._consume();
    return pile;
  }

  spawnBag(at) {
    const bag = this._take('bag');
    bag.place(at);
    this._inBay.add(bag);
    return bag;
  }

  /** Use one up. `press`: it was handed over with [E], so that press is
   *  used up too; a pile dropped into the hopper on its own isn't. */
  take(item, { press = true } = {}) {
    if (item.pickupable.held && this.hands?.heldPickupable === item.pickupable) this.hands.dropHeld();
    item.park();
    this._inBay.delete(item);
    if (this._last === item) this._last = null;
    if (press) this._consume();
  }

  reset() {
    const now = this._holding();
    if (now) this.hands.dropHeld();
    for (const it of [...this.beans, ...this.bags]) it.park();
    this._inBay.clear();
    this._last = null;
    this._next = { beans: 0, bag: 0 };
  }

  onLateUpdate() {
    this._last = this._holding();
    if (this._last) this._inBay.delete(this._last);
  }

  _holding() {
    const go = this.hands?.heldPickupable?.gameObject;
    return go?.coffeeKind ? go : null;
  }

  _pool(kind) {
    return kind === 'beans' ? this.beans : this.bags;
  }

  /** A parked one if there is one, else the next in turn (the oldest out). */
  _take(kind) {
    const pool = this._pool(kind);
    const free = pool.find(it => !it.inPlay);
    if (free) return free;
    const it = pool[this._next[kind] % pool.length];
    this._next[kind]++;
    if (it.pickupable.held) this.hands.dropHeld();
    this._inBay.delete(it);
    return it;
  }

  _consume() {
    this.engine?.consumeAction?.('interact');
  }
}
