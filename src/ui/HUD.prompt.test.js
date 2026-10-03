// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { HUD } from './HUD.js';
import { setInteractKey } from './promptKeys.js';

function hud(opts) {
  document.body.innerHTML = '<div id="hud"><div id="hud-prompt"></div></div>';
  return new HUD(document.getElementById('hud'), opts);
}

describe('HUD.setPrompt key names', () => {
  afterEach(() => setInteractKey('E'));

  it('uses an injected keyLabel', () => {
    const h = hud({ keyLabel: (t) => t.replace('[E]', '[X]') });
    h.setPrompt('[E] to retry');
    expect(document.getElementById('hud-prompt').textContent).toBe('[X] to retry');
  });

  it('defaults to the shared interact key', () => {
    setInteractKey('F');
    const h = hud();
    h.setPrompt('Night failed. [E] to retry');
    expect(document.getElementById('hud-prompt').textContent).toBe('Night failed. [F] to retry');
  });

  it('still clears with an empty prompt', () => {
    const h = hud();
    h.setPrompt('x');
    h.setPrompt('');
    expect(document.getElementById('hud-prompt').textContent).toBe('');
  });
});
