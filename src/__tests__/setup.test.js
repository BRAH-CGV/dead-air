import { describe, it, expect } from 'vitest';

describe('test infrastructure', () => {
  it('runs a trivial passing test', () => {
    expect(1 + 1).toBe(2);
  });

  it('supports ES module imports', () => {
    const arr = [1, 2, 3];
    expect(arr).toHaveLength(3);
  });
});
