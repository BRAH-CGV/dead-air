import { Interactable } from './Interactable.js';

// ─────────────────────────────────────────────
// CoffeeMachine  –  the base's one way back to awake
// ─────────────────────────────────────────────
// A cup takes brewing: [E] starts one, and it is `brewSeconds` before there
// is anything to drink — time stood at the machine with the night going on
// round you. [E] again drinks it, and gives back `amount` stamina. A brewed
// cup waits for the player, so they can walk off and come back to it.
//
// Only `cups` a night: a cup is used as it starts brewing, and once they are
// gone it is "Out of coffee tonight" until the next night (or a retry) calls
// reset(). Refills are a choice, not a cooldown to wait out (#105).
//
//   ready ──[E]──▶ brewing ──brewSeconds──▶ brewed ──[E]──▶ ready | empty
//
// The status screen (`screen`, a MeshStandardMaterial) shows the state
// across the room in its emissive colour; the PowerGrid scales its
// emissiveIntensity, so a power cut still darkens it.
//
// onBrew / onBrewed / onDrink are hooks for the scene's sounds. The prompt
// is a data field, so InteractionSystem re-shows it when it changes under
// the crosshair.
// ─────────────────────────────────────────────

export const COFFEE = Object.freeze({
  /** Cups a night. */
  cups: 2,
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

const BREWING = 'Brewing…';
const BREWED = '[E] Drink the coffee';
const EMPTY = 'Out of coffee tonight';

export class CoffeeMachine extends Interactable {
  promptLabel = '';
  /** Set by the scene. @type {{restore(amount: number): void}|null} */
  stamina = null;
  /** 'ready' | 'brewing' | 'brewed' | 'empty' */
  state = 'ready';
  /** Cups left tonight. */
  cups = COFFEE.cups;
  /** Seconds left on the brew. */
  brewLeft = 0;
  /** Called as a brew starts, as it is done, and as a cup is drunk. */
  onBrew = null;
  onBrewed = null;
  onDrink = null;

  /**
   * @param {object} [opts]
   * @param {import('three').MeshStandardMaterial|null} [opts.screen]  Its status screen.
   */
  constructor({ screen = null } = {}) {
    super();
    this.screen = screen;
    this.reset();
  }

  onUpdate(dt) {
    if (this.state !== 'brewing' || (this.brewLeft -= dt) > 0) return;
    this.brewLeft = 0;
    this._set('brewed');
    this.onBrewed?.();
  }

  onInteract() {
    if (!this.stamina) return;
    if (this.state === 'ready') {
      this.cups--;
      this.brewLeft = COFFEE.brewSeconds;
      this._set('brewing');
      this.onBrew?.();
    } else if (this.state === 'brewed') {
      this.stamina.restore(COFFEE.amount);
      this._set(this.cups > 0 ? 'ready' : 'empty');
      this.onDrink?.();
    }
  }

  /** A new or retried night: a full rack and nothing brewing. */
  reset() {
    this.cups = COFFEE.cups;
    this.brewLeft = 0;
    this._set('ready');
  }

  _set(state) {
    this.state = state;
    this.promptLabel = state === 'ready' ? `[E] Brew a coffee (${this.cups} ${this.cups === 1 ? 'cup' : 'cups'} left)`
      : state === 'brewing' ? BREWING
      : state === 'brewed' ? BREWED
      : EMPTY;
    this.screen?.emissive.setHex(COFFEE.screen[state]);
  }
}
