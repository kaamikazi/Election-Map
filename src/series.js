/**
 * A run of frames, generated once, that can be read as a sequence.
 *
 * Generating 79 maps one at a time through the import dialog is not a slower
 * version of this; it is a different and worse thing, because every frame would
 * be framed and coloured to itself. Two decisions have to be made for the run
 * rather than for the frame, and this module exists to make them:
 *
 *   the frame  — fit to the union of every year's coverage, once, so nothing
 *                moves between frames. Fit-to-data is right for one map and
 *                wrong for a sequence: coverage changes year to year, so
 *                per-frame fitting makes the map twitch, which is the one
 *                thing that ruins a run.
 *
 *   the palette — every family gets its slot before frame one, whether or not
 *                it governs anywhere that year. A colour assigned in the order
 *                parties happened to appear would drift across the run, and a
 *                family's colour changing halfway through a sequence says
 *                something about the data that is not true.
 *
 * It renders through composite() like everything else. There is no second draw
 * path, and there is no frame here the export dialog could not produce.
 */

import { state, setMetric, nextId } from './state.js';
import { FAMILIES, familyLabel, UNFAMILIED } from './families.js';
import { adapterById } from './import/adapters.js';
import { buildProposal, applyProposal, counts } from './import/proposal.js';
import { boundsOf, BY_KEY, LAYER, WORLD, BOUNDARY } from './geo.js';
import { composite, legendRowsAt, footerRowsAt } from './export.js';
import { boundaryWarnings, vintageLine } from './vintage.js';

/** The plan for the run in progress. One at a time; this is a generator, not a view. */
let plan = null;

/* ------------------------------------------------------------- the palette */

/**
 * Give every family a slot up front, in the family table's own order.
 *
 * partyFor() matches an adapter's hint by slotKey and reuses the slot it finds,
 * so seeding the slots fixes both the colour and the legend identity for the
 * whole run. The tenth slot is for a governing party ParlGov has not
 * classified: that is not a family and does not get a family colour, it gets
 * the unassigned tone and a hatch, and it still needs a stable slot or it would
 * be recreated with a different id every time it appears.
 */
function seedPalette(grouping) {
  if (grouping === 'party') return [];       // a party is not a fixed set; nothing to seed
  const seeded = [];
  for (const f of FAMILIES) {
    const key = 'family:' + f.id;
    if (state.parties.some((p) => p.slotKey === key)) continue;
    const party = {
      id: nextId(),
      name: f.label,
      color: state.overrides[key] || f.color,
      hatch: false,
      family: f.id,
      slotKey: key,
      parlgov_id: key
    };
    state.parties.push(party);
    seeded.push({ key, name: party.name, color: party.color });
  }
  const noneKey = 'family:none';
  if (!state.parties.some((p) => p.slotKey === noneKey)) {
    const party = {
      id: nextId(),
      name: familyLabel(null),
      color: state.overrides[noneKey] || UNFAMILIED,
      hatch: true,
      family: null,
      slotKey: noneKey,
      parlgov_id: noneKey
    };
    state.parties.push(party);
    seeded.push({ key: noneKey, name: party.name, color: party.color, hatch: true });
  }
  return seeded;
}

/* --------------------------------------------------------------- planning */

const yearsFrom = (from, to, step) => {
  const out = [];
  const s = Math.max(1, Math.abs(step) || 1);
  for (let y = from; y <= to; y += s) out.push(y);
  return out;
};

/**
 * Pass one: build every frame, record what it covers and what it rests on, and
 * throw the pixels away. Nothing is drawn until the run's frame and legend
 * height are known, because they depend on all of the frames at once.
 *
 * A year the archive cannot answer is recorded as a gap and does not stop the
 * run — a missing year is a fact about the archive, and a run that refuses to
 * start because 1945 is thin would hide it rather than report it.
 */
export async function planSeries({
  from, to, step = 1, scope = 'Europe', grouping = 'family',
  width = 1600, height = 900, margin = 0.12
} = {}) {
  const adapter = adapterById('archive');
  const palette = seedPalette(grouping);
  setMetric('flat');

  const frames = [];
  const skipped = [];
  const union = new Set();
  let maxRows = 0;
  const footerRows = { source: 0, limitations: 0 };

  for (const year of yearsFrom(from, to, step)) {
    let draft;
    try {
      draft = await adapter.propose({ year: String(year), scope, grouping });
    } catch (err) {
      skipped.push({ year, why: err.message });
      continue;
    }

    const proposal = buildProposal(draft);
    const c = counts(proposal);
    const result = applyProposal(proposal, { replace: true });
    if (result.blocked) {
      skipped.push({ year, why: result.blocked.text });
      continue;
    }

    const keys = Object.keys(state.assign);
    for (const k of keys) union.add(k);
    maxRows = Math.max(maxRows, legendRowsAt(width));
    const footer = footerRowsAt(width);
    footerRows.source = Math.max(footerRows.source, footer.source);
    footerRows.limitations = Math.max(footerRows.limitations, footer.limitations);

    frames.push(frameRecord({ year, keys, counts: c, proposal, grouping, scope }));
  }

  if (!frames.length) throw new Error('No year in that range produced a map');

  plan = {
    from, to, step, scope, grouping, width, height,
    // One frame for the whole run, over everything any year covers.
    fit: boundsOf([...union], margin),
    unionUnits: union.size,
    legendRows: maxRows,
    footerRows,
    palette,
    frames,
    skipped,
    generatedAt: new Date().toISOString()
  };
  return plan;
}

/**
 * Everything about a frame that is not the picture.
 *
 * The viewer sees only the picture, so anything true about a frame that the
 * picture cannot carry has to be written down beside it. Coverage in
 * particular: a run that starts sparse and fills in is telling a story about
 * what ParlGov recorded, and a reader with no manifest would read it as a
 * story about politics.
 */
function frameRecord({ year, keys, counts: c, proposal, grouping, scope }) {
  const src = proposal.source || {};
  const asOf = src.asOf || `${year}-01-01`;
  const names = keys.map((k) => BY_KEY.get(k)).filter(Boolean).map((f) => f.name);

  const familiesSeen = [...new Set(
    Object.values(state.assign)
      .map((a) => state.parties.find((p) => p.id === a.party))
      .filter(Boolean)
      .map((p) => p.slotKey)
  )].sort();

  return {
    year,
    asOf,
    file: `${year}.png`,
    title: src.title || `Who governed, ${year}`,
    sub: src.sub || null,
    scope,
    grouping,
    coverage: {
      // What the footer on this frame says, so the two can be checked against
      // each other rather than trusted separately.
      covered: keys.length,
      universe: src.universe ? src.universe.length : null,
      matched: c.matched,
      unmatched: c.unmatched
    },
    source: {
      label: src.label || null,
      url: src.url || null,
      what: src.what || null,
      licence: 'ParlGov, CC0 1.0'
    },
    /*
     * Countries this frame leaves blank because the archive's record has a hole
     * in it, rather than because it never covered them. The distinction is the
     * whole difference between "we do not know" and "nothing was happening",
     * and a reader looking at a sparse 1946 deserves to be told which.
     */
    recordGaps: (src.gaps || []).map((g) => ({ ...g })),
    coverageNotes: src.notes || [],
    boundaries: boundaryRecord(),
    // Named border changes this frame draws over. At world level these are the
    // whole vintage story, because a world outline carries no registry entry.
    caveats: boundaryWarnings(String(asOf).slice(0, 10), names, BOUNDARY).map((w) => ({
      id: w.id, units: w.units, what: w.what
    })),
    // Set when someone deliberately drew results over boundaries that postdate
    // them. Never set inside a series run — a run does not tick boxes — but
    // recorded so a manifest is a complete account rather than a partial one.
    vintageOverride: state.provenance ? state.provenance.vintageOverride || null : null,
    familiesSeen
  };
}

function boundaryRecord() {
  if (LAYER === WORLD || !BOUNDARY) {
    return {
      layer: 'world',
      /*
       * Natural Earth ships present-day borders and states no year, so this
       * says so rather than picking one. For the 1945–1989 frames the borders
       * on screen are demonstrably not the borders of the year in the title —
       * `caveats` above names which ones, per frame.
       */
      vintage: null,
      vintageStated: false,
      agency: 'Natural Earth',
      licence: 'Public domain',
      line: null
    };
  }
  return {
    layer: LAYER,
    vintage: BOUNDARY.vintage || null,
    vintageStated: !!BOUNDARY.vintage,
    agency: BOUNDARY.sourceAgency || null,
    licence: BOUNDARY.licence || null,
    line: vintageLine(BOUNDARY)
  };
}

/* --------------------------------------------------------------- rendering */

/**
 * Pass two: draw frame `i` of the planned run.
 *
 * Re-applies the year rather than holding 79 bitmaps in memory, then overrides
 * the framing the adapter asked for. The archive sets fitToData because that is
 * right for a single map; a series overrules it, and has to do so after apply
 * rather than before, because apply is what sets it.
 */
export function renderFrame(i, opts = {}) {
  if (!plan) throw new Error('planSeries() first');
  const f = plan.frames[i];
  if (!f) throw new Error(`no frame ${i} in a run of ${plan.frames.length}`);
  return drawPlanned(f, opts);
}

async function drawPlanned(f, opts) {
  const adapter = adapterById('archive');
  const draft = await adapter.propose({
    year: String(f.year), scope: plan.scope, grouping: plan.grouping
  });
  applyProposal(buildProposal(draft), { replace: true });

  // The run's frame, not this year's. Set after apply, which is where the
  // adapter's own fit-to-data lands.
  state.fit = plan.fit;
  state.zoom = 1;
  state.pan = [0, 0];
  state.metric = 'flat';
  state.selected = null;
  if (opts.handle != null) state.handle = opts.handle;
  if (opts.sub != null) state.sub = opts.sub;

  // What the draw actually did, so "the frame did not move" is a measurement
  // rather than an intention. Comparing rendered pixels cannot answer it: an
  // antialiased coastline is a blend of ocean and whatever is inland of it, so
  // a country changing colour changes its edge pixels without moving at all.
  const report = {};
  const cv = composite(plan.width, plan.height, {
    withLegend: true,
    transparent: false,
    lockLegendRows: plan.legendRows,
    lockFooterRows: plan.footerRows,
    report
  });
  return {
    frame: f,
    projection: report.projection || null,
    inView: report.inView != null ? report.inView : null,
    dataUrl: cv.toDataURL('image/png')
  };
}

export const seriesPlan = () => plan;
export const frameCount = () => (plan ? plan.frames.length : 0);

/* --------------------------------------------------------------- manifest */

/**
 * The run, written down.
 *
 * Every frame accounts for its own sources and licences rather than the run
 * carrying one line that covers all of them, because that is only true while
 * every frame happens to come from one place, and the moment a run mixes
 * sources a single line becomes a false one.
 */
export function manifest() {
  if (!plan) throw new Error('planSeries() first');

  const licences = [...new Set(plan.frames.flatMap((f) => [
    f.source.licence, f.boundaries.licence
  ].filter(Boolean)))];

  const undated = plan.frames.filter((f) => !f.boundaries.vintageStated);
  const postdating = plan.frames.filter((f) =>
    f.boundaries.vintage && Number(f.boundaries.vintage) > Number(String(f.asOf).slice(0, 4)));

  return {
    kind: 'election-map-studio/series',
    version: 1,
    generatedAt: plan.generatedAt,
    range: { from: plan.from, to: plan.to, step: plan.step },
    scope: plan.scope,
    grouping: plan.grouping,
    size: { width: plan.width, height: plan.height },
    frames: plan.frames.length,
    // Stated so the claim "the frame does not move" is checkable from the
    // manifest alone, without measuring pixels.
    lockedFrame: plan.fit,
    lockedLegendRows: plan.legendRows,
    unionUnits: plan.unionUnits,
    palette: plan.palette,
    licences,
    // Part 3: a frame whose boundaries postdate its results is named here, and
    // so is a frame whose boundaries do not say what year they represent —
    // which is not the same thing as having no gap.
    boundariesPostdatingResults: postdating.map((f) => f.year),
    boundariesWithNoStatedVintage: undated.map((f) => f.year),
    framesWithBorderCaveats: plan.frames.filter((f) => f.caveats.length)
      .map((f) => ({ year: f.year, caveats: f.caveats.map((c) => c.id) })),
    // Every country any frame had to leave blank for want of a record, and the
    // years it happened in. A run that reports coverage without reporting this
    // invites the sparse years to be read as political rather than archival.
    recordGaps: (() => {
      const by = new Map();
      for (const f of plan.frames) {
        for (const g of f.recordGaps || []) {
          if (!by.has(g.unit)) by.set(g.unit, { unit: g.unit, lastCabinet: g.lastCabinet, since: g.since, years: [] });
          by.get(g.unit).years.push(f.year);
        }
      }
      return [...by.values()].map((g) => ({
        ...g, years: [g.years[0], g.years[g.years.length - 1]], frames: g.years.length
      }));
    })(),
    skipped: plan.skipped,
    items: plan.frames
  };
}
