import * as THREE from 'three';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Sandstorm, SANDSTORM, scheduleStorms, stormLevel, WIND_DIRECTION } from './Sandstorm.js';
import { WIND_DUST } from '../gameobjects/WindDust.js';
import { UFO } from './UfoThreat.js';
import { NIGHT_SECONDS, SHIFT } from './NightClock.js';

// ─────────────────────────────────────────────
// Sandstorm — random dust storms from night 2; faint indoors
// ─────────────────────────────────────────────

const NIGHT = NIGHT_SECONDS;   // real seconds in a shift
const HOUR = NIGHT / (SHIFT.endHour - SHIFT.startHour);
/** The night-clock hour `seconds` into the shift. */
const clockHour = seconds => SHIFT.startHour + seconds / HOUR;

describe('scheduleStorms', () => {
  it('comes every night — night 1 included — whatever the dice say', () => {
    for (const night of [1, 2, 4]) {
      for (const r of [0, 0.5, 0.999]) {
        expect(scheduleStorms({ night, nightDuration: NIGHT, random: () => r }), `night ${night}`).toHaveLength(SANDSTORM.perNight);
      }
    }
  });

  it('one a night (#107): two left no time for the tension to build', () => {
    expect(SANDSTORM.perNight).toBe(1);
  });

  it('blows after dark, in order, never overlapping, and is over before 6 AM', () => {
    for (const r of [0, 0.25, 0.5, 0.999]) {
      const storms = scheduleStorms({ night: 2, nightDuration: NIGHT, random: () => r });
      let lastEnd = -Infinity;
      for (const s of storms) {
        expect(clockHour(s.start)).toBeGreaterThan(SHIFT.darkHour);
        expect(s.start).toBeGreaterThanOrEqual(lastEnd);
        expect(clockHour(s.start + s.duration)).toBeLessThanOrEqual(SANDSTORM.stormHours[1] + 1e-9);
        expect(s.duration).toBeGreaterThanOrEqual(SANDSTORM.durationHours[0] * HOUR - 1e-9);
        lastEnd = s.start + s.duration;
      }
      expect(lastEnd).toBeLessThanOrEqual(NIGHT);
    }
  });

  it('any time after dark: from the evening to the small hours', () => {
    const early = scheduleStorms({ night: 2, nightDuration: NIGHT, random: () => 0 });
    const late  = scheduleStorms({ night: 2, nightDuration: NIGHT, random: () => 0.999 });
    expect(clockHour(early[0].start)).toBeCloseTo(SANDSTORM.stormHours[0]);
    expect(clockHour(early[0].start)).toBeLessThan(-4);   // before 8 PM
    expect(clockHour(late[0].start)).toBeGreaterThan(2);  // after 2 AM
  });
});

describe('stormLevel', () => {
  const ramp = SANDSTORM.rampSeconds;
  it('builds up, holds, and dies down', () => {
    expect(stormLevel(-1, 60)).toBe(0);
    expect(stormLevel(0, 60)).toBe(0);
    expect(stormLevel(ramp / 2, 60)).toBeGreaterThan(0);
    expect(stormLevel(ramp / 2, 60)).toBeLessThan(1);
    expect(stormLevel(30, 60)).toBe(1);
    expect(stormLevel(60 - ramp / 2, 60)).toBeLessThan(1);
    expect(stormLevel(60, 60)).toBe(0);
    expect(stormLevel(90, 60)).toBe(0);
  });
});


function makeRig({ night = 2, random = () => 0, ufo = null, clouds = null, moon = null, ambient = null } = {}) {
  const listeners = [];
  const controller = {
    state: 'playing',
    nightNumber: night,
    onNightStart: fn => { listeners.push(fn); return () => {}; },
  };
  const fog = new THREE.FogExp2(0x1f2a38, 0.0022);
  const sky = { setStorm: vi.fn() };
  const dust = { setLevel: vi.fn(), setWind: vi.fn(), tick: vi.fn() };
  const ambience = { setStorm: vi.fn() };
  // Where the ear is (for the grit), and nothing else: the storm's fog is the
  // same wherever the player stands, so it never asks whether they are
  // outside or which room they are in.
  const hooks = { listenerPosition: out => out.set(0, 1.2, 0) };
  const storm = new Sandstorm({ controller, fog, sky, dust, ambience, hooks, ufo, clouds, moon, ambient, nightDuration: NIGHT, random });
  storm.onStart();
  return { storm, controller, fog, sky, dust, ambience, hooks, startNight: n => listeners.forEach(fn => fn(n)) };
}

const run = (storm, seconds, step = 0.1) => {
  for (let t = 0; t < seconds - 1e-9; t += step) storm.onUpdate(step);
};

describe('Sandstorm', () => {
  it('blows on night 1 too, at its time', () => {
    const { storm } = makeRig({ night: 1, random: () => 0.999 });
    const s = scheduleStorms({ night: 1, nightDuration: NIGHT, random: () => 0.999 })[0];
    run(storm, s.start + SANDSTORM.rampSeconds + 1);
    expect(storm.level).toBe(1);
  });

  it('summon() brings one at once, on any night', () => {
    const { storm, ambience, sky } = makeRig({ night: 1 });
    expect(storm.summon()).toBe(true);
    run(storm, SANDSTORM.rampSeconds + 1);
    expect(storm.level).toBe(1);
    expect(ambience.setStorm).toHaveBeenLastCalledWith(1);
    expect(sky.setStorm).toHaveBeenLastCalledWith(1);
  });

  it('will not summon a second storm over one already blowing', () => {
    const { storm } = makeRig({ night: 1 });
    storm.summon();
    run(storm, 1);
    expect(storm.summon()).toBe(false);
  });

  it('blows over by itself and falls silent', () => {
    const { storm, ambience } = makeRig({ night: 1 });
    storm.summon();
    run(storm, SANDSTORM.durationHours[1] * HOUR + 1);
    expect(storm.level).toBe(0);
    expect(ambience.setStorm).toHaveBeenLastCalledWith(0);
  });

  it('comes at its scheduled time on a storm night', () => {
    const { storm } = makeRig({ night: 2, random: () => 0 });
    const s = scheduleStorms({ night: 2, nightDuration: NIGHT, random: () => 0 })[0];
    run(storm, s.start - 1);
    expect(storm.level).toBe(0);
    run(storm, SANDSTORM.rampSeconds + 2);
    expect(storm.level).toBeGreaterThan(0.9);
  });

  it('has no sound of its own: the wind is the ambience\'s, told how hard it blows', () => {
    // The storm used to loop a recording of its own. The wind outside is the
    // Ambience's loop now; a storm only makes it blow harder (Ambience.setStorm).
    const { storm, ambience } = makeRig({ night: 1 });
    storm.onUpdate(0.1);
    expect(ambience.setStorm).toHaveBeenLastCalledWith(0);

    storm.summon();
    run(storm, SANDSTORM.rampSeconds / 2);
    const building = ambience.setStorm.mock.lastCall[0];
    expect(building).toBeGreaterThan(0);
    expect(building).toBeLessThan(1);
    expect(building).toBe(storm.level);

    expect(storm.sounds).toBeUndefined();
    expect(SANDSTORM.volume).toBeUndefined();
    expect(SANDSTORM.insideLevel).toBeUndefined();
  });

  it('blows without an ambience to tell', () => {
    const storm = new Sandstorm({
      controller: { state: 'playing', nightNumber: 1, onNightStart: () => () => {} },
      hooks: { listenerPosition: out => out.set(0, 1.2, 0) },
      nightDuration: NIGHT, random: () => 0,
    });
    storm.onStart();
    storm.summon();
    expect(() => run(storm, 1)).not.toThrow();
  });

  it('from the desk, the storm swallows the view just before the dish (~23 m out)', () => {
    const fogged = d => 1 - Math.exp(-((SANDSTORM.fogDensity * d) ** 2));
    expect(fogged(23)).toBeGreaterThan(0.85);   // the dish: all but gone
    expect(fogged(23)).toBeLessThan(0.95);      // …but a ghost of it is there
    expect(fogged(10)).toBeLessThan(0.5);       // the near ground still reads
  });

  it('thickens and browns the fog: one fog, the same wherever the player stands', () => {
    const { storm, fog } = makeRig();
    const clear = fog.color.clone();
    storm.summon();
    run(storm, SANDSTORM.rampSeconds + 2);
    expect(fog.density).toBeCloseTo(SANDSTORM.fogDensity);
    expect(fog.color.equals(clear)).toBe(false);
    expect(fog.color.r).toBeGreaterThan(fog.color.b);
    // No room, no corridor and no step outside changes it: no denser fog
    // for the yard, no fade where the valley is out of view.
    expect(SANDSTORM.fogDensityOutside).toBeUndefined();
    expect(SANDSTORM.placeRate).toBeUndefined();
  });

  it('hands the fog back exactly as it was once it passes', () => {
    const { storm, fog } = makeRig({ night: 1 });
    const color = fog.color.clone();
    storm.summon();
    run(storm, SANDSTORM.durationHours[1] * HOUR + 1);
    expect(fog.density).toBe(0.0022);
    expect(fog.color.equals(color)).toBe(true);
  });

  it('follows whoever else rewrites the fog meanwhile (the dawn)', () => {
    const { storm, fog } = makeRig();
    storm.summon();
    run(storm, SANDSTORM.rampSeconds + 2);
    fog.density = 0.008;              // someone wrote their own
    fog.color.setHex(0x000000);       // Daylight wrote its own
    storm.onUpdate(0.1);
    // Ours on top of theirs, not a stale base.
    expect(fog.density).toBeCloseTo(SANDSTORM.fogDensity);
    storm.reset(1);
    storm.onUpdate(0.1);
    expect(fog.density).toBe(0.008);
    expect(fog.color.getHex()).toBe(0x000000);
  });

  it('blows the dust at the storm\'s own level wherever the player is', () => {
    // Every room and corridor is cut out of it, so indoors it shows only
    // through the glass.
    const { storm, dust } = makeRig();
    storm.summon();
    run(storm, SANDSTORM.rampSeconds + 3);
    expect(dust.setLevel.mock.lastCall[0]).toBe(storm.level);
    expect(storm.level).toBe(1);
  });

  it('blows for about three hours of clock time (#107: they were too short)', () => {
    for (const r of [0, 0.5, 0.999]) {
      const s = scheduleStorms({ night: 2, nightDuration: NIGHT, random: () => r })[0];
      expect(s.duration / HOUR).toBeGreaterThan(2.4);
      expect(s.duration / HOUR).toBeLessThan(3.6);
    }
  });

  it('a summoned storm blows as long', () => {
    const { storm } = makeRig({ night: 1, random: () => 0 });
    storm.summon();
    expect(storm._storm.duration / HOUR).toBeCloseTo(SANDSTORM.durationHours[0]);
  });

  it('dies down when the shift ends, and a new night starts calm', () => {
    const { storm, controller, ambience, startNight } = makeRig({ night: 1 });
    storm.summon();
    run(storm, SANDSTORM.rampSeconds + 2);
    controller.state = 'morning';
    run(storm, SANDSTORM.rampSeconds + 1);
    expect(storm.level).toBe(0);
    expect(ambience.setStorm).toHaveBeenLastCalledWith(0);

    controller.state = 'playing';
    startNight(1);
    storm.onUpdate(0.1);
    expect(storm.level).toBe(0);
  });

  it('cannot be summoned outside a shift', () => {
    const { storm, controller } = makeRig();
    controller.state = 'morning';
    expect(storm.summon()).toBe(false);
  });
});

describe('Sandstorm — the moonlight', () => {
  // The night's lights, as the scene builds them.
  const lights = () => ({
    moon:    new THREE.DirectionalLight(0xb8c4e0, 1.2),
    ambient: new THREE.AmbientLight(0x435472, 0.72),
  });

  it('dims the moonlight and the ambient light with its level', () => {
    const { moon, ambient } = lights();
    const { storm } = makeRig({ moon, ambient });
    storm.summon();
    run(storm, SANDSTORM.rampSeconds / 2);
    // Part way in, part way down.
    expect(moon.intensity).toBeLessThan(1.2);
    expect(moon.intensity).toBeGreaterThan(1.2 * SANDSTORM.moonlight);
    run(storm, SANDSTORM.rampSeconds);
    // At full strength, the share the dust lets through.
    expect(moon.intensity).toBeCloseTo(1.2 * SANDSTORM.moonlight);
    expect(ambient.intensity).toBeCloseTo(0.72 * SANDSTORM.ambientLight);
  });

  it('blots out the moon far more than it darkens the night\'s fill', () => {
    // The moonlight through the window is what read as a clear night; the
    // ambient light also fills the rooms, which have lamps of their own.
    expect(SANDSTORM.moonlight).toBeLessThan(0.25);
    expect(SANDSTORM.ambientLight).toBeGreaterThan(SANDSTORM.moonlight);
    expect(SANDSTORM.ambientLight).toBeLessThan(1);
  });

  it('holds steady at full strength: it never dims its own dimming again', () => {
    // In the morning nothing else rewrites the lights (Daylight writes only
    // while the clock moves), so a storm that scaled whatever it found would
    // sink them a little more every frame.
    const { moon, ambient } = lights();
    const { storm } = makeRig({ moon, ambient });
    storm.summon();
    run(storm, SANDSTORM.rampSeconds + 1);
    const held = moon.intensity;
    run(storm, 5);
    expect(moon.intensity).toBe(held);
    expect(ambient.intensity).toBeCloseTo(0.72 * SANDSTORM.ambientLight);
  });

  it('hands the lights back exactly as they were once it passes', () => {
    const { moon, ambient } = lights();
    const { storm } = makeRig({ night: 1, moon, ambient });
    storm.summon();
    run(storm, SANDSTORM.durationHours[1] * HOUR + 1);
    expect(moon.intensity).toBe(1.2);
    expect(ambient.intensity).toBe(0.72);
  });

  it('dims whatever the dawn writes meanwhile, and hands that back', () => {
    const { moon, ambient } = lights();
    const { storm } = makeRig({ moon, ambient });
    storm.summon();
    run(storm, SANDSTORM.rampSeconds + 1);
    moon.intensity = 2.2;              // Daylight: the morning sun
    ambient.intensity = 1.4;
    storm.onUpdate(0.1);
    expect(moon.intensity).toBeCloseTo(2.2 * SANDSTORM.moonlight);
    expect(ambient.intensity).toBeCloseTo(1.4 * SANDSTORM.ambientLight);
    storm.reset(1);
    storm.onUpdate(0.1);
    expect(moon.intensity).toBe(2.2);
    expect(ambient.intensity).toBe(1.4);
  });

  it('blows without lights to dim', () => {
    const { storm } = makeRig();
    storm.summon();
    expect(() => run(storm, SANDSTORM.rampSeconds + 1)).not.toThrow();
  });
});

describe('Sandstorm — the fog is the clouds\' colour', () => {
  // What the screen shows for a colour drawn by a tone-mapped shader: three's
  // ACESFilmicToneMapping at exposure 1 (tonemapping_pars_fragment), which
  // is what the renderer runs. The clouds go through it. The fog does not —
  // three lays fog on after tone mapping — so the same hex in both comes out
  // as two colours, and the fog has to be given the clouds' colour as shown.
  const shown = (hex) => {
    const fit = v => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081);
    const c = new THREE.Color(hex);
    let [r, g, b] = [c.r, c.g, c.b].map(v => v / 0.6);
    [r, g, b] = [0.59719 * r + 0.35458 * g + 0.04823 * b, 0.07600 * r + 0.90834 * g + 0.01566 * b, 0.02840 * r + 0.13383 * g + 0.83777 * b];
    [r, g, b] = [fit(r), fit(g), fit(b)];
    [r, g, b] = [1.60475 * r - 0.53108 * g - 0.07367 * b, -0.10208 * r + 1.10813 * g - 0.00605 * b, -0.00327 * r - 0.07276 * g + 1.07602 * b];
    return new THREE.Color().setRGB(...[r, g, b].map(v => Math.min(Math.max(v, 0), 1)));
  };
  /** A colour's 0–255 screen channels. */
  const channels = (color) => {
    const hex = color.getHex();
    return [hex >> 16, (hex >> 8) & 255, hex & 255];
  };

  it('at full strength the fog is the dust clouds\' own colour, as the screen shows them', () => {
    const { storm, fog } = makeRig({ night: 1 });
    storm.summon();
    run(storm, SANDSTORM.rampSeconds + 1);
    expect(storm.level).toBeCloseTo(1);

    const clouds = channels(shown(WIND_DUST.nightColor));
    const murk = channels(fog.color);
    // To within a shade: fogTint leaves a little of the night in it.
    for (let i = 0; i < 3; i++) expect(Math.abs(murk[i] - clouds[i]), 'rgb'[i]).toBeLessThanOrEqual(10);
  });

  it('is rust-brown: neither mauve nor yellow', () => {
    // Found by eye, from both sides. fogTint leaves some of the clear night's
    // blue fog in the storm's, and rust with blue in it filled the valley
    // with pink: the dust colour is set low in blue to cancel it. Pulled far
    // enough toward brown to be safe from that, it went yellow instead.
    const { storm, fog } = makeRig({ night: 1 });
    storm.summon();
    run(storm, SANDSTORM.rampSeconds + 1);
    const [r, g, b] = channels(fog.color);
    expect(r).toBeGreaterThan(g);
    expect(b).toBeLessThan(g * 0.7);    // mauve at 0x4a251f
    expect(g).toBeLessThan(r * 0.57);   // yellow at 0x4b2d19
  });
});

describe('Sandstorm — held, and the UFO', () => {
  it('is held at full while something needs it (a chase), however long that is', () => {
    const { storm } = makeRig({ night: 1 });
    storm.summon();
    run(storm, SANDSTORM.rampSeconds + 1);
    storm.held = true;
    run(storm, SANDSTORM.durationHours[1] * HOUR * 2);
    expect(storm.level).toBe(1);
    storm.held = false;
    run(storm, SANDSTORM.rampSeconds + 3);
    expect(storm.level).toBe(0);
  });

  it('is never scheduled at random on a UFO night', () => {
    for (const night of UFO.nights) {
      expect(scheduleStorms({ night, nightDuration: NIGHT, random: () => 0 })).toEqual([]);
    }
  });

  it('on a UFO night, comes soon after the UFO has gone — never during its visit', () => {
    const ufo = { phase: 'waiting' };
    const { storm } = makeRig({ night: UFO.nights[0], ufo, random: () => 0 });
    run(storm, 100);
    expect(storm.level).toBe(0);
    ufo.phase = 'approaching';
    run(storm, 30);
    expect(storm.level).toBe(0);
    expect(storm.summon()).toBe(false);   // not even the debug key
    ufo.phase = 'gone';
    run(storm, SANDSTORM.afterUfoDelay[1] + SANDSTORM.rampSeconds + 1);
    expect(storm.level).toBe(1);
  });
});

describe('Sandstorm — always after the UFO', () => {
  it('follows the UFO every time, whatever the dice say', () => {
    const ufo = { phase: 'gone' };
    const { storm } = makeRig({ night: UFO.nights[0], ufo, random: () => 0.999 });
    run(storm, SANDSTORM.afterUfoDelay[1] + SANDSTORM.rampSeconds + 1);
    expect(storm.level).toBe(1);
  });
});

describe('Sandstorm — two storms a night, if perNight goes back to two', () => {
  // One a night for now (#107), but the queue still takes more: it is the
  // one number to change.
  let perNight;
  beforeEach(() => { perNight = SANDSTORM.perNight; SANDSTORM.perNight = 2; });
  afterEach(() => { SANDSTORM.perNight = perNight; });

  it('fits two of the longer storms after dark, one in each half, never overlapping', () => {
    for (const r of [0, 0.5, 0.999]) {
      const [a, b] = scheduleStorms({ night: 2, nightDuration: NIGHT, random: () => r });
      expect(b.start).toBeGreaterThanOrEqual(a.start + a.duration);
      expect(clockHour(b.start + b.duration)).toBeLessThanOrEqual(SANDSTORM.stormHours[1] + 1e-9);
    }
  });

  it('blows the first, falls calm, then blows the second, each its own storm', () => {
    const { storm } = makeRig({ night: 2, random: () => 0 });
    const [a, b] = scheduleStorms({ night: 2, nightDuration: NIGHT, random: () => 0 });
    run(storm, a.start + SANDSTORM.rampSeconds + 1);
    expect(storm.level).toBe(1);
    const first = storm.stormId;

    run(storm, a.duration);                  // blown over
    expect(storm.level).toBe(0);
    run(storm, b.start - storm._elapsed + SANDSTORM.rampSeconds + 1);
    expect(storm.level).toBe(1);
    expect(storm.stormId).toBe(first + 1);
    expect(storm.stormProgress).toBeGreaterThan(0);
  });

  it('summon() stands in for the next storm that hasn\'t started, not the one after', () => {
    const { storm } = makeRig({ night: 2, random: () => 0 });
    const [, b] = scheduleStorms({ night: 2, nightDuration: NIGHT, random: () => 0 });
    storm.summon();
    run(storm, SANDSTORM.durationHours[1] * HOUR + 1);
    expect(storm.level).toBe(0);              // the first scheduled one isn't also coming
    run(storm, b.start - storm._elapsed + SANDSTORM.rampSeconds + 1);
    expect(storm.level).toBe(1);              // the second still is
  });
});

describe('Sandstorm — which storm, and how far through it', () => {
  it('counts its storms, and says how far through the current one it is', () => {
    const { storm } = makeRig({ night: 1 });
    expect(storm.stormProgress).toBeNull();
    const before = storm.stormId;
    storm.summon();
    expect(storm.stormId).toBe(before + 1);
    storm.onUpdate(0.01);
    expect(storm.stormProgress).toBeGreaterThan(0);
    expect(storm.stormProgress).toBeLessThan(0.05);
    run(storm, SANDSTORM.durationHours[0] * HOUR * 0.5);
    expect(storm.stormProgress).toBeGreaterThan(0.25);
    run(storm, SANDSTORM.durationHours[1] * HOUR);
    expect(storm.stormProgress).toBeNull();   // blown over
  });
});

describe('Sandstorm — one storm level for everything', () => {
  it('drives the wind-dust clouds too, when the scene has them', () => {
    const clouds = { setStorm: vi.fn() };
    const { storm } = makeRig({ night: 1, clouds });
    storm.summon();
    run(storm, SANDSTORM.rampSeconds + 1);
    expect(clouds.setStorm).toHaveBeenLastCalledWith(1);
  });

  it('blows the grit along the same axis as the clouds and the grass', () => {
    const { storm, dust } = makeRig({ night: 1, random: () => 0.37 });
    storm.summon();
    const [angle] = dust.setWind.mock.lastCall;
    expect(Math.cos(angle)).toBeCloseTo(WIND_DIRECTION[0], 3);
    expect(Math.sin(angle)).toBeCloseTo(WIND_DIRECTION[1], 3);
  });

  it('has one wind axis, the clouds\' own', () => {
    expect(WIND_DIRECTION).toBe(WIND_DUST.direction);
  });
});
