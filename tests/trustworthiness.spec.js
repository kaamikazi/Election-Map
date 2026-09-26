import { test, expect } from '@playwright/test';
import fs from 'node:fs';

async function open(page) {
  await page.goto('/');
  await page.waitForFunction(() => document.querySelectorAll('#countryList .crow').length > 10);
}

test('same dataset keeps missing metrics, accepts zero, clears deliberately, and undoes once', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const { state, undo } = await import('/src/state.js');
    const { buildProposal, applyProposal } = await import('/src/import/proposal.js');
    const { buildIndex } = await import('/src/import/match.js');
    const { unitList } = await import('/src/geo.js');
    const make = (label, rows, id = 'FR:2024-07-07:assembly:round2') => buildProposal({
      source: { label, datasetId: id, asOf: '2024-07-07' }, rows,
      columns: ['unit', 'party', 'vote', 'seats', 'turnout', 'margin'].map((role, index) => ({ role, index })),
      index: buildIndex(unitList()), scope: 'world'
    });
    applyProposal(make('Source A', [['France', 'A', '44', '52', '68', '9'], ['Germany', 'A', '40']]));
    const before = JSON.stringify(state);
    applyProposal(make('Source B', [['France', 'B', '0', '', '[clear]']]));
    const after = structuredClone(state);
    const { provenanceLine } = await import('/src/export.js');
    const footer = provenanceLine();
    await undo();
    return { after, footer, restored: JSON.stringify(state) === before };
  });
  expect(r.after.assign.France).toMatchObject({ vote: 0, seats: 52, turnout: null, margin: 9 });
  expect(r.after.assign.Germany.vote).toBe(40);
  expect(r.after.assign.France.provenance.seats.source).toBe('Source A');
  expect(r.after.assign.France.provenance.vote.source).toBe('Source B');
  expect(r.footer).toContain('Mixed sources:');
  expect(r.footer).toContain('Source A');
  expect(r.footer).toContain('Source B');
  expect(r.restored).toBe(true);
});

test('each audited historical interval has checked beginnings, cutoffs and resumptions', async ({ page }) => {
  await open(page);
  const cases = JSON.parse(fs.readFileSync('data/parlgov-coverage.json', 'utf8')).intervals;
  const result = await page.evaluate(async (cases) => {
    const { loadGoverning, cabinetRecordOn, lastCoveredDate } = await import('/src/archive.js');
    await loadGoverning();
    const previousDay = (s) => new Date(Date.parse(s) - 86400000).toISOString().slice(0, 10);
    return { cases: cases.map((c) => ({ ...c,
      beforeStart: cabinetRecordOn(c.iso3, previousDay(c.from)),
      atStart: cabinetRecordOn(c.iso3, c.from),
      beforeCutoff: cabinetRecordOn(c.iso3, previousDay(c.coverageTo)),
      atCutoff: cabinetRecordOn(c.iso3, c.coverageTo),
      beforeResume: cabinetRecordOn(c.iso3, previousDay(c.nextRecorded)),
      atResume: cabinetRecordOn(c.iso3, c.nextRecorded)
    })), beyond: cabinetRecordOn('NLD', '2026-01-01'), end: lastCoveredDate() };
  }, cases);
  for (const c of result.cases) {
    expect(c.beforeStart.cabinet?.id).not.toBe(c.id);
    if (c.coverageTo > c.from) {
      expect(c.atStart.cabinet?.id).toBe(c.id);
      expect(c.beforeCutoff.cabinet?.id).toBe(c.id);
    }
    if (c.coverageTo < c.nextRecorded) {
      expect(c.atCutoff.reason).toBe('record gap');
      expect(c.atCutoff.gap.since).toBe(c.coverageTo);
      expect(c.atCutoff.gap.evidence).toEqual(c.evidence);
      expect(c.beforeResume.reason).toBe('record gap');
    } else {
      expect(c.beforeResume.cabinet?.id).toBe(c.id);
    }
    expect(c.atResume.cabinet).toBeTruthy();
    expect(c.atResume.cabinet.id).not.toBe(c.id);
  }
  expect(result.beyond.reason).toBe('beyond the end of this release');
});

test('year-only identities are unknown, no party is invented, and manual edits disclose their source', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const { state, setValue } = await import('/src/state.js');
    const { buildProposal, applyProposal, defaultImportMode } = await import('/src/import/proposal.js');
    const { adapterById } = await import('/src/import/adapters.js');
    const make = async (text) => buildProposal(await adapterById('clipboard').propose({ text, datasetId: '2024', sourceLabel: 'Test fixture' }));
    applyProposal(await make('Region\tParty\tVote\nFrance\tA\t42'));
    setValue('France', 'vote', 50);
    const { provenanceLine } = await import('/src/export.js');
    const footer = provenanceLine();
    const proposal = await make('Region\tSeats\nGermany\t12');
    const mode = defaultImportMode(proposal);
    applyProposal(proposal);
    return { mode, record: state.assign.Germany, footer };
  });
  expect(r.mode).toBe('replace');
  expect(r.record.party).toBe(null);
  expect(r.record.seats).toBe(12);
  expect(r.footer).toContain('Manual / unverified');
  expect(r.footer).toContain('Test fixture');
});

test('distinct generic pasted imports remain distinct and save/open preserves field provenance', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const { adapterById } = await import('/src/import/adapters.js');
    const { buildProposal, applyProposal } = await import('/src/import/proposal.js');
    const { state, toDocument } = await import('/src/state.js');
    const { restoreDocument } = await import('/src/restore.js');
    const { provenanceLine } = await import('/src/export.js');
    applyProposal(buildProposal(await adapterById('clipboard').propose({ text: 'Region\tParty\nFrance\tA' })));
    applyProposal(buildProposal(await adapterById('clipboard').propose({ text: 'Region\tParty\nGermany\tB' })), { mode: 'combine' });
    const before = structuredClone(state.assign);
    const footer = provenanceLine();
    await restoreDocument(JSON.parse(JSON.stringify(toDocument())));
    return { count: state.provenance.sources.length, url: state.provenance.url, footer, before, after: state.assign };
  });
  expect(r.count).toBe(2);
  expect(r.footer).toContain('Mixed sources:');
  expect(r.footer).toContain('[import 1]');
  expect(r.footer).toContain('[import 2]');
  expect(r.url).toBe(null);
  expect(r.after).toEqual(r.before);
});

test('changed or unknown identity replaces safely; intentional combinations retain their own sources', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const { state, undo } = await import('/src/state.js');
    const { buildProposal, applyProposal } = await import('/src/import/proposal.js');
    const { buildIndex } = await import('/src/import/match.js');
    const { unitList } = await import('/src/geo.js');
    const make = (datasetId, label, rows) => buildProposal({ source: { label, datasetId, asOf: '2024-01-01' }, rows,
      columns: ['unit', 'party', 'vote', 'seats', 'turnout', 'margin'].map((role, index) => ({ role, index })),
      index: buildIndex(unitList()), scope: 'world' });
    applyProposal(make('2024:assembly:round1', 'Old', [['France', 'A', '42', '50', '65', '7'], ['Germany', 'A']]));
    const next = make('2024:president:round2', 'New', [['France', 'B', '55']]);
    const blocked = applyProposal(next, { mode: 'update', confirmSame: true });
    applyProposal(next);
    const replaced = structuredClone(state.assign);
    await undo();
    applyProposal(next, { mode: 'combine' });
    const combined = structuredClone(state.assign);
    const { provenanceLine } = await import('/src/export.js');
    const footer = provenanceLine();
    await undo();
    const unknown = make(null, 'Unknown', [['France', 'B', '55']]);
    const unconfirmed = applyProposal(unknown, { mode: 'update' });
    applyProposal(unknown);
    return { blocked, replaced, combined, footer, unconfirmed, unknown: state.assign };
  });
  expect(r.blocked.identityError).toContain('identities differ');
  for (const records of [r.replaced, r.unknown]) {
    expect(Object.keys(records)).toEqual(['France']);
    expect(records.France).toMatchObject({ vote: 55, seats: null, turnout: null, margin: null });
  }
  expect(r.combined.Germany.provenance.party.source).toBe('Old');
  expect(r.combined.France.seats).toBe(null);
  expect(r.footer).toContain('Mixed sources:');
  expect(r.footer).toContain('Old');
  expect(r.footer).toContain('New');
  expect(r.unconfirmed.identityError).toContain('Identity is unknown');
});

test('save and open from a fresh world session restores geometry, export, controls and undo', async ({ page }) => {
  await open(page);
  const saved = await page.evaluate(async () => {
    const { state, switchLayer, toggleCountry, toDocument, emit } = await import('/src/state.js');
    const geo = await import('/src/geo.js');
    await geo.loadLayer('gb:BGD:ADM1');
    switchLayer('gb:BGD:ADM1');
    toggleCountry(geo.FEATS[0].key);
    state.fit = geo.boundsOf(geo.FEATS.map((f) => f.key));
    state.title = 'Saved Bangladesh demonstration';
    state.theme = 'light'; emit('parties');
    await window.__studio.prepareExport();
    return { doc: toDocument(), png: window.__studio.composite(1200, 675, {}).toDataURL() };
  });
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('#countryList .crow').length > 10);
  const before = await page.evaluate(() => JSON.stringify(window.__studio.state));
  await page.locator('#fileIn').setInputFiles({ name: 'saved.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved.doc)) });
  await expect(page.locator('#toast')).toHaveText('Map loaded');
  const opened = await page.evaluate(async () => {
    const geo = await import('/src/geo.js');
    await window.__studio.prepareExport();
    return { layer: geo.LAYER, units: geo.FEATS.length, boundary: geo.BOUNDARY.layerId,
      png: window.__studio.composite(1200, 675, {}).toDataURL() };
  });
  expect(opened).toMatchObject({ layer: 'gb:BGD:ADM1', units: 8, boundary: 'gb:BGD:ADM1' });
  expect(opened.png).toBe(saved.png);
  await expect(page.locator('#fTitle')).toHaveValue(saved.doc.title);
  await expect(page.locator('#tTheme')).toBeChecked();
  await expect(page.locator('[data-l="gb:BGD:ADM1"]')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(async () => { const { undo } = await import('/src/state.js'); await undo(); });
  expect(await page.evaluate(() => JSON.stringify(window.__studio.state))).toBe(before);
  expect(await page.evaluate(async () => (await import('/src/geo.js')).LAYER)).toBe('world');
});

test('malformed documents, bad geometry and failed boundary requests leave document and undo intact', async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const { state, toggleCountry, toDocument, undo } = await import('/src/state.js');
    const { restoreDocument } = await import('/src/restore.js');
    toggleCountry('France');
    const saved = structuredClone(toDocument());
    const before = JSON.stringify(state);
    const errors = [];
    for (const patch of [{ parties: null }, { zoom: 'bad' }, { layer: 'missing:BGD:ADM1' }, { assign: { Atlantis: { party: state.active } } }]) {
      try { await restoreDocument({ ...saved, ...patch }); } catch (e) { errors.push(e.message); }
      if (JSON.stringify(state) !== before) throw new Error('Failed restore changed document');
    }
    await undo();
    return { errors, assign: state.assign, layer: (await import('/src/geo.js')).LAYER };
  });
  expect(result.errors).toHaveLength(4);
  expect(result.assign).toEqual({});
  expect(result.layer).toBe('world');
  await page.route('**/data/gb/BGD/ADM1*', (route) => route.abort());
  // Use the real registry URL, so a network failure is distinguished from a
  // nonexistent layer and never quietly replaced with world geometry.
  const url = await page.evaluate(async () => (await (await fetch('data/boundaries.json')).json()).sources['gb:BGD:ADM1'].file);
  await page.route('**/' + url, (route) => route.fulfill({ status: 503, body: 'Unavailable' }));
  const failure = await page.evaluate(async () => {
    const { state, toDocument } = await import('/src/state.js');
    const { restoreDocument } = await import('/src/restore.js');
    const before = JSON.stringify(state);
    try { await restoreDocument({ ...toDocument(), layer: 'gb:BGD:ADM1', assign: {} }); }
    catch (e) { return { error: e.message, unchanged: before === JSON.stringify(state), layer: (await import('/src/geo.js')).LAYER }; }
  });
  expect(failure.error).toContain('503');
  expect(failure.unchanged).toBe(true);
  expect(failure.layer).toBe('world');
});

test('undoing a layer-picker switch restores geometry, assignments, framing and controls together', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const { toggleCountry, state } = await import('/src/state.js');
    toggleCountry('France'); state.title = 'Previous world map';
  });
  const before = await page.evaluate(() => structuredClone(window.__studio.state));
  await page.locator('[data-iso="BGD"]').click();
  await page.locator('[data-l="gb:BGD:ADM1"]').click();
  await page.waitForFunction(() => window.__studio.state.layer === 'gb:BGD:ADM1');
  await page.locator('#btnUndo').click();
  await page.waitForFunction(() => window.__studio.state.layer === 'world');
  const result = await page.evaluate(async () => ({ state: window.__studio.state, layer: (await import('/src/geo.js')).LAYER }));
  expect(result.state).toEqual(before);
  expect(result.layer).toBe('world');
  await expect(page.locator('#fTitle')).toHaveValue('Previous world map');
  await expect(page.locator('[data-l="world"]')).toHaveAttribute('aria-pressed', 'true');
});
