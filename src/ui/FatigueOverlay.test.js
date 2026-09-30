// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FatigueOverlay } from './FatigueOverlay.js';

describe('FatigueOverlay', () => {
  let root, tunnel, lids, overlay;

  beforeEach(() => {
    root = document.createElement('div');
    root.innerHTML = '<div id="fatigue-tunnel"></div><div id="fatigue-lids"></div>';
    tunnel = root.querySelector('#fatigue-tunnel');
    lids = root.querySelector('#fatigue-lids');
    overlay = new FatigueOverlay(root);
  });

  it('shows the tunnel as the vignette opacity and the lids as --lid', () => {
    overlay.set(0.4, 0.75);
    expect(tunnel.style.getPropertyValue('opacity')).toBe('0.4');
    expect(lids.style.getPropertyValue('--lid')).toBe('0.75');
  });

  it('writes the DOM only when what it shows changes', () => {
    const tunnelWrites = vi.spyOn(tunnel.style, 'setProperty');
    const lidWrites = vi.spyOn(lids.style, 'setProperty');
    overlay.set(0.3, 0);
    overlay.set(0.3001, 0.001);          // the same hundredths: nothing new
    overlay.set(0.3, 0);
    expect(tunnelWrites).toHaveBeenCalledTimes(1);
    expect(lidWrites).toHaveBeenCalledTimes(1);
    overlay.set(0.31, 0);
    expect(tunnelWrites).toHaveBeenCalledTimes(2);
    expect(lidWrites).toHaveBeenCalledTimes(1);
  });

  it('clear() opens the eyes and takes the tunnel away', () => {
    overlay.set(0.8, 1);
    overlay.clear();
    expect(tunnel.style.getPropertyValue('opacity')).toBe('0');
    expect(lids.style.getPropertyValue('--lid')).toBe('0');
  });

  it('without its markup (tests, a page without it) it does nothing', () => {
    expect(() => new FatigueOverlay(null).set(0.5, 0.5)).not.toThrow();
  });
});
