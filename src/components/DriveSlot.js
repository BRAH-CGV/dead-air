import { SnapSocket } from './SnapSocket.js';

const DEFAULT_SNAP_DISTANCE = 0.25;
const DEFAULT_SNAP_OFFSET = { y: 0.025 };

/**
 * DriveSlot – drive-specific single-socket wrapper over SnapSocket.
 *
 * Attach to a GameObject to make it passively accept one registered drive.
 * Nearby unheld drives snap into place; removal is the normal Pickupable flow:
 * look at the inserted drive and press E. The optional DriveManager binding is
 * preserved for the main desk reader, while standalone slots can use the local
 * insertedDrive state directly.
 */
export class DriveSlot extends SnapSocket {
  /** @type {import('../gameplay/DriveManager.js').DriveManager|null} */
  driveManager = null;

  /** Called after a drive snaps into the slot. @type {((drive: object) => void)|null} */
  onDriveInserted = null;

  /** Called after a drive is removed from the slot. @type {((drive: object) => void)|null} */
  onDriveRemoved = null;

  constructor(opts = {}) {
    super({
      snapDistance: opts.snapDistance ?? DEFAULT_SNAP_DISTANCE,
      snapOffset: { ...DEFAULT_SNAP_OFFSET, ...(opts.snapOffset ?? {}) },
      attachedPromptLabel: null,
      onBeforeAttach: drive => {
        if (!this.driveManager) return true;
        return this.driveManager.insertDrive(drive);
      },
      onAttached: drive => this.onDriveInserted?.(drive),
      onDetached: drive => {
        this.driveManager?.ejectDrive();
        this.onDriveRemoved?.(drive);
      },
    });
    if (opts.onDriveInserted) this.onDriveInserted = opts.onDriveInserted;
    if (opts.onDriveRemoved) this.onDriveRemoved = opts.onDriveRemoved;
  }

  /** Drives this slot watches. Kept as an alias for the old public API. */
  get drives() { return this.candidates; }

  /** Wire the DriveManager. Called by the scene after gameplay systems. */
  bindDriveManager(dm) {
    this.driveManager = dm;
  }

  /** Register a drive this slot should watch. */
  addDrive(drive) {
    this.addCandidate(drive);
  }

  /** Local offset from the slot origin. Kept for the old public API. */
  get snapOffset() {
    const offset = this.slots[0]?.offset;
    return { x: offset?.x ?? 0, y: offset?.y ?? 0, z: offset?.z ?? 0 };
  }

  /** Backwards-compatible test hook for the formerly local inserted field. */
  get _insertedDrive() {
    return this.firstAttached;
  }

  set _insertedDrive(drive) {
    this.attachments[0] = drive ? { item: drive, previousPromptLabel: undefined } : null;
  }

  /** The drive currently in the slot, or null. */
  get insertedDrive() {
    return this.firstAttached;
  }

  /** Whether a drive is currently inserted. */
  get hasDrive() {
    return this.insertedDrive !== null;
  }

  /** Compatibility helper for tests/older callers. */
  _insertDrive(drive) {
    return this.attach(drive, 0);
  }

  /** Compatibility helper for tests/older callers. */
  _ejectDrive(drive) {
    return this.detach(drive);
  }
}
