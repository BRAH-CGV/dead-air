// ─────────────────────────────────────────────
// BreakerPuzzle  –  the generator panel after the UFO's surge
// ─────────────────────────────────────────────
// What has to be put right before the generator will start again (see
// BreakerPanel for the screen, PowerGrid.tripped for why):
//
//   switches  a row of breakers, most of them thrown. All must be on.
//   wires     colour-coded leads torn off their terminals. Each runs from
//             its socket on the left to the terminal of its own colour on
//             the right, which have been shuffled so none runs straight
//             across. A wrong colour won't go on.
//
// Pure state, no DOM — the panel draws it and forwards clicks.
// ─────────────────────────────────────────────

/** Wire colours: CSS for the panel, a name for screen readers and tests. */
export const WIRE_COLORS = [
  { name: 'red',    css: '#e5484d' },
  { name: 'yellow', css: '#f5c84c' },
  { name: 'blue',   css: '#3e8ef7' },
  { name: 'green',  css: '#46c37b' },
  { name: 'white',  css: '#e8e8e8' },
];

export class BreakerPuzzle {
  /**
   * @param {object} [opts]
   * @param {number} [opts.switchCount=6]
   * @param {number} [opts.wireCount=4]   At most WIRE_COLORS.length.
   * @param {() => number} [opts.random=Math.random]
   */
  constructor({ switchCount = 6, wireCount = 4, random = Math.random } = {}) {
    // Most of the breakers thrown — at least half, never none.
    const thrown = Math.ceil(switchCount / 2) + Math.floor(random() * (switchCount - Math.ceil(switchCount / 2) + 1));
    const order = shuffle([...Array(switchCount).keys()], random);
    /** true = on. @type {boolean[]} */
    this.switches = Array(switchCount).fill(true);
    for (let i = 0; i < thrown; i++) this.switches[order[i]] = false;

    const colours = shuffle([...WIRE_COLORS.keys()], random).slice(0, Math.min(wireCount, WIRE_COLORS.length));
    /** Colour index of each socket on the left. @type {number[]} */
    this.left = colours;
    /** Colour index of each terminal on the right — no colour opposite its own socket. */
    this.right = derange(colours, random);
    /** Right terminal each left wire is on, or null. @type {(number|null)[]} */
    this.links = Array(colours.length).fill(null);
  }

  get switchesOn() { return this.switches.filter(Boolean).length; }
  get wiresConnected() { return this.links.filter(l => l !== null).length; }
  get solved() { return this.switchesOn === this.switches.length && this.wiresConnected === this.links.length; }

  toggle(i) {
    this.switches[i] = !this.switches[i];
  }

  /** Put left wire `l` on right terminal `r`. Only its own colour takes it.
   *  @returns {boolean} whether it went on */
  connect(l, r) {
    if (this.left[l] !== this.right[r]) return false;
    this.links[l] = r;
    return true;
  }

  disconnect(l) {
    this.links[l] = null;
  }
}

function shuffle(items, random) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** A shuffle of `items` with nothing left where it was. */
function derange(items, random) {
  if (items.length < 2) return [...items];
  for (;;) {
    const out = shuffle([...items], random);
    if (out.every((v, i) => v !== items[i])) return out;
  }
}
