// ─────────────────────────────────────────────
// paintDom  –  an overlay's own DOM, painted into a 2D canvas (#161)
// ─────────────────────────────────────────────
// A computer's screen in the world shows what its overlay shows, the same
// whether the player is leaned in to it or across the room: the overlay's
// real DOM is laid out (invisible on the page, `.on-screen` in index.html)
// and this paints it into the screen's canvas. The browser does the layout;
// this only draws what it laid out, so the two can't drift apart. Leaned
// in, the DOM sits on the screen to take the clicks — and its hover states
// and slider values come through here too.
//
//   paintDom(overlay.root, ctx, canvas.width, canvas.height);
//
// What it draws, which is what the overlays use: background colours and
// borders (rounded, dashed), text (font, colour, letter spacing, upper
// case, an ::after string such as REC), canvases and images, and range
// sliders. Not gradients, shadows or other pseudo-elements. Opacity
// (CSS animations included) multiplies down the tree; the root's own
// opacity and visibility are ignored — on a screen it is invisible on the
// page by design.
//
// Reading the layout is the cost (a style per element, every box, every
// line of text), so it is read once and kept as a list of things to draw,
// replayed on every paint: read again only when the DOM changes (a
// MutationObserver), when the pointer moves over or off something or the
// focus moves (a hover or focus changes a look), and every READ_EVERY ms
// for CSS animations (the REC mark blinking). Canvases and slider values
// are read as they are drawn, so the radar and a dragged slider move every
// frame regardless. An element marked `data-paint-live` (the console's
// play line, moved every frame) is drawn where its layout is at the time,
// and changing its style is no fresh read: it is a box in its background
// colour, nothing inside it.
//
// The layout is read with the root's transform taken off for the moment
// (a transform changes no layout, so this costs a style pass, not a
// reflow), so boxes are in the overlay's own CSS pixels.
// ─────────────────────────────────────────────

const TRANSPARENT = new Set(['transparent', 'rgba(0, 0, 0, 0)', '']);

/** Read the layout again at least this often (ms), for CSS animations. */
export const READ_EVERY = 250;

/** root → { ops, read, observer, dirty } */
const pictures = new WeakMap();

/**
 * @param {HTMLElement} root  The overlay.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w  The canvas's width, and
 * @param {number} h  height: the overlay is scaled to fill it.
 */
export function paintDom(root, ctx, w, h) {
  const picture = pictureOf(root);
  if (picture.observer && changed(root, picture.observer.takeRecords())) picture.dirty = true;
  const now = performance.now();
  if (picture.dirty || now - picture.read >= READ_EVERY) {
    record(root, picture);
    picture.read = now;
    picture.dirty = false;
  }
  ctx.save();
  ctx.scale(picture.width ? w / picture.width : 1, picture.height ? h / picture.height : 1);
  for (const op of picture.ops) DRAW[op.k](ctx, op);
  ctx.restore();
}

function pictureOf(root) {
  let picture = pictures.get(root);
  if (picture) return picture;
  picture = { ops: [], read: -Infinity, dirty: true, width: 0, height: 0, observer: null };
  const view = root.ownerDocument.defaultView;
  if (view?.MutationObserver) {
    picture.observer = new view.MutationObserver((records) => { if (changed(root, records)) picture.dirty = true; });
    picture.observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
  }
  const dirty = () => { picture.dirty = true; };
  for (const type of ['pointerover', 'pointerout', 'focusin', 'focusout']) root.addEventListener(type, dirty);
  pictures.set(root, picture);
  return picture;
}

/** Whether any of `records` changes the look. The root's own style is
 *  only where it is laid on the screen (ScreenView, every frame). */
function changed(root, records) {
  for (const r of records) {
    const moved = r.type === 'attributes' && r.attributeName === 'style'
      && (r.target === root || r.target.dataset?.paintLive !== undefined);
    if (!moved) return true;
  }
  return false;
}

/** Read the layout into a list of things to draw. */
function record(root, picture) {
  const saved = root.style.transform;
  root.style.transform = 'none';
  try {
    const b = root.getBoundingClientRect();
    const base = { left: b.left, top: b.top, width: b.width, height: b.height, root };
    picture.width = base.width;
    picture.height = base.height;
    picture.ops.length = 0;
    recordElement(root, picture.ops, base, 1, root.ownerDocument.defaultView, true);
  } finally {
    root.style.transform = saved;
  }
  // Putting the transform back is a change of our own, not the DOM's.
  picture.observer?.takeRecords();
}

function recordElement(el, ops, base, alpha, view, isRoot) {
  const cs = view.getComputedStyle(el);
  if (!isRoot && el.dataset?.paintLive !== undefined) {
    // Recorded even while hidden: whether it shows is read as it is drawn.
    ops.push({ k: 'live', el, root: base.root, a: alpha * (parseFloat(cs.opacity) || 1), colour: cs.backgroundColor });
    return;
  }
  if (cs.display === 'none') return;
  const a = isRoot ? alpha : alpha * (parseFloat(cs.opacity) || (cs.opacity === '0' ? 0 : 1));
  if (a <= 0.001) return;
  const visible = isRoot || cs.visibility !== 'hidden';
  const r = rectOf(el.getBoundingClientRect(), base);

  if (visible) {
    recordBox(ops, cs, r, a, isRoot);
    const tag = el.tagName;
    if (tag === 'CANVAS' || tag === 'IMG') {
      ops.push({ k: 'image', el, a, ...r });
    } else if (tag === 'INPUT' && el.type === 'range') {
      ops.push({ k: 'slider', el, a, accent: cs.accentColor && cs.accentColor !== 'auto' ? cs.accentColor : '#00dcc8', ...r });
    }
  }

  let lastText = null;
  for (const node of el.childNodes) {
    if (node.nodeType === 3) {
      if (visible) lastText = recordText(ops, node, cs, base, a) ?? lastText;
    } else if (node.nodeType === 1) {
      recordElement(node, ops, base, a, view, false);
    }
  }
  if (visible && lastText) recordAfter(ops, el, view, lastText, a);
}

function rectOf(b, base) {
  return { x: b.left - base.left, y: b.top - base.top, w: b.width, h: b.height };
}

function recordBox(ops, cs, r, a, isRoot) {
  const radius = parseFloat(cs.borderTopLeftRadius) || 0;
  // The root's background is the screen's own: from edge to edge, square
  // (the screen's corners are the ScreenCanvas's to round).
  if (!TRANSPARENT.has(cs.backgroundColor)) {
    ops.push({ k: 'fill', a, colour: cs.backgroundColor, radius: isRoot ? 0 : radius, ...r });
  }
  const bw = parseFloat(cs.borderTopWidth) || 0;
  if (bw > 0 && cs.borderTopStyle !== 'none' && cs.borderTopStyle !== 'hidden' && !TRANSPARENT.has(cs.borderTopColor)) {
    ops.push({
      k: 'border', a, colour: cs.borderTopColor, bw, dashed: cs.borderTopStyle === 'dashed',
      radius: Math.max(0, radius - bw / 2), x: r.x + bw / 2, y: r.y + bw / 2, w: r.w - bw, h: r.h - bw,
    });
  }
}

function fontOf(cs) {
  return {
    font: cs.font || `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`,
    spacing: cs.letterSpacing && cs.letterSpacing !== 'normal' ? cs.letterSpacing : '0px',
    colour: cs.color,
  };
}

function transform(text, cs) {
  if (cs.textTransform === 'uppercase') return text.toUpperCase();
  if (cs.textTransform === 'lowercase') return text.toLowerCase();
  return text;
}

/** A text node, line by line where the layout broke it. @returns the
 *  right end and middle of its last line, for an ::after to follow. */
function recordText(ops, node, cs, base, a) {
  const text = node.textContent;
  if (!text || !text.trim()) return null;
  const range = node.ownerDocument.createRange?.();
  if (!range?.getClientRects) return null;
  range.selectNodeContents(node);
  const rects = range.getClientRects();
  if (!rects.length) return null;
  const font = fontOf(cs);
  if (rects.length === 1) {
    const r = rectOf(rects[0], base);
    ops.push({ k: 'text', a, ...font, s: transform(text.replace(/\s+/g, ' ').trim(), cs), x: r.x, y: r.y + r.h / 2 });
    return { x: r.x + r.w, y: r.y + r.h / 2 };
  }
  // Broken over lines: each word where the layout put it.
  let last = null;
  for (const m of text.matchAll(/\S+/g)) {
    range.setStart(node, m.index);
    range.setEnd(node, m.index + m[0].length);
    const wr = range.getClientRects()[0];
    if (!wr) continue;
    const r = rectOf(wr, base);
    ops.push({ k: 'text', a, ...font, s: transform(m[0], cs), x: r.x, y: r.y + r.h / 2 });
    last = { x: r.x + r.w, y: r.y + r.h / 2 };
  }
  return last;
}

/** An ::after string (the REC mark), straight after the element's text. */
function recordAfter(ops, el, view, at, alpha) {
  const ps = view.getComputedStyle(el, '::after');
  const content = ps?.content;
  if (!content || content === 'none' || content === 'normal' || content[0] !== '"') return;
  const text = content.slice(1, -1).replace(/\s+/g, ' ');
  if (!text.trim() || ps.display === 'none') return;
  const a = alpha * (ps.opacity === '' ? 1 : parseFloat(ps.opacity));
  if (a <= 0.001) return;
  ops.push({ k: 'text', a, ...fontOf(ps), s: transform(text, ps), x: at.x, y: at.y });
}

const DRAW = {
  fill(ctx, op) {
    ctx.globalAlpha = op.a;
    ctx.fillStyle = op.colour;
    ctx.beginPath();
    ctx.roundRect(op.x, op.y, op.w, op.h, op.radius);
    ctx.fill();
  },
  border(ctx, op) {
    ctx.globalAlpha = op.a;
    ctx.strokeStyle = op.colour;
    ctx.lineWidth = op.bw;
    ctx.setLineDash(op.dashed ? [op.bw * 3, op.bw * 2] : []);
    ctx.beginPath();
    ctx.roundRect(op.x, op.y, op.w, op.h, op.radius);
    ctx.stroke();
    ctx.setLineDash([]);
  },
  image(ctx, op) {
    const el = op.el;
    if (el.tagName === 'CANVAS' ? el.width <= 0 : !(el.complete && el.naturalWidth > 0)) return;
    ctx.globalAlpha = op.a;
    ctx.drawImage(el, op.x, op.y, op.w, op.h);
  },
  slider(ctx, op) {
    const el = op.el;
    const min = parseFloat(el.min) || 0;
    const max = parseFloat(el.max) || 100;
    const t = max > min ? Math.min(1, Math.max(0, (parseFloat(el.value) - min) / (max - min))) : 0;
    const cy = op.y + op.h / 2;
    const thumb = Math.max(4, op.h * 0.35);
    const x0 = op.x + thumb, x1 = op.x + op.w - thumb;
    const x = x0 + (x1 - x0) * t;
    ctx.globalAlpha = op.a;
    ctx.fillStyle = 'rgba(184, 200, 216, 0.25)';
    ctx.fillRect(x0, cy - 2, x1 - x0, 4);
    ctx.fillStyle = op.accent;
    ctx.fillRect(x0, cy - 2, x - x0, 4);
    ctx.beginPath();
    ctx.arc(x, cy, thumb, 0, Math.PI * 2);
    ctx.fill();
  },
  /** Where its layout is now, from offsets: no style read, no transform. */
  live(ctx, op) {
    const el = op.el;
    if (!el.offsetParent || TRANSPARENT.has(op.colour)) return;
    let x = 0, y = 0;
    for (let p = el; p && p !== op.root; p = p.offsetParent) {
      x += p.offsetLeft;
      y += p.offsetTop;
    }
    ctx.globalAlpha = op.a;
    ctx.fillStyle = op.colour;
    ctx.beginPath();
    ctx.roundRect(x, y, el.offsetWidth, el.offsetHeight, 0);
    ctx.fill();
  },
  text(ctx, op) {
    ctx.globalAlpha = op.a;
    ctx.font = op.font;
    if ('letterSpacing' in ctx) ctx.letterSpacing = op.spacing;
    ctx.fillStyle = op.colour;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(op.s, op.x, op.y);
  },
};
