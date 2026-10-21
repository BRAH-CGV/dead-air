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
// It reads the layout with the root's transform taken off for the moment
// (a transform changes no layout, so this costs a style pass, not a
// reflow), so boxes are in the overlay's own CSS pixels.
// ─────────────────────────────────────────────

const TRANSPARENT = new Set(['transparent', 'rgba(0, 0, 0, 0)', '']);

/**
 * @param {HTMLElement} root  The overlay.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w  The canvas's width, and
 * @param {number} h  height: the overlay is scaled to fill it.
 */
export function paintDom(root, ctx, w, h) {
  const saved = root.style.transform;
  root.style.transform = 'none';
  try {
    const base = root.getBoundingClientRect();
    const view = root.ownerDocument.defaultView;
    ctx.save();
    ctx.scale(base.width ? w / base.width : 1, base.height ? h / base.height : 1);
    paintElement(root, ctx, base, 1, view, true);
    ctx.restore();
  } finally {
    root.style.transform = saved;
  }
}

function paintElement(el, ctx, base, alpha, view, isRoot) {
  const cs = view.getComputedStyle(el);
  if (cs.display === 'none') return;
  const a = isRoot ? alpha : alpha * (parseFloat(cs.opacity) || (cs.opacity === '0' ? 0 : 1));
  if (a <= 0.001) return;
  const visible = isRoot || cs.visibility !== 'hidden';
  const r = rectOf(el.getBoundingClientRect(), base);

  if (visible) {
    ctx.globalAlpha = a;
    paintBox(ctx, cs, r, isRoot);
    const tag = el.tagName;
    if ((tag === 'CANVAS' && el.width > 0) || (tag === 'IMG' && el.complete && el.naturalWidth > 0)) {
      ctx.drawImage(el, r.x, r.y, r.w, r.h);
    } else if (tag === 'INPUT' && el.type === 'range') {
      paintSlider(ctx, el, cs, r);
    }
  }

  let lastText = null;
  for (const node of el.childNodes) {
    if (node.nodeType === 3) {
      if (visible) lastText = paintText(ctx, node, cs, base, a) ?? lastText;
    } else if (node.nodeType === 1) {
      paintElement(node, ctx, base, a, view, false);
    }
  }
  if (visible && lastText) paintAfter(ctx, el, view, lastText, a);
}

function rectOf(b, base) {
  return { x: b.left - base.left, y: b.top - base.top, w: b.width, h: b.height };
}

function paintBox(ctx, cs, r, isRoot) {
  const radius = parseFloat(cs.borderTopLeftRadius) || 0;
  // The root's background is the screen's own: from edge to edge, square
  // (the screen's corners are the ScreenCanvas's to round).
  if (!TRANSPARENT.has(cs.backgroundColor)) {
    ctx.fillStyle = cs.backgroundColor;
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, isRoot ? 0 : radius);
    ctx.fill();
  }
  const bw = parseFloat(cs.borderTopWidth) || 0;
  if (bw > 0 && cs.borderTopStyle !== 'none' && cs.borderTopStyle !== 'hidden' && !TRANSPARENT.has(cs.borderTopColor)) {
    ctx.strokeStyle = cs.borderTopColor;
    ctx.lineWidth = bw;
    ctx.setLineDash(cs.borderTopStyle === 'dashed' ? [bw * 3, bw * 2] : []);
    ctx.beginPath();
    ctx.roundRect(r.x + bw / 2, r.y + bw / 2, r.w - bw, r.h - bw, Math.max(0, radius - bw / 2));
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function paintSlider(ctx, el, cs, r) {
  const min = parseFloat(el.min) || 0;
  const max = parseFloat(el.max) || 100;
  const t = max > min ? Math.min(1, Math.max(0, (parseFloat(el.value) - min) / (max - min))) : 0;
  const accent = cs.accentColor && cs.accentColor !== 'auto' ? cs.accentColor : '#00dcc8';
  const cy = r.y + r.h / 2;
  const thumb = Math.max(4, r.h * 0.35);
  const x0 = r.x + thumb, x1 = r.x + r.w - thumb;
  const x = x0 + (x1 - x0) * t;
  ctx.fillStyle = 'rgba(184, 200, 216, 0.25)';
  ctx.fillRect(x0, cy - 2, x1 - x0, 4);
  ctx.fillStyle = accent;
  ctx.fillRect(x0, cy - 2, x - x0, 4);
  ctx.beginPath();
  ctx.arc(x, cy, thumb, 0, Math.PI * 2);
  ctx.fill();
}

function setFont(ctx, cs) {
  ctx.font = cs.font || `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = cs.letterSpacing && cs.letterSpacing !== 'normal' ? cs.letterSpacing : '0px';
  ctx.fillStyle = cs.color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
}

function transform(text, cs) {
  if (cs.textTransform === 'uppercase') return text.toUpperCase();
  if (cs.textTransform === 'lowercase') return text.toLowerCase();
  return text;
}

/** A text node, line by line where the layout broke it. @returns the
 *  right end and middle of its last line, for an ::after to follow. */
function paintText(ctx, node, cs, base, alpha) {
  const text = node.textContent;
  if (!text || !text.trim()) return null;
  const doc = node.ownerDocument;
  const range = doc.createRange?.();
  if (!range?.getClientRects) return null;
  range.selectNodeContents(node);
  const rects = range.getClientRects();
  if (!rects.length) return null;
  ctx.globalAlpha = alpha;
  setFont(ctx, cs);
  if (rects.length === 1) {
    const r = rectOf(rects[0], base);
    ctx.fillText(transform(text.replace(/\s+/g, ' ').trim(), cs), r.x, r.y + r.h / 2);
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
    ctx.fillText(transform(m[0], cs), r.x, r.y + r.h / 2);
    last = { x: r.x + r.w, y: r.y + r.h / 2 };
  }
  return last;
}

/** An ::after string (the REC mark), straight after the element's text. */
function paintAfter(ctx, el, view, at, alpha) {
  const ps = view.getComputedStyle(el, '::after');
  const content = ps?.content;
  if (!content || content === 'none' || content === 'normal' || content[0] !== '"') return;
  const text = content.slice(1, -1).replace(/\s+/g, ' ');
  if (!text.trim()) return;
  if (ps.display === 'none') return;
  const a = alpha * (ps.opacity === '' ? 1 : parseFloat(ps.opacity));
  if (a <= 0.001) return;
  ctx.globalAlpha = a;
  setFont(ctx, ps);
  ctx.fillText(transform(text, ps), at.x, at.y);
}
