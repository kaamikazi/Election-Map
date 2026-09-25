/**
 * The Wikipedia adapter, against raw API responses captured from the real
 * thing. Nothing here touches the network: the module's transport is swapped
 * for one that reads tests/fixtures/wikipedia/, served by the dev server.
 *
 * Fixtures:
 *   search-bangladesh.json       en search, includes a 2026 article that would
 *                                break any attempt to construct the title
 *   parse-bangladesh-2024.json   en, 24 tables, 10 of them per-division results
 *                                that look almost exactly like the national one
 *   search-indonesia.json        id search
 *   parse-indonesia-2024.json    id, results table headed in Indonesian
 */

import { test, expect } from '@playwright/test';

async function open(page) {
  await page.goto('/');
  await page.waitForFunction(() => document.querySelectorAll('#countryList .crow').length > 10);
  await page.waitForSelector('#openImport');
  await installFixtureTransport(page);
}

/**
 * Route every Wikipedia request at a fixture. Keeping the real URL shapes means
 * the test still exercises how the module builds them.
 */
async function installFixtureTransport(page) {
  await page.evaluate(async () => {
    const { setTransport, clearCache } = await import('/src/import/wikipedia.js');
    clearCache();
    window.__wikiCalls = [];

    const files = {
      'en|search': 'search-bangladesh.json',
      'en|parse|2024 Bangladeshi general election': 'parse-bangladesh-2024.json',
      'id|search': 'search-indonesia.json',
      'id|parse|Pemilihan umum legislatif Indonesia 2024': 'parse-indonesia-2024.json'
    };

    setTransport(async (url) => {
      window.__wikiCalls.push(url);
      const u = new URL(url);
      const lang = u.hostname.split('.')[0];
      const action = u.searchParams.get('action');
      const key = action === 'parse'
        ? `${lang}|parse|${u.searchParams.get('page')}`
        : `${lang}|search`;
      const file = files[key];
      if (!file) throw new Error('no fixture for ' + key);
      const res = await fetch('/fixtures/wikipedia/' + file);
      return res.json();
    });
  });
}

const adapter = (page, inputs) => page.evaluate(async (args) => {
  const { adapterById } = await import('/src/import/adapters.js');
  return adapterById('wikipedia').propose(args);
}, inputs);

/* ---------------------------------------------------------------- finding */

test('the article is searched for, not constructed', async ({ page }) => {
  await open(page);
  const step = await adapter(page, { query: 'Bangladesh 2024 general election', lang: 'en' });

  expect(step.choose.name).toBe('article');
  const titles = step.choose.options.map((o) => o.label);
  expect(titles).toContain('2024 Bangladeshi general election');

  // The reason the title cannot be built: the article set moved on, and a
  // constructed "2024 Bangladesh general election" is not any of these.
  expect(titles).toContain('2026 Bangladeshi general election');
  expect(titles).not.toContain('2024 Bangladesh general election');
  expect(step.choose.options[0].detail.length).toBeGreaterThan(20);
});

test('a pasted article URL skips the search and names its own wiki', async ({ page }) => {
  await open(page);
  const step = await adapter(page, {
    query: 'https://id.wikipedia.org/wiki/Pemilihan_umum_legislatif_Indonesia_2024',
    lang: 'en'
  });

  // The URL said id, so the en input was overridden rather than obeyed.
  expect(step.choose.name).toBe('table');
  const calls = await page.evaluate(() => window.__wikiCalls);
  expect(calls.some((u) => u.includes('id.wikipedia.org'))).toBe(true);
  expect(calls.some((u) => u.includes('list=search'))).toBe(false);
});

/* ---------------------------------------------------------------- tables */

test('an ambiguous article surfaces the choice instead of guessing', async ({ page }) => {
  await open(page);
  const step = await adapter(page, {
    query: 'x', lang: 'en', article: '2024 Bangladeshi general election'
  });

  expect(step.choose, 'the table must never be taken silently').toBeTruthy();
  expect(step.choose.name).toBe('table');

  // This article is the hard case on purpose: ten per-division tables shaped
  // exactly like the national one.
  expect(step.choose.options.length).toBeGreaterThan(1);
  for (const option of step.choose.options) {
    expect(option.note, 'each option should say why it scored').toBeTruthy();
    expect(option.detail, 'each option should show its headers').toBeTruthy();
  }
});

test('per-division tables score below the national one', async ({ page }) => {
  await open(page);
  const ranked = await page.evaluate(async () => {
    const { extractTables, rankTables, fromParseResponse } = await import('/src/import/wikipedia.js');
    const json = await (await fetch('/fixtures/wikipedia/parse-bangladesh-2024.json')).json();
    const art = fromParseResponse('en', json);
    return rankTables(extractTables(art.html)).slice(0, 12).map((r) => ({
      score: r.score,
      caption: r.table.caption,
      section: r.table.section,
      headers: r.table.headers.filter(Boolean).join(' | ')
    }));
  });

  const divisions = ranked.filter((r) => /Division/i.test(r.caption || ''));
  const national = ranked.filter((r) => !/Division/i.test(r.caption || ''));
  expect(national.length).toBeGreaterThan(0);
  expect(divisions.length).toBeGreaterThan(0);
  expect(
    national[0].score,
    'a per-division table outscored the national one'
  ).toBeGreaterThanOrEqual(Math.max(...divisions.map((d) => d.score)));
});

test('a party primary is not the election', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const { extractTables, rankTables, scoreTable, fromParseResponse } =
      await import('/src/import/wikipedia.js');
    const json = await (await fetch('/fixtures/wikipedia/parse-nigeria-2023.json')).json();
    const art = fromParseResponse('en', json);
    const ranked = rankTables(extractTables(art.html));

    const primaries = ranked.filter((x) => /primary|primaries/i.test(x.table.caption + ' ' + x.table.section));
    const rest = ranked.filter((x) => !primaries.includes(x));
    return {
      top: { caption: ranked[0].table.caption, reasons: ranked[0].reasons },
      bestPrimary: primaries.length ? Math.max(...primaries.map((x) => x.score)) : null,
      bestOther: rest.length ? Math.max(...rest.map((x) => x.score)) : null,
      penalty: scoreTable({
        caption: 'APC primary results', section: 'Primary results', className: 'wikitable',
        headers: ['Candidate', 'Votes', '%'], headerText: 'Candidate Votes %',
        rows: [[], [], [], []]
      }).reasons
    };
  });

  // The Nigerian article carries a primary table for every party that held one.
  // They look exactly like results, and choosing one maps the wrong contest.
  expect(r.penalty).toContain('is a party primary, not the election');
  expect(r.bestPrimary).not.toBeNull();
  expect(r.bestOther, 'a primary outranked the actual election').toBeGreaterThan(r.bestPrimary);
  expect(r.top.caption).not.toMatch(/primary/i);
});

test('a table with no results in it is refused, with the article to fall back to', async ({ page }) => {
  await open(page);
  const err = await page.evaluate(async () => {
    const { adapterById } = await import('/src/import/adapters.js');
    const { setTransport } = await import('/src/import/wikipedia.js');
    setTransport(async () => ({
      parse: {
        title: 'Nothing here', revid: 123, categories: [],
        text: '<p>Prose only.</p><table><tr><td>a</td></tr><tr><td>b</td></tr></table>'
      }
    }));
    try {
      await adapterById('wikipedia').propose({ query: 'x', lang: 'en', article: 'Nothing here' });
      return null;
    } catch (e) { return e.message; }
  });

  expect(err).toContain('No table');
  // A graceful failure names the fallback rather than leaving a dead end.
  expect(err).toContain('clipboard');
  expect(err).toContain('oldid=123');
});

/* ---------------------------------------------------------------- reading */

test('Bangladesh 2024 reads down to a country, a winner and its numbers', async ({ page }) => {
  await open(page);
  const draft = await adapter(page, {
    query: 'x', lang: 'en', article: '2024 Bangladeshi general election', table: '11'
  });

  expect(draft.rows).toHaveLength(1);
  const [unit, party, vote, seats] = draft.rows[0];

  // The country comes from the article's own categories, not from its title.
  expect(unit).toBe('Bangladesh');
  expect(party).toMatch(/Awami/);
  expect(Number(seats)).toBeGreaterThan(50);

  expect(draft.source.cite.revid).toBe(1372665246);
  expect(draft.source.cite.permalink).toBe('https://en.wikipedia.org/w/index.php?oldid=1372665246');
  expect(draft.source.cite.lang).toBe('en');
  expect(draft.source.cite.license).toMatch(/CC BY-SA/);
  expect(draft.chosen.map((c) => c.name)).toEqual(['article', 'table']);
});

test('a non-English wiki reads the same way', async ({ page }) => {
  await open(page);
  const step = await adapter(page, {
    query: 'x', lang: 'id', article: 'Pemilihan umum legislatif Indonesia 2024'
  });
  expect(step.choose.name).toBe('table');

  const draft = await adapter(page, {
    query: 'x', lang: 'id', article: 'Pemilihan umum legislatif Indonesia 2024',
    table: step.choose.options[0].value
  });

  // Categories name the country in Indonesian; the unit still resolves.
  expect(draft.rows[0][0]).toBe('Indonesia');
  expect(draft.rows[0][1]).toBeTruthy();
  expect(draft.source.cite.lang).toBe('id');
});

/* ---------------------------------------------------------------- caching */

test('a second fetch of the same article comes from cache at the same revision', async ({ page }) => {
  await open(page);
  const inputs = { query: 'x', lang: 'en', article: '2024 Bangladeshi general election', table: '11' };

  const first = await adapter(page, inputs);
  const callsAfterFirst = await page.evaluate(() => window.__wikiCalls.length);

  const second = await adapter(page, inputs);
  const callsAfterSecond = await page.evaluate(() => window.__wikiCalls.length);

  expect(second.source.cite.revid).toBe(first.source.cite.revid);
  expect(second.source.fromCache).toBe(true);
  expect(callsAfterSecond, 're-running should cost nothing').toBe(callsAfterFirst);
});

/* ---------------------------------------------------------------- applying */

test('the whole path: fetch, review, fix the country, apply, remember it', async ({ page }) => {
  await open(page);

  const applied = await page.evaluate(async () => {
    const { adapterById } = await import('/src/import/adapters.js');
    const { buildProposal, applyProposal } = await import('/src/import/proposal.js');
    const { state } = await import('/src/state.js');

    const draft = await adapterById('wikipedia').propose({
      query: 'x', lang: 'en', article: '2024 Bangladeshi general election', table: '11'
    });
    const proposal = buildProposal(draft);
    const result = applyProposal(proposal);

    return {
      status: proposal.rows[0].status,
      how: proposal.rows[0].how,
      result,
      bangladesh: state.assign['Bangladesh'],
      provenance: state.provenance
    };
  });

  expect(applied.status).toBe('matched');
  expect(applied.result.applied).toBe(1);
  expect(applied.bangladesh.label).toMatch(/Awami/);
  expect(applied.provenance.cite.permalink).toContain('oldid=');

  // And it renders, with the permalink in the footer.
  const footer = await page.evaluate(() => {
    const cv = window.__studio.composite(1600, 900);
    const ctx = cv.getContext('2d');
    const strip = ctx.getImageData(0, Math.round(cv.height * 0.86), cv.width, Math.round(cv.height * 0.1));
    let ink = 0;
    for (let i = 0; i < strip.data.length; i += 4) if (strip.data[i] > 90) ink++;
    return ink;
  });
  expect(footer, 'the provenance footer should be painted').toBeGreaterThan(200);
});

test('a country the categories cannot settle is left for the person', async ({ page }) => {
  await open(page);
  const unit = await page.evaluate(async () => {
    const { countryFromCategories } = await import('/src/import/wikipedia.js');
    const { FEATS } = await import('/src/geo.js');
    const names = FEATS.map((f) => f.name);
    return {
      settled: countryFromCategories(
        ['General elections in Bangladesh', 'January 2024 in Bangladesh'], names),
      oneMention: countryFromCategories(['2024 elections in France'], names),
      contested: countryFromCategories(
        ['Elections in France', 'Politics of France', 'Elections in Germany', 'Politics of Germany'],
        names),
      none: countryFromCategories(['2024 elections in Asia'], names),
      drc: countryFromCategories([
        'Elections in the Democratic Republic of the Congo',
        '2023 elections in the Democratic Republic of the Congo',
        'December 2023 in the Democratic Republic of the Congo'
      ], names),
      congo: countryFromCategories([
        'Elections in the Republic of the Congo',
        '2021 elections in the Republic of the Congo'
      ], names)
    };
  });

  expect(unit.settled).toBe('Bangladesh');
  // Two different countries, one a substring of the other, and the map holds
  // both. Reading the DRC as Congo was a real bug, found by fetching it.
  expect(unit.drc).toBe('Dem. Rep. Congo');
  expect(unit.congo).toBe('Congo');
  expect(unit.oneMention, 'a single mention is not enough to decide').toBe(null);
  expect(unit.contested, 'a tie is not an answer').toBe(null);
  expect(unit.none).toBe(null);
});
