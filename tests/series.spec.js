/**
 * A run of frames that reads as a sequence.
 *
 * The claim these tests have to earn is "the frame does not move between any
 * two frames", and the only honest way to check it is to look at the pixels.
 * Reasoning about the projection is not enough: the projection is fitted to
 * whatever is left after the footer, and the footer's height depends on how
 * many legend rows a frame needs — so a run can be correctly framed and still
 * twitch, for a reason that never appears in the framing code.
 */

import { test, expect } from '@playwright/test';

const RUN = { from: 1975, to: 1983, scope: 'Europe', grouping: 'family', width: 800, height: 450 };

async function open(page) {
  await page.goto('/');
  await page.waitForFunction(() => document.querySelectorAll('#countryList .crow').length > 10);
}

/**
 * The land silhouette of a frame: every pixel inside the map panel that is not
 * the ocean colour. If two frames share a projection, their coastlines fall on
 * exactly the same pixels however differently they are coloured in.
 */
const SILHOUETTE = `(cv) => {
  const c = cv.getContext('2d');
  const d = c.getImageData(0, 0, cv.width, cv.height).data;
  const at = (x, y) => {
    const i = (y * cv.width + x) * 4;
    return [d[i], d[i + 1], d[i + 2]];
  };
  // dark theme: ocean #101C27. A tolerance keeps antialiased coast out of it.
  const isOcean = ([r, g, b]) =>
    Math.abs(r - 0x10) < 10 && Math.abs(g - 0x1C) < 10 && Math.abs(b - 0x27) < 10;

  // The map panel is the only thing filled with ocean, so its rows locate it.
  // Restricting to the panel is the whole point: the title says a different
  // year in every frame and the legend has different entries, so a mask over
  // the whole canvas measures the caption changing and calls it movement.
  // A row counts as panel only when a real stretch of it is ocean. A single
  // matching pixel is not evidence: antialiased title text over the page colour
  // lands within tolerance of the ocean colour often enough to shift the
  // detected top by a few pixels and report movement that is not there.
  const MIN_OCEAN = Math.round(cv.width / 20);
  let top = -1, bot = -1;
  for (let y = 0; y < cv.height; y++) {
    let n = 0;
    for (let x = 0; x < cv.width && n < MIN_OCEAN; x++) if (isOcean(at(x, y))) n++;
    if (n >= MIN_OCEAN) { if (top < 0) top = y; bot = y; }
  }
  if (top < 0) return { top: -1, bot: -1, bits: [] };

  const bits = [];
  for (let y = top; y <= bot; y++) {
    for (let x = 0; x < cv.width; x++) bits.push(isOcean(at(x, y)) ? 0 : 1);
  }
  return { top, bot, bits };
}`;

test('the frame does not move between any two frames', async ({ page }) => {
  await open(page);

  const r = await page.evaluate(async ({ run, silhouetteSrc }) => {
    const { planSeries, renderFrame } = await import('/src/series.js');
    const silhouette = eval(silhouetteSrc);
    const plan = await planSeries(run);

    // Frames deliberately chosen to differ in coverage: the whole risk is that
    // a year covering more countries gets a taller legend and a shorter map.
    const shots = [];
    for (let i = 0; i < plan.frames.length; i++) {
      const out = await renderFrame(i, { handle: '@electionmaps' });
      const cv = document.createElement('canvas');
      cv.width = run.width; cv.height = run.height;
      await new Promise((res) => {
        const img = new Image();
        img.onload = () => { cv.getContext('2d').drawImage(img, 0, 0); res(); };
        img.src = out.dataUrl;
      });
      const sil = silhouette(cv);
      shots.push({
        year: out.frame.year,
        covered: out.frame.coverage.covered,
        projection: out.projection,
        top: sil.top, bot: sil.bot, bits: sil.bits
      });
    }

    // Compare every frame against the first.
    const diffs = shots.slice(1).map((s) => {
      let n = 0;
      const len = Math.max(s.bits.length, shots[0].bits.length);
      for (let i = 0; i < len; i++) if (s.bits[i] !== shots[0].bits[i]) n++;
      return {
        year: s.year,
        differing: n,
        top: s.top,
        bot: s.bot,
        projection: s.projection
      };
    });

    return {
      frames: shots.length,
      coverage: shots.map((s) => s.covered),
      panel: { top: shots[0].top, bot: shots[0].bot },
      first: shots[0].projection,
      landPixels: shots[0].bits.reduce((a, b) => a + b, 0),
      diffs,
      fit: plan.fit,
      legendRows: plan.legendRows
    };
  }, { run: RUN, silhouetteSrc: SILHOUETTE });

  expect(r.frames).toBeGreaterThan(5);
  // There is genuinely something to get wrong: coverage is not constant.
  expect(new Set(r.coverage).size).toBeGreaterThan(1);
  expect(r.landPixels).toBeGreaterThan(5000);

  /*
   * The decisive check: every frame was drawn through an identical projection,
   * into an identical box. This is the claim itself, not a proxy for it.
   */
  expect(r.first).toBeTruthy();
  for (const d of r.diffs) {
    expect(d.projection.scale, `${d.year} scale`).toBe(r.first.scale);
    expect(d.projection.translate, `${d.year} translate`).toEqual(r.first.translate);
    expect(d.projection.box, `${d.year} map box`).toEqual(r.first.box);
    expect(d.projection.probe, `${d.year} reference points`).toEqual(r.first.probe);
  }

  // The painted panel occupies the same rows in every frame.
  for (const d of r.diffs) {
    expect(d.top, `${d.year} panel starts elsewhere`).toBe(r.panel.top);
    expect(d.bot, `${d.year} panel ends elsewhere`).toBe(r.panel.bot);
  }

  /*
   * And the coastline is where it was, to within antialiasing.
   *
   * This cannot be asserted at zero and it is worth saying why, because "178
   * pixels differ" looked like movement and was not. A coast pixel is a blend
   * of the ocean and whatever lies inland of it; when a country changes from
   * the unassigned grey to a party's red, that blend changes, and a threshold
   * classifying pixels as ocean or land flips some of them. The geometry did
   * not move — the projection above proves that — so what is left is a bound on
   * edge noise, not a tolerance on framing.
   */
  const panelPixels = (r.panel.bot - r.panel.top + 1) * RUN.width;
  for (const d of r.diffs) {
    expect(d.differing / panelPixels, `${d.year} differs by ${d.differing} px`)
      .toBeLessThan(0.005);
  }

  expect(r.fit).toBeTruthy();
  expect(r.legendRows).toBeGreaterThan(0);
});

test('an unlocked legend is what would have moved it', async ({ page }) => {
  /*
   * The guard earns its place only if the thing it guards against is real, and
   * on the acceptance run it is. Coverage climbs from 10 governments in 1945 to
   * 31 in 2023, and the number of distinct party families on the map climbs
   * with it — three in 1945, nine in 2019. Nine do not fit on one legend row at
   * 1600px and three do, so without the reservation the footer is a row taller
   * in the later years, the map is drawn into a shorter box, and the whole of
   * Europe quietly shrinks partway through the sequence.
   *
   * This is the same grouping, scope and width the acceptance run uses.
   */
  await open(page);
  const r = await page.evaluate(async () => {
    const { state } = await import('/src/state.js');
    const { composite, legendRowsAt } = await import('/src/export.js');
    const { adapterById } = await import('/src/import/adapters.js');
    const { buildProposal, applyProposal } = await import('/src/import/proposal.js');
    const { boundsOf } = await import('/src/geo.js');

    const load = async (year) => {
      const d = await adapterById('archive').propose({
        year: String(year), scope: 'Europe', grouping: 'family' });
      applyProposal(buildProposal(d), { replace: true });
      state.fit = boundsOf(['France', 'Poland', 'Norway', 'Italy'], 0.12);
      state.zoom = 1; state.pan = [0, 0]; state.metric = 'flat';
      return legendRowsAt(1600);
    };

    // The height of the box the map is actually drawn into, as composite
    // reports it. Measuring painted pixels down a column does not answer this:
    // the topmost and bottommost ink on the image are the title and the handle,
    // which sit at fixed offsets and barely move while the map box underneath
    // them changes by a whole legend row.
    const boxH = (o) => {
      const report = {};
      // Hold source/coverage caveat space constant to isolate legend jitter.
      composite(1600, 900, { lockFooterRows: { source: 2, limitations: 3 }, ...o, report });
      return report.projection.box[1];
    };

    const early = await load(1945);
    const looseEarly = boxH({});
    const lockedEarly = boxH({ lockLegendRows: 2 });

    const late = await load(2019);
    const looseLate = boxH({});
    const lockedLate = boxH({ lockLegendRows: 2 });

    return { early, late, looseEarly, looseLate, lockedEarly, lockedLate };
  });

  // The two years really do want different legend heights.
  expect(r.late).toBeGreaterThan(r.early);

  // Unlocked, the map box is a legend row shorter in the later year. That is
  // the jitter, measured before it reaches anyone's eye.
  expect(r.looseEarly - r.looseLate).toBeGreaterThan(20);

  // Locked, both years get the same box.
  expect(r.lockedLate).toBe(r.lockedEarly);
});

/* ---------------------------------------------------------------- palette */

test('a family holds one colour across the run, present or not', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async ({ run }) => {
    const { planSeries } = await import('/src/series.js');
    const { state } = await import('/src/state.js');
    const { FAMILIES } = await import('/src/families.js');

    const plan = await planSeries({ ...run, from: 1945, to: 1990 });
    const slotOf = (key) => state.parties.find((p) => p.slotKey === key);

    // Every family has a slot before a single frame is drawn, including the
    // ones that govern nowhere in this range.
    const seeded = FAMILIES.map((f) => {
      const p = slotOf('family:' + f.id);
      return { id: f.id, has: !!p, color: p ? p.color : null, expected: f.color };
    });

    // A family that appears in no frame at all still holds its slot.
    const everSeen = new Set(plan.frames.flatMap((f) => f.familiesSeen));
    const absent = FAMILIES.filter((f) => !everSeen.has('family:' + f.id)).map((f) => f.id);

    return {
      seeded,
      absent,
      absentStillSlotted: absent.every((id) => !!slotOf('family:' + id)),
      unclassified: !!slotOf('family:none'),
      frames: plan.frames.length
    };
  }, { run: RUN });

  for (const s of r.seeded) {
    expect(s.has, `${s.id} has no slot`).toBe(true);
    expect(s.color, `${s.id} drifted`).toBe(s.expected);
  }
  // Governing parties ParlGov has not classified get a stable slot too, and it
  // is not a family colour — it is the unassigned tone plus a hatch.
  expect(r.unclassified).toBe(true);
  expect(r.absentStillSlotted).toBe(true);
});

test('colours are identical in the first and last frame that uses them', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const { planSeries, renderFrame } = await import('/src/series.js');
    const { state } = await import('/src/state.js');
    const plan = await planSeries({ from: 1945, to: 2023, scope: 'Europe', grouping: 'family' });

    const snap = [];
    for (const i of [0, Math.floor(plan.frames.length / 2), plan.frames.length - 1]) {
      await renderFrame(i, {});
      snap.push({
        year: plan.frames[i].year,
        palette: state.parties.filter((p) => p.slotKey)
          .map((p) => `${p.slotKey}=${p.color}`).sort()
      });
    }
    return { snap, frames: plan.frames.length };
  });

  expect(r.frames).toBeGreaterThan(70);
  expect(r.snap[1].palette).toEqual(r.snap[0].palette);
  expect(r.snap[2].palette).toEqual(r.snap[0].palette);
});

/* --------------------------------------------------------------- manifest */

test('the manifest accounts for every frame', async ({ page }) => {
  await open(page);
  const m = await page.evaluate(async () => {
    const { planSeries, manifest } = await import('/src/series.js');
    await planSeries({ from: 1945, to: 2023, scope: 'Europe', grouping: 'family' });
    return manifest();
  });

  expect(m.items.length).toBe(m.frames);
  expect(m.frames).toBeGreaterThan(70);

  for (const f of m.items) {
    expect(f.year, 'a frame with no year').toBeTruthy();
    expect(f.file).toBe(`${f.year}.png`);
    expect(f.coverage.covered).toBeGreaterThan(0);
    expect(f.source.label, `${f.year} names no source`).toBeTruthy();
    expect(f.source.licence).toMatch(/CC0/);
    // Every frame says what it is drawn on, including that the year is unstated.
    expect(f.boundaries, `${f.year} names no boundaries`).toBeTruthy();
    expect(f.boundaries.agency).toBeTruthy();
    expect(f.boundaries.licence).toBeTruthy();
    expect(typeof f.boundaries.vintageStated).toBe('boolean');
  }

  // One line per licence actually in play, not a guess at a common one.
  expect(m.licences.length).toBeGreaterThan(1);
  expect(m.licences.some((l) => /CC0/.test(l))).toBe(true);

  // The frame and the palette are stated, so "nothing moved" is checkable from
  // the manifest without opening a single PNG.
  expect(m.lockedFrame).toBeTruthy();
  expect(m.lockedLegendRows).toBeGreaterThan(0);
  expect(m.palette.length).toBeGreaterThan(8);
});

test('the manifest says which frames predate the borders they are drawn on', async ({ page }) => {
  await open(page);
  const m = await page.evaluate(async () => {
    const { planSeries, manifest } = await import('/src/series.js');
    await planSeries({ from: 1945, to: 2023, scope: 'Europe', grouping: 'family' });
    return manifest();
  });

  // Natural Earth states no year for its borders, so every frame is listed as
  // resting on boundaries of unstated vintage. That is not the same as saying
  // there is no gap, and the manifest does not pretend it is.
  expect(m.boundariesWithNoStatedVintage.length).toBe(m.frames);

  // And the gaps that *can* be named are named, per frame.
  const flagged = new Map(m.framesWithBorderCaveats.map((f) => [f.year, f.caveats]));
  expect(flagged.get(1977), 'a 1977 map is drawn on a unified Germany').toContain('germany');

  // A caveat is raised only for units actually in frame. ParlGov's European
  // coverage in 1977 holds no Soviet republic, so no map of it claims one —
  // warning about the USSR on a map that does not show it would be noise, and
  // noise is how a caveat stops being read.
  expect(flagged.get(1977)).not.toContain('ussr');

  // After reunification, that particular caveat stops being made.
  expect(flagged.get(1995) || []).not.toContain('germany');

  // A frame that is flagged says so in words, not only by id.
  const byYear = new Map(m.items.map((f) => [f.year, f]));
  const germany = byYear.get(1977).caveats.find((c) => c.id === 'germany');
  expect(germany.what).toMatch(/1990/);
  expect(germany.what).toMatch(/drawn on/);
});

/* ------------------------------------------------------- coverage honesty */

test('every frame carries its own coverage count', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const { planSeries, renderFrame, manifest } = await import('/src/series.js');
    const plan = await planSeries({ from: 1945, to: 2023, scope: 'Europe', grouping: 'family' });
    const { state } = await import('/src/state.js');

    const first = plan.frames[0];
    const last = plan.frames[plan.frames.length - 1];

    await renderFrame(0, {});
    const firstProv = { covered: state.provenance.covered };
    await renderFrame(plan.frames.length - 1, {});
    const lastProv = { covered: state.provenance.covered };

    return {
      firstYear: first.year, lastYear: last.year,
      firstCovered: first.coverage.covered, lastCovered: last.coverage.covered,
      firstProv, lastProv,
      man: manifest().items.map((f) => f.coverage.covered)
    };
  });

  // The run genuinely starts sparse and fills in — which is a story about what
  // ParlGov recorded, and would read as a story about politics without this.
  expect(r.lastCovered).toBeGreaterThan(r.firstCovered);

  // The number in the manifest is the number the footer draws, not a parallel
  // count that could drift from it.
  expect(r.firstProv.covered).toBe(r.firstCovered);
  expect(r.lastProv.covered).toBe(r.lastCovered);
  expect(r.man.every((n) => n > 0)).toBe(true);
});

test('the manifest names the countries it had to leave blank', async ({ page }) => {
  await open(page);
  const m = await page.evaluate(async () => {
    const { planSeries, manifest } = await import('/src/series.js');
    await planSeries({ from: 1945, to: 2023, scope: 'Europe', grouping: 'family' });
    return manifest();
  });

  // A blank country is a claim of ignorance, and the run says which kind.
  // Without this, the sparse 1940s read as a story about politics rather than
  // about what ParlGov recorded.
  const byUnit = new Map(m.recordGaps.map((g) => [g.unit, g]));

  const de = byUnit.get('Germany');
  expect(de, 'Germany is blank in the 1940s and the manifest should say why').toBeTruthy();
  expect(de.lastCabinet).toBe('Hitler');
  expect(de.years[0]).toBe(1945);
  expect(de.years[1]).toBe(1949);

  const at = byUnit.get('Austria');
  expect(at.lastCabinet).toBe('Dollfuss');

  // And the frames themselves carry it, not only the summary.
  const f1945 = m.items.find((f) => f.year === 1945);
  expect(f1945.recordGaps.map((g) => g.unit)).toContain('Germany');
  expect(f1945.recordGaps.find((g) => g.unit === 'Germany').years).toBeGreaterThan(6);

  // A year with a complete record claims no gaps at all.
  const f2010 = m.items.find((f) => f.year === 2010);
  expect(f2010.recordGaps).toEqual([]);
});
