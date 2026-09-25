/**
 * The import pipeline, end to end, against two tables really copied out of
 * Wikipedia (see tests/fixtures/*.tsv — both captured from the rendered page,
 * ragged rows, footnote markers, doubled link text and all).
 *
 *   wikipedia-ep2024-seats.tsv   English article: most rows should just match
 *   wikipedia-cs-ep2024.tsv      Czech article: diacritics, "5 %", doubled
 *                                country names — rows that must be fixed by
 *                                hand, and then remembered
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

const EN = fixture('wikipedia-ep2024-seats.tsv');
const CS = fixture('wikipedia-cs-ep2024.tsv');

async function open(page) {
  await page.goto('/');
  await page.waitForFunction(() => document.querySelectorAll('#countryList .crow').length > 10);
  await page.waitForSelector('#openImport');
}

/** Paste a table and read the proposal back, without applying it. */
async function propose(page, text) {
  return page.evaluate(async (table) => {
    document.querySelector('#openImport').click();
    document.querySelector('[data-a="clipboard"]').click();
    document.querySelector('#in_text').value = table;
    document.querySelector('#btnPropose').click();
    await new Promise((r) => setTimeout(r, 200));

    const rows = [...document.querySelectorAll('.rrow')].map((el) => ({
      status: el.dataset.s,
      raw: el.querySelector('.raw').textContent.trim(),
      unit: el.querySelector('.unitpick').value
    }));
    return {
      rows,
      counts: [...document.querySelectorAll('.count')].map((el) => el.textContent.trim().replace(/\s+/g, ' ')),
      roles: [...document.querySelectorAll('.colrole')].map((s) => s.value),
      applyLabel: document.querySelector('#btnApply').textContent.trim(),
      applyDisabled: document.querySelector('#btnApply').disabled
    };
  }, text);
}

test('a real Wikipedia table matches most rows and applies', async ({ page }) => {
  await open(page);
  const r = await propose(page, EN);

  const matched = r.rows.filter((x) => x.status === 'matched');
  expect(matched.length, 'most of the 27 member states should match').toBeGreaterThanOrEqual(25);

  // The first column is the region and the seats column was read as seats.
  expect(r.roles[0]).toBe('unit');
  expect(r.roles[1]).toBe('seats');

  // "Czech Republic" reaches Czechia through the built-in alias table.
  const czech = r.rows.find((x) => x.raw.startsWith('Czech'));
  expect(czech.unit).toBe('Czechia');

  const applied = await page.evaluate(async () => {
    document.querySelector('#btnApply').click();
    await new Promise((r) => setTimeout(r, 200));
    const { state } = await import('/src/state.js');
    return {
      assigned: Object.keys(state.assign).length,
      czechia: state.assign['Czechia'],
      austria: state.assign['Austria'],
      provenance: state.provenance
    };
  });

  expect(applied.assigned).toBeGreaterThanOrEqual(25);
  expect(applied.czechia.seats).toBe(21);
  expect(applied.austria.seats).toBe(20);
  expect(applied.provenance.source).toBe('Pasted table');
});

test('undo puts the map back in one step', async ({ page }) => {
  await open(page);

  const before = await page.evaluate(async () => {
    const { state, toggleCountry } = await import('/src/state.js');
    // Give the map something to lose, so "restored" means something.
    toggleCountry('Brazil');
    toggleCountry('Argentina');
    return JSON.stringify({ parties: state.parties, assign: state.assign, provenance: state.provenance });
  });

  await propose(page, EN);

  const after = await page.evaluate(async () => {
    document.querySelector('#btnApply').click();
    await new Promise((r) => setTimeout(r, 200));
    const { state, undo } = await import('/src/state.js');
    const applied = Object.keys(state.assign).length;
    undo();
    return {
      applied,
      restored: JSON.stringify({ parties: state.parties, assign: state.assign, provenance: state.provenance })
    };
  });

  expect(after.applied).toBeGreaterThan(20);
  expect(after.restored, 'one undo must restore the document exactly').toBe(before);
});

test('merging leaves units the table never mentions alone', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const { toggleCountry } = await import('/src/state.js');
    toggleCountry('Brazil');
  });

  await propose(page, EN);
  const r = await page.evaluate(async () => {
    document.querySelector('#btnApply').click();
    await new Promise((r) => setTimeout(r, 200));
    const { state } = await import('/src/state.js');
    return { brazil: !!state.assign['Brazil'], austria: !!state.assign['Austria'] };
  });

  expect(r.brazil, 'a merge must not clear what the table is silent about').toBe(true);
  expect(r.austria).toBe(true);
});

test('replace all is a separate, explicit choice', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const { toggleCountry } = await import('/src/state.js');
    toggleCountry('Brazil');
  });

  await propose(page, EN);
  const r = await page.evaluate(async () => {
    document.querySelector('#xReplace').checked = true;
    document.querySelector('#btnApply').click();
    await new Promise((r) => setTimeout(r, 200));
    const { state } = await import('/src/state.js');
    return { brazil: !!state.assign['Brazil'], austria: !!state.assign['Austria'] };
  });

  expect(r.brazil).toBe(false);
  expect(r.austria).toBe(true);
});

test('a name fixed by hand is remembered and matches on its own next time', async ({ page }) => {
  await open(page);

  // The Czech article writes every country in Czech, and the link text is
  // doubled by the flag icon: "Belgie Belgie". Nothing here can match.
  const first = await propose(page, CS);
  const unmatchedFirst = first.rows.filter((x) => x.status === 'unmatched').length;
  expect(unmatchedFirst, 'Czech names should fail honestly, not be guessed').toBeGreaterThan(15);

  // Fix three of them by hand, exactly as a person would.
  const fixes = { 'Belgie Belgie': 'Belgium', 'Česko Česko': 'Czechia', 'Německo Německo': 'Germany' };
  const fixed = await page.evaluate(async (map) => {
    const rows = [...document.querySelectorAll('.rrow')];
    let n = 0;
    for (const [raw, unit] of Object.entries(map)) {
      const el = rows.find((r) => r.querySelector('.raw').textContent.trim() === raw);
      if (!el) continue;
      const input = el.querySelector('.unitpick');
      input.value = unit;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 60));
      n++;
    }
    document.querySelector('#btnApply').click();
    await new Promise((r) => setTimeout(r, 200));
    const { state } = await import('/src/state.js');
    return { n, assigned: Object.keys(state.assign).length, aliases: state.aliases };
  }, fixes);

  expect(fixed.n).toBe(3);
  expect(fixed.assigned).toBe(3);
  expect(fixed.aliases.world['belgie belgie']).toBe('Belgium');

  // Re-paste the same table. The three corrections should now match on their own.
  const second = await propose(page, CS);
  for (const [raw, unit] of Object.entries(fixes)) {
    const row = second.rows.find((x) => x.raw === raw);
    expect(row, `${raw} missing from the second proposal`).toBeTruthy();
    expect(row.unit, `${raw} was not remembered`).toBe(unit);
    expect(row.status).toBe('matched');
  }
  // And nothing else was quietly learned along with them.
  expect(second.rows.filter((x) => x.status === 'matched').length).toBe(3);
});

test('two rows claiming one unit are flagged, not silently merged', async ({ page }) => {
  await open(page);
  const r = await propose(page, 'Region\tParty\nFrance\tA\nFrance\tB\nSpain\tC');

  const statuses = r.rows.map((x) => x.status).sort();
  expect(statuses).toEqual(['duplicate', 'matched', 'matched']);

  const warned = await page.evaluate(() =>
    [...document.querySelectorAll('.warns li')].map((li) => li.textContent.trim()));
  expect(warned.some((w) => /2 rows resolve to France/.test(w))).toBe(true);
});

test('fuzzy never auto-applies, it only ranks the dropdown', async ({ page }) => {
  await open(page);
  // "Frnace" is one transposition from France. It must not match.
  const r = await propose(page, 'Region\tParty\nFrnace\tA');
  expect(r.rows[0].status).toBe('unmatched');
  expect(r.rows[0].unit).toBe('');

  const suggested = await page.evaluate(async () => {
    const { rankCandidates, buildIndex } = await import('/src/import/match.js');
    const { unitList } = await import('/src/geo.js');
    return rankCandidates('Frnace', buildIndex(unitList()), 5);
  });
  expect(suggested, 'France should still be offered as a suggestion').toContain('France');
});
