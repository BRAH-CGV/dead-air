import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('@dimforge/rapier3d', async () => (await import('../test/fakeRapier.js')).rapierModule());

import { BaseScene } from './BaseScene.js';
import { GameObject } from '../core/GameObject.js';
import { makeEngine } from '../test/fakeRapier.js';
import { SecurityCamera } from '../gameobjects/SecurityCamera.js';
import { CameraTerminal } from '../components/CameraTerminal.js';
import { Interactable } from '../components/Interactable.js';

// A full base build is slow under jsdom — see BaseScene.test.js.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// ─────────────────────────────────────────────
// The security cameras, in the base as built: eight cameras, the monitor on
// the desk's left wing that shows them, and the one flash they share.
// ─────────────────────────────────────────────

function makeSceneEngine() {
  const engine = makeEngine();
  engine.scene = new THREE.Scene();
  engine.scene.fog = new THREE.FogExp2(0x1a1a2e, 0.02);
  engine.assets = { get: vi.fn(() => null) };
  engine.camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000);
  engine.input = { keys: {}, pressed: {} };
  engine.keyBinds = { forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', flashlight: 'KeyF' };
  engine.consumeAction = vi.fn();
  engine.viewCamera = null;
  engine.buildPlayer = vi.fn(({ position = [0, 1, 5] } = {}) => {
    const player = new GameObject('Player');
    player.object3d.position.set(...position);
    engine.player = player;
    engine._rootObjects.push(player);
    return player;
  });
  return engine;
}

const worldPos = cam => cam.object3d.getWorldPosition(new THREE.Vector3());
const lookDir = cam => cam.lens.getWorldDirection(new THREE.Vector3());

describe('BaseScene security cameras', () => {
  let engine, scene, cams, byLabel, terminal;

  beforeAll(() => {
    engine = makeSceneEngine();
    scene = new BaseScene(engine);
    scene.build();
    engine.scene.userData.engine = engine;
    const sceneRoot = engine._rootObjects.find(go => go.name === 'SceneRoot');
    sceneRoot._init?.(engine.scene, engine.world);
    sceneRoot.object3d.updateMatrixWorld(true);
    // The first frame: the airlock portal draws the side the player is on.
    scene.portal.onStart();
    cams = scene.securityCameras;
    byLabel = Object.fromEntries(cams.map(c => [c.label, c]));
    terminal = scene.cameraTerminal;
  });

  it('without a renderer (headless), the terminal switches at once: no switch pass', () => {
    expect(terminal.signal).toBeNull();
  });

  it('builds eight cameras (the last two watch the vents)', () => {
    expect(cams).toHaveLength(8);
    for (const cam of cams) expect(cam).toBeInstanceOf(SecurityCamera);
  });

  describe('in the side rooms', () => {
    const corner = (roomName, label, side) => {
      const room = scene.rooms[roomName];
      const cam = byLabel[label];
      expect(cam, label).toBeDefined();
      const p = worldPos(cam);
      const b = room.bounds();
      // Inside the room's shell, near the ceiling.
      expect(b.containsPoint(p)).toBe(true);
      expect(p.y).toBeGreaterThan(room.height - 0.5);
      // The outer wall's end (the room's far side from the office) and the back.
      const outer = side < 0 ? b.min.x : b.max.x;
      expect(Math.abs(p.x - outer)).toBeLessThan(0.6);
      expect(p.z - b.min.z).toBeLessThan(0.6);
      // Looking down into the room.
      const d = lookDir(cam);
      expect(d.y).toBeLessThan(-0.2);
      expect(Math.sign(d.x)).toBe(-side);
      expect(d.z).toBeGreaterThan(0);
      expect(cam.zones).toEqual(['interior']);
      // Hung in the room, so it goes undrawn with the room's furnishings.
      let o = cam.object3d;
      while (o && o !== room.root.object3d) o = o.parent;
      expect(o).toBe(room.root.object3d);
    };

    it('living quarters: the left-hand room, in its top-left corner', () => corner('LivingQuarters', 'LIVING QUARTERS', -1));

    it('the corner camera sits on a wedge, so it does not float off the walls', () => {
      const wedge = byLabel['LIVING QUARTERS'].object3d.getObjectByName('CameraWedge');
      expect(wedge).toBeDefined();
      const room = scene.rooms.LivingQuarters, b = room.bounds(), t = room.wallThick;
      const box = new THREE.Box3().setFromObject(wedge, true);
      expect(box.min.x).toBeCloseTo(b.min.x + t, 2);   // on the end wall's inner face
      expect(box.min.z).toBeCloseTo(b.min.z + t, 2);   // and the back wall's
    });

    it('server room: the right-hand room, high in the middle of its back wall', () => {
      const room = scene.rooms.ServerRoom, b = room.bounds(), t = room.wallThick;
      const cam = byLabel['SERVER ROOM'];
      const p = worldPos(cam);
      expect(p.x).toBeCloseTo(room.position[0], 3);
      expect(p.z - (b.min.z + t)).toBeLessThan(0.1);   // on the back wall
      expect(p.y).toBeGreaterThan(room.height - 0.5);
      const d = lookDir(cam);
      expect(d.y).toBeLessThan(-0.2);
      expect(Math.abs(d.x)).toBeLessThan(1e-6);       // straight down the room
      expect(d.z).toBeGreaterThan(0);
      expect(cam.zones).toEqual(['interior']);
      // Square to its wall: nothing to fill behind it.
      expect(cam.object3d.getObjectByName('CameraWedge')).toBeUndefined();
    });
  });

  describe('on the outside of each end of the building, about its middle', () => {
    const end = (roomName, label, side) => {
      const cam = byLabel[label];
      expect(cam, label).toBeDefined();
      const p = worldPos(cam);
      const b = scene.rooms[roomName].bounds();
      expect(scene._isOutside(p)).toBe(true);
      // On the bunker's roof band, out past the end wall it covers.
      const face = (side < 0 ? b.min.x : b.max.x) + side * scene.bunker.fascia.out;
      expect(Math.abs(p.x - face)).toBeLessThan(0.1);
      expect(Math.abs(p.z - (b.min.z + b.max.z) / 2)).toBeLessThan(1);
      // Looking out, away from the building.
      expect(Math.sign(lookDir(cam).x)).toBe(side);
      expect(cam.zones).toContain('yard');
    };

    it('the living-quarters end (left)', () => end('LivingQuarters', 'EXTERIOR — QUARTERS END', -1));
    it('the server-room end (right)', () => end('ServerRoom', 'EXTERIOR — SERVER END', +1));
  });

  describe('two in the fenced yard, one each side', () => {
    const yard = (label, side) => {
      const cam = byLabel[label];
      expect(cam, label).toBeDefined();
      const p = worldPos(cam);
      const { minX, maxX, minZ, maxZ } = scene.fence.rect;
      expect(p.x).toBeGreaterThan(minX);
      expect(p.x).toBeLessThan(maxX);
      expect(p.z).toBeGreaterThan(minZ);
      expect(p.z).toBeLessThan(maxZ);
      expect(scene._isOutside(p)).toBe(true);
      expect(Math.sign(p.x)).toBe(side);
      // Looking straight out across the yard, square to the building.
      cam.setPan(0);
      cam.object3d.updateMatrixWorld(true);
      const d = lookDir(cam);
      expect(d.z).toBeGreaterThan(0.3);
      expect(Math.abs(d.x)).toBeLessThan(1e-6);
      expect(cam.zones).toContain('yard');
      // And able to turn all the way round each way, to look along the building.
      expect(cam.panLimits[0]).toBeCloseTo(-Math.PI / 2, 5);
      expect(cam.panLimits[1]).toBeCloseTo(Math.PI / 2, 5);
      for (const yaw of cam.panLimits) {
        cam.setPan(yaw);
        cam.object3d.updateMatrixWorld(true);
        const along = lookDir(cam).setY(0).normalize();
        expect(Math.abs(along.x)).toBeGreaterThan(0.999);
      }
      cam.setPan(0);
    };

    it('the quarters side (left)', () => yard('YARD — QUARTERS SIDE', -1));
    it('the server side (right)', () => yard('YARD — SERVER SIDE', +1));
  });

  it('the monitor on the left wing runs them: [E] opens the CameraTerminal', () => {
    const monitor = scene.rooms.MainOffice.cameraMonitor;
    expect(monitor.getComponent(CameraTerminal)).toBe(terminal);
    const interact = monitor.getComponent(Interactable);
    expect(interact.promptLabel).toMatch(/camera/i);
    expect(terminal.cameras).toBe(cams);
  });

  it('no camera can be panned so far its lens ends up in a wall (#bug: the yard cameras saw into the quarters)', () => {
    const shells = [...Object.values(scene.rooms), ...Object.values(scene.corridors)].map(p => p.bounds());
    for (const cam of cams) {
      const [lo, hi] = cam.panLimits;
      const room = Object.values(scene.rooms).find(r => {
        let o = cam.object3d;
        while (o && o !== r.root.object3d) o = o.parent;
        return !!o;
      });
      for (let i = 0; i <= 20; i++) {
        cam.setPan(lo + ((hi - lo) * i) / 20);
        cam.object3d.updateMatrixWorld(true);
        const lens = cam.lens.getWorldPosition(new THREE.Vector3());
        if (room) {
          // Inside its room, clear of every wall's inner face.
          const b = room.bounds().expandByScalar(-room.wallThick - 0.05);
          expect(b.containsPoint(lens), `${cam.label} at pan ${cam.pan.rotation.y.toFixed(2)}`).toBe(true);
        } else {
          // Outdoors, out of every shell, by a margin.
          expect(shells.some(s => s.clone().expandByScalar(0.05).containsPoint(lens)), `${cam.label} at pan ${cam.pan.rotation.y.toFixed(2)}`).toBe(false);
        }
      }
      cam.setPan(0);
    }
  });

  it('the yard cameras are square to the band, so need no wedge', () => {
    for (const label of ['YARD — QUARTERS SIDE', 'YARD — SERVER SIDE']) {
      expect(byLabel[label].object3d.getObjectByName('CameraWedge'), label).toBeUndefined();
    }
  });

  it('each wedge is the colour of the wall it is on', () => {
    const lq = scene.rooms.LivingQuarters;
    // Not loaded under test, the lining falls back to the room's own wall material.
    const inner = lq.root.object3d.getObjectByName('Lining_Walls')?.material ?? lq.material;
    const wedge = label => byLabel[label].object3d.getObjectByName('CameraWedge');
    // Indoors it may be the fog-free copy _keepFogOutside makes of a material
    // shared with something outside: the same wall, colour and texture.
    const indoor = wedge('LIVING QUARTERS').material;
    expect(indoor.color.getHex()).toBe(inner.color.getHex());
    expect(indoor.map).toBe(inner.map);
  });

  it('keeps ground round the farthest cameras (the poles), so no button hangs off the map', () => {
    const [across, down] = scene.cameraMap.margin;
    expect(across).toBeGreaterThanOrEqual(3);
    expect(down).toBeGreaterThanOrEqual(3);
  });

  it('hands the overlay a map: the rooms, the corridors, the yard and every camera', () => {
    const plan = scene.cameraMap;
    expect(plan.cameras).toHaveLength(8);
    plan.cameras.forEach((c, i) => {
      const p = worldPos(cams[i]);
      expect(c.x).toBeCloseTo(p.x, 3);
      expect(c.z).toBeCloseTo(p.z, 3);
      // The way it faces at rest, level — the map puts its square that side
      // of the wall: inside the room for a room camera, outside for the rest.
      cams[i].setPan(0);
      cams[i].object3d.updateMatrixWorld(true);
      const d = lookDir(cams[i]).setY(0).normalize();
      expect(Math.hypot(...c.dir)).toBeCloseTo(1);
      expect(c.dir[0]).toBeCloseTo(d.x, 3);
      expect(c.dir[1]).toBeCloseTo(d.z, 3);
    });
    const labels = plan.rooms.map(r => r.label);
    expect(labels).toEqual(expect.arrayContaining(['OFFICE', 'QTRS', 'SRVR', 'A/L', 'YARD']));
    expect(plan.cameras.map(c => c.label)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(plan.rooms.find(r => r.label === 'YARD').outline).toBe(true);
    // Room beside the building, so the end-wall cameras read as outside it.
    expect(plan.margin[0]).toBeGreaterThanOrEqual(4);
  });

  it('frees the mouse for the map while watching, and takes it back after', () => {
    const spy = vi.spyOn(scene, '_usePanel');
    terminal.enter();
    expect(spy).toHaveBeenLastCalledWith(true);
    expect(engine.uiHasMouse).toBe(true);
    terminal.exit();
    expect(spy).toHaveBeenLastCalledWith(false);
    expect(engine.uiHasMouse).toBe(false);
    spy.mockRestore();
  });

  it('one flash for all of them: a spotlight off the grid, zeroed, never under a room', () => {
    const flash = scene.cameraFlash;
    expect(flash.isSpotLight).toBe(true);
    expect(flash.intensity).toBe(0);
    expect(flash.castShadow).toBe(false);
    for (const part of [...Object.values(scene.rooms), ...Object.values(scene.corridors)]) {
      let inside = false;
      part.root.object3d.traverse(o => { if (o === flash) inside = true; });
      expect(inside, part.name).toBe(false);
    }
    // The generator's grid doesn't own it: power cuts and blow-outs leave it be.
    scene.power.setOn(false);
    scene.power.update(1 / 60);
    scene.power.setOn(true);
    expect(terminal.flash).toBe(flash);
  });

  it('runs on the generator, like the computer', () => {
    scene.power.setOn(false);
    expect(terminal.powered).toBe(false);
    scene.power.setOn(true);
    expect(terminal.powered).toBe(true);
  });

  it('a yard camera draws the yard from indoors; back at the desk it goes again', () => {
    expect(scene.zones.isVisible('yard')).toBe(false);
    terminal.enter();
    terminal.feed.select(cams.indexOf(byLabel['YARD — QUARTERS SIDE']));
    terminal._showCamera();
    expect(engine.viewCamera).toBe(byLabel['YARD — QUARTERS SIDE'].lens);
    expect(scene.zones.isVisible('yard')).toBe(true);
    terminal.exit();
    expect(engine.viewCamera).toBeNull();
    expect(scene.zones.isVisible('yard')).toBe(false);
    expect(scene.zones.isVisible('interior')).toBe(true);
  });

  it('a game over takes the player off the monitor', () => {
    scene.gameController.startNight(1);
    terminal.enter();
    expect(terminal.state).toBe('viewing');
    scene.gameController.fail();
    expect(terminal.state).toBe('idle');
    expect(engine.viewCamera).toBeNull();
  });

  it('dispose hands the frame back to the player’s eyes', () => {
    scene.gameController.startNight(1);
    terminal.enter();
    scene.dispose();
    expect(engine.viewCamera).toBeNull();
    expect(terminal.state).toBe('idle');
  });
});
