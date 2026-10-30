import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ShadowScheduler } from './ShadowScheduler.js';

// ─────────────────────────────────────────────
// ShadowScheduler  –  render shadow maps only when something changed
// ─────────────────────────────────────────────
// The renderer clears `shadow.needsUpdate` after it draws a map; `rendered()`
// below stands in for that frame.

function scene() {
  const root = new THREE.Scene();
  const moon = new THREE.DirectionalLight();
  moon.position.set(0, 10, 10);
  moon.castShadow = true;
  root.add(moon, moon.target);

  const lamp = new THREE.PointLight();
  lamp.position.set(0, 2.5, 0);
  lamp.castShadow = true;
  root.add(lamp);

  const fill = new THREE.PointLight();       // no shadow — not ours to manage
  root.add(fill);

  root.updateMatrixWorld(true);
  return { root, moon, lamp, fill };
}

/** The renderer's side: it draws every flagged map and clears the flag. */
function rendered(...lights) {
  for (const l of lights) l.shadow.needsUpdate = false;
}

describe('ShadowScheduler', () => {
  it('freezes every shadow-casting light, after one first render', () => {
    const { root, moon, lamp, fill } = scene();
    new ShadowScheduler().adopt(root);

    for (const light of [moon, lamp]) {
      expect(light.shadow.autoUpdate).toBe(false);
      expect(light.shadow.needsUpdate).toBe(true);
    }
    expect(fill.shadow.autoUpdate).toBe(true);
  });

  it('leaves a frozen map alone while nothing moves', () => {
    const { root, moon, lamp } = scene();
    const shadows = new ShadowScheduler();
    shadows.adopt(root);
    rendered(moon, lamp);

    shadows.update();
    shadows.update();
    expect(moon.shadow.needsUpdate).toBe(false);
    expect(lamp.shadow.needsUpdate).toBe(false);
  });

  it('re-renders a directional light once it has turned past the threshold, not for every hair', () => {
    const { root, moon, lamp } = scene();
    const shadows = new ShadowScheduler({ angle: THREE.MathUtils.degToRad(0.5) });
    shadows.adopt(root);
    rendered(moon, lamp);

    // ~0.1° — under the threshold.
    moon.position.applyAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(0.1));
    shadows.update();
    expect(moon.shadow.needsUpdate).toBe(false);

    // Another 0.6° on top — the total since the last render counts.
    moon.position.applyAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(0.6));
    shadows.update();
    expect(moon.shadow.needsUpdate).toBe(true);
    expect(lamp.shadow.needsUpdate).toBe(false);   // only the light that moved
  });

  it('measures from the last render, so a slow drift still lands', () => {
    const { root, moon, lamp } = scene();
    const shadows = new ShadowScheduler({ angle: THREE.MathUtils.degToRad(0.5) });
    shadows.adopt(root);
    rendered(moon, lamp);

    let flagged = 0;
    for (let i = 0; i < 20; i++) {
      moon.position.applyAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(0.1));
      shadows.update();
      if (moon.shadow.needsUpdate) { flagged++; rendered(moon); }
    }
    expect(flagged).toBeGreaterThanOrEqual(3);     // 2° in 0.5° steps
    expect(flagged).toBeLessThanOrEqual(4);
  });

  it('re-renders a point light that moves', () => {
    const { root, moon, lamp } = scene();
    const shadows = new ShadowScheduler();
    shadows.adopt(root);
    rendered(moon, lamp);

    lamp.position.x += 0.5;
    shadows.update();
    expect(lamp.shadow.needsUpdate).toBe(true);
  });

  it('invalidate() re-renders every map once — a door shut, a zone swapped', () => {
    const { root, moon, lamp } = scene();
    const shadows = new ShadowScheduler();
    shadows.adopt(root);
    rendered(moon, lamp);

    shadows.invalidate();
    expect(moon.shadow.needsUpdate).toBe(true);
    expect(lamp.shadow.needsUpdate).toBe(true);
  });

  it('watch() re-renders the given lights while a shadow caster moves', () => {
    const { root, moon, lamp } = scene();
    const dish = new THREE.Object3D();
    root.add(dish);
    const shadows = new ShadowScheduler();
    shadows.adopt(root);
    shadows.watch(dish, [moon]);
    rendered(moon, lamp);

    shadows.update();
    expect(moon.shadow.needsUpdate).toBe(false);   // still

    dish.rotation.y += 0.2;
    shadows.update();
    expect(moon.shadow.needsUpdate).toBe(true);
    expect(lamp.shadow.needsUpdate).toBe(false);
  });

  it('adopting the same scene twice does not double-track', () => {
    const { root } = scene();
    const shadows = new ShadowScheduler();
    shadows.adopt(root);
    shadows.adopt(root);
    expect(shadows.lights).toHaveLength(2);
  });

  it('release() hands every light back to per-frame updates', () => {
    const { root, moon, lamp } = scene();
    const shadows = new ShadowScheduler();
    shadows.adopt(root);
    shadows.release();
    expect(moon.shadow.autoUpdate).toBe(true);
    expect(lamp.shadow.autoUpdate).toBe(true);
    expect(shadows.lights).toHaveLength(0);
  });

  describe('moving bodies (#57)', () => {
    /** A GameObject-shaped wrapper round a mesh, as Engine.rigidBodyMap holds. */
    function body(root, { castShadow = true } = {}) {
      const group = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
      mesh.castShadow = castShadow;
      group.add(mesh);
      root.add(group);
      root.updateMatrixWorld(true);
      return { object3d: group };
    }

    it('re-renders every map when a shadow-casting body moves, so its shadow follows it', () => {
      const { root, moon, lamp } = scene();
      const shadows = new ShadowScheduler();
      shadows.adopt(root);
      const drive = body(root);
      const bodies = new Map([[1, drive]]);
      shadows.update(bodies);
      rendered(moon, lamp);

      drive.object3d.position.x += 0.5;
      shadows.update(bodies);
      expect(moon.shadow.needsUpdate).toBe(true);
      expect(lamp.shadow.needsUpdate).toBe(true);
    });

    it('leaves the maps frozen while bodies are at rest', () => {
      const { root, moon, lamp } = scene();
      const shadows = new ShadowScheduler();
      shadows.adopt(root);
      const bodies = new Map([[1, body(root)]]);
      shadows.update(bodies);
      rendered(moon, lamp);
      shadows.update(bodies);
      shadows.update(bodies);
      expect(moon.shadow.needsUpdate).toBe(false);
      expect(lamp.shadow.needsUpdate).toBe(false);
    });

    it('ignores a moving body that casts no shadow (the player)', () => {
      const { root, moon, lamp } = scene();
      const shadows = new ShadowScheduler();
      shadows.adopt(root);
      const player = body(root, { castShadow: false });
      const bodies = new Map([[1, player]]);
      shadows.update(bodies);
      rendered(moon, lamp);
      player.object3d.position.z -= 2;
      shadows.update(bodies);
      expect(moon.shadow.needsUpdate).toBe(false);
    });

    it('picks up a body spawned after the scene was adopted', () => {
      const { root, moon, lamp } = scene();
      const shadows = new ShadowScheduler();
      shadows.adopt(root);
      const bodies = new Map();
      shadows.update(bodies);
      rendered(moon, lamp);
      const box = body(root);
      bodies.set(7, box);
      shadows.update(bodies);          // first sight: remembered, and drawn where it is
      rendered(moon, lamp);
      box.object3d.position.y += 1;
      shadows.update(bodies);
      expect(moon.shadow.needsUpdate).toBe(true);
    });

    it('a sub-threshold jitter does not re-render', () => {
      const { root, moon, lamp } = scene();
      const shadows = new ShadowScheduler();
      shadows.adopt(root);
      const drive = body(root);
      const bodies = new Map([[1, drive]]);
      shadows.update(bodies);
      rendered(moon, lamp);
      drive.object3d.position.x += 0.001;
      shadows.update(bodies);
      expect(moon.shadow.needsUpdate).toBe(false);
    });

    it('forgets bodies on release', () => {
      const { root } = scene();
      const shadows = new ShadowScheduler();
      shadows.adopt(root);
      shadows.update(new Map([[1, body(root)]]));
      shadows.release();
      expect(shadows._bodyPoses.size).toBe(0);
    });

    // A light with a range lights nothing past it, so a body moving out
    // there can't change its map. Carrying a drive across the office must
    // not redraw every corridor's lamp (six passes each), every frame (#87).
    describe('only the lights that reach the body', () => {
      /** The scene above, its lamp given a range of 8 m. */
      function ranged() {
        const s = scene();
        s.lamp.distance = 8;
        return s;
      }
      const at = (b, x, z = 0) => { b.object3d.position.set(x, 0, z); b.object3d.updateMatrixWorld(true); };

      it('leaves a ranged lamp alone while a body moves out of its reach — the moon still redraws', () => {
        const { root, moon, lamp } = ranged();
        const shadows = new ShadowScheduler();
        shadows.adopt(root);
        const drive = body(root);
        at(drive, 20);
        const bodies = new Map([[1, drive]]);
        shadows.update(bodies);
        rendered(moon, lamp);

        at(drive, 21);
        shadows.update(bodies);
        expect(moon.shadow.needsUpdate).toBe(true);
        expect(lamp.shadow.needsUpdate).toBe(false);
      });

      it('redraws it for a body moving within its reach', () => {
        const { root, moon, lamp } = ranged();
        const shadows = new ShadowScheduler();
        shadows.adopt(root);
        const drive = body(root);
        at(drive, 3);
        const bodies = new Map([[1, drive]]);
        shadows.update(bodies);
        rendered(moon, lamp);

        at(drive, 3.5);
        shadows.update(bodies);
        expect(lamp.shadow.needsUpdate).toBe(true);
      });

      it('redraws it for a body that has just left, so the old shadow goes with it', () => {
        const { root, moon, lamp } = ranged();
        const shadows = new ShadowScheduler();
        shadows.adopt(root);
        const drive = body(root);
        at(drive, 6);
        const bodies = new Map([[1, drive]]);
        shadows.update(bodies);
        rendered(moon, lamp);

        at(drive, 30);
        shadows.update(bodies);
        expect(lamp.shadow.needsUpdate).toBe(true);
      });

      it("counts the body's size: one whose edge is within reach redraws it", () => {
        const { root, moon, lamp } = ranged();
        const shadows = new ShadowScheduler();
        shadows.adopt(root);
        const crate = body(root);                        // a 1 m cube: corners 0.87 m out
        at(crate, 8.12);                                 // centre 8.5 m from the lamp
        const bodies = new Map([[1, crate]]);
        shadows.update(bodies);
        rendered(moon, lamp);

        at(crate, 8.12, 0.05);
        shadows.update(bodies);
        expect(lamp.shadow.needsUpdate).toBe(true);
      });

      it('a body first seen out of reach is not drawn into a ranged map', () => {
        const { root, moon, lamp } = ranged();
        const shadows = new ShadowScheduler();
        shadows.adopt(root);
        const bodies = new Map();
        shadows.update(bodies);
        rendered(moon, lamp);

        const box = body(root);
        at(box, 40);
        bodies.set(7, box);
        shadows.update(bodies);
        expect(moon.shadow.needsUpdate).toBe(true);
        expect(lamp.shadow.needsUpdate).toBe(false);
      });
    });
  });
});

describe('ShadowScheduler, cheaper redraws (#175)', () => {
  function body(root) {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    mesh.castShadow = true;
    group.add(mesh);
    root.add(group);
    root.updateMatrixWorld(true);
    return { object3d: group };
  }
  const moved = (shadows, drive, bodies) => {
    drive.object3d.position.x += 0.5;
    shadows.update(bodies);
  };

  it('draws a dark light once when adopted, so its map exists', () => {
    const { root, lamp } = scene();
    lamp.intensity = 0;
    new ShadowScheduler().adopt(root);
    expect(lamp.shadow.needsUpdate).toBe(true);
  });

  it('leaves a dark light alone while a body moves, and redraws it as it comes on', () => {
    const { root, moon, lamp } = scene();
    const shadows = new ShadowScheduler();
    shadows.adopt(root);
    const drive = body(root);
    const bodies = new Map([[1, drive]]);
    shadows.update(bodies);
    rendered(moon, lamp);

    lamp.intensity = 0;
    moved(shadows, drive, bodies);
    expect(moon.shadow.needsUpdate).toBe(true);
    expect(lamp.shadow.needsUpdate).toBe(false);
    rendered(moon);

    shadows.update(bodies);
    expect(lamp.shadow.needsUpdate).toBe(false);   // still dark
    lamp.intensity = 1;
    shadows.update(bodies);
    expect(lamp.shadow.needsUpdate).toBe(true);    // owed, now paid
  });

  it("redraws only the lights that can see a moving body (walls between, nothing in the map changes)", () => {
    const { root, moon, lamp } = scene();
    const shadows = new ShadowScheduler();
    shadows.adopt(root);
    const looks = [];
    shadows.visibility = {
      look: (eye) => looks.push(eye.clone()),
      sees: () => looks.length && looks[looks.length - 1].y > 5,   // the moon's eye is high; the lamp's isn't
    };
    const drive = body(root);
    const bodies = new Map([[1, drive]]);
    shadows.update(bodies);
    rendered(moon, lamp);

    moved(shadows, drive, bodies);
    expect(moon.shadow.needsUpdate).toBe(true);
    expect(lamp.shadow.needsUpdate).toBe(false);
  });

  it('draws the maps due one light at a time, each without the casters that light cannot see', () => {
    const { root, moon, lamp } = scene();
    const shadows = new ShadowScheduler();
    shadows.adopt(root);
    const order = [];
    shadows.visibility = {
      look: (eye) => order.push(`look ${eye.y > 5 ? 'moon' : 'lamp'}`),
      sees: () => true,
      hideUnseenCasters: () => order.push('hide'),
      restore: () => order.push('restore'),
    };
    const draw = () => {
      order.push(`draw ${[moon, lamp].filter(l => l.shadow.needsUpdate).map(l => (l === moon ? 'moon' : 'lamp')).join('+')}`);
      rendered(moon, lamp);
    };
    shadows.renderMaps(draw, [moon, lamp]);
    expect(order).toEqual([
      'look moon', 'hide', 'draw moon', 'restore',
      'look lamp', 'hide', 'draw lamp', 'restore',
    ]);
    expect(moon.shadow.needsUpdate || lamp.shadow.needsUpdate).toBe(false);
  });

  it('without visibility, or with nothing due, draws as three would', () => {
    const { root, moon, lamp } = scene();
    const shadows = new ShadowScheduler();
    shadows.adopt(root);
    let calls = 0;
    shadows.renderMaps(() => { calls++; rendered(moon, lamp); }, [moon, lamp]);
    expect(calls).toBe(1);
  });

  it('release() forgets the visibility', () => {
    const shadows = new ShadowScheduler();
    shadows.visibility = { look() {}, sees: () => true };
    shadows.release();
    expect(shadows.visibility).toBeNull();
  });
});
