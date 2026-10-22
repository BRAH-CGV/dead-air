import { beforeEach, afterAll, onTestFinished, vi } from 'vitest';
import { cleanUpFile } from './cleanup.js';

// ─────────────────────────────────────────────
// Runs before every test file (vitest.config.js, setupFiles). Each test's
// mocks forget their calls once it is over, and what was handed to onCleanup
// is run. See cleanup.js.
// ─────────────────────────────────────────────

beforeEach(() => {
  // Handed over first, so it runs last: after the test's afterEach hooks and
  // its onCleanup calls, which may still read a mock.
  onTestFinished(() => vi.clearAllMocks());
});

afterAll(cleanUpFile);
