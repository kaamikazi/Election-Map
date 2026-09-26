/**
 * Geography: the world topology, the three projections, region fitting, and
 * hit testing. Everything that turns lon/lat into pixels or back lives here.
 */

import { state } from './state.js';

export const SPHERE = { type: 'Sphere' };
export const GRAT = d3.geoGraticule10();

/* ---------------- layers ----------------
 *
 * A layer is a set of units the map can colour: the world's countries, or one
 * country's provinces. The active layer's features are live bindings, so every
 * consumer sees the switch without being told about it.
 *
 * Units are keyed, not named. The world layer keys by country name because its
 * topology is vendored into this repo and frozen — that is also what v1 did and
 * what every save file so far holds. Admin-1 layers key by Natural Earth's
 * `adm1_code`, because those files are regenerated from an upstream release
 * whose names move: Chittagong became Chattogram in 2018, and an assignment
 * keyed by the old spelling would silently detach on the next rebuild.
 */

export const WORLD = 'world';

export let LAYER = WORLD;
export let FEATS = [];
export let BORDERS = null;
export let BY_KEY = new Map();
export let OUTLINE = null;

/**
 * The registry entry for the active layer: which source drew these boundaries,
 * what year they represent, under what licence and by whom. Null for the world
 * layer, which is read as a schematic and claims nothing.
 */
export let BOUNDARY = null;

const loaded = new Map();      // layer id -> { feats, borders, byKey, boundary }
let registry = null;           // public/data/boundaries.json, once

/** `gb:BGD:ADM1` -> { src: 'gb', iso3: 'BGD', level: 'ADM1' } */
export const layerParts = (id) => {
  const parts = String(id || WORLD).split(':');
  if (parts.length < 3) return { src: WORLD, iso3: null, level: null };
  return { src: parts[0], iso3: parts[1], level: parts[2] };
};

/** Prepare features for drawing and hit testing. */
function prepare(features, keyOf) {
  features.forEach((f) => {
    f.name = f.properties.name;
    f.key = keyOf(f);
    f.bnd = d3.geoBounds(f);
    f.cen = d3.geoCentroid(f);
  });
  features.sort((a, b) => a.name.localeCompare(b.name));
  return features;
}

export async function loadWorld(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not load ' + url + ' (' + res.status + ')');
  const world = await res.json();

  const fc = topojson.feature(world, world.objects.countries);
  const feats = prepare(
    fc.features.filter((f) => f.properties && f.properties.name),
    (f) => f.properties.name
  );

  loaded.set(WORLD, {
    feats,
    borders: topojson.mesh(world, world.objects.countries, (a, b) => a !== b),
    outline: null,
    byKey: new Map(feats.map((f) => [f.key, f])),
    // The world outline is read as a schematic, so it claims no vintage.
    // A province map cannot be read that way — see boundarySources below.
    boundary: null
  });
  activate(WORLD);
  return FEATS;
}

/** The boundary registry: every source built, with its vintage and licence. */
export async function layerCatalogue() {
  if (registry) return registry;
  const res = await fetch('data/boundaries.json');
  if (!res.ok) throw new Error('No boundary sources are built. Run: npm run build:admin1');
  registry = await res.json();
  return registry;
}

/**
 * Every source for one country, newest first.
 *
 * A country can have more than one, and they disagree: Natural Earth has seven
 * Bangladeshi divisions and geoBoundaries has eight, because Mymensingh split
 * from Dhaka in 2015. Both are offered with their unit counts and vintages so
 * the difference is visible before the choice is made, and the frozen Natural
 * Earth set stays available because it is what makes an export reproducible.
 */
export async function boundarySources(iso3) {
  const reg = await layerCatalogue();
  return Object.entries(reg.sources)
    .filter(([, e]) => e.iso === iso3)
    // `id` is the source ('ne', 'gb'); `layerId` is the whole 'gb:BGD:ADM1'.
    .map(([layerId, e]) => ({ ...e, layerId }))
    .sort((a, b) => (b.vintage || 0) - (a.vintage || 0) || a.level.localeCompare(b.level));
}

/** Countries with at least one source built. */
export async function boundaryCountries() {
  const reg = await layerCatalogue();
  const seen = new Map();
  for (const e of Object.values(reg.sources)) {
    if (!seen.has(e.iso)) seen.set(e.iso, { iso: e.iso, name: reg.countries[e.iso] || e.iso, sources: 0 });
    seen.get(e.iso).sources++;
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export const isLayerLoaded = (id) => loaded.has(id);

/**
 * Load a layer and make it active. Layers stay in memory for the session —
 * these files are the largest thing the app fetches.
 */
export async function loadLayer(id) {
  await prepareLayer(id);
  activate(id);
  // Anything that must be ready before this layer can be exported — its flag
  // badge, today — is awaited here, so a caller that loads a layer and then
  // exports cannot race an image decode.
  return FEATS;
}

/** Fetch, validate and prepare without changing visible geometry. */
export async function prepareLayer(id) {
  const data = await loadLayerData(id);
  for (const hook of layerHooks) await hook(id, data);
  return data;
}

const layerHooks = [];
/** Register work to await whenever a layer becomes active. */
export const onLayerActive = (fn) => { layerHooks.push(fn); };

/**
 * Load a layer into the cache without putting it on screen.
 *
 * The partition check needs a deeper level — a country's districts while its
 * divisions are the map — and reading it must not disturb what the person is
 * looking at.
 */
export async function loadLayerData(id) {
  if (loaded.has(id)) return loaded.get(id);

  const { src, iso3, level } = layerParts(id);
  if (src === WORLD) throw new Error('The world layer loads at boot');

  const reg = await layerCatalogue();
  const entry = reg.sources[id];
  if (!entry) throw new Error(`No ${level || 'admin'} boundaries are built for ${iso3} from ${src}`);

  const res = await fetch(entry.file);
  if (!res.ok) throw new Error(`Could not load ${entry.file} (${res.status})`);
  const topo = await res.json();

  const object = topo.objects.units;
  const feats = prepare(topojson.feature(topo, object).features, (f) => f.properties.id);
  if (!feats.length || feats.length !== entry.units ||
      feats.some((f) => !f.key || !f.geometry) || new Set(feats.map((f) => f.key)).size !== feats.length) {
    throw new Error(`Invalid geometry for ${id}. Rebuild or restore its boundary file.`);
  }

  const layer = {
    feats,
    borders: topojson.mesh(topo, object, (a, b) => a !== b),
    // The country's own edge, drawn harder than the divisions inside it.
    outline: topojson.mesh(topo, object, (a, b) => a === b),
    byKey: new Map(feats.map((f) => [f.key, f])),
    boundary: { layerId: id, ...entry }
  };
  loaded.set(id, layer);
  return layer;
}

export function activate(id) {
  const layer = loaded.get(id);
  if (!layer) throw new Error(`Layer ${id} has not been prepared`);
  LAYER = id;
  FEATS = layer.feats;
  BORDERS = layer.borders;
  OUTLINE = layer.outline;
  BY_KEY = layer.byKey;
  BOUNDARY = layer.boundary;
}

/**
 * The world's countries, to draw underneath a province layer. Without it a map
 * of Bangladesh sits in an empty ocean with no India around it, and nobody can
 * tell where they are looking.
 */
export function backdrop() {
  if (LAYER === WORLD) return null;
  const world = loaded.get(WORLD);
  return world ? world.feats : null;
}

/** Units of the active layer, as the matcher wants them. */
export const unitList = () => FEATS.map((f) => ({ key: f.key, name: f.name }));

/* ---------------- projection ---------------- */

// Sample a lon/lat box as points — avoids polygon winding traps in fitExtent.
export function bboxGeo(b) {
  const [[x0, y0], [x1, y1]] = b, pts = [];
  for (let i = 0; i <= 32; i++) {
    const x = x0 + (x1 - x0) * i / 32, y = y0 + (y1 - y0) * i / 32;
    pts.push([x, y0], [x, y1], [x0, y], [x1, y]);
  }
  return { type: 'MultiPoint', coordinates: pts };
}

const MERC_LIMIT = bboxGeo([[-180, -58], [180, 81]]);

export let lastBase = { s0: 150, t0: [0, 0] };

export function buildProjection(W, H, pad) {
  let p, target;
  if (state.proj === 'globe') {
    p = d3.geoOrthographic().rotate(state.rotate).clipAngle(90);
    target = SPHERE;
  } else if (state.proj === 'mercator') {
    p = d3.geoMercator();
    target = state.fit ? bboxGeo(state.fit) : MERC_LIMIT;
  } else {
    p = d3.geoEqualEarth();
    target = state.fit ? bboxGeo(state.fit) : SPHERE;
  }
  p.fitExtent([[pad, pad], [W - pad, H - pad]], target);
  const s = p.scale() * regionZoom(), t = p.translate();
  lastBase = { s0: s, t0: t };
  p.scale(s * state.zoom).translate([t[0] + state.pan[0] * s, t[1] + state.pan[1] * s]);
  return p;
}

// The globe cannot be fitted to a box, so a region turns into a zoom factor instead.
function regionZoom() {
  if (state.proj !== 'globe' || !state.fit) return 1;
  const [[x0, y0], [x1, y1]] = state.fit;
  const mid = (y0 + y1) / 2 * Math.PI / 180;
  const span = Math.max((x1 - x0) * Math.cos(mid), y1 - y0);
  return clamp(150 / span, 1, 8);
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * The lon/lat box that holds these features, with a margin.
 *
 * Used to frame an imported or archive-built map to its own data instead of to
 * a fixed region box. A map of 23 European governments should not spend half
 * its width on the Atlantic, and the right frame changes with every year's
 * coverage — so it has to be derived, not chosen.
 *
 * Returns null when there is nothing to frame.
 */
export function boundsOf(keys, margin = 0.12) {
  const feats = keys.map((k) => BY_KEY.get(k)).filter(Boolean);
  if (!feats.length) return null;

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of feats) {
    const b = mainlandBounds(f);
    if (!b) continue;
    x0 = Math.min(x0, b[0][0]); y0 = Math.min(y0, b[0][1]);
    x1 = Math.max(x1, b[1][0]); y1 = Math.max(y1, b[1][1]);
  }
  if (![x0, y0, x1, y1].every(isFinite)) return null;

  // A span this wide is not a frame, it is the world; let the default handle it.
  if (x1 - x0 > 270 || y1 - y0 > 150) return null;

  const mx = Math.max((x1 - x0) * margin, 1.5);
  const my = Math.max((y1 - y0) * margin, 1.5);
  return [
    [clamp(x0 - mx, -180, 180), clamp(y0 - my, -89, 89)],
    [clamp(x1 + mx, -180, 180), clamp(y1 + my, -89, 89)]
  ];
}

/**
 * The bounds of a country's main landmass, not of everything it administers.
 *
 * Natural Earth puts French Guiana and Réunion inside France, the Azores inside
 * Portugal and the Canaries inside Spain. Taking the full bounds of a map of
 * western Europe therefore spans from South America to the Indian Ocean, and
 * fitting to that draws the whole world. The largest polygon is where the
 * country mostly is, which is what a frame should follow.
 */
function mainlandBounds(f) {
  const g = f.geometry;
  if (!g) return null;
  if (g.type !== 'MultiPolygon') return d3.geoBounds(f);
  const best = largestPolygon(f);
  return best ? d3.geoBounds(best) : d3.geoBounds(f);
}

/**
 * The largest polygon of a unit, as a Polygon geometry. Framing uses it for the
 * reason above; flags mode uses it so France's flag is fitted to France and not
 * stretched across to French Guiana. Cached on the feature — it never changes.
 */
export function largestPolygon(f) {
  if (f._largest !== undefined) return f._largest;
  const g = f.geometry;
  let best = null;
  if (g && g.type === 'Polygon') best = g;
  else if (g && g.type === 'MultiPolygon') {
    let bestArea = -1;
    for (const coordinates of g.coordinates) {
      const poly = { type: 'Polygon', coordinates };
      const area = d3.geoArea(poly);
      if (area > bestArea) { bestArea = area; best = poly; }
    }
  }
  f._largest = best;
  return best;
}

/* ---------------- hit testing ---------------- */

// The projection currently on screen — the only one pointer events can invert.
let liveProj = null;
export const setLiveProjection = (p) => { liveProj = p; };

/**
 * Where a unit sits on the screen canvas, in CSS pixels: the centre of its
 * largest polygon under the projection currently drawn. Used by the suite to
 * tap a country the way a finger would, rather than calling paint() directly.
 */
export function screenPointOf(key) {
  const f = BY_KEY.get(key);
  if (!f || !liveProj) return null;
  const c = d3.geoPath(liveProj).centroid(largestPolygon(f) || f);
  return isFinite(c[0]) && isFinite(c[1]) ? c : null;
}

function inBounds(f, lon, lat) {
  const [[x0, y0], [x1, y1]] = f.bnd;
  if (lat < y0 - 0.5 || lat > y1 + 0.5) return false;
  if (x0 <= x1) return lon >= x0 - 0.5 && lon <= x1 + 0.5;
  return lon >= x0 - 0.5 || lon <= x1 + 0.5;   // crosses antimeridian
}

export function pick(px, py) {
  if (!liveProj || !liveProj.invert) return null;
  const ll = liveProj.invert([px, py]);
  if (!ll || !isFinite(ll[0])) return null;
  for (const f of FEATS) {
    if (!state.antarctica && f.name === 'Antarctica') continue;
    if (!inBounds(f, ll[0], ll[1])) continue;
    if (d3.geoContains(f, ll)) return f;
  }
  return null;
}
