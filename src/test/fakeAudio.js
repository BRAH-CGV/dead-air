// A stand-in Web Audio context for tests. Node and jsdom have no
// AudioContext, so this records what three's Audio / PositionalAudio /
// AudioListener ask of one. Install it with
//
//   THREE.AudioContext.setContext(new FakeAudioContext())
//
// and the real three.js classes run on top of it.

/** An AudioParam: `value`, plus every automation call it received. */
export class FakeParam {
  constructor(value = 0) {
    this.value = value;
    this.calls = [];
  }
  _record(name, args) {
    this.calls.push([name, ...args]);
    return this;
  }
  setValueAtTime(v, t) {
    this.value = v;
    return this._record('setValueAtTime', [v, t]);
  }
  linearRampToValueAtTime(v, t) {
    this.value = v;
    return this._record('linearRampToValueAtTime', [v, t]);
  }
  setTargetAtTime(v, t, c) {
    this.value = v;
    return this._record('setTargetAtTime', [v, t, c]);
  }
  cancelScheduledValues(t) {
    return this._record('cancelScheduledValues', [t]);
  }
}

export class FakeNode {
  constructor(context) {
    this.context = context;
    this.outputs = new Set();
  }
  connect(node) {
    this.outputs.add(node);
    return node;
  }
  disconnect(node) {
    if (node === undefined) this.outputs.clear();
    else this.outputs.delete(node);
  }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}

export class FakeBufferSource extends FakeNode {
  buffer = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  onended = null;
  playbackRate = new FakeParam(1);
  detune = new FakeParam(0);
  started = null;       // [when, offset, duration]
  stopped = null;       // when

  start(when = 0, offset = 0, duration) { this.started = [when, offset, duration]; }
  stop(when = 0) { this.stopped = when; }

  /** Let a one-shot run out, as the browser would. */
  end() { this.onended?.(); }
}

export class FakePanner extends FakeNode {
  panningModel = 'equalpower';
  distanceModel = 'inverse';
  refDistance = 1;
  maxDistance = 10000;
  rolloffFactor = 1;
  coneInnerAngle = 360;
  coneOuterAngle = 360;
  coneOuterGain = 0;
  positionX = new FakeParam();
  positionY = new FakeParam();
  positionZ = new FakeParam();
  orientationX = new FakeParam(1);
  orientationY = new FakeParam();
  orientationZ = new FakeParam();
}

export class FakeAudioContext {
  state = 'suspended';
  currentTime = 0;
  destination = new FakeNode(this);
  /** Every buffer source ever made, oldest first. */
  sources = [];
  resumes = 0;
  suspends = 0;
  listener = {
    positionX: new FakeParam(), positionY: new FakeParam(), positionZ: new FakeParam(),
    forwardX: new FakeParam(), forwardY: new FakeParam(), forwardZ: new FakeParam(-1),
    upX: new FakeParam(), upY: new FakeParam(1), upZ: new FakeParam(),
  };

  createGain() { return new FakeGain(this); }
  createPanner() { return new FakePanner(this); }
  createBufferSource() {
    const source = new FakeBufferSource(this);
    this.sources.push(source);
    return source;
  }

  resume() {
    this.resumes++;
    this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    this.suspends++;
    this.state = 'suspended';
    return Promise.resolve();
  }

  /** Sources started and not (yet) stopped. */
  get playing() {
    return this.sources.filter(s => s.started && s.stopped === null);
  }
}

/** A decoded buffer, as far as three's Audio looks at one. */
export function fakeBuffer(duration = 1) {
  return { duration, numberOfChannels: 1, sampleRate: 22050 };
}

/** An AssetManager holding `keys` as fake buffers. */
export function fakeAssets(keys) {
  const cache = new Map(keys.map(k => [k, fakeBuffer()]));
  return { has: k => cache.has(k), get: k => cache.get(k) };
}

/** A document stand-in: pointer lock and visibility, with real events. */
export function fakeDocument() {
  const doc = new EventTarget();
  doc.pointerLockElement = null;
  doc.hidden = false;
  doc.lock = () => {
    doc.pointerLockElement = {};
    doc.dispatchEvent(new Event('pointerlockchange'));
  };
  doc.unlock = () => {
    doc.pointerLockElement = null;
    doc.dispatchEvent(new Event('pointerlockchange'));
  };
  doc.setHidden = (hidden) => {
    doc.hidden = hidden;
    doc.dispatchEvent(new Event('visibilitychange'));
  };
  return doc;
}
