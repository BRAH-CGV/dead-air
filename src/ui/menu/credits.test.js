import { describe, it, expect } from 'vitest';
import { parseAttributions, buildCreditBlocks, creditWarnings, UNATTRIBUTED_FILES } from './credits.js';

const FIXTURE = `# Attributions

Intro paragraph that is not an entry.

## How to add an entry

Open the link and record **title**, **author**, **licence**.

### Not an entry either

Skipped with its section.

## Models

### Satellite dish tower

"Space information Dish" (https://skfb.ly/oSALw) by Cybertron B-127 is
licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | \`public/assets/models/dish-tower.glb\` |

### Soap dispenser — ⚠ non-commercial license

"Retro Soap Dispenser" (https://example.test/soap) by Minh is licensed under **Creative Commons
Attribution-NonCommercial** (http://creativecommons.org/licenses/by-nc/4.0/).

**Decided: keep it.** Second paragraph, not shown.

### Radar terminal — TODO: resolve

Which of these was downloaded?

- https://skfb.ly/oNDNS

## Sounds

### Gas mask breathing

"Gas Mask Raw" by xTokioBeatlex on Pixabay (https://pixabay.com/x/), under the Pixabay Content License.

## Downloaded but unattributed — TODO

These files have no source:

- \`switchboard.glb\`, downloaded as \`switchboard_ussr.glb\` (\`model:switchboard\`)
- \`bush.glb\` (\`model:bush\`)

## Candidate links — upcoming assets

- **Power box** — https://skfb.ly/onTVS
`;

describe('parseAttributions', () => {
  const entries = parseAttributions(FIXTURE);

  it('groups entries by section, skipping the meta sections', () => {
    expect(entries.map(e => `${e.section}/${e.title}`)).toEqual([
      'Models/Satellite dish tower',
      'Models/Soap dispenser',
      'Models/Radar terminal',
      'Sounds/Gas mask breathing',
    ]);
  });

  it('takes the first paragraph as the attribution, joined onto one line', () => {
    expect(entries[0].text).toBe(
      '"Space information Dish" (https://skfb.ly/oSALw) by Cybertron B-127 is licensed under ' +
      'Creative Commons Attribution (http://creativecommons.org/licenses/by/4.0/).',
    );
  });

  it('strips bold and leaves later paragraphs out', () => {
    expect(entries[1].text).toContain('Creative Commons Attribution-NonCommercial');
    expect(entries[1].text).not.toContain('**');
    expect(entries[1].text).not.toContain('Decided');
  });

  it('extracts the URLs, and splits the text into text and link parts', () => {
    expect(entries[0].links).toEqual(['https://skfb.ly/oSALw', 'http://creativecommons.org/licenses/by/4.0/']);
    expect(entries[0].parts).toEqual([
      { text: '"Space information Dish" (' },
      { href: 'https://skfb.ly/oSALw', text: 'https://skfb.ly/oSALw' },
      { text: ') by Cybertron B-127 is licensed under Creative Commons Attribution (' },
      { href: 'http://creativecommons.org/licenses/by/4.0/', text: 'http://creativecommons.org/licenses/by/4.0/' },
      { text: ').' },
    ]);
  });

  it('keeps a ⚠ licence note from the heading', () => {
    expect(entries[1].note).toBe('⚠ non-commercial license');
  });

  it('keeps an ordinary dash in the title (Blast door — closed / open)', () => {
    const [closed, open] = parseAttributions(`## Models

### Blast door — closed

"A" by B.

### Blast door — open

"C" by D.
`);
    expect(closed.title).toBe('Blast door — closed');
    expect(open.title).toBe('Blast door — open');
    expect(closed.note).toBe(null);
  });

  it('flags TODO headings instead of dropping them', () => {
    expect(entries[2].todo).toBe(true);
    expect(entries[0].todo).toBe(false);
  });

  it('tolerates CRLF line endings', () => {
    const crlf = parseAttributions(FIXTURE.replace(/\n/g, '\r\n'));
    expect(crlf).toEqual(entries);
  });

  it('returns nothing for empty input', () => {
    expect(parseAttributions('')).toEqual([]);
  });
});

describe('creditWarnings', () => {
  it('lists TODO entries, unattributed downloads and files with no entry', () => {
    const warnings = creditWarnings(FIXTURE);
    expect(warnings).toContain('Radar terminal (source to resolve)');
    expect(warnings.some(w => w.includes('switchboard.glb'))).toBe(true);
    expect(warnings.some(w => w.includes('bush.glb'))).toBe(true);
    for (const file of UNATTRIBUTED_FILES) expect(warnings.join('\n')).toContain(file);
  });
});

describe('buildCreditBlocks', () => {
  const team = [{ name: 'Adrian Draxl', role: 'Architecture' }];
  const headings = (blocks) => blocks.map(b => b.heading);

  it('orders the sections: title, team, assets, built with, inspired by, course', () => {
    const blocks = buildCreditBlocks({ markdown: FIXTURE, team, dev: false });
    expect(headings(blocks)).toEqual([
      'DEAD AIR', 'TEAM', 'THIRD-PARTY ASSETS: MODELS', 'THIRD-PARTY ASSETS: SOUNDS',
      'BUILT WITH', 'INSPIRED BY', null,
    ]);
  });

  it('shows the team by name, without roles unless asked', () => {
    const blocks = buildCreditBlocks({ markdown: FIXTURE, team, dev: false });
    expect(blocks[1].items[0].parts[0].text).toBe('Adrian Draxl');
    const withRoles = buildCreditBlocks({ markdown: FIXTURE, team, dev: false, showRoles: true });
    expect(withRoles[1].items[0].parts[0].text).toBe('Adrian Draxl: Architecture');
  });

  it('leaves out entries whose manifest key is not in the game', () => {
    const md = `## Models

### Used prop

"A" by B.

| | |
|---|---|
| **Manifest key** | \`model:used\` |

### Unused download

"C" by D.

| | |
|---|---|
| **Manifest key** | — (downloaded, not yet wired into the manifest) |

### Dropped from the manifest

"E" by F.

| | |
|---|---|
| **Manifest key** | \`model:gone\` |

### No table at all

"G" by H.
`;
    const blocks = buildCreditBlocks({ markdown: md, team, dev: false, assetKeys: new Set(['model:used']) });
    const models = blocks.find(b => b.heading === 'THIRD-PARTY ASSETS: MODELS');
    expect(models.items.map(i => i.title)).toEqual(['Used prop', 'No table at all']);
  });

  it('reads the manifest keys of each entry', () => {
    const md = '## Models\n\n### X\n\n"X" by Y.\n\n| | |\n|---|---|\n| **Manifest key** | `model:a`, `model:b` |\n';
    expect(parseAttributions(md)[0].manifestKeys).toEqual(['model:a', 'model:b']);
  });

  it('carries each entry with its parts and note', () => {
    const models = buildCreditBlocks({ markdown: FIXTURE, team, dev: false })[2];
    expect(models.items[0].title).toBe('Satellite dish tower');
    expect(models.items[1].note).toBe('⚠ non-commercial license');
  });

  it('hides TODO entries in production, shows them as being confirmed in dev', () => {
    const prod = buildCreditBlocks({ markdown: FIXTURE, team, dev: false })[2];
    expect(prod.items.map(i => i.title)).not.toContain('Radar terminal');
    const dev = buildCreditBlocks({ markdown: FIXTURE, team, dev: true })[2];
    const todo = dev.items.find(i => i.title === 'Radar terminal');
    expect(todo.todo).toBe(true);
    expect(todo.parts[0].text).toBe('Source being confirmed');
  });

  it('lists the libraries with their licences, the inspirations and the course', () => {
    const blocks = buildCreditBlocks({ markdown: FIXTURE, team, dev: false });
    const text = (b) => b.items.map(i => i.parts.map(p => p.text).join('')).join('\n');
    expect(text(blocks.at(-3))).toContain('three.js (MIT)');
    expect(text(blocks.at(-3))).toContain('Apache-2.0');
    expect(text(blocks.at(-2))).toContain('Voices of the Void');
    expect(text(blocks.at(-1))).toContain('COMS3006A');
  });
});
