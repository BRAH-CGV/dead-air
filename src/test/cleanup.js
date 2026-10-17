import { onTestFinished } from 'vitest';

// ─────────────────────────────────────────────
// Clean-up after each test
// ─────────────────────────────────────────────
// Vitest keeps every vi.fn until the test file ends, with its implementation
// and every call's arguments and result. A mock that closes over a fake
// engine keeps the engine, and the engine keeps its whole scene, so a file
// that built the base in each test kept every base it built:
// BaseScene.test.js grew by about 10 MB a test until its worker died.
//
// setup.js, which vitest.config.js runs before every test file, clears every
// mock's records once each test is over and runs what was handed to
// onCleanup. makeEngine (fakeRapier.js) hands over each engine it makes.
//
// No three.js here: setup.js imports this into every test file.
// ─────────────────────────────────────────────

const forFile = [];

/** Runs `fn` once the current test is over, after its afterEach hooks.
 *  Called outside a test (a beforeAll, or a file's top level) it runs at the
 *  end of the file instead, so what it frees is there for every test. */
export function onCleanup(fn) {
  try {
    onTestFinished(fn);
  } catch {
    // Not in a test: onTestFinished throws outside one.
    forFile.push(fn);
  }
}

/** Runs the clean-ups handed over outside a test, latest first. */
export function cleanUpFile() {
  while (forFile.length) forFile.pop()();
}
