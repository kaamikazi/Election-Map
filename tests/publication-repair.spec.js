import { test, expect } from '@playwright/test';

const NOW = Date.parse('2026-09-30T12:00:00Z');
const URL = 'https://example.org/synthetic-recount/revision-7';

async function seed(page, fields = {}) {
  await page.goto('/');
  await page.waitForFunction(() => document.querySelectorAll('#countryList .crow').length > 10);
  await page.evaluate(async ({ fields, url }) => {
    const { adapterById } = await import('/src/import/adapters.js');
    const { buildProposal, applyProposal } = await import('/src/import/proposal.js');
    const { state } = await import('/src/state.js');
    const draft = adapterById('clipboard').propose({
      text: 'Region\tParty\tVote\nFrance\tVictory Party\t45\nGermany\tBeta Party\t39',
      sourceLabel: 'SYNTHETIC TEST DATA', sourceUrl: url,
      datasetId: 'Synthetic · 2026-06-01 · Assembly · round 1'
    });
    applyProposal(buildProposal(draft));
    state.title = 'Synthetic assembly count';
    state.sub = 'Test fixture, not real results';
    Object.assign(state.publication, {
      electionId: draft.source.datasetId, country: 'Testland', office: 'Assembly',
      electionType: 'General', round: 1, electionDate: '2026-06-01',
      purpose: 'result', status: 'recount', updatedAt: '2026-09-30T08:30:00.000Z',
      note: 'Synthetic recount remains open.', counted: null
    }, fields);
  }, { fields, url: URL });
}

test('an old recount warns about age but remains reviewable; an old current claim blocks', async ({ page }) => {
  await seed(page);
  const r = await page.evaluate(async (now) => {
    const { state } = await import('/src/state.js');
    const { currentReview, approveCurrentMap } = await import('/src/export.js');
    const old = currentReview(now);
    approveCurrentMap(now);
    const approved = currentReview(now);
    state.title = 'Current results, synthetic assembly';
    state.publication.status = 'official-final';
    const falseCurrent = currentReview(now);
    return { old, approved, falseCurrent };
  }, NOW);
  expect(r.old.blockers).toEqual([]);
  expect(r.old.warnings.map((w) => w.code)).toContain('old-active');
  expect(r.approved.publishable).toBe(true);
  expect(r.approved.badge).toBe('RECOUNT PENDING · NOT FINAL');
  expect(r.falseCurrent.blockers.map((b) => b.code)).toContain('old-current-language');
  expect(r.falseCurrent.publishable).toBe(false);
});

test('recent partial count still needs its count and source update time', async ({ page }) => {
  await seed(page, { electionDate: '2026-09-29', purpose: 'partial-update', status: 'official-partial', counted: 62.4 });
  const r = await page.evaluate(async (now) => {
    const { state } = await import('/src/state.js');
    const { currentReview } = await import('/src/export.js');
    const valid = currentReview(now);
    state.publication.updatedAt = null;
    const noTime = currentReview(now);
    state.publication.updatedAt = '2026-09-30T08:30:00.000Z';
    state.publication.counted = null;
    const noCount = currentReview(now);
    return { valid, noTime, noCount };
  }, NOW);
  expect(r.valid.blockers).toEqual([]);
  expect(r.valid.warnings.map((w) => w.code)).not.toContain('old-active');
  expect(r.noTime.blockers.map((b) => b.code)).toContain('updated');
  expect(r.noCount.blockers.map((b) => b.code)).toContain('counted');
});

test('party name Victory is not an editorial final claim; real claims are blocked', async ({ page }) => {
  await seed(page, { purpose: 'partial-update', status: 'official-partial', counted: 48.5 });
  const r = await page.evaluate(async (now) => {
    const { state } = await import('/src/state.js');
    const { currentReview } = await import('/src/export.js');
    state.title = 'Victory Party leads the synthetic count';
    state.sub = 'Results are not final';
    const safe = currentReview(now);
    state.sub = 'Victory Party wins the assembly';
    const premature = currentReview(now);
    state.sub = 'Synthetic partial count, recount pending';
    state.publication.status = 'recount'; state.publication.purpose = 'result';
    const recount = currentReview(now);
    return { safe, premature, recount };
  }, NOW);
  expect(r.safe.blockers.map((b) => b.code).filter((x) => x.startsWith('final-language'))).toEqual([]);
  expect(r.premature.blockers.map((b) => b.code)).toContain('final-language-subtitle');
  expect(r.recount.blockers.map((b) => b.code).filter((x) => x.startsWith('final-language'))).toEqual([]);
});

test('offset entry denotes one instant across UTC, Bangladesh and a date boundary', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const { parseUpdatedInput, inputTimeAtOffset, formatUpdated } = await import('/src/publication.js');
    const utc = parseUpdatedInput('2026-09-25T18:30', '+00:00');
    const dhaka = parseUpdatedInput('2026-09-26T00:30', '+06:00');
    const beforeFallBack = parseUpdatedInput('2026-11-01T01:30', '-04:00');
    const afterFallBack = parseUpdatedInput('2026-11-01T01:30', '-05:00');
    let refused = false;
    try { parseUpdatedInput('2026-09-26T00:30', ''); } catch { refused = true; }
    return { utc, dhaka, shown: inputTimeAtOffset(utc, '+06:00'), formatted: formatUpdated(utc),
      hoursApart: (Date.parse(afterFallBack) - Date.parse(beforeFallBack)) / 3600000, refused };
  });
  expect(r.utc).toBe('2026-09-25T18:30:00.000Z');
  expect(r.dhaka).toBe(r.utc);
  expect(r.shown).toBe('2026-09-26T00:30');
  expect(r.formatted).toBe('2026-09-25 18:30 UTC');
  expect(r.hoursApart).toBe(1);
  expect(r.refused).toBe(true);
});

test('source update instant is separate from retrieval or archive date in the pack', async ({ page }) => {
  await seed(page);
  const r = await page.evaluate(async (now) => {
    const { approveCurrentMap, currentReview } = await import('/src/export.js');
    const { buildPublicationPack } = await import('/src/publish.js');
    const { EXPORT_PROFILES, unzipStore } = await import('/src/pack.js');
    const { adapterById } = await import('/src/import/adapters.js');
    const reviewed = approveCurrentMap(now);
    const p = await buildPublicationPack([EXPORT_PROFILES[0]], { now });
    const files = unzipStore(p.bytes), dec = new TextDecoder();
    const metadata = JSON.parse(dec.decode(files['metadata.json']));
    const archive = await adapterById('archive').propose({ year: '1945', scope: 'Europe', grouping: 'family' });
    return { updated: reviewed.facts.updated, retrieved: reviewed.facts.sources[0].retrievedAt,
      stored: metadata.publication.updatedAt, fromPack: metadata.sources[0].retrievedAt,
      caption: dec.decode(files['caption.txt']), methodology: dec.decode(files['source-and-methodology.txt']),
      archiveAsOf: archive.source.asOf, archiveFetched: archive.source.fetchedAt };
  }, NOW);
  expect(r.updated).toBe('2026-09-30 08:30 UTC');
  expect(r.stored).toBe('2026-09-30T08:30:00.000Z');
  expect(r.retrieved).toBeTruthy();
  expect(r.fromPack).toBe(r.retrieved);
  expect(r.fromPack).not.toBe(r.stored);
  expect(r.caption).toContain(r.updated);
  expect(r.methodology).toContain('not the result update time');
  expect(r.archiveAsOf).toBe('1945-01-01');
  expect(r.archiveFetched).toBe(null);
});

test('save/open in another browser timezone preserves instant and entered offset', async ({ browser }) => {
  const utcCtx = await browser.newContext({ timezoneId: 'UTC' });
  const utcPage = await utcCtx.newPage();
  await seed(utcPage, { timeInputOffset: '+06:00' });
  await utcPage.click('#openExport');
  await utcPage.locator('#pubUpdated').fill('2026-09-26T00:30');
  await utcPage.locator('#pubUpdated').dispatchEvent('change');
  const saved = await utcPage.evaluate(async () => (await import('/src/state.js')).toDocument());
  expect(saved.publication.updatedAt).toBe('2026-09-25T18:30:00.000Z');
  await utcCtx.close();

  const nyCtx = await browser.newContext({ timezoneId: 'America/New_York' });
  const nyPage = await nyCtx.newPage();
  await nyPage.goto('/');
  await nyPage.waitForFunction(() => document.querySelectorAll('#countryList .crow').length > 10);
  await nyPage.evaluate(async (doc) => (await import('/src/restore.js')).restoreDocument(doc), saved);
  await nyPage.click('#openExport');
  expect(await nyPage.locator('#pubUpdated').inputValue()).toBe('2026-09-26T00:30');
  expect(await nyPage.locator('#pubOffset').inputValue()).toBe('+06:00');
  const instant = await nyPage.evaluate(async () => ({
    stored: window.__studio.state.publication.updatedAt,
    shown: (await import('/src/publication.js')).formatUpdated(window.__studio.state.publication.updatedAt)
  }));
  expect(instant).toEqual({ stored: '2026-09-25T18:30:00.000Z', shown: '2026-09-25 18:30 UTC' });
  const older = structuredClone(saved);
  older.version = 7;
  older.publication.updatedAt = '2026-09-26T00:30:00+06:00';
  delete older.publication.timeInputOffset;
  await nyPage.locator('#closeExport').click();
  await nyPage.evaluate(async (doc) => (await import('/src/restore.js')).restoreDocument(doc), older);
  await nyPage.click('#openExport');
  expect(await nyPage.locator('#pubUpdated').inputValue()).toBe('2026-09-26T00:30');
  expect(await nyPage.locator('#pubOffset').inputValue()).toBe('+06:00');
  await nyCtx.close();
});

test('a saved ready boolean cannot approve changed data or an unreviewed file', async ({ page }) => {
  await seed(page);
  const r = await page.evaluate(async (now) => {
    const { state, toDocument } = await import('/src/state.js');
    const { currentReview, approveCurrentMap } = await import('/src/export.js');
    const { restoreDocument } = await import('/src/restore.js');
    const { buildPublicationPack } = await import('/src/publish.js');
    const { EXPORT_PROFILES } = await import('/src/pack.js');
    const bare = JSON.parse(JSON.stringify(toDocument())); bare.publication.ready = true;
    await restoreDocument(bare);
    const forged = currentReview(now).publishable;
    let packError = '';
    try { await buildPublicationPack([EXPORT_PROFILES[0]], { now }); } catch (e) { packError = e.message; }
    approveCurrentMap(now);
    const genuine = currentReview(now).publishable;
    const reviewed = JSON.parse(JSON.stringify(toDocument()));
    reviewed.assign.France.vote = 99;
    await restoreDocument(reviewed);
    const changed = currentReview(now).publishable;
    return { forged, packError, genuine, changed };
  }, NOW);
  expect(r.forged).toBe(false);
  expect(r.packError).toContain('Mark the map');
  expect(r.genuine).toBe(true);
  expect(r.changed).toBe(false);
});

test('edited caption survives save/open, needs review after metadata change, and packs exactly', async ({ page }) => {
  await seed(page);
  await page.click('#openExport');
  const original = await page.locator('#pubCaption').inputValue();
  const edited = `🇧🇩 EDITORIAL LEAD\n${original}`;
  await page.locator('#pubCaption').fill(edited);
  await page.locator('#pubReady').check();
  const before = await page.evaluate(async () => (await import('/src/state.js')).toDocument());
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('#countryList .crow').length > 10);
  await page.evaluate(async (doc) => (await import('/src/restore.js')).restoreDocument(doc), before);
  await page.click('#openExport');
  expect(await page.locator('#pubCaption').inputValue()).toBe(edited);
  await page.locator('#pubNote').fill('Synthetic recount remains open; legal review continuing.');
  await page.locator('#pubNote').dispatchEvent('input');
  await expect(page.locator('#pubBlockers')).toContainText('Metadata changed after the edited caption');
  expect(await page.locator('#pubCaption').inputValue()).toBe(edited);
  await page.locator('#captionRegenerate').click();
  await expect(page.locator('#pubBlockers')).not.toContainText('Metadata changed after the edited caption');
  const regenerated = await page.locator('#pubCaption').inputValue();
  expect(regenerated).toContain('legal review continuing');
  const finalCaption = `🇧🇩 EDITORIAL LEAD\n${regenerated}`;
  await page.locator('#pubCaption').fill(finalCaption);
  await page.locator('#pubReady').check();
  const packed = await page.evaluate(async (now) => {
    const { buildPublicationPack } = await import('/src/publish.js');
    const { EXPORT_PROFILES, unzipStore } = await import('/src/pack.js');
    const p = await buildPublicationPack([EXPORT_PROFILES[0]], { now });
    const files = unzipStore(p.bytes);
    return { caption: new TextDecoder().decode(files['caption.txt']),
      meta: JSON.parse(new TextDecoder().decode(files['metadata.json'])) };
  }, NOW);
  expect(packed.caption).toBe(finalCaption);
  expect(packed.meta.caption.edited).toBe(true);
  expect(packed.meta.publication.updatedAt).toBe('2026-09-30T08:30:00.000Z');
});

test('caption length is explicitly an estimate for Unicode and URLs', async ({ page }) => {
  await seed(page);
  await page.click('#openExport');
  await page.locator('#pubCaption').fill(`🙂 漢 https://example.org/a/long/link?x=1\n${await page.locator('#pubCaption').inputValue()}`);
  const text = await page.locator('#captionCount').textContent();
  expect(text).toContain('Estimated');
  expect(text).toContain('/ 280 weighted characters');
  expect(text).toContain('Unicode and emoji can differ in X');
});

test('an unrenderable second profile aborts the pack with no ZIP result', async ({ page }) => {
  await seed(page);
  const r = await page.evaluate(async (now) => {
    const { approveCurrentMap } = await import('/src/export.js');
    const { buildPublicationPack } = await import('/src/publish.js');
    const { EXPORT_PROFILES } = await import('/src/pack.js');
    approveCurrentMap(now);
    try { await buildPublicationPack([EXPORT_PROFILES[0], { id: 'too-small', label: 'Too small', width: 60, height: 60 }], { now });
      return 'delivered'; } catch (e) { return e.message; }
  }, NOW);
  expect(r).toMatch(/does not fit|too little map space/);
});

test('direct pack-file assembly refuses a missing PNG or an unreviewed map', async ({ page }) => {
  await seed(page);
  const r = await page.evaluate(async (now) => {
    const { currentReview, approveCurrentMap } = await import('/src/export.js');
    const { packContext } = await import('/src/publish.js');
    const { packFiles, EXPORT_PROFILES } = await import('/src/pack.js');
    const fail = (ctx) => { try { packFiles(ctx); return 'built'; } catch (e) { return e.message; } };
    const draft = fail(packContext(currentReview(now), [EXPORT_PROFILES[0]]));
    approveCurrentMap(now);
    const missingPng = fail({ ...packContext(currentReview(now), [EXPORT_PROFILES[0]]), pngs: {} });
    return { draft, missingPng };
  }, NOW);
  expect(r.draft).toContain('approved, unblocked review');
  expect(r.missingPng).toContain('Missing or invalid PNG');
});

test('editing the map while a pack is encoding aborts the whole ZIP', async ({ page }) => {
  await seed(page);
  const error = await page.evaluate(async (now) => {
    const { approveCurrentMap } = await import('/src/export.js');
    const { buildPublicationPack } = await import('/src/publish.js');
    const { EXPORT_PROFILES } = await import('/src/pack.js');
    const { state } = await import('/src/state.js');
    approveCurrentMap(now);
    const building = buildPublicationPack(EXPORT_PROFILES, { now });
    state.title = 'Changed during encoding';
    try { await building; return 'delivered'; } catch (e) { return e.message; }
  }, NOW);
  expect(error).toContain('changed while the pack was being built');
});
