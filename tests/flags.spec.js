/**
 * Flags mode.
 *
 * One rule governs the milestone: on a results map the fill is the data, and a
 * flag never replaces it. The parity gate proves results exports are untouched;
 * this file proves flags mode draws what it claims to — every selected unit
 * actually filled, micro-states visible, units with no code left honestly
 * blank — and that an export cannot race an image decode and ship a blank.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(__dirname, 'shots');

// An illustrative "voting in 2027" selection: ten countries with elections
// due that year as far as this was written. The test is about rendering, and
// the list is not a claim about any election calendar.
const VOTING_2027 = ['France', 'Spain', 'Italy', 'Poland', 'Finland', 'Estonia',
  'Nigeria', 'Kenya', 'Argentina', 'South Korea'];
const MICRO = ['Malta', 'Luxembourg', 'Andorra', 'San Marino', 'Liechtenstein', 'Monaco', 'Vatican'];

async function open(page) {
  await page.goto('/');
  await page.waitForFunction(() => document.querySelectorAll('#countryList .crow').length > 10);
}

/**
 * In-page: for each flag the export drew, sample pixels well inside it and
 * measure how much they vary. A unit left blank is one flat land tone and
 * varies by nothing; a flag, even cropped to a slice, has at least two colours.
 *
 * Points are kept only when a 3px cross around them is inside the unit too, so
 * the casing and the borders never count as "variance".
 */
const MEASURE = `(cv, report, geo) => {
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const data = ctx.getImageData(0, 0, W, H).data;
  const px = (x, y) => {
    const i = (Math.round(y) * W + Math.round(x)) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const spread = (pts) => {
    if (pts.length < 3) return { n: pts.length, sd: 0, colours: 0 };
    const cols = pts.map(([x, y]) => px(x, y));
    let sd = 0;
    for (let ch = 0; ch < 3; ch++) {
      const m = cols.reduce((s, c) => s + c[ch], 0) / cols.length;
      sd += Math.sqrt(cols.reduce((s, c) => s + (c[ch] - m) ** 2, 0) / cols.length);
    }
    const colours = new Set(cols.map((c) => c.map((v) => v >> 5).join(','))).size;
    return { n: pts.length, sd: sd / 3, colours };
  };
  const [ox, oy] = report.origin;
  const p = report.project;
  const out = {};
  for (const { key, tiny } of report.flags) {
    const f = geo.BY_KEY.get(key);
    const pts = [];
    if (tiny) {
      const c = d3.geoPath(p).centroid(geo.largestPolygon(f) || f);
      const r = report.discRadius * 0.6;
      for (let a = 0; a < 24; a++) {
        for (const rr of [r * 0.3, r * 0.65, r]) {
          pts.push([ox + c[0] + Math.cos(a / 24 * 2 * Math.PI) * rr, oy + c[1] + Math.sin(a / 24 * 2 * Math.PI) * rr]);
        }
      }
    } else {
      const poly = geo.largestPolygon(f);
      const [[x0, y0], [x1, y1]] = d3.geoPath(p).bounds(poly);
      // The margin that keeps samples off the casing scales with the unit, so a
      // twelve-pixel France at 500px wide is still sampled rather than skipped.
      const span = Math.min(x1 - x0, y1 - y0);
      const step = Math.max(1, span / 24);
      const e = Math.max(1, Math.min(3, span / 8));
      const inside = (x, y) => { const ll = p.invert([x, y]); return ll && d3.geoContains(poly, ll); };
      for (let x = x0; x <= x1; x += step) {
        for (let y = y0; y <= y1; y += step) {
          if (inside(x, y) && inside(x - e, y) && inside(x + e, y) && inside(x, y - e) && inside(x, y + e)) {
            pts.push([ox + x, oy + y]);
          }
        }
      }
    }
    out[key] = { tiny, ...spread(pts.filter(([x, y]) => x >= 0 && y >= 0 && x < W && y < H)) };
  }
  return out;
}`;

/* ------------------------------------------------------------ acceptance 2 */

test('every selected unit in a "voting in 2027" export actually carries a flag', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async ({ pick, measureSrc }) => {
    const { state } = await import('/src/state.js');
    const { prepareExport } = await import('/src/flags.js');
    const geo = await import('/src/geo.js');
    const measure = eval(measureSrc);

    state.mode = 'flags';
    state.flagged = Object.fromEntries(pick.map((k) => [k, true]));
    state.title = 'Voting in 2027';
    state.sub = 'Countries with national elections due in 2027';
    state.handle = '@electionmaps';
    await prepareExport();

    const report = {};
    const cv = window.__studio.composite(1600, 900, { report });
    const m = measure(cv, report, geo);
    const small = {};
    const cv500 = window.__studio.composite(500, 500, { report: small });
    return {
      drawn: report.flags.map((f) => f.key).sort(),
      m,
      m500: measure(cv500, small, geo),
      png: cv.toDataURL('image/png'),
      png500: cv500.toDataURL('image/png')
    };
  }, { pick: VOTING_2027, measureSrc: MEASURE });

  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, 'flags-voting-2027.png'), Buffer.from(r.png.split(',')[1], 'base64'));
  fs.writeFileSync(path.join(SHOTS, 'flags-voting-2027-500.png'), Buffer.from(r.png500.split(',')[1], 'base64'));

  // All ten were drawn — none silently skipped.
  expect(r.drawn).toEqual([...VOTING_2027].sort());

  // And every one of them has more than one colour inside its outline, at both
  // sizes. A blank flag is a failure, not a style.
  for (const [label, m] of [['1600', r.m], ['500', r.m500]]) {
    for (const key of VOTING_2027) {
      const u = m[key];
      expect(u, `${key} @${label} not measured`).toBeTruthy();
      expect(u.n, `${key} @${label}: too few interior samples`).toBeGreaterThan(8);
      expect(u.colours, `${key} @${label} looks blank (${u.colours} colours)`).toBeGreaterThan(1);
      expect(u.sd, `${key} @${label} looks blank (sd ${u.sd.toFixed(1)})`).toBeGreaterThan(12);
    }
  }
});

/* ------------------------------------------------------------ acceptance 3 */

test('micro-states get a visible flag disc at 500px wide', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async ({ pick, measureSrc }) => {
    const { state } = await import('/src/state.js');
    const { prepareExport } = await import('/src/flags.js');
    const geo = await import('/src/geo.js');
    const measure = eval(measureSrc);

    state.mode = 'flags';
    state.flagged = Object.fromEntries(pick.map((k) => [k, true]));
    state.fit = [[-12, 34], [32, 60]];
    state.title = 'The small states';
    await prepareExport();

    const report = {};
    const cv = window.__studio.composite(500, 500, { report });
    return {
      flags: report.flags,
      radius: report.discRadius,
      m: measure(cv, report, geo),
      png: cv.toDataURL('image/png')
    };
  }, { pick: MICRO, measureSrc: MEASURE });

  fs.writeFileSync(path.join(SHOTS, 'flags-microstates-500.png'), Buffer.from(r.png.split(',')[1], 'base64'));

  // Each one is a disc, not a speck of flag clipped to a few pixels.
  for (const key of MICRO) {
    const f = r.flags.find((x) => x.key === key);
    expect(f, `${key} was not drawn`).toBeTruthy();
    expect(f.tiny, `${key} should be a disc at this size`).toBe(true);
  }
  // Big enough to see — over 11px across at 500px wide …
  expect(r.radius * 2).toBeGreaterThan(11);
  // … and actually showing a flag rather than a flat dot.
  for (const key of MICRO) {
    expect(r.m[key].colours, `${key} disc looks flat`).toBeGreaterThan(1);
  }
});

/* ------------------------------------------------------------ acceptance 4 */

test('a unit with no resolvable ISO code renders unassigned, without error', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  const r = await page.evaluate(async () => {
    const { state } = await import('/src/state.js');
    const { prepareExport, flagOfKey } = await import('/src/flags.js');
    const geo = await import('/src/geo.js');

    state.mode = 'flags';
    // Kosovo carries no ISO code in the boundary data. flag-icons ships an
    // `xk` flag for it; the tool uses the data's code or nothing.
    state.flagged = { Kosovo: true, Serbia: true };
    state.fit = [[17, 40], [25, 46]];
    await prepareExport();

    const report = {};
    const cv = window.__studio.composite(800, 800, { report });

    // Sample inside Kosovo: it must be the one flat land tone.
    const f = geo.BY_KEY.get('Kosovo');
    const p = report.project;
    const [ox, oy] = report.origin;
    const c = d3.geoPath(p).centroid(f);
    const ctx = cv.getContext('2d');
    const cols = [];
    for (let dx = -6; dx <= 6; dx += 3) {
      for (let dy = -6; dy <= 6; dy += 3) {
        const d = ctx.getImageData(Math.round(ox + c[0] + dx), Math.round(oy + c[1] + dy), 1, 1).data;
        cols.push(`${d[0]},${d[1]},${d[2]}`);
      }
    }
    return {
      code: flagOfKey('Kosovo'),
      drawn: report.flags.map((x) => x.key),
      kosovoColours: [...new Set(cols)],
      land: state.theme
    };
  });

  expect(r.code).toBe(null);
  expect(r.drawn).toEqual(['Serbia']);
  // One colour, and it is flags mode's unassigned land tone (#243039, dark theme).
  expect(r.kosovoColours).toEqual(['36,48,57']);
  expect(errors).toEqual([]);
});

/* ------------------------------------------------------------ the export race */

test('an export that has not awaited its flags refuses, rather than drawing blanks', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const { state } = await import('/src/state.js');
    // Codes nothing has loaded yet, set and exported in the same tick: the SVGs
    // cannot have decoded, which is exactly the race.
    state.mode = 'flags';
    state.flagged = { Mongolia: true, Bhutan: true, Nepal: true };
    let error = null;
    try { window.__studio.composite(800, 450); } catch (e) { error = { code: e.code, message: e.message }; }

    await window.__studio.prepareExport();
    let after = null;
    try { after = window.__studio.composite(800, 450).width; } catch (e) { after = e.message; }
    return { error, after };
  });

  expect(r.error, 'composite drew without its flags').toBeTruthy();
  expect(r.error.code).toBe('FLAGS_NOT_READY');
  expect(r.error.message).toMatch(/mn|bt|np/);
  // Awaiting first is all it takes.
  expect(r.after).toBe(800);
});

test('a flag that fails to load stops the export and says which', async ({ page }) => {
  // The file is there on disk; the network is what fails. Nothing should paper
  // over it with a blank country.
  await page.route('**/flags/4x3/pl.svg', (route) => route.abort());
  await open(page);
  const r = await page.evaluate(async () => {
    const { state } = await import('/src/state.js');
    state.mode = 'flags';
    state.flagged = { Poland: true, Czechia: true };
    try { await window.__studio.prepareExport(); return { ok: true }; } catch (e) { return { ok: false, message: e.message }; }
  });
  expect(r.ok).toBe(false);
  expect(r.message).toMatch(/pl \(4x3\)/);
  expect(r.message).not.toMatch(/cz/);
});

/* ------------------------------------------------------- results stay results */

test('results mode draws no flags, whatever the flag selection holds', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const { state } = await import('/src/state.js');
    state.assign = { France: { party: 1 }, Poland: { party: 2 }, Brazil: { party: 1 } };
    state.title = 'Results'; state.handle = '@electionmaps';

    state.flagged = {};
    const clean = window.__studio.composite(1600, 900).toDataURL('image/png');

    // A flag selection is parked in the document, and the mode has been used
    // and switched back. None of it may reach a results export.
    state.flagged = { France: true, Poland: true, Germany: true };
    state.mode = 'flags';
    await window.__studio.prepareExport();
    window.__studio.composite(1600, 900);
    state.mode = 'results';
    const after = window.__studio.composite(1600, 900).toDataURL('image/png');
    return { same: clean === after };
  });
  expect(r.same).toBe(true);
});

test('switching mode never costs a finished results map', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const { state, setMode, paint, undo } = await import('/src/state.js');
    state.assign = { France: { party: 1 } };
    setMode('flags');
    paint('Germany');                // a flags-mode tap
    const inFlags = { assign: Object.keys(state.assign), flagged: Object.keys(state.flagged) };
    setMode('results');
    paint('Spain');                  // a results-mode tap
    const back = { assign: Object.keys(state.assign).sort(), flagged: Object.keys(state.flagged) };
    undo(); undo();
    return { inFlags, back, afterUndo: { mode: state.mode, flagged: Object.keys(state.flagged) } };
  });
  expect(r.inFlags.assign).toEqual(['France']);
  expect(r.inFlags.flagged).toEqual(['Germany']);
  expect(r.back.assign).toEqual(['France', 'Spain']);
  expect(r.back.flagged).toEqual(['Germany']);
  // Mode is part of the document's history like anything else.
  expect(r.afterUndo.mode).toBe('flags');
});

/* ---------------------------------------------------------- the code table */

test('flags resolve by code alone, never by name', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const { flagOf, flagOfIso3 } = await import('/src/flags.js');
    const { NUMERIC_TO_A2 } = await import('/src/flag-codes.js');
    const geo = await import('/src/geo.js');
    return {
      france: flagOf(geo.BY_KEY.get('France')),
      // A feature named France with no code gets nothing: the name is not evidence.
      nameOnly: flagOf({ id: undefined, properties: { name: 'France' }, name: 'France' }),
      kosovo: flagOf(geo.BY_KEY.get('Kosovo')),
      somaliland: flagOf(geo.BY_KEY.get('Somaliland')),
      ncyprus: flagOf(geo.BY_KEY.get('N. Cyprus')),
      // Natural Earth's private alpha-3 for South Sudan is not ISO, so no badge.
      sds: flagOfIso3('SDS'),
      bgd: flagOfIso3('BGD'),
      values: Object.values(NUMERIC_TO_A2)
    };
  });
  expect(r.france).toBe('fr');
  expect(r.nameOnly).toBe(null);
  expect(r.kosovo).toBe(null);
  expect(r.somaliland).toBe(null);
  expect(r.ncyprus).toBe(null);
  expect(r.sds).toBe(null);
  expect(r.bgd).toBe('bd');
  // flag-icons' non-ISO sets (eu, un, gb-sct, es-ct, arab …) are unreachable.
  for (const v of r.values) expect(v).toMatch(/^[a-z]{2}$/);
  expect(r.values).not.toContain('eu');
  expect(r.values).not.toContain('xk');
});

test('every flag the table can reach is bundled, in both sets, and nothing else', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'flag-codes.js'), 'utf8');
  const codes = new Set([...src.matchAll(/"[^"]+": "([a-z]{2})"/g)].map((m) => m[1]));
  expect(codes.size).toBeGreaterThan(200);
  for (const set of ['4x3', '1x1']) {
    const files = new Set(fs.readdirSync(path.join(ROOT, 'public', 'flags', set)).map((f) => f.replace('.svg', '')));
    for (const c of codes) expect(files.has(c), `${set}/${c}.svg missing`).toBe(true);
    for (const f of files) expect(codes.has(f), `${set}/${f}.svg is bundled but unreachable`).toBe(true);
  }
  // The licence travels with the files.
  expect(fs.existsSync(path.join(ROOT, 'public', 'flags', 'LICENSE'))).toBe(true);
});

/* ---------------------------------------------------------- the headline badge */

test('single-country layers carry a headline badge; the world map does not', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const { state, switchLayer } = await import('/src/state.js');
    const geo = await import('/src/geo.js');
    const { badgeFlag } = await import('/src/flags.js');
    const world = badgeFlag();
    await geo.loadLayer('gb:BGD:ADM1');
    switchLayer('gb:BGD:ADM1');
    state.title = 'Bangladesh by division';
    // Loading the layer loaded its badge, so a synchronous export cannot race it.
    let threw = null;
    try { window.__studio.composite(1200, 1200); } catch (e) { threw = e.message; }
    return { world, bgd: badgeFlag(), threw };
  });
  expect(r.world).toBe(null);
  expect(r.bgd).toBe('bd');
  expect(r.threw).toBe(null);
});
