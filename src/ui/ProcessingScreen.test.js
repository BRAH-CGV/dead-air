
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock the Spectrogram module so tests don't need a real AudioContext.
vi.mock('./Spectrogram.js', () => ({
  decode: vi.fn(),
  compute: vi.fn(),
  render: vi.fn(),
  renderBlend: vi.fn(),
  renderToImageData: vi.fn(() => new ImageData(1, 1)),
  blendFromImageData: vi.fn(),
}));

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
  const canvas = document.createElement('canvas');
  canvas.id = 'processing-spectrogram';
  canvas.width = 480;
  canvas.height = 360;
  preview.appendChild(canvas);
  root.appendChild(preview);

  const tuningGame = document.createElement('div');
  tuningGame.id = 'tuning-game';
  const tuningCanvas = document.createElement('canvas');
  tuningCanvas.id = 'tuning-canvas';
  tuningCanvas.width = 480;
  tuningCanvas.height = 60;
  tuningGame.appendChild(tuningCanvas);
  const tuningSlider = document.createElement('input');
  tuningSlider.type = 'range';
  tuningSlider.id = 'tuning-slider';
  tuningSlider.min = '0';
  tuningSlider.max = '1';
  tuningSlider.step = '0.01';
  tuningSlider.value = '0.5';
  tuningGame.appendChild(tuningSlider);
  root.appendChild(tuningGame);

  const progress = document.createElement('div');
  progress.id = 'processing-progress';
  const progressBar = document.createElement('div');
  progressBar.id = 'processing-progress-bar';
  const progressFill = document.createElement('div');
  progressFill.id = 'processing-progress-fill';
  progressBar.appendChild(progressFill);
  progress.appendChild(progressBar);
  const progressLabel = document.createElement('div');
  progressLabel.id = 'processing-progress-label';
  progress.appendChild(progressLabel);
  root.appendChild(progress);

  const viz = document.createElement('div');
  viz.id = 'processing-viz';
  // Attributes mirror index.html — jsdom throws IndexSizeError when the
  // constructor's initial volume apply() reads a valueless range input.
  const makeVizSlider = (id, min, max, step, value) => {
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = id;
    slider.min = min;
    slider.max = max;
    slider.step = step;
    slider.value = value;
    viz.appendChild(slider);
  };
  makeVizSlider('viz-gain', '0.5', '5', '0.1', '1');
  makeVizSlider('viz-contrast', '0.2', '3', '0.1', '1');
  makeVizSlider('viz-volume', '0', '1', '0.05', '0.7');
  root.appendChild(viz);

  const audio = document.createElement('audio');
  audio.id = 'processing-audio';
  audio.preload = 'auto';
  root.appendChild(audio);

  const media = document.createElement('div');
  media.id = 'processing-media';
  root.appendChild(media);

  const controls = document.createElement('div');
  controls.id = 'processing-controls';
  root.appendChild(controls);

  const hint = document.createElement('div');
  hint.id = 'processing-hint';
  root.appendChild(hint);

  document.body.appendChild(root);
  return root;
}

function makeSignalRegistry(urlMap = {}) {
  return {
    names: Object.keys(urlMap),
    getAudioUrl(name, level) {
      // Try level variant first, then fall back to base.
      const key = `${name}_L${level}`;
      return urlMap[key] || urlMap[name] || '';
    },
  };
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
    vi.unstubAllGlobals();
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
    expect(screen._spectrogram).not.toBeNull();
    expect(screen._audio).not.toBeNull();
    expect(screen._media).not.toBeNull();
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

  it('isOpen is true from open() to close() (the tutorial reads it)', () => {
    domRoot = makeDOM();
    const screen = new ProcessingScreen(domRoot);
    expect(screen.isOpen).toBe(false);
    screen.open(null, []);
    expect(screen.isOpen).toBe(true);
    screen.close();
    expect(screen.isOpen).toBe(false);
    expect(new ProcessingScreen(null).isOpen).toBe(false);
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
    screen.open({ saved: true, signalName: 'deep_hum' }, actions);

    let btn = domRoot.querySelector('.processing-btn');
    expect(btn.disabled).toBe(true);

    // Now refresh with the action enabled.
    actions[0].enabled = true;
    screen.refreshActions({ saved: true, signalName: 'deep_hum' });

    btn = domRoot.querySelector('.processing-btn');
    expect(btn.disabled).toBe(false);
  });

  it('resolves the audio URL via signalRegistry and sets the audio source', () => {
    domRoot = makeDOM();
    const screen = new ProcessingScreen(domRoot);
    screen.signalRegistry = makeSignalRegistry({
      'deep_hum': '/assets/signals/deep_hum_0.wav',
    });

    const drive = { saved: true, signalName: 'deep_hum', signalLevel: 1 };
    screen.open(drive, []);

    const audio = domRoot.querySelector('#processing-audio');
    expect(audio.src).toContain('/assets/signals/deep_hum_0.wav');
  });

  it('renders media buttons — play/pause and stop', () => {
    domRoot = makeDOM();
    const screen = new ProcessingScreen(domRoot);
    screen.signalRegistry = makeSignalRegistry({
      'deep_hum': '/assets/signals/deep_hum_0.wav',
    });

    const drive = { saved: true, signalName: 'deep_hum', signalLevel: 1 };
    screen.open(drive, []);

    const mediaBtns = domRoot.querySelectorAll('.media-btn');
    expect(mediaBtns.length).toBe(2);
    expect(mediaBtns[0].textContent).toBe('Play');
    expect(mediaBtns[0].dataset.actionId).toBe('play-pause');
    expect(mediaBtns[0].disabled).toBe(false);
    expect(mediaBtns[1].textContent).toBe('Stop');
    expect(mediaBtns[1].dataset.actionId).toBe('stop');
    expect(mediaBtns[1].disabled).toBe(false);
  });

  it('clears the spectrogram canvas when no drive is provided', () => {
    domRoot = makeDOM();
    const screen = new ProcessingScreen(domRoot);
    screen.signalRegistry = makeSignalRegistry({
      'deep_hum': '/assets/signals/deep_hum_0.wav',
    });

    screen.open(null, []);

    // Media buttons should be disabled (no audio).
    const mediaBtns = domRoot.querySelectorAll('.media-btn');
    expect(mediaBtns.length).toBe(2);
    expect(mediaBtns[0].disabled).toBe(true);
    expect(mediaBtns[1].disabled).toBe(true);

    // Audio src should be empty.
    const audio = domRoot.querySelector('#processing-audio');
    expect(audio.src).toBe('');
  });

  it('clears the spectrogram canvas when the drive has no matching signal', () => {
    domRoot = makeDOM();
    const screen = new ProcessingScreen(domRoot);
    screen.signalRegistry = makeSignalRegistry({});

    screen.open({ saved: true, signalName: 'unknown' }, []);

    const mediaBtns = domRoot.querySelectorAll('.media-btn');
    expect(mediaBtns[0].disabled).toBe(true);
    expect(mediaBtns[1].disabled).toBe(true);
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
    const slider = domRoot.querySelector('#processing-controls input[type="range"]');
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

  it('re-enables the viz sliders when a processing run completes', () => {
    domRoot = makeDOM();
    const screen = new ProcessingScreen(domRoot);

    // Deterministic RAF: queue callbacks and run them by hand.
    const rafCallbacks = new Map();
    let nextRafId = 1;
    vi.stubGlobal('requestAnimationFrame', (cb) => {
      const id = nextRafId++;
      rafCallbacks.set(id, cb);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id) => { rafCallbacks.delete(id); });
    const runFrames = (n) => {
      for (let i = 0; i < n; i++) {
        const cbs = [...rafCallbacks.values()];
        rafCallbacks.clear();
        for (const cb of cbs) cb(1000 + i * 16);
      }
    };

    const drive = {
      saved: true,
      signalName: 'deep_hum',
      isProcessing: true,
      processingProgress: 0.5,
      tickProcessing: vi.fn(),
      accumulateProcessing: vi.fn(),
    };
    screen.open(drive, []);

    const viz = domRoot.querySelector('#processing-viz');
    // While processing: sliders locked, minigame active, loop armed.
    expect(viz.classList.contains('disabled')).toBe(true);
    expect(domRoot.querySelector('#tuning-game').classList.contains('disabled')).toBe(false);
    expect(rafCallbacks.size).toBe(1);

    // The upgrade applies on the drive; the tracking loop must notice.
    drive.isProcessing = false;
    runFrames(1);

    expect(drive.tickProcessing).toHaveBeenCalled();
    // The sliders are interactive again and the minigame is over.
    expect(viz.classList.contains('disabled')).toBe(false);
    expect(domRoot.querySelector('#tuning-game').classList.contains('disabled')).toBe(true);
    expect(domRoot.querySelector('#processing-progress').style.display).toBe('none');
    // The loop stopped — no frames left pending.
    expect(rafCallbacks.size).toBe(0);

    screen.close();
  });

  it('dispose cleans up engine and signalRegistry references', () => {
    domRoot = makeDOM();
    const screen = new ProcessingScreen(domRoot);
    const engine = makeEngine();
    screen.setEngine(engine);
    screen.signalRegistry = makeSignalRegistry({});

    screen.open(null, []);
    screen.dispose();

    expect(screen._engine).toBeNull();
    expect(screen.signalRegistry).toBeNull();
    expect(domRoot.style.display).toBe('none');
  });
});
