// ─────────────────────────────────────────────
// ThreatForecast  –  what a night has in store, by kind (#114)
// ─────────────────────────────────────────────
// The bedroom PC's threats page: last night's log (ThreatWatch) and the
// forecast for a shift, both by kind of threat. The forecast is read off
// each system's own night rules, so it can't drift from what really comes:
//
//   storm    Sandstorm: every night from SANDSTORM.fromNight (on the UFO's
//            nights it follows the visit); night 0 summons one for the
//            tutorial
//   outage   StormOutage: a storm may take the power
//   eyes     DustEyes: out of a strong storm, from night 2
//   prowler  Ragno outside, at the treeline, never coming in (night 1)
//   vents    Ragno coming in through the vents (his attacks, from night 2)
//   aerial   UfoThreat, on UFO.nights
//   corrupt  EvilSignal, on EVIL.nights
//
// The Sleep Demon is left out: it comes every night, with stamina.
// Kinds only, never times: the forecast is vague on purpose.
//
// Pure — no scene, no DOM.
// ─────────────────────────────────────────────

import { SANDSTORM } from './Sandstorm.js';
import { STORM_OUTAGE } from './StormOutage.js';
import { spawnChance } from './DustEyes.js';
import { moodFor } from './RagnoLogic.js';
import { UFO } from './UfoThreat.js';
import { EVIL } from './EvilSignal.js';

/** Every kind the log and the forecast know, in the order they're listed. */
export const THREAT_KINDS = Object.freeze(['storm', 'outage', 'eyes', 'prowler', 'vents', 'aerial', 'corrupt']);

/** The kinds of threat due on [night], in THREAT_KINDS order. */
export function threatForecast(night) {
  const out = [];
  const storm = night >= SANDSTORM.fromNight || night === 0;
  if (storm) out.push('storm');
  if (storm && STORM_OUTAGE.chance > 0) out.push('outage');
  if (spawnChance(night, 'fence') > 0 || spawnChance(night, 'window') > 0) out.push('eyes');
  out.push(moodFor(night) === 'calm' ? 'prowler' : 'vents');
  if (UFO.nights.includes(night)) out.push('aerial');
  if (EVIL.nights.includes(night)) out.push('corrupt');
  return out;
}
