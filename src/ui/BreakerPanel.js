import { WIRE_COLORS } from '../gameplay/BreakerPuzzle.js';

// ─────────────────────────────────────────────
// BreakerPanel  –  the generator's repair screen
// ─────────────────────────────────────────────
// The UFO's surge threw the generator's breakers and tore its leads off
// (BreakerPuzzle). This is the panel the player works at, out in the yard,
// before the power will come back:
//
//   panel.open(puzzle, { onSolved, onClose, onFlick });
//
//   top     a row of breaker switches — click each one back on
//   bottom  coloured leads on the left, shuffled terminals on the right —
//           drag a lead onto the terminal of its colour (or click the lead,
//           then the terminal). Anywhere near the terminal counts, not just
//           its ring. A wrong colour sparks and won't go on.
//
// Solved, it shows "Power restored", waits a beat, calls onSolved and
// closes. Q or Escape steps away (onClose); the puzzle keeps whatever was
// done, so coming back carries on where the player left off.
//
// Wraps #breaker-panel in index.html (the styles live there; the contents
// are built here, per puzzle). Without a DOM every call is a no-op.
// ─────────────────────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';
const W = 400;
const ROW = 46;
const LEFT_X = 50;
const RIGHT_X = 350;
/** How near (in diagram units) a press or a drop has to be to a lead or a
 *  terminal to count — a generous target, not the ring itself. */
const SNAP = 30;

export class BreakerPanel {
  isOpen = false;

  /**
   * @param {HTMLElement|null} [root]  Defaults to the page's #breaker-panel.
   * @param {object} [opts]
   * @param {number} [opts.solvedDelayMs=900]  "Power restored" shows this long.
   */
  constructor(
    root = typeof document !== 'undefined' ? document.getElementById('breaker-panel') : null,
    { solvedDelayMs = 900 } = {},
  ) {
    this.root = root;
    this.solvedDelayMs = solvedDelayMs;
    this._puzzle = null;
    this._callbacks = {};
    this._held = null;          // left lead being carried, or null
    this._solvedTimer = null;
    this._onKey = (e) => {
      if (e.code === 'KeyQ' || e.code === 'Escape') this.close();
    };
    root?.addEventListener('click', e => this._onClick(e));
    root?.addEventListener('pointerdown', e => this._onPointerDown(e));
    root?.addEventListener('pointerup', e => this._onPointerUp(e));
    root?.addEventListener('pointermove', e => this._onPointerMove(e));
  }

  /** @param {import('../gameplay/BreakerPuzzle.js').BreakerPuzzle} puzzle
   *  @param {{ onSolved?: () => void, onClose?: () => void, onFlick?: () => void }} [callbacks]
   *         onFlick: a switch was flicked (the scene plays the click). */
  open(puzzle, callbacks = {}) {
    this._puzzle = puzzle;
    this._callbacks = callbacks;
    this._held = null;
    this.isOpen = true;
    if (!this.root) return;
    this._build();
    this._render();
    this.root.classList.add('is-open');
    addEventListener('keydown', this._onKey);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    clearTimeout(this._solvedTimer);
    this._solvedTimer = null;
    if (this.root) {
      this.root.classList.remove('is-open');
      removeEventListener('keydown', this._onKey);
    }
    this._callbacks.onClose?.();
  }

  // ── Input ───────────────────────────────

  _onClick(e) {
    const sw = e.target.closest?.('.breaker-switch');
    if (!sw || this._done()) return;
    this._puzzle.toggle(Number(sw.dataset.i));
    this._callbacks.onFlick?.();
    this._render();
  }

  _onPointerDown(e) {
    if (this._done() || !this._puzzle) return;
    const lead = e.target.closest?.('[data-left]');
    const l = lead ? Number(lead.dataset.left) : this._nearest(e, i => this._leadCentre(i), this._puzzle.left.length);
    if (l === null) return;
    this._puzzle.disconnect(l);   // picking a lead up takes it off its terminal
    this._held = l;
    this._render();
  }

  _onPointerUp(e) {
    if (this._held === null) return;
    // Let go over the lead itself: still holding it (click, then click).
    if (e.target.closest?.('[data-left]')) return;
    const hit = e.target.closest?.('[data-right]');
    const r = hit ? Number(hit.dataset.right) : this._nearest(e, i => this._terminalCentre(i), this._puzzle.right.length);
    if (r === null) {
      this._held = null;
      this._render();
      return;
    }
    const term = this.root.querySelector(`[data-right="${r}"]`);
    if (!this._puzzle.connect(this._held, r)) {
      term.classList.add('is-spark');
      setTimeout(() => term.classList.remove('is-spark'), 400);
    }
    this._held = null;
    this._render();
  }

  _onPointerMove(e) {
    if (this._held === null || !this._drag) return;
    const p = this._toSvg(e);
    if (!p) return;
    this._drag.setAttribute('x2', p.x);
    this._drag.setAttribute('y2', p.y);
  }

  /** Client coordinates → the wire diagram's own. */
  _toSvg(e) {
    const ctm = this._svg?.getScreenCTM?.();
    if (!ctm) return null;
    const pt = this._svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    return pt.matrixTransform(ctm.inverse());
  }

  /** Index of the lead or terminal nearest the event, within SNAP, or null. */
  _nearest(e, centreOf, count) {
    const p = this._toSvg(e);
    if (!p) return null;
    let best = null, bestD = SNAP;
    for (let i = 0; i < count; i++) {
      const c = centreOf(i);
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d <= bestD) { best = i; bestD = d; }
    }
    return best;
  }

  _leadCentre(l) { return { x: LEFT_X, y: rowY(l) }; }
  _terminalCentre(r) { return { x: RIGHT_X, y: rowY(r) }; }

  _done() {
    return this._solvedTimer !== null;
  }

  // ── Drawing ─────────────────────────────

  _build() {
    const p = this._puzzle;
    const height = ROW * p.left.length + 20;
    this.root.innerHTML = `
      <div class="breaker-box">
        <div class="breaker-title">Generator — breakers tripped</div>
        <div class="breaker-switches">
          ${p.switches.map((_, i) => `<button class="breaker-switch" data-i="${i}" aria-label="Breaker ${i + 1}"><span class="breaker-lever"></span></button>`).join('')}
        </div>
        <svg class="breaker-wires" viewBox="0 0 ${W} ${height}" width="${W}" height="${height}"></svg>
        <div class="breaker-status"></div>
        <div class="breaker-hint">Click every breaker up · drag each lead to its colour · Q / Esc: step away</div>
      </div>`;
    this._svg = this.root.querySelector('.breaker-wires');

    const svg = this._svg;
    this._links = el('g', { class: 'breaker-links' });
    svg.appendChild(this._links);
    p.left.forEach((c, l) => {
      svg.appendChild(el('circle', {
        cx: LEFT_X, cy: rowY(l), r: 12, fill: WIRE_COLORS[c].css, 'data-left': l, class: 'breaker-lead',
        'pointer-events': 'all',
        'aria-label': `${WIRE_COLORS[c].name} lead`,
      }));
    });
    p.right.forEach((c, r) => {
      svg.appendChild(el('circle', {
        // Filled (barely) and hit-tested as a disc, so the whole terminal is
        // a target, not just its ring.
        cx: RIGHT_X, cy: rowY(r), r: 12, fill: '#16191e', stroke: WIRE_COLORS[c].css, 'stroke-width': 4,
        'pointer-events': 'all',
        'data-right': r, class: 'breaker-terminal', 'aria-label': `${WIRE_COLORS[c].name} terminal`,
      }));
    });
    this._drag = el('line', { class: 'breaker-drag', 'stroke-width': 6, 'stroke-linecap': 'round' });
    svg.appendChild(this._drag);
  }

  _render() {
    const p = this._puzzle;
    if (!this.root || !p) return;

    this.root.querySelectorAll('.breaker-switch').forEach((sw, i) => {
      sw.classList.toggle('is-on', p.switches[i]);
    });

    // Connected leads run across; loose ones hang off their socket.
    this._links.replaceChildren(...p.left.map((c, l) => {
      const r = p.links[l];
      const colour = WIRE_COLORS[c].css;
      return r === null
        ? el('line', { x1: LEFT_X, y1: rowY(l), x2: LEFT_X + 34, y2: rowY(l) + 16, stroke: colour, 'stroke-width': 6, 'stroke-linecap': 'round', class: 'breaker-loose' })
        : el('line', { x1: LEFT_X, y1: rowY(l), x2: RIGHT_X, y2: rowY(r), stroke: colour, 'stroke-width': 6, 'stroke-linecap': 'round', 'data-link': l });
    }));

    const held = this._held;
    this._drag.style.display = held === null ? 'none' : '';
    if (held !== null) {
      this._drag.setAttribute('stroke', WIRE_COLORS[p.left[held]].css);
      this._drag.setAttribute('x1', LEFT_X);
      this._drag.setAttribute('y1', rowY(held));
      this._drag.setAttribute('x2', LEFT_X);
      this._drag.setAttribute('y2', rowY(held));
    }
    this.root.querySelectorAll('[data-left]').forEach((lead, l) => lead.classList.toggle('is-held', l === held));

    const status = this.root.querySelector('.breaker-status');
    if (p.solved) {
      status.textContent = 'Power restored';
      status.classList.add('is-solved');
      if (!this._done()) {
        this._solvedTimer = setTimeout(() => {
          this._solvedTimer = null;
          const { onSolved } = this._callbacks;
          this._callbacks = { ...this._callbacks, onClose: null };   // solved, not abandoned
          this.close();
          onSolved?.();
        }, this.solvedDelayMs);
      }
    } else {
      status.textContent = `Breakers ${p.switchesOn} / ${p.switches.length} · Leads ${p.wiresConnected} / ${p.links.length}`;
      status.classList.remove('is-solved');
    }
  }
}

function rowY(i) {
  return 20 + ROW * i + ROW / 2 - 10;
}

function el(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}
