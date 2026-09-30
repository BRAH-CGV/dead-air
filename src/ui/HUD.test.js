import { describe, it, expect } from 'vitest';
import { HUD, RadarOverlay } from './HUD.js';

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

// ── Objective line ────────────────────────────────────────
describe('HUD objective', () => {
  function fakeRoot() {
    const el = { textContent: '', style: { display: 'none' } };
    return { el, root: { style: {}, querySelector: sel => (sel === '#hud-objective' ? el : null) } };
  }

  it("says what tonight's threat asks of the player, and hides when there is nothing to say", () => {
    const { el, root } = fakeRoot();
    const hud = new HUD(root);

    hud.setObjective("Something walks past the window. Don't let it see you.");
    expect(el.textContent).toBe("Something walks past the window. Don't let it see you.");
    expect(el.style.display).not.toBe('none');

    hud.setObjective('');
    expect(el.style.display).toBe('none');
  });

  it('does nothing without the markup', () => {
    expect(() => new HUD(null).setObjective('x')).not.toThrow();
  });
});

// ── Signal counter ────────────────────────────────────────
describe('HUD signal counter', () => {
  function fakeRoot() {
    const el = { textContent: '' };
    return { el, root: { style: {}, querySelector: sel => (sel === '#hud-signals' ? el : null) } };
  }

  it('reads counted / required', () => {
    const { el, root } = fakeRoot();
    new HUD(root).setSignals(2, 3);
    expect(el.textContent).toBe('Signals: 2 / 3');
  });

  it('adds the saved signals still waiting to be stored (night 3 on)', () => {
    const { el, root } = fakeRoot();
    const hud = new HUD(root);
    hud.setSignals(1, 5, 2);
    expect(el.textContent).toBe('Signals: 1 / 5 (+2 to store)');

    hud.setSignals(3, 5, 0);
    expect(el.textContent).toBe('Signals: 3 / 5');
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

// ── Stamina bar ───────────────────────────────────────────
describe('HUD stamina bar', () => {
  function fakeRoot() {
    const bar = { style: {}, dataset: {} };
    const fill = { style: {} };
    const els = { '#hud-stamina': bar, '#hud-stamina-fill': fill };
    return { bar, fill, root: { style: {}, querySelector: sel => els[sel] ?? null } };
  }

  it('fills to the stamina left and colours by level', () => {
    const { bar, fill, root } = fakeRoot();
    const hud = new HUD(root);
    hud.setStamina(0.42, 'tired');
    expect(fill.style.width).toBe('42%');
    expect(bar.dataset.level).toBe('tired');
  });

  it('clamps to 0–100%', () => {
    const { fill, root } = fakeRoot();
    const hud = new HUD(root);
    hud.setStamina(1.4);
    expect(fill.style.width).toBe('100%');
    hud.setStamina(-1);
    expect(fill.style.width).toBe('0%');
  });

  it('only touches the DOM when the shown value changes (it is called every frame)', () => {
    const { fill, root } = fakeRoot();
    const hud = new HUD(root);
    hud.setStamina(0.5, 'ok');
    fill.style = new Proxy({}, { set() { throw new Error('wrote the DOM'); } });
    expect(() => hud.setStamina(0.501, 'ok')).not.toThrow();
  });

  it('does nothing without the markup', () => {
    expect(() => new HUD(null).setStamina(0.5, 'ok')).not.toThrow();
  });
});

// ── Oxygen gauge ──────────────────────────────────────────
describe('HUD oxygen gauge', () => {
  function fakeRoot() {
    const bar = { style: {}, dataset: {} };
    const fill = { style: {} };
    const els = { '#hud-oxygen': bar, '#hud-oxygen-fill': fill };
    return { bar, fill, root: { style: {}, querySelector: sel => els[sel] ?? null } };
  }

  it('shows the tank left while the suit is on', () => {
    const { bar, fill, root } = fakeRoot();
    const hud = new HUD(root);
    hud.setOxygen(0.6);
    expect(bar.style.display).toBe('flex');
    expect(fill.style.width).toBe('60%');
    expect(bar.dataset.level).toBe('ok');
  });

  it('turns to the warning colour below a quarter', () => {
    const { bar, root } = fakeRoot();
    const hud = new HUD(root);
    hud.setOxygen(0.2);
    expect(bar.dataset.level).toBe('low');
  });

  it('hides for null (no suit on)', () => {
    const { bar, root } = fakeRoot();
    const hud = new HUD(root);
    hud.setOxygen(0.5);
    hud.setOxygen(null);
    expect(bar.style.display).toBe('none');
  });

  it('only touches the DOM when what it shows changes (it is called every frame)', () => {
    const { bar, fill, root } = fakeRoot();
    const hud = new HUD(root);
    hud.setOxygen(0.5);
    fill.style = new Proxy({}, { set() { throw new Error('wrote the DOM'); } });
    bar.style = new Proxy({}, { set() { throw new Error('wrote the DOM'); } });
    bar.dataset = new Proxy({}, { set() { throw new Error('wrote the DOM'); } });
    expect(() => hud.setOxygen(0.501)).not.toThrow();
  });

  it('does nothing without the markup', () => {
    expect(() => new HUD(null).setOxygen(0.5)).not.toThrow();
  });
});
