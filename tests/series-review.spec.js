import { test, expect } from '@playwright/test';

test('only the reviewed run receives clean historical badges; changed frames or display are refused', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => document.querySelectorAll('#countryList .crow').length > 10);
  const result = await page.evaluate(async () => {
    const series = await import('/src/series.js');
    const { currentReview, approveCurrentMap } = await import('/src/export.js');
    const options = { from: 1945, to: 1946, scope: 'Europe', grouping: 'family',
      width: 1200, height: 1200, handle: '@test' };
    const plan = await series.planSeries(options);
    const draftManifest = series.manifest();
    await series.renderFrame(0, { handle: '@test' });
    const draftBadge = currentReview().badge;

    // Signing off one map does not sign off an unrelated frame or a series.
    approveCurrentMap();
    await series.renderFrame(1, { handle: '@test' });
    const secondDraft = currentReview().badge;
    const digest = await series.seriesReviewDigest();
    let wrongReceipt = '';
    try { await series.approveSeriesPlan('wrong'); } catch (e) { wrongReceipt = e.message; }
    await series.approveSeriesPlan(digest);
    await series.renderFrame(0, { handle: '@test' });
    const reviewed = { badge: currentReview().badge, manifest: series.manifest() };
    let changedHandle = '';
    try { await series.renderFrame(1, { handle: '@different' }); } catch (e) { changedHandle = e.message; }
    plan.frames[1].recordGaps.push({ unit: 'Fictional gap' });
    let changedFrame = '';
    try { await series.renderFrame(1, { handle: '@test' }); } catch (e) { changedFrame = e.message; }
    return { draftManifest, draftBadge, secondDraft, wrongReceipt, digest, reviewed,
      changedHandle, changedFrame };
  });
  expect(result.draftManifest.review.status).toBe('draft');
  expect(result.draftBadge).toMatch(/^DRAFT · HISTORICAL/);
  expect(result.secondDraft).toMatch(/^DRAFT · HISTORICAL/);
  expect(result.wrongReceipt).toContain('changed since review');
  expect(result.reviewed.badge).toBe('HISTORICAL ARCHIVE · 1945');
  expect(result.reviewed.manifest.review).toMatchObject({ status: 'reviewed', planSha256: result.digest });
  expect(result.reviewed.manifest.items.map((f) => f.year)).toEqual([1945, 1946]);
  expect(result.reviewed.manifest.items[0].recordGaps.map((g) => g.unit)).toContain('Germany');
  expect(result.reviewed.manifest.items[0].coverageNotes.join(' ')).toContain('exile');
  expect(result.changedHandle).toContain('display changed');
  expect(result.changedFrame).toContain('no longer matches');
});
