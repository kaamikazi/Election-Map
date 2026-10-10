#!/usr/bin/env node
/** Registered evidence → a new demo database → the normal map review/export. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';
import { ROOT } from './lib/registry.js';
import { IngestionEngine } from './ingestion/engine.js';
import { json, inside, readJson } from './ingestion/util.js';

const OUT = path.join(ROOT, 'build/ingestion-demonstration');
const PORT = 5202, BASE = `http://127.0.0.1:${PORT}`;
const offline = process.argv.includes('--offline');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const demoDatabase = path.join(OUT, 'runs', randomUUID(), 'database');
  const engine = await new IngestionEngine({ root: ROOT, database: demoDatabase, reports: path.join(OUT, 'reports') }).setup('all');
  const batch = await engine.download({ offline });
  const plan = await engine.validate({ batch });
  const imported = await engine.commit(plan);
  await engine.report(plan, imported);
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/dev-server.js'), '--port', String(PORT)],
    { cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) { ready = true; break; } } catch {} await sleep(200); }
    if (!ready) throw new Error('Demo server did not start');
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route('**/data/ingestion/**', async (route) => {
      const suffix = new URL(route.request().url()).pathname.split('/data/ingestion/')[1];
      try { await route.fulfill({ contentType: suffix.endsWith('.txt') ? 'text/plain; charset=utf-8' : 'application/json', body: await fs.readFile(inside(engine.database, suffix)) }); }
      catch { await route.fulfill({ status: 404, body: 'not found' }); }
    });
    await page.goto(BASE);
    await page.waitForFunction(() => document.querySelectorAll('#countryList .crow').length > 10);
    const exported = await page.evaluate(async () => {
      const geo = await import('/src/geo.js'); const { state, switchLayer, emit, toDocument } = await import('/src/state.js');
      await geo.loadLayer('cons:GBR:CONSTITUENCY'); switchLayer('cons:GBR:CONSTITUENCY');
      const { adapterById } = await import('/src/import/adapters.js');
      const { buildProposal, applyProposal } = await import('/src/import/proposal.js');
      const a = adapterById('database'), choices = await a.propose({ query: 'GBR 2024' });
      const draft = await a.propose({ election: choices.choose.options[0].value });
      const proposal = buildProposal(draft), applied = applyProposal(proposal);
      state.title = 'UK general election, 2024';
      state.sub = 'Historical ingestion demonstration · Registered Parliament data';
      state.publication.purpose = 'historical'; state.publication.status = 'historical';
      state.publication.note = 'Demonstration of source-reported results; editorial publication review is still required.';
      state.publication.ready = false; state.publication.approvalFingerprint = null;
      emit('parties'); await window.__studio.prepareExport();
      const report = {};
      const cv = window.__studio.composite(1200, 1200, { report });
      return { applied, matched: proposal.rows.filter((r) => r.status === 'matched').length,
        badge: report.badge, map: toDocument(), png: cv.toDataURL('image/png') };
    });
    if (exported.applied.applied !== 650) throw new Error(`Expected 650 sourced winners, got ${exported.applied.applied}`);
    await fs.writeFile(path.join(OUT, 'uk-2024-draft.png'), Buffer.from(exported.png.split(',')[1], 'base64'));
    await fs.writeFile(path.join(OUT, 'uk-2024-map.json'), json(exported.map));
    await page.screenshot({ path: path.join(OUT, 'desktop-map.png') });
    await page.click('#openExport'); await page.locator('#pubFacts').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(OUT, 'publication-source-review.png') });
    await page.click('#closeExport');
    await page.reload(); await page.waitForFunction(() => document.querySelectorAll('#countryList .crow').length > 10);
    await page.click('#openImport'); await page.click('[data-a="database"]');
    await page.fill('#in_query', 'GBR 2019'); await page.click('#btnPropose');
    await page.locator('#reviewBody .option').first().click();
    await page.waitForSelector('#reviewBody article');
    await page.screenshot({ path: path.join(OUT, 'unresolved-source-review.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(OUT, 'mobile-source-review.png') });

    const qa = await browser.newPage({ viewport: { width: 390, height: 390 }, deviceScaleFactor: 1 });
    await qa.setContent(`<style>html,body{margin:0;background:#0D141C}</style><img alt="Historical draft QA" src="${exported.png}" style="display:block;width:390px;height:390px">`);
    await qa.screenshot({ path: path.join(OUT, 'phone-preview.png') });

    const uk = batch.sources.find((s) => s.sourceId === 'uk-parliament-2024');
    const captures = [];
    for (const receiptId of uk.captures?.length ? uk.captures : uk.references.map((r) => r.receiptId)) captures.push(await readJson(path.join(engine.cache, 'receipts', `${receiptId}.json`)));
    const workflow = { kind: 'election-map-studio/ingestion-demonstration', offline,
      source: 'UK Parliament 2024 candidate CSV, not current/live results', captures,
      canonicalRecords: plan.records.length, additions: plan.changes.additions.length, generation: imported.generation,
      demoDatabase: path.relative(ROOT, demoDatabase),
      sourceReportedWinnersApplied: exported.applied.applied, exactCodeMatches: exported.matched,
      mapBadge: exported.badge, independentlyVerifiedRecords: plan.records.filter((r) => r.review.state === 'verified').length,
      sourceUpdateTime: exported.map.publication.updatedAt,
      notes: ['No national ParlGov winner was inferred.', 'Source update time is unknown; retrieval and HTTP times do not substitute for it.',
        'The map intentionally remains a draft. No posting or publication approval occurred.'] };
    await fs.writeFile(path.join(OUT, 'download-to-export.json'), json(workflow));
    await fs.writeFile(path.join(OUT, 'README.md'), `# Ingestion demonstration\n\n${workflow.source}.\n\nDownloaded registered evidence was validated and imported into a separate demo database. ${workflow.sourceReportedWinnersApplied} reported winners matched their exact 2024 boundary codes and flowed through the existing proposal renderer. The image is a historical draft.\n\nSee download-to-export.json for captures, hashes, results and limitations. See reports/ for coverage, missing countries, unresolved review and update manifest.\n`);
    console.log(json({ generation: imported.generation, sourceReportedWinners: exported.applied.applied, badge: exported.badge, output: OUT }));
  } finally { if (browser) await browser.close(); server.kill(); }
}
main().catch((e) => { console.error(`Ingestion demonstration stopped: ${e.message}`); process.exitCode = 1; });
