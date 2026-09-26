/**
 * Composites the shareable image: headline, the map (via the same drawMap the
 * screen uses), the results bar, the legend, and the handle strip.
 */

import { state, THEMES, FONT, standings, activeParties } from './state.js';
import { drawMap } from './render.js';
import { BINS, NEUTRAL, metricDef, binColor, ticksFor } from './metrics.js';
import { BOUNDARY, LAYER, WORLD } from './geo.js';
import { vintageLine } from './vintage.js';
import { documentPartials } from './import/partition.js';
import { assertFlagsReady, badgeFlag, raster, flagOfKey, FLAG_SET } from './flags.js';
import { documentSources } from './provenance.js';

/**
 * @param {number} W
 * @param {number} H
 * @param {{transparent?: boolean, withLegend?: boolean}} opts
 * @returns {HTMLCanvasElement}
 */
export function composite(W, H, opts) {
  const {
    transparent: trans = false,
    withLegend = true,
    /*
     * Reserve this many legend rows instead of using however many this frame
     * needs.
     *
     * The map is drawn into whatever is left after the footer, so a frame with
     * nine families and a two-row legend gets a shorter map box than a frame
     * with four and a one-row legend — and the projection is fitted to that
     * box. Across a series that is a map which grows and shrinks under a fixed
     * frame, which is precisely the jitter a locked frame is meant to prevent.
     * A series computes the tallest legend in the run and pins every frame to
     * it; the shorter legends simply leave the reserved space empty.
     */
    lockLegendRows = null,
    lockFooterRows = null,
    // An object drawMap fills in with what it did — the projection in
    // particular. Optional, and read by anything that has to compare two draws.
    report: outReport = null
  } = opts || {};
  // The export race. Every flag this frame needs must already be decoded; if
  // one is not, stop here and say which, rather than ship a blank country.
  // Callers await prepareExport() in flags.js first.
  assertFlagsReady();

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  const T = THEMES[state.theme];
  const k = W / 1600;
  const pad = 54 * k;
  const flagMode = state.mode === 'flags';

  if (!trans) { c.fillStyle = T.bg; c.fillRect(0, 0, W, H); }

  // ---- header text
  let top = pad;
  const title = state.title.trim();
  const sub = state.sub.trim();
  // A single-country layer carries its country's flag beside the headline. Not
  // the world map, which is about many countries and belongs to none of them.
  // Chrome, not data: it sits in the header and never touches a fill.
  const badge = title ? badgeFlag() : null;
  const indent = badge ? drawBadge(c, badge, pad, top, k) : 0;
  if (title) {
    c.font = `700 ${Math.round(46 * k)}px ${FONT}`;
    c.fillStyle = T.text; c.textAlign = 'left'; c.textBaseline = 'top';
    c.letterSpacing = `${-0.6 * k}px`;
    wrap(c, title, pad + indent, top, W - pad * 2 - indent, 54 * k);
    top += lines(c, title, W - pad * 2 - indent) * 54 * k + 6 * k;
    c.letterSpacing = '0px';
  }
  if (sub) {
    c.font = `400 ${Math.round(22 * k)}px ${FONT}`;
    c.fillStyle = T.muted;
    wrap(c, sub, pad + indent, top, W - pad * 2 - indent, 30 * k);
    top += lines(c, sub, W - pad * 2 - indent) * 30 * k;
  }
  if (title || sub) top += 16 * k;

  // ---- footer block height
  // A flags map has no results, so it has no results bar and no party legend.
  const counts = flagMode ? [] : standings();
  const total = counts.reduce((s, x) => s + x.n, 0);
  const showLegend = withLegend && total > 0;

  c.font = `600 ${Math.round(20 * k)}px ${FONT}`;
  const def = metricDef(state.metric);
  const flat = def.id === 'flat';
  const ownRows = showLegend && flat ? layoutLegend(c, counts, W - pad * 2, k).rows : 0;
  const legRows = lockLegendRows != null ? Math.max(ownRows, lockLegendRows) : ownRows;
  const legendH = !showLegend ? 0
    : flat ? legRows * 32 * k
      : rampLegendHeight(c, k, W - pad * 2);
  const prov = flagMode ? flagsLine() : provenanceLine();
  c.font = `400 ${Math.round(17 * k)}px ${FONT}`;
  const provRows = Math.max(prov ? lines(c, coverageLine(999) + prov, W - pad * 2) : 0, lockFooterRows?.source || 0);
  const extraProvH = Math.max(0, provRows - 1) * 22 * k;
  const limitations = flagMode ? '' : coverageLimitations();
  const limitRows = Math.max(limitations ? lines(c, limitations, W - pad * 2) : 0, lockFooterRows?.limitations || 0);
  // What the map is drawn on, whenever that is a claim rather than a schematic.
  const vint = vintageLine(BOUNDARY);
  // Units the data only partly covers, named rather than patterned: hatching
  // already means "no party family", and a second pattern would read as a third
  // category rather than as a caveat.
  const partial = flagMode ? [] : documentPartials();
  // A deliberate choice to draw results over boundaries that postdate them.
  // The viewer did not make that choice and cannot see it in the picture.
  const gap = flagMode ? '' : overrideLine();
  const footH = (showLegend ? 18 * k + legendH : 0) + (prov ? 30 * k : 0)
    + (vint ? 24 * k : 0) + (partial.length ? 24 * k : 0) + (gap ? 24 * k : 0)
    + extraProvH + limitRows * 22 * k
    + (state.handle.trim() ? 40 * k : 0) + pad * 0.5;

  // ---- map
  const mapTop = top;
  const mapBot = H - footH - pad * 0.4;
  if (mapBot - mapTop < 80 * k) throw new Error('Attribution and caveats leave too little map space. Use a taller export or fewer sources.');
  const report = outReport || {};
  drawMap(c, W, H, {
    inset: [mapTop, pad * 0.5, H - mapBot, pad * 0.5],
    k: Math.max(k * 1.15, 0.7), pad: 4 * k, transparent: trans, bg: false,
    inViewOf: state.provenance ? state.provenance.universe : null,
    report
  });

  // ---- results bar + legend
  let y = mapBot + 10 * k;
  if (showLegend) {
    const bh = 15 * k, bw = W - pad * 2;
    let x = pad;
    c.save();
    roundRect(c, pad, y, bw, bh, 4 * k); c.clip();
    c.fillStyle = T.track; c.fillRect(pad, y, bw, bh);
    counts.forEach(({ p, n }) => {
      const w = bw * n / total;
      c.fillStyle = p.color; c.fillRect(x, y, w - 1.5 * k, bh);
      x += w;
    });
    c.restore();
    y += bh + 18 * k;
    if (flat) drawLegend(c, counts, pad, y, W - pad * 2, k, T);
    else drawRampLegend(c, def, pad, y, k, W - pad * 2, T);
    y += legendH;
  }

  // ---- where the numbers came from, and how much of the map they cover
  if (prov) {
    c.font = `400 ${Math.round(17 * k)}px ${FONT}`;
    c.textBaseline = 'alphabetic'; c.textAlign = 'left';
    c.fillStyle = T.muted;
    wrap(c, (flagMode ? '' : coverageLine(report.inView)) + prov, pad, y + 20 * k, W - pad * 2, 22 * k);
    y += extraProvH;
  }
  if (limitations) {
    c.font = `400 ${Math.round(17 * k)}px ${FONT}`;
    c.fillStyle = T.text;
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    wrap(c, limitations, pad, y + (prov ? 42 : 20) * k, W - pad * 2, 22 * k);
    y += limitRows * 22 * k;
  }

  // ---- what the boundaries are, when they are current-day and the map is not
  if (vint) {
    c.font = `400 ${Math.round(16 * k)}px ${FONT}`;
    c.textBaseline = 'alphabetic'; c.textAlign = 'left';
    c.fillStyle = T.muted;
    c.fillText(vint, pad, y + (prov ? 44 : 20) * k);
  }

  // ---- units the table only partly describes
  if (partial.length) {
    c.font = `400 ${Math.round(16 * k)}px ${FONT}`;
    c.textBaseline = 'alphabetic'; c.textAlign = 'left';
    c.fillStyle = T.muted;
    c.fillText(partial.join('  ·  '), pad, y + ((prov ? 44 : 20) + (vint ? 22 : 0)) * k);
  }

  // ---- results drawn over boundaries that postdate them, by choice
  if (gap) {
    c.font = `400 ${Math.round(16 * k)}px ${FONT}`;
    c.textBaseline = 'alphabetic'; c.textAlign = 'left';
    // Brighter than the citations around it: this is the line that says the
    // map may be describing the wrong ground, and it should not read as a
    // footnote among footnotes.
    c.fillStyle = T.text;
    c.fillText(gap, pad,
      y + ((prov ? 44 : 20) + (vint ? 22 : 0) + (partial.length ? 22 : 0)) * k);
  }

  // ---- handle + stamp
  if (state.handle.trim()) {
    c.font = `600 ${Math.round(19 * k)}px ${FONT}`;
    c.textBaseline = 'alphabetic';
    c.textAlign = 'left'; c.fillStyle = T.text;
    c.fillText(state.handle.trim(), pad, H - pad * 0.62);
    // A sourced map is dated by what it shows, not by when it was rendered.
    // "September 2026" under a map titled 1977 reads as the wrong year twice.
    if (!state.provenance) {
      c.textAlign = 'right'; c.fillStyle = T.muted;
      c.font = `400 ${Math.round(17 * k)}px ${FONT}`;
      c.fillText(new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }),
        W - pad, H - pad * 0.62);
    }
  }
  return cv;
}

/* ---------------- provenance ----------------
 * A map built from an archive says so, and says how much of the archive it
 * actually covered. A sparse map that does not admit to being sparse reads as
 * a complete one, which is the more damaging mistake.
 */

export function provenanceLine() {
  const p = state.provenance;
  if (!p) return '';
  // Derive from the current values, including later manual edits. Saved legacy
  // maps cannot prove record-level provenance and must say so.
  const sources = documentSources(state.assign);
  if (sources.length) {
    const label = (s, i) => {
      const date = s.asOf ? ` (${s.asOfPrecision === 'year' ? s.asOf.slice(0, 4) : s.asOf})` : '';
      const url = s.cite?.permalink || s.url;
      const batch = sources.length > 1 && s.importId ? ` [import ${i + 1}]` : '';
      return s.source + batch + date + (url ? ` · ${url}` : '') + (s.cite?.license ? ` · ${s.cite.license}` : '');
    };
    return (sources.length > 1 ? 'Mixed sources: ' : 'Source: ') + sources.map(label).join(' | ');
  }
  if (!p.source) return '';
  // A Wikipedia article changes. Citing the title cites something that can be
  // different by the time a reader checks it, so the footer carries the link to
  // the exact revision that was read.
  const cite = p.cite;
  if (cite && cite.permalink) {
    return `Source: ${p.source} · ${cite.permalink} · ${cite.license || 'Wikipedia, CC BY-SA 4.0'}`;
  }
  return 'Source: ' + p.source;
}

export function coverageLimitations() {
  const sources = documentSources(state.assign);
  const gaps = [...new Set(sources.flatMap((s) => (s.gaps || []).map((g) => g.unit)))];
  const notes = [...new Set(sources.flatMap((s) => s.notes || []))];
  return [gaps.length ? `Uncertain / missing archive coverage: ${gaps.join(', ')}.` : '', ...notes].filter(Boolean).join(' ');
}

export function footerRowsAt(width) {
  const c = document.createElement('canvas').getContext('2d');
  const k = width / 1600;
  c.font = `400 ${Math.round(17 * k)}px ${FONT}`;
  const source = provenanceLine(), limitations = coverageLimitations();
  return {
    source: source ? lines(c, coverageLine(999) + source, width - 108 * k) : 0,
    limitations: limitations ? lines(c, limitations, width - 108 * k) : 0
  };
}

/**
 * The denominator has to be countries the reader can see. "23 of 37" counted
 * ParlGov's whole universe — Japan, Canada, Australia — which on a map of
 * Europe is a number about nothing. Counted against what is in frame it says
 * something true: how much of the visible map the source could fill.
 *
 * When nothing was countable, say the bare count rather than invent a ratio.
 */
function coverageLine(inView) {
  const p = state.provenance;
  if (!p || p.covered == null) return '';
  const n = Object.keys(state.assign).length;
  // "7 countries" under a map of Bangladesh's divisions is the wrong noun.
  const noun = LAYER === WORLD
    ? (n === 1 ? 'country' : 'countries')
    : (n === 1 ? unitNoun() : plural(unitNoun()));
  if (inView == null || inView < n) return `${n} ${noun}  ·  `;
  return `${n} of ${inView} ${noun} in frame  ·  `;
}

/**
 * The flag badge beside a single-country headline. Returns how far the headline
 * has to move right to clear it. A thin edge keeps a white flag — Japan's, say —
 * from dissolving into a light background.
 */
function drawBadge(c, a2, x, top, k) {
  const h = Math.round(34 * k);
  const w = Math.round(h * 4 / 3);
  const y = top + Math.round(9 * k);
  const img = raster(a2, '4x3', h * 2);
  if (!img) return 0;
  c.save();
  roundRect(c, x, y, w, h, 3 * k);
  c.clip();
  c.drawImage(img, x, y, w, h);
  c.restore();
  c.save();
  roundRect(c, x, y, w, h, 3 * k);
  c.lineWidth = Math.max(1, 1.2 * k);
  c.strokeStyle = state.theme === 'light' ? 'rgba(20,28,36,.35)' : 'rgba(237,233,225,.28)';
  c.stroke();
  c.restore();
  return w + Math.round(16 * k);
}

/**
 * The footer line for a flags map: how many units it shows, how many of the
 * selected ones the boundary data gave no code to (so they are drawn blank),
 * and whose flags these are. flag-icons is MIT, and its notice travels with it.
 */
function flagsLine() {
  const keys = Object.keys(state.flagged);
  const withFlag = keys.filter((k) => flagOfKey(k)).length;
  const without = keys.length - withFlag;
  const noun = LAYER === WORLD
    ? (withFlag === 1 ? 'country' : 'countries')
    : (withFlag === 1 ? unitNoun() : plural(unitNoun()));
  const bits = [`${withFlag} ${noun}`];
  if (without) bits.push(`${without} selected with no ISO code in the boundary data, left blank`);
  bits.push(`Flags: ${FLAG_SET.name} ${FLAG_SET.version}, ${FLAG_SET.licence}`);
  return bits.join('  ·  ');
}

/**
 * How many legend rows the current map would need at this size.
 *
 * A series needs this before it renders anything, so it can reserve the tallest
 * legend in the run for every frame. Measured with the same font and the same
 * layout function the real draw uses, because a reservation computed a
 * different way is a reservation that is sometimes wrong.
 */
export function legendRowsAt(W) {
  const cv = document.createElement('canvas');
  const c = cv.getContext('2d');
  const k = W / 1600;
  const pad = 54 * k;
  const counts = standings();
  if (!counts.reduce((s, x) => s + x.n, 0)) return 0;
  c.font = `600 ${Math.round(20 * k)}px ${FONT}`;
  return layoutLegend(c, counts, W - pad * 2, k).rows;
}

/**
 * The line a map carries when someone chose to draw old results on newer
 * boundaries. Empty when no such choice was made.
 *
 * It says the years and it says what is uncertain, and it does not soften it:
 * the whole reason apply refuses this by default is that the picture gives the
 * viewer no way to tell which units are describing ground that voted.
 */
function overrideLine() {
  const overrides = documentSources(state.assign).map((s) => s.vintageOverride).filter(Boolean);
  if (!overrides.length && state.provenance?.vintageOverride) overrides.push(state.provenance.vintageOverride);
  if (!overrides.length) return '';
  const o = overrides[0];
  const years = [...new Set(overrides.map((v) => v.resultsYear))].sort().join(', ');
  return `Results from ${years} drawn on ${o.noun} representing ` +
         `${o.boundaryVintage}: ${o.noun} redrawn in between may not be the ones that voted.`;
}

/** What this layer calls its units — "division", "district", "province". */
function unitNoun() {
  const label = BOUNDARY && BOUNDARY.label ? BOUNDARY.label.toLowerCase() : '';
  return !label || /^adm\d$/.test(label) ? 'unit' : label;
}

/**
 * English plurals, to the depth these nouns need and no further.
 *
 * Every label in the registry so far is a common noun a boundary agency chose:
 * division, district, province, constituency, county, parish. "650
 * constituencys" appeared in the footer of the first constituency map and is
 * exactly the kind of thing that makes a posted map look unserious, so the
 * three regular endings are handled here. A label that needs more than this —
 * an irregular plural, or a word from another language — belongs in the
 * registry entry as a stated plural rather than guessed at by a rule.
 */
export function plural(noun) {
  if (/[^aeiou]y$/.test(noun)) return noun.slice(0, -1) + 'ies';
  if (/(s|x|z|ch|sh)$/.test(noun)) return noun + 'es';
  return noun + 's';
}

/* ---------------- legend ---------------- */

function layoutLegend(c, counts, maxW, k) {
  const gap = 34 * k;
  let rows = 1, x = 0;
  const items = counts.map(({ p, n }) => {
    const w = 18 * k + 10 * k + c.measureText(p.name).width + 12 * k + c.measureText(String(n)).width;
    return { p, n, w };
  });
  items.forEach((it) => {
    if (x + it.w > maxW && x > 0) { rows++; x = 0; }
    it.row = rows - 1; it.x = x; x += it.w + gap;
  });
  return { rows, items };
}

function drawLegend(c, counts, ox, oy, maxW, k, T) {
  c.font = `600 ${Math.round(20 * k)}px ${FONT}`;
  const { items } = layoutLegend(c, counts, maxW, k);
  c.textBaseline = 'middle'; c.textAlign = 'left';
  items.forEach((it) => {
    const y = oy + it.row * 32 * k + 10 * k, x = ox + it.x;
    c.fillStyle = it.p.color;
    roundRect(c, x, y - 8 * k, 16 * k, 16 * k, 4 * k); c.fill();
    // Hatched fills get a hatched swatch, or the legend describes a map that
    // is not the one above it.
    if (it.p.hatch) {
      c.save();
      roundRect(c, x, y - 8 * k, 16 * k, 16 * k, 4 * k); c.clip();
      c.strokeStyle = T.hatchInk; c.lineWidth = 2 * k;
      for (let i = -16; i <= 16; i += 4) {
        c.beginPath();
        c.moveTo(x + i * k, y + 8 * k);
        c.lineTo(x + (i + 16) * k, y - 8 * k);
        c.stroke();
      }
      c.restore();
    }
    c.fillStyle = T.text;
    c.font = `600 ${Math.round(20 * k)}px ${FONT}`;
    c.fillText(it.p.name, x + 26 * k, y);
    const nx = x + 26 * k + c.measureText(it.p.name).width + 10 * k;
    c.fillStyle = T.muted;
    c.font = `400 ${Math.round(20 * k)}px ${FONT}`;
    c.fillText(String(it.n), nx, y);
  });
}

/* ---------------- ramp legend ----------------
 * One graded strip per party, with the metric's own domain written underneath.
 * Party-neutral metrics get a single strip in the neutral hue instead, so a
 * turnout map is never read as a result.
 *
 * Every party on the map gets a strip. Truncating the list would leave colours
 * on the map that the reader has no way to decode.
 */

const rampRows = () => {
  const def = metricDef(state.metric);
  if (def.neutral) return [{ label: def.label, color: NEUTRAL }];
  return activeParties().map((p) => ({ label: p.name, color: p.color }));
};

const CELL_H = 22, ROW_GAP = 10, TICK_GAP = 24, PER_COL = 3;

const colCount = (n) => Math.ceil(n / PER_COL);
const rowCount = (n) => Math.min(n, PER_COL);

/**
 * Strips are stacked three to a column and the columns run across, so six
 * parties still fit above the handle rather than pushing the map out of frame.
 */
function rampGeometry(c, k, maxW) {
  const rows = rampRows();
  const cols = colCount(rows.length);
  c.font = `600 ${Math.round(20 * k)}px ${FONT}`;
  const labelW = Math.max(...rows.map((r) => c.measureText(r.label).width));
  const colGap = 40 * k;
  const available = (maxW - colGap * (cols - 1)) / cols - labelW - 18 * k;
  const cw = Math.max(18 * k, Math.min(74 * k, (available - (BINS - 1) * 2 * k) / BINS));
  const gap = 2 * k;
  const stripW = BINS * (cw + gap) - gap;
  return { rows, cols, cw, gap, stripW, colW: stripW + 18 * k + labelW + colGap };
}

function rampLegendHeight(c, k, maxW) {
  const { rows } = rampGeometry(c, k, maxW);
  return (rowCount(rows.length) * (CELL_H + ROW_GAP) - ROW_GAP + TICK_GAP) * k;
}

function drawRampLegend(c, def, ox, oy, k, maxW, T) {
  const { rows, cw, gap, stripW, colW } = rampGeometry(c, k, maxW);
  const ch = CELL_H * k;

  c.textBaseline = 'middle'; c.textAlign = 'left';
  rows.forEach((r, i) => {
    const x = ox + Math.floor(i / PER_COL) * colW;
    const y = oy + (i % PER_COL) * (CELL_H + ROW_GAP) * k;
    for (let b = 0; b < BINS; b++) {
      c.fillStyle = binColor(r.color, b);
      c.fillRect(x + b * (cw + gap), y, cw, ch);
    }
    c.fillStyle = T.text;
    c.font = `600 ${Math.round(20 * k)}px ${FONT}`;
    c.fillText(r.label, x + stripW + 18 * k, y + ch / 2);
  });

  // the domain, under the first column it belongs to
  const ticks = ticksFor(def);
  const ty = oy + (rowCount(rows.length) * (CELL_H + ROW_GAP) - ROW_GAP + 13) * k;
  c.fillStyle = T.muted;
  c.font = `400 ${Math.round(17 * k)}px ${FONT}`;
  c.textAlign = 'left'; c.fillText(ticks[0], ox, ty);
  c.textAlign = 'center'; c.fillText(ticks[1], ox + stripW / 2, ty);
  c.textAlign = 'right'; c.fillText(ticks[2], ox + stripW, ty);
  c.textAlign = 'left';
}

/* ---------------- canvas helpers ---------------- */

export function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

function splitLines(c, text, maxW) {
  // Exact revision URLs may be wider than a phone-format canvas. Break long
  // tokens as needed, preserving every character of the attribution.
  const words = text.split(/\s+/).flatMap((word) => {
    if (c.measureText(word).width <= maxW) return [word];
    const chunks = []; let chunk = '';
    for (const char of word) {
      if (chunk && c.measureText(chunk + char).width > maxW) { chunks.push(chunk); chunk = ''; }
      chunk += char;
    }
    if (chunk) chunks.push(chunk);
    return chunks;
  }), out = []; let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (c.measureText(t).width > maxW && line) { out.push(line); line = w; }
    else line = t;
  }
  if (line) out.push(line);
  return out;
}

function wrap(c, text, x, y, maxW, lh) {
  splitLines(c, text, maxW).forEach((l, i) => c.fillText(l, x, y + i * lh));
}

function lines(c, text, maxW) { return splitLines(c, text, maxW).length; }

/* ---------------- download ---------------- */

export function dl(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}

export const slug = (fallback) =>
  (state.title || fallback).replace(/[^\w-]+/g, '-').toLowerCase();
