// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RadarOverlay, SignalReviewPanel } from './HUD.js';

// The overlays wrap markup that outlives every scene (it lives in
// index.html), so whatever a scene's instance hangs on it has to come off
// when the scene goes — or each restart stacks one more listener, and the
// old ones keep calling into dead scenes.

function reviewMarkup() {
  document.body.innerHTML = `
    <div id="signal-review">
      <img id="signal-review-image" />
      <span id="signal-save-btn"></span>
      <span id="signal-delete-btn"></span>
    </div>`;
  return document.getElementById('signal-review');
}

describe('SignalReviewPanel.dispose', () => {
  beforeEach(() => reviewMarkup());

  it('clicks reach the callbacks before dispose', () => {
    const panel = new SignalReviewPanel();
    const save = vi.fn();
    const del = vi.fn();
    panel.onSave(save);
    panel.onDelete(del);
    document.getElementById('signal-save-btn').click();
    document.getElementById('signal-delete-btn').click();
    expect(save).toHaveBeenCalledOnce();
    expect(del).toHaveBeenCalledOnce();
  });

  it('removes its click listeners, so a dead scene is never called', () => {
    const panel = new SignalReviewPanel();
    const save = vi.fn();
    const del = vi.fn();
    panel.onSave(save);
    panel.onDelete(del);
    panel.dispose();
    document.getElementById('signal-save-btn').click();
    document.getElementById('signal-delete-btn').click();
    expect(save).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('after five rebuilds, one click saves exactly once', () => {
    let panel;
    const saves = [];
    for (let i = 0; i < 5; i++) {
      panel?.dispose();
      panel = new SignalReviewPanel();
      const save = vi.fn();
      saves.push(save);
      panel.onSave(save);
    }
    document.getElementById('signal-save-btn').click();
    expect(saves.reduce((n, s) => n + s.mock.calls.length, 0)).toBe(1);
    expect(saves.at(-1)).toHaveBeenCalledOnce();
  });

  it('removes the S / D key handler too, and hides', () => {
    const panel = new SignalReviewPanel();
    const save = vi.fn();
    panel.onSave(save);
    panel.show('x.png');
    panel.dispose();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS' }));
    expect(save).not.toHaveBeenCalled();
    expect(panel.root.style.display).toBe('none');
  });

  it('is safe without markup, and twice', () => {
    const panel = new SignalReviewPanel(null);
    expect(() => { panel.dispose(); panel.dispose(); }).not.toThrow();
  });
});

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
