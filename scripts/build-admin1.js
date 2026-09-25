#!/usr/bin/env node
/**
 * Build per-country admin-1 TopoJSON from Natural Earth.
 *
 *   node scripts/build-admin1.js [--res 10m|50m] [--target 150] [--only BGD,GBR] [--force]
 *
 * 1. Downloads the Natural Earth admin-1 GeoJSON once into data/raw/ (gitignored).
 * 2. Splits it by the adm0_a3 property.
 * 3. Converts each country to TopoJSON, simplifying and quantising until the
 *    file fits under the size target (default 150 KB).
 * 4. Emits public/data/index.json describing every layer that was built.
 *
 * The index is layer-aware on purpose: a country may later gain a
 * `constituency` layer alongside `admin1`, and the app picks between them.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { topology } from 'topojson-server';
import { presimplify, simplify, quantile } from 'topojson-simplify';
import { quantize } from 'topojson-client';

import { readRegistry, writeRegistry, layerId } from './lib/registry.js';
import { assertLayer, verifyLayer } from './lib/verify.js';
import { baselineAreas } from './lib/areas.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RAW_DIR = path.join(ROOT, 'data', 'raw');
const OUT_DIR = path.join(ROOT, 'public', 'data', 'admin1');
const INDEX_FILE = path.join(ROOT, 'public', 'data', 'index.json');

const SOURCES = {
  '10m': {
    url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson',
    file: 'ne_10m_admin_1_states_provinces.geojson'
  },
  '50m': {
    url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces.geojson',
    file: 'ne_50m_admin_1_states_provinces.geojson'
  }
};

// ---------------------------------------------------------------- args

function parseArgs(argv) {
  const opts = { res: '10m', target: 150 * 1024, only: null, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--res') opts.res = argv[++i];
    else if (a === '--target') opts.target = Number(argv[++i]) * 1024;
    else if (a === '--only') opts.only = new Set(argv[++i].split(',').map((s) => s.trim().toUpperCase()));
    else if (a === '--force') opts.force = true;
    else throw new Error('Unknown argument: ' + a);
  }
  if (!SOURCES[opts.res]) throw new Error('--res must be one of ' + Object.keys(SOURCES).join(', '));
  return opts;
}

// ---------------------------------------------------------------- download

async function ensureSource(res, force) {
  const { url, file } = SOURCES[res];
  const dest = path.join(RAW_DIR, file);
  if (!force && fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    console.log('source  ' + file + ' (cached, ' + mb(fs.statSync(dest).size) + ')');
    return dest;
  }
  await fsp.mkdir(RAW_DIR, { recursive: true });
  console.log('source  downloading ' + url);
  const response = await fetch(url);
  if (!response.ok) throw new Error('Download failed: ' + response.status + ' ' + response.statusText);
  const tmp = dest + '.part';
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(tmp));
  await fsp.rename(tmp, dest);
  console.log('source  saved ' + file + ' (' + mb(fs.statSync(dest).size) + ')');
  return dest;
}

// ---------------------------------------------------------------- shaping

const PICK_NAME = ['name', 'name_en', 'gn_name', 'woe_name'];
const PICK_CODE = ['iso_3166_2', 'code_hasc', 'postal', 'fips'];

function first(props, keys) {
  for (const k of keys) {
    const v = props[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Keep only the properties the app needs — the raw file carries ~80 per unit.
 *
 * The id is Natural Earth's own `adm1_code`, not the name and not the ISO code.
 * Names get renamed, retransliterated and disputed between releases —
 * Chittagong became Chattogram in 2018 — and an assignment keyed by a name is
 * an assignment that silently detaches the next time the data is rebuilt. Names
 * belong in the alias table; they are not identity.
 */
function slimProperties(props, i) {
  const name = first(props, PICK_NAME) || 'Unit ' + (i + 1);
  const out = { name };
  const code = first(props, PICK_CODE);
  if (code) out.code = code;
  const type = first(props, ['type_en', 'type']);
  if (type) out.type = type;
  out.id = first(props, ['adm1_code'])
    || (props.ne_id != null ? 'ne' + props.ne_id : null)
    || code
    || name + '-' + i;
  return out;
}

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

/** Drop the z weights presimplify/simplify leave on each point. */
function stripWeights(topo) {
  topo.arcs = topo.arcs.map((arc) => arc.map((p) => [p[0], p[1]]));
  return topo;
}

const RETAIN_STEPS = [1, 0.8, 0.6, 0.45, 0.35, 0.25, 0.18, 0.12, 0.08, 0.05, 0.03, 0.02];
const QUANT_STEPS = [1e5, 1e4, 5e3, 2e3];

/**
 * Build the smallest TopoJSON that still looks right: keep as much detail as
 * the size budget allows, giving up arc points before giving up coordinate
 * precision, since dropped points are far less visible than a jagged grid.
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

function buildCountryTopology(features, targetBytes) {
  const base = presimplify(topology({ units: { type: 'FeatureCollection', features } }));
  const areas = baselineAreas(features);

  // The smallest candidate that is still *whole*. Simplifying until the file
  // fits can shrink a small island until its ring has no area left, and a unit
  // that draws nothing still appears in the picker and the match index — the
  // map then covers less than it claims, silently. A file over the size target
  // is the better trade.
  let acceptable = null;
  let lost = null;

  for (const quantum of QUANT_STEPS) {
    for (const retain of RETAIN_STEPS) {
      const simplified =
        retain >= 1 ? clone(base) : simplify(clone(base), quantile(base, retain));
      const topo = stripWeights(simplified);
      topo.bbox = bboxOf(topo);
      const json = JSON.stringify(quantize(topo, quantum));
      const bytes = Buffer.byteLength(json);
      const candidate = { json, bytes, retain, quantum };

      const check = verifyLayer(JSON.parse(json), { units: features.length, areas });
      if (!check.ok) { lost = lost || check.problems[0]; continue; }

      acceptable = candidate;
      if (bytes <= targetBytes) return acceptable;
    }
  }

  if (acceptable) return acceptable;

  // Last resort: full detail at ever finer precision.
  for (const quantum of FINE_QUANTA) {
    const topo = stripWeights(clone(base));
    topo.bbox = bboxOf(topo);
    const json = JSON.stringify(quantize(topo, quantum));
    if (verifyLayer(JSON.parse(json), { units: features.length, areas }).ok) {
      return { json, bytes: Buffer.byteLength(json), retain: 1, quantum };
    }
  }

  throw new Error('no simplification keeps every unit whole' + (lost ? ' — ' + lost : ''));
}

function clone(topo) {
  return {
    type: 'Topology',
    objects: JSON.parse(JSON.stringify(topo.objects)),
    arcs: topo.arcs.map((arc) => arc.map((p) => p.slice()))
  };
}

const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';
const kb = (n) => (n / 1024).toFixed(0) + ' KB';

// ---------------------------------------------------------------- main

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const srcPath = await ensureSource(opts.res, opts.force);

  console.log('parse   reading source geojson');
  const geo = JSON.parse(await fsp.readFile(srcPath, 'utf8'));

  const byCountry = new Map();
  for (const f of geo.features) {
    const p = f.properties || {};
    const iso3 = String(p.adm0_a3 || '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(iso3)) continue; // skip -99 and other placeholders
    if (opts.only && !opts.only.has(iso3)) continue;
    if (!f.geometry) continue;
    if (!byCountry.has(iso3)) byCountry.set(iso3, { name: p.admin || iso3, features: [] });
    byCountry.get(iso3).features.push(f);
  }

  await fsp.mkdir(OUT_DIR, { recursive: true });

  // Start from the existing index so other layers (constituency) survive a rebuild.
  const index = {
    version: 3,
    source: SOURCES[opts.res].url,
    // Natural Earth ships present-day boundaries. Every map drawn on them says
    // so in its footer, because a 1977 map on 2024 provinces is wrong in ways
    // that are invisible unless you already know the history.
    vintage: {
      label: 'Natural Earth admin-1, present-day boundaries',
      resolution: opts.res,
      source: SOURCES[opts.res].url
    },
    generated: null,
    countries: {}
  };
  if (fs.existsSync(INDEX_FILE)) {
    try {
      const prev = JSON.parse(await fsp.readFile(INDEX_FILE, 'utf8'));
      if (prev && prev.countries) index.countries = prev.countries;
    } catch { /* rebuild from scratch */ }
  }

  const isos = [...byCountry.keys()].sort();
  console.log('split   ' + isos.length + ' countries, ' + geo.features.length + ' units total\n');

  const registry = readRegistry();
  const entries = [];
  const registryCountries = {};

  let oversize = 0;
  for (const iso3 of isos) {
    const { name, features } = byCountry.get(iso3);
    const slim = features.map((f, i) => ({
      type: 'Feature',
      properties: slimProperties(f.properties || {}, i),
      geometry: f.geometry
    }));

    const built = buildCountryTopology(slim, opts.target);
    assertLayer(`${iso3} ADM1`, JSON.parse(built.json), { units: slim.length, areas: baselineAreas(slim) });
    await fsp.writeFile(path.join(OUT_DIR, iso3 + '.topo.json'), built.json);

    const entry = index.countries[iso3] || { name, layers: {} };
    entry.name = name;
    entry.layers = entry.layers || {};
    entry.layers.admin1 = {
      file: 'data/admin1/' + iso3 + '.topo.json',
      units: slim.length,
      bytes: built.bytes,
      resolution: opts.res,
      retain: built.retain,
      quantum: built.quantum
    };
    index.countries[iso3] = entry;

    registryCountries[iso3] = name;
    entries.push({
      id: 'ne',
      iso: iso3,
      level: 'ADM1',
      label: 'admin-1',
      units: slim.length,
      // Natural Earth states no year per country, so this is null rather than a
      // guess. The previous version of this app printed "present-day
      // boundaries" for every country and was wrong about Bangladesh, where
      // this set still has seven divisions and there have been eight since
      // 2015. A null here is the honest answer; a year would be a new lie.
      vintage: null,
      vintageNote: 'Natural Earth states no year per country, and the set is not uniformly current.',
      licence: 'Public domain',
      attribution: 'Admin-1 boundaries: Natural Earth (public domain)',
      sourceAgency: 'Natural Earth',
      url: SOURCES[opts.res].url,
      file: 'data/admin1/' + iso3 + '.topo.json',
      bytes: built.bytes,
      resolution: opts.res
    });

    const flag = built.bytes > opts.target ? '  OVER' : '';
    if (flag) oversize++;
    console.log(
      '  ' + iso3 + '  ' + String(slim.length).padStart(4) + ' units  ' +
      kb(built.bytes).padStart(7) + '  retain ' + built.retain + flag
    );
  }

  index.generated = new Date().toISOString();
  await fsp.writeFile(INDEX_FILE, JSON.stringify(index, null, 2));

  const total = Object.values(index.countries).reduce(
    (n, c) => n + (c.layers.admin1 ? c.layers.admin1.bytes : 0), 0
  );
  console.log('\nwrote   ' + isos.length + ' files, ' + mb(total) + ' total -> public/data/admin1/');
  console.log('index   public/data/index.json');

  await writeRegistry(registry, entries, registryCountries);
  console.log('registry public/data/boundaries.json  (' + entries.length + ' ne:*:ADM1 entries)');
  if (oversize) console.log('note    ' + oversize + ' file(s) still over ' + kb(opts.target));
}

main().catch((err) => {
  console.error('\nbuild failed:', err.message);
  process.exit(1);
});
