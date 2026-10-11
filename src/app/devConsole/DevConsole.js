// ─────────────────────────────────────────────
// DevConsole  –  the developer console's commands, log and history (pure)
// ─────────────────────────────────────────────
// No DOM and no engine: commands are registered from outside (commands.js)
// and the menu draws `lines`. run() takes one typed line; suggest() is what
// the dropdown under the input shows while it is typed.
//
// A command returns its output (a string, an array of them, or nothing). It
// throws a UsageError for bad arguments, which shows its usage under it, or a
// CommandError for anything else it can't do ("not in this scene").
// ─────────────────────────────────────────────

/** Bad arguments: the message is shown, then the command's usage. */
export class UsageError extends Error {}

/** It can't be done: the message is shown alone. */
export class CommandError extends Error {}

/** @typedef {{ text: string, kind: 'input'|'output'|'error' }} Line */
/** @typedef {{ name: string, aliases?: string[], usage: string, help: string,
 *              run: (args: string[]) => string|string[]|void }} Command */
/** @typedef {{ name: string, usage: string, help: string, format?: true }} Suggestion */

const RANK = { exact: 0, prefix: 1, substring: 2, subsequence: 3, typo: 4 };

export class DevConsole {
  /** @type {Line[]} */
  lines = [];

  /** @type {Map<string, Command>} every name and alias, lower case */
  _byName = new Map();
  /** @type {Command[]} */
  _commands = [];
  /** @type {string[]} */
  _history = [];
  _cursor = 0;

  /** @param {{ maxLines?: number }} [opts] */
  constructor({ maxLines = 200 } = {}) {
    this.maxLines = maxLines;
    this.register({
      name: 'help', usage: 'help [command]', help: 'List the commands, or explain one',
      run: (args) => this._help(args[0]),
    });
    this.register({
      name: 'clear', usage: 'clear', help: 'Clear the log',
      run: () => { this.lines.length = 0; },
    });
  }

  /** @param {Command} command */
  register(command) {
    this._commands.push(command);
    for (const name of [command.name, ...(command.aliases ?? [])]) {
      this._byName.set(name.toLowerCase(), command);
    }
  }

  /** The command a name or alias stands for. @param {string} name */
  find(name) {
    return this._byName.get(String(name).toLowerCase()) ?? null;
  }

  /**
   * Run one typed line: echo it, then whatever the command says.
   * @param {string} line
   * @returns {{ ok: boolean }}
   */
  run(line) {
    const text = String(line ?? '').trim();
    if (!text) return { ok: false };
    this._remember(text);

    const [word, ...args] = text.split(/\s+/);
    const command = this.find(word);
    this._add(`> ${text}`, 'input');
    if (!command) {
      const guess = this._guess(word);
      this._add(guess
        ? `Unknown command "${word}". Did you mean ${guess}?`
        : `Unknown command "${word}". Type "help" for a list of commands.`, 'error');
      return { ok: false };
    }

    try {
      const out = command.run(args);
      for (const l of [out ?? []].flat()) this._add(String(l), 'output');
      return { ok: true };
    } catch (err) {
      if (err instanceof UsageError) {
        this._add(err.message, 'error');
        this._add(`Usage: ${command.usage}`, 'error');
      } else if (err instanceof CommandError) {
        this._add(err.message, 'error');
      } else {
        console.error(err);
        this._add(`Error: ${err?.message ?? err}`, 'error');
      }
      return { ok: false };
    }
  }

  // ── History ───────────────────────────────

  /** One line further back, staying on the oldest. */
  historyPrev() {
    if (this._history.length === 0) return '';
    this._cursor = Math.max(0, this._cursor - 1);
    return this._history[this._cursor];
  }

  /** One line forward, and an empty line past the newest. */
  historyNext() {
    this._cursor = Math.min(this._history.length, this._cursor + 1);
    return this._history[this._cursor] ?? '';
  }

  // ── Suggestions ───────────────────────────

  /**
   * What the dropdown shows for a half-typed line. While the first word is
   * typed, the commands it could be, best first: an exact name, a prefix, a
   * substring, a subsequence (`stm` → stamina), a near typo. Once a space
   * follows it, only that command, as its format line (`format: true`).
   * @param {string} text
   * @param {number} [limit]
   * @returns {Suggestion[]}
   */
  suggest(text, limit = 6) {
    const typed = String(text ?? '').replace(/^\s+/, '');
    if (!typed) return [];
    const space = typed.search(/\s/);
    if (space !== -1) {
      const command = this.find(typed.slice(0, space));
      return command ? [{ ...entry(command), format: true }] : [];
    }

    const query = typed.toLowerCase();
    const scored = [];
    for (const command of this._commands) {
      let best = Infinity;
      for (const name of [command.name, ...(command.aliases ?? [])]) {
        best = Math.min(best, score(query, name.toLowerCase()));
      }
      if (best < Infinity) scored.push({ command, best });
    }
    scored.sort((a, b) => a.best - b.best || a.command.name.localeCompare(b.command.name));
    return scored.slice(0, limit).map(s => entry(s.command));
  }

  /** The top suggestion's name, ready for arguments, or null. @param {string} text */
  complete(text) {
    const [top] = this.suggest(text, 1);
    return top && !top.format ? `${top.name} ` : null;
  }

  // ── Internals ─────────────────────────────

  _help(name) {
    if (name === undefined) {
      return [...this._commands]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(c => `${c.usage} — ${c.help}`);
    }
    const command = this.find(name);
    if (!command) throw new UsageError(`No command "${name}"`);
    const out = [`${command.usage} — ${command.help}`];
    if (command.aliases?.length) out.push(`Also: ${command.aliases.join(', ')}`);
    return out;
  }

  _guess(word) {
    return this.suggest(word, 1)[0]?.name ?? null;
  }

  _remember(text) {
    if (this._history.at(-1) !== text) this._history.push(text);
    this._cursor = this._history.length;
  }

  _add(text, kind) {
    this.lines.push({ text, kind });
    if (this.lines.length > this.maxLines) this.lines.splice(0, this.lines.length - this.maxLines);
  }
}

/** @param {Command} c @returns {Suggestion} */
function entry(c) {
  return { name: c.name, usage: c.usage, help: c.help };
}

/** How well `query` matches `name` (lower is better), or Infinity. */
function score(query, name) {
  if (name === query) return RANK.exact;
  if (name.startsWith(query)) return RANK.prefix;
  if (name.includes(query)) return RANK.substring;
  if (isSubsequence(query, name)) return RANK.subsequence;
  // A typo: one slip in a short word, two in a longer one.
  const allowed = query.length >= 5 ? 2 : query.length >= 3 ? 1 : 0;
  if (allowed && editDistance(query, name) <= allowed) return RANK.typo;
  return Infinity;
}

function isSubsequence(query, name) {
  let i = 0;
  for (const ch of name) if (ch === query[i]) i++;
  return i === query.length;
}

/** Levenshtein distance. */
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}
