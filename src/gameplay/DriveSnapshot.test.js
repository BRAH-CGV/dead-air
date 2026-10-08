import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Drive } from '../gameobjects/Drive.js';
import { DriveBox } from '../gameobjects/DriveBox.js';
import { GameObject } from '../core/GameObject.js';
import { SnapSocket } from '../components/SnapSocket.js';
import { DriveSnapshot } from './DriveSnapshot.js';

// Real SnapSockets mounted on real GameObject hosts, with real (bodyless)
// DriveBox/Drive objects — bodies never matter here because the snapshot
// works on object3d poses and socket ownership, exactly like build-time
// seating does.

/** A dock host like the airlock pedestal: one socket that accepts boxes. */
function makeDockSocket() {
  const host = new GameObject('DockHost');
  return host.addComponent(new SnapSocket({
    snapDistance: 0.35,
    slots: [{ offset: { y: 0.12 } }],
    attachedPromptLabel: '[E] Take drive box',
    canAccept: item => item?.isDriveBox === true,
  }));
}

/** A box parked at a "shelf" pose away from the dock. */
function makeShelfBox(name) {
  const box = new DriveBox(name);
  box.object3d.position.set(5.68, 0.28, -2.0);
  return box;
}

/** Seat a drive in one of a box's sockets (build-time style). */
function seatDrive(box, drive, slotIndex) {
  const p = box.object3d.position;
  drive.object3d.position.set(p.x, p.y + 0.1, p.z);
  expect(box.receiver.attach(drive, slotIndex)).toBe(true);
  return drive;
}

describe('DriveSnapshot', () => {
  it('restores a loose drive to its captured pose and saved flag', () => {
    const drive = new Drive('Loose');
    drive.object3d.position.set(1, 0.02, 2);
    drive.setSaved(true);
    const snap = new DriveSnapshot({ drives: [drive] });
    snap.capture();

    drive.object3d.position.set(-3, 0.5, 7);
    drive.setSaved(false);

    snap.restore();

    expect(drive.saved).toBe(true);
    expect(drive.object3d.position.x).toBeCloseTo(1);
    expect(drive.object3d.position.y).toBeCloseTo(0.02);
    expect(drive.object3d.position.z).toBeCloseTo(2);
  });

  it('a drive saved mid-night reverts to blank', () => {
    const drive = new Drive('Blank');
    const snap = new DriveSnapshot({ drives: [drive] });
    snap.capture();

    drive.setSaved(true);
    snap.restore();

    expect(drive.saved).toBe(false);
  });

  it('a red (corrupted) save survives capture and restore', () => {
    const drive = new Drive('Red');
    drive.setSaved(true, { corrupted: true });
    const snap = new DriveSnapshot({ drives: [drive] });
    snap.capture();

    // Mid-night the player wipes it at the ServerRoom console.
    drive.setEjected();
    expect(drive.saved).toBe(false);

    // The retry restores the red drive as it was.
    snap.restore();

    expect(drive.saved).toBe(true);
    expect(drive.corrupted).toBe(true);
    expect(drive._material.emissive.getHex()).toBe(0xcc2222);
  });

  it('a red save made mid-night reverts to blank, not just unsaved', () => {
    const drive = new Drive('Blank');
    const snap = new DriveSnapshot({ drives: [drive] });
    snap.capture();

    drive.setSaved(true, { corrupted: true });
    snap.restore();

    expect(drive.saved).toBe(false);
    expect(drive.corrupted).toBe(false);
  });

  it('a drive blank at capture stays blank', () => {
    const blank = new Drive('Plain');
    const savedDrive = new Drive('Marked');
    savedDrive.setSaved(true);
    const snap = new DriveSnapshot({ drives: [blank, savedDrive] });
    snap.capture();

    // Mid-night only one of them gains a signal.
    blank.setSaved(true);
    snap.restore();

    expect(savedDrive.saved).toBe(true);   // captured signal survives
    expect(blank.saved).toBe(false);       // the other stays blank
  });

  it('a drive taken from its box mid-night returns to its socket', () => {
    const box = makeShelfBox('BoxA');
    const drive = seatDrive(box, new Drive('Seated'), 3);
    const snap = new DriveSnapshot({ drives: [drive], boxes: [box] });
    snap.capture();

    box.receiver.detach(drive);
    drive.object3d.position.set(-4, 0.02, 3);
    expect(drive._snapOwner).toBeNull();

    snap.restore();

    expect(drive._snapOwner).toBe(box.receiver);
    expect(drive._snapSlotIndex).toBe(3);
    expect(box.receiver.attachedItems[3]).toBe(drive);
  });

  it('a box undocked mid-night re-docks with its drives still seated', () => {
    const socket = makeDockSocket();
    const box = makeShelfBox('BoxA');
    const d1 = seatDrive(box, new Drive('D1'), 0);
    const d2 = seatDrive(box, new Drive('D2'), 5);
    expect(socket.attach(box, 0)).toBe(true);
    const snap = new DriveSnapshot({ drives: [d1, d2], boxes: [box] });
    snap.capture();

    socket.detach(box);
    box.object3d.position.set(0, 0.5, 0);

    snap.restore();

    expect(box._snapOwner).toBe(socket);
    expect(socket.attachedItems[0]).toBe(box);
    expect(box.receiver.attachedItems[0]).toBe(d1);
    expect(box.receiver.attachedItems[5]).toBe(d2);
  });

  it('a box docked mid-night returns to its shelf pose, released', () => {
    const socket = makeDockSocket();
    const box = makeShelfBox('BoxB');
    const shelfPose = new THREE.Vector3();
    box.object3d.getWorldPosition(shelfPose);
    const snap = new DriveSnapshot({ boxes: [box] });
    snap.capture();

    // Mid-night the player carries it to the dock and seats it.
    box.object3d.position.set(0, 0.12, 0);
    expect(socket.attach(box, 0)).toBe(true);

    snap.restore();

    expect(box._snapOwner).toBeNull();
    expect(socket.firstAttached).toBeNull();
    expect(box.object3d.position.x).toBeCloseTo(shelfPose.x);
    expect(box.object3d.position.y).toBeCloseTo(shelfPose.y);
    expect(box.object3d.position.z).toBeCloseTo(shelfPose.z);
  });

  it('restore drops whatever the player holds and clears a stale insert', () => {
    const pickupSystem = { drop: vi.fn() };
    const driveManager = { ejectDrive: vi.fn() };
    const drive = new Drive('Held');
    const snap = new DriveSnapshot({ drives: [drive], driveManager, pickupSystem });
    snap.capture();

    snap.restore();

    expect(pickupSystem.drop).toHaveBeenCalledTimes(1);
    expect(driveManager.ejectDrive).toHaveBeenCalledTimes(1);
  });
});
