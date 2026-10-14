import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DevConsole, UsageError, CommandError } from './DevConsole.js';

const texts = (c) => c.lines.map(l => l.text);
const kinds = (c) => c.lines.map(l => l.kind);

describe('DevConsole', () => {
  let c, stamina;
  beforeEach(() => {
    c = new DevConsole();
    stamina = vi.fn((args) => `stamina ${args[0] ?? 'shown'}`);
    c.register({ name: 'stamina', usage: 'stamina [0–1]', help: 'Set or show stamina', run: stamina });
    c.register({ name: 'storm', usage: 'storm', help: 'Start a sandstorm now', run: () => 'storm summoned' });
    c.register({ name: 'fly', aliases: ['noclip'], usage: 'fly [on|off]', help: 'Free-fly camera', run: () => ['fly on', 'WASD to move'] });
    c.register({ name: 'colliders', usage: 'colliders [on|off]', help: 'Collider wireframes', run: () => {} });
  });

  describe('run', () => {
    it('echoes the line, then the output, and passes the arguments', () => {
      const result = c.run('stamina 0.5');
      expect(result.ok).toBe(true);
      expect(stamina).toHaveBeenCalledWith(['0.5']);
      expect(texts(c)).toEqual(['> stamina 0.5', 'stamina 0.5']);
      expect(kinds(c)).toEqual(['input', 'output']);
    });

    it('splits on any whitespace and ignores leading and trailing space', () => {
      c.run('   stamina    0.25   ');
      expect(stamina).toHaveBeenCalledWith(['0.25']);
      expect(texts(c)[0]).toBe('> stamina    0.25');
    });

    it('matches the command case-insensitively, but leaves arguments alone', () => {
      c.run('STAMINA Shown');
      expect(stamina).toHaveBeenCalledWith(['Shown']);
    });

    it('runs a command by its alias', () => {
      c.run('noclip');
      expect(texts(c)).toEqual(['> noclip', 'fly on', 'WASD to move']);
    });

    it('a command that returns nothing adds only the echo', () => {
      c.run('colliders');
      expect(texts(c)).toEqual(['> colliders']);
    });

    it('a blank line does nothing', () => {
      expect(c.run('   ').ok).toBe(false);
      expect(c.lines).toEqual([]);
    });

    it('an unknown command is an error that guesses what was meant', () => {
      const result = c.run('stamna 0.5');
      expect(result.ok).toBe(false);
      expect(c.lines.at(-1)).toEqual({ text: 'Unknown command "stamna". Did you mean stamina?', kind: 'error' });
    });

    it('an unknown command with no near match points at help', () => {
      c.run('xyzzy');
      expect(c.lines.at(-1)).toEqual({ text: 'Unknown command "xyzzy". Type "help" for a list of commands.', kind: 'error' });
    });

    it('a UsageError becomes an error line with the usage', () => {
      c.register({ name: 'night', usage: 'night [n]', help: '', run: () => { throw new UsageError('Night must be 1–3'); } });
      const result = c.run('night 9');
      expect(result.ok).toBe(false);
      expect(c.lines.slice(-2)).toEqual([
        { text: 'Night must be 1–3', kind: 'error' },
        { text: 'Usage: night [n]', kind: 'error' },
      ]);
    });

    it('a CommandError is an error line alone: no usage, not logged', () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      c.register({ name: 'ufo', usage: 'ufo', help: '', run: () => { throw new CommandError('Not in this scene'); } });
      expect(c.run('ufo').ok).toBe(false);
      expect(c.lines.slice(1)).toEqual([{ text: 'Not in this scene', kind: 'error' }]);
      expect(log).not.toHaveBeenCalled();
      log.mockRestore();
    });

    it('any other throw is an error line too, and is logged', () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      c.register({ name: 'boom', usage: 'boom', help: '', run: () => { throw new Error('kaput'); } });
      expect(c.run('boom').ok).toBe(false);
      expect(c.lines.at(-1)).toEqual({ text: 'Error: kaput', kind: 'error' });
      expect(log).toHaveBeenCalled();
      log.mockRestore();
    });

    it('keeps no more than the line cap, dropping the oldest', () => {
      const small = new DevConsole({ maxLines: 5 });
      small.register({ name: 'x', usage: 'x', help: '', run: () => 'out' });
      for (let i = 0; i < 4; i++) small.run('x');
      expect(small.lines).toHaveLength(5);
      expect(small.lines[0]).toEqual({ text: 'out', kind: 'output' });
    });

    it('returns the lines it added, even those the cap has already dropped', () => {
      const small = new DevConsole({ maxLines: 2 });
      small.register({ name: 'x', usage: 'x', help: '', run: () => ['one', 'two'] });
      expect(small.run('x').lines).toEqual([
        { text: '> x', kind: 'input' }, { text: 'one', kind: 'output' }, { text: 'two', kind: 'output' },
      ]);
      expect(small.run('nope').lines.map(l => l.kind)).toEqual(['input', 'error']);
      expect(small.run('   ').lines).toEqual([]);
    });
  });

  describe('help and clear', () => {
    it('help lists every command with its format and description', () => {
      c.run('help');
      const out = texts(c);
      expect(out).toContain('stamina [0–1] — Set or show stamina');
      expect(out).toContain('fly [on|off] — Free-fly camera');
      expect(out).toContain('help [command] — List the commands, or explain one');
    });

    it('help <command> explains one, aliases included', () => {
      c.run('help noclip');
      expect(texts(c).slice(1)).toEqual(['fly [on|off] — Free-fly camera', 'Also: noclip']);
    });

    it('help <unknown> is an error', () => {
      expect(c.run('help nope').ok).toBe(false);
    });

    it('clear empties the log', () => {
      c.run('storm');
      c.run('clear');
      expect(c.lines).toEqual([]);
    });

    it('clear still returns its own echo', () => {
      expect(c.run('clear').lines).toEqual([{ text: '> clear', kind: 'input' }]);
    });
  });

  describe('history', () => {
    it('walks back through what was run, then forward to an empty line', () => {
      c.run('storm');
      c.run('stamina 0.1');
      expect(c.historyPrev()).toBe('stamina 0.1');
      expect(c.historyPrev()).toBe('storm');
      expect(c.historyPrev()).toBe('storm');   // stays on the oldest
      expect(c.historyNext()).toBe('stamina 0.1');
      expect(c.historyNext()).toBe('');
      expect(c.historyNext()).toBe('');
    });

    it('records unknown commands too, but not the same line twice in a row', () => {
      c.run('stamna');
      c.run('storm');
      c.run('storm');
      expect(c.historyPrev()).toBe('storm');
      expect(c.historyPrev()).toBe('stamna');
    });

    it('running a line starts the walk again from the newest', () => {
      c.run('storm');
      c.run('fly');
      c.historyPrev();
      c.historyPrev();
      c.run('colliders');
      expect(c.historyPrev()).toBe('colliders');
    });

    it('is empty to begin with', () => {
      expect(c.historyPrev()).toBe('');
      expect(c.historyNext()).toBe('');
    });
  });

  describe('suggest', () => {
    const names = (list) => list.map(s => s.name);

    it('nothing for an empty line', () => {
      expect(c.suggest('')).toEqual([]);
      expect(c.suggest('   ')).toEqual([]);
    });

    it('gives each match its name, format and description', () => {
      expect(c.suggest('stam')[0]).toEqual({ name: 'stamina', usage: 'stamina [0–1]', help: 'Set or show stamina' });
    });

    it('prefix matches, in name order', () => {
      expect(names(c.suggest('st'))).toEqual(['stamina', 'storm']);
    });

    it('an exact name comes first', () => {
      c.register({ name: 'storms', usage: 'storms', help: '', run: () => {} });
      expect(names(c.suggest('storm'))[0]).toBe('storm');
    });

    it('a prefix beats a substring', () => {
      c.register({ name: 'restore', usage: 'restore', help: '', run: () => {} });
      expect(names(c.suggest('sto'))).toEqual(['storm', 'restore']);
    });

    it('finds a subsequence', () => {
      expect(names(c.suggest('stm'))).toEqual(['stamina', 'storm']);
      expect(names(c.suggest('cldr'))).toEqual(['colliders']);
    });

    it('finds a near typo', () => {
      expect(names(c.suggest('stamna'))).toEqual(['stamina']);
      expect(names(c.suggest('collidres'))).toEqual(['colliders']);
    });

    it('matches aliases, naming the command', () => {
      expect(names(c.suggest('noc'))).toEqual(['fly']);
    });

    it('is case-insensitive', () => {
      expect(names(c.suggest('STA'))).toEqual(['stamina']);
    });

    it('includes the built-ins', () => {
      expect(names(c.suggest('he'))).toEqual(['help']);
    });

    it('once a space follows the command, only that command, as its format', () => {
      expect(c.suggest('stamina ')).toEqual([{ name: 'stamina', usage: 'stamina [0–1]', help: 'Set or show stamina', format: true }]);
      expect(c.suggest('noclip on')[0].name).toBe('fly');
      expect(c.suggest('stamna 0.5')).toEqual([]);
    });

    it('caps the list', () => {
      for (const n of ['sa', 'sb', 'sc', 'sd', 'se', 'sf', 'sg']) c.register({ name: n, usage: n, help: '', run: () => {} });
      expect(c.suggest('s')).toHaveLength(6);
      expect(c.suggest('s', 3)).toHaveLength(3);
    });
  });

  describe('complete', () => {
    it('the top suggestion, ready for arguments', () => {
      expect(c.complete('sta')).toBe('stamina ');
      expect(c.complete('noc')).toBe('fly ');
    });

    it('nothing to complete', () => {
      expect(c.complete('xyzzy')).toBe(null);
      expect(c.complete('')).toBe(null);
      expect(c.complete('stamina 0.')).toBe(null);
    });
  });
});
