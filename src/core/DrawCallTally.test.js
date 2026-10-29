import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { tallyDrawCalls, formatTally } from './DrawCallTally.js';

// A renderer as far as the tally cares: three calls renderBufferDirect once
// per draw, with the scene in the main pass and null in a shadow pass.
function fakeRenderer() {
  const renderer = {
    target: null,
    drawn: 0,
    getRenderTarget() { return this.target; },
    renderBufferDirect() { this.drawn++; },
  };
  return renderer;
}

function world() {
  const scene = new THREE.Scene();
  const room = new THREE.Group(); room.name = 'MainOffice';
  const desk = new THREE.Group(); desk.name = 'ComputerDesk';
  const mesh = new THREE.Mesh(); mesh.name = 'Body';
  const outside = new THREE.Group(); outside.name = 'Outside';
  const grass = new THREE.Mesh(); grass.name = 'MarsGrass:always#3/1';
  scene.add(room, outside); room.add(desk); desk.add(mesh); outside.add(grass);
  return { scene, mesh, grass };
}

describe('tallyDrawCalls', () => {
  it('counts each draw by pass and by what drew it, a few levels down from the scene', () => {
    const renderer = fakeRenderer();
    const { scene, mesh, grass } = world();
    const tally = tallyDrawCalls(renderer, () => {
      renderer.renderBufferDirect(null, scene, null, null, mesh, null);
      renderer.renderBufferDirect(null, scene, null, null, mesh, null);
      renderer.renderBufferDirect(null, null, null, null, mesh, null);       // a shadow map
      renderer.target = {};
      renderer.renderBufferDirect(null, scene, null, null, grass, null);     // a screen pass
      renderer.target = null;
    });
    expect(tally.passes).toEqual({ main: 2, shadow: 1, screen: 1 });
    expect(tally.by.get('main\tMainOffice/ComputerDesk/Body')).toBe(2);
    expect(tally.by.get('shadow\tMainOffice/ComputerDesk/Body')).toBe(1);
    expect(tally.by.get('screen\tOutside/MarsGrass')).toBe(1);
  });

  it('still draws, and puts the renderer back after, even if the frame throws', () => {
    const renderer = fakeRenderer();
    const original = renderer.renderBufferDirect;
    const { scene, mesh } = world();
    expect(() => tallyDrawCalls(renderer, () => {
      renderer.renderBufferDirect(null, scene, null, null, mesh, null);
      throw new Error('boom');
    })).toThrow('boom');
    expect(renderer.drawn).toBe(1);
    expect(renderer.renderBufferDirect).toBe(original);
  });

  it('groups chunks of one mesh under their mesh, so wedges add up in one line', () => {
    const renderer = fakeRenderer();
    const scene = new THREE.Scene();
    const outside = new THREE.Group(); outside.name = 'Outside';
    scene.add(outside);
    const tally = tallyDrawCalls(renderer, () => {
      for (const name of ['MarsGrass:always#0/0', 'MarsGrass:always#1/0', 'MarsGrass:interior#1/1']) {
        const m = new THREE.Mesh(); m.name = name; outside.add(m);
        renderer.renderBufferDirect(null, scene, null, null, m, null);
      }
    });
    expect(tally.by.get('main\tOutside/MarsGrass')).toBe(3);
  });
});

describe('formatTally', () => {
  it('totals each pass, then the heaviest lines first', () => {
    const by = new Map([['main\tA', 3], ['shadow\tB', 7], ['main\tC', 1]]);
    const lines = formatTally({ passes: { main: 4, shadow: 7, screen: 0 }, by }, 2);
    expect(lines[0]).toBe('11 draw calls: main 4, shadow maps 7, screen passes 0');
    expect(lines.slice(1)).toEqual(['  7  shadow  B', '  3  main    A', '  … 1 more lines']);
  });
});
