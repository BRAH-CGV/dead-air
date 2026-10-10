import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { Pickupable } from './Pickupable.js';

const DEFAULT_SNAP_DISTANCE = 0.25;
const DEFAULT_INSERT_BEEP_FREQ = 880;
const DEFAULT_EJECT_BEEP_FREQ = 440;
const DEFAULT_BEEP_DURATION = 0.1;

const _receiverWorldPos = new THREE.Vector3();
const _candidateWorldPos = new THREE.Vector3();
const _slotWorldPos = new THREE.Vector3();
const _slotWorldQuat = new THREE.Quaternion();
const _parentQuat = new THREE.Quaternion();
const _slotLocalPos = new THREE.Vector3();
const _slotLocalQuat = new THREE.Quaternion();

function normaliseSlot(slot = {}) {
  const offset = slot.offset ?? slot;
  const rotation = slot.rotation ?? null;
  return {
    offset: new THREE.Vector3(offset.x ?? 0, offset.y ?? 0, offset.z ?? 0),
    rotation: rotation instanceof THREE.Quaternion
      ? rotation.clone()
      : new THREE.Quaternion().setFromEuler(new THREE.Euler(
          rotation?.x ?? 0,
          rotation?.y ?? 0,
          rotation?.z ?? 0,
        )),
  };
}

/**
 * Generic proximity snap/attachment receiver.
 *
 * Attach to any GameObject that owns one or more local sockets. Registered
 * pickupable candidates that are unheld and near an empty socket are converted
 * to kinematic bodies and kept at the socket transform until picked up again.
 */
export class SnapSocket extends Component {
  snapDistance = DEFAULT_SNAP_DISTANCE;
  candidates = [];
  slots = [normaliseSlot({ offset: { y: 0.025 } })];
  attachments = [];
  enabled = true;
  attachedPromptLabel = '[E] Take item';
  canAccept = () => true;
  onBeforeAttach = null;
  onAttached = null;
  onDetached = null;
  playSounds = true;

  /** Items temporarily blocked from re-snapping after a forceful ejection.
   *  Maps item → timestamp of rejection. @type {Map<object,number>} */
  _rejected = new Map();

  constructor(opts = {}) {
    super();
    if (opts.snapDistance !== undefined) this.snapDistance = opts.snapDistance;
    if (opts.slots) this.slots = opts.slots.map(normaliseSlot);
    else if (opts.snapOffset) this.slots = [normaliseSlot({ offset: opts.snapOffset })];
    if (opts.attachedPromptLabel !== undefined) this.attachedPromptLabel = opts.attachedPromptLabel;
    if (opts.canAccept) this.canAccept = opts.canAccept;
    if (opts.onBeforeAttach) this.onBeforeAttach = opts.onBeforeAttach;
    if (opts.onAttached) this.onAttached = opts.onAttached;
    if (opts.onDetached) this.onDetached = opts.onDetached;
    if (opts.playSounds !== undefined) this.playSounds = opts.playSounds;
    this.attachments = new Array(this.slots.length).fill(null);
  }

  addCandidate(candidate) {
    if (candidate && !this.candidates.includes(candidate)) {
      this.candidates.push(candidate);
    }
  }

  /** Temporarily block a candidate from re-snapping (e.g. after a forceful
   *  ejection). The rejection expires after `seconds` (default 2), so the
   *  item can be re-accepted once it has flown away. */
  reject(item, seconds = 2) {
    if (!item) return;
    this._rejected.set(item, performance.now() + seconds * 1000);
  }

  get attachedItems() {
    return this.attachments.map(a => a?.item ?? null);
  }

  get firstAttached() {
    return this.attachments.find(Boolean)?.item ?? null;
  }

  hasAttached() {
    return this.attachments.some(Boolean);
  }

  onUpdate(_dt) {
    if (!this.enabled || !this.gameObject) return;

    this._updateAttachedTransforms();
    this._detachHeldItems();

    // One attach per frame, but any empty slot may take it — on a grid of
    // sockets a drive released at the far end must not wait for the first.
    for (let i = 0; i < this.slots.length; i++) {
      if (this.attachments[i]) continue;
      const match = this._findCandidateForSlot(i);
      if (match) {
        this.attach(match, i);
        break;
      }
    }
  }

  attach(item, slotIndex = this._firstEmptySlot()) {
    if (!item || slotIndex < 0 || this.attachments[slotIndex]) return false;
    if (!this.canAccept(item, slotIndex)) return false;
    if (item._snapOwner && item._snapOwner !== this) return false;

    const pickupable = item.getComponent?.(Pickupable);
    if (pickupable?.held) return false;

    if (this.onBeforeAttach?.(item, slotIndex) === false) return false;

    const previousPromptLabel = pickupable?.promptLabel;
    item.makeKinematic?.();
    item._snapOwner = this;
    item._snapSlotIndex = slotIndex;

    const attachment = { item, previousPromptLabel };
    this.attachments[slotIndex] = attachment;

    if (pickupable) {
      if (this.attachedPromptLabel !== null) {
        pickupable.promptLabel = this.attachedPromptLabel;
      }
      pickupable.onBeforePickUp = () => this.detach(item);
    }

    this._syncItemToSlot(item, slotIndex);
    this._playBeep('insert');
    this.onAttached?.(item, slotIndex);
    return true;
  }

  detach(itemOrSlot, { restorePhysics = true, playSound = true } = {}) {
    const slotIndex = typeof itemOrSlot === 'number'
      ? itemOrSlot
      : this.attachments.findIndex(a => a?.item === itemOrSlot);
    if (slotIndex < 0) return null;

    const attachment = this.attachments[slotIndex];
    if (!attachment) return null;

    const { item, previousPromptLabel } = attachment;
    this.attachments[slotIndex] = null;

    if (restorePhysics) item.makeDynamic?.();

    const pickupable = item.getComponent?.(Pickupable);
    if (pickupable) {
      pickupable.onBeforePickUp = null;
      if (previousPromptLabel !== undefined) pickupable.promptLabel = previousPromptLabel;
    }

    if (item._snapOwner === this) {
      item._snapOwner = null;
      item._snapSlotIndex = null;
    }

    if (playSound) this._playBeep('eject');
    this.onDetached?.(item, slotIndex);
    return item;
  }

  _firstEmptySlot() {
    return this.attachments.findIndex(a => !a);
  }

  _detachHeldItems() {
    for (let i = 0; i < this.attachments.length; i++) {
      const item = this.attachments[i]?.item;
      const pickupable = item?.getComponent?.(Pickupable);
      if (pickupable?.held) this.detach(i);
    }
  }

  _findCandidateForSlot(slotIndex) {
    this._getSlotWorldTransform(slotIndex, _slotWorldPos, _slotWorldQuat);

    const now = performance.now();
    for (const candidate of this.candidates) {
      if (!candidate || candidate === this.attachments[slotIndex]?.item) continue;
      if (candidate._snapOwner && candidate._snapOwner !== this) continue;
      if (this.attachments.some(a => a?.item === candidate)) continue;
      if (!this.canAccept(candidate, slotIndex)) continue;

      // Rejected items (forcefully ejected) can't re-snap until the
      // rejection expires.
      const rejectedUntil = this._rejected.get(candidate);
      if (rejectedUntil !== undefined) {
        if (now < rejectedUntil) continue;
        this._rejected.delete(candidate);
      }

      const pickupable = candidate.getComponent?.(Pickupable);
      if (pickupable?.held) continue;
      if (!candidate.object3d?.getWorldPosition) continue;

      candidate.object3d.getWorldPosition(_candidateWorldPos);
      if (_slotWorldPos.distanceTo(_candidateWorldPos) <= this.snapDistance) {
        return candidate;
      }
    }
    return null;
  }

  _updateAttachedTransforms() {
    for (let i = 0; i < this.attachments.length; i++) {
      const item = this.attachments[i]?.item;
      if (item) this._syncItemToSlot(item, i);
    }
  }

  _syncItemToSlot(item, slotIndex) {
    this._getSlotWorldTransform(slotIndex, _slotWorldPos, _slotWorldQuat);

    if (item.rigidBody) {
      item.rigidBody.setTranslation(
        { x: _slotWorldPos.x, y: _slotWorldPos.y, z: _slotWorldPos.z },
        true,
      );
      item.rigidBody.setRotation(
        { x: _slotWorldQuat.x, y: _slotWorldQuat.y, z: _slotWorldQuat.z, w: _slotWorldQuat.w },
        true,
      );
    }

    const parent = item.object3d?.parent;
    if (parent) {
      parent.updateMatrixWorld(true);
      _slotLocalPos.copy(_slotWorldPos);
      parent.worldToLocal(_slotLocalPos);
      item.object3d.position.copy(_slotLocalPos);
      parent.getWorldQuaternion(_parentQuat);
      _slotLocalQuat.copy(_parentQuat).invert().multiply(_slotWorldQuat);
      item.object3d.quaternion.copy(_slotLocalQuat);
    } else if (item.object3d) {
      item.object3d.position.copy(_slotWorldPos);
      item.object3d.quaternion.copy(_slotWorldQuat);
    }
  }

  _getSlotWorldTransform(slotIndex, targetPos, targetQuat) {
    const host = this.gameObject.object3d;
    const slot = this.slots[slotIndex];
    host.updateMatrixWorld(true);
    _receiverWorldPos.copy(slot.offset);
    targetPos.copy(host.localToWorld(_receiverWorldPos));
    host.getWorldQuaternion(targetQuat);
    targetQuat.multiply(slot.rotation);
  }

  _playBeep(type) {
    if (!this.playSounds) return;
    const engine = this.gameObject?.scene?.userData?.engine;
    if (!engine?.audioListener) return;

    const context = engine.audioListener.context;
    if (context.state === 'suspended') return;

    const freq = type === 'insert' ? DEFAULT_INSERT_BEEP_FREQ : DEFAULT_EJECT_BEEP_FREQ;
    const duration = DEFAULT_BEEP_DURATION;
    const sampleRate = context.sampleRate;
    const numSamples = Math.floor(sampleRate * duration);
    const buffer = context.createBuffer(1, numSamples, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const envelope = 1 - (i / numSamples);
      data[i] = Math.sin(2 * Math.PI * freq * t) * 0.3 * envelope;
    }

    const sound = new THREE.PositionalAudio(engine.audioListener);
    sound.setBuffer(buffer);
    sound.setRefDistance(1);
    sound.setVolume(0.5);
    sound.play();
    this.gameObject.object3d.add(sound);

    setTimeout(() => {
      this.gameObject?.object3d?.remove(sound);
      sound.disconnect();
    }, duration * 1000 + 100);
  }
}
