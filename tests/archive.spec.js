/**
 * Stage 1 of the historical archive: governing.json, and the map built from it.
 *
 * The claims worth testing here are about honesty, not pixels — that a year
 * with no data stays unassigned, that coverage is counted and reported, and
 * that a party with no family never gets given a family's colour.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOVERNING = path.resolve(__dirname, '..', 'public', 'data', 'governing.json');

async function open(page) {
  await page.goto('/');
  await page.waitForFunction(() => document.querySelectorAll('#countryList .crow').length > 10);
  await page.waitForSelector('#openImport');
}

test('governing.json intervals are ordered and do not overlap', () => {
  const gov = JSON.parse(fs.readFileSync(GOVERNING, 'utf8'));
  const countries = Object.entries(gov.countries);
  expect(countries.length).toBeGreaterThan(30);

  for (const [iso3, c] of countries) {
    let prev = null;
    for (const iv of c.intervals) {
      expect(iv.from, `${iso3}: cabinet with no start date`).toBeTruthy();
      if (prev) {
        expect(prev.from <= iv.from, `${iso3}: intervals out of order`).toBe(true);
        expect(prev.to, `${iso3}: ${prev.name} does not end where ${iv.name} starts`).toBe(iv.from);
      }
      prev = iv;
    }
    expect(prev.to, `${iso3}: the last cabinet should be open-ended`).toBe(null);
  }
});

test('every cabinet names the party family it will be coloured by', () => {
  const gov = JSON.parse(fs.readFileSync(GOVERNING, 'utf8'));
  const families = new Set();
  for (const c of Object.values(gov.countries)) {
    for (const iv of c.intervals) {
      for (const p of iv.parties) {
        expect(p).toHaveProperty('family');   // null is a valid answer, absent is not
        if (p.family) families.add(p.family);
      }
    }
  }
  // 'none' and 'code' are not families and must never appear as one.
  expect(families.has('none')).toBe(false);
  expect(families.has('code')).toBe(false);
  expect(families.size).toBeGreaterThan(5);
});

/**
 * The archive goes through the same pipeline as a pasted table: an adapter
 * produces a draft, buildProposal matches it, applyProposal applies it. If it
 * needed a path of its own, the abstraction would not be real.
 */
async function applyArchive(page, inputs) {
  return page.evaluate(async (args) => {
    const { adapterById } = await import('/src/import/adapters.js');
    const { buildProposal, applyProposal, counts } = await import('/src/import/proposal.js');
    const { state } = await import('/src/state.js');

    const draft = await adapterById('archive').propose(args);
    const proposal = buildProposal(draft);
    const before = counts(proposal);
    const result = applyProposal(proposal);

    return {
      before,
      result,
      provenance: state.provenance,
      assigned: Object.keys(state.assign).length,
      parties: state.parties.filter((x) => Object.values(state.assign).some((a) => a.party === x.id))
        .map((x) => ({ name: x.name, color: x.color, hatch: !!x.hatch, key: x.slotKey })),
      spain: state.assign['Spain'] || null,
      uk: state.assign['United Kingdom'] || null,
      title: state.title,
      fit: state.fit
    };
  }, inputs);
}

test('the archive is just another adapter', async ({ page }) => {
  await open(page);
  const r = await applyArchive(page, { year: 1977, scope: 'Europe', grouping: 'family' });

  expect(r.before.unmatched, 'every ParlGov country should match the map').toBe(0);
  expect(r.result.applied).toBe(r.assigned);

  expect(r.provenance.source).toBe('ParlGov 2024');
  expect(r.provenance.asOf).toBe('1977-01-01');
  expect(r.provenance.covered).toBe(r.assigned);

  // Spain has no ParlGov cabinet in 1977 and must not be guessed at.
  expect(r.spain).toBe(null);
  expect(r.uk).not.toBe(null);
  expect(r.uk.label).toBe('Labour');

  // The denominator counts the chosen scope, not ParlGov's whole universe.
  expect(r.provenance.universe.length).toBeLessThan(37);
  expect(r.provenance.universe.length).toBeGreaterThan(r.assigned);

  // Framed to its own data, and titled by what it shows.
  expect(r.title).toBe('Who governed, 1977');
  expect(r.fit).not.toBe(null);
});

test('a party with no family is hatched, never given a family colour', async ({ page }) => {
  await open(page);
  const r = await applyArchive(page, { year: 1977, scope: 'Europe', grouping: 'family' });

  const none = r.parties.find((p) => p.key === 'family:none');
  expect(none, 'France had a non-partisan head of government in 1977').toBeTruthy();
  expect(none.hatch, 'no family must read as hatching, not as a second grey').toBe(true);

  for (const p of r.parties) {
    if (p.key !== 'family:none') expect(p.hatch).toBe(false);
  }
});

test('scope changes what is mapped and what it is counted against', async ({ page }) => {
  await open(page);
  const europe = await applyArchive(page, { year: 1977, scope: 'Europe', grouping: 'family' });
  const world = await applyArchive(page, { year: 1977, scope: 'World', grouping: 'family' });

  expect(world.assigned).toBeGreaterThan(europe.assigned);
  expect(world.provenance.universe.length).toBeGreaterThan(europe.provenance.universe.length);
});

/*
 * The three checks above all land on 1 January over a cabinet that began months
 * earlier — the comfortable interior of a half-open interval. These two sit on
 * the edges, where an off-by-one in `from <= date && date < to` actually shows.
 */

test('a date exactly on a cabinet start date belongs to that cabinet', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const { cabinetOn, loadGoverning } = await import('/src/archive.js');
    await loadGoverning();
    return {
      // Belgium, Tindemans III starts 1977-03-06, Tindemans II ends there.
      onStart: cabinetOn('BEL', '1977-03-06').name,
      dayBefore: cabinetOn('BEL', '1977-03-05').name,
      onNextStart: cabinetOn('BEL', '1977-06-03').name,
      dayBeforeNext: cabinetOn('BEL', '1977-06-02').name
    };
  });

  expect(r.onStart, 'a start date must belong to the cabinet starting').toBe('Tindemans III');
  expect(r.dayBefore, 'the day before belongs to the outgoing cabinet').toBe('Tindemans II');
  expect(r.onNextStart).toBe('Tindemans IV');
  expect(r.dayBeforeNext).toBe('Tindemans III');
});

test('a country with several cabinets in one year resolves each of them', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const { cabinetOn, loadGoverning } = await import('/src/archive.js');
    await loadGoverning();
    // Belgium had three cabinets in 1980, Italy two in 1972.
    return {
      bel: ['1980-01-23', '1980-03-01', '1980-05-18', '1980-09-01', '1980-10-22', '1980-12-31']
        .map((d) => cabinetOn('BEL', d).name),
      ita: ['1972-02-17', '1972-07-25', '1972-07-26', '1972-12-31']
        .map((d) => cabinetOn('ITA', d).name),
      // 1 January 1980 is still the cabinet that began in 1979.
      belNewYear: cabinetOn('BEL', '1980-01-01').name
    };
  });

  expect(r.bel).toEqual([
    'Martens II', 'Martens II', 'Martens III', 'Martens III', 'Martens IV', 'Martens IV'
  ]);
  expect(r.ita).toEqual(['Andreotti I', 'Andreotti I', 'Andreotti II', 'Andreotti II']);
  expect(r.belNewYear).not.toBe('Martens II');
});

test('a year beyond the release is refused, not extrapolated', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const { adapterById } = await import('/src/import/adapters.js');
    const { cabinetOn, lastCoveredDate, loadGoverning } = await import('/src/archive.js');
    await loadGoverning();

    let refused = null;
    try {
      await adapterById('archive').propose({ year: 2200, scope: 'Europe', grouping: 'family' });
    } catch (err) {
      refused = err.message;
    }
    return {
      refused,
      beyond: cabinetOn('GBR', '2035-01-01'),
      last: lastCoveredDate()
    };
  });

  expect(r.refused, 'a year past the release must be refused, not silently mapped').toBeTruthy();
  expect(r.beyond, 'an open-ended cabinet must not run forever').toBe(null);
  expect(r.last.slice(0, 4) <= '2024').toBe(true);
});

test('the export names its source and how much it covers', async ({ page }) => {
  await open(page);
  await applyArchive(page, { year: 1977, scope: 'Europe', grouping: 'family' });

  const out = await page.evaluate(async () => {
    const { state } = await import('/src/state.js');
    const cv = window.__studio.composite(1600, 900);
    // Read the footer strip back, to prove the line is drawn and not just held.
    const ctx = cv.getContext('2d');
    const strip = ctx.getImageData(0, Math.round(cv.height * 0.88), cv.width, Math.round(cv.height * 0.08));
    let ink = 0;
    for (let i = 0; i < strip.data.length; i += 4) if (strip.data[i] > 90) ink++;
    return { ink, provenance: state.provenance, bytes: cv.toDataURL('image/png').length };
  });

  expect(out.bytes).toBeGreaterThan(1000);
  expect(out.provenance.covered).toBeGreaterThan(0);
  expect(out.ink, 'the provenance footer should actually be painted').toBeGreaterThan(200);
});

test('colour overrides survive re-running the same year', async ({ page }) => {
  await open(page);
  await applyArchive(page, { year: 1977, scope: 'Europe', grouping: 'family' });

  const result = await page.evaluate(async () => {
    const { state, setPartyColor } = await import('/src/state.js');
    const target = state.parties.find((p) => p.slotKey);
    setPartyColor(target, '#123456');
    return { key: target.slotKey, stored: state.overrides[target.slotKey] };
  });

  expect(result.stored).toBe('#123456');

  const after = await applyArchive(page, { year: 1977, scope: 'Europe', grouping: 'family' });
  const again = after.parties.find((p) => p.key === result.key);
  expect(again, 'the party slot disappeared on re-run').toBeTruthy();
  expect(again.color, 'the override was wiped by re-running the year').toBe('#123456');
});

/* ------------------------------------------------- gaps in the record */

/**
 * A cabinet does not stay in office because ParlGov stopped writing.
 *
 * These are the two errors the 1945–2023 run put on screen: the archive derives
 * each cabinet's end from the next one's start, so the last cabinet before a
 * silence expands to fill it. See docs/archive-gaps.md.
 */
test('a cabinet does not outlive the record that describes it', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const { loadGoverning, cabinetRecordOn, MAX_CABINET_YEARS } = await import('/src/archive.js');
    await loadGoverning();
    const at = (iso, date) => {
      const rec = cabinetRecordOn(iso, date);
      return {
        name: rec.cabinet ? rec.cabinet.name : null,
        reason: rec.reason,
        years: rec.gap ? rec.gap.years : null
      };
    };
    return {
      cap: MAX_CABINET_YEARS,
      // Real while it was real …
      germany1935: at('DEU', '1935-01-01'),
      // … and refused once the interval is only the record running out.
      germany1945: at('DEU', '1945-01-01'),
      germany1948: at('DEU', '1948-01-01'),
      // The first properly recorded post-war cabinet is unaffected.
      germany1950: at('DEU', '1950-01-01'),
      // A chancellor killed in 1934 does not govern Austria in 1945.
      austria1945: at('AUT', '1945-01-01'),
      austria1946: at('AUT', '1946-01-01'),
      // Denmark is the case the cap does NOT fix, kept here so the limit is
      // asserted rather than forgotten: on 1 January 1945 this cabinet is 5.75
      // years old, inside the cap, and Stauning had been dead for two of them.
      denmark1945: at('DNK', '1945-01-01'),
      // It is caught a few months later, which is the shape of the residue:
      // the cap bounds the error, it does not eliminate it.
      denmark1945may: at('DNK', '1945-04-20'),
      // And an ordinary long ministry is left alone.
      canada1916: at('CAN', '1916-01-01'),
      ireland2015: at('IRL', '2015-01-01')
    };
  });

  expect(r.cap).toBe(6);

  expect(r.germany1935.name).toBe('Hitler');
  expect(r.germany1945.name).toBe(null);
  expect(r.germany1945.reason).toBe('record gap');
  expect(r.germany1945.years).toBeGreaterThan(6);
  expect(r.germany1948.name).toBe(null);
  expect(r.germany1950.name).toMatch(/Adenauer/);

  expect(r.austria1945.name).toBe(null);
  expect(r.austria1945.reason).toBe('record gap');
  expect(r.austria1946.name).toMatch(/Figl/);

  /*
   * Documented, not fixed. Tightening the cap to catch this would cut Canada's
   * Borden ministry (6.0 years, genuine) and Luxembourg's Bech I (5.7, genuine),
   * so the threshold stays where the data separates and the remaining error is
   * written down instead. docs/archive-gaps.md names it and the Netherlands.
   */
  expect(r.denmark1945.name).toBe('Stauning V');
  expect(r.denmark1945may.name).toBe(null);
  expect(r.denmark1945may.reason).toBe('record gap');

  // The threshold was measured against these, not chosen around them.
  expect(r.canada1916.name).toMatch(/Borden/);
  expect(r.ireland2015.name).toMatch(/Kenny/);
});

test('a map of 1945 does not colour a country the archive cannot vouch for', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => document.querySelectorAll('#countryList .crow').length > 10);
  const r = await page.evaluate(async () => {
    const { loadGoverning, governingOn } = await import('/src/archive.js');
    await loadGoverning();
    const g = governingOn('1945-01-01');
    return {
      covered: g.covered.map((c) => c.iso3).sort(),
      gaps: g.gaps.map((c) => `${c.iso3} ${c.lastCabinet} +${c.years}y`).sort()
    };
  });

  // Germany and Austria are no longer coloured in 1945 …
  expect(r.covered).not.toContain('DEU');
  expect(r.covered).not.toContain('AUT');
  // … and the reason is recorded rather than the country just vanishing.
  expect(r.gaps.join(' ')).toMatch(/DEU Hitler/);
  expect(r.gaps.join(' ')).toMatch(/AUT Dollfuss/);

  // The countries with a real 1945 record are untouched.
  expect(r.covered).toContain('GBR');
  expect(r.covered).toContain('SWE');
});
