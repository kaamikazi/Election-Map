/**
 * Not an assertion suite — this writes the exports to tests/shots/ so a human
 * (or Claude) can look at them. Projection and legend-layout bugs show up in a
 * picture and never in a unit test.
 *
 *   npx playwright test shots
 */

import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PARTIES, SEED } from './fixtures/seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'shots');

test('write one export per metric', async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  await page.goto('/');
  await page.waitForFunction(() => document.querySelectorAll('#countryList .crow').length > 10);

  for (const metric of ['flat', 'vote', 'seats', 'turnout', 'margin']) {
    const dataUrl = await page.evaluate(({ parties, seed, metric }) => {
      const s = window.__studio.state;
      const assign = {};
      for (const [name, [party, vote, seats, turnout, margin]] of Object.entries(seed)) {
        assign[name] = { party, vote, seats, turnout, margin };
      }
      Object.assign(s, {
        parties, assign, metric, selected: null, active: 1,
        title: metric === 'flat' ? 'Who governs Europe, 2026' : 'Europe 2026 — ' + metric,
        sub: 'Party of the sitting head of government',
        handle: '@electionmaps',
        proj: 'equalEarth', fit: [[-26, 33], [46, 72]], theme: 'dark',
        zoom: 1, pan: [0, 0], labels: false, dots: true, grat: false
      });
      return window.__studio.composite(1600, 900).toDataURL('image/png');
    }, { parties: PARTIES, seed: SEED, metric });

    fs.writeFileSync(path.join(OUT, metric + '.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
  }

  // the archive map, which carries a provenance footer the others do not
  await page.waitForSelector('#openImport');
  const gov = await page.evaluate(async () => {
    const { adapterById } = await import('/src/import/adapters.js');
    const { buildProposal, applyProposal } = await import('/src/import/proposal.js');
    const draft = await adapterById('archive').propose({ year: 1977, scope: 'Europe', grouping: 'family' });
    applyProposal(buildProposal(draft));
    // No fit is set here on purpose: an archive map frames itself to its own
    // coverage, and overriding that would hide whether it does.
    const { state } = await import('/src/state.js');
    state.handle = '@electionmaps';
    return window.__studio.composite(1600, 900).toDataURL('image/png');
  });
  fs.writeFileSync(path.join(OUT, 'governing-1977.png'), Buffer.from(gov.split(',')[1], 'base64'));

  // a Wikipedia-sourced map, which carries a permalink in its footer
  const bd = await page.evaluate(async () => {
    const { setTransport, clearCache } = await import('/src/import/wikipedia.js');
    clearCache();
    setTransport(async () => (await fetch('/fixtures/wikipedia/parse-bangladesh-2024.json')).json());

    const { adapterById } = await import('/src/import/adapters.js');
    const { buildProposal, applyProposal } = await import('/src/import/proposal.js');
    const { state } = await import('/src/state.js');
    const { boundsOf } = await import('/src/geo.js');

    const draft = await adapterById('wikipedia').propose({
      query: 'x', lang: 'en', article: '2024 Bangladeshi general election', table: '11'
    });
    applyProposal(buildProposal(draft), { replace: true });

    state.fit = boundsOf(['Bangladesh'], 0.45);
    state.title = 'Bangladesh, 2024';
    state.sub = 'Winning party in the general election of 7 January';
    state.handle = '@electionmaps';
    state.metric = 'flat';
    return window.__studio.composite(1600, 900).toDataURL('image/png');
  });
  fs.writeFileSync(path.join(OUT, 'bangladesh-2024.png'), Buffer.from(bd.split(',')[1], 'base64'));

  // a province layer: Bangladesh's divisions, from the article's per-division tables
  const divisions = await page.evaluate(async () => {
    const { setTransport, clearCache } = await import('/src/import/wikipedia.js');
    clearCache();
    setTransport(async () => (await fetch('/fixtures/wikipedia/parse-bangladesh-2024.json')).json());

    const { loadLayer, boundsOf } = await import('/src/geo.js');
    const { state, switchLayer } = await import('/src/state.js');
    await loadLayer('gb:BGD:ADM1');
    switchLayer('gb:BGD:ADM1');

    const { adapterById } = await import('/src/import/adapters.js');
    const { buildProposal, applyProposal, setRowUnit } = await import('/src/import/proposal.js');
    const draft = await adapterById('wikipedia').propose({
      query: 'x', lang: 'en', article: '2024 Bangladeshi general election', table: 'family' });
    const proposal = buildProposal(draft);
    const REAL = {
      'Barishal Division': 'Barisal', 'Chattogram Division': 'Chittagong',
      'Dhaka Division': 'Dhaka', 'Khulna Division': 'Khulna',
      'Mymensingh Division': 'Mymensingh', 'Rajshahi Division': 'Rajshani',
      'Rangpur Division': 'Rangpur', 'Sylhet Division': 'Sylhet'
    };
    for (const row of proposal.rows) {
      const name = REAL[row.raw.unit];
      if (name) setRowUnit(proposal, row, proposal.index.exact.get(name));
    }

    // Cumilla and Faridpur strand, which makes Chittagong and Dhaka partial.
    const { findPartitions } = await import('/src/import/partition.js');
    proposal.partials = (await findPartitions(proposal)).partials;
    applyProposal(proposal);

    const geo = await import('/src/geo.js');
    state.fit = boundsOf(geo.FEATS.map((f) => f.key), 0.25);
    state.title = 'Bangladesh by division, 2024';
    state.sub = 'Winning party in each division, general election of 7 January';
    state.handle = '@electionmaps';
    state.metric = 'seats';
    return window.__studio.composite(1600, 900).toDataURL('image/png');
  });
  fs.writeFileSync(path.join(OUT, 'bangladesh-divisions.png'),
    Buffer.from(divisions.split(',')[1], 'base64'));

  // a constituency layer: 650 Westminster seats, real boundaries, real results.
  // This is the milestone 9 acceptance in picture form — if the projection or
  // the legend cannot take 650 units and a dozen parties, it shows up here.
  const uk = await page.evaluate(async () => {
    const { setTransport, clearCache } = await import('/src/import/wikipedia.js');
    clearCache();
    setTransport(async () => (await fetch('/fixtures/wikipedia/parse-uk-2024-mps.json')).json());

    const { loadLayer, boundsOf } = await import('/src/geo.js');
    const { state, switchLayer } = await import('/src/state.js');
    await loadLayer('cons:GBR:CONSTITUENCY');
    switchLayer('cons:GBR:CONSTITUENCY');

    const { adapterById } = await import('/src/import/adapters.js');
    const { buildProposal, applyProposal } = await import('/src/import/proposal.js');
    const draft = await adapterById('wikipedia').propose({
      query: 'x', lang: 'en', article: '2024 United Kingdom general election MPs', table: '5' });

    // The column the guesser picks is not the one this map needs: the table
    // carries the 2019 notional affiliation two columns to the left of the 2024
    // winner. Choosing between them is the review step's entire reason to exist.
    draft.columns.forEach((c) => { if (c.role === 'party') c.role = 'ignore'; });
    draft.columns[5].role = 'party';

    applyProposal(buildProposal(draft), { replace: true });

    // House colours, set the way a person would set them after applying.
    const COLOURS = {
      'Labour': '#E4003B', 'Conservative': '#0087DC', 'Liberal Democrats': '#FAA61A',
      'Scottish National': '#FDF38E', 'Reform UK': '#12B6CF', 'Green': '#528D6B',
      'Plaid Cymru': '#005B54', 'Democratic Unionist': '#D46A4C', 'Sinn Fein': '#326760',
      'Sinn Féin': '#326760', 'Social Democratic and Labour': '#2AA82C',
      'Alliance': '#F6CB2F', 'Ulster Unionist': '#48A5EE', 'Independent': '#B8B8B8',
      'Traditional Unionist Voice': '#0C3A6A', 'Speaker': '#9E9E9E'
    };
    for (const p of state.parties) {
      for (const [name, colour] of Object.entries(COLOURS)) {
        if (p.name.startsWith(name)) { p.color = colour; break; }
      }
    }

    const geo = await import('/src/geo.js');
    state.fit = boundsOf(geo.FEATS.map((f) => f.key), 0.06);
    state.title = 'The United Kingdom, 2024';
    state.sub = 'Winning party in each constituency, general election of 4 July';
    state.handle = '@electionmaps';
    state.metric = 'flat';
    state.dots = false;
    return window.__studio.composite(1600, 900).toDataURL('image/png');
  });
  fs.writeFileSync(path.join(OUT, 'uk-constituencies-2024.png'),
    Buffer.from(uk.split(',')[1], 'base64'));

  // and the app itself, with the legend rail in view
  await page.evaluate(async () => {
    const m = await import('/src/state.js');
    m.setMetric('vote');
    m.select('France');
  });
  await page.screenshot({ path: path.join(OUT, 'app.png'), fullPage: false });
});
