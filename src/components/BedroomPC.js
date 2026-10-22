import { Interactable } from './Interactable.js';
import { paintDom } from '../ui/paintDom.js';

// ─────────────────────────────────────────────
// BedroomPC  –  the computer on the bedroom desk (#114)
// ─────────────────────────────────────────────
// [E] opens BedroomPCPanel: the colony map, what the central hub sent back
// from earlier nights' drives, and an empty forecast. While it's up the
// player stands still but the night goes on; 1 / 2 / 3 or ← / → switch
// screens, and a fresh [E], or [Q] as at the terminal, puts it away. It
// won't open behind a failed night, and a night failed under it (a threat
// while reading) puts it away.
//
// `state` is 'reading' while it's up, 'idle' otherwise, the way the desk's
// screens report theirs: the scene counts it among them (BaseScene._screens),
// so the Sleep Demon treats a player at it as a player at the terminal.
//
// The room puts it on the desk; the scene hands it the rest, since rooms
// don't know about gameplay:
//
//   pc.controller = gameController;    // the night, and whether it's on
//   pc.panel      = new BedroomPCPanel();
//   pc.run        = engine.run;        // the array's name, the hub's results
//   pc.map        = colonyMap({ … });  // where things are on the map
//   pc.screenView = screenView;        // leans in to its screen (#161)
//   pc.screen     = rooms.LivingQuarters.pcScreen;
//
// On a screen (#161) the panel is what the laptop shows in the world,
// whether or not anyone is at it (paintScreen, for a ScreenCanvas); using
// it leans the view in, and closing it leans back out.
// ─────────────────────────────────────────────

/** Fresh presses that pick a screen, and those that step through them. */
const SCREEN_KEYS = Object.freeze({ Digit1: 'colony', Digit2: 'findings', Digit3: 'forecast' });
const STEP_KEYS = Object.freeze({ ArrowLeft: -1, ArrowRight: 1 });

/** Controller states it can be used in. */
const USABLE = new Set(['playing', 'morning']);

export class BedroomPC extends Interactable {
  promptLabel = '[E] Use the computer';
  interactRange = 2.5;

  /** @type {import('../gameplay/GameController.js').GameController|null} */
  controller = null;
  /** @type {import('../ui/BedroomPCPanel.js').BedroomPCPanel|null} */
  panel = null;
  /** @type {import('../gameplay/RunRecord.js').RunRecord|null} */
  run = null;
  /** @type {ReturnType<import('../ui/colonyMap.js').colonyMap>|null} */
  map = null;

  /** Leans the view in to the laptop's screen (#161). Without one (tests,
   *  other scenes) the panel goes over the whole view.
   *  @type {import('./ScreenView.js').ScreenView|null} */
  screenView = null;
  /** The laptop's screen, for screenView. */
  screen = null;

  /** True while the panel is up. */
  open = false;

  /** What the panel was last drawn for (paintScreen). */
  _shown = null;

  get state() { return this.open ? 'reading' : 'idle'; }

  onInteract() {
    if (this.open || !this._usable()) return;
    this.open = true;
    this.panel?.show(this._data());
    if (this.screenView && this.screen) this.screenView.open(this.screen, this.panel?.root ?? null);
    const engine = this._engine();
    // The press that opened it has done its job.
    engine?.consumeAction?.('interact');
    if (engine?.playerController) engine.playerController.inputLocked = true;
  }

  /** Put it away and free the player. */
  close() {
    if (!this.open) return;
    this.open = false;
    // On the screen, the panel stays up while the view leans back out.
    if (this.screenView && this.screen) this.screenView.close(() => this.panel?.hide());
    else this.panel?.hide();
    const engine = this._engine();
    if (engine?.playerController) engine.playerController.inputLocked = false;
  }

  onUpdate() {
    if (!this.open) return;
    if (!this._usable()) { this.close(); return; }
    const engine = this._engine();
    if (!engine) return;
    const pressed = engine.input.pressed;
    if (pressed[engine.keyBinds?.interact]) {
      // Used up, so the system that opens it doesn't open it again.
      engine.consumeAction?.('interact');
      this.close();
      return;
    }
    if (pressed.KeyQ) { this.close(); return; }
    for (const code in SCREEN_KEYS) if (pressed[code]) this.panel?.setScreen(SCREEN_KEYS[code]);
    for (const code in STEP_KEYS) if (pressed[code]) this.panel?.step(STEP_KEYS[code]);
  }

  onDestroy() {
    // A rebuild with the panel up must not leave the player locked.
    this.close();
  }

  /** The laptop's screen (ScreenCanvas): the panel drawn for tonight,
   *  again only when that changes, then painted from its DOM. */
  paintScreen(ctx, w, h) {
    const data = this._data();
    const key = `${data.array}|${this.controller?.nightNumber ?? 1}|${data.findings.length}`;
    if (key !== this._shown) {
      this._shown = key;
      this.panel?.render?.(data);
    }
    if (this.panel?.root) paintDom(this.panel.root, ctx, w, h);
  }

  /** What the panel shows: the array, the map, the findings so far. */
  _data() {
    return {
      array: this.run?.array ?? null,
      map: this.map,
      findings: this.run?.findings(this.controller?.nightNumber ?? 1) ?? [],
    };
  }

  _usable() {
    return !this.controller || USABLE.has(this.controller.state);
  }

  _engine() {
    return this.gameObject?.scene?.userData?.engine ?? null;
  }
}
