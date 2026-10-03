// ─────────────────────────────────────────────
// controlsList  –  what the Controls screen lists (pure)
// ─────────────────────────────────────────────
// Read from the live keyBinds every time the screen opens, so a rebind
// shows up at once. The terminal's keys are fixed in ComputerTerminal and
// SignalReviewPanel, so they're listed as they are.
// ─────────────────────────────────────────────

import { keyName } from './keyNames.js';

/**
 * @param {Record<string, string>} binds  Engine.keyBinds
 * @param {{ devTools: boolean }} opts
 * @returns {{ title: string, rows: { label: string, keys: string }[] }[]}
 */
export function controlsList(binds, { devTools }) {
  const k = (action) => keyName(binds[action]);
  const groups = [
    {
      title: 'PLAYER',
      rows: [
        { label: 'Move', keys: [k('forward'), k('left'), k('back'), k('right')].join(' ') },
        { label: 'Look', keys: 'Mouse' },
        { label: 'Jump', keys: k('jump') },
        { label: 'Crouch', keys: k('crouch') },
        { label: 'Interact', keys: k('interact') },
        { label: 'Flashlight', keys: k('flashlight') },
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
  if (devTools) {
    groups.push({
      title: 'DEVELOPER',
      rows: [
        { label: 'Collider overlay', keys: '`' },
        { label: 'Level editor', keys: 'F2' },
        { label: 'Fly camera', keys: k('debugFly') },
        { label: 'Fullbright', keys: k('fullbright') },
        { label: 'Perf stats', keys: k('perfStats') },
        { label: 'Next night', keys: k('nextNight') },
        { label: 'Model debug + reload', keys: 'F4' },
      ],
    });
  }
  return groups;
}
