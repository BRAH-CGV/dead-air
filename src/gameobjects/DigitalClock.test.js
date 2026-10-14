import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { DigitalClock, clockDigits, SEGMENTS } from './DigitalClock.js';
import { NightClock, SHIFT } from '../gameplay/NightClock.js';

/** The segments of digit `index` (0 = tens of hours … 3 = minutes) that are lit, as letters a–g. */
function lit(clock, index) {
  const colors = clock.display.geometry.getAttribute('color');
  let out = '';
  for (let s = 0; s < 7; s++) {
    if (colors.getX((index * 7 + s) * 4) > 0.5) out += 'abcdefg'[s];
  }
  return out;
}
const sorted = s => [...s].sort().join('');

describe('clockDigits', () => {
  it('reads a night-clock hour as a 24-hour time: tens of hours, hours, tens of minutes, minutes', () => {
    expect(clockDigits(-6)).toEqual([1, 8, 0, 0]);         // 18:00, the shift starts
    expect(clockDigits(-0.5)).toEqual([2, 3, 3, 0]);       // 23:30
    expect(clockDigits(0)).toEqual([0, 0, 0, 0]);          // 00:00, midnight
    expect(clockDigits(1.75)).toEqual([0, 1, 4, 5]);       // 01:45 — a leading zero, as a 24-hour clock has
    expect(clockDigits(6)).toEqual([0, 6, 0, 0]);          // 06:00, the shift ends
    expect(clockDigits(13.25)).toEqual([1, 3, 1, 5]);      // 13:15
  });

  it('keeps time with the HUD: the minute gone, like a real clock (#61)', () => {
    // The HUD shows NightClock.formatTime, which floors (it used to round,
    // and showed "1:60" for it). The desk clock has to agree with it: the
    // same minute, on its own 24-hour face.
    expect(clockDigits(0.0084)).toEqual([0, 0, 0, 0]);     // 00:00:30 → still 00:00
    expect(clockDigits(1.9999)).toEqual([0, 1, 5, 9]);     // never 01:60
    for (let hour = SHIFT.startHour; hour <= SHIFT.endHour; hour += 1 / 977) {
      const [, h, mm, half] = NightClock.formatTime(hour).match(/^(\d+):(\d\d) (AM|PM)$/);
      const hud = `${String(Number(h) % 12 + (half === 'PM' ? 12 : 0)).padStart(2, '0')}:${mm}`;
      const [h10, h1, m10, m1] = clockDigits(hour);
      expect(`${h10}${h1}:${m10}${m1}`, `hour ${hour}`).toBe(hud);
    }
  });

  it('never reads :60: the last half-minute shows :59, exact hours roll over', () => {
    expect(clockDigits(0.995)).toEqual([0, 0, 5, 9]);      // 00:59:42 → 00:59
    expect(clockDigits(5.999)).toEqual([0, 5, 5, 9]);
    expect(clockDigits(-0.0001)).toEqual([2, 3, 5, 9]);    // 23:59:59 → 23:59, not 24:00
    expect(clockDigits(1)).toEqual([0, 1, 0, 0]);          // 01:00 sharp
    expect(clockDigits(12)).toEqual([1, 2, 0, 0]);         // noon
    expect(clockDigits(24)).toEqual([0, 0, 0, 0]);         // a day round is midnight again
  });
});

describe('SEGMENTS', () => {
  it('has the seven-segment shape of every digit', () => {
    expect(sorted(SEGMENTS[8])).toBe('abcdefg');
    expect(sorted(SEGMENTS[1])).toBe('bc');
    expect(sorted(SEGMENTS[7])).toBe('abc');
    expect(sorted(SEGMENTS[0])).toBe('abcdef');
    for (let d = 0; d <= 9; d++) expect(SEGMENTS[d].length).toBeGreaterThanOrEqual(2);
    expect(new Set(Object.values(SEGMENTS).map(sorted)).size).toBe(10);   // all different
  });
});

describe('DigitalClock', () => {
  it('stands on its base with the display on its front (+z), small enough for a desk', () => {
    const clock = new DigitalClock();
    const box = new THREE.Box3().setFromObject(clock.object3d);
    expect(box.min.y).toBeCloseTo(0);
    expect(box.max.y).toBeLessThan(0.2);
    expect(box.max.x - box.min.x).toBeLessThan(0.35);
    const face = new THREE.Box3().setFromObject(clock.display);
    expect(face.max.z).toBeCloseTo(box.max.z);              // nothing in front of the digits
    expect(face.min.x).toBeGreaterThan(box.min.x);
    expect(face.max.x).toBeLessThan(box.max.x);
  });

  it('shows 00:00 before anyone hands it a clock', () => {
    const clock = new DigitalClock();
    for (let d = 0; d < 4; d++) expect(sorted(lit(clock, d))).toBe(sorted(SEGMENTS[0]));
  });

  it('an unlit segment is all but black: 01:00 must not read as 88:88', () => {
    const clock = new DigitalClock();
    clock.showTime(1);
    const colors = clock.display.geometry.getAttribute('color');
    const reds = [];
    for (let v = 0; v < 4 * 7 * 4; v += 4) reds.push(colors.getX(v));
    const lit = reds.filter(r => r > 0.5), unlit = reds.filter(r => r <= 0.5);
    expect(lit.length).toBe(6 + 2 + 6 + 6);                 // 0, 1, 0, 0
    expect(Math.max(...unlit)).toBeLessThan(0.05);
    // And a lit one is red, not salmon. Vertex colours are linear: sRGB
    // red at full with a little green is far less than that once converted.
    const first = [...reds.keys()].find(i => reds[i] > 0.5) * 4;
    expect(colors.getX(first)).toBeCloseTo(1);
    expect(colors.getY(first)).toBeLessThan(0.06);
    expect(colors.getZ(first)).toBeLessThan(0.06);
  });

  it('lights the segments of the time it is shown, the leading zero included', () => {
    const clock = new DigitalClock();
    clock.showTime(4.5);                                    // 04:30
    expect(sorted(lit(clock, 0))).toBe(sorted(SEGMENTS[0]));
    expect(sorted(lit(clock, 1))).toBe(sorted(SEGMENTS[4]));
    expect(sorted(lit(clock, 2))).toBe(sorted(SEGMENTS[3]));
    expect(sorted(lit(clock, 3))).toBe(sorted(SEGMENTS[0]));

    clock.showTime(-1.5);                                   // 22:30, before midnight
    expect(sorted(lit(clock, 0))).toBe(sorted(SEGMENTS[2]));
    expect(sorted(lit(clock, 1))).toBe(sorted(SEGMENTS[2]));
    expect(sorted(lit(clock, 2))).toBe(sorted(SEGMENTS[3]));
    expect(sorted(lit(clock, 3))).toBe(sorted(SEGMENTS[0]));
  });

  it('is one draw call of glow: unlit, so it reads in a dark office and dims with the power grid', () => {
    const clock = new DigitalClock();
    expect(clock.display.material.isMeshBasicMaterial).toBe(true);
    expect(clock.display.material.vertexColors).toBe(true);
    // Shown as it is: the scene's filmic tone mapping would wash LED red out to salmon.
    expect(clock.display.material.toneMapped).toBe(false);
    let lights = 0;
    clock.object3d.traverse(o => { if (o.isLight) lights++; });
    expect(lights).toBe(0);
  });

  it('follows the clock it is handed, and only redraws when the minute changes', () => {
    const clock = new DigitalClock();
    const night = { currentTime: 2.25 };
    clock.clock = night;
    const tick = () => { for (const c of clock.components) c.onUpdate?.(1 / 60); };
    const colors = clock.display.geometry.getAttribute('color');

    tick();
    expect(sorted(lit(clock, 1))).toBe(sorted(SEGMENTS[2]));
    expect(sorted(lit(clock, 2))).toBe(sorted(SEGMENTS[1]));
    expect(sorted(lit(clock, 3))).toBe(sorted(SEGMENTS[5]));

    const version = colors.version;
    night.currentTime = 2.2501;                             // same minute
    tick();
    expect(colors.version).toBe(version);
    night.currentTime = 2.27;                               // 2:16
    tick();
    expect(colors.version).toBeGreaterThan(version);
    expect(sorted(lit(clock, 3))).toBe(sorted(SEGMENTS[6]));
  });

  it('dispose frees every geometry and material it built', () => {
    const clock = new DigitalClock();
    let freed = 0, total = 0;
    const seen = new Set();
    clock.object3d.traverse(o => {
      if (!o.isMesh) return;
      for (const r of [o.geometry, o.material]) {
        if (seen.has(r)) continue;
        seen.add(r); total++;
        r.addEventListener('dispose', () => { freed++; });
      }
    });
    clock.dispose();
    expect(total).toBeGreaterThan(2);
    expect(freed).toBe(total);
  });
});
