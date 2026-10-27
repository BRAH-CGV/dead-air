import { describe, it, expect, vi } from 'vitest';

vi.mock('@dimforge/rapier3d', async () => (await import('../test/fakeRapier.js')).rapierModule());

import { BaseScene } from './BaseScene.js';

// ─────────────────────────────────────────────
// The desk globe's cheese going off (GlobeSpin.onBlast) ends the shift,
// the screen cut to black. _globeBlast reads only what it is given, so it
// is tested here on a stand-in scene, without a build.
// ─────────────────────────────────────────────

function standIn(state = 'playing') {
  return {
    gameController: { state, fail: vi.fn() },
    whiteOut: { play: vi.fn() },
    _setPlayerLocked: vi.fn(),
  };
}
const blast = scene => BaseScene.prototype._globeBlast.call(scene);

describe('BaseScene._globeBlast (the desk globe going off)', () => {
  it('fails the night, cuts to black with the message, and holds the player', () => {
    const scene = standIn();
    blast(scene);
    expect(scene.gameController.fail).toHaveBeenCalledTimes(1);
    const [prompt, { promptAfter }] = scene.gameController.fail.mock.calls[0];
    expect(prompt).toBe('Intended game design.');
    expect(promptAfter).toBeGreaterThan(0);
    expect(scene.whiteOut.play).toHaveBeenCalledWith(prompt, expect.objectContaining({ tone: 'black' }));
    expect(scene._setPlayerLocked).toHaveBeenCalledWith(true);
  });

  it('the message shows when the prompt does', () => {
    const scene = standIn();
    blast(scene);
    const [, { promptAfter }] = scene.gameController.fail.mock.calls[0];
    const [, { messageDelayMs }] = scene.whiteOut.play.mock.calls[0];
    expect(promptAfter).toBe(messageDelayMs / 1000);
  });

  it('does nothing once the shift is already over', () => {
    const scene = standIn('gameOver');
    blast(scene);
    expect(scene.gameController.fail).not.toHaveBeenCalled();
    expect(scene.whiteOut.play).not.toHaveBeenCalled();
  });
});
