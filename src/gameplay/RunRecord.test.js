import { describe, it, expect } from 'vitest';
import { RunRecord } from './RunRecord.js';

describe('RunRecord', () => {
  it('starts with no array name and no nights logged', () => {
    const run = new RunRecord();
    expect(run.array).toBeNull();
    expect(run.threats(1)).toBeNull();
  });

  it('keeps each night\'s threat log', () => {
    const run = new RunRecord();
    run.logThreats(1, [{ kind: 'storm', hour: -3.5 }]);
    run.logThreats(2, []);
    expect(run.threats(1)).toEqual([{ kind: 'storm', hour: -3.5 }]);
    expect(run.threats(2)).toEqual([]);   // a quiet night, not an unknown one
    expect(run.threats(3)).toBeNull();
  });

  it('a night played again keeps its last log', () => {
    const run = new RunRecord();
    run.logThreats(2, [{ kind: 'storm', hour: 0 }]);
    run.logThreats(2, [{ kind: 'eyes', hour: 1 }]);
    expect(run.threats(2)).toEqual([{ kind: 'eyes', hour: 1 }]);
  });

  it('keeps a copy, so the caller can reuse its list', () => {
    const run = new RunRecord();
    const list = [{ kind: 'storm', hour: 0 }];
    run.logThreats(1, list);
    list.length = 0;
    expect(run.threats(1)).toHaveLength(1);
  });

  it('a new run forgets the old one and takes the new array name', () => {
    const run = new RunRecord();
    run.logThreats(1, [{ kind: 'storm', hour: 0 }]);
    run.reset({ array: 'ARRAY K-17' });
    expect(run.array).toBe('ARRAY K-17');
    expect(run.threats(1)).toBeNull();
    run.reset();
    expect(run.array).toBeNull();
  });

  it('counts nothing across the run: there is no tally to read', () => {
    const run = new RunRecord();
    expect(run.deliver).toBeUndefined();
    expect(run.findings).toBeUndefined();
  });
});
