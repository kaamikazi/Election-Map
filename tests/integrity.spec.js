/**
 * Coverage integrity.
 *
 * Two milestone 7 failures share a root: the app could not tell when a map was
 * covering less territory than it claimed.
 *
 *   - the geoBoundaries render was a planet-sized blob and fourteen tests
 *     stayed green, because every one asked about names and counts and none
 *     asked how much of the Earth the map claimed
 *   - Cumilla and Faridpur stranded, and nothing said that Chattogram and Dhaka
 *     were therefore only partly described by the rows that did match
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { topology } from 'topojson-server';

import { verifyLayer, assertLayer, MAX_UNIT_AREA, MAX_LAYER_AREA } from '../scripts/lib/verify.js';
import { rewindGeometry } from '../scripts/lib/rewind.js';
import { baselineAreas } from '../scripts/lib/areas.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RAW = path.join(ROOT, 'data', 'raw', 'geoboundaries', 'BGD-ADM1.geojson');

const GB = 'gb:BGD:ADM1';
const ARTICLE = '2024 Bangladeshi general election';

/* ---------------------------------------------------------------- geometry */

const buildFrom = (features) => JSON.parse(JSON.stringify(
  topology({ units: { type: 'FeatureCollection', features } })));

test('an un-rewound layer fails the build', () => {
  // This is the exact file milestone 7 shipped broken, before rewinding.
  const geo = JSON.parse(fs.readFileSync(RAW, 'utf8'));

  const raw = buildFrom(geo.features.map((f) => ({
    type: 'Feature', properties: { name: f.properties.shapeName, id: f.properties.shapeID },
    geometry: f.geometry
  })));

  const bad = verifyLayer(raw, { units: 8 });
  expect(bad.ok, 'a counter-clockwise layer must not pass').toBe(false);
  expect(bad.problems.join(' ')).toMatch(/more than half the sphere|steradians/);
  // Every unit becomes most of the planet.
  expect(bad.total).toBeGreaterThan(MAX_LAYER_AREA);
  expect(bad.largest.area).toBeGreaterThan(MAX_UNIT_AREA);

  // And the build refuses it outright.
  expect(() => assertLayer('BGD ADM1', raw, { units: 8 }))
    .toThrow(/failed its geometry check/);
});

test('the same layer passes once rewound', () => {
  const geo = JSON.parse(fs.readFileSync(RAW, 'utf8'));
  const good = buildFrom(geo.features.map((f) => ({
    type: 'Feature', properties: { name: f.properties.shapeName, id: f.properties.shapeID },
    geometry: rewindGeometry(f.geometry)
  })));

  const check = verifyLayer(good, { units: 8 });
  expect(check.ok, check.problems.join('; ')).toBe(true);
  // Bangladesh is about 0.003 steradians, not 12.5.
  expect(check.total).toBeLessThan(0.01);
  expect(check.total).toBeGreaterThan(0.001);
});

test('a miscounted layer fails', () => {
  const geo = JSON.parse(fs.readFileSync(RAW, 'utf8'));
  const topo = buildFrom(geo.features.map((f) => ({
    type: 'Feature', properties: { name: f.properties.shapeName, id: f.properties.shapeID },
    geometry: rewindGeometry(f.geometry)
  })));

  const check = verifyLayer(topo, { units: 9 });
  expect(check.ok).toBe(false);
  expect(check.problems.join(' ')).toMatch(/claims 9 units and the file holds 8/);
});

test('every layer already on disk passes', () => {
  // Not just the ones built today. The blob shipped because nothing re-examined
  // what was already there.
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'boundaries.json'), 'utf8'));
  const ids = Object.keys(reg.sources);
  expect(ids.length).toBeGreaterThan(200);

  const failures = [];
  for (const id of ids) {
    const file = path.join(ROOT, 'public', reg.sources[id].file);
    if (!fs.existsSync(file)) { failures.push(`${id}: no file`); continue; }
    const result = verifyLayer(JSON.parse(fs.readFileSync(file, 'utf8')), { units: reg.sources[id].units });
    if (!result.ok) failures.push(`${id}: ${result.problems.join('; ')}`);
  }
  expect(failures, failures.slice(0, 5).join('\n')).toEqual([]);
});

/* ------------------------------------------------------------- area ratios */

/**
 * The absolute per-unit ceiling was calibrated on provinces, and a constituency
 * is four orders of magnitude smaller than the smallest thing it was tuned for.
 * A seat ground down to a tenth of itself is still nowhere near 0.5 sr, so the
 * ceiling cannot see it. The ratio against the source can, and it is the only
 * check standing between a constituency build and a silently degraded map.
 */
test('degradation invisible to the ceiling is caught by the ratio', () => {
  const raw = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'data', 'raw', 'constituencies', 'GBR-CONSTITUENCY.geojson'), 'utf8'));

  const features = raw.features.slice(0, 40).map((f) => ({
    type: 'Feature',
    properties: { name: f.properties.PCON24NM, id: f.properties.PCON24CD },
    geometry: rewindGeometry(f.geometry)
  }));
  const areas = baselineAreas(features);

  const clean = buildFrom(features);
  expect(verifyLayer(clean, { units: features.length, areas }).ok).toBe(true);

  // Shrink one seat towards its own centre — the shape survives, the area does
  // not. Nothing about the count, the names or the ids changes.
  const victim = features.findIndex((f) => f.geometry.type === 'Polygon');
  expect(victim, 'need a simple polygon to shrink').toBeGreaterThan(-1);
  const ring = features[victim].geometry.coordinates[0];
  const cx = ring.reduce((n, p) => n + p[0], 0) / ring.length;
  const cy = ring.reduce((n, p) => n + p[1], 0) / ring.length;
  const shrunk = features.map((f, i) => (i !== victim ? f : {
    ...f,
    geometry: {
      type: 'Polygon',
      coordinates: [ring.map(([x, y]) => [cx + (x - cx) * 0.3, cy + (y - cy) * 0.3])]
    }
  }));

  const damaged = buildFrom(shrunk);

  // The ceiling shrugs: a tenth of a constituency is still a legal area.
  const blind = verifyLayer(damaged, { units: features.length });
  expect(blind.ok, 'the absolute ceiling cannot see this').toBe(true);
  expect(blind.largest.area).toBeLessThan(MAX_UNIT_AREA);

  // The ratio does not.
  const seeing = verifyLayer(damaged, { units: features.length, areas });
  expect(seeing.ok).toBe(false);
  expect(seeing.problems.join(' ')).toMatch(new RegExp(features[victim].properties.name));
});

test('the ratio also catches a unit that grew', () => {
  // Inversion is the other direction, and the one that shipped the blob: a
  // reversed ring gains area by a factor of millions rather than losing it.
  const raw = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'data', 'raw', 'constituencies', 'GBR-CONSTITUENCY.geojson'), 'utf8'));
  const features = raw.features.slice(0, 20).map((f) => ({
    type: 'Feature',
    properties: { name: f.properties.PCON24NM, id: f.properties.PCON24CD },
    geometry: rewindGeometry(f.geometry)
  }));
  const areas = baselineAreas(features);

  const flipped = features.map((f, i) => (i !== 0 ? f : {
    ...f,
    geometry: f.geometry.type === 'Polygon'
      ? { type: 'Polygon', coordinates: f.geometry.coordinates.map((r) => r.slice().reverse()) }
      : { type: 'MultiPolygon',
          coordinates: f.geometry.coordinates.map((p) => p.map((r) => r.slice().reverse())) }
  }));

  const check = verifyLayer(buildFrom(flipped), { units: features.length, areas });
  expect(check.ok).toBe(false);
});

/* ---------------------------------------------------------------- partition */

async function open(page) {
  await page.goto('/');
  await page.waitForFunction(() => document.querySelectorAll('#countryList .crow').length > 10);
  await page.waitForSelector('#layerPanel #layerCountry');
  await page.evaluate(async () => {
    const { setTransport, clearCache } = await import('/src/import/wikipedia.js');
    clearCache();
    setTransport(async () => (await fetch('/fixtures/wikipedia/parse-bangladesh-2024.json')).json());
  });
}

/** The milestone 3 flow: load the layer, read the division tables, correct, apply. */
const runBangladesh = (page, fixes) => page.evaluate(async ({ article, layer, names }) => {
  const { loadLayer } = await import('/src/geo.js');
  const { state, switchLayer } = await import('/src/state.js');
  await loadLayer(layer);
  switchLayer(layer);

  const { adapterById } = await import('/src/import/adapters.js');
  const { buildProposal, applyProposal, setRowUnit } = await import('/src/import/proposal.js');
  const { findPartitions } = await import('/src/import/partition.js');

  const draft = await adapterById('wikipedia').propose({
    query: 'x', lang: 'en', article, table: 'family' });
  const proposal = buildProposal(draft);

  for (const row of proposal.rows) {
    const name = names[row.raw.unit];
    if (name) setRowUnit(proposal, row, proposal.index.exact.get(name));
  }

  const found = await findPartitions(proposal);
  proposal.partials = found.partials;
  const result = applyProposal(proposal);

  const { documentPartials, probeHistory } = await import('/src/import/partition.js');
  return {
    result,
    partials: found.partials.map((p) => ({
      parent: p.parentName, boundary: p.parentBoundaryName,
      excludes: p.excludes.map((e) => e.name)
    })),
    probes: probeHistory(),
    resolved: found.resolved,
    notes: documentPartials(),
    assign: Object.fromEntries(Object.entries(state.assign).map(([k, v]) => [k, v.excludes || null])),
    stranded: proposal.rows.filter((r) => !r.unit).map((r) => ({ raw: r.raw.unit, partitionOf: r.partitionOf || null }))
  };
}, { article: ARTICLE, layer: GB, names: fixes });

const EIGHT = {
  'Barishal Division': 'Barisal',
  'Chattogram Division': 'Chittagong',
  'Dhaka Division': 'Dhaka',
  'Khulna Division': 'Khulna',
  'Mymensingh Division': 'Mymensingh',
  'Rajshahi Division': 'Rajshani',
  'Rangpur Division': 'Rangpur',
  'Sylhet Division': 'Sylhet'
};

test('a stranded region makes the region it came out of partial', async ({ page }) => {
  await open(page);
  const r = await runBangladesh(page, EIGHT);

  // The eight still apply. Marking a unit partial does not withhold it.
  expect(r.result.applied).toBe(8);

  // Cumilla District is in Chattogram Division and Faridpur District is in
  // Dhaka Division — both verified against those districts' own articles, and
  // both found here by centroid containment rather than by assumption.
  //
  // The footnote speaks in the table's names throughout, so the parent is
  // "Chattogram" even though the boundary set labels that polygon "Chittagong".
  const byParent = Object.fromEntries(r.partials.map((p) => [p.parent, p.excludes]));
  expect(Object.keys(byParent).sort()).toEqual(['Chattogram', 'Dhaka']);
  expect(byParent.Chattogram).toEqual(['Cumilla']);
  expect(byParent.Dhaka).toEqual(['Faridpur']);

  // The boundary spelling is kept, in the audit record where comparing is the
  // point rather than a mixed-up sentence.
  const chattogram = r.partials.find((p) => p.parent === 'Chattogram');
  expect(chattogram.boundary).toBe('Chittagong');

  // Every resolution is recorded: the table's name, what it resolved to, and
  // the parent it landed in.
  expect(r.probes).toHaveLength(2);
  const cumilla = r.probes.find((x) => x.raw === 'Cumilla');
  expect(cumilla.resolvedName).toBe('Comilla');       // the 2020 set's spelling
  expect(cumilla.parentBoundaryName).toBe('Chittagong');
  expect(cumilla.level).toBe('ADM2');
  expect(cumilla.source).toMatch(/Bangladesh Bureau of Statistics/);

  // The stranded rows now say what they are part of.
  expect(r.stranded.every((s) => s.partitionOf)).toBe(true);

  // And it is recorded in the document, not just in the review that found it.
  const excluded = Object.values(r.assign).filter(Boolean);
  expect(excluded).toHaveLength(2);
  expect(r.notes.sort()).toEqual(['Chattogram excludes Cumilla', 'Dhaka excludes Faridpur']);
});

test('the export names what a partial unit excludes', async ({ page }) => {
  await open(page);
  await runBangladesh(page, EIGHT);

  const out = await page.evaluate(async () => {
    const { state } = await import('/src/state.js');
    const geo = await import('/src/geo.js');
    const { boundsOf } = geo;
    state.fit = boundsOf(geo.FEATS.map((f) => f.key), 0.25);
    state.title = 'Bangladesh by division, 2024';
    state.handle = '@electionmaps';

    const cv = window.__studio.composite(1600, 900);
    const ctx = cv.getContext('2d');
    // The footer grew a line; check something is painted where it goes.
    const strip = ctx.getImageData(0, Math.round(cv.height * 0.86), cv.width, Math.round(cv.height * 0.1));
    let ink = 0;
    for (let i = 0; i < strip.data.length; i += 4) if (strip.data[i] > 90) ink++;

    const { documentPartials } = await import('/src/import/partition.js');
    return { ink, notes: documentPartials() };
  });

  expect(out.notes).toHaveLength(2);
  expect(out.ink, 'the partial footnote should be painted').toBeGreaterThan(400);
});

test('no stranded rows means no partial marks and no footnote', async ({ page }) => {
  await open(page);

  // Only the eight that match. Nothing strands, so nothing is partial.
  const r = await page.evaluate(async ({ article, layer, names }) => {
    const { loadLayer } = await import('/src/geo.js');
    const { state, switchLayer } = await import('/src/state.js');
    await loadLayer(layer);
    switchLayer(layer);

    const { adapterById } = await import('/src/import/adapters.js');
    const { buildProposal, applyProposal, setRowUnit } = await import('/src/import/proposal.js');
    const { findPartitions, documentPartials } = await import('/src/import/partition.js');

    const draft = await adapterById('wikipedia').propose({
      query: 'x', lang: 'en', article, table: 'family' });
    // Drop the two rows that have nowhere to land, as though the table had
    // never carried them.
    draft.rows = draft.rows.filter((row) => names[row[0]]);
    const proposal = buildProposal(draft);
    for (const row of proposal.rows) {
      const name = names[row.raw.unit];
      if (name) setRowUnit(proposal, row, proposal.index.exact.get(name));
    }

    const found = await findPartitions(proposal);
    proposal.partials = found.partials;
    applyProposal(proposal);
    return { partials: found.partials, checked: found.checked, notes: documentPartials() };
  }, { article: ARTICLE, layer: GB, names: EIGHT });

  expect(r.partials).toEqual([]);
  expect(r.checked, 'with nothing stranded there is nothing to check').toBe(false);
  expect(r.notes).toEqual([]);
});

test('a stranded name that resolves nowhere deeper stays stranded', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async (layer) => {
    const { loadLayer } = await import('/src/geo.js');
    const { switchLayer } = await import('/src/state.js');
    await loadLayer(layer);
    switchLayer(layer);

    const { adapterById } = await import('/src/import/adapters.js');
    const { buildProposal, setRowUnit } = await import('/src/import/proposal.js');
    const { findPartitions } = await import('/src/import/partition.js');

    const draft = adapterById('clipboard').propose({
      text: 'Region\tParty\nDhaka\tA\nAtlantis\tB' });
    const proposal = buildProposal(draft);
    for (const row of proposal.rows) {
      if (row.raw.unit === 'Dhaka') setRowUnit(proposal, row, proposal.index.exact.get('Dhaka'));
    }
    const found = await findPartitions(proposal);
    return { partials: found.partials, resolved: found.resolved };
  }, GB);

  // Nothing at any depth is called Atlantis, so nothing is claimed about it.
  expect(r.partials).toEqual([]);
  expect(r.resolved).toEqual([]);
});

/* ---------------------------------------------------------------- vintage */

test('a null vintage says so rather than going quiet', async ({ page }) => {
  await open(page);
  const lines = await page.evaluate(async () => {
    const { vintageLine } = await import('/src/vintage.js');
    return {
      stated: vintageLine({ sourceAgency: 'geoBoundaries', label: 'Division', vintage: 2015, licence: 'CC0' }),
      unstated: vintageLine({ sourceAgency: 'Natural Earth', label: 'admin-1', vintage: null, licence: 'Public domain' }),
      none: vintageLine(null)
    };
  });

  expect(lines.stated).toContain('representing 2015');
  // Dropping the clause would read as though there were nothing to say about
  // the vintage, rather than that the source declines to state one.
  expect(lines.unstated).toContain('year not stated');
  expect(lines.unstated).toContain('Natural Earth');
  expect(lines.unstated).toContain('Public domain');
  // The world outline is a schematic; it claims nothing at all.
  expect(lines.none).toBe('');
});
