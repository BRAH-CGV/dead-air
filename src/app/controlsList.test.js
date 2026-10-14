import { describe, it, expect } from 'vitest';
import { controlsList } from './controlsList.js';

const binds = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', crouch: 'KeyC', interact: 'KeyE', flashlight: 'KeyF',
  debugFly: 'KeyV',
};

describe('controlsList', () => {
  it('lists the fixed keys the rebind rows do not cover: Esc, mouse look and the terminal', () => {
    const groups = controlsList(binds);
    expect(groups.map(g => g.title)).toEqual(['GENERAL', 'COMPUTER TERMINAL']);
    const all = groups.flatMap(g => g.rows);
    expect(all).toContainEqual({ label: 'Pause', keys: 'Esc' });
    expect(all).toContainEqual({ label: 'Look', keys: 'Mouse' });
    expect(all.map(r => r.keys)).toEqual(expect.arrayContaining(['Q', 'Enter']));
  });

  it('the terminal cursor follows the live movement binds', () => {
    const terminal = controlsList({ ...binds, forward: 'KeyI' }).find(g => g.title === 'COMPUTER TERMINAL');
    expect(terminal.rows).toContainEqual({ label: 'Move cursor', keys: 'I A S D' });
  });

  it('never lists debug keys', () => {
    const all = controlsList(binds).flatMap(g => g.rows).map(r => r.label).join(' ');
    expect(all).not.toMatch(/fly|fullbright|editor|night/i);
  });
});
