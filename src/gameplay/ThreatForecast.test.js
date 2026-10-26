import { describe, it, expect } from 'vitest';
import { threatForecast, THREAT_KINDS } from './ThreatForecast.js';
import { scheduleStorms, SANDSTORM } from './Sandstorm.js';
import { spawnChance } from './DustEyes.js';
import { scheduleVisits } from './RagnoLogic.js';
import { UFO } from './UfoThreat.js';
import { EVIL } from './EvilSignal.js';

describe('threatForecast', () => {
  it('names only kinds the log knows', () => {
    for (const night of [0, 1, 2, 3]) {
      for (const kind of threatForecast(night)) expect(THREAT_KINDS).toContain(kind);
    }
  });

  it('night 1: a storm that may take the power, and a creep at the treeline', () => {
    expect(threatForecast(1)).toEqual(['storm', 'outage', 'prowler']);
  });

  it('night 2: the eyes join the storm, and Ragno comes in through the vents', () => {
    expect(threatForecast(2)).toEqual(['storm', 'outage', 'eyes', 'vents']);
  });

  it('night 3: everything — the aerial visit and the corrupted signal too', () => {
    expect(threatForecast(3)).toEqual(['storm', 'outage', 'eyes', 'vents', 'aerial', 'corrupt']);
  });

  it('agrees with each system\'s own night rules', () => {
    for (const night of [1, 2, 3]) {
      const kinds = threatForecast(night);
      const stormy = night >= SANDSTORM.fromNight;
      expect(kinds.includes('storm')).toBe(stormy);
      expect(kinds.includes('eyes')).toBe(spawnChance(night, 'fence') > 0);
      const attacks = scheduleVisits(night, () => 0.5).some((v) => v.kind === 'attack');
      expect(kinds.includes('vents')).toBe(attacks);
      expect(kinds.includes('prowler')).toBe(!attacks);
      expect(kinds.includes('aerial')).toBe(UFO.nights.includes(night));
      expect(kinds.includes('corrupt')).toBe(EVIL.nights.includes(night));
    }
  });

  it('a storm is on the cards every night it is due, UFO nights included (it follows the UFO)', () => {
    for (const night of UFO.nights) {
      expect(scheduleStorms({ night })).toEqual([]);   // not scheduled at random …
      expect(threatForecast(night)).toContain('storm');   // … but it still comes
    }
  });

  it('night 0, the tutorial: the storm it summons and the creep at midnight', () => {
    expect(threatForecast(0)).toEqual(['storm', 'outage', 'prowler']);
  });

  it('leaves the Sleep Demon out: it comes every night, it is no forecast', () => {
    for (const night of [0, 1, 2, 3]) expect(threatForecast(night)).not.toContain('demon');
  });
});
