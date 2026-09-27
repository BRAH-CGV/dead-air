import { describe, it, expect } from 'vitest';
import { PLAYER_BODY, playerBody } from './PlayerBody.js';

// The desk's under-top gap (AGENTS.md worked example) and the base's doorway
// height (MainOffice / Room openings). The body has to fit both.
const DESK_GAP = 0.72;
const DOORWAY_HEIGHT = 2.2;

describe('PlayerBody', () => {
  const body = playerBody();

  it('stands 1.8 m tall tip to tip', () => {
    expect(2 * (body.standHalf + body.radius)).toBeCloseTo(1.8);
  });

  it('puts the standing eye 1.65 m above the feet', () => {
    const centre = body.standHalf + body.radius;
    expect(centre + body.standEyeOffset).toBeCloseTo(1.65);
  });

  it('puts the crouched eye 0.55 m above the feet', () => {
    const centre = body.crouchHalf + body.radius;
    expect(centre + body.crouchEyeOffset).toBeCloseTo(0.55);
  });

  it('measures eye offsets from each capsule centre', () => {
    expect(body.standEyeOffset).toBeCloseTo(0.75);
    expect(body.crouchEyeOffset).toBeCloseTo(0.225);
  });

  it('keeps the crouch capsule low enough to crawl under the desk', () => {
    expect(2 * (body.crouchHalf + body.radius)).toBeLessThan(DESK_GAP);
  });

  it('keeps the standing capsule under a doorway header', () => {
    expect(PLAYER_BODY.standHeight).toBeLessThan(DOORWAY_HEIGHT);
  });

  it('keeps both eyes inside their capsules', () => {
    expect(PLAYER_BODY.standEyeHeight).toBeLessThan(PLAYER_BODY.standHeight);
    expect(PLAYER_BODY.crouchEyeHeight).toBeLessThan(PLAYER_BODY.crouchHeight);
  });

  it('derives from a custom spec', () => {
    const custom = playerBody({
      radius: 0.25, standHeight: 1.5, standEyeHeight: 1.4,
      crouchHeight: 0.6, crouchEyeHeight: 0.5,
    });
    expect(custom.standHalf).toBeCloseTo(0.5);
    expect(custom.crouchHalf).toBeCloseTo(0.05);
    expect(custom.standEyeOffset).toBeCloseTo(0.65);
    expect(custom.crouchEyeOffset).toBeCloseTo(0.2);
  });
});
