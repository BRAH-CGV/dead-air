import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { SignalAlertLight } from './SignalAlertLight.js';

// ─────────────────────────────────────────────
// SignalAlertLight — the red lamp over the computer desk
// ─────────────────────────────────────────────

/** A signal stand-in: isAlerting() only reads scanned and opacity. */
const sig = (over = {}) => ({ scanned: false, opacity: 1, ...over });
const mgr = (signals) => ({ signals });

const bulb = (light) => light.object3d.getObjectByName('AlertBulb');

describe('SignalAlertLight', () => {
  it('is a GameObject named SignalAlertLight with a single red emissive bulb', () => {
    const light = new SignalAlertLight();
    expect(light.name).toBe('SignalAlertLight');
    const mesh = bulb(light);
    expect(mesh).toBeDefined();
    expect(mesh.geometry).toBeInstanceOf(THREE.SphereGeometry);
    expect(mesh.material.emissive.getHex()).toBe(0xff2211);
  });

  it('starts dark, before any manager is wired', () => {
    const light = new SignalAlertLight();
    light._update(0.1);
    expect(bulb(light).material.emissiveIntensity).toBe(light.offIntensity);
  });

  it('dispose frees its geometry and material', () => {
    const light = new SignalAlertLight();
    const mesh = bulb(light);
    let geom = false, mat = false;
    mesh.geometry.addEventListener('dispose', () => { geom = true; });
    mesh.material.addEventListener('dispose', () => { mat = true; });
    light.dispose();
    expect(geom).toBe(true);
    expect(mat).toBe(true);
  });

  describe('isAlerting', () => {
    it('is false with no manager', () => {
      expect(new SignalAlertLight().isAlerting()).toBe(false);
    });

    it('is false when no signal is visible yet', () => {
      const light = new SignalAlertLight();
      light.signalManager = mgr([sig({ opacity: 0 })]);
      expect(light.isAlerting()).toBe(false);
    });

    it('is true while an unscanned signal is visible', () => {
      const light = new SignalAlertLight();
      light.signalManager = mgr([sig({ opacity: 0.3 })]);
      expect(light.isAlerting()).toBe(true);
    });

    it('ignores scanned signals, even ones still fading out', () => {
      const light = new SignalAlertLight();
      light.signalManager = mgr([sig({ scanned: true, opacity: 0.5 })]);
      expect(light.isAlerting()).toBe(false);
    });

    it('is dark outside playing when a controller is wired', () => {
      const light = new SignalAlertLight();
      light.signalManager = mgr([sig()]);
      for (const state of ['idle', 'morning', 'gameOver', 'finished']) {
        light.gameController = { state };
        expect(light.isAlerting(), state).toBe(false);
      }
      light.gameController = { state: 'playing' };
      expect(light.isAlerting()).toBe(true);
    });
  });

  describe('blink', () => {
    it('blinks square-wave while alerting: on, then off, then back on', () => {
      const light = new SignalAlertLight();
      light.signalManager = mgr([sig()]);
      const mat = bulb(light).material;

      light._update(0);                       // phase 0 — start of the cycle
      expect(mat.emissiveIntensity).toBe(light.onIntensity);
      light._update(light.period * 0.25);     // first half of the period
      expect(mat.emissiveIntensity).toBe(light.onIntensity);
      light._update(light.period * 0.25);     // now past the halfway mark
      expect(mat.emissiveIntensity).toBe(light.offIntensity);
      light._update(light.period * 0.5);      // wraps to the next cycle
      expect(mat.emissiveIntensity).toBe(light.onIntensity);
    });

    it('goes dark and resets its phase the moment nothing is scannable', () => {
      const light = new SignalAlertLight();
      const signals = [sig()];
      light.signalManager = mgr(signals);
      const mat = bulb(light).material;

      light._update(light.period);            // mid-cycle somewhere
      signals[0].scanned = true;              // player took it
      light._update(0.01);
      expect(mat.emissiveIntensity).toBe(light.offIntensity);

      signals[0].scanned = false;             // a new window opens
      light._update(0);
      expect(mat.emissiveIntensity).toBe(light.onIntensity);   // restarts on, not mid-off
    });

    it('stays dark when the controller leaves playing, even with a visible signal', () => {
      const light = new SignalAlertLight();
      light.signalManager = mgr([sig()]);
      light.gameController = { state: 'morning' };
      light._update(0.1);
      expect(bulb(light).material.emissiveIntensity).toBe(light.offIntensity);
    });
  });
});
