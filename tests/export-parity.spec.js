/**
 * The standing gate on the split: with the metric on "flat" and no values
 * entered, v2 must still produce byte-identical PNGs to the single-file v1.
 * Everything milestone 2 added rides on top of that path without moving it.
 *
 * v1 is an IIFE with no way in, so the test writes a patched copy that exposes
 * its state and composite(). The original file is never touched.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PARTIES, SEED } from './fixtures/seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const V1 = path.join(ROOT, 'election-map-studio.html');
const TMP = path.join(ROOT, 'tests', '.tmp');

const DOC = {
  title: 'Who governs Europe, 2026',
  sub: 'Party of the sitting head of government',
  handle: '@electionmaps'
};

const SIZES = [
  { name: '16:9', w: 1600, h: 900 },
  { name: 'square', w: 1200, h: 1200 },
  { name: 'portrait', w: 1200, h: 1500 }
];

const VIEWS = [
  { name: 'flat Europe', proj: 'equalEarth', fit: [[-26, 33], [46, 72]], theme: 'dark', labels: true },
  { name: 'globe', proj: 'globe', fit: null, rotate: [-10, -12], theme: 'dark', grat: true },
  { name: 'mercator light', proj: 'mercator', fit: null, theme: 'light' }
];

function patchedV1Url() {
  fs.mkdirSync(TMP, { recursive: true });
  const src = fs.readFileSync(V1, 'utf8');
  const marker = '\n})();\n</script>';
  if (!src.includes(marker)) throw new Error('v1 IIFE tail not found — did the reference file change?');
  const out = src.replace(
    marker,
    '\nwindow.__studio = { state, composite: (w, h) => composite(w, h), render, schedule };\n})();\n</script>'
  );
  const dest = path.join(TMP, 'v1-instrumented.html');
  fs.writeFileSync(dest, out);
  return pathToFileURL(dest).href;
}

/**
 * Load the same document into either version and export it.
 * v1 stores a bare party id per country; v2 stores a record.
 */
async function exportFrom(page, view, size, metric) {
  return page.evaluate(({ doc, parties, seed, view, size, metric }) => {
    const s = window.__studio.state;
    const records = !!metric;
    const assign = {};
    for (const [name, [party, vote, seats, turnout, margin]] of Object.entries(seed)) {
      assign[name] = records ? { party, vote, seats, turnout, margin } : party;
    }
    Object.assign(s, doc, {
      parties, assign,
      proj: view.proj, fit: view.fit, rotate: view.rotate || [-10, -12],
      theme: view.theme || 'dark', grat: !!view.grat, antarctica: false,
      dots: true, labels: !!view.labels,
      zoom: 1, pan: [0, 0], active: parties[0].id
    });
    if (records) { s.metric = metric; s.selected = null; }
    return window.__studio.composite(size.w, size.h).toDataURL('image/png');
  }, { doc: DOC, parties: PARTIES, seed: SEED, view, size, metric });
}

async function openV2(ctx) {
  const page = await ctx.newPage();
  await page.goto('/');
  await page.waitForFunction(() =>
    window.__studio && document.querySelectorAll('#countryList .crow').length > 10);
  return page;
}

test('flat-colour exports are identical to v1', async ({ browser }) => {
  const ctx = await browser.newContext();

  const v1 = await ctx.newPage();
  await v1.goto(patchedV1Url());
  await v1.waitForFunction(() => !!window.__studio);

  const v2 = await openV2(ctx);

  for (const view of VIEWS) {
    for (const size of SIZES) {
      const a = await exportFrom(v1, view, size, null);
      const b = await exportFrom(v2, view, size, 'flat');
      expect(b.length, `${view.name} @ ${size.name}: export is empty`).toBeGreaterThan(1000);
      expect(b === a, `${view.name} @ ${size.name}: PNG differs from v1`).toBe(true);
    }
  }

  await ctx.close();
});

test('each metric produces a different map', async ({ browser }) => {
  const ctx = await browser.newContext();
  const v2 = await openV2(ctx);
  const view = VIEWS[0], size = SIZES[0];

  const seen = new Map();
  for (const metric of ['flat', 'vote', 'seats', 'turnout', 'margin']) {
    const png = await exportFrom(v2, view, size, metric);
    expect(png.length, `${metric}: export is empty`).toBeGreaterThan(1000);
    for (const [other, prev] of seen) {
      expect(png === prev, `${metric} renders identically to ${other}`).toBe(false);
    }
    seen.set(metric, png);
  }

  await ctx.close();
});

test('the ramp is monotonic and stays in the party hue', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await openV2(ctx);

  const steps = await page.evaluate(async () => {
    const { rampSwatches, BINS } = await import('/src/metrics.js');
    return { swatches: rampSwatches('#3B7DD8'), bins: BINS };
  });

  expect(steps.bins).toBe(5);
  expect(steps.swatches).toHaveLength(5);

  // Lightness must fall monotonically, and the hue must not wander off the party.
  const hcl = await page.evaluate((sw) => sw.map((c) => {
    const h = d3.hcl(c);
    return { h: h.h, c: h.c, l: h.l };
  }), steps.swatches);

  for (let i = 1; i < hcl.length; i++) {
    expect(hcl[i].l, `bin ${i} is not darker than bin ${i - 1}`).toBeLessThan(hcl[i - 1].l);
    expect(hcl[i].c, `bin ${i} is not more saturated than bin ${i - 1}`).toBeGreaterThan(hcl[i - 1].c);
  }
  const base = await page.evaluate(() => d3.hcl('#3B7DD8').h);
  for (const step of hcl) expect(Math.abs(step.h - base)).toBeLessThan(1);

  await ctx.close();
});

test('v1 save files still open', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await openV2(ctx);

  const result = await page.evaluate(async () => {
    const { migrate } = await import('/src/state.js');
    const v1doc = { title: 'Old map', assign: { France: 2, Germany: 1 }, parties: [{ id: 1, name: 'A', color: '#fff' }] };
    const out = migrate(v1doc);
    return { france: out.assign.France, metric: out.metric, title: out.title };
  });

  expect(result.france).toEqual({ party: 2, vote: null, seats: null, turnout: null, margin: null });
  expect(result.metric).toBe('flat');
  expect(result.title).toBe('Old map');

  await ctx.close();
});

test('v2 has no console errors on boot', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await page.waitForFunction(() => document.querySelectorAll('#countryList .crow').length > 10);
  expect(errors).toEqual([]);
});
