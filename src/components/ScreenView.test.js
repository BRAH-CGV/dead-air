// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { ScreenView, screenSurface, screenMesh } from './ScreenView.js';
import { SCREEN_FOCUS } from '../gameplay/ScreenFocus.js';

// ─────────────────────────────────────────────
// ScreenView — leaning in to a screen, its overlay drawn on it (#161)
// ─────────────────────────────────────────────

const W = 1600, H = 900;

function makeEngine() {
  const camera = new THREE.PerspectiveCamera(75, W / H, 0.1, 1000);
  camera.position.set(0, 1.24, 0);   // standing at the origin, facing −z
  camera.updateMatrixWorld();
  return {
    camera,
    viewCamera: null,
    realDt: undefined,
    debugCamera: null,
    renderer: { domElement: { clientWidth: W, clientHeight: H } },
  };
}

/** A monitor 1.5 m ahead, its 0.5 × 0.3 m screen facing the player. */
function makeSurface() {
  const monitor = new THREE.Object3D();
  monitor.position.set(0, 1, -1.5);
  monitor.updateMatrixWorld();
  return screenSurface(monitor, [[-0.25, 0.15, 0], [0.25, 0.15, 0], [0.25, -0.15, 0], [-0.25, -0.15, 0]]);
}

function makeView(engine = makeEngine()) {
  const view = new ScreenView({ engine });
  const element = document.createElement('div');
  return { engine, view, element };
}

/** Run frames of `dt` until `seconds` have passed. */
function run(view, seconds, dt = 1 / 60) {
  for (let t = 0; t < seconds; t += dt) view.onLateUpdate(dt);
}

describe('screenSurface', () => {
  it('gives its corners in the world, through the object', () => {
    const s = makeSurface();
    const [tl, , br] = s.worldCorners();
    expect(tl.x).toBeCloseTo(-0.25);
    expect(tl.y).toBeCloseTo(1.15);
    expect(tl.z).toBeCloseTo(-1.5);
    expect(br.x).toBeCloseTo(0.25);
    expect(br.y).toBeCloseTo(0.85);
  });
});

describe('screenMesh', () => {
  it('lays a quad over the screen, on the object, facing out of it', () => {
    const s = makeSurface();
    const material = new THREE.MeshBasicMaterial();
    const mesh = screenMesh(s, material, { lift: 0.01 });
    expect(mesh.parent).toBe(s.object);
    expect(mesh.material).toBe(material);
    mesh.geometry.computeVertexNormals();
    const n = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.normal, 0);
    expect(n.z).toBeCloseTo(1);                       // out of the screen, toward the viewer
    const box = new THREE.Box3().setFromBufferAttribute(mesh.geometry.attributes.position);
    expect(box.min.z).toBeCloseTo(0.01);              // lifted off the glass
    expect(box.max.x - box.min.x).toBeCloseTo(0.5);
    expect(box.max.y - box.min.y).toBeCloseTo(0.3);
  });

  it('maps its uv the way the screen is read: (0, 1) top left, (1, 0) bottom right', () => {
    const mesh = screenMesh(makeSurface(), new THREE.MeshBasicMaterial());
    const { position, uv } = mesh.geometry.attributes;
    for (let i = 0; i < 4; i++) {
      expect(uv.getX(i)).toBeCloseTo(position.getX(i) > 0 ? 1 : 0);
      expect(uv.getY(i)).toBeCloseTo(position.getY(i) > 0 ? 1 : 0);
    }
  });

  it('casts and takes no shadow: it is a lit picture', () => {
    const mesh = screenMesh(makeSurface(), new THREE.MeshBasicMaterial());
    expect(mesh.castShadow).toBe(false);
    expect(mesh.receiveShadow).toBe(false);
  });
});

describe('ScreenView', () => {
  it('takes the frame with a camera of its own while open', () => {
    const { engine, view, element } = makeView();
    view.open(makeSurface(), element);
    view.onLateUpdate(1 / 60);
    expect(engine.viewCamera).toBeInstanceOf(THREE.PerspectiveCamera);
    expect(engine.viewCamera).not.toBe(engine.camera);
    expect(view.active).toBe(true);
  });

  it('starts at the eye and ends in front of the screen, square to it', () => {
    const { engine, view, element } = makeView();
    view.open(makeSurface(), element);
    view.onLateUpdate(0);
    const cam = engine.viewCamera;
    expect(cam.position.distanceTo(new THREE.Vector3(0, 1.24, 0))).toBeLessThan(1e-6);
    run(view, SCREEN_FOCUS.inSeconds + 0.1);
    expect(cam.position.x).toBeCloseTo(0);
    expect(cam.position.y).toBeCloseTo(1);
    expect(cam.position.z).toBeLessThan(-0.5);
    expect(cam.fov).toBeCloseTo(SCREEN_FOCUS.fov);
  });

  it('lays the overlay onto the screen at the layout size it keeps, to take the mouse', () => {
    const { view, element } = makeView();
    element.style.width = '1000px';
    element.style.height = '600px';
    view.open(makeSurface(), element);
    expect(element.classList.contains('is-focused')).toBe(true);
    run(view, SCREEN_FOCUS.inSeconds + 0.1);
    expect(element.style.width).toBe('1000px');
    expect(element.style.height).toBe('600px');
    expect(element.style.transform).toMatch(/^matrix3d\(/);
    // Never shown on the page: the picture is the screen's own.
    expect(element.style.opacity).toBe('');
  });

  it('hides the crosshair and the [E] prompt while the view is on a screen', () => {
    const { view, element } = makeView();
    view.open(makeSurface(), element);
    expect(document.body.classList.contains('screen-on')).toBe(true);
    run(view, 1);
    view.close();
    run(view, 1);
    expect(document.body.classList.contains('screen-on')).toBe(false);
  });

  it('writes the overlay\'s transform only when it changes: a still view is no style work', () => {
    const { view, element } = makeView();
    element.style.width = '1000px';
    element.style.height = '600px';
    view.open(makeSurface(), element);
    run(view, 1);
    const writes = vi.fn();
    const style = element.style;
    let value = style.transform;
    Object.defineProperty(style, 'transform', { get: () => value, set: (v) => { writes(); value = v; }, configurable: true });
    run(view, 0.5);
    expect(writes).not.toHaveBeenCalled();
  });

  it('holds(surface): the view is on that screen, leaning in, on it or leaning out', () => {
    const { view, element } = makeView();
    const surface = makeSurface();
    expect(view.holds(surface)).toBe(false);
    view.open(surface, element);
    expect(view.holds(surface)).toBe(true);
    expect(view.holds(makeSurface())).toBe(false);
    run(view, 1);
    view.close();
    expect(view.holds(surface)).toBe(true);
    run(view, 1);
    expect(view.holds(surface)).toBe(false);
  });

  it('leans back out, then gives the frame back and lets the overlay go', () => {
    const { engine, view, element } = makeView();
    view.open(makeSurface(), element);
    run(view, 1);
    const onClosed = vi.fn();
    view.close(onClosed);
    run(view, SCREEN_FOCUS.outSeconds / 2);
    expect(onClosed).not.toHaveBeenCalled();
    expect(engine.viewCamera).not.toBeNull();
    run(view, SCREEN_FOCUS.outSeconds);
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(engine.viewCamera).toBeNull();
    expect(view.active).toBe(false);
    expect(element.classList.contains('is-focused')).toBe(false);
    expect(element.style.transform).toBe('');
  });

  it('opened again on the way out, it leans back in and never closes', () => {
    const { view, element } = makeView();
    view.open(makeSurface(), element);
    run(view, 1);
    const onClosed = vi.fn();
    view.close(onClosed);
    run(view, SCREEN_FOCUS.outSeconds / 2);
    view.open(makeSurface(), element);
    run(view, 2);
    expect(onClosed).not.toHaveBeenCalled();
    expect(view.active).toBe(true);
  });

  it('leaves the overlay where it was while a corner is behind the camera', () => {
    const engine = makeEngine();
    engine.camera.rotation.y = Math.PI;   // facing away from the screen
    engine.camera.updateMatrixWorld();
    const { view, element } = makeView(engine);
    view.open(makeSurface(), element);
    view.onLateUpdate(SCREEN_FOCUS.inSeconds * 0.1);   // still facing away
    expect(element.style.transform).toBe('');
  });

  it('holds still while the fly camera is out', () => {
    const engine = makeEngine();
    engine.debugCamera = { active: true };
    const { view, element } = makeView(engine);
    view.open(makeSurface(), element);
    run(view, 2);
    expect(view.motion.t).toBe(0);
  });

  it('runs on real time, so slowed time does not slow the lean', () => {
    const { engine, view, element } = makeView();
    engine.realDt = 1;
    view.open(makeSurface(), element);
    view.onLateUpdate(0.01);
    expect(view.motion.phase).toBe('on');
  });

  it('cut() drops straight back to the eyes: the frame given back, the overlay let go', () => {
    const { engine, view, element } = makeView();
    const onClosed = vi.fn();
    view.open(makeSurface(), element);
    run(view, 1);
    view.close(onClosed);
    view.cut();
    expect(view.active).toBe(false);
    expect(engine.viewCamera).toBeNull();
    expect(element.classList.contains('is-focused')).toBe(false);
    expect(onClosed).toHaveBeenCalledTimes(1);
    view.cut();   // twice is nothing
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('gives everything back if the scene goes mid-lean', () => {
    const { engine, view, element } = makeView();
    view.open(makeSurface(), element);
    run(view, 0.2);
    view.onDestroy();
    expect(engine.viewCamera).toBeNull();
    expect(element.classList.contains('is-focused')).toBe(false);
  });

  it('leaves someone else\'s view camera alone when it closes', () => {
    const { engine, view, element } = makeView();
    view.open(makeSurface(), element);
    run(view, 1);
    view.close();
    const other = new THREE.PerspectiveCamera();
    engine.viewCamera = other;
    run(view, 1);
    expect(engine.viewCamera).toBe(other);
  });
});
