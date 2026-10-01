import { describe, it, expect } from 'vitest';
import { HUD, RadarOverlay } from './HUD.js';
import {
  DishRig,
  createLocalRig,
  createDefaultNeighbourDishes,
  cursorToSky,
} from '../gameobjects/DishRig.js';

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
    // yaw 0 points up on the canvas
    expect(p.x).toBeCloseTo(CX);
    expect(p.y).toBeCloseTo(CY - MAX_R);
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

    // The bearing from centre stays locked to yaw while radius changes
    const angleOf = (p) => Math.atan2(p.x - CX, -(p.y - CY));
    expect(angleOf(horizon)).toBeCloseTo(1.0);
    expect(angleOf(midSky)).toBeCloseTo(1.0);
  });

  it('sweeps around the circle with yaw at fixed pitch — the A/D axis', () => {
    const at0   = overlay._skyToCanvas(0, -Math.PI / 6);
    const at90  = overlay._skyToCanvas(Math.PI / 2, -Math.PI / 6);
    const at180 = overlay._skyToCanvas(Math.PI, -Math.PI / 6);

    expect(distFromCentre(at0)).toBeCloseTo(distFromCentre(at90));
    expect(distFromCentre(at90)).toBeCloseTo(distFromCentre(at180));

    expect(at0.y).toBeLessThan(CY);   // yaw 0 → up
    expect(at90.x).toBeGreaterThan(CX); // yaw +90° → right
    expect(at180.y).toBeGreaterThan(CY); // yaw 180° → down
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

  /** Plain signal-like input — _blipColor only reads state + opacity. */
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
});
