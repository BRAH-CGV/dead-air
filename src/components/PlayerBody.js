// ─────────────────────────────────────────────
// PlayerBody  –  The player's physical dimensions, in one place
// ─────────────────────────────────────────────
// Heights are measured the way you'd measure a person: from the feet, in
// metres. Rapier and the camera want something else — capsule half-heights
// (the cylinder part only, caps excluded) and eye offsets from the capsule's
// centre, since that's where the body's origin sits. playerBody() does that
// conversion once so Engine.buildPlayer and the tests read the same numbers.
//
// Constraints the numbers are chosen against:
//   • standHeight  < 2.2 m  — the base's doorway height
//   • crouchHeight < 0.72 m — the desk's under-top gap (hiding, night 2)
//
// Standing is 3/4 of the first eye-height pass (1.8 m, eye 1.65 m), which
// play-testing found far too tall. The crouch is fitted to the desk, not to
// the player's stature, so it didn't shrink with it.
// ─────────────────────────────────────────────

export const PLAYER_BODY = Object.freeze({
  radius: 0.3,
  standHeight: 1.35,
  standEyeHeight: 1.24,
  crouchHeight: 0.65,
  crouchEyeHeight: 0.55,
});

/**
 * Derive Rapier capsule half-heights and centre-relative eye offsets.
 * @param {typeof PLAYER_BODY} [spec]
 */
export function playerBody(spec = PLAYER_BODY) {
  const { radius, standHeight, standEyeHeight, crouchHeight, crouchEyeHeight } = spec;
  return {
    radius,
    standHalf: standHeight / 2 - radius,
    crouchHalf: crouchHeight / 2 - radius,
    standEyeOffset: standEyeHeight - standHeight / 2,
    crouchEyeOffset: crouchEyeHeight - crouchHeight / 2,
  };
}
