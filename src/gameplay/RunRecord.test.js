import { describe, it, expect } from 'vitest';
import { RunRecord, processedDrives, PROCESSED_LEVEL } from './RunRecord.js';

const drive = (o = {}) => ({ saved: true, corrupted: false, signalLevel: 2, ...o });
const box = (...items) => ({ receiver: { attachedItems: items } });

describe('processedDrives', () => {
  it('counts the drives in a box holding a processed signal', () => {
    expect(PROCESSED_LEVEL).toBe(2);
    expect(processedDrives(box(drive(), drive(), drive()))).toBe(3);
  });

  it('leaves out a blank drive, a red one and one saved but never processed', () => {
    expect(processedDrives(box(
      drive(),
      drive({ saved: false, signalLevel: 1 }),
      drive({ corrupted: true }),
      drive({ signalLevel: 1 }),
    ))).toBe(1);
  });

  it('is 0 with no box, or a box with nothing in it', () => {
    expect(processedDrives(null)).toBe(0);
    expect(processedDrives(undefined)).toBe(0);
    expect(processedDrives(box())).toBe(0);
    expect(processedDrives({})).toBe(0);
  });
});

describe('RunRecord', () => {
  it('starts with nothing delivered and no array name', () => {
    const run = new RunRecord();
    expect(run.array).toBeNull();
    expect(run.delivered(1)).toBe(0);
    expect(run.findings(3)).toEqual([]);
  });

  it('remembers what each night sent to the hub', () => {
    const run = new RunRecord();
    run.deliver(1, 2);
    run.deliver(2, 3);
    expect(run.delivered(1)).toBe(2);
    expect(run.delivered(2)).toBe(3);
    expect(run.delivered(3)).toBe(0);
  });

  it('keeps the last send-off for a night played again', () => {
    const run = new RunRecord();
    run.deliver(2, 3);
    run.deliver(2, 1);
    expect(run.delivered(2)).toBe(1);
  });

  it('brings results back the evening after: one finding per processed drive from earlier nights', () => {
    const run = new RunRecord();
    run.deliver(1, 2);
    run.deliver(2, 1);
    expect(run.findings(1)).toEqual([]);
    expect(run.findings(2)).toEqual([
      { night: 1, index: 1 },
      { night: 1, index: 2 },
    ]);
    expect(run.findings(3)).toEqual([
      { night: 1, index: 1 },
      { night: 1, index: 2 },
      { night: 2, index: 1 },
    ]);
  });

  it('lists the findings night by night, whatever order the nights were sent in', () => {
    const run = new RunRecord();
    run.deliver(2, 1);
    run.deliver(1, 1);
    expect(run.findings(3).map((f) => f.night)).toEqual([1, 2]);
  });

  it('a new run forgets the old one and takes the new array name', () => {
    const run = new RunRecord();
    run.deliver(1, 4);
    run.reset({ array: 'ARRAY K-17' });
    expect(run.array).toBe('ARRAY K-17');
    expect(run.delivered(1)).toBe(0);
    run.reset();
    expect(run.array).toBeNull();
  });
});
