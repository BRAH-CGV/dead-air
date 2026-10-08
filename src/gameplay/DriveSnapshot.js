import * as THREE from 'three';

// Pre-allocated scratch for the world→local teleport conversion.
const _localPos = new THREE.Vector3();
const _parentQuat = new THREE.Quaternion();

/** Fill `position`/`quaternion` with an object3d's world pose. */
function worldPose(object3d, position, quaternion) {
  object3d.updateMatrixWorld(true);
  object3d.getWorldPosition(position);
  object3d.getWorldQuaternion(quaternion);
}

/**
 * DriveSnapshot  –  the night-start state of every drive and drive box.
 *
 * At the beginning of each night the scene captures where everything sits
 * and which sockets own what. A retry (game over → [E]) reverts to the
 * capture instead of replaying the between-nights reset, so a failed attempt
 * leaves no trace: a scanned drive goes blank again, a knocked box returns
 * to its board, a docked box undocks.
 *
 * Captures are always taken with the reader and server slot empty (the
 * between-nights reset ejects their drives first), so a mid-night insertion
 * is simply undone by restore — no captured owner is ever a machine slot.
 */
export class DriveSnapshot {
  /**
   * @param {object} [opts]
   * @param {object[]} [opts.drives]        Every Drive in the room.
   * @param {object[]} [opts.boxes]         Every DriveBox in the room.
   * @param {object}   [opts.driveManager]  Cleared of stale inserts on restore.
   * @param {object}   [opts.pickupSystem]  Whatever it holds is dropped on restore.
   */
  constructor({ drives = [], boxes = [], driveManager = null, pickupSystem = null } = {}) {
    this.drives = drives;
    this.boxes = boxes;
    this.driveManager = driveManager;
    this.pickupSystem = pickupSystem;
    /** @type {object[]} */
    this._driveStates = [];
    /** @type {object[]} */
    this._boxStates = [];
  }

  /** Record every drive's pose, signal and socket ownership, and every
   *  box's pose (including whether it is docked). Call at a night start. */
  capture() {
    this._driveStates = this.drives.map(drive => {
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      worldPose(drive.object3d, position, quaternion);
      return {
        drive,
        saved: drive.saved,
        owner: drive._snapOwner ?? null,
        slotIndex: drive._snapSlotIndex ?? null,
        position,
        quaternion,
      };
    });

    this._boxStates = this.boxes.map(box => {
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      worldPose(box.object3d, position, quaternion);
      return {
        box,
        owner: box._snapOwner ?? null,
        slotIndex: box._snapSlotIndex ?? null,
        position,
        quaternion,
      };
    });
  }

  /** Revert every drive and box to the last capture. */
  restore() {
    if (!this._driveStates.length && !this._boxStates.length) return;

    // Whatever the player holds reverts with everything else, and the
    // reader is empty in every capture, so any mid-night insert is undone.
    this.pickupSystem?.drop?.();
    this.driveManager?.ejectDrive?.();

    // Pass 1 — release anything whose socket differs from the capture, so
    // recorded slots are free before their tenants return. Boxes run before
    // drives: a re-docked box defines the pose its drives snap back to.
    const released = new Set();
    for (const state of [...this._boxStates, ...this._driveStates]) {
      const item = state.box ?? state.drive;
      if (item._snapOwner && (item._snapOwner !== state.owner
          || item._snapSlotIndex !== state.slotIndex)) {
        item._snapOwner.detach(item);
        released.add(item);
      }
    }

    // Pass 2 — put everything back: owned items re-attach to their recorded
    // socket, loose items return to their recorded pose as dynamic bodies.
    for (const state of this._boxStates) this._reinstate(state, released);
    for (const state of this._driveStates) this._reinstate(state, released);
  }

  /** Return one captured item to its recorded place. */
  _reinstate(state, released) {
    const { owner, slotIndex, position, quaternion } = state;
    const item = state.box ?? state.drive;
    if (state.saved !== undefined) item.setSaved?.(state.saved);

    // Skipped only when pass 1 left this item alone AND it still sits where
    // the capture left it — a released item must be moved even if its owner
    // is now null again (e.g. it was docked mid-night and captured loose).
    if (!released.has(item)
        && item._snapOwner === owner
        && (owner === null || item._snapSlotIndex === slotIndex)) {
      return;   // already where the capture left it
    }
    if (owner) {
      owner.attach(item, slotIndex ?? undefined);
    } else {
      item.makeDynamic?.();
      this.teleport(item, position, quaternion);
    }
  }

  /** Move a physics object to a world pose: teleport the body (a dynamic
   *  body is the physics authority) and mirror it into local space. */
  teleport(item, position, quaternion) {
    const body = item.rigidBody;
    if (body) {
      body.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
      body.setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w }, true);
      body.setLinvel?.({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel?.({ x: 0, y: 0, z: 0 }, true);
    }

    const parent = item.object3d?.parent;
    if (parent) {
      parent.updateMatrixWorld(true);
      _localPos.copy(position);
      parent.worldToLocal(_localPos);
      item.object3d.position.copy(_localPos);
      parent.getWorldQuaternion(_parentQuat);
      _parentQuat.invert().multiply(quaternion);
      item.object3d.quaternion.copy(_parentQuat);
    } else if (item.object3d) {
      item.object3d.position.copy(position);
      item.object3d.quaternion.copy(quaternion);
    }
  }
}
