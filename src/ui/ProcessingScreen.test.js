// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { ProcessingScreen } from './ProcessingScreen.js';

// ── Minimal DOM helpers ────────────────────────────────────
// ProcessingScreen queries its constructor argument for child elements.
// Build a tiny DOM tree that mirrors index.html's markup.

function makeDOM() {
  const root = document.createElement('div');
  root.id = 'processing-screen';

  const title = document.createElement('div');
  title.id = 'processing-title';
  root.appendChild(title);

  const preview = document.createElement('div');
  preview.id = 'processing-preview';
  const img = document.createElement('img');
  img.id = 'processing-image';
  preview.appendChild(img);
  root.appendChild(preview);

  const controls = document.createElement('div');
  controls.id = 'processing-controls';
  root.appendChild(controls);

  const hint = document.createElement('div');
  hint.id = 'processing-hint';
  root.appendChild(hint);

  document.body.appendChild(root);
  return root;
}

function makeSignalManager(signals) {
  return { signals };
}

function makeEngine() {
  const ctrl = { inputLocked: false };
  const canvas = { requestPointerLock: vi.fn(() => Promise.resolve()) };
  return {
    player: {
      getComponent() { return ctrl; },
    },
    crosshair: { show: vi.fn(), hide: vi.fn() },
    renderer: { domElement: canvas },
    uiHasMouse: false,
    _ctrl: ctrl,
    _canvas: canvas,
  };
}

describe('ProcessingScreen', () => {
  let domRoot;

  afterEach(() => {
    domRoot?.remove();
    domRoot = null;
  });

  it('constructs null-safely when no DOM element exists', () => {
    const screen = new ProcessingScreen(null);
    expect(screen.root).toBeNull();
    // open/close/refreshActions must not throw
    screen.open(null, []);
    screen.close();
    screen.refreshActions(null);
  });

  it('constructs from the real DOM element', () => {
    domRoot = makeDOM();
    const screen = new ProcessingScreen(domRoot);
    expect(screen.root).toBe(domRoot);
    expect(screen._image).not.toBeNull();
    expect(screen._controls).not.toBeNull();
  });

  it('open() shows the overlay and renders action buttons', () => {
    domRoot = makeDOM();
    const screen = new ProcessingScreen(domRoot);
    const onClick = vi.fn();
    const actions = [
      { id: 'upgrade', label: 'Upgrade Signal', enabled: true, onClick },
    ];

    screen.open(null, actions);

    expect(domRoot.style.display).toBe('flex');
    const buttons = domRoot.querySelectorAll('.processing-btn');
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent).toBe('Upgrade Signal');
    expect(buttons[0].disabled).toBe(false);
    expect(buttons[0].dataset.actionId).toBe('upgrade');
  });

  it('close() hides the overlay and clears controls', () => {
    domRoot = makeDOM();
    const screen = new ProcessingScreen(domRoot);
    screen.open(null, [{ id: 'x', label: 'X', enabled: true }]);
    expect(domRoot.style.display).toBe('flex');

    screen.close();
    expect(domRoot.style.display).toBe('none');
    expect(domRoot.querySelectorAll('.processing-btn').length).toBe(0);
  });

  it('disabled actions render as disabled buttons without click handlers', () => {
    domRoot = makeDOM();
    const screen = new ProcessingScreen(domRoot);
    const onClick = vi.fn();
    screen.open(null, [{ id: 'upgrade', label: 'Upgrade', enabled: false, onClick }]);

    const btn = domRoot.querySelector('.processing-btn');
    expect(btn.disabled).toBe(true);

    btn.click();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('refreshActions() re-renders the controls with updated state', () => {
    domRoot = makeDOM();
    const screen = new ProcessingScreen(domRoot);

    const actions = [
      { id: 'upgrade', label: 'Upgrade Signal', enabled: false },
    ];
    screen.open({ saved: true, signalIndex: 's1' }, actions);

    let btn = domRoot.querySelector('.processing-btn');
    expect(btn.disabled).toBe(true);

    // Now refresh with the action enabled.
    actions[0].enabled = true;
    screen.refreshActions({ saved: true, signalIndex: 's1' });

    btn = domRoot.querySelector('.processing-btn');
    expect(btn.disabled).toBe(false);
  });

  it('looks up the signal payload URL via signalManager and shows the image', () => {
    domRoot = makeDOM();
    const screen = new ProcessingScreen(domRoot);
    screen.signalManager = makeSignalManager([
      { id: 's1', payloadUrl: 'signals/s1.png' },
    ]);

    const drive = { saved: true, signalIndex: 's1' };
    screen.open(drive, []);

    const img = domRoot.querySelector('#processing-image');
    expect(img.src).toContain('signals/s1.png');
    expect(img.style.display).toBe('');
  });

  it('hides the image when no drive is provided', () => {
    domRoot = makeDOM();
    const screen = new ProcessingScreen(domRoot);
    screen.signalManager = makeSignalManager([
      { id: 's1', payloadUrl: 'signals/s1.png' },
    ]);

    screen.open(null, []);

    const img = domRoot.querySelector('#processing-image');
    expect(img.style.display).toBe('none');
  });

  it('hides the image when the drive has no matching signal', () => {
    domRoot = makeDOM();
    const screen = new ProcessingScreen(domRoot);
    screen.signalManager = makeSignalManager([]);

    screen.open({ saved: true, signalIndex: 'unknown' }, []);

    const img = domRoot.querySelector('#processing-image');
    expect(img.style.display).toBe('none');
  });

  it('custom render hook is called instead of the default button', () => {
    domRoot = makeDOM();
    const screen = new ProcessingScreen(domRoot);
    const renderFn = vi.fn((container, action) => {
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.dataset.actionId = action.id;
      container.appendChild(slider);
    });

    screen.open(null, [{ id: 'freq', label: 'Frequency', enabled: true, render: renderFn }]);

    expect(renderFn).toHaveBeenCalledOnce();
    const slider = domRoot.querySelector('input[type="range"]');
    expect(slider).not.toBeNull();
    expect(slider.dataset.actionId).toBe('freq');
    // No default button was created.
    expect(domRoot.querySelector('.processing-btn')).toBeNull();
  });

  it('locks player input, releases pointer lock, and hides crosshair while open', () => {
    domRoot = makeDOM();
    const screen = new ProcessingScreen(domRoot);
    const engine = makeEngine();
    screen.setEngine(engine);

    screen.open(null, []);
    expect(engine._ctrl.inputLocked).toBe(true);
    expect(engine.crosshair.hide).toHaveBeenCalled();
    expect(engine.uiHasMouse).toBe(true);
    expect(document.exitPointerLock).toBeDefined;  // jsdom has no pointer lock, but the guard must not throw

    screen.close();
    expect(engine._ctrl.inputLocked).toBe(false);
    expect(engine.crosshair.show).toHaveBeenCalled();
    expect(engine.uiHasMouse).toBe(false);
    expect(engine._canvas.requestPointerLock).toHaveBeenCalled();
  });

  it('Q key closes the screen', () => {
    domRoot = makeDOM();
    const screen = new ProcessingScreen(domRoot);
    screen.open(null, []);
    expect(domRoot.style.display).toBe('flex');

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ' }));
    expect(domRoot.style.display).toBe('none');
  });

  it('dispose cleans up engine and signalManager references', () => {
    domRoot = makeDOM();
    const screen = new ProcessingScreen(domRoot);
    const engine = makeEngine();
    screen.setEngine(engine);
    screen.signalManager = makeSignalManager([]);

    screen.open(null, []);
    screen.dispose();

    expect(screen._engine).toBeNull();
    expect(screen.signalManager).toBeNull();
    expect(domRoot.style.display).toBe('none');
  });
});
