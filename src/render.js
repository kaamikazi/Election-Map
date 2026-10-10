/**
 * The one draw function. The screen canvas and the exported PNG both come
 * through drawMap — only the size, the padding and the stroke scale k differ.
 * If a second drawing path ever appears here, the two will drift apart.
 */

import { presentation, capsFont, bodyFont, historyIdentity } from './identity.js';
import { state, partyFor, recordFor } from './state.js';
import { fillFor } from './metrics.js';
import {
  FEATS, BORDERS, OUTLINE, BY_KEY, backdrop,
  SPHERE, GRAT, buildProjection, setLiveProjection, largestPolygon
} from './geo.js';
import { flagOf, isReady, raster, preload } from './flags.js';

/**
 * @param {CanvasRenderingContext2D} c
 * @param {number} W  full canvas width in CSS pixels
 * @param {number} H  full canvas height
 * @param {object} opt
 *   pad         inner padding used when fitting the projection
 *   k           stroke and glyph scale — 1 on screen, W/1600-ish on export
 *   transparent skip the background fill and the flat-map ocean
 *   hover       feature to outline
 *   selected    feature to outline in amber
 *   inset       [top, right, bottom, left] box to draw the map inside
 *   bg          false to draw over whatever is already on the canvas
 *   inViewOf    names to count as inside the drawn frame
 *   report      object drawMap writes { inView } into
 * @returns the projection that was used
 */
export function drawMap(c, W, H, opt) {
  const o = Object.assign(
    { pad: 22, k: 1, transparent: false, hover: null, selected: null, inset: [0, 0, 0, 0], bg: true,
      inViewOf: null, report: null },
    opt || {}
  );
  const T = presentation();
  const historical = state.explainer;

  /* The active metric decides the fill; on "flat" this is the party colour. */
  const fill = (key) => {
    const p = partyFor(key);
    return p ? fillFor(recordFor(key), p.color, state.metric, T.unvalued) : null;
  };
  const [it, ir, ib, il] = o.inset;
  c.save();
  if (o.bg !== false) {
    c.clearRect(0, 0, W, H);
    if (!o.transparent) { c.fillStyle = T.bg; c.fillRect(0, 0, W, H); }
  }

  // project into the inset box
  c.translate(il, it);
  const w = W - il - ir, h = H - it - ib;
  c.beginPath(); c.rect(0, 0, w, h); c.clip();

  const p = buildProjection(w, h, o.pad);
  const path = d3.geoPath(p, c);

  /*
   * What the projection actually came out as, for anyone who needs to compare
   * two draws. A series claims its frame does not move between frames, and the
   * only colour-independent way to check that is the projection itself:
   * comparing pixels cannot tell a coastline that moved from a coastline that
   * merely changed colour, because an antialiased coast pixel is a blend of the
   * ocean and whatever is inland of it.
   */
  if (o.report) {
    o.report.projection = {
      scale: p.scale(),
      translate: p.translate(),
      box: [w, h],
      inset: o.inset.slice(),
      // Two reference points through the same projection, as a second opinion
      // that does not depend on reading scale and translate correctly.
      probe: [[0, 50], [20, 60]].map((ll) => p(ll))
    };
  }

  // ocean / sphere
  c.beginPath();
  if (state.proj === 'albersUsa') c.rect(0, 0, w, h);
  else path(SPHERE);
  if (o.transparent) { c.globalAlpha = state.proj === 'globe' ? 1 : 0; }
  c.fillStyle = T.ocean; c.fill(); c.globalAlpha = 1;

  if (state.grat) {
    c.beginPath(); path(GRAT);
    c.strokeStyle = T.grat; c.lineWidth = 0.6 * o.k; c.stroke();
  }

  // The rest of the world, under a province layer, so the country sits somewhere
  const under = backdrop();
  if (under && state.proj !== 'albersUsa') {
    c.beginPath();
    for (const f of under) path(f);
    c.fillStyle = T.backdrop; c.fill();
    c.strokeStyle = T.border; c.lineWidth = 0.5 * o.k; c.stroke();
  }

  /*
   * Flags mode draws its own fills, casing and discs, and nothing else differs.
   * The results branch below is the exact code that ran before flags existed,
   * and the parity gate holds it byte-identical: a flag must never leak into a
   * results map, where the fill is the data.
   */
  const flagMode = state.mode === 'flags';
  const flagged = flagMode ? drawFlagFills(c, path, T, o.k) : null;

  if (!flagMode) {
    // group by fill so we issue few fills
    const groups = new Map();
    for (const f of FEATS) {
      if (historical && f.key !== historical.countryKey) continue;
      if (!state.antarctica && f.name === 'Antarctica') continue;
      const party = partyFor(f.key);
      const col = fill(f.key) || T.land;
      const hatch = !!(party && party.hatch);
      const key = col + (hatch ? '|hatch' : '');
      if (!groups.has(key)) groups.set(key, { col, hatch, list: [] });
      groups.get(key).list.push(f);
    }
    for (const g of groups.values()) {
      c.beginPath();
      for (const f of g.list) path(f);
      c.fillStyle = g.hatch ? hatchPattern(c, g.col, T.hatchInk, o.k) : g.col;
      c.fill();
    }
  }

  // internal borders
  c.beginPath();
  if (historical) path(BY_KEY.get(historical.countryKey));
  else path(BORDERS);
  c.strokeStyle = historical || state.nationalElection ? T.edge : T.border;
  c.lineWidth = (historical || state.nationalElection ? 1.2 : 0.55) * o.k; c.lineJoin = 'round'; c.stroke();

  if (flagMode) drawFlagCasing(c, path, T, o.k, flagged);

  // What flags mode actually drew, and through which projection, so a caller
  // can check the pixels it claims to have filled. The projection function is
  // for in-page use only; it does not serialise and is not meant to.
  if (flagMode && o.report) {
    o.report.flags = flagged.map(({ f, a2, tiny }) => ({ key: f.key, a2, tiny }));
    o.report.discRadius = discRadius(o.k);
    o.report.project = p;
    o.report.origin = [il, it];
  }

  // the layer's own edge — the country outline on a province layer
  if (OUTLINE) {
    c.beginPath(); path(OUTLINE);
    c.strokeStyle = T.edge; c.lineWidth = 1.3 * o.k; c.stroke();
  }

  // coastline / sphere edge
  if (state.proj !== 'albersUsa') {
    c.beginPath(); path(SPHERE);
    c.strokeStyle = T.edge; c.lineWidth = 0.9 * o.k; c.stroke();
  }

  // Dots for assigned units too small to see. Some admin-1 units are genuinely
  // tiny — capital districts, island provinces — and vanish without this.
  if (flagMode) {
    if (state.dots) drawFlagDiscs(c, path, T, o.k, flagged);
  } else if (state.dots) {
    for (const f of FEATS) {
      const col = fill(f.key);
      if (!col) continue;
      const a = path.area(f);
      if (a > 26 * o.k * o.k) continue;
      const cc = path.centroid(f);
      if (!isFinite(cc[0])) continue;
      c.beginPath(); c.arc(cc[0], cc[1], 3.4 * o.k, 0, Math.PI * 2);
      c.fillStyle = col; c.fill();
      c.lineWidth = 1.2 * o.k; c.strokeStyle = T.ring; c.stroke();
    }
  }

  // labels
  if (state.labels && !state.nationalElection) {
    c.font = `600 ${11 * o.k}px ${capsFont()}`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const f of FEATS) {
      if (flagMode ? !state.flagged[f.key] : !fill(f.key)) continue;
      if (path.area(f) < 900 * o.k * o.k) continue;
      const cc = path.centroid(f);
      if (!isFinite(cc[0])) continue;
      c.lineWidth = 3 * o.k; c.strokeStyle = historyIdentity() ? '#1d1610' : 'rgba(0,0,0,.45)';
      c.strokeText(f.name, cc[0], cc[1]);
      c.fillStyle = historyIdentity() ? '#efe3c4' : '#fff'; c.fillText(f.name, cc[0], cc[1]);
    }
  }

  if (state.nationalElection && state.proj === 'albersUsa') drawUsLabels(c, path, p, w, h, o, T);

  // selection, then hover on top of it
  if (o.selected && !historical) {
    c.beginPath(); path(o.selected);
    c.strokeStyle = '#E8B33A'; c.lineWidth = 2.2 * o.k; c.stroke();
  }

  // hover outline
  if (o.hover && !historical) {
    c.beginPath(); path(o.hover);
    c.strokeStyle = T.hover; c.lineWidth = 1.6 * o.k; c.stroke();
  }

  if (historical) {
    const point = p(historical.point.coordinates);
    const [x, y] = point || [NaN, NaN];
    c.font = `600 ${24 * o.k}px ${capsFont()}`;
    const labelWidth = c.measureText(historical.point.label).width;
    const lx = x + 14 * o.k, ly = y - 6 * o.k;
    const fits = Number.isFinite(x) && Number.isFinite(y) && x > 7 * o.k && y > 28 * o.k &&
      lx + labelWidth + 8 * o.k < w && y + 8 * o.k < h;
    if (!fits && o.report) throw new Error('The Athens locator or label is outside the map frame. Reset the view or choose a different layout.');
    if (fits) {
      c.fillStyle = T.bg;
      c.fillRect(lx - 4 * o.k, ly - 22 * o.k, labelWidth + 8 * o.k, 30 * o.k);
      c.fillStyle = T.text; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
      c.fillText(historical.point.label, lx, ly);
      c.beginPath(); c.arc(x, y, 5 * o.k, 0, Math.PI * 2);
      c.fillStyle = T.text; c.fill();
      c.strokeStyle = T.bg; c.lineWidth = 2 * o.k; c.stroke();
    }
    c.font = `400 ${16 * o.k}px ${bodyFont()}`;
    c.textAlign = 'left'; c.textBaseline = 'bottom'; c.fillStyle = T.text;
    const key = `${historical.point.label} · modern geographic locator`;
    c.fillStyle = T.bg; c.fillRect(10 * o.k, h - 35 * o.k, c.measureText(key).width + 14 * o.k, 25 * o.k);
    c.fillStyle = T.text; c.fillText(key, 16 * o.k, h - 13 * o.k);
    if (o.report) o.report.locator = { country: historical.countryKey, coordinates: historical.point.coordinates, point: [x + il, y + it] };
  }

  // how many of the units we were asked about actually landed in frame
  if (o.inViewOf && o.report) {
    let n = 0;
    for (const key of o.inViewOf) {
      const f = BY_KEY.get(key);
      if (!f) continue;
      const cc = path.centroid(f);
      if (!isFinite(cc[0])) continue;
      if (cc[0] >= 0 && cc[0] <= w && cc[1] >= 0 && cc[1] <= h) n++;
    }
    o.report.inView = n;
  }

  c.restore();
  return p;
}

/* ---------------- flags mode ---------------- */

/** Every polygon of a unit, as Polygon geometries. */
function polygonsOf(f) {
  const g = f.geometry;
  if (!g) return [];
  if (g.type === 'Polygon') return [g];
  if (g.type === 'MultiPolygon') {
    return g.coordinates.map((coordinates) => ({ type: 'Polygon', coordinates }));
  }
  return [];
}

/** How many device pixels one canvas unit is, so rasters are sized for the output. */
function deviceScale(c) {
  const m = c.getTransform ? c.getTransform() : null;
  return m ? Math.max(Math.abs(m.a), Math.abs(m.d)) || 1 : 1;
}

/**
 * Draw a flag to cover the box: scaled until it fills both dimensions, then
 * cropped by whatever clip is active. Never stretched. A flag's aspect ratio is
 * part of the flag, and Chile or Norway drawn to their own outlines would be
 * unrecognisable; a long thin shape shows a slice of the flag instead.
 */
function coverDraw(c, a2, set, box, scale) {
  const [[x0, y0], [x1, y1]] = box;
  const bw = x1 - x0, bh = y1 - y0;
  if (!isFinite(bw) || !isFinite(bh) || !(bw > 0.25) || !(bh > 0.25)) return;
  const aspect = set === '1x1' ? 1 : 4 / 3;
  let dw = bw, dh = bw / aspect;
  if (dh < bh) { dh = bh; dw = bh * aspect; }
  const img = raster(a2, set, dh * scale);
  if (!img) return;
  c.drawImage(img, x0 + (bw - dw) / 2, y0 + (bh - dh) / 2, dw, dh);
}

/** The disc radius for a unit too small to carry a flag, in canvas units. */
export const discRadius = (k) => 8 * k;

/**
 * A flagged unit gets a disc instead of a fill when the fill would show less
 * flag than the disc does.
 *
 * The first version of this asked only whether the unit's box was smaller than
 * the disc, and at 500px wide that left Italy, France and Spain as slivers — a
 * boot a few pixels across showing a slice of a flag, too big to be a disc and
 * too small to read. Area is the honest measure: a unit whose drawn area is
 * under twice the disc's carries less of its flag as a fill than as a disc.
 * Measured on the largest polygon, so Malta's main island decides and not the
 * spread of every rock it administers.
 */
function isTiny(path, f, k) {
  const main = largestPolygon(f);
  if (!main) return false;
  const [[x0, y0], [x1, y1]] = path.bounds(main);
  if (![x0, y0, x1, y1].every(isFinite)) return false;
  const r = discRadius(k);
  if (Math.max(x1 - x0, y1 - y0) < r * 2) return true;
  return path.area(main) < 2 * Math.PI * r * r;
}

/**
 * Fills for flags mode. Everything starts in the unassigned land tone, so the
 * map reads as "these countries" rather than a wall of flags, and each selected
 * unit whose own code resolves gets its flag, clipped to its outline.
 *
 * Every polygon is fitted on its own box. France's flag is fitted to France and
 * French Guiana carries a small tricolour of its own, instead of one flag
 * stretched across the Atlantic; each of Indonesia's islands reads red over
 * white for the same reason. The largest polygon decides whether the unit is
 * too small for a fill at all.
 *
 * Returns the units drawn with a flag, for the casing and the discs.
 */
function drawFlagFills(c, path, T, k) {
  c.beginPath();
  for (const f of FEATS) {
    if (!state.antarctica && f.name === 'Antarctica') continue;
    path(f);
  }
  // Darker than results mode's land: flags are bright and busy, and against
  // the ordinary land tone a handful of them read as noise rather than a set.
  c.fillStyle = T.flagLand; c.fill();

  const scale = deviceScale(c);
  const drawn = [];
  const waiting = [];
  for (const f of FEATS) {
    if (!state.flagged[f.key]) continue;
    const a2 = flagOf(f);
    if (!a2) continue;                     // no code, no flag: stays unassigned
    if (!isReady(a2, '4x3') || !isReady(a2, '1x1')) {
      waiting.push({ a2, set: '4x3' }, { a2, set: '1x1' });
      continue;
    }
    const tiny = !!state.dots && isTiny(path, f, k);
    drawn.push({ f, a2, tiny });
    if (tiny) continue;
    for (const poly of polygonsOf(f)) {
      c.save();
      c.beginPath(); path(poly); c.clip();
      coverDraw(c, a2, '4x3', path.bounds(poly), scale);
      c.restore();
    }
  }
  // On screen, a flag that has not decoded yet shows as land and the map
  // redraws when it lands. An export never reaches this point with one
  // missing: composite() refuses first.
  if (waiting.length) preload(waiting, schedule);
  return drawn;
}

/**
 * Casing: a dark edge around every flagged unit.
 *
 * Flags are full of white and pale stripes. Two touching — Poland's white band
 * against Czechia's, Indonesia's white half against its neighbours, any pale
 * stripe against the light theme's pale land — lose the line between them with
 * the thin mesh border results mode uses. A heavier dark stroke around each
 * flagged outline keeps every unit separable at thumbnail size.
 */
function drawFlagCasing(c, path, T, k, drawn) {
  const list = drawn.filter((d) => !d.tiny);
  if (!list.length) return;
  c.beginPath();
  for (const { f } of list) path(f);
  c.strokeStyle = T.casing; c.lineWidth = 1.6 * k; c.lineJoin = 'round'; c.stroke();
}

/**
 * Micro-states get a round flag disc with a ring in the background colour, not
 * a coloured dot: a dot in flags mode would be a colour nothing decodes.
 */
function drawFlagDiscs(c, path, T, k, drawn) {
  const r = discRadius(k);
  const scale = deviceScale(c);
  for (const { f, a2, tiny } of drawn) {
    if (!tiny) continue;
    const cc = path.centroid(largestPolygon(f) || f);
    if (!isFinite(cc[0]) || !isFinite(cc[1])) continue;
    c.save();
    c.beginPath(); c.arc(cc[0], cc[1], r, 0, Math.PI * 2); c.clip();
    coverDraw(c, a2, '1x1', [[cc[0] - r, cc[1] - r], [cc[0] + r, cc[1] + r]], scale);
    c.restore();
    c.beginPath(); c.arc(cc[0], cc[1], r, 0, Math.PI * 2);
    c.lineWidth = 1.8 * k; c.strokeStyle = T.bg; c.stroke();
    c.beginPath(); c.arc(cc[0], cc[1], r + 0.9 * k, 0, Math.PI * 2);
    c.lineWidth = 0.6 * k; c.strokeStyle = T.casing; c.stroke();
  }
}

/**
 * Diagonal hatching, used for "assigned, but the source records no party
 * family". A second grey would read as "no data", which is a different claim
 * and a wrong one — a hatched country has a government, just not a classified
 * one. Hatching survives being shrunk to a thumbnail; two greys do not.
 */
function hatchPattern(c, base, ink, k) {
  const size = Math.max(6, Math.round(9 * k));
  const tile = document.createElement('canvas');
  tile.width = tile.height = size;
  const t = tile.getContext('2d');
  t.fillStyle = base;
  t.fillRect(0, 0, size, size);
  t.strokeStyle = ink;
  t.lineWidth = Math.max(1, size / 4.5);
  // Drawn three times so the stripes meet across the tile seam.
  t.beginPath();
  t.moveTo(-size, size); t.lineTo(size, -size);
  t.moveTo(-size * 0.5, size * 1.5); t.lineTo(size * 1.5, -size * 0.5);
  t.moveTo(0, size * 2); t.lineTo(size * 2, 0);
  t.stroke();
  return c.createPattern(tile, 'repeat');
}

/** The same hatch as a CSS background, for legend swatches in the DOM. */
export function hatchCss(base, ink) {
  return `repeating-linear-gradient(45deg, ${base} 0 3px, ${ink} 3px 5px)`;
}

/* ---------------- the screen canvas ---------------- */

let canvas = null, ctx = null, wrap = null;
function drawUsLabels(c, path, p, w, h, o, T) {
  const e = state.nationalElection;
  const small = ['VT', 'NH', 'MA', 'RI', 'CT', 'NJ', 'DE', 'MD', 'DC'];
  const bounds = [];
  const labelSize = Math.min(18 * o.k, Math.max(12 * o.k, h * .045));
  c.font = `600 ${Math.round(labelSize)}px ${capsFont()}`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  for (const s of e.states) {
    const f = BY_KEY.get(s.key), box = path.bounds(f), xy = path.centroid(f);
    const visible = path.area(f) > 0 && box.flat().every(Number.isFinite) &&
      box[0][0] >= 0 && box[0][1] >= 0 && box[1][0] <= w && box[1][1] <= h;
    if (!visible && o.report) throw new Error(`${s.name} is outside the national map frame. Reset the view before exporting.`);
    bounds.push({ postal: s.postal, key: s.key, visible, bounds: box });
    if (!visible || small.includes(s.postal)) continue;
    const label = s.postal + (['ME', 'NE'].includes(s.postal) ? '*' : '');
    c.lineWidth = 2.5 * o.k; c.strokeStyle = '#1d1610'; c.strokeText(label, ...xy);
    c.fillStyle = '#efe3c4'; c.fillText(label, ...xy);
  }
  const x = w * .855, rowHeight = Math.min(22 * o.k, (h - 44 * o.k) / small.length);
  c.textAlign = 'left'; c.fillStyle = T.text;
  c.font = `400 ${Math.round(15 * o.k)}px ${bodyFont()}`;
  c.fillText('Small states & D.C.', x, 20 * o.k);
  small.forEach((postal, i) => {
    const s = e.states.find(s => s.postal === postal), y = 42 * o.k + i * rowHeight;
    const f = BY_KEY.get(s.key), xy = path.centroid(f);
    const label = w * .145 > 150 * o.k ? `${postal} · ${s.name}` : postal;
    const colour = partyFor(s.key).color;
    c.fillStyle = colour; c.fillRect(x, y - 5 * o.k, 10 * o.k, 10 * o.k);
    c.fillStyle = T.text; c.fillText(label, x + 16 * o.k, y);
    if (postal === 'DC') {
      c.beginPath(); c.arc(...xy, 4 * o.k, 0, Math.PI * 2); c.fillStyle = colour; c.fill();
      c.strokeStyle = T.text; c.lineWidth = 1 * o.k; c.stroke();
      c.beginPath(); c.moveTo(...xy); c.lineTo(x - 6 * o.k, y); c.strokeStyle = T.muted; c.stroke();
    }
  });
  if (o.report) o.report.nationalUnits = bounds;
}

let hovered = null;

export function mountCanvas(canvasEl, wrapEl) {
  canvas = canvasEl;
  wrap = wrapEl;
  ctx = canvas.getContext('2d');
}

/** Set by main so render can outline the division in the values editor. */
let selectedFeature = () => null;
export const setSelectedFeature = (fn) => { selectedFeature = fn; };

export const getHover = () => hovered;
export function setHover(f) { hovered = f; }

export function render() {
  const W = wrap.clientWidth, H = wrap.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  setLiveProjection(drawMap(ctx, W, H, {
    pad: 18, k: 1, hover: hovered, selected: selectedFeature()
  }));
}

let raf = null;
export function schedule() {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = null; render(); });
}
