import { describe, it, expect } from 'vitest';
import { RadarOverlay } from './HUD.js';

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
