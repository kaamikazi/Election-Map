/**
 * Flags: which unit gets which, loading them, and making sure they are there.
 *
 * One rule governs all of it. On a results map the fill is the data, and a flag
 * never replaces a party colour there. Flags are for maps that are not about
 * results, and for colour in the interface around the data — never in it.
 *
 * A unit gets a flag only when its own code resolves to one, through the
 * explicit table in flag-codes.js. No matching by name and no fallback flag:
 * a unit that does not resolve stays in the unassigned land tone, and that is
 * the correct rendering of "the boundary data gives this no code", not an error.
 */

import { NUMERIC_TO_A2, ALPHA3_TO_A2, FLAG_SET } from './flag-codes.js';
import { state } from './state.js';
import { LAYER, WORLD, BOUNDARY, BY_KEY, onLayerActive } from './geo.js';

export { FLAG_SET };

/* ------------------------------------------------------------- resolution */

/**
 * The alpha-2 code of a unit on the world layer, from the ISO 3166-1 numeric
 * code its geometry carries. Sub-national units are not countries and get none.
 */
export function flagOf(feature) {
  if (!feature || LAYER !== WORLD) return null;
  const id = feature.id;
  if (id == null || id === '') return null;
  return NUMERIC_TO_A2[String(id).padStart(3, '0')] || null;
}

/** A unit key on the active layer to its flag, or null. */
export const flagOfKey = (key) => flagOf(BY_KEY.get(key));

/** A registry country (alpha-3) to its flag, for the layer picker and the badge. */
export const flagOfIso3 = (iso3) => (iso3 && ALPHA3_TO_A2[iso3]) || null;

export const flagUrl = (a2, set = '4x3') => `flags/${set}/${a2}.svg`;

/** An <img> for the interface. Decorative: the name beside it carries the meaning. */
export const flagImg = (a2, cls = 'flag') =>
  a2 ? `<img class="${cls}" src="${flagUrl(a2)}" alt="" loading="lazy" decoding="async">` : '';

/* ---------------------------------------------------------------- loading */

const images = new Map();       // `${set}/${a2}` -> { img, ok, promise }

function entry(a2, set) {
  const id = `${set}/${a2}`;
  let e = images.get(id);
  if (e) return e;
  const img = new Image();
  e = { img, ok: false, failed: false, promise: null };
  e.promise = new Promise((resolve) => {
    img.onload = async () => {
      // `onload` fires before an SVG is guaranteed decodable into a canvas on
      // every engine; decode() is what actually says it can be drawn.
      try { if (img.decode) await img.decode(); } catch (err) { /* onload is enough */ }
      e.ok = img.naturalWidth > 0;
      e.failed = !e.ok;
      resolve(e.ok);
    };
    img.onerror = () => { e.failed = true; resolve(false); };
  });
  img.src = flagUrl(a2, set);
  images.set(id, e);
  return e;
}

export const isReady = (a2, set = '4x3') => {
  const e = images.get(`${set}/${a2}`);
  return !!(e && e.ok);
};

/** Start loading without waiting, for the screen: it redraws when they land. */
export function preload(list, onReady) {
  const pending = [];
  for (const { a2, set } of list) {
    const e = entry(a2, set);
    if (!e.ok && !e.failed) pending.push(e.promise);
  }
  if (pending.length && onReady) Promise.all(pending).then(onReady);
}

/**
 * Wait for every flag in `list`, and report the ones that did not load.
 * Never resolves "fine" with something missing.
 */
export async function ensure(list) {
  const results = await Promise.all(list.map(({ a2, set }) => entry(a2, set).promise
    .then((ok) => ({ a2, set, ok }))));
  return { failed: results.filter((r) => !r.ok) };
}

/* ------------------------------------------------------------- rasterising */

/*
 * Each SVG is rasterised once per size and reused. Sizes are bucketed to powers
 * of two in height, and a draw scales down from the bucket at or above what it
 * needs — so a map with two hundred flags at a hundred slightly different sizes
 * rasterises each flag a handful of times, not a hundred.
 */
const BUCKETS = [16, 32, 64, 128, 256, 512, 1024];
const rasters = new Map();

export function raster(a2, set, needH) {
  const e = images.get(`${set}/${a2}`);
  if (!e || !e.ok) return null;
  const h = BUCKETS.find((b) => b >= needH) || BUCKETS[BUCKETS.length - 1];
  const id = `${set}/${a2}@${h}`;
  let cv = rasters.get(id);
  if (cv) return cv;
  const aspect = set === '1x1' ? 1 : 4 / 3;
  cv = document.createElement('canvas');
  cv.width = Math.round(h * aspect);
  cv.height = h;
  cv.getContext('2d').drawImage(e.img, 0, 0, cv.width, cv.height);
  rasters.set(id, cv);
  return cv;
}

/* ---------------------------------------------------------- what is needed */

/** The export badge's flag: single-country layers only, never the world map. */
export function badgeFlag() {
  if (LAYER === WORLD || !BOUNDARY) return null;
  return flagOfIso3(BOUNDARY.iso);
}

/** Every flag the current document needs to be drawn, in both sets it may use. */
export function flagsNeeded() {
  const out = [];
  if (state.mode === 'flags') {
    for (const key of Object.keys(state.flagged)) {
      const a2 = flagOfKey(key);
      if (!a2) continue;           // resolves to nothing: drawn unassigned, not awaited
      out.push({ a2, set: '4x3' }, { a2, set: '1x1' });
    }
  }
  const badge = badgeFlag();
  if (badge) out.push({ a2: badge, set: '4x3' });
  const seen = new Set();
  return out.filter(({ a2, set }) => {
    const id = set + a2;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * Everything an export needs, loaded. The export race lives here: an SVG
 * decodes asynchronously, and a composite that draws before every flag is ready
 * ships a PNG with blank countries and no complaint. So this is awaited before
 * any export, and it throws — naming the flags — rather than letting one through.
 */
export async function prepareExport() {
  const { failed } = await ensure(flagsNeeded());
  if (failed.length) {
    throw new Error('These flags did not load: ' +
      failed.map((f) => `${f.a2} (${f.set})`).join(', '));
  }
}

/**
 * The synchronous half of the same guard, called by composite(). If anything
 * the frame needs is not decoded yet, the export stops here instead of drawing
 * a country blank. A caller that sees this forgot to await prepareExport().
 */
export function assertFlagsReady() {
  const missing = flagsNeeded().filter(({ a2, set }) => !isReady(a2, set));
  if (missing.length) {
    const err = new Error('Export attempted before these flags decoded: ' +
      missing.map((m) => `${m.a2} (${m.set})`).join(', ') + '. Await prepareExport() first.');
    err.code = 'FLAGS_NOT_READY';
    throw err;
  }
}

// A single-country layer's badge is loaded as the layer is, so it is ready
// before anyone can ask for an export of it.
onLayerActive(async () => {
  const a2 = badgeFlag();
  if (a2) await ensure([{ a2, set: '4x3' }]);
});
