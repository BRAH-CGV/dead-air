// ─────────────────────────────────────────────
// IntroTimeline  –  the intro's beats against the clock (pure)
// ─────────────────────────────────────────────
// The story told before the first shift (docs/STORY.md, "Exposition"), as
// a run of beats, each drawn by introDraw.js and captioned:
//
//   voyage   a ship leaves Earth for Mars
//   colony   the colony calls home; the crops grow
//   silence  the signal turns red and wavy, then stops
//   sky      what is known: enough people, and it comes from the sky
//   ship     another ship — yours
//   landing  closing in on Mars, down to the surface
//   drive    the buggy across the plain to the array
//   begin    the end card, held until the player clicks
//
// IntroPlayer runs the clock; nothing here touches the DOM or a canvas.
// ─────────────────────────────────────────────

/** Seconds a caption takes to fade in, and to fade out before its beat ends. */
export const CAPTION_FADE = 0.8;

export const INTRO_BEATS = Object.freeze([
  Object.freeze({ id: 'voyage', seconds: 7,
    caption: 'Colony after colony was sent from Earth to Mars.' }),
  Object.freeze({ id: 'colony', seconds: 8,
    caption: 'They called home every night. The crops grew. Things were going well.' }),
  Object.freeze({ id: 'silence', seconds: 7,
    caption: 'Then the signals turned strange. And then they went silent.' }),
  Object.freeze({ id: 'sky', seconds: 7,
    caption: 'Every colony fell silent once enough people had arrived. Whatever does it comes from the sky.' }),
  Object.freeze({ id: 'ship', seconds: 7,
    caption: 'So a few hundred were sent, scattered thin, on gear too low-powered to be noticed. You are one of them.' }),
  Object.freeze({ id: 'landing', seconds: 7,
    caption: 'You have been assigned to {array}.' }),
  Object.freeze({ id: 'drive', seconds: 8,
    caption: 'Scan the night sky. Keep the array running for your neighbours.' }),
  Object.freeze({ id: 'begin', seconds: Infinity, caption: '' }),
]);

/** The intro's length up to the end card, in seconds. */
export const INTRO_SECONDS = INTRO_BEATS.reduce(
  (sum, b) => sum + (Number.isFinite(b.seconds) ? b.seconds : 0), 0);

/**
 * The beat at `t` seconds in, written into `out`:
 * `{ index, id, beat, local, progress }` — `local` is seconds into the
 * beat, `progress` 0..1 across it (1 on the held end card).
 */
export function beatAt(t, out) {
  let start = 0;
  const time = Math.max(0, t);
  for (let i = 0; i < INTRO_BEATS.length; i++) {
    const beat = INTRO_BEATS[i];
    if (time < start + beat.seconds || i === INTRO_BEATS.length - 1) {
      out.index = i;
      out.id = beat.id;
      out.beat = beat;
      out.local = time - start;
      out.progress = Number.isFinite(beat.seconds) ? out.local / beat.seconds : 1;
      return out;
    }
    start += beat.seconds;
  }
  return out;
}

/** How visible a beat's caption is, `local` seconds into a beat `seconds` long. */
export function captionAlpha(local, seconds, fade = CAPTION_FADE) {
  const fadeIn = Math.min(1, Math.max(0, local / fade));
  if (!Number.isFinite(seconds)) return fadeIn;
  const fadeOut = Math.min(1, Math.max(0, (seconds - local) / fade));
  return Math.min(fadeIn, fadeOut);
}

/**
 * The array the player is posted to: a name and a place on Mars, made up
 * each run ("[random coordinate bs]" in STORY.md).
 * @param {() => number} [random]  0..1
 */
export function arrayLabel(random = Math.random) {
  const letter = String.fromCharCode(65 + Math.floor(random() * 26) % 26);
  const number = String(10 + Math.floor(random() * 90) % 90);
  const lat = (random() * 60).toFixed(1);
  const ns = random() < 0.5 ? 'N' : 'S';
  const lon = (random() * 180).toFixed(1);
  const ew = random() < 0.5 ? 'E' : 'W';
  return `ARRAY ${letter}-${number} · ${lat}°${ns} ${lon}°${ew}`;
}

/** A beat's caption with the array filled in. */
export function captionFor(beat, array) {
  return beat.caption.replace('{array}', array);
}
