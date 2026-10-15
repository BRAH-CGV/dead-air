// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RadarOverlay } from './HUD.js';

// The overlays wrap markup that outlives every scene (it lives in
// index.html), so whatever a scene's instance hangs on it has to come off
// when the scene goes — or each restart stacks one more listener, and the
// old ones keep calling into dead scenes.

describe('RadarOverlay.dispose', () => {
  it('stops listening for window resizes', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const overlay = new RadarOverlay(null);
    const handler = overlay._resizeHandler;
    overlay.dispose();
    expect(removeSpy).toHaveBeenCalledWith('resize', handler);
    expect(overlay._resizeHandler).toBe(null);
    removeSpy.mockRestore();
  });

  it('drops the sky backdrop it was reading', () => {
    const overlay = new RadarOverlay(null);
    overlay._backdrop = {};
    overlay.dispose();
    expect(overlay._backdrop).toBe(null);
  });
});
