#!/usr/bin/env node
// Run with the dev server available: node scripts/demonstrate-trust.js
// --baseline routes only source/data from the inspected commit, reproducing
// the defects without changing the working tree.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';

const out = 'build/trust-demonstration';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const baseline = process.argv.includes('--baseline');
if (baseline) {
  await page.route('**/src/**', (route) => {
    const file = new URL(route.request().url()).pathname.slice(1);
    route.fulfill({ contentType: 'text/javascript', body: execFileSync('git', ['show', `a39f86c:${file}`]) });
  });
  await page.route('**/data/governing.json', (route) => route.fulfill({ contentType: 'application/json',
    body: execFileSync('git', ['show', 'a39f86c:public/data/governing.json']) }));
}
const open = async () => {
  await page.goto('http://localhost:5173');
  await page.waitForFunction(() => document.querySelectorAll('#countryList .crow').length > 10);
};
const capture = async (name) => {
  const r = await page.evaluate(async () => {
    await window.__studio.prepareExport();
    const { toDocument } = await import('/src/state.js');
    return { png: window.__studio.composite(1600, 900, {}).toDataURL(), document: toDocument() };
  });
  fs.writeFileSync(`${out}/${name}.png`, Buffer.from(r.png.split(',')[1], 'base64'));
  fs.writeFileSync(`${out}/${name}.json`, JSON.stringify(r.document, null, 2));
};
try {
  await open();
  if (baseline) {
    const importBug = await page.evaluate(async () => {
      const { state } = await import('/src/state.js');
      const { adapterById } = await import('/src/import/adapters.js');
      const { buildProposal, applyProposal } = await import('/src/import/proposal.js');
      const load = async (text, label) => {
        const d = await adapterById('clipboard').propose({ text });
        d.source.label = label;
        applyProposal(buildProposal(d));
      };
      await load('Region\tParty\tVote\tSeats\tTurnout\tMargin\nFrance\tA\t40\t52\t68\t9\nGermany\tA\t45', 'Old election');
      await load('Region\tParty\tVote\nFrance\tB\t55', 'New election');
      return { france: state.assign.France, omittedGermanyRetained: !!state.assign.Germany, provenance: state.provenance };
    });
    const saved = await page.evaluate(async () => {
      const { state, switchLayer, toDocument } = await import('/src/state.js');
      const geo = await import('/src/geo.js');
      await geo.loadLayer('gb:BGD:ADM1'); switchLayer('gb:BGD:ADM1');
      state.assign[geo.FEATS[0].key] = { party: state.active, vote: 45 };
      return toDocument();
    });
    await open();
    await page.locator('#fileIn').setInputFiles({ name: 'baseline-saved.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) });
    await page.waitForFunction(() => window.__studio.state.layer === 'gb:BGD:ADM1');
    const restoreBug = await page.evaluate(async () => {
      const geo = await import('/src/geo.js');
      return { stateLayer: window.__studio.state.layer, geometryLayer: geo.LAYER, features: geo.FEATS.length, boundary: geo.BOUNDARY };
    });
    const historyBug = await page.evaluate(async () => {
      const { loadGoverning, cabinetRecordOn } = await import('/src/archive.js');
      await loadGoverning();
      return Object.fromEntries(['DNK', 'NLD', 'NOR'].map((iso) => [iso, cabinetRecordOn(iso, '1945-01-01')]));
    });
    const evidence = { commit: 'a39f86c', importBug, restoreBug, historyBug };
    fs.writeFileSync(`${out}/baseline-reproduction.json`, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({ importBug, restoreBug, history: Object.fromEntries(Object.entries(historyBug).map(([iso, r]) => [iso, r.cabinet?.name || r.reason])) }, null, 2));
  } else {
    await page.evaluate(async () => {
      const { adapterById } = await import('/src/import/adapters.js');
      const { buildProposal, applyProposal } = await import('/src/import/proposal.js');
      const { state, emit } = await import('/src/state.js');
      applyProposal(buildProposal(await adapterById('archive').propose({ year: '1945', scope: 'Europe', grouping: 'family' })));
      state.title = 'Who governed Europe, 1945';
      state.sub = 'Historical demonstration · Head of government on 1 January · Present-day outlines';
      emit('parties');
    });
    await capture('historical-1945');
    await page.screenshot({ path: `${out}/desktop.png` });
    const { manifest } = await page.evaluate(async () => {
      const series = await import('/src/series.js');
      await series.planSeries({ from: 1945, to: 1946, scope: 'Europe', grouping: 'family' });
      return { manifest: series.manifest() };
    });
    fs.writeFileSync(`${out}/historical-series-manifest.json`, JSON.stringify(manifest, null, 2));
    await open();
    await page.evaluate(async () => {
      const geo = await import('/src/geo.js');
      const { state, switchLayer, emit } = await import('/src/state.js');
      await geo.loadLayer('cons:GBR:CONSTITUENCY'); switchLayer('cons:GBR:CONSTITUENCY');
      const { setTransport, clearCache } = await import('/src/import/wikipedia.js');
      clearCache(); setTransport(async () => (await fetch('/fixtures/wikipedia/parse-uk-2024-mps.json')).json());
      const { adapterById } = await import('/src/import/adapters.js');
      const { buildProposal, applyProposal } = await import('/src/import/proposal.js');
      const draft = await adapterById('wikipedia').propose({ query: 'x', lang: 'en', article: '2024 United Kingdom general election MPs', table: '5' });
      draft.columns.forEach((c) => { if (c.role === 'party') c.role = 'ignore'; });
      draft.columns[5].role = 'party';
      // The fixture uses two spellings for the same party. This is the
      // explicit review correction already called out by the app's warning.
      for (const row of draft.rows) if (row[5] === 'Scottish National') row[5] = 'Scottish National Party';
      applyProposal(buildProposal(draft));
      state.title = 'UK constituencies, 2024';
      state.sub = 'Historical fixture demonstration · Reviewed 2024 party column · Not live results';
      emit('parties');
    });
    await capture('subnational-2024');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400); // finish the existing responsive sheet transition
    await page.screenshot({ path: `${out}/mobile.png` });
    await page.setViewportSize({ width: 1440, height: 900 });
    await open();
    await page.evaluate(async () => {
      const { adapterById } = await import('/src/import/adapters.js');
      const { buildProposal, applyProposal } = await import('/src/import/proposal.js');
      const { state, emit } = await import('/src/state.js');
      const load = async (text, sourceLabel, datasetId, mode) => applyProposal(buildProposal(
        await adapterById('clipboard').propose({ text, sourceLabel, datasetId })), { mode });
      await load('Region\tParty\tVote\tSeats\tTurnout\tMargin\nFrance\tDemo A\t40\t52\t68\t9\nGermany\tDemo A\t45', 'Synthetic fixture A (not election results)', 'demo:old', 'replace');
      await load('Region\tParty\tVote\nFrance\tDemo B\t55', 'Synthetic fixture B (not election results)', 'demo:new', 'combine');
      state.title = 'Mixed-source safeguard demonstration';
      state.sub = 'Synthetic data · France: new vote only; old seats, turnout and margin removed';
      state.fit = (await import('/src/geo.js')).boundsOf(['France', 'Germany']);
      emit('parties');
    });
    await capture('mixed-source');
    await page.locator('#openImport').click();
    await page.fill('#in_text', 'Region\tParty\tVote\nFrance\tDemo B\t56');
    await page.click('#btnPropose');
    await page.selectOption('#importMode', 'update');
    await page.locator('#confirmSame').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/identity-review.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#confirmSame').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/mobile-review.png` });
    console.log(`Demonstrations written to ${out}`);
  }
} finally { await browser.close(); }
