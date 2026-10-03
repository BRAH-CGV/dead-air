import { describe, it, expect } from 'vitest';
import { controlsList } from './controlsList.js';

const binds = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', crouch: 'KeyC', interact: 'KeyE', flashlight: 'KeyF',
  debugFly: 'KeyV', fullbright: 'KeyB', nextNight: 'KeyN', perfStats: 'KeyI',
};

const find = (groups, title) => groups.find(g => g.title === title);

describe('controlsList', () => {
  it('lists movement and actions from the live binds', () => {
    const groups = controlsList({ ...binds, jump: 'KeyJ' }, { devTools: false });
    const player = find(groups, 'PLAYER');
    expect(player.rows).toContainEqual({ label: 'Move', keys: 'W A S D' });
    expect(player.rows).toContainEqual({ label: 'Jump', keys: 'J' });
    expect(player.rows).toContainEqual({ label: 'Interact', keys: 'E' });
    expect(player.rows).toContainEqual({ label: 'Pause', keys: 'Esc' });
  });

  it('lists the fixed terminal keys', () => {
    const terminal = find(controlsList(binds, { devTools: false }), 'COMPUTER TERMINAL');
    const keys = terminal.rows.map(r => r.keys);
    expect(keys).toEqual(expect.arrayContaining(['Q', 'Enter', 'S', 'D']));
  });

  it('lists debug keys only when dev tools are on', () => {
    expect(find(controlsList(binds, { devTools: false }), 'DEVELOPER')).toBeUndefined();
    const dev = find(controlsList(binds, { devTools: true }), 'DEVELOPER');
    expect(dev.rows.map(r => r.keys)).toEqual(expect.arrayContaining(['`', 'F2', 'V', 'B', 'I', 'N', 'F4']));
  });
});
