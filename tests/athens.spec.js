import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function open(page) {
  await page.goto('/');
  await page.waitForFunction(() => document.querySelectorAll('#countryList .crow').length > 10);
}
async function start(page) {
  await open(page);
  await page.click('#startAthens');
  await page.waitForFunction(() => window.__studio.state.explainer?.kind === 'historical-locator');
}

test('starter, save/open and undo preserve the previous document without creating results', async ({ page }) => {
  await open(page);
  const before = await page.evaluate(() => JSON.stringify(window.__studio.state));
  await page.click('#startAthens');
  await page.waitForFunction(() => !!window.__studio.state.explainer);
  await expect(page.locator('#legendTitle')).toHaveText('c. 508–507 BCE');
  await expect(page.locator('#crumb')).toHaveText('Athens historical locator');
  await expect(page.locator('#explainerNote')).toBeVisible();
  const result = await page.evaluate(async () => {
    const { state, toDocument, paint, undo } = await import('/src/state.js');
    const { restoreDocument, validateDocument } = await import('/src/restore.js');
    const saved = structuredClone(toDocument());
    paint('Greece');
    const painted = Object.keys(state.assign);
    await restoreDocument(saved);
    const reopened = JSON.stringify(toDocument());
    await undo(); // file open
    await undo(); // starter
    const old = structuredClone(saved); delete old.explainer; old.version = 6;
    return { saved: JSON.stringify(saved), reopened, painted, after: JSON.stringify(state), legacy: validateDocument(old).explainer };
  });
  expect(result.saved).toBe(result.reopened);
  expect(result.painted).toEqual([]);
  expect(result.after).toBe(before);
  expect(result.legacy).toBeNull();
});

for (const [name, width, height] of [['wide', 1600, 900], ['square', 1200, 1200], ['portrait', 1200, 1500]]) {
  test(`${name}: pair shares exact framing, all citations and facts; individual export matches`, async ({ page }) => {
    await start(page);
    const result = await page.evaluate(async ({ width, height }) => {
      const { state } = await import('/src/state.js');
      const { composite, compositePair } = await import('/src/export.js');
      const original = JSON.stringify(state), texts = [];
      const fillText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function(text, ...args) { texts.push(text); return fillText.call(this, text, ...args); };
      try {
        const pair = compositePair(width, height);
        const collected = texts.join(' ');
        const light = pair.light.canvas.toDataURL();
        state.theme = 'light';
        const individual = composite(width, height).toDataURL();
        state.theme = 'dark';
        const dark = composite(width, height).toDataURL();
        state.theme = JSON.parse(original).theme;
        return { sameLight: light === individual, sameDark: dark === pair.dark.canvas.toDataURL(),
          different: light !== dark, projection: pair.light.report.projection,
          darkProjection: pair.dark.report.projection, locator: pair.light.report.locator,
          text: collected, original, after: JSON.stringify(state) };
      } finally { CanvasRenderingContext2D.prototype.fillText = fillText; }
    }, { width, height });
    expect(result.sameLight).toBe(true); expect(result.sameDark).toBe(true);
    expect(result.different).toBe(true); expect(result.after).toBe(result.original);
    expect(result.projection).toEqual(result.darkProjection);
    expect(result.projection.box[1]).toBeGreaterThan(160 * width / 1600);
    expect(result.locator.country).toBe('Greece');
    for (const phrase of ['10 civic tribes', '500 council members', 'Participation had limits',
      'Modern reference outline', 'not election results', '508–507 BCE',
      'classics.mit.edu', 'oyc.yale.edu', 'britishmuseum.org', 'vocab.getty.edu']) {
      expect(result.text).toContain(phrase);
    }
  });
}

test('bad geography, mixed results and clipped locators refuse rather than fabricate or hide content', async ({ page }) => {
  await start(page);
  const errors = await page.evaluate(async () => {
    const { state, toDocument } = await import('/src/state.js');
    const { validateDocument, restoreDocument } = await import('/src/restore.js');
    const { compositePair } = await import('/src/export.js');
    const before = JSON.stringify(state), errors = [];
    for (const change of [d => d.explainer.point.coordinates = [Infinity, 38],
      d => d.assign.Greece = { party: d.parties[0].id, seats: 500 },
      d => d.mode = 'flags', d => d.metric = 'seats']) {
      const doc = structuredClone(toDocument()); change(doc);
      try { validateDocument(doc); errors.push('accepted'); } catch (e) { errors.push(e.message); }
    }
    const doc = structuredClone(toDocument()); doc.explainer.countryKey = 'Missing country';
    try { await restoreDocument(doc); errors.push('accepted'); } catch (e) { errors.push(e.message); }
    const unchanged = before === JSON.stringify(state);
    state.fit = [[0, 0], [10, 10]];
    try { compositePair(1200, 1200); errors.push('accepted'); } catch (e) { errors.push(e.message); }
    Object.assign(state, JSON.parse(before));
    state.explainer.caveat = 'Long caveat '.repeat(1000);
    try { compositePair(1600, 900); errors.push('accepted'); } catch (e) { errors.push(e.message); }
    return { errors, unchanged };
  });
  expect(errors.unchanged).toBe(true);
  expect(errors.errors).toHaveLength(7);
  expect(errors.errors.every(s => s !== 'accepted')).toBe(true);
  expect(errors.errors[5]).toContain('outside the map frame');
  expect(errors.errors[6]).toContain('too little map space');
});

test('both-theme button downloads canvases from the normal export path and restores selected theme', async ({ page }) => {
  await start(page);
  await page.check('#tTheme');
  await page.click('#openExport');
  await expect(page.locator('#xLegend')).toBeHidden();
  const downloads = [];
  page.on('download', d => downloads.push(d));
  await page.click('#btnThemes');
  await expect.poll(() => downloads.length).toBe(2);
  expect(downloads.map(d => d.suggestedFilename())).toEqual([
    'athens-the-beginnings-of-democracy-paper.png', 'athens-the-beginnings-of-democracy-lamplight.png']);
  await expect(page.locator('#tTheme')).toBeChecked();
  expect(await page.evaluate(() => window.__studio.state.theme)).toBe('light');
  const expected = await page.evaluate(async () => {
    const { composite, compositePair } = await import('/src/export.js');
    const pair = compositePair(2400, 1350);
    return { light: pair.light.canvas.toDataURL().split(',')[1], dark: pair.dark.canvas.toDataURL().split(',')[1],
      previewMatches: document.querySelector('#preview').toDataURL() === composite(1600, 900).toDataURL() };
  });
  expect(expected.previewMatches).toBe(true);
  expect((await readFile(await downloads[0].path())).toString('base64')).toBe(expected.light);
  expect((await readFile(await downloads[1].path())).toString('base64')).toBe(expected.dark);
});

test('theme text has readable contrast and a hidden globe locator refuses export', async ({ page }) => {
  await start(page);
  const result = await page.evaluate(async () => {
    const { state } = await import('/src/state.js');
    const { presentation } = await import('/src/identity.js');
    const { compositePair } = await import('/src/export.js');
    const luminance = hex => {
      const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    };
    const contrast = (a, b) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    const ratios = [];
    for (const theme of ['light', 'dark']) {
      state.theme = theme;
      const t = presentation();
      ratios.push(contrast(luminance(t.text), luminance(t.bg)), contrast(luminance(t.muted), luminance(t.bg)),
        contrast(luminance(t.text), luminance(t.land)), contrast(luminance(t.text), luminance(t.ocean)));
    }
    state.proj = 'globe';
    try { compositePair(1600, 900); return { ratios, refused: false }; }
    catch (error) { return { ratios, refused: /Flat or Mercator/.test(error.message) }; }
  });
  expect(result.refused).toBe(true);
  for (const ratio of result.ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
});

test('importing actual results exits the explainer; undo brings its facts and framing back', async ({ page }) => {
  await start(page);
  const result = await page.evaluate(async () => {
    const { state, undo } = await import('/src/state.js');
    const { buildProposal, applyProposal } = await import('/src/import/proposal.js');
    const { adapterById } = await import('/src/import/adapters.js');
    const original = JSON.stringify(state);
    const draft = await adapterById('archive').propose({ year: '2023', scope: 'Europe', grouping: 'party' });
    applyProposal(buildProposal(draft), { replace: true });
    const exited = state.explainer === null && Object.keys(state.assign).length > 0;
    await undo();
    return { exited, restored: JSON.stringify(state) === original };
  });
  expect(result).toEqual({ exited: true, restored: true });
});
