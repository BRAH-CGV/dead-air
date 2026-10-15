// ─────────────────────────────────────────────
// TutorialSteps  –  night 0's lessons, one at a time (pure)
// ─────────────────────────────────────────────
// Night 0 is the tutorial. It tells the story in a few timed cards, then
// walks the player through one of everything: a drive box brought to the
// desk, a drive from it into the reader, a signal found, scanned and saved,
// the drive boxed and the box docked (a quota of one); a storm that takes
// the power, the flashlight, the generator brought back; a nap until 6 AM,
// and the sleep that starts night 1.
//
// A step is either timed (`seconds`) or waits on a test of what the player
// has done (`done(ctx)`). `ctx` is a plain object of booleans the Tutorial
// component reads off the scene each frame:
//
//   holdingBox, boxOnDesk, driveIn, terminalOpen, onSignal, scanning,
//   scanned, saved, boxed, quotaMet, powerOn, flashlightOn, suitOn,
//   napping, morning
//
// The runner skips past a step that is already done, so a player who runs
// ahead is never told to do what they already did. `target` names what the
// arrow points at (the Tutorial component knows where each one is), or is
// a function of ctx that names it; a step marked `desk` is done at the
// computer, so away from it the view points back to the computer instead.
// ─────────────────────────────────────────────

/** Shown in place of a `desk` step while the computer isn't up. */
export const COMPUTER_HINT = Object.freeze({
  title: 'USE THE COMPUTER',
  text: '[E] at the monitor on the desk.',
  target: 'computer',
});

export const TUTORIAL_STEPS = Object.freeze([
  // The story (docs/STORY.md), before anything is asked of the player.
  { id: 'intro-1', seconds: 6, title: 'NIGHT 0',
    text: 'You are one of a few hundred explorers scattered across Mars.' },
  { id: 'intro-2', seconds: 6, title: 'EVERY COLONY BEFORE YOU WENT SILENT',
    text: 'Whatever silenced them came from the sky.' },
  { id: 'intro-3', seconds: 6, title: 'LISTEN TO THE SKY',
    text: 'Save the signals you pick up, and keep the array running for your neighbours.' },

  // The signal game.
  { id: 'deskBox', title: 'PUT A DRIVE BOX ON THE DESK',
    target: c => (c.holdingBox ? 'desk' : 'box'),
    text: '[E] picks up a drive box from the shelf. Carry it to the empty right end of the desk, beside the reader, and [E] to drop it there.',
    done: c => c.boxOnDesk || c.driveIn },
  { id: 'drive', title: 'PUT A DRIVE IN THE READER', target: 'reader',
    text: 'Take a drive out of the box and put it in the reader beside the computer.',
    done: c => c.driveIn },
  { id: 'computer', title: 'USE THE COMPUTER', target: 'computer',
    text: '[E] at the monitor on the desk.',
    done: c => c.terminalOpen },
  { id: 'aim', desk: true, title: 'FIND THE SIGNAL',
    text: 'Move the cursor onto the blip with W A S D. The dish follows it.',
    done: c => c.onSignal || c.scanning || c.scanned },
  { id: 'scan', desk: true, title: 'SCAN IT',
    text: 'Press Enter, and keep the cursor on it until the scan is done.',
    done: c => c.scanned },
  { id: 'save', title: 'SAVE IT TO THE DRIVE',
    text: 'Q saves the signal to the drive and leaves the computer.',
    done: c => c.saved && !c.terminalOpen },
  { id: 'box', title: 'PUT THE DRIVE BACK IN THE BOX', target: 'box',
    text: 'Take the drive out of the reader and put it back in the drive box.',
    done: c => c.boxed },
  { id: 'dock', title: 'TAKE THE BOX TO THE AIRLOCK', target: 'dock',
    text: 'Set it in the dock by the suit locker. The drives in it are the night\'s quota.',
    done: c => c.quotaMet },
  { id: 'quota', seconds: 5, title: 'QUOTA MET',
    text: 'Tonight one signal is enough. Now see the night out.' },

  // The storm and the generator.
  { id: 'storm', title: 'A STORM IS COMING',
    text: 'Dust storms can choke the generator. Watch the lights.',
    done: c => !c.powerOn },
  { id: 'flashlight', title: 'TURN ON YOUR FLASHLIGHT',
    text: 'The power is out. [F] turns your flashlight on and off.',
    done: c => c.flashlightOn || c.powerOn },
  { id: 'suit', title: 'PUT ON THE SUIT', target: 'locker',
    text: 'The power is out. Suit up in the airlock to go outside.',
    done: c => c.suitOn || c.powerOn },
  { id: 'generator', title: 'RESTART THE GENERATOR', target: 'generator',
    text: 'Out through the hatch to the generator. Flick every switch back up.',
    done: c => c.powerOn },
  { id: 'inside', title: 'GET BACK INSIDE', target: 'locker',
    text: 'Take the suit off in the airlock.',
    done: c => !c.suitOn },

  // Naps and sleep.
  { id: 'nap', title: 'NAP UNTIL 6 AM', target: 'bed',
    text: 'At the bunk in the living quarters, [E] naps until 6 AM. [R] changes the alarm.',
    done: c => c.napping || c.morning },
  { id: 'wait', title: 'SEE THE NIGHT OUT', target: 'bed',
    text: 'Nap again at the bunk until 6 AM.',
    done: c => c.morning },
  // Sleeping starts night 1, which ends the tutorial (Tutorial).
  { id: 'sleep', title: 'GO TO BED', target: 'bed',
    text: 'Morning. Sleep at the bunk to start night 1.',
    done: () => false },
]);

export class TutorialRunner {
  /**
   * @param {object} [opts]
   * @param {ReadonlyArray<object>} [opts.steps=TUTORIAL_STEPS]
   * @param {(step: object) => void} [opts.onEnter]  Called once for every
   *        step entered, skipped-through ones included, the first one on
   *        the first update.
   */
  constructor({ steps = TUTORIAL_STEPS, onEnter = null } = {}) {
    this.steps = steps;
    this.onEnter = onEnter;
    this._view = { title: '', text: '', target: null, compact: false };
    this.reset();
  }

  reset() {
    this.index = 0;
    this.elapsed = 0;   // seconds on the current step
    this._entered = false;
  }

  /** Jump to the step `id` and enter it (a retry starts at the drive). */
  goTo(id) {
    const index = this.steps.findIndex(s => s.id === id);
    if (index < 0) return;
    this.index = index;
    this.elapsed = 0;
    this._entered = true;
    this.onEnter?.(this.step);
  }

  /** The step now showing; null past the last. */
  get step() { return this.steps[this.index] ?? null; }

  get finished() { return this.index >= this.steps.length; }

  /** @param {number} dt @param {object} ctx */
  update(dt, ctx) {
    if (this.finished) return;
    if (!this._entered) {
      this._entered = true;
      this.onEnter?.(this.step);
    }
    this.elapsed += dt;
    while (!this.finished && this._isDone(this.step, ctx)) {
      this.index++;
      this.elapsed = 0;
      if (!this.finished) this.onEnter?.(this.step);
    }
  }

  /** What to show this frame. One object, rewritten each call. */
  view(ctx) {
    const view = this._view;
    const step = this.step;
    const away = step?.desk && !ctx.terminalOpen;
    const shown = away ? COMPUTER_HINT : step;
    view.title = shown?.title ?? '';
    view.text = shown?.text ?? '';
    const target = typeof shown?.target === 'function' ? shown.target(ctx) : shown?.target;
    view.target = (!ctx.terminalOpen && target) || null;
    view.compact = !!ctx.terminalOpen;
    return view;
  }

  _isDone(step, ctx) {
    return step.seconds ? this.elapsed >= step.seconds : !!step.done(ctx);
  }
}
