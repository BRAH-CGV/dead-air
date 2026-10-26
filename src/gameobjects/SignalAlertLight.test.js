import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SignalAlertLight, BULB } from './SignalAlertLight.js';
import { ASSETS } from '../assets/manifest.js';

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

  describe('lit', () => {
    it('is true through the bright half of a blink and false through the dim half', () => {
      const light = new SignalAlertLight();
      light.signalManager = mgr([sig()]);
      expect(light.lit).toBe(false);          // before anything has ticked

      light._update(0);
      expect(light.lit).toBe(true);
      light._update(light.period * 0.25);
      expect(light.lit).toBe(true);
      light._update(light.period * 0.25);
      expect(light.lit).toBe(false);
      light._update(light.period * 0.5);
      expect(light.lit).toBe(true);
    });

    it('is false with nothing to scan', () => {
      const light = new SignalAlertLight();
      const signals = [sig()];
      light.signalManager = mgr(signals);
      light._update(0);
      signals[0].scanned = true;
      light._update(0.01);
      expect(light.lit).toBe(false);
    });

    it('is false with no power, mid-blink or frantic', () => {
      const light = new SignalAlertLight();
      light.signalManager = mgr([sig()]);
      light._update(0);
      expect(light.lit).toBe(true);
      light.powerLevel = 0;
      light._update(0.01);
      expect(light.lit).toBe(false);
      light.frantic = true;
      for (let i = 0; i < 30; i++) {
        light._update(1 / 60);
        expect(light.lit).toBe(false);
      }
    });

    it('follows the frantic bursts', () => {
      const light = new SignalAlertLight();
      light.frantic = true;
      for (let i = 0; i < 60; i++) {
        light._update(1 / 60);
        expect(light.lit).toBe(bulb(light).material.emissiveIntensity > light.offIntensity);
      }
    });
  });

  describe('power and the UFO', () => {
    it('goes frantic — fast, irregular flashing — with nothing to scan', () => {
      const light = new SignalAlertLight();
      light.frantic = true;
      const seen = new Set();
      for (let i = 0; i < 60; i++) {
        light._update(1 / 60);
        seen.add(bulb(light).material.emissiveIntensity);
      }
      expect(seen.has(light.offIntensity)).toBe(true);
      expect([...seen].some(v => v > light.onIntensity)).toBe(true);   // brighter than a normal alert
      // Several flips in one second: far faster than the 0.8 s alert cycle.
      let flips = 0, prev = null;
      for (let i = 0; i < 60; i++) {
        light._update(1 / 60);
        const on = bulb(light).material.emissiveIntensity > light.offIntensity;
        if (prev !== null && on !== prev) flips++;
        prev = on;
      }
      expect(flips).toBeGreaterThan(6);
    });

    it('is dark with no power, frantic or not', () => {
      const light = new SignalAlertLight();
      light.frantic = true;
      light.powerLevel = 0;
      for (let i = 0; i < 30; i++) {
        light._update(1 / 60);
        expect(bulb(light).material.emissiveIntensity).toBe(0);
      }
    });
  });

  describe('a nap', () => {
    // A nap hands every update 15× the frame's real seconds (engine.timeScale);
    // the engine keeps the real ones as realDt.
    const napping = (light) => {
      const engine = { timeScale: 15, realDt: 0 };
      light.scene = { userData: { engine } };
      return (frame) => { engine.realDt = frame; light._update(frame * engine.timeScale); };
    };

    it('blinks on real time: one real second is a blink or two, not nineteen', () => {
      const light = new SignalAlertLight();
      light.signalManager = mgr([sig()]);
      const tick = napping(light);
      let lightUps = 0, was = false;
      for (let i = 0; i < 60; i++) {
        tick(1 / 60);
        if (light.lit && !was) lightUps++;
        was = light.lit;
      }
      expect(lightUps).toBeGreaterThanOrEqual(1);
      expect(lightUps).toBeLessThanOrEqual(2);
    });

    it('flashes frantic on real time too', () => {
      const light = new SignalAlertLight();
      light.frantic = true;
      const tick = napping(light);
      let flips = 0, was = null;
      for (let i = 0; i < 60; i++) {
        tick(1 / 60);
        if (was !== null && light.lit !== was) flips++;
        was = light.lit;
      }
      // Each burst or gap holds at least FRANTIC_MIN (0.03 s, two frames):
      // on game time every 15× frame outlasted one and it flipped every frame.
      expect(flips).toBeGreaterThan(6);
      expect(flips).toBeLessThanOrEqual(30);
    });
  });

  describe('wearing the bulb model', () => {
    /** A stand-in for bulb.glb: its glass and its base (screw and filament). */
    const model = () => {
      const root = new THREE.Group();
      const glass = new THREE.Mesh(new THREE.SphereGeometry(0.04), new THREE.MeshStandardMaterial({ name: 'lightbulb_01_glass' }));
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.04),
        new THREE.MeshStandardMaterial({ name: 'lightbulb_01_base', emissiveMap: new THREE.Texture() }));
      root.add(glass, base);
      return { root, glass, base };
    };
    const filament = light => light.object3d.getObjectByName('AlertFilament');

    it('wears it in place of the sphere, its glass the bulb, on copies of its materials', () => {
      const m = model();
      const shared = [m.glass.material, m.base.material];
      const light = new SignalAlertLight('SignalAlertLight', { model: m.root });
      expect(bulb(light)).toBe(m.glass);
      expect(filament(light)).toBe(m.base);
      expect(light.object3d.getObjectByProperty('type', 'Mesh').geometry).not.toBeInstanceOf(THREE.SphereGeometry);
      expect(shared).not.toContain(m.glass.material);                    // the cached model's are untouched
      expect(shared).not.toContain(m.base.material);
      expect(shared[0].emissive.getHex()).toBe(0);

      // Red glass you can see the filament through; a filament that glows red.
      expect(m.glass.material.transparent).toBe(true);
      expect(m.glass.material.opacity).toBeLessThan(1);
      expect(m.glass.material.depthWrite).toBe(false);
      expect(m.glass.material.emissive.getHex()).toBe(0xff2211);
      expect(m.base.material.emissiveMap).toBe(shared[1].emissiveMap);
      expect(m.base.material.emissive.r).toBeGreaterThan(m.base.material.emissive.b);
      for (const mesh of [m.glass, m.base]) expect(mesh.castShadow).toBe(false);
      expect(light.object3d.userData.offGrid).toBe(true);                // the grid leaves its glow to it
    });

    it('lights the glass and, brighter, the filament: on, off and with no power', () => {
      const m = model();
      const light = new SignalAlertLight('SignalAlertLight', { model: m.root });
      light.signalManager = mgr([sig()]);
      light._tick(0.1);                                                  // the bright half
      expect(m.glass.material.emissiveIntensity).toBe(light.onIntensity);
      expect(m.base.material.emissiveIntensity).toBeGreaterThan(light.onIntensity);
      light._tick(light.period / 2);                                     // the dim half
      expect(m.glass.material.emissiveIntensity).toBe(light.offIntensity);
      expect(m.base.material.emissiveIntensity).toBeLessThan(light.onIntensity);
      light.powerLevel = 0;
      light._tick(0.1);
      expect(m.glass.material.emissiveIntensity).toBe(0);
      expect(m.base.material.emissiveIntensity).toBe(0);
    });

    it('stands in a socket on its origin, the bulb screwed into it', () => {
      const m = model();
      const light = new SignalAlertLight('SignalAlertLight', { model: m.root });
      const socket = light.object3d.getObjectByName('AlertSocket');
      expect(socket).toBeDefined();
      const box = new THREE.Box3().setFromObject(socket);
      expect(box.min.y).toBeCloseTo(0, 6);
      expect(box.max.y).toBeCloseTo(BULB.socket.height, 6);
      expect(m.root.position.y).toBeCloseTo(BULB.lift, 6);
    });

    it('fits bulb.glb at its manifest scale: the screw\'s foot inside the socket, the glass above it', () => {
      const entry = ASSETS['model:bulb'];
      const glb = readFileSync(new URL(`../../public/${entry.url}`, import.meta.url));
      const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
      const [mesh] = json.meshes;
      const bounds = name => {
        const prim = mesh.primitives.find(p => json.materials[p.material].name === name);
        const { min, max } = json.accessors[prim.attributes.POSITION];
        return { min: min[1] * entry.scale + BULB.lift, max: max[1] * entry.scale + BULB.lift };
      };
      const screw = bounds('lightbulb_01_base'), glass = bounds('lightbulb_01_glass');
      expect(screw.min).toBeGreaterThan(0);
      expect(screw.min).toBeLessThan(BULB.socket.height);
      expect(glass.min).toBeGreaterThan(BULB.socket.height);
    });

    it('frees what it made, never the model\'s geometry (the asset cache\'s)', () => {
      const m = model();
      const light = new SignalAlertLight('SignalAlertLight', { model: m.root });
      const freed = [];
      const watch = r => r.addEventListener('dispose', () => freed.push(r));
      const socket = light.object3d.getObjectByName('AlertSocket');
      [m.glass.geometry, m.base.geometry, m.glass.material, m.base.material, socket.geometry, socket.material].forEach(watch);
      light.dispose();
      expect(freed).toContain(m.glass.material);
      expect(freed).toContain(m.base.material);
      expect(freed).toContain(socket.geometry);
      expect(freed).not.toContain(m.glass.geometry);
      expect(freed).not.toContain(m.base.geometry);
    });
  });
});
