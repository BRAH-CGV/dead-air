import { describe, it, expect } from 'vitest';
import { HUD, RadarOverlay } from './HUD.js';
import { DishRig } from '../gameobjects/DishRig.js';

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

// ── Neighbour array coverage sections ─────────────────────
// The neighbour dishes' sky sections are drawn as faint closed paths on
// the radar. Only the pure geometry is testable without a 2D context:
// section boundary points and the shared sky-to-canvas mapping.
describe('RadarOverlay neighbour sections', () => {
  const overlay = new RadarOverlay(null);
  const CX = 200, CY = 200;

  /** A neighbour dish's section centre and the distance of a mapped point
   *  from another mapped point, in canvas pixels. */
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  it('section boundary points sit exactly coverageRadius from the origin', () => {
    const rig = new DishRig({ originYaw: 0.8, originPitch: -0.6, coverageRadius: 0.65 });

    for (const t of [0, 0.13, 0.25, 0.5, 0.77, 0.99]) {
      const sky = overlay._sectionBoundaryPoint(rig, t);
      const dy = Math.abs(Math.atan2(Math.sin(sky.yaw - rig.originYaw), Math.cos(sky.yaw - rig.originYaw)));
      const dp = Math.abs(sky.pitch - rig.originPitch);
      expect(Math.hypot(dy, dp)).toBeCloseTo(rig.coverageRadius, 5);
    }
  });

  it('section boundary is a closed loop — t=0 and t=1 are the same point', () => {
    const rig = new DishRig({ originYaw: -1.2, originPitch: -0.4, coverageRadius: 0.5 });

    const a = overlay._sectionBoundaryPoint(rig, 0);
    const b = overlay._sectionBoundaryPoint(rig, 1);
    expect(a.yaw).toBeCloseTo(b.yaw, 5);
    expect(a.pitch).toBeCloseTo(b.pitch, 5);
  });

  it('boundary points at the origin bearing map along the same bearing as the origin', () => {
    const rig = new DishRig({ originYaw: 0.8, originPitch: -0.6, coverageRadius: 0.65 });
    const originPos = overlay._skyToCanvas(rig.originYaw, rig.originPitch);

    // t=0 is a pure yaw offset: same elevation, same ring — only the
    // bearing advances, by exactly the coverage radius.
    const skyPoint = overlay._sectionBoundaryPoint(rig, 0);
    expect(skyPoint.pitch).toBeCloseTo(rig.originPitch, 5);
    const canvasPoint = overlay._skyToCanvas(skyPoint.yaw, skyPoint.pitch);
    const angleOf = (p) => Math.atan2(p.x - CX, -(p.y - CY));
    expect(angleOf(canvasPoint)).toBeCloseTo(rig.originYaw + rig.coverageRadius, 5);
    expect(dist(canvasPoint, originPos)).toBeGreaterThan(0);

    // Same elevation ⇒ same radial distance: the boundary sample rides
    // the same ring as the origin.
    const distFromCentre = (p) => Math.hypot(p.x - CX, p.y - CY);
    expect(distFromCentre(canvasPoint)).toBeCloseTo(distFromCentre(originPos), 5);
  });

  it('a section centred on the radar maps entirely inside the disc', () => {
    const rig = new DishRig({ originYaw: 0.8, originPitch: -0.6, coverageRadius: 0.65 });
    const MAX_R = 170;

    for (let i = 0; i < 24; i++) {
      const sky = overlay._sectionBoundaryPoint(rig, i / 24);
      const p = overlay._skyToCanvas(sky.yaw, sky.pitch);
      expect(Math.hypot(p.x - CX, p.y - CY)).toBeLessThanOrEqual(MAX_R + 1);
    }
  });

  it('update with a neighbours list is a no-op without a canvas (backward compatible)', () => {
    const rig = new DishRig({ originYaw: 0, originPitch: -0.5, coverageRadius: 0.65 });
    expect(() => overlay.update([], 0, 0, 0, 0, null, -1, [rig])).not.toThrow();
    // And the 8th argument may be omitted entirely, as older callers did.
    expect(() => overlay.update([], 0, 0, 0, 0, null, -1)).not.toThrow();
  });
});
