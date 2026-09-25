/**
 * Constituency layers.
 *
 * The claim at the end of milestone 7 was that a constituency layer is "a
 * source, not a subsystem". These tests are what that claim is worth: a
 * 650-unit layer loads, keys, frames, matches and exports through the same
 * registry, loader and pipeline as an eight-unit one.
 *
 * The boundaries are the ONS's May 2024 Westminster set; the results are the
 * Wikipedia list of MPs returned in July 2024. See docs/constituency-sources.md
 * for why it is the United Kingdom and not Bangladesh.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY = path.resolve(__dirname, '..', 'public', 'data', 'boundaries.json');

const UK = 'cons:GBR:CONSTITUENCY';
const ARTICLE = '2024 United Kingdom general election MPs';
const TABLE = '5';
const PARTY_COLUMN = 5;      // the 2024 affiliation; column 2 is the 2019 notional

async function open(page) {
  await page.goto('/');
  await page.waitForFunction(() => document.querySelectorAll('#countryList .crow').length > 10);
  await page.waitForSelector('#layerPanel #layerCountry');
  await page.evaluate(async () => {
    const { setTransport, clearCache } = await import('/src/import/wikipedia.js');
    clearCache();
    setTransport(async () => (await fetch('/fixtures/wikipedia/parse-uk-2024-mps.json')).json());
  });
}

/** Load the layer, read the table, set the party column, apply. */
const buildMap = (page) => page.evaluate(async ({ layer, article, table, partyCol }) => {
  const { loadLayer, unitList } = await import('/src/geo.js');
  const { state, switchLayer } = await import('/src/state.js');
  await loadLayer(layer);
  switchLayer(layer);

  const { adapterById } = await import('/src/import/adapters.js');
  const { buildProposal, applyProposal, counts } = await import('/src/import/proposal.js');

  const draft = await adapterById('wikipedia').propose({ query: 'x', lang: 'en', article, table });

  // What the guess produced, before anyone corrects it.
  const guessed = draft.columns.map((c) => c.role);

  // The correction a person makes in the review screen: the party is the 2024
  // affiliation, not the 2019 notional one sitting two columns to its left.
  draft.columns.forEach((c) => { if (c.role === 'party') c.role = 'ignore'; });
  draft.columns[partyCol].role = 'party';

  const proposal = buildProposal(draft);
  const before = counts(proposal);
  const result = applyProposal(proposal);

  const geo = await import('/src/geo.js');
  return {
    units: unitList().length,
    guessed,
    before,
    result,
    assigned: Object.keys(state.assign).length,
    parties: state.parties.filter((p) => Object.values(state.assign).some((a) => a.party === p.id))
      .map((p) => p.name),
    sampleKeys: Object.keys(state.assign).slice(0, 3),
    boundary: {
      vintage: geo.BOUNDARY.vintage,
      licence: geo.BOUNDARY.licence,
      agency: geo.BOUNDARY.sourceAgency,
      label: geo.BOUNDARY.label,
      level: geo.BOUNDARY.level
    },
    provenance: state.provenance
  };
}, { layer: UK, article: ARTICLE, table: TABLE, partyCol: PARTY_COLUMN });

/* ---------------------------------------------------------------- registry */

test('a constituency layer is a registry entry like any other', () => {
  const reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  const e = reg.sources[UK];
  expect(e, 'cons:GBR:CONSTITUENCY is not in the registry').toBeTruthy();
  expect(e.level).toBe('CONSTITUENCY');
  expect(e.units).toBe(650);
  expect(e.vintage).toBe(2024);
  expect(e.sourceAgency).toMatch(/Office for National Statistics/);
  expect(e.licence).toMatch(/Open Government Licence/);
  // The same fields every other source carries — no new shape for this level.
  for (const field of ['id', 'iso', 'level', 'units', 'licence', 'attribution', 'sourceAgency', 'url', 'file']) {
    expect(e[field], `no ${field}`).toBeTruthy();
  }
});

test('the picker offers it beside the country\'s other sources', async ({ page }) => {
  await open(page);
  const list = await page.evaluate(async () => {
    const { boundarySources } = await import('/src/geo.js');
    return (await boundarySources('GBR')).map((s) => ({ id: s.layerId, units: s.units, level: s.level }));
  });
  const cons = list.find((s) => s.id === UK);
  expect(cons).toBeTruthy();
  expect(cons.units).toBe(650);
  // Natural Earth's admin-1 for the UK is still there, unchanged.
  expect(list.some((s) => s.level === 'ADM1')).toBe(true);
});

/* ---------------------------------------------------------------- the map */

test('650 constituencies load, match and apply', async ({ page }) => {
  await open(page);
  const r = await buildMap(page);

  expect(r.units).toBe(650);

  // The guess names no party column at all. Two of this table's headers are
  // "Affiliation in notional 2019 election" and "Member returned in 2024", and
  // nothing in a header can rank one above the other — so it declines, and the
  // person picks. A guess here would produce a plausible map of the wrong year.
  expect(r.guessed).not.toContain('party');
  expect(r.guessed[0]).toBe('unit');

  // Every row matched. Both sides take their names from the same official
  // source, which is the whole reason this country was built first.
  expect(r.before.matched).toBe(650);
  expect(r.before.unmatched).toBe(0);
  expect(r.result.applied).toBe(650);
  expect(r.assigned).toBe(650);

  // Keyed by the ONS code, which carries the country in its first letter and is
  // unique across all 650 — names at this level repeat in many countries and
  // the key has to survive that.
  for (const key of r.sampleKeys) expect(key).toMatch(/^[ENSW]\d{8}$/);

  expect(r.parties).toContain('Labour');
  expect(r.parties).toContain('Conservative');
  expect(r.parties.length).toBeGreaterThan(6);
});

test('the boundary carries its own vintage, licence and agency', async ({ page }) => {
  await open(page);
  const r = await buildMap(page);

  expect(r.boundary.vintage).toBe(2024);
  expect(r.boundary.label).toBe('constituency');
  expect(r.boundary.agency).toMatch(/Office for National Statistics/);

  const line = await page.evaluate(async () => {
    const { vintageLine } = await import('/src/vintage.js');
    const geo = await import('/src/geo.js');
    return vintageLine(geo.BOUNDARY);
  });
  expect(line).toContain('representing 2024');
  expect(line).toContain('Open Government Licence');
  expect(line).toContain('Office for National Statistics');
});

test('the export carries source, licence and vintage', async ({ page }) => {
  await open(page);
  await buildMap(page);

  const out = await page.evaluate(async () => {
    const { state } = await import('/src/state.js');
    const geo = await import('/src/geo.js');
    state.fit = geo.boundsOf(geo.FEATS.map((f) => f.key), 0.06);
    state.title = 'The United Kingdom, 2024';
    state.handle = '@electionmaps';

    const { vintageLine } = await import('/src/vintage.js');
    const cv = window.__studio.composite(1600, 900);
    const ctx = cv.getContext('2d');
    const strip = ctx.getImageData(0, Math.round(cv.height * 0.86), cv.width, Math.round(cv.height * 0.1));
    let ink = 0;
    for (let i = 0; i < strip.data.length; i += 4) if (strip.data[i] > 90) ink++;
    return {
      ink,
      vintage: vintageLine(geo.BOUNDARY),
      source: state.provenance.source,
      permalink: state.provenance.cite.permalink,
      bytes: cv.toDataURL('image/png').length
    };
  });

  expect(out.bytes).toBeGreaterThan(1000);
  expect(out.source).toMatch(/MPs elected/);
  expect(out.permalink).toContain('oldid=');
  expect(out.vintage).toContain('2024');
  expect(out.ink, 'the footer should be painted').toBeGreaterThan(300);
});

/* -------------------------------------------------- what 650 rows exposed */

test('the review flags two spellings of one party', async ({ page }) => {
  await open(page);
  const warns = await page.evaluate(async ({ layer, article, table, partyCol }) => {
    const { loadLayer } = await import('/src/geo.js');
    const { switchLayer } = await import('/src/state.js');
    await loadLayer(layer);
    switchLayer(layer);

    const { adapterById } = await import('/src/import/adapters.js');
    const { buildProposal, warnings } = await import('/src/import/proposal.js');
    const draft = await adapterById('wikipedia').propose({ query: 'x', lang: 'en', article, table });
    draft.columns.forEach((c) => { if (c.role === 'party') c.role = 'ignore'; });
    draft.columns[partyCol].role = 'party';
    return warnings(buildProposal(draft)).filter((w) => w.kind === 'near-party').map((w) => w.text);
  }, { layer: UK, article: ARTICLE, table: TABLE, partyCol: PARTY_COLUMN });

  // The table writes the SNP two ways; without this the party's nine seats
  // arrive as a seven and a two, in two colours, and nobody notices at 650 rows.
  expect(warns.some((t) => /Scottish National/.test(t))).toBe(true);
  // It says they will be separate and stops there. Merging is the person's call
  // because the same rule also pairs genuinely different parties.
  for (const t of warns) expect(t).toMatch(/two separate parties/);
});

test('a table with no party column says so instead of matching quietly', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async ({ layer, article, table, partyCol }) => {
    const { loadLayer } = await import('/src/geo.js');
    const { switchLayer } = await import('/src/state.js');
    await loadLayer(layer);
    switchLayer(layer);

    const { adapterById } = await import('/src/import/adapters.js');
    const { buildProposal, warnings, counts } = await import('/src/import/proposal.js');
    const draft = await adapterById('wikipedia').propose({ query: 'x', lang: 'en', article, table });

    // Exactly as the guesser leaves it: a unit column and nothing else.
    const bare = buildProposal(draft);
    const out = {
      counts: counts(bare),
      warned: warnings(bare).filter((w) => w.kind === 'no-party').map((w) => w.text),
      samples: draft.columns.map((c) => c.sample),
      headers: draft.columns.map((c) => c.header)
    };

    draft.columns[partyCol].role = 'party';
    out.afterChoosing = warnings(buildProposal(draft)).filter((w) => w.kind === 'no-party');
    return out;
  }, { layer: UK, article: ARTICLE, table: TABLE, partyCol: PARTY_COLUMN });

  // Every count reads fine, which is the trap: matched units are not results.
  expect(r.counts.matched).toBe(650);
  expect(r.counts.unmatched).toBe(0);
  expect(r.warned.length).toBe(1);
  expect(r.warned[0]).toMatch(/stay blank/);
  expect(r.afterChoosing).toEqual([]);

  // And the person is given what they need to choose: the real header off the
  // markup, and a value out of the column. "Column 5" on its own is not a choice.
  expect(r.headers[2]).toMatch(/notional 2019/);
  expect(r.headers[PARTY_COLUMN]).toMatch(/returned in 2024/);
  expect(r.samples[PARTY_COLUMN]).toBe('Labour');
  expect(r.samples[0]).toBe('Aberafan Maesteg');
});

test('the footer pluralises the layer\'s own noun', async ({ page }) => {
  await open(page);
  const nouns = await page.evaluate(async () => {
    const { plural } = await import('/src/export.js');
    return ['constituency', 'division', 'district', 'province', 'county', 'parish', 'state']
      .map((n) => plural(n));
  });
  // "650 constituencys" was in the first constituency export.
  expect(nouns).toEqual(['constituencies', 'divisions', 'districts', 'provinces',
    'counties', 'parishes', 'states']);
});

/* ------------------------------------------------------------- vintage gap */

test('a result older than its boundaries is warned about', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const { resultsVintageWarning } = await import('/src/vintage.js');
    return {
      // 2024 results on 2024 boundaries: nothing to say.
      same: resultsVintageWarning('2024-07-04', { vintage: 2024, label: 'constituency', level: 'CONSTITUENCY' }),
      // 2017 results on the 2024 set: the seats were redrawn in between, and
      // every one of them is a unit the result only partly describes.
      older: resultsVintageWarning('2017-06-08', { vintage: 2024, label: 'constituency', level: 'CONSTITUENCY' }),
      // One year apart is within the noise of a boundary set's own dating.
      close: resultsVintageWarning('2024-01-01', { vintage: 2024, label: 'constituency', level: 'CONSTITUENCY' }),
      // No vintage stated is not the same as no gap.
      unknown: resultsVintageWarning('2017-06-08', { vintage: null, label: 'admin-1', level: 'ADM1' })
    };
  });

  expect(r.same).toBe(null);
  expect(r.close).toBe(null);
  expect(r.older).toBeTruthy();
  expect(r.older.text).toMatch(/2017/);
  expect(r.older.text).toMatch(/2024/);
  expect(r.older.text).toMatch(/redrawn|boundaries/i);
  expect(r.unknown).toBe(null);
});
