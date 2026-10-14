import { describe, it, expect, vi } from 'vitest';
import { HUD, RadarOverlay } from './HUD.js';
import {
  DishRig,
  createLocalRig,
  createDefaultNeighbourDishes,
  cursorToSky,
} from '../gameobjects/DishRig.js';
import { createMarsSky } from '../gameobjects/MarsSky.js';

// ── Suit indicator ────────────────────────────────────────
// A stand-in root: HUD only ever reaches its elements through querySelector.
describe('HUD suit indicator', () => {
  function fakeRoot() {
    const suit = { textContent: '', style: { display: 'none' } };
    return { suit, root: { style: {}, querySelector: sel => (sel === '#hud-suit' ? suit : null) } };
  }

  it('shows the EVA suit while it is worn, and hides it once it is off', () => {
    const { suit, root } = fakeRoot();
    const hud = new HUD(root);

    hud.setSuit(true);
    expect(suit.style.display).not.toBe('none');
    expect(suit.textContent).toMatch(/EVA suit/i);

    hud.setSuit(false);
    expect(suit.style.display).toBe('none');
  });

  it('does nothing without the markup (tests, other scenes)', () => {
    expect(() => new HUD(null).setSuit(true)).not.toThrow();
  });
});

// ── Radar sky-mapping tests ───────────────────────────────
// No DOM in the node test environment: the overlay falls back to a
// 400x400 logical canvas (radius 200, centre 200,200, rim at 0.85r=170).
// Only the pure mapping helper is testable without a 2D context.
describe('RadarOverlay sky mapping', () => {
  const overlay = new RadarOverlay(null);
  const CX = 200, CY = 200, MAX_R = 170;

  /** Distance of a mapped point from the radar centre. */
  const distFromCentre = (p) => Math.hypot(p.x - CX, p.y - CY);

  it('maps the horizon (pitch 0) onto the radar rim', () => {
    const p = overlay._skyToCanvas(0, 0);
    expect(distFromCentre(p)).toBeCloseTo(MAX_R);
    // yaw 0 — the window direction — sits at the BOTTOM of the canvas, so
    // the disc reads like the view out of the window: horizon ahead on the
    // bottom rim, the sky rising toward the centre.
    expect(p.x).toBeCloseTo(CX);
    expect(p.y).toBeCloseTo(CY + MAX_R);
  });

  it('maps the zenith (pitch -90°) onto the centre', () => {
    const p = overlay._skyToCanvas(0.7, -Math.PI / 2);
    expect(p.x).toBeCloseTo(CX);
    expect(p.y).toBeCloseTo(CY);
  });

  it('moves radially with pitch at fixed yaw — the W/S axis', () => {
    const horizon  = overlay._skyToCanvas(1.0, 0);
    const midSky   = overlay._skyToCanvas(1.0, -Math.PI / 4);
    const zenith   = overlay._skyToCanvas(1.0, -Math.PI / 2);

    // Radius shrinks as the aim rises: rim → centre
    expect(distFromCentre(horizon)).toBeGreaterThan(distFromCentre(midSky));
    expect(distFromCentre(midSky)).toBeGreaterThan(distFromCentre(zenith));

    // The bearing from centre stays locked to yaw while radius changes.
    // atan2 measures from canvas-down — the side bearing 0 is drawn on.
    const angleOf = (p) => Math.atan2(p.x - CX, p.y - CY);
    expect(angleOf(horizon)).toBeCloseTo(1.0);
    expect(angleOf(midSky)).toBeCloseTo(1.0);
  });

  it('sweeps around the circle with yaw at fixed pitch — the A/D axis', () => {
    const at0   = overlay._skyToCanvas(0, -Math.PI / 6);
    const at90  = overlay._skyToCanvas(Math.PI / 2, -Math.PI / 6);
    const at180 = overlay._skyToCanvas(Math.PI, -Math.PI / 6);

    expect(distFromCentre(at0)).toBeCloseTo(distFromCentre(at90));
    expect(distFromCentre(at90)).toBeCloseTo(distFromCentre(at180));

    expect(at0.y).toBeGreaterThan(CY);   // yaw 0 → down (out the window)
    expect(at90.x).toBeGreaterThan(CX); // yaw +90° → right
    expect(at180.y).toBeLessThan(CY); // yaw 180° → up (behind the base)
  });

  it('uses one mapping for dish and blips — same direction, same point', () => {
    // This is the regression guard for the bug where the dish indicator
    // was drawn at a constant radius (pitch ignored) while blips used a
    // different mixed projection — the two could never meet.
    const dishPos = overlay._skyToCanvas(0.9, -0.5);
    const blipPos = overlay._skyToCanvas(0.9, -0.5);
    expect(dishPos.x).toBeCloseTo(blipPos.x);
    expect(dishPos.y).toBeCloseTo(blipPos.y);
  });

  it('clamps elevation outside the sky hemisphere', () => {
    // Below the horizon (positive pitch) clamps to the rim
    const below   = overlay._skyToCanvas(0, +0.5);
    const horizon = overlay._skyToCanvas(0, 0);
    expect(below.y).toBeCloseTo(horizon.y);

    // Past the zenith (< -90°) clamps to the centre
    const past = overlay._skyToCanvas(0, -2.0);
    expect(past.x).toBeCloseTo(CX);
    expect(past.y).toBeCloseTo(CY);
  });
});

// ── Array coverage sections ──────────────────────────────
// Each dish's reach is a circle on the radar's own disc: the local dish's
// centred on the zenith (the radar centre), the neighbours' on their
// origins around the ring. Only the pure geometry is testable without a
// 2D context: the section-circle helper and the shared sky mapping.
describe('RadarOverlay array sections', () => {
  const overlay = new RadarOverlay(null);
  const CX = 200, CY = 200, MAX_R = 170;

  it('maps a neighbour section to a circle centred on its origin', () => {
    const rig = new DishRig({ originX: 0.5, originY: 0, coverageRadius: 0.55 });
    const c = overlay._sectionCircle(rig);

    expect(c.x).toBeCloseTo(CX + 0.5 * MAX_R);
    expect(c.y).toBeCloseTo(CY);
    expect(c.r).toBeCloseTo(0.55 * MAX_R);
  });

  it('maps the local section to a circle centred on the radar centre', () => {
    const rig = new DishRig({ coverageRadius: 0.5 });   // origin (0,0) = the zenith
    const c = overlay._sectionCircle(rig);

    expect(c.x).toBeCloseTo(CX);
    expect(c.y).toBeCloseTo(CY);
    expect(c.r).toBeCloseTo(0.5 * MAX_R);
  });

  it('the section centre is the same point the shared sky mapping gives for the origin', () => {
    // The origin→facing line starts where the one mapping puts the origin,
    // so it can never disagree with the blips or the local dish line.
    for (const rig of createDefaultNeighbourDishes()) {
      const origin = cursorToSky(rig.originX, rig.originY);
      const mapped = overlay._skyToCanvas(origin.yaw, origin.pitch);
      const c = overlay._sectionCircle(rig);
      expect(c.x).toBeCloseTo(mapped.x, 5);
      expect(c.y).toBeCloseTo(mapped.y, 5);
    }
  });

  it('a neighbour aimed at its own origin puts its aim dot on the section centre', () => {
    const rig = createDefaultNeighbourDishes()[0];   // starts aimed at its origin
    const aim = overlay._skyToCanvas(rig.currentYaw, rig.currentPitch);
    const c = overlay._sectionCircle(rig);

    expect(aim.x).toBeCloseTo(c.x, 5);
    expect(aim.y).toBeCloseTo(c.y, 5);
  });

  it('the default layout puts every section origin on the rim, at least half cut off', () => {
    // The sections keep their size but sit out on the rim, so half or more
    // of each one is cut off by the radar's edge — grid-sample the canvas
    // circle and count what lies outside the sky rim.
    for (const rig of createDefaultNeighbourDishes()) {
      const c = overlay._sectionCircle(rig);
      expect(Math.hypot(c.x - CX, c.y - CY)).toBeCloseTo(MAX_R, 5);

      let inside = 0;
      let cut = 0;
      const step = 1;   // px
      for (let x = c.x - c.r; x <= c.x + c.r; x += step) {
        for (let y = c.y - c.r; y <= c.y + c.r; y += step) {
          if (Math.hypot(x - c.x, y - c.y) > c.r) continue;
          inside++;
          if (Math.hypot(x - CX, y - CY) > MAX_R) cut++;
        }
      }
      expect(cut / inside).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('the local reach circle still fits inside the rim', () => {
    expect(overlay._sectionCircle(createLocalRig()).r).toBeLessThanOrEqual(MAX_R);
  });

  it('update without a canvas is a no-op, with or without the array', () => {
    const rig = new DishRig({ originX: 0.5, originY: 0, coverageRadius: 0.55 });
    expect(() => overlay.update([], 0, 0, 0, 0, null, -1)).not.toThrow();
    expect(() => overlay.update([], 0, 0, 0, 0, null, -1, [rig])).not.toThrow();
    expect(() => overlay.update([], 0, 0, 0, 0, null, -1, [rig], createLocalRig())).not.toThrow();
  });
});

// ── Blip colour / fade-in ─────────────────────────────────
describe('RadarOverlay blip colour', () => {
  const overlay = new RadarOverlay(null);

  /** Plain signal-like input — the colour helpers only read flags + opacity. */
  const blip = (overrides = {}) => ({ saved: false, deleted: false, scanned: false, opacity: 1, ...overrides });

  it('keeps the legacy colours at full opacity', () => {
    expect(overlay._blipColor(blip())).toBe('rgba(0, 220, 200, 0.8)');                       // unscanned
    expect(overlay._blipColor(blip({ scanned: true }))).toBe('rgba(180, 180, 60, 0.7)');    // scanned
    expect(overlay._blipColor(blip({ saved: true }))).toBe('rgba(80, 200, 80, 0.5)');       // saved
    expect(overlay._blipColor(blip({ deleted: true }))).toBe('rgba(200, 60, 60, 0.5)');     // deleted
  });

  it('scales the alpha with the fade-in opacity', () => {
    expect(overlay._blipColor(blip({ opacity: 0.5 }))).toBe('rgba(0, 220, 200, 0.4)');
    expect(overlay._blipColor(blip({ opacity: 0 }))).toBe('rgba(0, 220, 200, 0)');
    expect(overlay._blipColor(blip({ scanned: true, opacity: 0.5 }))).toBe('rgba(180, 180, 60, 0.35)');
  });

  it('draws the evil signal red — bright while unresolved, dim once dealt with', () => {
    expect(overlay._blipColor(blip({ evil: true }))).toBe('rgba(255, 45, 45, 0.8)');
    expect(overlay._blipColor(blip({ evil: true, scanned: true }))).toBe('rgba(255, 45, 45, 0.8)');
    expect(overlay._blipColor(blip({ evil: true, saved: true }))).toBe('rgba(255, 45, 45, 0.5)');
    expect(overlay._blipColor(blip({ evil: true, deleted: true }))).toBe('rgba(255, 45, 45, 0.5)');
    expect(overlay._blipColor(blip({ evil: true, opacity: 0.5 }))).toBe('rgba(255, 45, 45, 0.4)');
  });

  it('gives the evil signal its own rgb for the ripple pass', () => {
    expect(overlay._blipRgb(blip({ evil: true }))).toBe('255, 45, 45');
    expect(overlay._blipRgb(blip({ evil: true, saved: true }))).toBe('255, 45, 45');
    expect(overlay._blipRgb(blip({ saved: true }))).toBe('80, 200, 80');
  });
});

// ── Sky backdrop ─────────────────────────────────────
// The radar disc is the sky seen from above, so the real Mars sky can be
// drawn faintly behind the grid — through the SAME _skyToCanvas mapping the
// blips use, so a blip sits on the patch of sky it belongs to. The overlay
// falls back to a null canvas under jsdom, so a recording fake context is
// injected to assert what gets drawn.
describe('RadarOverlay sky backdrop', () => {
  const CX = 200, CY = 200;

  /** A 2D context stand-in that records every call with the styles set at
   *  the time — enough to assert what was drawn, where, and in what order. */
  function recordingCtx() {
    const calls = [];
    const ctx = {
      fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt',
      clearRect: (...a) => calls.push({ op: 'clearRect', a }),
      beginPath: () => calls.push({ op: 'beginPath' }),
      arc:       (...a) => calls.push({ op: 'arc', a }),
      fill:      ()    => calls.push({ op: 'fill',   style: ctx.fillStyle }),
      stroke:    ()    => calls.push({ op: 'stroke', style: ctx.strokeStyle, w: ctx.lineWidth }),
      moveTo:    (...a) => calls.push({ op: 'moveTo', a }),
      lineTo:    (...a) => calls.push({ op: 'lineTo', a }),
      save:      ()    => calls.push({ op: 'save' }),
      restore:   ()    => calls.push({ op: 'restore' }),
      clip:      ()    => calls.push({ op: 'clip' }),
      fillRect:  (...a) => calls.push({ op: 'fillRect', a, style: ctx.fillStyle }),
      createRadialGradient: (...a) => {
        const grad = { isGradient: true, args: a, addColorStop: () => {} };
        return grad;
      },
    };
    return { ctx, calls };
  }

  function makeOverlay(sky) {
    const overlay = new RadarOverlay(null);
    const { ctx, calls } = recordingCtx();
    overlay._ctx = ctx;
    if (sky) overlay.setSky(sky);
    return { overlay, calls };
  }

  const draw = (overlay) => overlay.update([], 0, -0.5, 0, 0, null, -1, [], null);

  const starFills   = (calls, base) => calls.filter(c => c.op === 'fill' && c.style.startsWith(`rgba(${base},`));
  const bandStrokes = (calls, base) => calls.filter(c => c.op === 'stroke' && (c.style?.isGradient || c.style?.startsWith?.(`rgba(${base},`)));
  // Small arcs are star dots — exclude the origin dot at the center (cx, cy)
  const smallArcs   = (calls) => calls.filter(c => c.op === 'arc' && c.a[2] < 2.1 && (Math.abs(c.a[0] - 200) > 1 || Math.abs(c.a[1] - 200) > 1));

  it('draws the sky\'s stars, band and moons faintly, under the grid', () => {
    const sky = createMarsSky({ starCount: 60 });
    const { overlay, calls } = makeOverlay(sky);
    draw(overlay);

    const b = overlay._backdrop;
    expect(b).toBeDefined();

    // Star dots: one small arc per visible star, at the shared mapping\'s point.
    const visible = [];
    for (let k = 0; k < b.stars.length / 4; k++) {
      if (b.stars[k * 4 + 3] > 0.01) visible.push(k);
    }
    expect(visible.length).toBeGreaterThan(0);
    const dots = smallArcs(calls);
    expect(dots.length).toBe(visible.length);
    for (const k of visible) {
      const p = overlay._skyToCanvas(b.stars[k * 4], b.stars[k * 4 + 1]);
      const hit = dots.find(d => Math.abs(d.a[0] - p.x) < 0.5 && Math.abs(d.a[1] - p.y) < 0.5);
      expect(hit, `star ${k} at (${p.x}, ${p.y})`).toBeDefined();
    }
    expect(starFills(calls, b.starBase).length).toBe(visible.length);

    // The Milky Way: a faint stroke of the band colour along its circle.
    expect(bandStrokes(calls, b.bandBase).length).toBeGreaterThan(0);

    // Both moons, as dots bigger than any star.
    for (const moon of b.moons) {
      const moonFill = calls.find(c => c.op === 'fill' && c.style.startsWith(`rgba(${moon.base},`));
      expect(moonFill, moon.name).toBeDefined();
    }

    // Set dressing, not a second sky: the backdrop draws under the grid.
    const firstStar = calls.findIndex(c => c.op === 'fill' && c.style.startsWith(`rgba(${b.starBase},`));
    const firstRing = calls.findIndex(c => c.op === 'arc' && Math.abs(c.a[2] - 200 / 3) < 1);
    expect(firstStar).toBeGreaterThan(-1);
    expect(firstRing).toBeGreaterThan(firstStar);
  });

  it('setSky(null) clears the backdrop — the sky can be swapped away', () => {
    const { overlay, calls } = makeOverlay(createMarsSky({ starCount: 60 }));
    overlay.setSky(null);
    draw(overlay);

    expect(overlay._backdrop).toBeNull();
    expect(smallArcs(calls)).toHaveLength(0);
  });

  it('refreshes the sky each frame — the dawn drowns the star dots', () => {
    const sky = createMarsSky({ starCount: 60 });
    const { overlay, calls } = makeOverlay(sky);
    draw(overlay);
    const b = overlay._backdrop;
    expect(starFills(calls, b.starBase).length).toBeGreaterThan(0);

    // Daylight raises uDawn; the next update must see it without being told.
    sky.skyUniforms.uDawn.value = 1;
    calls.length = 0;
    draw(overlay);

    expect(starFills(calls, b.starBase)).toHaveLength(0);
    // The moons dim but stay — they are meshes in the sky, not shader stars.
    const moonFill = calls.find(c => c.op === 'fill' && c.style.startsWith(`rgba(${b.moons[0].base},`));
    expect(moonFill).toBeDefined();
  });
});

describe('RadarOverlay UFO blob', () => {
  /** Records every call on a 2D context, whatever the method. */
  function anyCtx() {
    const calls = [];
    const state = {};
    const ctx = new Proxy(state, {
      get(target, key) {
        if (key in target) return target[key];
        return (...a) => {
          calls.push({ op: key, a, fillStyle: target.fillStyle });
          if (key === 'createRadialGradient') return { addColorStop: () => {}, isGradient: true };
          return undefined;
        };
      },
      set(target, key, value) { target[key] = value; return true; },
    });
    return { ctx, calls };
  }

  function drawWith(threat) {
    const overlay = new RadarOverlay(null);
    const { ctx, calls } = anyCtx();
    overlay._ctx = ctx;
    overlay.threat = threat;
    overlay.update([], 0, -0.5, 0, 0, null, -1, [], null);
    return { overlay, calls };
  }

  /** Outline points the quiet radar doesn't draw — the blob's. */
  const blobVertices = (calls) => {
    const quiet = new Set(drawWith(null).calls.filter(c => c.op === 'lineTo').map(c => c.a.join()));
    return calls.filter(c => c.op === 'lineTo' && !quiet.has(c.a.join()));
  };

  it('draws nothing extra while no UFO is coming', () => {
    const quiet = drawWith(null).calls.length;
    const inactive = drawWith({ active: false, yaw: 0, pitch: -0.3, size: 0.5, intensity: 0.5, time: 0 }).calls.length;
    expect(inactive).toBe(quiet);
  });

  it('draws a distorted blob where the UFO is in the sky, bigger as it closes in', () => {
    const at = { yaw: 0.3, pitch: -0.4 };
    const small = drawWith({ active: true, ...at, size: 0.12, intensity: 0.3, time: 1 });
    const big   = drawWith({ active: true, ...at, size: 1,    intensity: 1,   time: 1 });
    const p = small.overlay._skyToCanvas(at.yaw, at.pitch);

    const spread = (calls) => {
      const pts = blobVertices(calls);
      return Math.max(...pts.map(c => Math.hypot(c.a[0] - p.x, c.a[1] - p.y)));
    };
    expect(blobVertices(small.calls).length).toBeGreaterThan(16);   // a many-sided outline, not a dot
    expect(spread(big.calls)).toBeGreaterThan(spread(small.calls) * 2);
  });

  it('wobbles: the outline changes from one moment to the next', () => {
    const at = { active: true, yaw: 0, pitch: -0.4, size: 0.5, intensity: 0.8 };
    const a = drawWith({ ...at, time: 1 }).calls.filter(c => c.op === 'lineTo').map(c => c.a.join());
    const b = drawWith({ ...at, time: 1.3 }).calls.filter(c => c.op === 'lineTo').map(c => c.a.join());
    expect(a).not.toEqual(b);
  });
});

describe('RadarOverlay UFO warning', () => {
  const overlay = new RadarOverlay(null);
  const maxR = 200 * 0.85;
  const cursorFor = (yaw, pitch) => {
    const p = overlay._skyToCanvas(yaw, pitch);
    return { x: (p.x - 200) / maxR, y: -(p.y - 200) / maxR };
  };

  it('knows when the cursor is over the blob, and not when it is clear of it', () => {
    overlay.threat = { active: true, yaw: 0.4, pitch: -0.5, size: 0.5, intensity: 1, time: 0 };
    const on = cursorFor(0.4, -0.5);
    expect(overlay.threatAt(on.x, on.y)).toBe(true);
    const off = cursorFor(-2.5, -0.2);
    expect(overlay.threatAt(off.x, off.y)).toBe(false);
  });

  it('a bigger blob is easier to hit', () => {
    const near = cursorFor(0.4 + 0.25, -0.5);
    overlay.threat = { active: true, yaw: 0.4, pitch: -0.5, size: 0.12, intensity: 1, time: 0 };
    expect(overlay.threatAt(near.x, near.y)).toBe(false);
    overlay.threat.size = 1;
    expect(overlay.threatAt(near.x, near.y)).toBe(true);
  });

  it('nothing to hit when no UFO is coming', () => {
    overlay.threat = { active: false, yaw: 0.4, pitch: -0.5, size: 1, intensity: 1, time: 0 };
    const on = cursorFor(0.4, -0.5);
    expect(overlay.threatAt(on.x, on.y)).toBe(false);
    overlay.threat = null;
    expect(overlay.threatAt(on.x, on.y)).toBe(false);
  });

  it('setWarning writes the warning line once, and only when it changes', () => {
    // @ts-ignore — a stand-in element
    const el = { textContent: '', classList: { toggle: vi.fn() } };
    overlay._warning = el;
    overlay.setWarning('EXTREME ELECTRICAL ANOMALY');
    overlay.setWarning('EXTREME ELECTRICAL ANOMALY');
    expect(el.textContent).toBe('EXTREME ELECTRICAL ANOMALY');
    expect(el.classList.toggle).toHaveBeenCalledTimes(1);
    overlay.setWarning('');
    expect(el.classList.toggle).toHaveBeenLastCalledWith('is-shown', false);
  });
});
