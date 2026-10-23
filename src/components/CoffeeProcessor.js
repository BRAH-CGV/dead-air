import * as THREE from 'three';
import { Interactable } from './Interactable.js';
import { NEAR_PROCESSOR, BAG_SPOTS, LID_OPEN } from '../gameobjects/BeanProcessor.js';

// ─────────────────────────────────────────────
// CoffeeProcessor  –  the bean processor at work (#168)
// ─────────────────────────────────────────────
// On the processor's collider (MainOffice's BeanProcessor), over the parts
// buildBeanProcessor left apart. A pile of beans let go anywhere near it
// (NEAR_PROCESSOR: by the hopper, on it, on the floor in front) is taken
// in and the hopper's lid swings shut; [E] then grinds what it holds ("[E]
// Process the beans"). The lid stays shut while it grinds, and nothing more
// goes in until it is done and the lid opens again. It ticks the night's
// CoffeeHarvest (on game time, so a nap grinds faster too), and for each
// pile ground puts a bag of ground coffee in its bay (CoffeeItems.spawnBag,
// at BAG_SPOTS), to be picked up like a drive. It shows what it is doing:
//
//   • the hopper's lid, shut from the beans going in to the grinding's end;
//   • the burrs' paddles turn behind the porthole, and the porthole burns
//     brighter, while it grinds;
//   • one lamp lit for the state: red idle, amber loaded or grinding,
//     green with a bag to take. The others are dimmed, never black, so the PowerGrid
//     (which collects glows by their emissive) keeps them.
//
// None of the moving parts casts a shadow, so the frozen maps never need
// redrawing. The prompt is a data field, rewritten only when it changes.
// ─────────────────────────────────────────────

export const PROCESSOR_USE = Object.freeze({
  /** Radians a second the burrs turn while grinding. */
  spin: 9,
  /** A lamp's share of its colour while it is off. */
  lampOff: 0.08,
  /** The porthole's share of its colour while idle. */
  windowIdle: 0.35,
  /** Radians a second the hopper's lid swings. */
  lidSpeed: 4,
});

const IDLE = 'Bean processor';
const DROP = '[E] Drop the beans in';
const START = '[E] Process the beans';

const _near = new THREE.Box3(new THREE.Vector3(...NEAR_PROCESSOR.min), new THREE.Vector3(...NEAR_PROCESSOR.max));
const _p = new THREE.Vector3();

export class CoffeeProcessor extends Interactable {
  promptLabel = IDLE;
  /** @type {import('../gameplay/CoffeeHarvest.js').CoffeeHarvest|null} */
  harvest = null;
  /** @type {import('./CoffeeItems.js').CoffeeItems|null} */
  items = null;

  /** @param {{ parts: ReturnType<typeof import('../gameobjects/BeanProcessor.js').buildBeanProcessor> }} opts */
  constructor({ parts }) {
    super();
    this.parts = parts;
    this._lampColours = parts.lamps.map(l => l.material.emissive.clone());
    this._windowColour = parts.window?.material.emissive.clone() ?? null;
    this._shown = null;
    this._offBatch = null;
    this._show('idle', 0, false);
  }

  bind(harvest, items = null) {
    this._offBatch?.();
    this.harvest = harvest;
    this.items = items;
    this._offBatch = harvest.onBatch(() => this._bag());
    this._refresh();
  }

  onUpdate(dt) {
    const h = this.harvest;
    if (!h) return;
    h.update(dt);
    this._catch();
    if (h.processor === 'processing' && this.parts.paddles) {
      this.parts.paddles.rotation.x = (this.parts.paddles.rotation.x + dt * PROCESSOR_USE.spin) % (Math.PI * 2);
    }
    this._swingLid(dt);
    this._refresh();
  }

  /** [E]: grind what is in the hopper. Not with beans in hand: that press
   *  drops them, to be taken in, before anything starts. */
  onInteract() {
    const h = this.harvest;
    if (!h || this.items?.held('beans')) return;
    if (h.start()) this.engine?.consumeAction?.('interact');
    this._refresh();
  }

  get engine() {
    return this.gameObject?.scene?.userData?.engine ?? null;
  }

  onDestroy() {
    this._offBatch?.();
    this._offBatch = null;
  }

  /** Any pile let go near it goes in, unless it is grinding. */
  _catch() {
    const object = this.gameObject?.object3d;
    if (!this.items || !object || this.harvest.processor === 'processing') return;
    for (const pile of this.items.loose('beans')) {
      const t = pile.rigidBody?.translation?.();
      if (t) _p.set(t.x, t.y, t.z);
      else pile.object3d.getWorldPosition(_p);
      if (!_near.containsPoint(object.worldToLocal(_p))) continue;
      this.items.take(pile, { press: false });
      this.harvest.load();
    }
  }

  /** Shut while it holds beans or grinds; open otherwise. */
  _swingLid(dt) {
    const lid = this.parts.lid;
    if (!lid) return;
    const target = this.harvest.processor === 'idle' ? LID_OPEN : 0;
    const step = PROCESSOR_USE.lidSpeed * dt;
    lid.rotation.x += THREE.MathUtils.clamp(target - lid.rotation.x, -step, step);
  }

  /** A batch ground: a bag in the bay, in the first spot free. */
  _bag() {
    const object = this.gameObject?.object3d;
    if (!this.items || !object) return;
    const [x, y, z] = BAG_SPOTS[this.items.waiting % BAG_SPOTS.length];
    object.updateMatrixWorld(true);
    this.items.spawnBag(object.localToWorld(new THREE.Vector3(x, y + 0.005, z)));
  }

  _refresh() {
    const h = this.harvest;
    if (!h) return;
    const label = h.processor === 'processing' ? `Processing… (${Math.ceil(h.processLeft)} s)`
      : this.items?.held('beans') ? DROP
      : h.processor === 'loaded' ? START
      : IDLE;
    if (label !== this.promptLabel) this.promptLabel = label;
    const state = h.processor !== 'idle' ? h.processor : this.items?.waiting > 0 ? 'ready' : 'idle';
    this._show(state, h.processor !== 'idle');
  }

  /** The parts, for `state`; rewritten only when something changed. */
  _show(state, loaded) {
    const key = `${state}:${loaded}`;
    if (key === this._shown) return;
    this._shown = key;
    const { lamps, load, window } = this.parts;
    const lit = state === 'ready' ? 0 : state === 'idle' ? 2 : 1;   // go, wait, stop
    lamps.forEach((lamp, i) => {
      lamp.material.emissive.copy(this._lampColours[i]).multiplyScalar(i === lit ? 1 : PROCESSOR_USE.lampOff);
    });
    if (load) load.visible = loaded;
    if (window && this._windowColour) {
      window.material.emissive.copy(this._windowColour).multiplyScalar(state === 'processing' ? 1 : PROCESSOR_USE.windowIdle);
    }
  }
}
