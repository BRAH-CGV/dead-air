// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { LoadingScreen } from './LoadingScreen.js';

function markup() {
  const root = document.createElement('div');
  root.innerHTML = '<div id="loading-track"><div id="loading-bar"></div></div><div id="loading-label"></div>';
  return root;
}

describe('LoadingScreen', () => {
  it('shows asset progress as a bar and a count', () => {
    const root = markup();
    new LoadingScreen(root).setProgress(0.5, 3, 6);
    expect(root.querySelector('#loading-bar').style.width).toBe('50%');
    expect(root.querySelector('#loading-label').textContent).toBe('Loading assets… 3/6');
  });

  it('names a later stage, so a full bar that keeps going reads as progress, not a hang', () => {
    const root = markup();
    new LoadingScreen(root).setStage('Preparing scene…', 0.25);
    expect(root.querySelector('#loading-bar').style.width).toBe('25%');
    expect(root.querySelector('#loading-label').textContent).toBe('Preparing scene…');
  });

  it('hide() can drop the overlay at once, for a cut behind a black fade', () => {
    const root = markup();
    new LoadingScreen(root).hide({ immediate: true });
    expect(root.style.display).toBe('none');
  });
});
