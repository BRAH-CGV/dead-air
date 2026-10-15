// ─────────────────────────────────────────────
// introDraw  –  the intro's pictures, on a 2D canvas
// ─────────────────────────────────────────────
// One painter per beat of IntroTimeline. Each is handed the beat's
// progress (0..1) and its seconds (`local`), and paints the whole frame:
// no state is kept between frames, so a skip or a resize just works.
// Flat shapes and gradients, no images: nothing to load.
//
// The pure helpers (where the ship is, how far the zoom has gone, what the
// colony's signal is doing) are exported for the tests.
// ─────────────────────────────────────────────

const TAU = Math.PI * 2;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
/** 0..1 across [a, b] of p. */
const seg = (p, a, b) => clamp01((p - a) / (b - a));
const lerp = (a, b, t) => a + (b - a) * t;

const COLOURS = Object.freeze({
  space: ['#05060c', '#0d1020'],
  marsDusk: ['#2a1410', '#7a3a1e'],
  marsNight: ['#04050a', '#1a0e0c'],
  ground: '#5a2a16',
  groundFar: '#3e1d10',
  green: [110, 207, 154],
  red: [230, 60, 50],
  amber: '#ffd27a',
  glass: 'rgba(170, 220, 255, 0.18)',
});

/** Stars as fractions of the screen, each with its own twinkle. */
export function makeStars(count, random = Math.random) {
  const stars = [];
  for (let i = 0; i < count; i++) {
    // Spread one number over the square, so a fixed `random` still scatters them.
    const u = (random() + i * 0.6180339887) % 1;
    const v = (random() * 0.5 + i * 0.7548776662) % 1;
    stars.push({ x: u, y: v, r: 0.5 + ((i * 7) % 5) * 0.3, phase: (i * 2.399) % TAU, rate: 0.8 + (i % 7) * 0.3 });
  }
  return stars;
}

/**
 * The colony's call home through the silence beat: steady and green, then
 * red and wavy, then gone.
 * @returns {{ on: boolean, red: number, wobble: number }}
 */
export function signalState(p) {
  return {
    on: p < 0.8,
    red: smooth(seg(p, 0.3, 0.55)),
    wobble: smooth(seg(p, 0.35, 0.75)),
  };
}

/** The ship on its way from Earth (left) to Mars (right), into `out`. */
export function voyagePath(p, w, h, out) {
  const m = Math.min(w, h);
  const t = smooth(p);
  const ex = w * 0.16 + m * 0.12, ey = h * 0.62;
  const mx = w * 0.84 - m * 0.09, my = h * 0.38;
  out.x = lerp(ex, mx, t);
  out.y = lerp(ey, my, t) - Math.sin(Math.PI * t) * h * 0.12;
  out.angle = Math.atan2(my - ey - Math.cos(Math.PI * t) * h * 0.12 * Math.PI, mx - ex);
  return out;
}

/** Mars's radius, in shares of the screen's short side, closing in on it. */
export function landingZoom(p) {
  return 0.12 * Math.pow(30, smooth(seg(p, 0, 0.55)));
}

/** Where the buggy is across the drive: in from the left, slowing at the array. */
export function buggyX(p, w) {
  const t = 1 - Math.pow(1 - clamp01(p), 2);
  return lerp(-0.15 * w, 0.58 * w, t);
}

// ── Shared pieces ──────────────────────────

function sky(ctx, w, h, [top, bottom]) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function stars(ctx, w, h, list, time, alpha = 1, below = 1) {
  ctx.fillStyle = '#ffffff';
  for (const s of list) {
    if (s.y > below) continue;
    ctx.globalAlpha = alpha * (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(time * s.rate + s.phase)));
    ctx.fillRect(s.x * w, s.y * h, s.r, s.r);
  }
  ctx.globalAlpha = 1;
}

function planet(ctx, x, y, r, kind) {
  const earth = kind === 'earth';
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  g.addColorStop(0, earth ? '#5fa8e8' : '#d8683a');
  g.addColorStop(1, earth ? '#0c2a5a' : '#4a1606');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  // Land, or Mars's darker ground.
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.clip();
  ctx.fillStyle = earth ? 'rgba(80, 160, 90, 0.85)' : 'rgba(70, 20, 8, 0.45)';
  for (const [dx, dy, rx, ry] of [[-0.3, -0.2, 0.35, 0.22], [0.25, 0.25, 0.3, 0.18], [0.1, -0.5, 0.2, 0.1]]) {
    ctx.beginPath();
    ctx.ellipse(x + dx * r, y + dy * r, rx * r, ry * r, 0.4, 0, TAU);
    ctx.fill();
  }
  // Night side.
  const shade = ctx.createLinearGradient(x - r, y, x + r, y);
  shade.addColorStop(0.55, 'rgba(0, 0, 0, 0)');
  shade.addColorStop(1, 'rgba(0, 0, 0, 0.75)');
  ctx.fillStyle = shade;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

function ship(ctx, x, y, size, angle, time, { flame = true, colour = '#c8ccd8' } = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  if (flame) {
    const f = size * (0.9 + 0.3 * Math.sin(time * 40));
    ctx.fillStyle = '#ffb347';
    ctx.beginPath();
    ctx.moveTo(-size * 0.9, -size * 0.22);
    ctx.lineTo(-size * 0.9 - f, 0);
    ctx.lineTo(-size * 0.9, size * 0.22);
    ctx.fill();
  }
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(size * 0.2, -size * 0.32);
  ctx.lineTo(-size * 0.9, -size * 0.32);
  ctx.lineTo(-size * 0.9, size * 0.32);
  ctx.lineTo(size * 0.2, size * 0.32);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#00dcc8';
  ctx.fillRect(size * 0.1, -size * 0.1, size * 0.2, size * 0.2);
  ctx.restore();
}

/** Mars's surface in a band across the bottom, with low hills behind. */
function ground(ctx, w, h, horizon, scroll = 0) {
  ctx.fillStyle = COLOURS.groundFar;
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let i = 0; i <= 24; i++) {
    const x = (i / 24) * w;
    const u = i / 24 + scroll * 0.3;
    ctx.lineTo(x, horizon - h * 0.05 * (0.6 + 0.4 * Math.sin(u * 9) * Math.sin(u * 3.7)));
  }
  ctx.lineTo(w, h);
  ctx.fill();
  ctx.fillStyle = COLOURS.ground;
  ctx.fillRect(0, horizon, w, h - horizon);
}

/** The colony: glass domes with tomato plants growing, and a mast. */
function colony(ctx, w, h, { grow, lit, time }) {
  const m = Math.min(w, h);
  const base = h * 0.74;
  for (let i = 0; i < 3; i++) {
    const cx = w * (0.22 + i * 0.17);
    const r = m * (0.1 - i * 0.012);
    // Plants: stems rising with `grow`, fruit once grown.
    for (let k = -2; k <= 2; k++) {
      const px = cx + k * r * 0.3;
      const ph = r * 0.75 * grow * (0.7 + 0.3 * Math.abs(Math.sin(k + i)));
      ctx.strokeStyle = lit ? '#5fbf6a' : '#3a3f36';
      ctx.lineWidth = Math.max(1, m * 0.004);
      ctx.beginPath();
      ctx.moveTo(px, base);
      ctx.lineTo(px + Math.sin(time + k) * 2, base - ph);
      ctx.stroke();
      if (grow > 0.7) {
        ctx.fillStyle = lit ? '#e04a3a' : '#40302c';
        ctx.beginPath();
        ctx.arc(px, base - ph * 0.7, m * 0.006, 0, TAU);
        ctx.fill();
      }
    }
    ctx.fillStyle = lit ? 'rgba(255, 220, 150, 0.12)' : 'rgba(30, 30, 40, 0.3)';
    ctx.strokeStyle = 'rgba(200, 230, 255, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, base, r, Math.PI, TAU);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  // The mast that calls home.
  const mx = w * 0.78;
  ctx.strokeStyle = '#9aa0aa';
  ctx.lineWidth = Math.max(1.5, m * 0.004);
  ctx.beginPath();
  ctx.moveTo(mx, base);
  ctx.lineTo(mx, base - m * 0.28);
  ctx.stroke();
  ctx.fillStyle = lit ? '#ff4a3a' : '#301010';
  ctx.beginPath();
  ctx.arc(mx, base - m * 0.28, m * 0.008, 0, TAU);
  ctx.fill();
  return { x: mx, y: base - m * 0.28 };
}

/** Rings rising off the mast: green and steady, or red and shaking. */
function radioWaves(ctx, w, h, from, time, { red = 0, wobble = 0 } = {}) {
  const m = Math.min(w, h);
  const [gr, gg, gb] = COLOURS.green;
  const [rr, rg, rb] = COLOURS.red;
  const r = Math.round(lerp(gr, rr, red)), g = Math.round(lerp(gg, rg, red)), b = Math.round(lerp(gb, rb, red));
  for (let i = 0; i < 4; i++) {
    const age = (time * 0.6 + i / 4) % 1;
    const radius = m * (0.04 + age * 0.4);
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${(1 - age) * 0.9})`;
    ctx.lineWidth = Math.max(1.5, m * 0.004);
    ctx.beginPath();
    const steps = 28;
    for (let s = 0; s <= steps; s++) {
      const a = Math.PI * 1.15 + (s / steps) * Math.PI * 0.7;
      const shake = wobble * m * 0.02 * Math.sin(s * 1.9 + time * 23 + i);
      const x = from.x + Math.cos(a) * (radius + shake);
      const y = from.y + Math.sin(a) * (radius + shake);
      if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

/** The call home as a trace across the bottom: a sine, then noise, then flat. */
function trace(ctx, w, h, time, { on = true, red = 0, wobble = 0 } = {}) {
  const y0 = h * 0.9;
  const amp = h * 0.025;
  const [gr, gg, gb] = COLOURS.green;
  const [rr, rg, rb] = COLOURS.red;
  ctx.strokeStyle = `rgb(${Math.round(lerp(gr, rr, red))}, ${Math.round(lerp(gg, rg, red))}, ${Math.round(lerp(gb, rb, red))})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= 80; i++) {
    const x = w * (0.1 + 0.8 * i / 80);
    const steady = Math.sin(i * 0.5 - time * 6);
    const noise = Math.sin(i * 2.3 + time * 31) * Math.sin(i * 0.7 - time * 13);
    const y = on ? y0 - amp * lerp(steady, noise * 1.8, wobble) : y0;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/** Glitch: a few shifted bars of red across the frame. */
function glitch(ctx, w, h, time, amount) {
  if (amount <= 0) return;
  const bands = Math.floor(2 + amount * 6);
  for (let i = 0; i < bands; i++) {
    const y = ((Math.sin(time * 17 + i * 12.9) * 0.5 + 0.5) * h);
    ctx.fillStyle = `rgba(230, 60, 50, ${0.12 * amount})`;
    ctx.fillRect(0, y, w, h * 0.012 * (1 + i % 3));
  }
}

function bunker(ctx, w, h, horizon, { lit = true } = {}) {
  const m = Math.min(w, h);
  const x = w * 0.8;
  // Sloped berm.
  ctx.fillStyle = '#4a4440';
  ctx.beginPath();
  ctx.moveTo(x - m * 0.2, horizon);
  ctx.lineTo(x - m * 0.12, horizon - m * 0.1);
  ctx.lineTo(x + m * 0.14, horizon - m * 0.1);
  ctx.lineTo(x + m * 0.22, horizon);
  ctx.fill();
  // The office window, lit.
  ctx.fillStyle = lit ? 'rgba(255, 210, 122, 0.8)' : '#1a1a1a';
  ctx.fillRect(x - m * 0.04, horizon - m * 0.075, m * 0.07, m * 0.03);
  // The dish on its tower.
  const dx = x + m * 0.3;
  ctx.strokeStyle = '#8a8f98';
  ctx.lineWidth = Math.max(1.5, m * 0.005);
  ctx.beginPath();
  ctx.moveTo(dx, horizon);
  ctx.lineTo(dx, horizon - m * 0.2);
  ctx.stroke();
  ctx.fillStyle = '#c0c4cc';
  ctx.beginPath();
  ctx.ellipse(dx, horizon - m * 0.22, m * 0.07, m * 0.03, -0.5, 0, TAU);
  ctx.fill();
}

function buggy(ctx, x, y, size, time) {
  const bob = Math.sin(time * 9) * size * 0.03;
  // Headlight.
  const beam = ctx.createLinearGradient(x + size * 0.5, 0, x + size * 2.4, 0);
  beam.addColorStop(0, 'rgba(255, 240, 200, 0.35)');
  beam.addColorStop(1, 'rgba(255, 240, 200, 0)');
  ctx.fillStyle = beam;
  ctx.beginPath();
  ctx.moveTo(x + size * 0.5, y - size * 0.35 + bob);
  ctx.lineTo(x + size * 2.4, y - size * 0.6);
  ctx.lineTo(x + size * 2.4, y + size * 0.05);
  ctx.closePath();
  ctx.fill();
  // Body and roll cage.
  ctx.fillStyle = '#b8b0a0';
  ctx.fillRect(x - size * 0.55, y - size * 0.42 + bob, size * 1.1, size * 0.22);
  ctx.strokeStyle = '#d8d8d8';
  ctx.lineWidth = Math.max(1, size * 0.04);
  ctx.beginPath();
  ctx.moveTo(x - size * 0.35, y - size * 0.42 + bob);
  ctx.lineTo(x - size * 0.2, y - size * 0.8 + bob);
  ctx.lineTo(x + size * 0.2, y - size * 0.8 + bob);
  ctx.lineTo(x + size * 0.3, y - size * 0.42 + bob);
  ctx.stroke();
  // Wheels, turning.
  for (const wx of [-0.38, 0.38]) {
    ctx.fillStyle = '#1c1c1c';
    ctx.beginPath();
    ctx.arc(x + wx * size, y - size * 0.15, size * 0.17, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1;
    const a = time * 12;
    ctx.beginPath();
    ctx.moveTo(x + wx * size, y - size * 0.15);
    ctx.lineTo(x + wx * size + Math.cos(a) * size * 0.15, y - size * 0.15 + Math.sin(a) * size * 0.15);
    ctx.stroke();
  }
  // Dust behind.
  for (let i = 0; i < 5; i++) {
    const age = (time * 1.5 + i / 5) % 1;
    ctx.fillStyle = `rgba(150, 90, 60, ${0.35 * (1 - age)})`;
    ctx.beginPath();
    ctx.arc(x - size * (0.6 + age * 1.2), y - size * (0.1 + age * 0.3), size * (0.08 + age * 0.25), 0, TAU);
    ctx.fill();
  }
}

// ── The beats ──────────────────────────────

const _ship = { x: 0, y: 0, angle: 0 };
/** The lander comes down on its burn: nose up, flame to the ground. */
const NOSE_UP = -Math.PI / 2;

const PAINTERS = {
  voyage(ctx, w, h, p, time, scene) {
    const m = Math.min(w, h);
    sky(ctx, w, h, COLOURS.space);
    stars(ctx, w, h, scene.stars, time);
    planet(ctx, w * 0.16, h * 0.62, m * 0.12, 'earth');
    planet(ctx, w * 0.84, h * 0.38, m * 0.09, 'mars');
    // The way it came, dotted.
    ctx.fillStyle = 'rgba(200, 204, 216, 0.35)';
    for (let i = 0; i < 24; i++) {
      const q = (i / 24) * p;
      voyagePath(q, w, h, _ship);
      ctx.fillRect(_ship.x, _ship.y, 2, 2);
    }
    voyagePath(p, w, h, _ship);
    ship(ctx, _ship.x, _ship.y, m * 0.03, _ship.angle, time);
  },

  colony(ctx, w, h, p, time) {
    const m = Math.min(w, h);
    sky(ctx, w, h, COLOURS.marsDusk);
    // Earth, a blue point it calls.
    ctx.fillStyle = '#7fb8ff';
    ctx.beginPath();
    ctx.arc(w * 0.15, h * 0.18, m * 0.006, 0, TAU);
    ctx.fill();
    ground(ctx, w, h, h * 0.74);
    const mast = colony(ctx, w, h, { grow: smooth(seg(p, 0.05, 0.9)), lit: true, time });
    radioWaves(ctx, w, h, mast, time);
    trace(ctx, w, h, time);
  },

  silence(ctx, w, h, p, time) {
    const s = signalState(p);
    const dark = smooth(seg(p, 0.8, 0.95));
    sky(ctx, w, h, COLOURS.marsDusk);
    ground(ctx, w, h, h * 0.74);
    const mast = colony(ctx, w, h, { grow: 1, lit: s.on, time });
    if (s.on) radioWaves(ctx, w, h, mast, time, s);
    trace(ctx, w, h, time, s);
    glitch(ctx, w, h, time, s.on ? s.wobble : 0);
    if (dark > 0) {
      ctx.fillStyle = `rgba(0, 0, 0, ${0.6 * dark})`;
      ctx.fillRect(0, 0, w, h);
    }
  },

  sky(ctx, w, h, p, time, scene) {
    const m = Math.min(w, h);
    sky(ctx, w, h, COLOURS.marsNight);
    stars(ctx, w, h, scene.stars, time, 1, 0.7);
    // Something up there: a slow red glow.
    const glow = 0.25 + 0.15 * Math.sin(time * 1.3);
    const g = ctx.createRadialGradient(w * 0.6, h * 0.2, 0, w * 0.6, h * 0.2, m * 0.35);
    g.addColorStop(0, `rgba(200, 40, 30, ${glow * smooth(seg(p, 0.1, 0.6))})`);
    g.addColorStop(1, 'rgba(200, 40, 30, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ground(ctx, w, h, h * 0.78);
    // Colonies along the horizon, going out one by one.
    const count = 9;
    for (let i = 0; i < count; i++) {
      const out = p > 0.15 + (i / count) * 0.7;
      ctx.fillStyle = out ? '#2a1a14' : COLOURS.amber;
      ctx.beginPath();
      ctx.arc(w * (0.08 + i * 0.105), h * 0.785, m * 0.007, 0, TAU);
      ctx.fill();
    }
  },

  ship(ctx, w, h, p, time, scene) {
    const m = Math.min(w, h);
    sky(ctx, w, h, COLOURS.space);
    stars(ctx, w, h, scene.stars, time);
    planet(ctx, w * 0.16, h * 0.62, m * 0.12, 'earth');
    planet(ctx, w * 0.84, h * 0.38, m * 0.09, 'mars');
    voyagePath(p, w, h, _ship);
    ship(ctx, _ship.x, _ship.y, m * 0.035, _ship.angle, time, { colour: '#e8d8b0' });
    // You are on this one.
    const r = m * 0.07;
    ctx.strokeStyle = COLOURS.amber;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(time * 4);
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ctx.beginPath();
      ctx.moveTo(_ship.x + sx * r, _ship.y + sy * r * 0.5);
      ctx.lineTo(_ship.x + sx * r, _ship.y + sy * r);
      ctx.lineTo(_ship.x + sx * r * 0.5, _ship.y + sy * r);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },

  landing(ctx, w, h, p, time, scene) {
    const m = Math.min(w, h);
    if (p < 0.55) {
      // Closing in: Mars grows and sinks until its edge is the horizon.
      sky(ctx, w, h, COLOURS.space);
      stars(ctx, w, h, scene.stars, time, 1 - seg(p, 0.3, 0.55));
      const r = landingZoom(p) * m;
      const sink = smooth(seg(p, 0, 0.55));
      planet(ctx, w * lerp(0.5, 0.5, sink), h * 0.5 + r * sink * 0.92, r, 'mars');
      ship(ctx, w * 0.5, h * lerp(0.35, 0.3, sink), m * 0.03, NOSE_UP, time);
      return;
    }
    // Down to the ground, the flame kicking up dust.
    const q = seg(p, 0.55, 1);
    const horizon = h * 0.72;
    sky(ctx, w, h, COLOURS.marsDusk);
    ground(ctx, w, h, horizon);
    const land = smooth(seg(q, 0, 0.75));
    const y = lerp(-h * 0.1, horizon - m * 0.04, land);
    ship(ctx, w * 0.5, y, m * 0.045, NOSE_UP, time, { flame: land < 1 });
    // Dust kicked up by the burn, once it is near the ground.
    const dust = seg(q, 0.62, 1);
    if (dust > 0) {
      ctx.fillStyle = `rgba(150, 90, 60, ${0.5 * (1 - dust)})`;
      ctx.beginPath();
      ctx.ellipse(w * 0.5, horizon, m * (0.05 + 0.25 * dust), m * 0.05 * (1 + dust), 0, 0, TAU);
      ctx.fill();
    }
  },

  drive(ctx, w, h, p, time, scene) {
    const m = Math.min(w, h);
    const horizon = h * 0.75;
    sky(ctx, w, h, COLOURS.marsNight);
    stars(ctx, w, h, scene.stars, time, 1, 0.65);
    ground(ctx, w, h, horizon, p);
    bunker(ctx, w, h, horizon);
    buggy(ctx, buggyX(p, w), horizon + m * 0.02, m * 0.09, time);
  },

  begin(ctx, w, h, p, time, scene) {
    sky(ctx, w, h, COLOURS.marsNight);
    stars(ctx, w, h, scene.stars, time, 0.4);
  },
};

/**
 * Paint one frame of the intro.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w  The canvas, in pixels
 * @param {number} h
 * @param {{ id: string, progress: number, local: number }} info  From beatAt()
 * @param {{ stars: Array }} scene  Made once: makeStars()
 */
export function drawIntro(ctx, w, h, info, scene) {
  const paint = PAINTERS[info.id] ?? PAINTERS.begin;
  ctx.globalAlpha = 1;
  paint(ctx, w, h, clamp01(info.progress), info.local, scene);
  // A dip to black between beats, so one scene never cuts to the next.
  const dip = beatDip(info.local, info.beat?.seconds);
  if (dip > 0) {
    ctx.fillStyle = `rgba(0, 0, 0, ${dip})`;
    ctx.fillRect(0, 0, w, h);
  }
}

/** How dark the frame is dipped at a beat's ends: 1 at the cut, 0 from
 *  BEAT_DIP seconds in. The held end card only fades up. */
export function beatDip(local, seconds) {
  const fromStart = local / BEAT_DIP;
  const toEnd = Number.isFinite(seconds) ? (seconds - local) / BEAT_DIP : Infinity;
  return 1 - smooth(Math.min(fromStart, toEnd));
}

/** Seconds of a beat's dip to black, at each end. */
export const BEAT_DIP = 0.45;
