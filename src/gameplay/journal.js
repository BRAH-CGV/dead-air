// ─────────────────────────────────────────────
// journal  –  the previous operator's notebook, one entry a night (#79)
// ─────────────────────────────────────────────
// Left on the bedroom desk by whoever had the job before. Each night's
// entry is the night they lived through, and it doubles as the tutorial:
// what the job is, what the storms do, what the light in the sky does and
// how to live through it. The story is theirs; the advice is the game's
// real rules — keep the two in step when a mechanic changes.
// ─────────────────────────────────────────────

/** @typedef {{ night: number, title: string, body: string[] }} JournalEntry */

/** @type {JournalEntry[]} */
export const JOURNAL = [
  {
    night: 1,
    title: 'Night 1',
    body: [
      'If you are reading this, they sent someone new. Good. Somebody ought to know what this job really is, because the company will not tell you.',
      'The work is simple. The computer in the office talks to the dish out back. Pick a blip on the radar, steer the dish onto it, and scan. Every signal worth keeping goes onto a drive, and the reader only takes a drive if you slot one in first. No drive, no signal.',
      'There is a quota every night. Meet it, then hold out until 6 AM. Not a minute before. Nothing gets through by day anyway, the Sun drowns all of it.',
      'When the shift is over, come back here and sleep in the bunk. That is the night done. Then it all starts again.',
      'Nothing happens before dark. Use that first hour.',
    ],
  },
  {
    night: 2,
    title: 'Night 2',
    body: [
      'The wind came up in the dark and did not stop. A sandstorm. You will know it when it comes: the window goes brown and the whole base hisses.',
      'Somewhere in the middle of it the generator choked and the lights went out. It is not broken. Suit up in the airlock, go out to the generator in the yard, and flick the switches on its panel. It came straight back.',
      'And do not stare out into the dust. There are eyes out there. Yellow ones. They wait beyond the fence and they watch. The one at the window does not like being looked at. Look too long and it comes round to the yard to wait for you instead.',
      'They go when the storm goes. Keep working.',
    ],
  },
  {
    night: 3,
    title: 'Night 3',
    body: [
      'Writing this fast. Something came down out of the sky beside the dish tonight. The radar saw it first, a dark smear crawling in towards the middle, and the signal lamp went mad. Then every bulb in the base started to flicker.',
      'Then the light. It opens out over the base, and it looks. Anything it can see, it takes. If you are outside, you are gone. If the office lights are on, it sees straight in through the window.',
      'So cut the power before it gets here. The moment the radar shows it coming, get out to the generator, switch it off, get back inside and stay out of sight of the window until it has gone.',
      'If it finds the lights on, the bulbs blow and the generator trips, and you will be out there afterwards fixing breakers and wires. If you are still here.',
      'If you are reading this, one of us made it. Make it two.',
    ],
  },
];

/** The entry for `night`: the last one after the last night, the first for
 *  anything that isn't a night. @param {number} night @returns {JournalEntry} */
export function journalEntry(night) {
  if (!Number.isInteger(night) || night < 1) return JOURNAL[0];
  return JOURNAL.find(e => e.night === night) ?? JOURNAL.at(-1);
}
