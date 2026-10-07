import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createWindDust, windDrift, WIND_DUST, WindDustMotion } from './WindDust.js';

// ─────────────────────────────────────────────
// Built by hand, without the Engine. The drifting itself is in the vertex
// shader, where a test can't follow it; what is pinned here is everything
// the CPU does each frame, and the shape of the one draw call.
// ─────────────────────────────────────────────

const box = (x0, x1) => new THREE.Box3(new THREE.Vector3(x0, 0, -2), new THREE.Vector3(x1, 3, 2));

function build({ cutouts = [box(0, 6), box(10, 16)], count } = {}) {
  const camera = new THREE.PerspectiveCamera(75, 16 / 9);
  camera.position.set(4, 1.2, -9);
  camera.updateMatrixWorld();
  const fog = new THREE.FogExp2(0x1f2a38, 0.002);
  const engine = { camera, scene: { fog } };

  const dust = createWindDust({ cutouts, count });
  dust.scene = { userData: { engine } };
  const motion = dust.getComponent(WindDustMotion);
  const mesh = dust.object3d.children.find(o => o.isMesh);
  return { dust, motion, mesh, camera, fog, uniforms: dust.dustUniforms };
}

describe('windDrift', () => {
  const [sx, sz] = WIND_DUST.area;

  it('starts at rest and stays inside one area, however long the night', () => {
    expect(windDrift(0).toArray()).toEqual([0, 0, 0]);
    for (const t of [0.5, 7, 133.7, 3600, 86400]) {
      const d = windDrift(t);
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x).toBeLessThan(sx);
      expect(d.z).toBeGreaterThanOrEqual(0);
      expect(d.z).toBeLessThan(sz);
      expect(d.y).toBe(0);
    }
  });

  it('carries the dust downwind at the wind speed, on average', () => {
    // Over whole gust periods the gusts cancel out.
    const t = WIND_DUST.gustPeriod * 3;
    const travelled = WIND_DUST.speed * t;
    const [dx, dz] = WIND_DUST.direction;
    const d = windDrift(t);
    const wrap = (v, size) => ((v % size) + size) % size;
    expect(d.x).toBeCloseTo(wrap(dx * travelled, sx), 4);
    expect(d.z).toBeCloseTo(wrap(dz * travelled, sz), 4);
  });

  it('blows in one direction along the ground', () => {
    expect(Math.hypot(...WIND_DUST.direction)).toBeCloseTo(1);
  });

  it('gusts and lulls, but never blows backwards', () => {
    expect(WIND_DUST.gust).toBeGreaterThan(0);
    expect(WIND_DUST.gust).toBeLessThan(1);

    // Distance downwind between two instants, unwrapped by keeping the step
    // far smaller than the area.
    const dt = 0.01;
    const [dx] = WIND_DUST.direction;
    let fastest = 0, slowest = Infinity;
    for (let t = 0; t < WIND_DUST.gustPeriod; t += 0.25) {
      let step = windDrift(t + dt).x - windDrift(t).x;
      if (step < -sx / 2) step += sx;
      const speed = step / dx / dt;
      expect(speed).toBeGreaterThan(0);
      fastest = Math.max(fastest, speed);
      slowest = Math.min(slowest, speed);
    }
    expect(fastest).toBeGreaterThan(WIND_DUST.speed * 1.2);
    expect(slowest).toBeLessThan(WIND_DUST.speed * 0.8);
  });

  it('writes into the vector it is given', () => {
    const out = new THREE.Vector3();
    expect(windDrift(3, out)).toBe(out);
  });
});

describe('createWindDust', () => {
  it('is one draw call: a single mesh, however many clouds', () => {
    const { dust, mesh } = build();
    const drawn = [];
    dust.object3d.traverse((o) => { if (o.isMesh || o.isPoints || o.isLine) drawn.push(o); });
    expect(drawn).toEqual([mesh]);
    expect(mesh.isInstancedMesh).toBeFalsy();
  });

  it('is a quad per cloud, with the storm\'s extra clouds built in but not drawn', () => {
    const { mesh } = build();
    expect(WIND_DUST.storm.count).toBeGreaterThan(WIND_DUST.count);
    expect(mesh.geometry.attributes.position.count).toBe(WIND_DUST.storm.count * 4);
    expect(mesh.geometry.index.count).toBe(WIND_DUST.storm.count * 6);
    // Calm: only the first `count` clouds are sent to the GPU at all.
    expect(mesh.geometry.drawRange).toMatchObject({ start: 0, count: WIND_DUST.count * 6 });
  });

  it('marks which clouds belong only to the storm', () => {
    const { mesh } = build();
    const { aStorm } = mesh.geometry.attributes;
    for (let v = 0; v < aStorm.count; v++) {
      expect(aStorm.getX(v)).toBe(v < WIND_DUST.count * 4 ? 0 : 1);
    }
  });

  it('takes a cloud count, for a weaker machine', () => {
    expect(build({ count: 10 }).mesh.geometry.drawRange.count).toBe(60);
  });

  it('gives the four corners of a cloud one seed and one shape', () => {
    const { mesh } = build({ count: 12 });
    const { position, aShape, aCorner } = mesh.geometry.attributes;
    for (let c = 0; c < 12; c++) {
      const corners = [];
      for (let k = 0; k < 4; k++) {
        const v = c * 4 + k;
        for (const attr of [position, aShape]) {
          for (let j = 0; j < attr.itemSize; j++) {
            expect(attr.array[v * attr.itemSize + j]).toBe(attr.array[c * 4 * attr.itemSize + j]);
          }
        }
        corners.push(`${aCorner.getX(v)},${aCorner.getY(v)}`);
      }
      expect(corners.sort()).toEqual(['-1,-1', '-1,1', '1,-1', '1,1']);
    }
  });

  it('seeds every cloud inside the unit area the shader scales up', () => {
    const { mesh } = build();
    for (const v of mesh.geometry.attributes.position.array) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('keeps every cloud low, so the sky stays clear', () => {
    const { mesh } = build();
    const { position, aShape } = mesh.geometry.attributes;
    const [baseMin, baseMax] = WIND_DUST.base;
    let highest = -Infinity;
    for (let v = 0; v < position.count; v += 4) {
      const base = baseMin + (baseMax - baseMin) * position.getY(v);
      const height = aShape.getY(v);
      expect(height).toBeGreaterThanOrEqual(WIND_DUST.height[0]);
      expect(height).toBeLessThanOrEqual(WIND_DUST.height[1]);
      highest = Math.max(highest, base + height);
    }
    expect(highest).toBeLessThanOrEqual(WIND_DUST.base[1] + WIND_DUST.height[1]);
    // A standing player's eye is at 1.24 m: about twice that, at the most.
    expect(WIND_DUST.base[1] + WIND_DUST.height[1]).toBeLessThanOrEqual(2.6);
  });

  it('makes each cloud wider than it is tall', () => {
    const { mesh } = build();
    const { aShape } = mesh.geometry.attributes;
    for (let v = 0; v < aShape.count; v += 4) {
      expect(aShape.getX(v)).toBeGreaterThanOrEqual(WIND_DUST.width[0]);
      expect(aShape.getX(v)).toBeLessThanOrEqual(WIND_DUST.width[1]);
      expect(aShape.getX(v)).toBeGreaterThan(aShape.getY(v));
    }
  });

  it('costs nothing in the lit scene: no shadows, no depth write, no fog or lights', () => {
    const { mesh } = build();
    expect(mesh.castShadow).toBe(false);
    expect(mesh.receiveShadow).toBe(false);
    expect(mesh.material.depthWrite).toBe(false);
    expect(mesh.material.depthTest).toBe(true);    // walls and hills still hide it
    expect(mesh.material.transparent).toBe(true);
    expect(mesh.material.lights).toBe(false);
    // Its own colour at any distance: the storm's fog is matched to it
    // (SANDSTORM.dustColor), not the other way round.
    expect(mesh.material.fog).toBe(false);
  });

  it('calm: a rare few, and faint', () => {
    const { mesh, uniforms } = build();
    expect(WIND_DUST.count).toBeGreaterThanOrEqual(20);
    expect(WIND_DUST.count).toBeLessThanOrEqual(30);
    expect(mesh.geometry.drawRange.count).toBe(WIND_DUST.count * 6);
    expect(WIND_DUST.opacity).toBeGreaterThan(0.15);
    expect(WIND_DUST.opacity).toBeLessThanOrEqual(0.3);
    expect(uniforms.uOpacity.value).toBe(WIND_DUST.opacity);
  });

  it('fades out near the camera, so no cloud ever fills the screen', () => {
    // Overdraw is what a billboard effect costs, and a cloud in your face is
    // most of it. It also keeps you from seeing one turn as you walk through.
    const [from, to] = WIND_DUST.nearFade;
    expect(from).toBeGreaterThanOrEqual(3);
    expect(to).toBeGreaterThan(from);
    expect(build().uniforms.uNearFade.value.toArray()).toEqual([from, to]);
  });

  it('is never frustum-culled or picked: its real positions exist only in the shader', () => {
    const { mesh } = build();
    expect(mesh.frustumCulled).toBe(false);
    const hits = [];
    mesh.raycast(new THREE.Raycaster(), hits);
    expect(hits).toEqual([]);
  });

  it('carries one cutout per part of the building, with a clearance so no cloud pokes inside', () => {
    const cutouts = [box(0, 6), box(10, 16), box(20, 22)];
    const { mesh, uniforms } = build({ cutouts });
    expect(mesh.material.defines.CUTOUTS).toBe(3);
    expect(uniforms.uBoxMin.value).toHaveLength(3);
    expect(uniforms.uBoxMax.value).toHaveLength(3);
    // The shell itself. Two things keep the dust out of it: a cloud whose
    // middle is within uClearance of the footprint is not drawn at all, and
    // any pixel of any cloud that falls inside a shell is thrown away.
    expect(uniforms.uBoxMin.value[2].toArray()).toEqual([20, 0, -2]);
    expect(uniforms.uBoxMax.value[2].toArray()).toEqual([22, 3, 2]);
    expect(uniforms.uClearance.value).toBe(WIND_DUST.clearance);
    // Calm, the clearance alone does it: half the widest cloud at its most
    // spread out (it widens as it sinks), so not even an edge reaches a wall.
    const widest = WIND_DUST.width[1] * (1 + 0.5 * WIND_DUST.swell);
    expect(WIND_DUST.clearance).toBeGreaterThanOrEqual(widest / 2);
  });

  it('fades a cloud out as it drifts up to the building, rather than popping it out at the clearance', () => {
    // Dropped at a hard line, a cloud blowing toward the window vanished
    // whole, mid-drift. It thins over the last `wallFade` metres instead,
    // and is gone by the clearance, as before.
    const { mesh, uniforms } = build();
    expect(WIND_DUST.wallFade).toBeGreaterThanOrEqual(3);
    expect(uniforms.uWallFade.value).toBe(WIND_DUST.wallFade);
    expect(mesh.material.vertexShader).toMatch(/smoothstep\(uClearance, uClearance \+ uWallFade/);
  });

  it('lets a storm come right up to the walls', () => {
    // Its clouds are far wider than their clearance, so they do overlap the
    // building; the per-pixel cutout is what keeps them out of the rooms.
    const { storm } = WIND_DUST;
    expect(storm.clearance).toBeLessThan(WIND_DUST.clearance);
    expect(storm.clearance).toBeGreaterThan(0);
    // …and closer to the camera than the calm clouds come, but never at it.
    expect(storm.nearFade[0]).toBeLessThan(WIND_DUST.nearFade[0]);
    expect(storm.nearFade[0]).toBeGreaterThanOrEqual(3);
    expect(storm.nearFade[1]).toBeGreaterThan(storm.nearFade[0]);
  });

  it('cuts the building out of the clouds pixel by pixel', () => {
    const { mesh } = build();
    expect(mesh.material.fragmentShader).toMatch(/uBoxMin\[i\]/);
    expect(mesh.material.fragmentShader).toMatch(/discard/);
    expect(mesh.material.vertexShader).toMatch(/vWorld\s*=/);
  });

  it('leaves the boxes it was given alone', () => {
    const cutouts = [box(0, 6)];
    build({ cutouts });
    expect(cutouts[0].min.toArray()).toEqual([0, 0, -2]);
    expect(build({ cutouts }).uniforms.uBoxMin.value[0]).not.toBe(cutouts[0].min);
  });

  it('builds with no building to cut out', () => {
    expect(build({ cutouts: [] }).mesh.material.defines.CUTOUTS).toBe(0);
  });

  it('draws its cloud shapes from one small tiling texture', () => {
    const { dust, uniforms } = build();
    const texture = uniforms.uNoise.value;
    expect(texture.isDataTexture).toBe(true);
    expect(texture.image.width).toBeLessThanOrEqual(128);
    expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(texture.wrapT).toBe(THREE.RepeatWrapping);
    // Soft: it uses a good part of the range, not one flat grey.
    const data = Array.from(texture.image.data);
    expect(Math.max(...data) - Math.min(...data)).toBeGreaterThan(120);
    // The scene frees it with the rest.
    expect(dust.dustTexture).toBe(texture);
  });

  it('gives each cloud movement of its own, so they do not slide past in step', () => {
    const { uniforms } = build();
    const { surge, meander, swell, thin } = WIND_DUST;
    expect(uniforms.uOwn.value.toArray()).toEqual([surge, meander, swell, thin]);
    expect(surge).toBeGreaterThan(0);
    expect(meander).toBeGreaterThan(0);
    // A cloud only ever sinks from its full height, and never thins to nothing.
    expect(swell).toBeGreaterThan(0);
    expect(swell).toBeLessThan(1);
    expect(thin).toBeGreaterThan(0);
    expect(thin).toBeLessThan(1);
    // It runs ahead and falls back, but slower than the wind carries it:
    // at its fastest clock, never backwards.
    expect(surge * (0.33 + 0.21)).toBeLessThan(WIND_DUST.speed * (1 - WIND_DUST.gust));
    expect(uniforms.uWind.value.toArray()).toEqual(WIND_DUST.direction);
    expect(uniforms.uRoll.value).toBeGreaterThan(0);
  });

  it('is a group, so the level editor treats it as a container', () => {
    expect(build().dust.isGroup).toBe(true);
  });
});

describe('WindDustMotion', () => {
  it('keeps the clouds around the camera', () => {
    const { motion, uniforms, camera } = build();
    motion.onLateUpdate(1 / 60);
    expect(uniforms.uCenter.value.toArray()).toEqual([4, 1.2, -9]);

    camera.position.set(-20, 3, 40);
    camera.updateMatrixWorld();
    motion.onLateUpdate(1 / 60);
    expect(uniforms.uCenter.value.toArray()).toEqual([-20, 3, 40]);
  });

  it('never moves the object itself: the clouds hold their place in the world', () => {
    const { motion, mesh, camera } = build();
    camera.position.set(-20, 3, 40);
    camera.updateMatrixWorld();
    motion.onLateUpdate(1 / 60);
    expect(mesh.position.toArray()).toEqual([0, 0, 0]);
  });

  it('blows the dust along with the clock', () => {
    const { motion, uniforms } = build();
    for (let i = 0; i < 120; i++) motion.onLateUpdate(1 / 60);
    expect(uniforms.uTime.value).toBeCloseTo(2);
    expect(uniforms.uDrift.value.toArray()).toEqual(windDrift(uniforms.uTime.value).toArray());
    expect(uniforms.uDrift.value.length()).toBeGreaterThan(0);
  });

  it('is rust at night and sunlit dust by day, going by the dawn it is handed', () => {
    const { motion, uniforms } = build();
    motion.daylight = { factor: 0 };
    motion.onLateUpdate(1 / 60);
    expect(uniforms.uColor.value.getHex()).toBe(WIND_DUST.nightColor);

    motion.daylight.factor = 1;
    motion.onLateUpdate(1 / 60);
    expect(uniforms.uColor.value.getHex()).toBe(WIND_DUST.dayColor);

    motion.daylight.factor = 0.5;
    motion.onLateUpdate(1 / 60);
    const half = new THREE.Color(WIND_DUST.nightColor).lerp(new THREE.Color(WIND_DUST.dayColor), 0.5);
    expect(uniforms.uColor.value.getHex()).toBe(half.getHex());
  });

  it('is orange-brown by day, not pale: dust in the sun, standing out of the butterscotch sky', () => {
    // At 0xc9a27a the day clouds came out cream, the colour of the day's sky
    // and fog behind them (0xd9b48a), and read as white wisps.
    const day = new THREE.Color().setHex(WIND_DUST.dayColor);
    const [r, g, b] = [WIND_DUST.dayColor >> 16, (WIND_DUST.dayColor >> 8) & 255, WIND_DUST.dayColor & 255];
    expect(r).toBeGreaterThan(g * 1.5);
    expect(g).toBeGreaterThan(b * 1.5);
    // Lit, all the same: well brighter than the night's rust.
    const night = new THREE.Color().setHex(WIND_DUST.nightColor);
    expect(day.r + day.g + day.b).toBeGreaterThan((night.r + night.g + night.b) * 2);
  });

  it('stays rust through a storm: the fog a sandstorm turns brown is not daylight', () => {
    // It used to read the fog's brightness as the light level. Sandstorm
    // pulls the fog toward dust-brown, brighter than the night's blue, and
    // the clouds paled as if the Sun were coming up.
    const { motion, uniforms, fog } = build();
    motion.daylight = { factor: 0 };
    fog.color.set(0xd9a066);
    motion.onLateUpdate(1 / 60);
    expect(uniforms.uColor.value.getHex()).toBe(WIND_DUST.nightColor);
  });

  it('is its night colour with no dawn to go by', () => {
    const { motion, uniforms } = build();
    motion.onLateUpdate(1 / 60);
    expect(uniforms.uColor.value.getHex()).toBe(WIND_DUST.nightColor);
  });

  it('allocates nothing per frame', () => {
    const { motion, uniforms } = build();
    motion.onLateUpdate(1 / 60);
    const before = [uniforms.uCenter.value, uniforms.uDrift.value, uniforms.uColor.value];
    motion.onLateUpdate(1 / 60);
    expect(uniforms.uCenter.value).toBe(before[0]);
    expect(uniforms.uDrift.value).toBe(before[1]);
    expect(uniforms.uColor.value).toBe(before[2]);
  });

  it('carries on with no engine yet', () => {
    const dust = createWindDust({ cutouts: [] });
    expect(() => dust.getComponent(WindDustMotion).onLateUpdate(1 / 60)).not.toThrow();
  });
});

describe('WindDustMotion storm', () => {
  const run = (motion, seconds) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) motion.onLateUpdate(1 / 60);
  };
  const { storm } = WIND_DUST;

  it('is calm until asked', () => {
    const { motion, uniforms } = build();
    run(motion, 3);
    expect(motion.storm).toBe(0);
    expect(uniforms.uStorm.value).toBe(0);
    expect(uniforms.uOpacity.value).toBe(WIND_DUST.opacity);
    expect(uniforms.uClearance.value).toBe(WIND_DUST.clearance);
  });

  it('builds over storm.ramp seconds rather than switching on', () => {
    const { motion, uniforms } = build();
    motion.setStorm(1);
    run(motion, storm.ramp / 2);
    expect(uniforms.uStorm.value).toBeCloseTo(0.5, 1);
    run(motion, storm.ramp);
    expect(uniforms.uStorm.value).toBe(1);
    expect(motion.storm).toBe(1);
  });

  it('draws the storm\'s extra clouds only while there is a storm', () => {
    const { motion, mesh } = build();
    motion.setStorm(1);
    run(motion, 0.1);
    expect(mesh.geometry.drawRange.count).toBe(storm.count * 6);

    motion.setStorm(0);
    run(motion, storm.ramp + 1);
    expect(mesh.geometry.drawRange.count).toBe(WIND_DUST.count * 6);
  });

  it('makes the clouds bigger, thicker and closer in', () => {
    const { motion, uniforms } = build();
    expect(uniforms.uStormSize.value.toArray()).toEqual(storm.size);
    expect(storm.size[0]).toBeGreaterThan(1);
    expect(storm.size[1]).toBeGreaterThan(1);

    motion.setStorm(1);
    run(motion, storm.ramp + 1);
    expect(uniforms.uOpacity.value).toBeCloseTo(storm.opacity);
    expect(storm.opacity).toBeGreaterThan(WIND_DUST.opacity);
    expect(uniforms.uClearance.value).toBeCloseTo(storm.clearance);
    expect(uniforms.uNearFade.value.x).toBeCloseTo(storm.nearFade[0]);
    expect(uniforms.uNearFade.value.y).toBeCloseTo(storm.nearFade[1]);

    // And back, when it dies down.
    motion.setStorm(0);
    run(motion, storm.ramp + 1);
    expect(uniforms.uNearFade.value.toArray()).toEqual(WIND_DUST.nearFade);
    expect(uniforms.uClearance.value).toBe(WIND_DUST.clearance);
  });

  it('blows harder: the dust clock runs faster', () => {
    const calm = build(), stormy = build();
    stormy.motion.setStorm(1);
    run(stormy.motion, storm.ramp + 1);
    const before = [calm.uniforms.uTime.value, stormy.uniforms.uTime.value];
    run(calm.motion, 2);
    run(stormy.motion, 2);
    expect(calm.uniforms.uTime.value - before[0]).toBeCloseTo(2);
    expect(stormy.uniforms.uTime.value - before[1]).toBeCloseTo(2 * storm.speed);
    expect(storm.speed).toBeGreaterThan(1);
  });

  it('holds part of a storm, and clamps a level out of range', () => {
    const { motion, uniforms } = build();
    motion.setStorm(0.4);
    run(motion, storm.ramp + 1);
    expect(uniforms.uStorm.value).toBeCloseTo(0.4);
    motion.setStorm(7);
    run(motion, storm.ramp + 1);
    expect(uniforms.uStorm.value).toBe(1);
  });

  it('is a wall of dust in a storm: ten times the clouds, and thicker', () => {
    // Fewer, and it read as scattered clouds with clear air between them.
    expect(storm.count).toBeGreaterThanOrEqual(WIND_DUST.count * 10);
    expect(storm.opacity).toBeGreaterThan(WIND_DUST.opacity * 2.5);
    expect(storm.opacity).toBeLessThan(1);
  });

  it('comes right up to the window in a storm', () => {
    // Calm, a cloud keeps well off the walls and fades in over a long way.
    // In a storm that left the nearest dust a good 7 m out from the glass,
    // and faint from the desk. Its clouds stand within a couple of metres of
    // the wall (the per-pixel cutout keeps them out of the rooms)…
    expect(storm.clearance).toBeLessThanOrEqual(1);
    expect(storm.clearance + storm.wallFade).toBeLessThanOrEqual(2.5);
    expect(storm.wallFade).toBeGreaterThan(0);          // still a fade, not a pop
    expect(storm.wallFade).toBeLessThan(WIND_DUST.wallFade);
    // …and are at full strength by the distance the desk is from the dust
    // just outside the window, about 7 m.
    expect(storm.nearFade[1]).toBeLessThanOrEqual(7);

    const { motion, uniforms } = build();
    expect(uniforms.uWallFade.value).toBe(WIND_DUST.wallFade);
    motion.setStorm(1);
    run(motion, storm.ramp + 1);
    expect(uniforms.uWallFade.value).toBeCloseTo(storm.wallFade);
    expect(uniforms.uClearance.value).toBeCloseTo(storm.clearance);
    motion.setStorm(0);
    run(motion, storm.ramp + 1);
    expect(uniforms.uWallFade.value).toBe(WIND_DUST.wallFade);
  });

  it('towers in a storm: tall enough to take most of the view, not just the horizon', () => {
    // At 8.5 m the tallest stood 20 degrees up from 20 m away, and the storm
    // was a band along the ground with clear sky over it. From 12 m up they
    // fill the top of the screen from the same distance.
    const tallest = WIND_DUST.height[1] * storm.size[1];
    const shortest = WIND_DUST.height[0] * storm.size[1];
    expect(tallest).toBeGreaterThanOrEqual(12);
    expect(shortest).toBeGreaterThan(3.2 * 2);     // twice the roof, even the least
    // Calm they stay low: the sky is only lost to a storm.
    expect(WIND_DUST.base[1] + WIND_DUST.height[1]).toBeLessThanOrEqual(2.6);
  });

  it('keeps close behind the level it is handed: Sandstorm has already eased it', () => {
    // Sandstorm builds and dies down over its own ramp, and drops to calm at
    // once on a new night. A long ramp here on top would leave the clouds
    // trailing the fog and the grit by seconds.
    expect(storm.ramp).toBeGreaterThan(0);
    expect(storm.ramp).toBeLessThanOrEqual(1);
  });

  it('has no key of its own: the storm is Sandstorm\'s to start', () => {
    const { motion } = build();
    expect(motion.testKey).toBeUndefined();
    expect(motion.onKeyDown).toBeUndefined();
  });

  it('carries on through a storm with no engine yet', () => {
    const dust = createWindDust({ cutouts: [] });
    expect(() => dust.getComponent(WindDustMotion).onLateUpdate(1 / 60)).not.toThrow();
  });
});

describe('WindDustMotion quality', () => {
  // What a storm costs is overdraw: big see-through clouds, stacked, the
  // nearest covering the most screen. Quality 0 … 1 scales exactly that —
  // how many a storm draws and how near the camera they come — for the
  // settings menu to put a slider on. 1 is the storm as tuned.
  const run = (motion, seconds) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) motion.onLateUpdate(1 / 60);
  };
  const { storm } = WIND_DUST;
  const stormAt = (quality) => {
    const rig = build();
    if (quality !== undefined) rig.motion.setQuality(quality);
    rig.motion.setStorm(1);
    run(rig.motion, storm.ramp + 1);
    return rig;
  };

  it('is full unless asked: the storm as tuned', () => {
    const { motion, mesh, uniforms } = stormAt();
    expect(motion.quality).toBe(1);
    expect(mesh.geometry.drawRange.count).toBe(storm.count * 6);
    expect(uniforms.uNearFade.value.x).toBeCloseTo(storm.nearFade[0]);
    expect(uniforms.uNearFade.value.y).toBeCloseTo(storm.nearFade[1]);
  });

  it('at its lowest a storm draws far fewer clouds, and keeps them further from the camera', () => {
    const { low } = storm;
    expect(low.count).toBeLessThanOrEqual(storm.count / 2);
    expect(low.count).toBeGreaterThan(WIND_DUST.count);       // still a storm
    expect(low.nearFade[0]).toBeGreaterThan(storm.nearFade[0]);
    expect(low.nearFade[1]).toBeGreaterThan(storm.nearFade[1]);

    const { mesh, uniforms } = stormAt(0);
    expect(mesh.geometry.drawRange.count).toBe(low.count * 6);
    expect(uniforms.uNearFade.value.x).toBeCloseTo(low.nearFade[0]);
    expect(uniforms.uNearFade.value.y).toBeCloseTo(low.nearFade[1]);
  });

  it('keeps the storm\'s look at any quality: as big, as thick, as close to the walls', () => {
    const full = stormAt(1).uniforms, lowest = stormAt(0).uniforms;
    expect(lowest.uOpacity.value).toBe(full.uOpacity.value);
    expect(lowest.uClearance.value).toBe(full.uClearance.value);
    expect(lowest.uWallFade.value).toBe(full.uWallFade.value);
    expect(lowest.uStormSize.value.toArray()).toEqual(full.uStormSize.value.toArray());
  });

  it('is a slider: half-way is half-way, and out of range is clamped', () => {
    const { low } = storm;
    const { motion, mesh, uniforms } = stormAt(0.5);
    expect(mesh.geometry.drawRange.count).toBe(Math.round((low.count + storm.count) / 2) * 6);
    expect(uniforms.uNearFade.value.x).toBeCloseTo((low.nearFade[0] + storm.nearFade[0]) / 2);

    motion.setQuality(9);
    expect(motion.quality).toBe(1);
    motion.setQuality(-3);
    expect(motion.quality).toBe(0);
  });

  it('can be changed mid-storm', () => {
    const { motion, mesh } = stormAt(1);
    motion.setQuality(0);
    run(motion, 0.1);
    expect(mesh.geometry.drawRange.count).toBe(storm.low.count * 6);
  });

  it('leaves a calm night alone: there is nothing there to save', () => {
    const { motion, mesh, uniforms } = build();
    motion.setQuality(0);
    run(motion, 1);
    expect(mesh.geometry.drawRange.count).toBe(WIND_DUST.count * 6);
    expect(uniforms.uNearFade.value.toArray()).toEqual(WIND_DUST.nearFade);
  });
});
