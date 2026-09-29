// ─────────────────────────────────────────────
// SleepDemonLogic  –  night 1's rules, with no scene attached
// ─────────────────────────────────────────────
// The tireder the player, the closer it stands. Six bands of stamina map to
// six stages, 0 (nowhere) … 5 (right behind them):
//
//   stage   0      1               2                 3              4                5
//   where   —      outside the     LivingQuarters    office left    office corner    1.5 m behind
//                  office window   corridor end      doorway        behind the desk  the player
//
// It moves one stage at a time, at most once every `moveInterval`, and only
// while neither the spot it stands on nor the next is in view — it moves
// when you aren't looking, which also hides the teleport. Eating lowers the
// target and it backs off the same way.
//
// It takes the player (fails the night) when stamina runs out, or after
// `finalGrace` behind them while they stay that tired.
//
// canSee(stage) is injected, so this tests without a camera. SleepDemon
// (the Threat) maps stages onto room anchors and the figure.
// ─────────────────────────────────────────────

export const SLEEP_DEMON = Object.freeze({
  stages: 5,
  /** Seconds between steps, at least. */
  moveInterval: 8,
  /** Bands of stamina it has to regain past a line before the stage drops,
   *  so a value sitting on a boundary doesn't jitter it back and forth. */
  hysteresis: 0.25,
  /** Seconds at stage 5, still exhausted, before it takes the player. */
  finalGrace: 6,
  /** Metres behind the player for stage 5. */
  behindDistance: 1.5,
  /** In view: a sphere round the figure this much wider than it … */
  viewMargin: 0.3,
  /** … and nearer than this. */
  viewRange: 40,
});

/**
 * The stage stamina asks for. Six equal bands, so stage 5 starts at a sixth
 * of stamina left and the last stage has time to be felt before it empties.
 * @param {number} stamina  0 … 1
 * @param {number} current  the stage it asks for now (hysteresis)
 * @param {typeof SLEEP_DEMON} [tuning]
 */
export function stageFor(stamina, current, { stages, hysteresis } = SLEEP_DEMON) {
  const fatigue = (1 - Math.min(1, Math.max(0, stamina))) * (stages + 1);
  let stage = current;
  while (stage < stages && fatigue >= stage + 1) stage++;
  while (stage > 0 && fatigue < stage - hysteresis) stage--;
  return stage;
}

export class SleepDemonLogic {
  /** Where it stands, 0 … stages. */
  stage = 0;
  /** Where stamina says it should be. */
  target = 0;

  /**
   * @param {object} [opts]
   * @param {(stage: number) => boolean} [opts.canSee]  that stage's spot is in view
   * @param {() => void} [opts.onKill]
   * @param {(stage: number) => void} [opts.onMove]
   * @param {typeof SLEEP_DEMON} [opts.tuning]
   */
  constructor({ canSee = () => false, onKill = () => {}, onMove = () => {}, tuning = SLEEP_DEMON } = {}) {
    this.canSee = canSee;
    this.onKill = onKill;
    this.onMove = onMove;
    this.tuning = tuning;
    this.start();
  }

  /** A new or retried night: nowhere, nothing counted. */
  start() {
    this.stage = 0;
    this.target = 0;
    this._sinceMove = 0;
    this._atFinal = 0;
    this._killed = false;
  }

  /** @param {number} dt @param {number} stamina  0 … 1 */
  update(dt, stamina) {
    if (this._killed) return;
    const { stages, moveInterval, finalGrace } = this.tuning;

    this.target = stageFor(stamina, this.target, this.tuning);
    this._sinceMove += dt;
    if (this.stage !== this.target && this._sinceMove >= moveInterval) {
      const next = this.stage + Math.sign(this.target - this.stage);
      if (!this.canSee(this.stage) && !this.canSee(next)) {
        this.stage = next;
        this._sinceMove = 0;
        this.onMove(next);
      }
    }

    // Eating in the grace stops the count: the target drops below 5 at
    // once, even though stepping back waits for the next move.
    this._atFinal = this.stage === stages && this.target === stages ? this._atFinal + dt : 0;
    if (stamina <= 0 || this._atFinal >= finalGrace) {
      this._killed = true;
      this.onKill();
    }
  }
}
