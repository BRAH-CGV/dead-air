import { Interactable } from './Interactable.js';

// ─────────────────────────────────────────────
// CoffeeMachine  –  the base's one way back to awake
// ─────────────────────────────────────────────
// A cup takes brewing: [E] starts one, and it is `brewSeconds` before there
// is anything to drink — time stood at the machine with the night going on
// round you. [E] again drinks it, and gives back `amount` stamina. A brewed
// cup waits for the player, so they can walk off and come back to it.
//
// A cup takes a bag of ground coffee (#168): the grow rack's ripe beans,
// ground at the office's bean processor and carried here like a drive (a
// CoffeeBag; CoffeeItems, `items`). A bag let go near it docks on its top
// (`dock`, a SnapSocket the scene puts there, which asks accepts()), where
// it can be seen, and can be picked back off like a drive from its box;
// while one sits there it is 'ready'. [E] then takes the bag off, puts it
// away and brews. Without one it is 'empty'. There is no count of cups
// left: the ripe bushes are that. Refills are a choice, not a cooldown to
// wait out (#105).
//
//   empty ⇄ ready ──[E]──▶ brewing ──brewSeconds──▶ brewed ──[E]──▶ ready | empty
//
// The status screen (`screen`, a MeshStandardMaterial) shows the state
// across the room in its emissive colour; the PowerGrid scales its
// emissiveIntensity, so a power cut still darkens it.
//
// The cup (`cup`, a CoffeeCup) stands on the drip tray while one brews and
// while it waits to be drunk, filling as it brews, the coffee pouring into
// it until it is done; otherwise it is gone.
//
// onBrew / onBrewed / onDrink are hooks for the scene's sounds. The prompt
// is a data field, so InteractionSystem re-shows it when it changes under
// the crosshair.
// ─────────────────────────────────────────────

export const COFFEE = Object.freeze({
  /** Seconds a cup takes to brew. */
  brewSeconds: 20,
  /** Stamina a cup gives back. */
  amount: 0.35,
  /** The status screen's colour in each state. */
  screen: Object.freeze({
    ready: 0x6dff9c,
    brewing: 0xffb347,
    brewed: 0x6dff9c,
    empty: 0xff4a3c,
  }),
});

/** While it brews, the seconds left (rounded up). */
const brewing = left => `Brewing… (${Math.ceil(left)} s)`;
const BREWED = '[E] Drink the coffee';
const READY = '[E] Brew a coffee';
const EMPTY = 'Needs ground coffee';
const DROP = '[E] Drop the coffee in';

export class CoffeeMachine extends Interactable {
  promptLabel = '';
  /** Set by the scene. @type {{restore(amount: number): void}|null} */
  stamina = null;
  /** The coffee carried about, set by the scene.
   *  @type {{ held(kind: string): object|null, take(item: object, opts?: object): void }|null} */
  items = null;
  /** The dock on its top a bag sits in until it is brewed, set by the scene.
   *  @type {import('./SnapSocket.js').SnapSocket|null} */
  dock = null;
  /** 'empty' | 'ready' | 'brewing' | 'brewed' */
  state = 'empty';
  /** Seconds left on the brew. */
  brewLeft = 0;
  /** Called as a brew starts, as it is done, and as a cup is drunk. */
  onBrew = null;
  onBrewed = null;
  onDrink = null;

  /**
   * @param {object} [opts]
   * @param {import('three').MeshStandardMaterial|null} [opts.screen]  Its status screen.
   * @param {{ object3d: import('three').Object3D, setFill(t: number): void, setPouring?(on: boolean): void }|null} [opts.cup]  Its cup.
   */
  constructor({ screen = null, cup = null } = {}) {
    super();
    this.screen = screen;
    this.cup = cup;
    this.reset();
  }

  /** A bag of ground coffee sits on top, waiting to be brewed. */
  get loaded() {
    return !!this.dock?.hasAttached();
  }

  /** Whether the dock may take `item`: a bag, while nothing is on it,
   *  brewing or waiting to be drunk. */
  accepts(item) {
    return item?.coffeeKind === 'bag' && this.state !== 'brewing' && this.state !== 'brewed' && !this.loaded;
  }

  onUpdate(dt) {
    if (this.state === 'ready' || this.state === 'empty') {
      const state = this._idle();
      if (state !== this.state) this._set(state);
      else if (state === 'empty') this._label();
      return;
    }
    if (this.state !== 'brewing') return;
    this.brewLeft = Math.max(0, this.brewLeft - dt);
    this.cup?.setFill(1 - this.brewLeft / COFFEE.brewSeconds);
    if (this.brewLeft > 0) {
      const label = brewing(this.brewLeft);
      if (label !== this.promptLabel) this.promptLabel = label;
      return;
    }
    this._set('brewed');
    this.onBrewed?.();
  }

  onInteract() {
    if (!this.stamina) return;
    if (this.state === 'ready') {
      if (!this.loaded) return this._set('empty');
      this.items?.take(this._unload({ playSound: false }));
      this.brewLeft = COFFEE.brewSeconds;
      this._set('brewing');
      this.onBrew?.();
    } else if (this.state === 'brewed') {
      this.stamina.restore(COFFEE.amount);
      this._set(this._idle());
      this.onDrink?.();
    }
  }

  /** A new or retried night: nothing brewing, nothing on it. */
  reset() {
    this.brewLeft = 0;
    if (this.loaded) this.items?.take(this._unload({ playSound: false }), { press: false });
    this._set(this._idle());
  }

  /** The bag off the dock. */
  _unload(opts) {
    const bag = this.dock.firstAttached;
    this.dock.detach(bag, opts);
    return bag;
  }

  /** Waiting for the player: ready with a bag taken in, else empty. */
  _idle() {
    return this.loaded ? 'ready' : 'empty';
  }

  /** Empty: what it says, by whether a bag is in hand. */
  _label() {
    const label = this.items?.held('bag') ? DROP : EMPTY;
    if (label !== this.promptLabel) this.promptLabel = label;
  }

  _set(state) {
    this.state = state;
    this.promptLabel = state === 'ready' ? READY
      : state === 'brewing' ? brewing(this.brewLeft)
      : state === 'brewed' ? BREWED
      : this.items?.held('bag') ? DROP : EMPTY;
    this.screen?.emissive.setHex(COFFEE.screen[state]);
    if (this.cup) {
      this.cup.object3d.visible = state === 'brewing' || state === 'brewed';
      this.cup.setFill(state === 'brewed' ? 1 : 0);
      this.cup.setPouring?.(state === 'brewing');
    }
  }
}
