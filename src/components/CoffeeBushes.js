import * as THREE from 'three';
import { Interactable } from './Interactable.js';

// ─────────────────────────────────────────────
// CoffeeBushes  –  harvesting the grow rack's ripe coffee beans (#168)
// ─────────────────────────────────────────────
// On the rack's one collider (MainOffice's GrowBeds). The interact ray hits
// the box, and the bush nearest the hit, across the rack's face (its y and
// z; the depth doesn't count), within `REACH`, is the one under the
// crosshair. [E] on a ripe one picks it: a pile of beans (CoffeeItems) in
// the hands, the bush bare. Only the bushes say anything: "[E] Harvest
// coffee beans" on a ripe one, "Coffee beans not ripe" on the rest, nothing
// on a picked one or the rack itself. The prompt is a data field set on
// hover, so InteractionSystem re-shows it as the crosshair moves.
//
// bind(harvest) hands it the night's CoffeeHarvest: every bush is drawn as
// the harvest says (setBush, from populateGrowRack) at once and again on
// every change: a new night's two ripe bushes, one picked.
// ─────────────────────────────────────────────

/** Metres from a bush's middle, across the rack's face, that still aim at it. */
const REACH = 0.4;

/** Metres out from the rack's middle, along its depth, a picked pile
 *  appears: in front of its face, for hands that are full. */
const PILE_OUT = 0.47;

const RIPE = '[E] Harvest coffee beans';
const UNRIPE = 'Coffee beans not ripe';

const _local = new THREE.Vector3();

export class CoffeeBushes extends Interactable {
  promptLabel = '';
  /** @type {import('../gameplay/CoffeeHarvest.js').CoffeeHarvest|null} */
  harvest = null;
  /** Where the picked beans come from, set by the scene.
   *  @type {import('./CoffeeItems.js').CoffeeItems|null} */
  items = null;

  /**
   * @param {{ bushes: THREE.Vector3[], setBush: (i: number, state: string) => void }} opts
   *   Each bush's middle in the rack's own space, and how to draw one.
   */
  constructor({ bushes, setBush }) {
    super();
    this.bushes = bushes;
    this.setBush = setBush;
    this._unbind = null;
  }

  bind(harvest, items = null) {
    this._unbind?.();
    this.harvest = harvest;
    this.items = items;
    const draw = () => harvest.bushes.forEach((state, i) => this.setBush(i, state));
    this._unbind = harvest.onChange(draw);
    draw();
  }

  onHover(hit) {
    const label = this._label(this._aimed(hit));
    if (label !== this.promptLabel) this.promptLabel = label;
  }

  onInteract(hit) {
    const i = this._aimed(hit);
    if (i < 0 || !this.harvest?.harvest(i)) return;
    const b = this.bushes[i];
    const at = this.gameObject.object3d.localToWorld(new THREE.Vector3(PILE_OUT, b.y, b.z));
    this.items?.spawnBeans(at);
  }

  onDestroy() {
    this._unbind?.();
    this._unbind = null;
  }

  /** The bush under the crosshair, or -1. */
  _aimed(hit) {
    if (!hit?.point) return -1;
    this.gameObject?.object3d.worldToLocal(_local.copy(hit.point));
    let best = -1, bestD = REACH;
    for (let i = 0; i < this.bushes.length; i++) {
      const b = this.bushes[i];
      const d = Math.hypot(b.y - _local.y, b.z - _local.z);
      if (d < bestD) { best = i; bestD = d; }
    }
    return best;
  }

  _label(i) {
    const state = i >= 0 ? this.harvest?.bushes[i] : null;
    return state === 'ripe' ? RIPE : state === 'unripe' ? UNRIPE : '';
  }
}
