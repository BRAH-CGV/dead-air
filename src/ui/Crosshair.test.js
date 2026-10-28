// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { Crosshair } from './Crosshair.js';

describe('Crosshair', () => {
  let root;

  beforeEach(() => {
    root = document.createElement('div');
    root.id = 'crosshair';
    document.body.appendChild(root);
  });

  it('show() displays the crosshair', () => {
    const crosshair = new Crosshair(root);
    crosshair.show();
    expect(root.style.display).toBe('block');
  });

  it('hide() hides the crosshair', () => {
    const crosshair = new Crosshair(root);
    crosshair.hide();
    expect(root.style.display).toBe('none');
  });

  it('setActive() toggles the active class', () => {
    const crosshair = new Crosshair(root);
    crosshair.setActive(true);
    expect(root.classList.contains('active')).toBe(true);
    crosshair.setActive(false);
    expect(root.classList.contains('active')).toBe(false);
  });

  it('isActive returns whether the crosshair has the active class', () => {
    const crosshair = new Crosshair(root);
    expect(crosshair.isActive).toBe(false);
    crosshair.setActive(true);
    expect(crosshair.isActive).toBe(true);
  });

  describe('setHudHidden', () => {
    it('hides the crosshair when set to true', () => {
      const crosshair = new Crosshair(root);
      crosshair.show();
      crosshair.setHudHidden(true);
      expect(root.style.display).toBe('none');
      expect(crosshair._hudHidden).toBe(true);
    });

    it('shows the crosshair when set to false', () => {
      const crosshair = new Crosshair(root);
      crosshair.setHudHidden(true);
      crosshair.setHudHidden(false);
      expect(root.style.display).toBe('block');
      expect(crosshair._hudHidden).toBe(false);
    });

    it('prevents show() from displaying when hudHidden is true', () => {
      const crosshair = new Crosshair(root);
      crosshair.setHudHidden(true);
      crosshair.show();
      expect(root.style.display).toBe('none');
    });

    it('allows show() to display when hudHidden is false', () => {
      const crosshair = new Crosshair(root);
      crosshair.setHudHidden(true);
      crosshair.setHudHidden(false);
      crosshair.show();
      expect(root.style.display).toBe('block');
    });
  });
});
