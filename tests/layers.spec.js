/**
 * Boundary layers and the source registry.
 *
 * The finding this milestone comes from: Natural Earth's admin-1 has seven
 * Bangladeshi divisions and there have been eight since Mymensingh split from
 * Dhaka in 2015. A boundary set is not a constant — it has a source, a vintage
 * and a licence, and all three vary by country and by level.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY = path.resolve(__dirname, '..', 'public', 'data', 'boundaries.json');

const NE = 'ne:BGD:ADM1';
const GB = 'gb:BGD:ADM1';
const GB2 = 'gb:BGD:ADM2';
const ARTICLE = '2024 Bangladeshi general election';

async function open(page) {
  await page.goto('/');
  await page.waitForFunction(() => document.querySelectorAll('#countryList .crow').length > 10);
  await page.waitForSelector('#layerPanel #layerCountry');
}

async function useFixture(page) {
  await page.evaluate(async () => {
    const { setTransport, clearCache } = await import('/src/import/wikipedia.js');
    clearCache();
    setTransport(async () => (await fetch('/fixtures/wikipedia/parse-bangladesh-2024.json')).json());
  });
}

const activate = (page, id) => page.evaluate(async (layer) => {
  const { loadLayer } = await import('/src/geo.js');
  const { switchLayer } = await import('/src/state.js');
  await loadLayer(layer);
  switchLayer(layer);
}, id);

/* ---------------------------------------------------------------- registry */

test('the registry records a source, a vintage and a licence per boundary', () => {
  const reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));

  for (const id of [NE, GB, GB2]) {
    const e = reg.sources[id];
    expect(e, `${id} is not in the registry`).toBeTruthy();
    for (const field of ['id', 'iso', 'level', 'units', 'licence', 'attribution', 'sourceAgency', 'url']) {
      expect(e[field], `${id} has no ${field}`).toBeTruthy();
    }
    expect(e).toHaveProperty('vintage');   // null is an answer; missing is not
  }

  // The finding, as data.
  expect(reg.sources[NE].units).toBe(7);
  expect(reg.sources[GB].units).toBe(8);
  expect(reg.sources[GB2].units).toBe(64);

  // Natural Earth states no year, so it claims none rather than inventing one.
  expect(reg.sources[NE].vintage).toBe(null);
  expect(reg.sources[GB].vintage).toBe(2015);
  expect(reg.sources[GB2].vintage).toBe(2020);
});

test('licence is per boundary, not per source', () => {
  const reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  // The same country at two levels, under two different licences. There is no
  // single attribution line that covers a map using both.
  expect(reg.sources[GB].licence).toMatch(/CC0/);
  expect(reg.sources[GB2].licence).toMatch(/CC BY 3\.0 IGO/);
  expect(reg.sources[GB].licence).not.toBe(reg.sources[GB2].licence);

  expect(reg.sources[GB].sourceAgency).toMatch(/Wikimedia/);
  expect(reg.sources[GB2].sourceAgency).toMatch(/Bangladesh Bureau of Statistics/);
});

test('geoBoundaries has the eighth division Natural Earth is missing', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async ({ ne, gb }) => {
    const { loadLayer, unitList } = await import('/src/geo.js');
    await loadLayer(ne);
    const neNames = unitList().map((u) => u.name);
    await loadLayer(gb);
    const gbNames = unitList().map((u) => u.name);
    return { neNames, gbNames };
  }, { ne: NE, gb: GB });

  expect(r.neNames).toHaveLength(7);
  expect(r.gbNames).toHaveLength(8);
  expect(r.neNames).not.toContain('Mymensingh');
  expect(r.gbNames).toContain('Mymensingh');
});

test('ADM2 is 64 districts', async ({ page }) => {
  await open(page);
  const n = await page.evaluate(async (id) => {
    const { loadLayer, unitList } = await import('/src/geo.js');
    await loadLayer(id);
    return unitList().length;
  }, GB2);
  expect(n).toBe(64);
});

test('a country offers every source it has, newest first', async ({ page }) => {
  await open(page);
  const list = await page.evaluate(async () => {
    const { boundarySources } = await import('/src/geo.js');
    return (await boundarySources('BGD')).map((s) => ({ id: s.layerId, units: s.units, vintage: s.vintage }));
  });

  expect(list.length).toBeGreaterThanOrEqual(3);
  // Newest first, and the older frozen set is still there — it is what makes an
  // export reproducible.
  expect(list[0].vintage).toBe(2020);
  expect(list.map((s) => s.id)).toContain(NE);
  const years = list.map((s) => s.vintage || 0);
  expect(years).toEqual([...years].sort((a, b) => b - a));
});

/* ---------------------------------------------------------------- migration */

test('milestone 3 aliases survive the key migration', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const { migrateLayerId, migrateLayerKeys, migrate } = await import('/src/state.js');

    // What milestone 3 wrote, by hand, one division at a time.
    const old = { 'admin1:BGD': { 'barishal division': 'BGD-2475' }, world: { uk: 'United Kingdom' } };

    const doc = migrate({
      version: 4, layer: 'admin1:BGD', aliases: old,
      layerAssign: { 'admin1:BGD': { assign: { 'BGD-2475': { party: 1 } }, provenance: null } },
      assign: {}, parties: []
    });

    return {
      id: migrateLayerId('admin1:BGD'),
      untouched: migrateLayerId('gb:BGD:ADM1'),
      keys: Object.keys(migrateLayerKeys(old)),
      docLayer: doc.layer,
      docAlias: doc.aliases['ne:BGD:ADM1'],
      docAssign: Object.keys(doc.layerAssign),
      worldKept: doc.aliases.world
    };
  });

  expect(r.id).toBe('ne:BGD:ADM1');
  expect(r.untouched).toBe('gb:BGD:ADM1');
  expect(r.keys).toEqual(['ne:BGD:ADM1', 'world']);
  expect(r.docLayer).toBe('ne:BGD:ADM1');
  expect(r.docAlias, 'the hand-typed correction was orphaned').toEqual({ 'barishal division': 'BGD-2475' });
  expect(r.docAssign).toEqual(['ne:BGD:ADM1']);
  expect(r.worldKept).toEqual({ uk: 'United Kingdom' });
});

test('aliases in storage are rewritten to the new keys', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem(
    'election-map-studio.aliases',
    JSON.stringify({ 'admin1:BGD': { 'chattogram division': 'BGD-2476' } })));
  await open(page);

  const r = await page.evaluate(async () => {
    const { state } = await import('/src/state.js');
    return {
      aliases: state.aliases,
      stored: JSON.parse(localStorage.getItem('election-map-studio.aliases'))
    };
  });

  expect(r.aliases['ne:BGD:ADM1']).toEqual({ 'chattogram division': 'BGD-2476' });
  expect(r.aliases['admin1:BGD']).toBeUndefined();
  // And rewritten in place, so the next session does not migrate again.
  expect(r.stored['ne:BGD:ADM1']).toBeTruthy();
});

/* ---------------------------------------------------------------- model */

test('switching layers keeps both layers work', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async (gb) => {
    const { state, toggleCountry, switchLayer, layerCounts } = await import('/src/state.js');
    const { loadLayer } = await import('/src/geo.js');

    toggleCountry('France');
    toggleCountry('Germany');
    await loadLayer(gb);
    switchLayer(gb);
    const onProvinces = Object.keys(state.assign).length;
    const counts = layerCounts();
    switchLayer('world');
    return { onProvinces, counts, worldAfter: Object.keys(state.assign).length };
  }, GB);

  expect(r.onProvinces).toBe(0);
  expect(r.counts.world).toBe(2);
  expect(r.worldAfter, 'switching back must return the map that was there').toBe(2);
});

test('two sources for one country keep separate assignments', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async ({ ne, gb }) => {
    const { state, toggleCountry, switchLayer, layerCounts } = await import('/src/state.js');
    const { loadLayer, FEATS } = await import('/src/geo.js');

    await loadLayer(ne);
    switchLayer(ne);
    const geo = await import('/src/geo.js');
    toggleCountry(geo.FEATS[0].key);

    await loadLayer(gb);
    switchLayer(gb);
    const gbEmpty = Object.keys(state.assign).length;
    toggleCountry(geo.FEATS[0].key);
    toggleCountry(geo.FEATS[1].key);

    return { gbEmpty, counts: layerCounts() };
  }, { ne: NE, gb: GB });

  // Same country, different unit sets: they cannot share an assignment map.
  expect(r.gbEmpty).toBe(0);
  expect(r.counts[NE]).toBe(1);
  expect(r.counts[GB]).toBe(2);
});

/* ---------------------------------------------------------------- vintage */

test('the vintage line names the real year, licence and agency', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async ({ ne, gb, gb2 }) => {
    const { loadLayer } = await import('/src/geo.js');
    const { vintageLine } = await import('/src/vintage.js');
    const geo = await import('/src/geo.js');

    const world = vintageLine(geo.BOUNDARY);
    await loadLayer(ne); const neLine = vintageLine(geo.BOUNDARY);
    await loadLayer(gb); const gbLine = vintageLine(geo.BOUNDARY);
    await loadLayer(gb2); const gb2Line = vintageLine(geo.BOUNDARY);
    return { world, neLine, gbLine, gb2Line };
  }, { ne: NE, gb: GB, gb2: GB2 });

  // The world outline is a schematic and claims nothing.
  expect(r.world).toBe('');

  // No invented year where the source states none.
  expect(r.neLine).toContain('Natural Earth');
  expect(r.neLine).toContain('year not stated');
  expect(r.neLine).not.toMatch(/representing \d{4}/);

  expect(r.gbLine).toContain('representing 2015');
  expect(r.gbLine).toContain('CC0');
  expect(r.gbLine).toContain('geoBoundaries');

  // Different level, different licence, and the line says so.
  expect(r.gb2Line).toContain('representing 2020');
  expect(r.gb2Line).toContain('CC BY 3.0 IGO');
  expect(r.gb2Line).toContain('Bangladesh Bureau of Statistics');
});

test('a border-change warning names both years', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const { boundaryWarnings } = await import('/src/vintage.js');
    return {
      onDated: boundaryWarnings('1977-01-01', ['Germany'], { vintage: 2015 }),
      onUndated: boundaryWarnings('1977-01-01', ['Germany'], { vintage: null }),
      after: boundaryWarnings('1995-01-01', ['Germany'], { vintage: 2015 })
    };
  });

  // The registry says what year the boundary represents; the table says when
  // the border moved. The warning is sharper for naming both.
  expect(r.onDated[0].what).toMatch(/two states/);
  expect(r.onDated[0].what).toMatch(/dated 1977/);
  expect(r.onDated[0].what).toMatch(/representing 2015/);
  expect(r.onDated[0].drawnOn).toBe(2015);

  expect(r.onUndated[0].what).toMatch(/present-day boundaries/);
  expect(r.after).toHaveLength(0);
});

test('a map using two licences names both', async ({ page }) => {
  await open(page);
  const lines = await page.evaluate(async () => {
    const { attributionLines } = await import('/src/vintage.js');
    return attributionLines([
      { attribution: 'A boundaries: X (CC0)' },
      { attribution: 'B boundaries: Y (CC BY 3.0 IGO)' },
      { attribution: 'A boundaries: X (CC0)' },
      null
    ]);
  });
  expect(lines).toHaveLength(2);
  expect(lines[0]).toMatch(/CC0/);
  expect(lines[1]).toMatch(/CC BY/);
});

/* ---------------------------------------------------------------- acceptance */

test('Bangladesh on geoBoundaries: eight of ten tables can land', async ({ page }) => {
  await open(page);
  await useFixture(page);
  await activate(page, GB);

  const r = await page.evaluate(async (article) => {
    const { adapterById } = await import('/src/import/adapters.js');
    const { buildProposal, applyProposal, setRowUnit, counts } = await import('/src/import/proposal.js');
    const { state } = await import('/src/state.js');

    const draft = await adapterById('wikipedia').propose({
      query: 'x', lang: 'en', article, table: 'family' });
    const proposal = buildProposal(draft);
    const before = counts(proposal);

    // Take the top suggestion for each, exactly as the keyboard path does, but
    // only where the suggestion is actually that division rather than a
    // nearest-looking stranger.
    const REAL = {
      'Barishal Division': 'Barisal',
      'Chattogram Division': 'Chittagong',
      'Dhaka Division': 'Dhaka',
      'Khulna Division': 'Khulna',
      'Mymensingh Division': 'Mymensingh',
      'Rajshahi Division': 'Rajshani',
      'Rangpur Division': 'Rangpur',
      'Sylhet Division': 'Sylhet'
    };
    for (const row of proposal.rows) {
      const name = REAL[row.raw.unit];
      if (name) setRowUnit(proposal, row, proposal.index.exact.get(name));
    }

    const result = applyProposal(proposal);
    return {
      before,
      result,
      tops: Object.fromEntries(proposal.rows.map((r) => [r.raw.unit, (r.candidates || [])[0] || null])),
      stranded: proposal.rows.filter((r) => !r.unit).map((r) => r.raw.unit),
      assigned: Object.keys(state.assign).length,
      aliases: state.aliases['gb:BGD:ADM1']
    };
  }, ARTICLE);

  // Nothing matched itself: "Barishal Division" is not "Barisal", and the
  // rules do not loosen just because the list is long.
  expect(r.before.matched).toBe(0);
  expect(r.before.unmatched).toBe(10);

  // Eight land. Mymensingh now has somewhere to go, which it did not before.
  expect(r.result.applied).toBe(8);
  expect(r.assigned).toBe(8);
  expect(r.tops['Mymensingh Division']).toBe('Mymensingh');

  // Cumilla and Faridpur are election-commission groupings, not divisions.
  // There is no boundary for them in either source, and the honest outcome is
  // that they stay off the map.
  expect(r.stranded.sort()).toEqual(['Cumilla Division', 'Faridpur Division']);

  // Learned against this source's key, not the other one's.
  expect(r.aliases['mymensingh division']).toBeTruthy();
});

test('corrections learned on one source do not leak to the other', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async ({ ne, gb }) => {
    const { learnAlias, buildIndex, matchUnit, scopeKey } = await import('/src/import/match.js');
    const { loadLayer, unitList } = await import('/src/geo.js');

    await loadLayer(gb);
    const gbIndex = buildIndex(unitList());
    learnAlias(scopeKey(gb), 'Mymensingh Division', gbIndex.exact.get('Mymensingh'));

    await loadLayer(ne);
    const neIndex = buildIndex(unitList());
    return {
      onGb: matchUnit('Mymensingh Division', gbIndex, scopeKey(gb)).how,
      onNe: matchUnit('Mymensingh Division', neIndex, scopeKey(ne)).unit
    };
  }, { ne: NE, gb: GB });

  expect(r.onGb).toBe('learned');
  // Natural Earth has no Mymensingh, so the alias is meaningless there and
  // must not resolve to the nearest thing.
  expect(r.onNe).toBe(null);
});
