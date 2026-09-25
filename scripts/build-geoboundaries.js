#!/usr/bin/env node
/**
 * Pull one country's boundaries from geoBoundaries into the registry.
 *
 *   node scripts/build-geoboundaries.js BGD:ADM1 BGD:ADM2
 *   node scripts/build-geoboundaries.js BGD           # ADM1 by default
 *   node scripts/build-geoboundaries.js --list BGD    # what levels exist
 *
 * Deliberately one country at a time. Bulk-fetching two hundred countries at
 * two levels on a first run is a lot of someone else's bandwidth for data
 * nobody has asked for yet; adding a country is one command when it is needed.
 *
 * Everything in the registry entry — the year the boundary represents, the
 * licence, the agency, the unit count — comes from the API's own metadata, not
 * from an assumption made here. That is the whole point of the milestone: the
 * previous version asserted "present-day boundaries" for every country and was
 * wrong about Bangladesh, and nothing could have told you which others.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { topology } from 'topojson-server';
import { presimplify, simplify, quantile } from 'topojson-simplify';
import { quantize } from 'topojson-client';

import { ROOT, readRegistry, writeRegistry, layerId } from './lib/registry.js';
import { rewindGeometry } from './lib/rewind.js';
import { assertLayer, verifyLayer } from './lib/verify.js';
import { baselineAreas } from './lib/areas.js';

const OUT_DIR = path.join(ROOT, 'public', 'data', 'boundaries', 'gb');
const RAW_DIR = path.join(ROOT, 'data', 'raw', 'geoboundaries');
const API = (iso, level) => `https://www.geoboundaries.org/api/current/gbOpen/${iso}/${level}/`;

const TARGET_BYTES = 200 * 1024;
const POLITE_GAP_MS = 600;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kb = (n) => (n / 1024).toFixed(0) + ' KB';

/* ---------------------------------------------------------------- args */

function parseArgs(argv) {
  const opts = { targets: [], list: null, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') opts.list = String(argv[++i] || '').toUpperCase();
    else if (a === '--force') opts.force = true;
    else {
      const [iso, level = 'ADM1'] = a.toUpperCase().split(':');
      if (!/^[A-Z]{3}$/.test(iso)) throw new Error(`Not an ISO3 code: ${a}`);
      opts.targets.push({ iso, level });
    }
  }
  if (!opts.targets.length && !opts.list) {
    throw new Error('Name at least one country, e.g. BGD:ADM1');
  }
  return opts;
}

/* ---------------------------------------------------------------- fetch */

async function getJson(url) {
  const res = await fetch(url, { headers: { 'accept': 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

/** geoBoundaries answers a single request with either an object or a one-item array. */
const one = (j) => (Array.isArray(j) ? j[0] : j);

/** 'nan' is how the API spells "nothing here". */
const clean = (v) => {
  const s = String(v == null ? '' : v).trim();
  return !s || s.toLowerCase() === 'nan' ? null : s;
};

const year = (v) => {
  const n = parseInt(clean(v), 10);
  return Number.isFinite(n) && n > 1800 && n < 2200 ? n : null;
};

/* ---------------------------------------------------------------- shaping */

const RETAIN_STEPS = [1, 0.8, 0.6, 0.45, 0.35, 0.25, 0.18, 0.12, 0.08, 0.05];
const QUANT_STEPS = [1e5, 1e4, 5e3];

function bboxOf(topo) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const arc of topo.arcs) {
    for (const p of arc) {
      if (p[0] < x0) x0 = p[0];
      if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[1] > y1) y1 = p[1];
    }
  }
  return [x0, y0, x1, y1];
}

const stripWeights = (topo) => {
  topo.arcs = topo.arcs.map((arc) => arc.map((p) => [p[0], p[1]]));
  return topo;
};

const cloneTopo = (topo) => ({
  type: 'Topology',
  objects: JSON.parse(JSON.stringify(topo.objects)),
  arcs: topo.arcs.map((arc) => arc.map((p) => p.slice()))
});

/**
 * Same output shape the admin-1 loader already reads: one object named `units`,
 * each feature carrying `{ name, id }`. A second boundary source is a second
 * file, not a second loader.
 */
/**
 * Quantisation snaps coordinates to a grid laid over the layer's own bounding
 * box. For the US Minor Outlying Islands that box spans the Pacific, so the
 * grid is coarse enough to erase an island of 1.77e-8 steradians outright —
 * nothing to do with simplification. When the normal ladder cannot keep every
 * unit whole, the build backs off precision as well, and accepts a larger file
 * rather than a smaller lie.
 */
const FINE_QUANTA = [1e6, 1e7, 1e8];

function buildTopology(features, targetBytes) {
  const base = presimplify(topology({ units: { type: 'FeatureCollection', features } }));
  const areas = baselineAreas(features);

  // See the note in build-admin1.js: a unit simplified out of existence is
  // worse than a file over budget.
  let acceptable = null;
  let lost = null;

  for (const quantum of QUANT_STEPS) {
    for (const retain of RETAIN_STEPS) {
      const simplified = retain >= 1
        ? cloneTopo(base)
        : simplify(cloneTopo(base), quantile(base, retain));
      const topo = stripWeights(simplified);
      topo.bbox = bboxOf(topo);
      const json = JSON.stringify(quantize(topo, quantum));
      const candidate = { json, bytes: Buffer.byteLength(json), retain, quantum };

      const check = verifyLayer(JSON.parse(json), { units: features.length, areas });
      if (!check.ok) { lost = lost || check.problems[0]; continue; }

      acceptable = candidate;
      if (candidate.bytes <= targetBytes) return acceptable;
    }
  }

  if (acceptable) return acceptable;

  // Last resort: full detail at ever finer precision.
  for (const quantum of FINE_QUANTA) {
    const topo = stripWeights(cloneTopo(base));
    topo.bbox = bboxOf(topo);
    const json = JSON.stringify(quantize(topo, quantum));
    if (verifyLayer(JSON.parse(json), { units: features.length, areas }).ok) {
      return { json, bytes: Buffer.byteLength(json), retain: 1, quantum };
    }
  }

  throw new Error('no simplification keeps every unit whole' + (lost ? ' — ' + lost : ''));
}

function slim(props, i) {
  const name = clean(props.shapeName) || `Unit ${i + 1}`;
  const out = { name };
  // shapeID is geoBoundaries' own stable key, which is what assignments hang
  // off. Names move; "Rajshani" in this very dataset is a misspelling of
  // Rajshahi, and it may well be corrected in a later release.
  out.id = clean(props.shapeID) || clean(props.shapeISO) || `${name}-${i}`;
  const iso = clean(props.shapeISO);
  if (iso) out.code = iso;
  return out;
}

/* ---------------------------------------------------------------- main */

async function listLevels(iso) {
  const j = await getJson(API(iso, 'ALL'));
  const rows = Array.isArray(j) ? j : [j];
  console.log(`levels for ${iso}:`);
  for (const m of rows) {
    console.log(`  ${String(m.boundaryType).padEnd(6)} ${String(m.admUnitCount).padStart(5)} units` +
      `  ${clean(m.boundaryCanonical) || ''}  · ${year(m.boundaryYearRepresented) || 'year not stated'}`);
  }
}

async function build({ iso, level }, registry, force) {
  console.log(`\n${iso} ${level}`);
  const meta = one(await getJson(API(iso, level)));
  if (!meta || !meta.boundaryType) throw new Error(`geoBoundaries has no ${level} for ${iso}`);

  const units = parseInt(meta.admUnitCount, 10) || null;
  const vintage = year(meta.boundaryYearRepresented);
  const agency = clean(meta.boundarySource) || 'geoBoundaries';
  const licence = clean(meta.boundaryLicense) || 'see geoBoundaries';
  console.log(`  ${units} units · ${clean(meta.boundaryCanonical) || level} · ` +
    `represents ${vintage || 'an unstated year'}`);
  console.log(`  ${agency}`);
  console.log(`  ${licence}`);

  await fsp.mkdir(RAW_DIR, { recursive: true });
  const rawPath = path.join(RAW_DIR, `${iso}-${level}.geojson`);

  let geo;
  if (!force && fs.existsSync(rawPath)) {
    geo = JSON.parse(await fsp.readFile(rawPath, 'utf8'));
    console.log('  geometry (cached)');
  } else {
    // The simplified geometry is the one to take: the full one is far more
    // detail than a map this size can show, and it is their bandwidth.
    const url = clean(meta.simplifiedGeometryGeoJSON) || clean(meta.gjDownloadURL);
    if (!url) throw new Error('the metadata carries no geometry link');
    await sleep(POLITE_GAP_MS);
    geo = await getJson(url);
    await fsp.writeFile(rawPath, JSON.stringify(geo));
    console.log(`  geometry downloaded (${kb(Buffer.byteLength(JSON.stringify(geo)))})`);
  }

  const features = geo.features
    .filter((f) => f.geometry)
    // d3-geo wants clockwise exteriors; geoBoundaries ships the opposite,
    // and an unrewound ring paints the whole sphere one colour.
    .map((f, i) => ({ type: 'Feature', properties: slim(f.properties || {}, i), geometry: rewindGeometry(f.geometry) }));
  if (!features.length) throw new Error('the geometry file holds no features');

  const built = buildTopology(features, TARGET_BYTES);

  // Nothing reaches disk without passing. A layer whose rings are wound the
  // wrong way covers the sphere, and that is invisible in every other check.
  const check = assertLayer(`${iso} ${level}`, JSON.parse(built.json),
    { units, areas: baselineAreas(features) });
  console.log(`  geometry ok — ${check.total.toFixed(4)} sr across ${features.length} units`);

  await fsp.mkdir(OUT_DIR, { recursive: true });
  const file = `data/boundaries/gb/${iso}-${level}.topo.json`;
  await fsp.writeFile(path.join(ROOT, 'public', file), built.json);
  console.log(`  wrote ${file} (${kb(built.bytes)}, retain ${built.retain})`);

  return {
    entry: {
      id: 'gb',
      iso,
      level,
      label: clean(meta.boundaryCanonical) || level,
      units: features.length,
      // Two different numbers when they disagree: what the API claims, and what
      // the file actually contains.
      unitsClaimed: units,
      vintage,
      licence,
      attribution: `${clean(meta.boundaryName) || iso} ${level} boundaries: ${agency} via geoBoundaries (${licence})`,
      sourceAgency: agency,
      url: clean(meta.boundarySourceURL) || clean(meta.licenseSource) || 'https://www.geoboundaries.org/',
      boundaryId: clean(meta.boundaryID),
      file,
      bytes: built.bytes
    },
    country: clean(meta.boundaryName) || iso
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.list) return listLevels(opts.list);

  const registry = readRegistry();
  const entries = [];
  const countries = {};

  for (const target of opts.targets) {
    try {
      const { entry, country } = await build(target, registry, opts.force);
      entries.push(entry);
      countries[target.iso] = country;
    } catch (err) {
      // One country failing is not a reason to lose the others.
      console.error(`  failed: ${err.message}`);
    }
    await sleep(POLITE_GAP_MS);
  }

  if (!entries.length) {
    console.log('\nnothing built');
    process.exit(1);
  }

  const file = await writeRegistry(registry, entries, countries);
  console.log(`\nregistry  ${entries.map((e) => layerId(e.id, e.iso, e.level)).join(', ')}`);
  console.log(`          -> ${path.relative(ROOT, file)}`);
}

main().catch((err) => {
  console.error('\nbuild failed:', err.message);
  process.exit(1);
});
