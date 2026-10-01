import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  windowHalfSpaces, sphereSeenThroughWindows, boxSeenThroughWindows,
  partitionInstances, collectHideable, hiddenFromRegion, splitInstances,
} from './Sightlines.js';

// ─────────────────────────────────────────────
// Sightlines  –  what can be seen from indoors, and splitting the rest off
// ─────────────────────────────────────────────

/** The office as Room describes it: 12 × 10 at the origin, 0.2 m walls, the
 *  big window in the back (−Z) wall, a doorway (sill 0) in the front. */
const OFFICE = {
  position: [0, 0, 0], width: 12, depth: 10, wallThick: 0.2,
  openings: [
    { side: 'back',  width: 8.5, height: 2.35, sill: 0.475 },
    { side: 'front', width: 1,   height: 2.2 },
  ],
};

describe('windowHalfSpaces', () => {
  it('turns each window into the half-space beyond its wall, measured from the inner face', () => {
    expect(windowHalfSpaces([OFFICE])).toEqual([{ axis: 'z', sign: -1, limit: -4.9 }]);
  });

  it('ignores doorways — only openings with a sill are windows', () => {
    const sealed = { ...OFFICE, openings: [{ side: 'front', width: 1, height: 2.2 }] };
    expect(windowHalfSpaces([sealed])).toEqual([]);
  });

  it('follows the room wherever it stands and whichever wall the window is in', () => {
    const east = {
      position: [20, 0, 1], width: 6, depth: 8, wallThick: 0.2,
      openings: [{ side: 'right', width: 2, height: 1, sill: 1 }],
    };
    expect(windowHalfSpaces([east])).toEqual([{ axis: 'x', sign: 1, limit: 22.9 }]);
  });
});

describe('seen through windows', () => {
  const spaces = windowHalfSpaces([OFFICE]);

  it('a sphere out past the back wall can be seen; one in front of the building cannot', () => {
    expect(sphereSeenThroughWindows(new THREE.Sphere(new THREE.Vector3(0, 0, -25), 1), spaces)).toBe(true);
    expect(sphereSeenThroughWindows(new THREE.Sphere(new THREE.Vector3(7, 0, 9), 1), spaces)).toBe(false);
  });

  it('a sphere straddling the wall plane counts as seen — a tree canopy leaning into view', () => {
    expect(sphereSeenThroughWindows(new THREE.Sphere(new THREE.Vector3(0, 0, -3), 2.5), spaces)).toBe(true);
  });

  it('boxes are judged the same way', () => {
    const front = new THREE.Box3(new THREE.Vector3(5, 0, 7), new THREE.Vector3(9, 2, 11));
    const back  = new THREE.Box3(new THREE.Vector3(-1, 0, -30), new THREE.Vector3(1, 8, -20));
    expect(boxSeenThroughWindows(front, spaces)).toBe(false);
    expect(boxSeenThroughWindows(back, spaces)).toBe(true);
  });

  it('with no windows, nothing outdoors is seen from inside', () => {
    expect(sphereSeenThroughWindows(new THREE.Sphere(new THREE.Vector3(0, 0, -25), 1), [])).toBe(false);
  });
});

describe('partitionInstances', () => {
  /** Unit boxes at the given z positions, in a group shifted by `offset`. */
  function field(zs, { colors = false, offset = 0 } = {}) {
    const group = new THREE.Group();
    group.position.z = offset;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), zs.length);
    mesh.name = 'Rocks';
    mesh.castShadow = true;
    zs.forEach((z, i) => {
      mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(0, 0, z));
      if (colors) mesh.setColorAt(i, new THREE.Color(i / zs.length, 0, 0));
    });
    group.add(mesh);
    group.updateMatrixWorld(true);
    return { group, mesh };
  }
  const behind = sphere => sphere.center.z < 0;

  it('splits one InstancedMesh into the instances that pass and the ones that do not', () => {
    const { group, mesh } = field([-10, 5, -20, 8, 12]);
    const { kept, moved } = partitionInstances(mesh, behind);

    expect(kept.count).toBe(2);
    expect(moved.count).toBe(3);
    expect(group.children).toEqual([kept, moved]);       // replaces the original in place
    expect(mesh.parent).toBeNull();
  });

  it('shares geometry and material — two draw calls, no second upload', () => {
    const { mesh } = field([-10, 5]);
    const { geometry, material } = mesh;
    const { kept, moved } = partitionInstances(mesh, behind);
    expect(kept.geometry).toBe(geometry);
    expect(moved.geometry).toBe(geometry);
    expect(kept.material).toBe(material);
    expect(moved.material).toBe(material);
  });

  it('keeps every instance where it was, colour included', () => {
    const { mesh } = field([-10, 5, -20], { colors: true });
    const before = [0, 1, 2].map(i => {
      const m = new THREE.Matrix4(); mesh.getMatrixAt(i, m);
      const c = new THREE.Color(); mesh.getColorAt(i, c);
      return { z: new THREE.Vector3().setFromMatrixPosition(m).z, r: c.r };
    });
    const { kept, moved } = partitionInstances(mesh, behind);

    const after = [];
    for (const part of [kept, moved]) {
      for (let i = 0; i < part.count; i++) {
        const m = new THREE.Matrix4(); part.getMatrixAt(i, m);
        const c = new THREE.Color(); part.getColorAt(i, c);
        after.push({ z: new THREE.Vector3().setFromMatrixPosition(m).z, r: c.r });
      }
    }
    expect(after.sort((a, b) => a.z - b.z)).toEqual(before.sort((a, b) => a.z - b.z));
  });

  it('carries the name and shadow flags over to both halves', () => {
    const { mesh } = field([-10, 5]);
    const { kept, moved } = partitionInstances(mesh, behind);
    expect(kept.castShadow).toBe(true);
    expect(moved.castShadow).toBe(true);
    expect(moved.name).toBe('Rocks:moved');
  });

  it('judges instances in world space, parents included', () => {
    const { mesh } = field([-10, -5], { offset: 8 });     // world z = -2 and 3
    const { kept, moved } = partitionInstances(mesh, behind);
    expect(kept.count).toBe(1);
    expect(moved.count).toBe(1);
  });

  it('leaves a mesh alone when every instance lands on one side', () => {
    const { group, mesh } = field([-10, -20]);
    const { kept, moved } = partitionInstances(mesh, behind);
    expect(kept).toBe(mesh);
    expect(moved).toBeNull();
    expect(group.children).toEqual([mesh]);
  });

  it('hands back only the moved half when nothing passes', () => {
    const { mesh } = field([10, 20]);
    const { kept, moved } = partitionInstances(mesh, behind);
    expect(kept).toBeNull();
    expect(moved).toBe(mesh);
  });
});

describe('collectHideable', () => {
  it('collects whole children, skipping the ones the caller keeps', () => {
    const root = new THREE.Group();
    const wall = new THREE.Mesh(); wall.name = 'BackWall';
    const desk = new THREE.Group(); desk.name = 'Desk';
    root.add(wall, desk);
    expect(collectHideable(root, o => o.name === 'BackWall')).toEqual([desk]);
  });

  it('never hides a light — that would recompile every lit shader — but still takes its siblings', () => {
    const root = new THREE.Group();
    const lampGroup = new THREE.Group();
    const light = new THREE.PointLight();
    const fixture = new THREE.Mesh();
    lampGroup.add(light, fixture);
    root.add(lampGroup);

    const hidden = collectHideable(root, () => false);
    expect(hidden).toEqual([fixture]);
    expect(hidden).not.toContain(lampGroup);
    expect(hidden).not.toContain(light);
  });

  it('digs as deep as the lights go', () => {
    const root = new THREE.Group();
    const a = new THREE.Group();
    const b = new THREE.Group();
    const spot = new THREE.SpotLight();
    const lens = new THREE.Mesh();
    const shade = new THREE.Mesh();
    b.add(spot, lens);
    a.add(b, shade);
    root.add(a);
    expect(collectHideable(root, () => false)).toEqual([lens, shade]);
  });
});

describe('hiddenFromRegion — the building as an occluder, seen from the yard', () => {
  // A slab where every part of the base overlaps: 30 m wide, 3 m tall,
  // 2 m deep. The yard (eye region) is in front of it, the window side behind.
  const occluder = new THREE.Box3(new THREE.Vector3(-15, 0, 2), new THREE.Vector3(15, 3, 4));
  const eyes = new THREE.Box3(new THREE.Vector3(-15, 0.3, 4.5), new THREE.Vector3(15, 2.6, 17));
  const sphereAt = (x, y, z, r = 0.3) => new THREE.Sphere(new THREE.Vector3(x, y, z), r);

  it('grass right behind the building is hidden from everywhere in the yard', () => {
    expect(hiddenFromRegion(sphereAt(0, 0.3, -2), eyes, occluder)).toBe(true);
  });

  it('something taller than the roof line still shows over it', () => {
    expect(hiddenFromRegion(sphereAt(0, 8, -25, 1), eyes, occluder)).toBe(false);   // the dish
  });

  it('far enough back, even a low thing rises above the roof line from the back of the yard', () => {
    // Seen from z = 17 at 2.6 m, the roof edge at z = 2 hides only what sits
    // below the line through it — which climbs with distance behind.
    // From z = 17 at 2.6 m, the line over the roof edge is ~4.7 m up by z = -60.
    expect(hiddenFromRegion(sphereAt(0, 3, -60, 0.5), eyes, occluder)).toBe(true);
    expect(hiddenFromRegion(sphereAt(0, 6, -60, 0.5), eyes, occluder)).toBe(false);
  });

  it('past the end of the building nothing hides it', () => {
    expect(hiddenFromRegion(sphereAt(25, 0.3, -2), eyes, occluder)).toBe(false);
  });

  it('anything on the yard side of the occluder is never hidden by it', () => {
    expect(hiddenFromRegion(sphereAt(0, 0.3, 10), eyes, occluder)).toBe(false);
  });

  it('a box is judged by its corners the same way', () => {
    const low = new THREE.Box3(new THREE.Vector3(-1, 0, -3), new THREE.Vector3(1, 0.5, -1));
    const tall = new THREE.Box3(new THREE.Vector3(-1, 0, -3), new THREE.Vector3(1, 12, -1));
    expect(hiddenFromRegion(low, eyes, occluder)).toBe(true);
    expect(hiddenFromRegion(tall, eyes, occluder)).toBe(false);
  });
});

describe('splitInstances', () => {
  function field(zs) {
    const group = new THREE.Group();
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), zs.length);
    mesh.name = 'Grass';
    zs.forEach((z, i) => mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(0, 0, z)));
    group.add(mesh);
    group.updateMatrixWorld(true);
    return { group, mesh };
  }
  const bucket = s => (s.center.z < -10 ? 'far' : s.center.z < 0 ? 'near' : 'front');

  it('splits into one mesh per bucket, named for it, in place of the original', () => {
    const { group, mesh } = field([-20, -5, 3, -15, 7]);
    const parts = splitInstances(mesh, bucket);
    expect([...parts.keys()].sort()).toEqual(['far', 'front', 'near']);
    expect(parts.get('far').count).toBe(2);
    expect(parts.get('near').count).toBe(1);
    expect(parts.get('front').count).toBe(2);
    expect(parts.get('near').name).toBe('Grass:near');
    expect(group.children).toEqual([...parts.values()]);
    expect(mesh.parent).toBeNull();
  });

  it('a mesh that lands in one bucket is handed back untouched', () => {
    const { group, mesh } = field([-20, -30]);
    const parts = splitInstances(mesh, bucket);
    expect([...parts.entries()]).toEqual([['far', mesh]]);
    expect(group.children).toEqual([mesh]);
  });
});

describe('hiddenFromRegion with several occluders', () => {
  // A shallow middle block between two deep end blocks, flush where they meet
  // — the office, corridors and side rooms seen from above, simplified.
  const middle = new THREE.Box3(new THREE.Vector3(-10, 0, 2), new THREE.Vector3(10, 3, 4));
  const left   = new THREE.Box3(new THREE.Vector3(-16, 0, -4), new THREE.Vector3(-10, 3, 4));
  const right  = new THREE.Box3(new THREE.Vector3(10, 0, -4), new THREE.Vector3(16, 3, 4));
  const eyes = new THREE.Box3(new THREE.Vector3(-16, 0.5, 4.5), new THREE.Vector3(16, 2.4, 17));
  const grass = new THREE.Sphere(new THREE.Vector3(12, 0.3, -6), 0.3);

  it('blocked by whichever box each sightline meets — the union does what no one box can', () => {
    expect(hiddenFromRegion(grass, eyes, middle)).toBe(false);   // slips past the shallow block's end
    expect(hiddenFromRegion(grass, eyes, [middle, left, right])).toBe(true);
  });

  it('still sees past the end of the whole building', () => {
    expect(hiddenFromRegion(new THREE.Sphere(new THREE.Vector3(22, 0.3, -6), 0.3), eyes, [middle, left, right])).toBe(false);
  });
});

describe('splitInstances classify gets the instance index too', () => {
  it('so a caller can label instances in a first pass and split on those labels', () => {
    const group = new THREE.Group();
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 4);
    for (let i = 0; i < 4; i++) mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i, 0, 0));
    group.add(mesh);
    const labels = ['a', 'b', 'a', 'b'];
    const parts = splitInstances(mesh, (_sphere, i) => labels[i]);
    expect(parts.get('a').count).toBe(2);
    expect(parts.get('b').count).toBe(2);
  });
});
