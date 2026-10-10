/**
 * Publication Workstation.
 *
 * One reviewed map should produce a truthful X graphic and a complete content
 * pack, and it should be impossible to present partial, projected, disputed,
 * historical or mixed data as a clean final result by accident.
 *
 * Every result here is SYNTHETIC TEST DATA — invented parties on real country
 * outlines, labelled as such in their source — except the historical cases,
 * which use the repository's ParlGov 2024 archive. Nothing here is, or pretends
 * to be, a live election result.
 */

import { test, expect } from '@playwright/test';

const NOW = Date.parse('2026-09-26T15:00:00Z');
const SYNTH_URL = 'https://example.org/synthetic-results/revision-1';
const SYNTH = 'SYNTHETIC TEST DATA — not a real election';

async function open(page) {
  await page.goto('/');
  await page.waitForFunction(() => document.querySelectorAll('#countryList .crow').length > 10);
}

/**
 * Import a synthetic table through the real clipboard adapter and review path,
 * then set publication metadata. Returns nothing; the page holds the map.
 */
async function synthetic(page, { pub = {}, rows, source = SYNTH, url = SYNTH_URL, id = 'SYNTH · 2026-09-25 · Test assembly · round 1', mode = 'replace', confirmSame = false } = {}) {
  await page.evaluate(async (a) => {
    const { adapterById } = await import('/src/import/adapters.js');
    const { buildProposal, applyProposal } = await import('/src/import/proposal.js');
    const { state } = await import('/src/state.js');
    const text = 'Country\tParty\tVotes\n' + (a.rows || [
      'France\tAlpha Party\t41.2', 'Spain\tBeta Party\t38.0', 'Italy\tAlpha Party\t35.5',
      'Germany\tGamma Party\t29.9', 'Poland\tBeta Party\t44.1'
    ]).join('\n');
    const draft = adapterById('clipboard').propose({ text, sourceLabel: a.source, sourceUrl: a.url, datasetId: a.id });
    const res = applyProposal(buildProposal(draft), { mode: a.mode, confirmSame: a.confirmSame });
    if (!res.applied) throw new Error('synthetic import applied nothing: ' + JSON.stringify(res));
    state.title = a.pub.title ?? 'Test assembly, synthetic count';
    state.sub = a.pub.sub ?? 'Synthetic data for testing only';
    state.handle = '@electionmaps';
    Object.assign(state.publication, {
      electionId: a.id, country: 'Testland', office: 'Test assembly', electionType: 'General',
      round: 1, electionDate: '2026-09-25', purpose: 'result', status: 'official-final',
      counted: null, updatedAt: '2026-09-26T14:05:00.000Z', note: '', ready: false
    }, a.pub.fields || {});
  }, { rows, source, url, id, mode, confirmSame, pub });
}

/** Review, render and report, all against the same clock. */
const exportOf = (page, w = 1600, h = 900) => page.evaluate(async ({ w, h, now }) => {
  const { currentReview } = await import('/src/export.js');
  await window.__studio.prepareExport();
  const review = currentReview(now);
  const report = {};
  let error = null;
  try { window.__studio.composite(w, h, { now, report }); } catch (e) { error = e.message; }
  return {
    badge: report.badge, style: report.badgeStyle, source: report.source,
    limitations: report.limitations, note: report.publicationLine, error,
    blockers: review.blockers.map((b) => b.code), warnings: review.warnings.map((x) => x.code),
    publishable: review.publishable
  };
}, { w, h, now: NOW });

const markReady = (page) => page.evaluate(async (now) => { (await import('/src/export.js')).approveCurrentMap(now); }, NOW);

/* --------------------------------------------------------------- statuses */

test('final result metadata produces an OFFICIAL FINAL export', async ({ page }) => {
  await open(page);
  await synthetic(page);
  const draft = await exportOf(page);
  expect(draft.blockers).toEqual([]);
  // Until a person marks it reviewed, even a clean final result says DRAFT.
  expect(draft.badge).toBe('DRAFT · OFFICIAL FINAL');

  await markReady(page);
  const r = await exportOf(page);
  expect(r.publishable).toBe(true);
  expect(r.badge).toBe('OFFICIAL FINAL');
  expect(r.style).toBe('outline');
  expect(r.source).toContain(SYNTH);
  expect(r.source).toContain(SYNTH_URL);
});

test('a partial result shows its percentage counted and cannot be labelled final', async ({ page }) => {
  await open(page);
  await synthetic(page, { pub: { fields: { purpose: 'partial-update', status: 'official-partial', counted: 62.4 } } });
  await markReady(page);
  const r = await exportOf(page);
  expect(r.blockers).toEqual([]);
  expect(r.badge).toBe('OFFICIAL PARTIAL · 62.4% COUNTED');
  expect(r.style).toBe('solid');
  expect(r.note).toContain('Results as of 2026-09-26 14:05 UTC');

  // Without a percentage, a partial result is blocked.
  await page.evaluate(() => { window.__studio.state.publication.counted = null; });
  expect((await exportOf(page)).blockers).toContain('counted');

  // A partial update cannot carry the final status …
  await page.evaluate(() => Object.assign(window.__studio.state.publication, { counted: 62.4, status: 'official-final' }));
  expect((await exportOf(page)).blockers).toContain('status-purpose');

  // … and its headline cannot say it is over.
  await page.evaluate(() => {
    Object.assign(window.__studio.state.publication, { status: 'official-partial' });
    window.__studio.state.title = 'Alpha Party wins the test assembly';
  });
  const worded = await exportOf(page);
  expect(worded.blockers).toContain('final-language-headline');
  expect(worded.badge).toMatch(/^DRAFT · /);
});

test('a projected result is visibly marked projected', async ({ page }) => {
  await open(page);
  await synthetic(page, { pub: { fields: { purpose: 'projection', status: 'projected' } } });
  await markReady(page);
  const r = await exportOf(page);
  expect(r.blockers).toEqual([]);
  expect(r.badge).toBe('PROJECTED · NOT FINAL');
  expect(r.style).toBe('solid');
  // A projection map cannot quietly become a result.
  await page.evaluate(() => { window.__studio.state.publication.status = 'official-final'; });
  expect((await exportOf(page)).blockers).toContain('status-purpose');
});

test('disputed and recount results are visibly marked', async ({ page }) => {
  await open(page);
  await synthetic(page, { pub: { fields: { status: 'disputed' } } });
  await markReady(page);
  const d = await exportOf(page);
  expect(d.blockers).toEqual([]);
  expect(d.badge).toBe('DISPUTED · NOT SETTLED');
  expect(d.style).toBe('solid');

  await page.evaluate(() => { window.__studio.state.publication.status = 'recount'; });
  await markReady(page);
  const rc = await exportOf(page);
  expect(rc.badge).toBe('RECOUNT PENDING · NOT FINAL');
  expect(rc.style).toBe('solid');

  // "Settled" language on a disputed result is blocked.
  await page.evaluate(() => { window.__studio.state.sub = 'Beta Party declared victorious'; window.__studio.state.publication.status = 'disputed'; });
  expect((await exportOf(page)).blockers).toContain('final-language-subtitle');
});

test('historical archive data is labelled historical, and cannot pass as current', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const { adapterById } = await import('/src/import/adapters.js');
    const { buildProposal, applyProposal } = await import('/src/import/proposal.js');
    const d = await adapterById('archive').propose({ year: '1977', scope: 'Europe', grouping: 'family' });
    applyProposal(buildProposal(d), { mode: 'replace' });
  });
  const pub = await page.evaluate(() => ({ ...window.__studio.state.publication }));
  // The archive fills in only what it can honestly say about itself.
  expect(pub.status).toBe('historical');
  expect(pub.purpose).toBe('historical');
  expect(pub.electionDate).toBe('1977-01-01');
  expect(pub.electionId).toBe('parlgov:government:1977-01-01:family');

  await markReady(page);
  const r = await exportOf(page);
  expect(r.blockers).toEqual([]);
  expect(r.badge).toBe('HISTORICAL ARCHIVE · 1977');

  await page.evaluate(() => Object.assign(window.__studio.state.publication, { status: 'official-final', purpose: 'result' }));
  const current = await exportOf(page);
  expect(current.blockers).toContain('historical-as-current');
  expect(current.badge).toMatch(/^DRAFT/);
});

/* --------------------------------------------------------------- blockers */

test('missing publication identity blocks publication', async ({ page }) => {
  await open(page);
  await synthetic(page, { pub: { fields: { electionId: null } } });
  // A saved ready flag alone is never a substitute for a valid review.
  await page.evaluate(() => { window.__studio.state.publication.ready = true; });
  const r = await exportOf(page);
  expect(r.blockers).toContain('identity');
  expect(r.publishable).toBe(false);
  expect(r.badge).toBe('DRAFT · OFFICIAL FINAL');

  const pack = await page.evaluate(async (now) => {
    const { buildPublicationPack } = await import('/src/publish.js');
    const { EXPORT_PROFILES } = await import('/src/pack.js');
    try { await buildPublicationPack(EXPORT_PROFILES, { now }); return 'built'; } catch (e) { return e.message; }
  }, NOW);
  expect(pack).toMatch(/Publication is blocked: No election identity/);
});

test('a sourced result without a source or citation cannot be published', async ({ page }) => {
  await open(page);
  // Imported with a source name but no link.
  await synthetic(page, { url: '' });
  await page.evaluate(() => { window.__studio.state.publication.ready = true; });
  expect((await exportOf(page)).blockers).toContain('citation');

  // A map painted by hand has no source at all.
  await page.goto('/');
  await page.waitForFunction(() => document.querySelectorAll('#countryList .crow').length > 10);
  const r = await page.evaluate(async (now) => {
    const { state, toggleCountry } = await import('/src/state.js');
    const { currentReview } = await import('/src/export.js');
    toggleCountry('France');
    Object.assign(state.publication, { electionId: 'SYNTH · hand-made', office: 'Test', electionDate: '2026-09-25', purpose: 'result', status: 'official-final' });
    return currentReview(now).blockers.map((b) => b.code);
  }, NOW);
  expect(r).toContain('source');
});

test('a boundary override the system knows is unsafe needs an editorial note', async ({ page }) => {
  await open(page);
  await synthetic(page);
  await page.evaluate(() => {
    const s = window.__studio.state;
    for (const rec of Object.values(s.assign)) {
      for (const f of Object.values(rec.provenance)) f.vintageOverride = { resultsYear: 2019, boundaryVintage: 2024, noun: 'constituencies' };
    }
  });
  expect((await exportOf(page)).blockers).toContain('vintage-override');
  await page.evaluate(() => { window.__studio.state.publication.note = 'Synthetic: drawn on later boundaries to test the override.'; });
  expect((await exportOf(page)).blockers).not.toContain('vintage-override');
});

/* --------------------------------------------------------------- mixed sources */

test('mixed-source maps disclose their mixed provenance everywhere', async ({ page }) => {
  await open(page);
  await synthetic(page, { rows: ['France\tAlpha Party\t41.2', 'Spain\tBeta Party\t38.0'] });
  await synthetic(page, {
    rows: ['Portugal\tGamma Party\t33.3'], source: 'SYNTHETIC SECOND SOURCE — not a real election',
    url: 'https://example.org/synthetic-second', id: 'SYNTH · second table', mode: 'combine'
  });
  await markReady(page);
  const r = await exportOf(page);
  expect(r.warnings).toContain('mixed');
  expect(r.source).toMatch(/^Mixed sources: /);
  expect(r.source).toContain('SYNTHETIC SECOND SOURCE');
  expect(r.source).toContain(SYNTH);

  const files = await page.evaluate(async (now) => {
    const { buildPublicationPack } = await import('/src/publish.js');
    const { EXPORT_PROFILES, unzipStore } = await import('/src/pack.js');
    const pack = await buildPublicationPack([EXPORT_PROFILES[0]], { now });
    const got = unzipStore(pack.bytes);
    const dec = new TextDecoder();
    return { caption: dec.decode(got['caption.txt']), meta: JSON.parse(dec.decode(got['metadata.json'])) };
  }, NOW);
  expect(files.caption).toContain('Compiled from 2 sources.');
  expect(files.caption).toContain('https://example.org/synthetic-second');
  expect(files.meta.mixedSources).toBe(true);
  expect(files.meta.sources.map((s) => s.source)).toHaveLength(2);
});

/* --------------------------------------------------------------- save / open */

test('per-value provenance and publication metadata survive save and open', async ({ page }) => {
  await open(page);
  await synthetic(page, { pub: { fields: { status: 'official-partial', purpose: 'partial-update', counted: 48.5, note: 'Synthetic note.' } } });
  const r = await page.evaluate(async () => {
    const { state, toDocument } = await import('/src/state.js');
    const { restoreDocument } = await import('/src/restore.js');
    const saved = JSON.parse(JSON.stringify(toDocument()));
    const before = { pub: { ...state.publication }, fr: JSON.stringify(state.assign.France.provenance) };
    // Something else in between, then open the saved file.
    state.publication.status = 'upcoming';
    state.assign = {};
    await restoreDocument(saved);
    return {
      version: saved.version, before,
      after: { pub: { ...state.publication }, fr: JSON.stringify(state.assign.France.provenance) }
    };
  });
  expect(r.version).toBe(8);
  expect(r.after.pub).toEqual(r.before.pub);
  expect(r.after.fr).toBe(r.before.fr);
  expect(r.after.fr).toContain(SYNTH_URL);
});

test('documents from before publication metadata open unchanged, as drafts', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const { state } = await import('/src/state.js');
    const { restoreDocument } = await import('/src/restore.js');
    const { currentReview } = await import('/src/export.js');
    // A schema-6 file, and a v1 file with bare party ids, neither with publication fields.
    const v6 = {
      version: 6, title: 'Old map', sub: '', handle: '', parties: [{ id: 1, name: 'A', color: '#3B7DD8' }],
      active: 1, assign: { France: { party: 1, vote: 40 } }, metric: 'flat', selected: null,
      overrides: {}, provenance: null, aliases: {}, layer: 'world', layerAssign: {}, proj: 'equalEarth',
      rotate: [-10, -12], zoom: 1, pan: [0, 0], fit: null, theme: 'dark', grat: false,
      antarctica: false, dots: true, labels: false, mode: 'results', flagged: {}
    };
    await restoreDocument(v6);
    const six = { title: state.title, vote: state.assign.France.vote, pub: { ...state.publication }, badge: currentReview().badge };
    await restoreDocument({ parties: [{ id: 1, name: 'A', color: '#3B7DD8' }], assign: { Spain: 1 } });
    const one = { party: state.assign.Spain.party, pub: { ...state.publication } };
    let rejected = null;
    try { await restoreDocument({ ...v6, version: 7, publication: { status: 'winner' } }); } catch (e) { rejected = e.message; }
    return { six, one, rejected };
  });
  expect(r.six.title).toBe('Old map');
  expect(r.six.vote).toBe(40);
  expect(r.six.pub.status).toBe(null);
  expect(r.six.pub.ready).toBe(false);
  // An old unsourced map with no status gets no badge: it exports as it always did.
  expect(r.six.badge).toBe('');
  expect(r.one.party).toBe(1);
  expect(r.one.pub.electionId).toBe(null);
  // A status that is not one of the defined ones is refused, not guessed at.
  expect(r.rejected).toMatch(/publication status/);
});

test('changing the map withdraws a reviewer\'s sign-off', async ({ page }) => {
  await open(page);
  await synthetic(page);
  await markReady(page);
  expect((await exportOf(page)).publishable).toBe(true);
  await page.evaluate(async () => { (await import('/src/state.js')).toggleCountry('Norway'); });
  const r = await exportOf(page);
  expect(r.publishable).toBe(false);
  expect(r.badge).toBe('DRAFT · OFFICIAL FINAL');
});

/* --------------------------------------------------------------- profiles */

test('every export profile keeps the status and the attribution', async ({ page }) => {
  await open(page);
  await synthetic(page, { pub: { fields: { purpose: 'partial-update', status: 'official-partial', counted: 71 } } });
  await markReady(page);
  const r = await page.evaluate(async (now) => {
    const { EXPORT_PROFILES, customProfile } = await import('/src/pack.js');
    await window.__studio.prepareExport();
    const out = [];
    for (const p of [...EXPORT_PROFILES, customProfile(900, 1200)]) {
      const report = {};
      const cv = window.__studio.composite(p.width, p.height, { now, report });
      out.push({ id: p.id, w: cv.width, h: cv.height, badge: report.badge, source: report.source, note: report.publicationLine });
    }
    const errors = [];
    for (const [w, h] of [[599, 900], [2000, 600], [4097, 1000]]) {
      try { customProfile(w, h); } catch (e) { errors.push(e.message); }
    }
    return { out, errors };
  }, NOW);
  expect(r.out.map((o) => `${o.id} ${o.w}x${o.h}`)).toEqual([
    'x-landscape 1600x900', 'x-square 1200x1200', 'x-portrait 1080x1350', 'custom 900x1200'
  ]);
  for (const o of r.out) {
    expect(o.badge, o.id).toBe('OFFICIAL PARTIAL · 71% COUNTED');
    expect(o.source, o.id).toContain(SYNTH_URL);
    expect(o.note, o.id).toContain('Results as of');
  }
  expect(r.errors).toHaveLength(3);
  expect(r.errors[0]).toMatch(/between 600 and 4096/);
  expect(r.errors[1]).toMatch(/3:1/);
});

test('a profile that cannot fit truthful attribution stops with an actionable error', async ({ page }) => {
  await open(page);
  // Twelve synthetic sources: more attribution than a small square can hold.
  for (let i = 0; i < 12; i++) {
    await synthetic(page, {
      rows: [`${['France', 'Spain', 'Italy', 'Poland', 'Norway', 'Sweden', 'Finland', 'Greece', 'Portugal', 'Austria', 'Hungary', 'Romania'][i]}\tAlpha Party\t40`],
      source: `SYNTHETIC SOURCE ${i + 1} with a deliberately long descriptive name for testing attribution space`,
      url: `https://example.org/synthetic/${i + 1}/a-long-revision-path-to-take-up-space`,
      id: `SYNTH · source ${i + 1}`, mode: i ? 'combine' : 'replace'
    });
  }
  const r = await page.evaluate(async (now) => {
    await window.__studio.prepareExport();
    try { window.__studio.composite(600, 600, { now }); return null; } catch (e) { return e.message; }
  }, NOW);
  expect(r).toMatch(/too little map space|does not fit/);
  expect(r).toMatch(/taller export|wider export|fewer sources/);
});

test('unsourced flat maps keep their old export: no badge, same pixels', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const { state } = await import('/src/state.js');
    state.assign = { France: { party: 1 }, Brazil: { party: 2 } };
    state.title = 'Hand-made map';
    const report = {};
    const a = window.__studio.composite(1600, 900, { report }).toDataURL();
    // Publication fields that say nothing about status do not change the image.
    Object.assign(state.publication, { electionId: 'x', country: 'y', note: '' });
    const b = window.__studio.composite(1600, 900).toDataURL();
    return { badge: report.badge, same: a === b };
  });
  expect(r.badge).toBe('');
  expect(r.same).toBe(true);
});

/* --------------------------------------------------------------- the pack */

test('the publication pack is complete, deterministic and honest', async ({ page }) => {
  await open(page);
  await synthetic(page, { pub: { fields: { purpose: 'partial-update', status: 'official-partial', counted: 62.4, note: 'Synthetic data for testing.' } } });
  await markReady(page);
  const r = await page.evaluate(async (now) => {
    const { buildPublicationPack } = await import('/src/publish.js');
    const { EXPORT_PROFILES, unzipStore } = await import('/src/pack.js');
    const a = await buildPublicationPack(EXPORT_PROFILES, { now });
    const b = await buildPublicationPack(EXPORT_PROFILES, { now });
    const same = a.bytes.length === b.bytes.length && a.bytes.every((x, i) => x === b.bytes[i]);
    const files = unzipStore(a.bytes);
    const dec = new TextDecoder();
    const png = (bytes) => bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
    const dims = (bytes) => { const v = new DataView(bytes.buffer, bytes.byteOffset); return [v.getUint32(16), v.getUint32(20)]; };
    return {
      same, name: a.name, names: Object.keys(files),
      pngs: Object.entries(files).filter(([n]) => n.endsWith('.png')).map(([n, d]) => ({ n, ok: png(d), dims: dims(d) })),
      caption: dec.decode(files['caption.txt']),
      methodology: files['source-and-methodology.txt'] ? dec.decode(files['source-and-methodology.txt']) : null,
      meta: JSON.parse(dec.decode(files['metadata.json']))
    };
  }, NOW);

  expect(r.same, 'two builds of the same map must be byte-identical').toBe(true);
  expect(r.name).toMatch(/^synth-2026-09-25-test-assembly-round-1-official-partial-publication-pack\.zip$/);
  expect(r.names).toEqual([
    'synth-2026-09-25-test-assembly-round-1-official-partial-x-landscape-1600x900.png',
    'synth-2026-09-25-test-assembly-round-1-official-partial-x-square-1200x1200.png',
    'synth-2026-09-25-test-assembly-round-1-official-partial-x-portrait-1080x1350.png',
    'caption.txt', 'metadata.json', 'source-and-methodology.txt'
  ]);
  expect(r.pngs.map((p) => p.dims)).toEqual([[1600, 900], [1200, 1200], [1080, 1350]]);
  for (const p of r.pngs) expect(p.ok, p.n).toBe(true);

  // The caption states the election, the status and the count, and the source.
  expect(r.caption).toContain('Testland · Test assembly · General · Round 1 · 2026-09-25');
  expect(r.caption).toContain('Official partial result: 62.4% counted as of 2026-09-26 14:05 UTC. Not final.');
  expect(r.caption).toContain('Leading party by country so far (not final): Alpha Party 2 · Beta Party 2 · Gamma Party 1.');
  expect(r.caption).toContain(`Source: ${SYNTH} ${SYNTH_URL}`);
  expect(r.caption).toContain('Synthetic data for testing.');
  // Never a claim the status does not support.
  expect(r.caption).not.toMatch(/official final|\bwinn|\bwon\b|\bwins\b|victor|landslide/i);

  expect(r.meta.publication.status).toBe('official-partial');
  expect(r.meta.statusBadge).toBe('OFFICIAL PARTIAL · 62.4% COUNTED');
  expect(r.meta.review.blockers).toEqual([]);
  expect(r.meta.values.France.sources.vote).toBe(SYNTH);
  expect(r.meta.images).toHaveLength(3);
  expect(r.methodology).toContain('Status: Official partial');
  expect(r.methodology).toContain(SYNTH_URL);
});

test('a final result with no caveats needs no methodology file', async ({ page }) => {
  await open(page);
  await synthetic(page);
  await markReady(page);
  const names = await page.evaluate(async (now) => {
    const { buildPublicationPack } = await import('/src/publish.js');
    const { EXPORT_PROFILES, unzipStore } = await import('/src/pack.js');
    const pack = await buildPublicationPack([EXPORT_PROFILES[1]], { now });
    const files = unzipStore(pack.bytes);
    return { names: Object.keys(files), caption: new TextDecoder().decode(files['caption.txt']) };
  }, NOW);
  expect(names.names).toEqual([
    'synth-2026-09-25-test-assembly-round-1-official-final-x-square-1200x1200.png', 'caption.txt', 'metadata.json'
  ]);
  expect(names.caption).toContain('Official final result.');
  expect(names.caption).toContain('Winning party by country: Alpha Party 2 · Beta Party 2 · Gamma Party 1.');
});

test('the pack refuses a map nobody has marked ready', async ({ page }) => {
  await open(page);
  await synthetic(page);
  const r = await page.evaluate(async (now) => {
    const { buildPublicationPack } = await import('/src/publish.js');
    const { EXPORT_PROFILES } = await import('/src/pack.js');
    try { await buildPublicationPack(EXPORT_PROFILES, { now }); return 'built'; } catch (e) { return e.message; }
  }, NOW);
  expect(r).toMatch(/Mark the map "reviewed — ready to publish"/);
});

/* --------------------------------------------------------------- the review UI */

test.describe('narrow mobile review', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the review is usable on a phone: every field reachable, blockers first, pack gated', async ({ page }) => {
    await open(page);
    await synthetic(page, { pub: { fields: { electionId: null } } });
    await page.click('#openExport');
    await page.waitForTimeout(500);

    const layout = await page.evaluate(() => {
      const d = document.querySelector('#exportDlg').getBoundingClientRect();
      const blockers = document.querySelector('#pubBlockers').getBoundingClientRect();
      return {
        full: d.width === innerWidth && d.height === innerHeight,
        overflow: document.querySelector('#exportDlg .dlg-b').scrollWidth - document.querySelector('#exportDlg .dlg-b').clientWidth,
        blockersTop: blockers.top, blockersText: document.querySelector('#pubBlockers').textContent,
        packDisabled: document.querySelector('#btnPack').disabled,
        readyDisabled: document.querySelector('#pubReady').disabled
      };
    });
    expect(layout.full).toBe(true);
    expect(layout.overflow).toBeLessThanOrEqual(0);
    expect(layout.blockersTop).toBeLessThan(200);
    expect(layout.blockersText).toMatch(/No election identity/);
    expect(layout.packDisabled).toBe(true);
    expect(layout.readyDisabled).toBe(true);

    // Fix it on the phone, as a reviewer would, and sign it off.
    await page.locator('#pubElectionId').scrollIntoViewIfNeeded();
    await page.fill('#pubElectionId', 'SYNTH · 2026-09-25 · Test assembly · round 1');
    await page.waitForTimeout(150);
    await page.locator('#pubReady').scrollIntoViewIfNeeded();
    await page.locator('#pubReady').check();
    await page.waitForTimeout(250);

    const after = await page.evaluate(() => ({
      pack: document.querySelector('#btnPack').disabled,
      chip: document.querySelector('#pubStateDlg').textContent,
      small: [...document.querySelectorAll('#exportDlg input, #exportDlg select, #exportDlg button, #exportDlg .tog')]
        .filter((el) => el.offsetParent && !el.matches('input[type=checkbox]'))
        .map((el) => [el.id || el.className, el.getBoundingClientRect()])
        .filter(([, r]) => r.height < 43.5).map(([n, r]) => `${n} ${Math.round(r.height)}`)
    }));
    expect(after.pack).toBe(false);
    expect(after.chip).toBe('Ready to publish');
    expect(after.small, after.small.join(', ')).toEqual([]);
  });
});

test('the desktop review shows the caption, gates the pack, and only shows custom size when chosen', async ({ page }) => {
  await open(page);
  await synthetic(page, { pub: { fields: { purpose: 'partial-update', status: 'official-partial', counted: 62.4 } } });
  await page.click('#openExport');
  await page.waitForTimeout(500);

  const before = await page.evaluate(() => ({
    customVisible: getComputedStyle(document.querySelector('#customSize')).display !== 'none',
    pack: document.querySelector('#btnPack').disabled,
    chip: document.querySelector('#pubStateDlg').textContent,
    caption: document.querySelector('#pubCaption')?.value || '',
    length: document.querySelector('#captionCount')?.textContent || '',
    badge: document.querySelector('#pubFacts').textContent
  }));
  expect(before.customVisible).toBe(false);
  expect(before.pack).toBe(true);
  expect(before.chip).toBe('Draft');
  expect(before.caption).toContain('Official partial result: 62.4% counted');
  expect(before.length).toMatch(/Estimated \d+ \/ 280 weighted characters/);
  expect(before.badge).toContain('OFFICIAL PARTIAL · 62.4% COUNTED');

  await page.click('#profileSeg button[data-profile="custom"]');
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('#customSize')).display)).not.toBe('none');

  await page.check('#pubReady');
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => ({
    pack: document.querySelector('#btnPack').disabled,
    chip: document.querySelector('#pubStateDlg').textContent,
    header: document.querySelector('#pubChip').textContent
  }))).toEqual({ pack: false, chip: 'Ready to publish', header: 'Ready to publish' });

  // Editing a reviewed field withdraws the sign-off at once.
  await page.fill('#pubCounted', '70');
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => ({
    ready: document.querySelector('#pubReady').checked, pack: document.querySelector('#btnPack').disabled
  }))).toEqual({ ready: false, pack: true });
});
