/**
 * Results that predate their boundaries.
 *
 * Milestone 9 proved a constituency map can be built. This proves the app knows
 * when not to build one. The case is the 2019 Westminster results on the 2024
 * seats, and the reason it needs a test rather than a warning is in
 * docs/vintage-stress.md: 439 of 651 rows match by name, nothing strands, and
 * every matched unit colours in looking completely ordinary.
 */

import { test, expect } from '@playwright/test';

const UK = 'cons:GBR:CONSTITUENCY';
const A2019 = 'List of MPs elected in the 2019 United Kingdom general election';
const A2024 = '2024 United Kingdom general election MPs';

async function open(page, fixture) {
  await page.goto('/');
  await page.waitForFunction(() => document.querySelectorAll('#countryList .crow').length > 10);
  await page.waitForSelector('#layerPanel #layerCountry');
  await page.evaluate(async (f) => {
    const { setTransport, clearCache } = await import('/src/import/wikipedia.js');
    clearCache();
    setTransport(async () => (await fetch(f)).json());
    const { loadLayer } = await import('/src/geo.js');
    const { switchLayer } = await import('/src/state.js');
    await loadLayer('cons:GBR:CONSTITUENCY');
    switchLayer('cons:GBR:CONSTITUENCY');
  }, fixture);
}

/* ------------------------------------------------------- dating the results */

test('a result is dated by its election, not by when it was downloaded', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const { electionYearFromTitle } = await import('/src/import/adapters.js');
    return {
      plain: electionYearFromTitle('2024 Bangladeshi general election'),
      buried: electionYearFromTitle(
        'List of MPs elected in the 2019 United Kingdom general election'),
      // Two years is not an answer, it is two answers.
      range: electionYearFromTitle('Members of the 2019–2024 Parliament'),
      none: electionYearFromTitle('Politics of Wales'),
      silly: electionYearFromTitle('List of 12345 things')
    };
  });

  expect(r.plain).toBe(2024);
  expect(r.buried).toBe(2019);
  expect(r.range).toBe(null);
  expect(r.none).toBe(null);
  expect(r.silly).toBe(null);
});

test('the fetch date is kept, and is not the results date', async ({ page }) => {
  await open(page, '/fixtures/wikipedia/parse-uk-2019-mps.json');
  const p = await page.evaluate(async () => {
    const { adapterById } = await import('/src/import/adapters.js');
    const d = await adapterById('wikipedia').propose({
      query: 'x', lang: 'en',
      article: 'List of MPs elected in the 2019 United Kingdom general election', table: '4' });
    return { asOf: d.source.asOf, fetchedAt: d.source.fetchedAt, precision: d.source.asOfPrecision };
  });

  expect(p.asOf.slice(0, 4)).toBe('2019');
  expect(p.precision).toBe('year');
  // Reading a 2019 article today does not make it a result from today. Before
  // this split, the boundary comparison ran on the download date.
  expect(p.fetchedAt.slice(0, 4)).not.toBe('2019');
});

/* --------------------------------------------------------------- the block */

test('2019 results do not apply to 2024 boundaries', async ({ page }) => {
  await open(page, '/fixtures/wikipedia/parse-uk-2019-mps.json');
  const r = await page.evaluate(async ({ article }) => {
    const { adapterById } = await import('/src/import/adapters.js');
    const { buildProposal, applyProposal, counts } = await import('/src/import/proposal.js');
    const { findPartitions } = await import('/src/import/partition.js');
    const { state } = await import('/src/state.js');

    const draft = await adapterById('wikipedia').propose({
      query: 'x', lang: 'en', article, table: '4' });
    // The 2019 winner's affiliation, chosen the way a person would.
    const party = draft.columns.findIndex((c) => /^(Labour|Conservative)/.test(c.sample || ''));
    draft.columns[party].role = 'party';

    const proposal = buildProposal(draft);
    const before = counts(proposal);
    proposal.partials = (await findPartitions(proposal)).partials;

    const result = applyProposal(proposal);
    return {
      matched: before.matched,
      unmatched: before.unmatched,
      partials: proposal.partials.length,
      result,
      assigned: Object.keys(state.assign).length
    };
  }, { article: A2019 });

  // This is the shape of the danger: hundreds of rows match cleanly by name.
  expect(r.matched).toBeGreaterThan(400);

  // And milestone 8's partial machinery sees none of it, because it only ever
  // examines rows that failed, and these did not fail.
  expect(r.partials).toBe(0);

  // So nothing is applied and nothing is on the map.
  expect(r.result.applied).toBe(0);
  expect(r.assigned).toBe(0);
  expect(r.result.blocked).toBeTruthy();
  expect(r.result.blocked.resultsYear).toBe(2019);
  expect(r.result.blocked.boundaryVintage).toBe(2024);
  expect(r.result.blocked.text).toMatch(/may not have kept its ground/);
});

test('the same results apply when someone says to, and the map says so', async ({ page }) => {
  await open(page, '/fixtures/wikipedia/parse-uk-2019-mps.json');
  const r = await page.evaluate(async ({ article }) => {
    const { adapterById } = await import('/src/import/adapters.js');
    const { buildProposal, applyProposal } = await import('/src/import/proposal.js');
    const { state } = await import('/src/state.js');

    const draft = await adapterById('wikipedia').propose({
      query: 'x', lang: 'en', article, table: '4' });
    const party = draft.columns.findIndex((c) => /^(Labour|Conservative)/.test(c.sample || ''));
    draft.columns[party].role = 'party';

    const result = applyProposal(buildProposal(draft), { acceptVintageGap: true });

    const geo = await import('/src/geo.js');
    state.fit = geo.boundsOf(geo.FEATS.map((f) => f.key), 0.06);
    state.handle = '@electionmaps';
    const cv = window.__studio.composite(1600, 900);

    return {
      result,
      assigned: Object.keys(state.assign).length,
      override: state.provenance.vintageOverride,
      bytes: cv.toDataURL('image/png').length
    };
  }, { article: A2019 });

  expect(r.result.applied).toBeGreaterThan(400);
  expect(r.assigned).toBeGreaterThan(400);

  // The override travels with the map, because the person who sees the map is
  // not the person who ticked the box.
  expect(r.override).toBeTruthy();
  expect(r.override.resultsYear).toBe(2019);
  expect(r.override.boundaryVintage).toBe(2024);
  expect(r.bytes).toBeGreaterThan(1000);
});

test('the override is a choice, not a setting that sticks', async ({ page }) => {
  await open(page, '/fixtures/wikipedia/parse-uk-2019-mps.json');
  const r = await page.evaluate(async ({ article }) => {
    const { adapterById } = await import('/src/import/adapters.js');
    const { buildProposal, applyProposal } = await import('/src/import/proposal.js');

    const draft = await adapterById('wikipedia').propose({
      query: 'x', lang: 'en', article, table: '4' });
    const party = draft.columns.findIndex((c) => /^(Labour|Conservative)/.test(c.sample || ''));
    draft.columns[party].role = 'party';

    const once = applyProposal(buildProposal(draft), { acceptVintageGap: true });
    // A second import, with nothing said about vintage, is blocked again.
    const twice = applyProposal(buildProposal(draft));
    return { once: once.applied, twice: twice.applied, blocked: !!twice.blocked };
  }, { article: A2019 });

  expect(r.once).toBeGreaterThan(400);
  expect(r.twice).toBe(0);
  expect(r.blocked).toBe(true);
});

test('results that match their boundaries are not blocked', async ({ page }) => {
  await open(page, '/fixtures/wikipedia/parse-uk-2024-mps.json');
  const r = await page.evaluate(async ({ article }) => {
    const { adapterById } = await import('/src/import/adapters.js');
    const { buildProposal, applyProposal, vintageBlock } = await import('/src/import/proposal.js');
    const draft = await adapterById('wikipedia').propose({
      query: 'x', lang: 'en', article, table: '5' });
    draft.columns[5].role = 'party';
    const proposal = buildProposal(draft);
    const result = applyProposal(proposal);
    const { state } = await import('/src/state.js');
    return {
      block: vintageBlock(proposal),
      applied: result.applied,
      override: state.provenance.vintageOverride,
      asOf: state.provenance.asOf
    };
  }, { article: A2024 });

  expect(r.block).toBe(null);
  expect(r.applied).toBe(650);
  // Nothing was overridden, so the map carries no caveat it did not earn.
  expect(r.override).toBe(null);
  expect(r.asOf.slice(0, 4)).toBe('2024');
});

test('newer results on older boundaries are warned about, not blocked', async ({ page }) => {
  // The opposite gap fails loudly: the seats that voted are missing from the
  // map, so the rows go unmatched and the review shows it. Silence earns a
  // block; a visible failure does not need one.
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const { vintageBlock } = await import('/src/import/proposal.js');
    const { resultsVintageWarning } = await import('/src/vintage.js');
    const old = { vintage: 2015, label: 'Division', level: 'ADM1' };
    return {
      block: vintageBlock({ source: { asOf: '2024-01-07' } }, old),
      warn: resultsVintageWarning('2024-01-07', old)
    };
  });

  expect(r.block).toBe(null);
  expect(r.warn).toBeTruthy();
  expect(r.warn.kind).toBe('vintage-old-boundaries');
});

test('a source with no date blocks nothing', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const { vintageBlock } = await import('/src/import/proposal.js');
    const cons = { vintage: 2024, label: 'constituency', level: 'CONSTITUENCY' };
    return {
      undated: vintageBlock({ source: { asOf: null } }, cons),
      noVintage: vintageBlock({ source: { asOf: '2019-01-01' } }, { vintage: null, label: 'x' }),
      // A pasted table never claims a date, so it is never blocked on one.
      clipboardish: vintageBlock({ source: { kind: 'clipboard', asOf: null } }, cons)
    };
  });
  // Not blocking is right here, and it is not the same as saying there is no
  // gap: an undated source is a source that cannot be checked, and the footer
  // says "year not stated" rather than inventing one.
  expect(r.undated).toBe(null);
  expect(r.noVintage).toBe(null);
  expect(r.clipboardish).toBe(null);
});

/* ------------------------------------------------ the generalised refusal */

test('two columns claiming one role means neither gets it', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const { parseTable, guessColumns } = await import('/src/import/parse.js');

    // The trap, in its general form: last time's number beside this time's.
    const twice = parseTable(
      'Region\tParty\tVotes 2019\tVotes 2024\nPraha\tSpolu\t28.4\t31.9');
    const once = parseTable('Region\tParty\tVotes\tTurnout\nPraha\tSpolu\t28.4\t62.1');

    return {
      contested: guessColumns(twice.rows).columns.map((c) => ({ r: c.role, c: !!c.contested })),
      clean: guessColumns(once.rows).columns.map((c) => c.role),
      samples: guessColumns(twice.rows).columns.map((c) => c.sample)
    };
  });

  // Both vote columns refuse; the unambiguous ones are untouched.
  expect(r.contested[0]).toEqual({ r: 'unit', c: false });
  expect(r.contested[1]).toEqual({ r: 'party', c: false });
  expect(r.contested[2]).toEqual({ r: 'ignore', c: true });
  expect(r.contested[3]).toEqual({ r: 'ignore', c: true });

  // A table with one of each still guesses, because there is nothing to be
  // ambiguous about. Refusing everything would be its own kind of useless.
  expect(r.clean).toEqual(['unit', 'party', 'vote', 'turnout']);

  // And every column carries a value, not just the ones on a constituency map.
  expect(r.samples[0]).toBe('Praha');
  expect(r.samples[2]).toBe('28.4');
});

test('the 2019 MPs table lands in the same trap as the 2024 one', async ({ page }) => {
  await open(page, '/fixtures/wikipedia/parse-uk-2019-mps.json');
  const cols = await page.evaluate(async ({ article }) => {
    const { adapterById } = await import('/src/import/adapters.js');
    const d = await adapterById('wikipedia').propose({
      query: 'x', lang: 'en', article, table: '4' });
    return d.columns.map((c) => ({ header: c.header, sample: c.sample, role: c.role }));
  }, { article: A2019 });

  // "Affiliation of incumbent" is a fact about the parliament before the
  // election. It sits two columns left of the result, exactly as the notional
  // 2019 column sits three columns left in the 2024 article.
  expect(cols.some((c) => /incumbent/i.test(c.header))).toBe(true);
  expect(cols.some((c) => /Member returned/i.test(c.header))).toBe(true);
  expect(cols.map((c) => c.role)).not.toContain('party');

  // Whichever one the person picks, they can see what is in it first.
  const filled = cols.filter((c) => c.sample);
  expect(filled.length).toBeGreaterThan(3);
});
