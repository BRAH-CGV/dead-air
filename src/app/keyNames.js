// ─────────────────────────────────────────────
// keyNames  –  readable key labels, reserved keys, rebinding rules
// ─────────────────────────────────────────────
// Pure helpers behind the CONTROLS tab and the prompts that name a key.
// Everything is keyed by KeyboardEvent.code (layout-independent), the same
// codes Engine.keyBinds holds.
// ─────────────────────────────────────────────

/** The gameplay actions the player can rebind, in the order the UI lists
 *  them. The debug binds stay fixed (listed read-only on DEVELOPER). */
export const REBINDABLE = ['forward', 'back', 'left', 'right', 'jump', 'crouch', 'interact', 'flashlight'];

/** Labels for the rebind rows. */
export const ACTION_LABELS = {
  forward: 'Move forward', back: 'Move back', left: 'Move left', right: 'Move right',
  jump: 'Jump', crouch: 'Crouch', interact: 'Interact', flashlight: 'Flashlight',
};

const NAMED = {
  Space: 'Space', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Escape: 'Esc', Enter: 'Enter', NumpadEnter: 'Num Enter', Backspace: 'Backspace', CapsLock: 'Caps Lock',
};
const SIDES = { Shift: 'Shift', Control: 'Ctrl', Alt: 'Alt', Meta: 'Meta' };

/** A short label for a key code: `KeyW → W`, `ShiftLeft → Left Shift`.
 *  Unknown codes pass through unchanged.
 *  @param {string} code
 *  @returns {string} */
export function keyName(code) {
  if (!code) return '';
  if (NAMED[code]) return NAMED[code];
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
  if ((m = /^Digit(\d)$/.exec(code))) return m[1];
  if ((m = /^Numpad(\d)$/.exec(code))) return `Num ${m[1]}`;
  if ((m = /^(Shift|Control|Alt|Meta)(Left|Right)$/.exec(code))) return `${m[2]} ${SIDES[m[1]]}`;
  return code;
}

// Escape belongs to the pause menu and the browser; ` and F-keys to the
// debug tools and the browser; Q / Enter to the computer terminal.
const ALWAYS_RESERVED = new Set([
  'Escape', 'Backquote', 'KeyQ', 'Enter', 'NumpadEnter',
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
]);
// Engine.keyBinds debugFly / fullbright / nextNight / perfStats.
const DEBUG_RESERVED = new Set(['KeyV', 'KeyB', 'KeyN', 'KeyI']);

/** Whether a key may not be bound to a gameplay action.
 *  @param {string} code
 *  @param {{ devTools?: boolean }} [opts] */
export function isReserved(code, { devTools = false } = {}) {
  return ALWAYS_RESERVED.has(code) || (devTools && DEBUG_RESERVED.has(code));
}

/**
 * Work out what binding `action` to `code` changes, without touching `binds`.
 * A key another rebindable action already uses is swapped: that action gets
 * this one's old key. The caller applies `changes` with Object.assign, so the
 * live keyBinds object (which other code holds) is never replaced.
 *
 * @param {Record<string, string>} binds
 * @param {string} action
 * @param {string} code
 * @param {{ devTools?: boolean }} [opts]
 * @returns {{ ok: true, changes: Record<string, string>, swappedWith: string|null }
 *          | { ok: false, reason: string }}
 */
export function rebind(binds, action, code, { devTools = false } = {}) {
  if (!REBINDABLE.includes(action)) return { ok: false, reason: `${action} can't be rebound` };
  if (isReserved(code, { devTools })) return { ok: false, reason: `${keyName(code)} is reserved` };

  const old = binds[action];
  if (old === code) return { ok: true, changes: {}, swappedWith: null };

  const other = REBINDABLE.find(a => a !== action && binds[a] === code) ?? null;
  const changes = { [action]: code };
  if (other) changes[other] = old;
  return { ok: true, changes, swappedWith: other };
}
