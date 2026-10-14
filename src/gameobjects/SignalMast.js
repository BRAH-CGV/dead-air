import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GameObject } from '../core/GameObject.js';
import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// SignalMast  –  a small lattice tower on the bunker's roof, a red lamp on top
// ─────────────────────────────────────────────
// Three steel legs tapering to the top, ringed and cross-braced section by
// section, a couple of whip antennas and a crossarm — the base's own relay
// mast, a small cousin of the CommTowers on the rim. On its tip an
// obstruction lamp flashes red.
//
// The flash is a lamp (unlit sphere) and an additive glow sprite, both
// driven by SignalBlink — no light. A real light would be one more in the
// count every lit shader is compiled for, for a red tint on a roof no one
// stands on. On its own battery like the airlock beacon (`offGrid`), so it
// keeps flashing through a power cut, out there on its own.
//
//   const mast = createSignalMast();
//   mast.object3d.position.set(x, roofTop, z);
//   shell.addChild(mast);
// ─────────────────────────────────────────────

export const SIGNAL_MAST = {
  /** Metres from its feet to the top of the frame. */
  height: 4.6,
  /** Leg spread (radius of the triangle the legs stand on), foot and top. */
  footRadius: 0.36,
  topRadius: 0.12,
  /** Braced sections up the frame. */
  sections: 6,
  legRadius: 0.035,
  braceRadius: 0.014,
  color: 0x5b5752,
  beacon: {
    color: 0xff2a18,
    /** Seconds per flash, and the part of it the lamp is lit: a steady,
     *  unhurried blink, quicker than the rim masts' far-off flashes. */
    period: 1.6,
    duty: 0.3,
    /** Lamp lens, metres; how bright it stays between flashes (a dull red
     *  bulb, not gone); the glow's width. */
    radius: 0.08,
    idle: 0.12,
    glowSize: 2.2,
  },
};

/**
 * @returns {GameObject & {
 *   blink: SignalBlink, glow: THREE.Sprite, lamp: THREE.Mesh,
 *   resources: {dispose():void}[],
 * }}
 */
export function createSignalMast() {
  const M = SIGNAL_MAST, B = M.beacon;
  const go = new GameObject('SignalMast');
  go.object3d.userData.offGrid = true;   // its own battery: flashes through a power cut
  const resources = [];
  const own = r => { resources.push(r); return r; };

  // The frame: legs, rings, braces, antennas, all one mesh.
  const parts = [];
  const legAt = (k, y) => {
    const r = M.footRadius + (M.topRadius - M.footRadius) * (y / M.height);
    const a = (k * Math.PI * 2) / 3;
    return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
  };
  const strut = (from, to, radius) => {
    const length = from.distanceTo(to);
    const g = new THREE.CylinderGeometry(radius, radius, length, 6, 1);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize()));
    const mid = from.clone().add(to).multiplyScalar(0.5);
    g.translate(mid.x, mid.y, mid.z);
    parts.push(g);
  };
  for (let k = 0; k < 3; k++) strut(legAt(k, 0), legAt(k, M.height), M.legRadius);
  for (let s = 1; s <= M.sections; s++) {
    const y0 = (M.height * (s - 1)) / M.sections, y1 = (M.height * s) / M.sections;
    for (let k = 0; k < 3; k++) {
      const n = (k + 1) % 3;
      strut(legAt(k, y1), legAt(n, y1), M.braceRadius);                            // ring
      strut(s % 2 ? legAt(k, y0) : legAt(n, y0), s % 2 ? legAt(n, y1) : legAt(k, y1), M.braceRadius);   // zig-zag
    }
  }
  const top = M.height;
  strut(new THREE.Vector3(0, top - 0.3, 0), new THREE.Vector3(0, top + 0.25, 0), 0.03);         // the lamp's pole
  strut(new THREE.Vector3(-0.5, top - 0.5, 0), new THREE.Vector3(0.5, top - 0.5, 0), 0.02);    // crossarm
  for (const x of [-0.45, 0.45]) {
    strut(new THREE.Vector3(x, top - 0.75, 0), new THREE.Vector3(x, top - 0.25, 0), 0.012);   // dipoles
  }
  strut(legAt(1, top), legAt(1, top).add(new THREE.Vector3(0, 1.4, 0)), 0.008);               // whips
  strut(legAt(2, top), legAt(2, top).add(new THREE.Vector3(0, 0.9, 0)), 0.008);

  const steel = own(new THREE.MeshStandardMaterial({ color: M.color, roughness: 0.6, metalness: 0.55, fog: false }));
  const frame = new THREE.Mesh(own(mergeGeometries(parts)), steel);
  for (const g of parts) g.dispose();
  frame.name = 'SignalMastFrame';
  frame.castShadow = frame.receiveShadow = true;
  go.object3d.add(frame);

  // The lamp, and its glow: unlit, unfogged, so it reads as a light
  // scattered in the haze rather than a bead stuck on a pole.
  const lampMaterial = own(new THREE.MeshBasicMaterial({ color: B.color, fog: false, toneMapped: false }));
  const lamp = new THREE.Mesh(own(new THREE.SphereGeometry(B.radius, 12, 8)), lampMaterial);
  lamp.name = 'SignalMastLamp';
  lamp.position.y = top + 0.25 + B.radius;
  go.object3d.add(lamp);

  const glow = new THREE.Sprite(own(new THREE.SpriteMaterial({
    map: own(glowTexture()), color: B.color,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, toneMapped: false,
  })));
  glow.name = 'SignalMastGlow';
  glow.position.copy(lamp.position);
  glow.scale.setScalar(B.glowSize);
  go.object3d.add(glow);

  go.lamp = lamp;
  go.glow = glow;
  go.resources = resources;
  go.blink = go.addComponent(new SignalBlink(lamp, glow));
  return go;
}

/** The flash: a hump of light over the lit part of each period, and the
 *  lamp dull between. */
export class SignalBlink extends Component {
  constructor(lamp, glow) {
    super();
    this.lamp = lamp;
    this.glow = glow;
    this.time = 0;
    /** 0 dark … 1 at the height of a flash. */
    this.level = 0;
    this._base = new THREE.Color(SIGNAL_MAST.beacon.color);
    this._apply();
  }

  onUpdate(dt) {
    this.time += dt;
    const { period, duty } = SIGNAL_MAST.beacon;
    const t = (this.time / period) % 1;
    this.level = t < duty ? Math.sin((Math.PI * t) / duty) : 0;
    this._apply();
  }

  _apply() {
    const { idle, glowSize } = SIGNAL_MAST.beacon;
    this.lamp.material.color.copy(this._base).multiplyScalar(Math.max(idle, this.level));
    this.glow.material.opacity = this.level;
    this.glow.scale.setScalar(glowSize * (0.75 + 0.35 * this.level));
  }
}

/** A soft round dot, white, fading to nothing at the edge. */
function glowTexture() {
  const S = 64;
  const data = new Uint8Array(S * S * 4);
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const d = Math.hypot(i - (S - 1) / 2, j - (S - 1) / 2) / (S / 2);
      const a = Math.max(0, 1 - d) ** 2.2;
      const p = (j * S + i) * 4;
      data[p] = data[p + 1] = data[p + 2] = 255;
      data[p + 3] = Math.round(a * 255);
    }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
