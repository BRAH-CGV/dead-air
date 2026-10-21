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

  it('pins the overlay to the screen: sized to it, laid onto its corners', () => {
    const { view, element } = makeView();
    view.open(makeSurface(), element);
    run(view, SCREEN_FOCUS.inSeconds + 0.1);
    expect(element.classList.contains('on-screen')).toBe(true);
    const w = parseFloat(element.style.width), h = parseFloat(element.style.height);
    // A 5:3 screen filling `fill` of a 900 px tall view.
    expect(h).toBeCloseTo(H * SCREEN_FOCUS.fill, 0);
    expect(w / h).toBeCloseTo(5 / 3, 2);
    expect(element.style.transform).toMatch(/^matrix3d\(/);
    expect(element.style.opacity).toBe('1');
  });

  it('tells the overlay its size', () => {
    const { view, element } = makeView();
    const onSize = vi.fn();
    view.open(makeSurface(), element, { onSize });
    expect(onSize).toHaveBeenCalledTimes(1);
    const [w, h] = onSize.mock.calls[0];
    expect(h).toBeCloseTo(H * SCREEN_FOCUS.fill, 0);
    expect(w).toBeGreaterThan(h);
  });

  it('an overlay laid out at a size of its own keeps it, scaled onto the screen', () => {
    const { view, element } = makeView();
    const onSize = vi.fn();
    view.open(makeSurface(), element, { size: [1000, 600], onSize });
    run(view, SCREEN_FOCUS.inSeconds + 0.1);
    expect(element.style.width).toBe('1000px');
    expect(element.style.height).toBe('600px');
    expect(onSize).toHaveBeenCalledWith(1000, 600);
    expect(element.style.transform).toMatch(/^matrix3d\(/);
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
    expect(element.classList.contains('on-screen')).toBe(false);
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

  it('hides the overlay while a corner is behind the camera', () => {
    const engine = makeEngine();
    engine.camera.rotation.y = Math.PI;   // facing away from the screen
    engine.camera.updateMatrixWorld();
    const { view, element } = makeView(engine);
    view.open(makeSurface(), element);
    view.onLateUpdate(SCREEN_FOCUS.inSeconds * SCREEN_FOCUS.revealIn);   // picture up, still facing away
    expect(element.style.opacity).toBe('0');
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
    expect(element.classList.contains('on-screen')).toBe(false);
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
    expect(element.classList.contains('on-screen')).toBe(false);
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
