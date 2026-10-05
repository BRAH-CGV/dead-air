// ─────────────────────────────────────────────
// credits  –  ATTRIBUTIONS.md → the credits screen (pure)
// ─────────────────────────────────────────────
// ATTRIBUTIONS.md is the source of truth for non-original work, so the
// credits are parsed from it rather than copied: a new entry there shows up
// in game on the next build. The format:
//
//   ## Section            → a group ("Models", "Sounds")
//   ### Heading           → one entry; "— ⚠ …" keeps the licence note,
//                           "— TODO …" marks a source still being confirmed
//   first paragraph       → the attribution sentence: title, source, author,
//                           licence and licence URL — what CC BY asks for
//   | **File** | … |      → internal bookkeeping, not shown — except the
//                           Manifest key row: an entry whose key isn't in
//                           the manifest isn't in the game, so it's left out
//                           (removing an asset drops it from the credits)
//
// Meta sections (how to add an entry, unattributed downloads, candidate
// links) are skipped. TODO entries are never silently dropped: they show as
// "Source being confirmed" in dev builds and in the dev console warning.
// ─────────────────────────────────────────────

import { BUILT_WITH, INSPIRED_BY, COURSE_LINE, COPY } from './text.js';

/** Sections that aren't credits, matched on the heading's start. */
const SKIP_SECTIONS = ['How to add an entry', 'Downloaded but unattributed', 'Candidate links'];
const UNATTRIBUTED_SECTION = 'Downloaded but unattributed';

/** Shipped files with no ATTRIBUTIONS.md entry and no known source. Not
 *  credited (no source is invented), only warned about in dev. */
export const UNATTRIBUTED_FILES = [
  'public/assets/textures/floor-basecolor.png',
  'public/assets/textures/floor-normal.png',
  'public/assets/signals/signal-1.png … signal-8.png',
];

const URL_RE = /https?:\/\/[^\s)]+/g;

/** `text` → alternating text and link parts. */
function toParts(text) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ href: match[0], text: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** Split markdown into `## ` sections: [{ name, lines }]. */
function sections(markdown) {
  const out = [];
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.startsWith('## ')) out.push({ name: line.slice(3).trim(), lines: [] });
    else out.at(-1)?.lines.push(line);
  }
  return out;
}

/**
 * @param {string} markdown  ATTRIBUTIONS.md
 * @returns {{ section: string, title: string, note: string|null, todo: boolean,
 *             text: string, links: string[], parts: ({text: string}|{href: string, text: string})[] }[]}
 */
export function parseAttributions(markdown) {
  const entries = [];
  for (const { name, lines } of sections(markdown ?? '')) {
    if (SKIP_SECTIONS.some(skip => name.startsWith(skip))) continue;

    let entry = null;
    let keys = null;        // the entry's Manifest key row, if it has one
    let paragraph = null;   // null: not started; []: collecting; done once a blank line ends it
    let done = false;
    const finish = () => {
      if (!entry) return;
      const text = (paragraph ?? []).join(' ').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
      entries.push({ ...entry, manifestKeys: keys, text, links: text.match(URL_RE) ?? [], parts: toParts(text) });
    };

    for (const line of lines) {
      if (line.startsWith('### ')) {
        finish();
        const heading = line.slice(4).trim();
        // "Title — ⚠ licence note" and "Title — TODO: …" carry a tail worth
        // splitting off; any other dash is part of the title ("Blast door — open").
        const cut = heading.indexOf(' — ');
        const tail = cut === -1 ? '' : heading.slice(cut + 3).trim();
        const special = tail.includes('⚠') || tail.startsWith('TODO');
        entry = {
          section: name,
          title: special ? heading.slice(0, cut).trim() : heading,
          note: tail.includes('⚠') ? tail : null,
          todo: /TODO/.test(heading),
        };
        paragraph = null;
        done = false;
        keys = null;
        continue;
      }
      const keyRow = /^\|\s*\*\*Manifest key\*\*\s*\|(.*)\|\s*$/.exec(line.trim());
      if (entry && keyRow) {
        keys = [...keyRow[1].matchAll(/`([^`]+)`/g)].map(m => m[1]);
        continue;
      }
      if (!entry || done) continue;
      const trimmed = line.trim();
      if (!trimmed) {
        if (paragraph) done = true;
        continue;
      }
      // A table or a list straight after the heading: no attribution sentence.
      if (!paragraph && (trimmed.startsWith('|') || trimmed.startsWith('- '))) { done = true; continue; }
      (paragraph ??= []).push(trimmed);
    }
    finish();
  }
  return entries;
}

/** What the credits can't vouch for yet, for the dev console: TODO entries,
 *  downloads listed with no source, and shipped files with no entry. */
export function creditWarnings(markdown) {
  const warnings = parseAttributions(markdown)
    .filter(e => e.todo)
    .map(e => `${e.title} (source to resolve)`);
  for (const { name, lines } of sections(markdown ?? '')) {
    if (!name.startsWith(UNATTRIBUTED_SECTION)) continue;
    for (const line of lines) {
      if (line.trim().startsWith('- ')) warnings.push(`${line.trim().slice(2).replace(/`/g, '')} (downloaded, no source)`);
    }
  }
  for (const file of UNATTRIBUTED_FILES) warnings.push(`${file} (no ATTRIBUTIONS.md entry)`);
  return warnings;
}

/**
 * The credits screen's blocks, in order: title, team, third-party assets by
 * section, built with, inspired by, the course line.
 * @param {object} opts
 * @param {string} opts.markdown  ATTRIBUTIONS.md
 * @param {{ name: string, role?: string }[]} opts.team
 * @param {boolean} opts.dev  Dev build: unconfirmed entries show as such
 * @param {boolean} [opts.showRoles]
 * @param {Set<string>} [opts.assetKeys]  Manifest keys in the game. An entry
 *        naming keys, none of them here, isn't credited (not in the game).
 * @returns {{ heading: string|null, items: object[] }[]}
 */
export function buildCreditBlocks({ markdown, team, dev, showRoles = false, assetKeys = null }) {
  const blocks = [
    { heading: COPY.title, items: [] },
    { heading: 'TEAM', items: team.map(m => ({ parts: [{ text: showRoles && m.role ? `${m.name}: ${m.role}` : m.name }] })) },
  ];
  const inGame = (entry) => !assetKeys || entry.manifestKeys === null
    || entry.manifestKeys.some(k => assetKeys.has(k));

  const bySection = new Map();
  for (const entry of parseAttributions(markdown)) {
    if (entry.todo && !dev) continue;
    if (!entry.todo && !inGame(entry)) continue;
    const item = entry.todo
      ? { title: entry.title, parts: [{ text: 'Source being confirmed' }], todo: true }
      : { title: entry.title, parts: entry.parts, note: entry.note };
    if (!bySection.has(entry.section)) bySection.set(entry.section, []);
    bySection.get(entry.section).push(item);
  }
  for (const [section, items] of bySection) {
    blocks.push({ heading: `THIRD-PARTY ASSETS: ${section.toUpperCase()}`, items });
  }

  blocks.push({
    heading: 'BUILT WITH',
    items: BUILT_WITH.map(lib => ({ parts: [{ text: `${lib.name} (${lib.licence}) ` }, { href: lib.url, text: lib.url }] })),
  });
  blocks.push({
    heading: 'INSPIRED BY',
    items: [{ parts: [{ text: `${INSPIRED_BY.join(' and ')}. Inspirations, not assets used.` }] }],
  });
  blocks.push({ heading: null, items: [{ parts: [{ text: COURSE_LINE }] }] });
  return blocks;
}
