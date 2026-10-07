// ─────────────────────────────────────────────
// controlsList  –  the fixed keys the CONTROLS tab lists (pure)
// ─────────────────────────────────────────────
// The CONTROLS tab rebinds the gameplay keys; under those rows it lists
// what can't be rebound: Esc, mouse look, and the computer terminal, whose
// keys are fixed in ComputerTerminal and SignalReviewPanel. Read from the
// live keyBinds every draw, so the cursor row follows a rebind. Debug keys
// are never listed: they go before release.
// ─────────────────────────────────────────────

import { keyName } from './keyNames.js';

/**
 * @param {Record<string, string>} binds  Engine.keyBinds
 * @returns {{ title: string, rows: { label: string, keys: string }[] }[]}
 */
export function controlsList(binds) {
  const k = (action) => keyName(binds[action]);
  return [
    {
      title: 'GENERAL',
      rows: [
        { label: 'Look', keys: 'Mouse' },
        { label: 'Pause', keys: 'Esc' },
      ],
    },
    {
      title: 'COMPUTER TERMINAL',
      rows: [
        { label: 'Move cursor', keys: [k('forward'), k('left'), k('back'), k('right')].join(' ') },
        { label: 'Scan', keys: 'Enter' },
        { label: 'Exit terminal', keys: 'Q' },
        { label: 'Save signal', keys: 'S' },
        { label: 'Delete signal', keys: 'D' },
      ],
    },
  ];
}
