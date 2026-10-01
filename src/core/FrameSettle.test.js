import { describe, it, expect } from 'vitest';
import { FrameSettle } from './FrameSettle.js';

// ─────────────────────────────────────────────
// FrameSettle  –  "has the frame rate calmed down yet?"
// ─────────────────────────────────────────────

describe('FrameSettle', () => {
  it('is not settled before any frame', () => {
    expect(new FrameSettle().settled).toBe(false);
  });

  it('settles after enough smooth frames in a row', () => {
    const settle = new FrameSettle({ frames: 5, maxFrameMs: 50 });
    for (let i = 0; i < 4; i++) expect(settle.push(1 / 60)).toBe(false);
    expect(settle.push(1 / 60)).toBe(true);
    expect(settle.settled).toBe(true);
  });

  it('a hitch restarts the count — it wants a calm run, not a calm average', () => {
    const settle = new FrameSettle({ frames: 3, maxFrameMs: 50 });
    settle.push(1 / 60);
    settle.push(1 / 60);
    settle.push(0.2);                    // a stall
    expect(settle.settled).toBe(false);
    settle.push(1 / 60);
    settle.push(1 / 60);
    expect(settle.push(1 / 60)).toBe(true);
  });

  it('gives up waiting after the timeout, so a slow machine still gets in', () => {
    const settle = new FrameSettle({ frames: 10, maxFrameMs: 20, timeoutMs: 1000 });
    for (let i = 0; i < 9; i++) settle.push(0.1);   // 0.9 s of slow frames
    expect(settle.settled).toBe(false);
    expect(settle.push(0.1)).toBe(true);            // 1.0 s
  });

  it('stays settled once settled', () => {
    const settle = new FrameSettle({ frames: 1 });
    settle.push(1 / 60);
    settle.push(5);
    expect(settle.settled).toBe(true);
  });
});
