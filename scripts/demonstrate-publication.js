#!/usr/bin/env node
/**
 * Publication Workstation demonstration.
 *
 *   npm run demo:publication
 *
 * Starts its own dev server, drives the real app in Chromium, and writes to
 * build/publication-demonstration-audit/:
 *
 *   01-historical-1945-*.png        ParlGov archive, historical label and caveats
 *   02-partial-*.png                SYNTHETIC partial count with a percentage badge
 *   03-disputed-recount-*.png       SYNTHETIC disputed and recount examples
 *   04-mixed-source-*.png           SYNTHETIC two-source map with its disclosure
 *   05-profile-{landscape,square,portrait}.png   one map in all three X profiles
 *   06-mobile-review.png            the review panel at 390 × 844
 *   07-desktop-review.png           the review panel at 1440 × 900
 *   08-publication-pack.zip         a complete pack, and 08-publication-pack/ unpacked
 *   README.txt                      what each file is, and whether its data is real
 *
 * Nothing here is a live or current election result. Synthetic maps use
 * invented parties on real country outlines and say so in their title,
 * subtitle and source; the historical map is the ParlGov 2024 archive.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { chromium } from '@playwright/test';

import { ROOT } from './lib/registry.js';
import { unzipStore } from '../src/pack.js';

const PORT = 5198;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(ROOT, 'build', 'publication-demonstration-audit');
// A fixed clock: the demonstration renders the same bytes every time it runs.
const NOW = Date.parse('2026-09-26T15:00:00Z');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer() {
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'dev-server.js'), '--port', String(PORT)],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(BASE + '/index.html')).ok) return child; } catch (err) { /* not up yet */ }
    await sleep(200);
  }
  child.kill();
  throw new Error('the dev server did not come up');
}

async function open(page) {
  await page.goto(BASE + '/index.html');
  await page.waitForFunction(() => document.querySelectorAll('#countryList .crow').length > 10);
}

/** A synthetic results table through the real clipboard adapter. */
function synthetic(page, a) {
  return page.evaluate(async (a) => {
    const { adapterById } = await import('/src/import/adapters.js');
    const { buildProposal, applyProposal } = await import('/src/import/proposal.js');
    const { state } = await import('/src/state.js');
    const draft = adapterById('clipboard').propose({
      text: 'Country\tParty\tVotes\n' + a.rows.join('\n'),
      sourceLabel: a.source, sourceUrl: a.url, datasetId: a.id
    });
    const res = applyProposal(buildProposal(draft), { mode: a.mode || 'replace' });
    if (!res.applied) throw new Error('nothing applied');
    state.title = a.title;
    state.sub = a.sub;
    state.handle = '@electionmaps';
    state.fit = [[-12, 35], [30, 62]];
    Object.assign(state.publication, a.pub);
  }, a);
}

const ROWS = [
  'France\tAlpha Party\t41.2', 'Spain\tBeta Party\t38.0', 'Italy\tAlpha Party\t35.5',
  'Germany\tGamma Party\t29.9', 'Poland\tBeta Party\t44.1', 'Portugal\tAlpha Party\t40.3',
  'Austria\tGamma Party\t33.0', 'Czechia\tBeta Party\t36.8'
];
const SYNTH_SOURCE = 'SYNTHETIC DEMONSTRATION DATA — not a real election';
const SYNTH_URL = 'https://example.org/synthetic-demonstration/revision-1';
const BASE_PUB = {
  electionId: 'SYNTHETIC · 2026-09-25 · Test assembly · round 1', country: 'Testland (synthetic)',
  office: 'Test assembly', electionType: 'General', round: 1, electionDate: '2026-09-25',
  updatedAt: '2026-09-26T14:05:00Z', counted: null, note: 'Synthetic demonstration data.'
};

async function exportPng(page, file, w, h) {
  const r = await page.evaluate(async ({ w, h, now }) => {
    await window.__studio.prepareExport();
    const report = {};
    const url = window.__studio.composite(w, h, { now, report }).toDataURL('image/png');
    return { url, badge: report.badge, source: report.source };
  }, { w, h, now: NOW });
  await fsp.writeFile(path.join(OUT, file), Buffer.from(r.url.split(',')[1], 'base64'));
  return r;
}

const ready = (page) => page.evaluate(async (now) => {
  const { approveCurrentMap } = await import('/src/export.js');
  const r = approveCurrentMap(now);
  if (!r.publishable) throw new Error('not publishable: ' + r.blockers.map((b) => b.text).join(' | '));
  return r.badge;
}, NOW);

async function main() {
  await fsp.mkdir(OUT, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch();
  const log = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

    // 1. Historical: ParlGov 1945, which carries named coverage gaps and a note.
    await open(page);
    await page.evaluate(async () => {
      const { adapterById } = await import('/src/import/adapters.js');
      const { buildProposal, applyProposal } = await import('/src/import/proposal.js');
      const d = await adapterById('archive').propose({ year: '1945', scope: 'Europe', grouping: 'family' });
      applyProposal(buildProposal(d), { mode: 'replace' });
      window.__studio.state.handle = '@electionmaps';
    });
    log.push(['01-historical-1945-landscape.png', 'HISTORICAL — ParlGov 2024 archive (CC0), 1 January 1945', await ready(page)]);
    await exportPng(page, '01-historical-1945-landscape.png', 1600, 900);

    // 2. Partial count, synthetic.
    await open(page);
    await synthetic(page, {
      rows: ROWS, source: SYNTH_SOURCE, url: SYNTH_URL, id: BASE_PUB.electionId,
      title: 'Test assembly: partial count (SYNTHETIC)', sub: 'Invented parties on real outlines — demonstration only',
      pub: { ...BASE_PUB, purpose: 'partial-update', status: 'official-partial', counted: 62.4 }
    });
    log.push(['02-partial-landscape.png', 'SYNTHETIC — invented parties, demonstration only', await ready(page)]);
    await exportPng(page, '02-partial-landscape.png', 1600, 900);

    // 5. The same map in all three X profiles.
    for (const [name, w, h] of [['landscape', 1600, 900], ['square', 1200, 1200], ['portrait', 1080, 1350]]) {
      await exportPng(page, `05-profile-${name}.png`, w, h);
      log.push([`05-profile-${name}.png`, `SYNTHETIC — X ${name} ${w}×${h}`, 'OFFICIAL PARTIAL · 62.4% COUNTED']);
    }

    // 3. Disputed, then recount, synthetic.
    await open(page);
    await synthetic(page, {
      rows: ROWS, source: SYNTH_SOURCE, url: SYNTH_URL, id: BASE_PUB.electionId,
      title: 'Test assembly: contested count (SYNTHETIC)', sub: 'Invented parties on real outlines — demonstration only',
      pub: { ...BASE_PUB, purpose: 'result', status: 'disputed', note: 'Synthetic demonstration: result disputed, recount requested.' }
    });
    log.push(['03-disputed-square.png', 'SYNTHETIC — disputed', await ready(page)]);
    await exportPng(page, '03-disputed-square.png', 1200, 1200);
    await page.evaluate(() => { window.__studio.state.publication.status = 'recount'; });
    log.push(['03-recount-square.png', 'SYNTHETIC — recount pending', await ready(page)]);
    await exportPng(page, '03-recount-square.png', 1200, 1200);

    // An ongoing recount can be older than 60 days. Age is a review warning,
    // while status, source and update time remain explicit.
    await open(page);
    await synthetic(page, {
      rows: ROWS, source: SYNTH_SOURCE, url: SYNTH_URL,
      id: 'SYNTHETIC · 2026-06-01 · Test assembly · round 1',
      title: 'Test assembly: ongoing recount (SYNTHETIC)',
      sub: 'Old election, source updated recently — invented data only',
      pub: { ...BASE_PUB, electionId: 'SYNTHETIC · 2026-06-01 · Test assembly · round 1',
        electionDate: '2026-06-01', purpose: 'result', status: 'recount',
        note: 'Synthetic example: the recount is ongoing despite election age.' }
    });
    log.push(['03-recount-old-landscape.png', 'SYNTHETIC — ongoing recount older than 60 days', await ready(page)]);
    await exportPng(page, '03-recount-old-landscape.png', 1600, 900);

    // 4. Mixed sources, synthetic: two tables deliberately combined.
    await open(page);
    await synthetic(page, {
      rows: ROWS.slice(0, 5), source: SYNTH_SOURCE, url: SYNTH_URL, id: BASE_PUB.electionId,
      title: 'Test assembly: compiled from two sources (SYNTHETIC)', sub: 'Invented parties on real outlines — demonstration only',
      pub: { ...BASE_PUB, purpose: 'result', status: 'official-final' }
    });
    await synthetic(page, {
      rows: ROWS.slice(5), source: 'SECOND SYNTHETIC SOURCE — not a real election',
      url: 'https://example.org/synthetic-demonstration/second-table', id: 'SYNTHETIC · second table',
      mode: 'combine', title: 'Test assembly: compiled from two sources (SYNTHETIC)',
      sub: 'Invented parties on real outlines — demonstration only',
      pub: { ...BASE_PUB, purpose: 'result', status: 'official-final', note: 'Synthetic: two tables combined on purpose to show the disclosure.' }
    });
    log.push(['04-mixed-source-landscape.png', 'SYNTHETIC — two invented sources', await ready(page)]);
    await exportPng(page, '04-mixed-source-landscape.png', 1600, 900);

    // 8. A complete publication pack, from the partial-count map.
    await open(page);
    await synthetic(page, {
      rows: ROWS, source: SYNTH_SOURCE, url: SYNTH_URL, id: BASE_PUB.electionId,
      title: 'Test assembly: partial count (SYNTHETIC)', sub: 'Invented parties on real outlines — demonstration only',
      pub: { ...BASE_PUB, purpose: 'partial-update', status: 'official-partial', counted: 62.4 }
    });
    const editedCaption = await page.evaluate(async () => {
      const { currentReview } = await import('/src/export.js');
      const { packContext } = await import('/src/publish.js');
      const { captionText } = await import('/src/pack.js');
      const { captionBasisFor } = await import('/src/publication.js');
      const { state } = await import('/src/state.js');
      const text = `EDITORIAL LEAD — SYNTHETIC 🇧🇩\n${captionText(packContext(currentReview(), []))}`;
      state.publication.captionDraft = text;
      state.publication.captionBasis = captionBasisFor(state);
      return text;
    });
    await ready(page);
    const pack = await page.evaluate(async (now) => {
      const { buildPublicationPack } = await import('/src/publish.js');
      const { EXPORT_PROFILES } = await import('/src/pack.js');
      const p = await buildPublicationPack(EXPORT_PROFILES, { now });
      return { name: p.name, bytes: Array.from(p.bytes) };
    }, NOW);
    const zip = new Uint8Array(pack.bytes);
    await fsp.writeFile(path.join(OUT, '08-publication-pack.zip'), zip);
    const dir = path.join(OUT, '08-publication-pack');
    await fsp.mkdir(dir, { recursive: true });
    const files = unzipStore(zip);
    if (new TextDecoder().decode(files['caption.txt']) !== editedCaption) {
      throw new Error('pack caption differs from the manually reviewed text');
    }
    for (const [name, data] of Object.entries(files)) await fsp.writeFile(path.join(dir, name), data);
    log.push(['08-publication-pack.zip', `SYNTHETIC — ${Object.keys(files).length} files; caption manually edited and byte-for-byte checked: ${Object.keys(files).join(', ')}`, 'OFFICIAL PARTIAL · 62.4% COUNTED']);

    // 7. The review panel on a desktop, with that map loaded.
    await page.click('#openExport');
    await sleep(900);
    await page.screenshot({ path: path.join(OUT, '07-desktop-review.png') });
    log.push(['07-desktop-review.png', 'SYNTHETIC — review panel, 1440×900', '']);

    // 6. The review panel on a narrow phone, with a blocker showing.
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await open(phone);
    await synthetic(phone, {
      rows: ROWS, source: SYNTH_SOURCE, url: SYNTH_URL, id: BASE_PUB.electionId,
      title: 'Alpha Party wins (SYNTHETIC)', sub: 'Invented parties — demonstration only',
      pub: { ...BASE_PUB, purpose: 'partial-update', status: 'official-partial', counted: 62.4 }
    });
    await phone.click('#openExport');
    await sleep(900);
    await phone.screenshot({ path: path.join(OUT, '06-mobile-review.png') });
    log.push(['06-mobile-review.png', 'SYNTHETIC — 390×844 review, headline blocked for saying "wins" on a partial count', '']);
    await phone.locator('#pubCaption').scrollIntoViewIfNeeded();
    await phone.screenshot({ path: path.join(OUT, '06-mobile-caption-review.png') });
    log.push(['06-mobile-caption-review.png', 'SYNTHETIC — editable caption reached on a narrow phone', '']);

    // The timeline display scale matters: a footer that fits a 1600px PNG can
    // still be hard to read at 390px. Keep these QA views next to the exports.
    const qa = await browser.newPage({ viewport: { width: 390, height: 600 }, deviceScaleFactor: 1 });
    for (const [name, width, height] of [
      ['01-historical-1945-landscape.png', 1600, 900],
      ['02-partial-landscape.png', 1600, 900],
      ['03-recount-old-landscape.png', 1600, 900],
      ['04-mixed-source-landscape.png', 1600, 900],
      ['05-profile-square.png', 1200, 1200],
      ['05-profile-portrait.png', 1080, 1350]
    ]) {
      const png = await fsp.readFile(path.join(OUT, name));
      const shownH = Math.ceil(390 * height / width);
      await qa.setViewportSize({ width: 390, height: shownH });
      await qa.setContent(`<style>html,body{margin:0;background:#0D141C}</style><img alt="QA display" ` +
        `src="data:image/png;base64,${png.toString('base64')}" style="display:block;width:390px;height:${shownH}px">`);
      const preview = `phone-preview-${name}`;
      await qa.screenshot({ path: path.join(OUT, preview) });
      log.push([preview, `QA view of ${name} at 390px wide`, '']);
    }
    await qa.close();

    const readme = [
      'Election Map Studio — Publication Workstation demonstration',
      `Generated by scripts/demonstrate-publication.js, clock fixed at ${new Date(NOW).toISOString()}.`,
      '',
      'NONE OF THESE ARE LIVE OR CURRENT ELECTION RESULTS.',
      'Synthetic maps use invented parties (Alpha, Beta, Gamma) on real country outlines,',
      'and say SYNTHETIC in their title and source. The historical map is the ParlGov 2024',
      'archive (CC0) as bundled in this repository.',
      '',
      ...log.map(([f, what, badge]) => `${f}\n    ${what}${badge ? `\n    badge: ${badge}` : ''}`),
      ''
    ].join('\n');
    await fsp.writeFile(path.join(OUT, 'README.txt'), readme);
    console.log(readme);
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((err) => { console.error('demonstration failed:', err.message); process.exit(1); });
