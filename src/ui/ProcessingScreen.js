// ─────────────────────────────────────────────
// ProcessingScreen  –  Signal processing console overlay
// ────────────────────────────────────────────
// A DOM overlay (same pattern as RadarOverlay / BreakerPanel) shown when
// the player interacts with the ServerRoom processing console. Displays
// a spectrogram of the signal stored on the inserted drive, with media
// controls (play/pause, stop) and an abstract set of gameplay actions
// (upgrade button, etc.) below.
//
// The actions are described by an array of action objects:
//   { id, label, enabled, onClick, render? }
// The default renderer creates a <button>; a custom `render(container, action)`
// hook lets callers draw sliders, knobs or any other widget.
//
// The screen opens even with no drive inserted — the preview area stays
// blank and every action starts disabled.
// ─────────────────────────────────────────────

import { FirstPersonController } from '../components/FirstPersonController.js';
import { decode as decodeAudio, compute as computeSpectrogram, render as renderSpectrogram, renderBlend } from './Spectrogram.js';

export class ProcessingScreen {
  /** @type {import('../gameplay/SignalRegistry.js').SignalRegistry|null} */
  signalRegistry = null;

  /** Engine reference for input locking. Set by the scene that owns it. */
  _engine = null;

  /** The actions currently rendered, so refreshActions can re-evaluate. */
  _actions = [];

  /** The drive passed to the last open() call. */
  _drive = null;

  /** Key handler for Q-to-close. */
  _keyHandler = null;

  /** Shared AudioContext for decoding. Created lazily. */
  _audioContext = null;

  /** Pending spectrogram render (cancellable). */
  _renderAbort = null;

  /** Cached spectrogram result for live slider re-render. */
  _spectrogramResult = null;

  /** requestAnimationFrame handle for the scanline. */
  _scanlineRaf = null;

  /** requestAnimationFrame handle for the processing progress bar. */
  _progressRaf = null;

  /** Blend animation state (old → new spectrogram during processing). */
  _blendRaf = null;
  _blendOldResult = null;
  _blendNewResult = null;
  _blendRevealOrder = null;
  _blendComplete = false;

  constructor(root = typeof document !== 'undefined' ? document.getElementById('processing-screen') : null) {
    this.root = root;
    this._spectrogram = root?.querySelector('#processing-spectrogram') ?? null;
    this._audio       = root?.querySelector('#processing-audio')       ?? null;
    this._media       = root?.querySelector('#processing-media')       ?? null;
    this._controls    = root?.querySelector('#processing-controls')    ?? null;
    this._hint        = root?.querySelector('#processing-hint')        ?? null;
    this._title       = root?.querySelector('#processing-title')       ?? null;
    this._gainSlider   = root?.querySelector('#viz-gain')              ?? null;
    this._contrastSlider = root?.querySelector('#viz-contrast')        ?? null;
    this._volumeSlider = root?.querySelector('#viz-volume')            ?? null;
    this._scanline     = root?.querySelector('#processing-scanline')   ?? null;
    this._progressContainer = root?.querySelector('#processing-progress')      ?? null;
    this._progressFill      = root?.querySelector('#processing-progress-fill') ?? null;
    this._progressLabel     = root?.querySelector('#processing-progress-label') ?? null;
    this._installVizListeners();
    this._installVolumeListener();
  }

  /** Wire the engine so open/close can lock input and hide the crosshair.
   *  @param {import('../core/Engine.js').Engine} engine */
  setEngine(engine) { this._engine = engine; }

  /** Open the screen. `drive` may be null (blank preview). `actions` is an
   *  array of abstract control descriptors.
   *  @param {object|null} drive
   *  @param {Array<{id:string, label:string, enabled:boolean, onClick?:function, render?:function}>} actions */
  open(drive, actions = []) {
    if (!this.root) return;
    this._drive = drive;
    this._actions = actions;
    this._updateSpectrogram(drive);
    this._renderMediaButtons(drive);
    this._renderActions(actions);
    this.root.style.display = 'flex';
    this._lockInput(true);
    this._installKeyHandler();
    this._startProgressTracking(drive);
  }

  /** Close the screen and restore input. */
  close() {
    if (!this.root) return;
    this.root.style.display = 'none';
    this._stopScanline();
    this._stopProgressTracking();
    this._stopBlend();
    this._clearSpectrogram();
    this._clearMediaButtons();
    this._clearActions();
    this._lockInput(false);
    this._removeKeyHandler();
    this._drive = null;
    this._actions = [];
    if (this._audio) { this._audio.pause(); this._audio.currentTime = 0; }
  }

  /** Re-render the controls with updated enabled/label state. Call after
   *  an action changes the drive (e.g. upgrade). */
  refreshActions(drive) {
    this._drive = drive;
    this._updateSpectrogram(drive);
    this._renderMediaButtons(drive);
    this._renderActions(this._actions);
    this._startProgressTracking(drive);
  }

  /** Stop listening for keys and drop references. The DOM element lives
   *  on (index.html), but scene-rebuild safety requires cleanup. */
  dispose() {
    this.close();
    this._engine = null;
    this.signalRegistry = null;
    if (this._audioContext) {
      this._audioContext.close().catch(() => {});
      this._audioContext = null;
    }
  }

  // ─ Internals ──────────────────────────────────────────────

  /** Resolve the audio URL for a drive via the signal registry. */
  _audioUrl(drive) {
    if (!drive?.saved || !drive.signalName) return '';
    const reg = this.signalRegistry;
    if (!reg) return '';
    return reg.getAudioUrl(drive.signalName, drive.signalLevel ?? 1);
  }

  /** Decode the audio and render the spectrogram. Cancels any in-flight
   *  render so a rapid refresh doesn't race. */
  async _updateSpectrogram(drive) {
    // Cancel any previous render.
    if (this._renderAbort) {
      this._renderAbort.cancelled = true;
      this._renderAbort = null;
    }
    const token = { cancelled: false };
    this._renderAbort = token;

    const url = this._audioUrl(drive);
    if (!url || !this._spectrogram) {
      this._spectrogramResult = null;
      this._clearSpectrogram();
      return;
    }

    try {
      // Lazily create a shared AudioContext.
      if (!this._audioContext) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        this._audioContext = new Ctx();
      }
      const audioBuffer = await decodeAudio(url, this._audioContext);
      if (token.cancelled) return;
      const result = computeSpectrogram(audioBuffer);
      if (token.cancelled) return;
      this._spectrogramResult = result;
      renderSpectrogram(this._spectrogram, result, this._vizOpts());
    } catch (err) {
      // Decoding or rendering failed — leave the canvas blank.
      console.error('[ProcessingScreen] spectrogram error:', err);
      if (!token.cancelled) this._clearSpectrogram();
    }
  }

  /** Read current slider values into a render-opts object. */
  _vizOpts() {
    return {
      gain:     Number(this._gainSlider?.value)     || 1,
      contrast: Number(this._contrastSlider?.value) || 1,
      maxFreq:  16000,
    };
  }

  /** Re-render the cached spectrogram with current slider values. */
  _rerenderSpectrogram() {
    if (!this._spectrogramResult || !this._spectrogram) return;
    renderSpectrogram(this._spectrogram, this._spectrogramResult, this._vizOpts());
  }

  /** Wire slider input events to live re-render the spectrogram. */
  _installVizListeners() {
    const onChange = () => this._rerenderSpectrogram();
    this._gainSlider?.addEventListener('input', onChange);
    this._contrastSlider?.addEventListener('input', onChange);
  }

  /** Wire the volume slider to the audio element. */
  _installVolumeListener() {
    const apply = () => {
      if (this._audio && this._volumeSlider) {
        this._audio.volume = Number(this._volumeSlider.value);
      }
    };
    this._volumeSlider?.addEventListener('input', apply);
    // Set initial volume.
    apply();
  }

  /** Start the scanline animation loop. */
  _startScanline() {
    if (!this._scanline || !this._audio) return;
    this._scanline.style.display = 'block';
    const tick = () => {
      if (this._audio.paused || this._audio.ended) {
        this._stopScanline();
        return;
      }
      const dur = this._audio.duration || 1;
      const pct = (this._audio.currentTime / dur) * 100;
      // Map percentage across the spectrogram canvas width within the preview.
      this._scanline.style.left = `${pct}%`;
      this._scanlineRaf = requestAnimationFrame(tick);
    };
    this._scanlineRaf = requestAnimationFrame(tick);
  }

  /** Stop the scanline animation and hide it. */
  _stopScanline() {
    if (this._scanlineRaf) {
      cancelAnimationFrame(this._scanlineRaf);
      this._scanlineRaf = null;
    }
    if (this._scanline) this._scanline.style.display = 'none';
  }

  _clearSpectrogram() {
    if (!this._spectrogram) return;
    const ctx = this._spectrogram.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, this._spectrogram.width, this._spectrogram.height);
    }
  }

  /** Render play/pause and stop buttons into the media container.
   *  Buttons are disabled when no audio URL is available. */
  _renderMediaButtons(drive) {
    if (!this._media) return;
    this._clearMediaButtons();
    const url = this._audioUrl(drive);
    const audio = this._audio;
    if (!audio) return;

    // Set the audio source (changing src resets playback state).
    if (audio.src !== url) {
      audio.src = url || '';
      audio.load();
    }

    const hasAudio = !!url;
    const locked = drive?.isProcessing ?? false;

    // Play/Pause toggle.
    const playBtn = document.createElement('button');
    playBtn.className = 'media-btn';
    playBtn.textContent = 'Play';
    playBtn.disabled = !hasAudio || locked;
    playBtn.dataset.actionId = 'play-pause';
    if (hasAudio) {
      playBtn.addEventListener('click', () => {
        if (audio.paused) {
          audio.play().catch(() => {});
          playBtn.textContent = 'Pause';
          this._startScanline();
        } else {
          audio.pause();
          playBtn.textContent = 'Play';
          this._stopScanline();
        }
      });
      // Sync button label and scanline when playback ends naturally.
      audio.addEventListener('ended', () => {
        playBtn.textContent = 'Play';
        this._stopScanline();
      });
    }
    this._media.appendChild(playBtn);

    // Stop button.
    const stopBtn = document.createElement('button');
    stopBtn.className = 'media-btn';
    stopBtn.textContent = 'Stop';
    stopBtn.disabled = !hasAudio || locked;
    stopBtn.dataset.actionId = 'stop';
    if (hasAudio) {
      stopBtn.addEventListener('click', () => {
        audio.pause();
        audio.currentTime = 0;
        playBtn.textContent = 'Play';
        this._stopScanline();
      });
    }
    this._media.appendChild(stopBtn);
  }

  _clearMediaButtons() {
    if (!this._media) return;
    this._media.innerHTML = '';
  }

  /** Render the action descriptors into the controls container. Each
   *  action with a custom `render` hook gets it called; otherwise a
   *  default <button> is created. */
  _renderActions(actions) {
    if (!this._controls) return;
    this._clearActions();
    for (const action of actions) {
      if (typeof action.render === 'function') {
        action.render(this._controls, action);
      } else {
        const btn = document.createElement('button');
        btn.className = 'processing-btn';
        btn.textContent = action.label;
        btn.disabled = !action.enabled;
        btn.dataset.actionId = action.id;
        if (action.enabled && typeof action.onClick === 'function') {
          btn.addEventListener('click', action.onClick);
        }
        this._controls.appendChild(btn);
      }
    }
  }

  _clearActions() {
    if (!this._controls) return;
    // Remove click listeners by replacing the contents wholesale.
    this._controls.innerHTML = '';
  }

  /** Lock or unlock player movement (WASD + mouse look) while the screen
   *  is open. Mirrors BaseScene._usePanel: releases pointer lock so the
   *  cursor is visible for clicking buttons, and tells the App layer the
   *  mouse is in use (no pause on lock loss). */
  _lockInput(locked) {
    if (!this._engine?.player) return;
    const ctrl = this._engine.player.getComponent(FirstPersonController);
    if (ctrl) ctrl.inputLocked = locked;
    // Tell the app layer the lock is being let go on purpose (no pause).
    this._engine.uiHasMouse = locked;
    // Hide the first-person reticle while the overlay is showing.
    if (this._engine.crosshair) {
      locked ? this._engine.crosshair.hide() : this._engine.crosshair.show();
    }
    // Release / re-request pointer lock so the cursor is visible for buttons.
    const canvas = this._engine.renderer?.domElement;
    if (locked) {
      if (typeof document !== 'undefined' && document.pointerLockElement) {
        document.exitPointerLock?.();
      }
    } else {
      try { canvas?.requestPointerLock?.()?.catch?.(() => {}); } catch (_) { /* no gesture: the next click locks */ }
    }
  }

  _installKeyHandler() {
    this._removeKeyHandler();
    this._keyHandler = (e) => {
      if (e.code === 'KeyQ') {
        e.preventDefault();
        this.close();
      }
    };
    addEventListener('keydown', this._keyHandler);
  }

  _removeKeyHandler() {
    if (this._keyHandler) {
      removeEventListener('keydown', this._keyHandler);
      this._keyHandler = null;
    }
  }

  // ── Processing progress ────────────────────────────────────

  /** Start tracking a drive's processing progress. Shows the progress bar
   *  if the drive is currently processing; hides it otherwise. The blend
   *  animation (if the target spectrogram has loaded) runs here, during
   *  processing, so the reveal tracks the progress bar in real time. */
  _startProgressTracking(drive) {
    this._stopProgressTracking();
    if (!drive?.isProcessing) {
      this._hideProgress();
      return;
    }
    this._showProgress();
    const tick = () => {
      if (!drive.isProcessing) {
        this._onProcessingComplete(drive);
        return;
      }
      this._updateProgress(drive);
      // Render the blend if the target spectrogram has loaded.
      if (this._blendOldResult && this._blendNewResult && !this._blendComplete) {
        renderBlend(
          this._spectrogram, this._blendOldResult, this._blendNewResult,
          drive.processingProgress, this._blendRevealOrder, this._vizOpts(),
        );
        if (drive.processingProgress >= 1) this._blendComplete = true;
      }
      this._progressRaf = requestAnimationFrame(tick);
    };
    this._progressRaf = requestAnimationFrame(tick);
  }

  _stopProgressTracking() {
    if (this._progressRaf) {
      cancelAnimationFrame(this._progressRaf);
      this._progressRaf = null;
    }
    this._hideProgress();
  }

  /** Called when the drive's processing finishes. Applies the upgrade,
   *  hides the bar, and either completes the blend animation (if the
   *  target loaded late) or refreshes the spectrogram directly. */
  _onProcessingComplete(drive) {
    drive.tickProcessing();
    this._hideProgress();
    this._renderActions(this._actions);
    this._renderMediaButtons(drive);

    if (this._blendOldResult && this._blendNewResult) {
      if (!this._blendComplete) {
        // Target loaded but blend wasn't finished — run a quick final RAF
        // loop to complete the reveal, then refresh.
        const finishBlend = () => {
          if (!this._spectrogram || !this._blendOldResult || !this._blendNewResult) {
            this._refreshAfterProcessing(drive);
            return;
          }
          renderBlend(
            this._spectrogram, this._blendOldResult, this._blendNewResult,
            1, this._blendRevealOrder, this._vizOpts(),
          );
          this._stopBlend();
          this._refreshAfterProcessing(drive);
        };
        requestAnimationFrame(finishBlend);
        return;
      }
      // Blend already complete — just clean up and refresh.
      this._stopBlend();
    }
    this._refreshAfterProcessing(drive);
  }

  /** Full refresh after processing + blend complete. */
  _refreshAfterProcessing(drive) {
    this._updateSpectrogram(drive);
    this._renderMediaButtons(drive);
    this._renderActions(this._actions);
  }

  _showProgress() {
    if (this._progressContainer) this._progressContainer.style.display = 'flex';
  }

  _hideProgress() {
    if (this._progressContainer) this._progressContainer.style.display = 'none';
  }

  _updateProgress(drive) {
    const pct = (drive.processingProgress * 100).toFixed(0);
    if (this._progressFill) this._progressFill.style.width = `${pct}%`;
    const secs = Math.ceil(drive.processingRemainingMs / 1000);
    if (this._progressLabel) this._progressLabel.textContent = `Processing… ${secs}s`;
  }

  // ── Spectrogram blend transition ───────────────────────────

  /** Pre-load the target spectrogram for the blend transition. Called by
   *  the upgrade button's onClick so the target is ready (or loading)
   *  while the 30 s processing timer runs. The blend runs DURING
   *  processing — not after — so the reveal tracks the progress bar. */
  async prepareBlend(drive) {
    this._stopBlend();
    const oldResult = this._spectrogramResult;
    if (!oldResult) return;

    // The drive is still at the CURRENT level; the target is one higher.
    const targetLevel = (drive.signalLevel ?? 1) + 1;
    const targetUrl = this.signalRegistry?.getAudioUrl(drive.signalName, targetLevel) ?? '';
    if (!targetUrl) return;

    try {
      if (!this._audioContext) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        this._audioContext = new Ctx();
      }
      const audioBuffer = await decodeAudio(targetUrl, this._audioContext);
      if (!this._spectrogram) return;  // screen closed during load
      const newResult = computeSpectrogram(audioBuffer);
      this._setupBlend(oldResult, newResult);
    } catch {
      // Target audio failed to load — blend won't run; completion will
      // fall back to a direct spectrogram refresh.
    }
  }

  /** Set up the blend state (reveal order + cached results). Called once
   *  the target spectrogram has loaded. The progress RAF loop picks up
   *  the blend on its next frame. */
  _setupBlend(oldResult, newResult) {
    this._blendOldResult = oldResult;
    this._blendNewResult = newResult;
    this._blendComplete = false;

    // Build a randomised column reveal order (localised shuffles so the
    // progression is generally left-to-right with bursty chunks).
    const total = oldResult.frames;
    const order = Array.from({ length: total }, (_, i) => i);
    const chunkSize = Math.max(1, Math.ceil(total / 40));
    for (let start = 0; start < total; start += chunkSize) {
      const end = Math.min(start + chunkSize, total);
      for (let i = end - 1; i > start; i--) {
        const j = start + Math.floor(Math.random() * (i - start + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
    }
    this._blendRevealOrder = order;
  }

  /** Stop the blend animation and clear the state. */
  _stopBlend() {
    if (this._blendRaf) {
      cancelAnimationFrame(this._blendRaf);
      this._blendRaf = null;
    }
    this._blendOldResult = null;
    this._blendNewResult = null;
    this._blendRevealOrder = null;
    this._blendComplete = false;
  }
}
