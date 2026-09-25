#!/usr/bin/env node
/**
 * Constituency boundaries, as one more entry in the registry.
 *
 *   node scripts/build-constituencies.js GBR
 *
 * The claim at the end of milestone 7 was that a constituency layer is "a
 * source, not a subsystem". This script is the test of it: it fetches, rewinds,
 * simplifies, verifies and registers exactly the way build-geoboundaries.js
 * does, and writes the same `objects.units` shape the loader already reads.
 * Nothing in src/ was changed to make a 650-unit layer load, key, frame or
 * match — see docs/constituency-sources.md for what did have to change.
 *
 * One country per entry below, because constituency data has no global source:
 * availability, format, licence and vintage vary per country, and several
 * commissions publish only PDF maps.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { topology } from 'topojson-server';
import { presimplify, simplify, quantile } from 'topojson-simplify';
import { quantize } from 'topojson-client';

import { ROOT, readRegistry, writeRegistry, layerId } from './lib/registry.js';
import { rewindGeometry } from './lib/rewind.js';
import { assertLayer, verifyLayer } from './lib/verify.js';
import { baselineAreas } from './lib/areas.js';

const OUT_DIR = path.join(ROOT, 'public', 'data', 'boundaries', 'cons');
const RAW_DIR = path.join(ROOT, 'data', 'raw', 'constituencies');

const TARGET_BYTES = 420 * 1024;   // 650 units need more room than 8 do
const PAGE = 200;

/**
 * Each entry says where the geometry comes from and what is true about it.
 * Every field is sourced, not assumed: see docs/constituency-sources.md for how
 * each was checked and what could not be.
 */
export const SOURCES = {
  GBR: {
    country: 'United Kingdom',
    label: 'constituency',
    /*
     * BUC — ONS's own ultra-generalised (500m) build. Their generalisation is
     * better than ours: simplifying the 20m version here trips the area-ratio
     * floor on small island seats long before the file gets small enough, and a
     * source that already publishes the generalisation you want is the source to
     * take. 5.1 MB became 313 KB with nothing ground away.
     */
    service: 'https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/' +
      'Westminster_Parliamentary_Constituencies_July_2024_Boundaries_UK_BUC/FeatureServer/0',
    idField: 'PCON24CD',
    nameField: 'PCON24NM',
    vintage: 2024,
    expectUnits: 650,
    sourceAgency: 'Office for National Statistics, Open Geography Portal',
    // The service's own copyrightText is empty; this is the portal's stated
    // licence, recorded as a claim about the portal rather than about the file.
    licence: 'Open Government Licence v3.0 (stated on the ONS portal, not in the service metadata)',
    attribution: 'Westminster constituency boundaries (May 2024): Office for National Statistics, ' +
      'Open Government Licence v3.0. Contains OS data © Crown copyright and database right 2024.',
    url: 'https://geoportal.statistics.gov.uk/'
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kb = (n) => (n / 1024).toFixed(0) + ' KB';

/* ---------------------------------------------------------------- fetch */

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

/**
 * ArcGIS caps a query at its own page size whatever you ask for, so this walks
 * the layer with resultOffset until it stops handing back features.
 */
async function fetchAll(spec) {
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const url = `${spec.service}/query?where=1%3D1&outFields=${spec.idField},${spec.nameField}` +
      `&returnGeometry=true&outSR=4326&f=geojson&resultOffset=${offset}&resultRecordCount=${PAGE}`;
    const page = await getJson(url);
    const features = (page && page.features) || [];
    out.push(...features);
    process.stdout.write(`\r  fetched ${out.length} units`);
    if (features.length < PAGE) break;
    await sleep(300);
  }
  process.stdout.write('\n');
  return out;
}

/* ---------------------------------------------------------------- shaping */

const RETAIN_STEPS = [1, 0.85, 0.7, 0.55, 0.45, 0.35, 0.25, 0.18];
/*
 * Finer than the admin ladder, and deliberately so. Quantisation lays a grid
 * over the layer's own bounding box: across the UK, 1e5 is a 15-metre grid, and
 * a constituency ring with vertices closer than that collapses onto itself —
 * eleven of the 650 came out inside-out at 1e5 and five at 1e6. The ratio check
 * catches every one, and the ladder starts where they survive.
 */
const QUANT_STEPS = [1e7, 1e6];
const FINE_QUANTA = [1e8];

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
 * Identical in shape to the admin-1 build: keep every unit whole, give up
 * arc points before coordinate precision, and back off precision rather than
 * ship a unit that has been ground away.
 *
 * The area *ratio* check is what makes this work at this level. An absolute
 * ceiling calibrated for provinces is meaningless for a constituency of
 * 0.00001 sr; a ratio is scale-free and still catches a reversed ring, which
 * gains area by a factor of millions.
 */
function buildTopology(features, targetBytes) {
  const base = presimplify(topology({ units: { type: 'FeatureCollection', features } }));
  const areas = baselineAreas(features);
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

/**
 * Constituency names repeat across regions, so the key has to carry more than
 * the name. The ONS code does that on its own — `E14001234` is unique, and its
 * first letter is the country — which is why it is the id rather than the name.
 * Where a source has no such code, the parent has to be folded into the key
 * before that source can be added.
 */
function slim(props, spec, i) {
  const name = String(props[spec.nameField] || '').trim() || `Unit ${i + 1}`;
  const code = String(props[spec.idField] || '').trim();
  return { name, id: code || `${name}-${i}`, code: code || null };
}

/* ---------------------------------------------------------------- main */

async function build(iso) {
  const spec = SOURCES[iso];
  if (!spec) {
    throw new Error(`no constituency source recorded for ${iso}. ` +
      'See docs/constituency-sources.md — most countries do not have one.');
  }

  console.log(`\n${iso} CONSTITUENCY — ${spec.sourceAgency}`);
  await fsp.mkdir(RAW_DIR, { recursive: true });
  const rawPath = path.join(RAW_DIR, `${iso}-CONSTITUENCY.geojson`);

  let raw;
  if (fs.existsSync(rawPath)) {
    raw = JSON.parse(await fsp.readFile(rawPath, 'utf8'));
    console.log(`  geometry (cached, ${raw.features.length} units)`);
  } else {
    const features = await fetchAll(spec);
    raw = { type: 'FeatureCollection', features };
    await fsp.writeFile(rawPath, JSON.stringify(raw));
    console.log(`  geometry downloaded (${kb(Buffer.byteLength(JSON.stringify(raw)))})`);
  }

  const features = raw.features
    .filter((f) => f.geometry)
    .map((f, i) => ({
      type: 'Feature',
      properties: slim(f.properties || {}, spec, i),
      // Every source is rewound on the way in rather than trusted.
      geometry: rewindGeometry(f.geometry)
    }));

  if (spec.expectUnits && features.length !== spec.expectUnits) {
    throw new Error(`expected ${spec.expectUnits} units and the service returned ${features.length}`);
  }

  const built = buildTopology(features, TARGET_BYTES);
  const check = assertLayer(`${iso} CONSTITUENCY`, JSON.parse(built.json),
    { units: features.length, areas: baselineAreas(features) });
  console.log(`  geometry ok — ${check.total.toFixed(4)} sr across ${features.length} units`);

  await fsp.mkdir(OUT_DIR, { recursive: true });
  const file = `data/boundaries/cons/${iso}-CONSTITUENCY.topo.json`;
  await fsp.writeFile(path.join(ROOT, 'public', file), built.json);
  console.log(`  wrote ${file} (${kb(built.bytes)}, retain ${built.retain})`);

  return {
    entry: {
      id: 'cons',
      iso,
      level: 'CONSTITUENCY',
      label: spec.label,
      units: features.length,
      vintage: spec.vintage,
      licence: spec.licence,
      attribution: spec.attribution,
      sourceAgency: spec.sourceAgency,
      url: spec.url,
      file,
      bytes: built.bytes
    },
    country: spec.country
  };
}

const plural = (noun) => (/[^aeiou]y$/.test(noun) ? noun.slice(0, -1) + 'ies' : noun + 's');

async function main() {
  const isos = process.argv.slice(2).map((s) => s.toUpperCase());
  if (!isos.length) {
    console.log('countries with a recorded constituency source:');
    for (const [iso, s] of Object.entries(SOURCES)) {
      console.log(`  ${iso}  ${s.country} — ${s.expectUnits} ${plural(s.label)}, ${s.vintage}`);
    }
    console.log('\nsee docs/constituency-sources.md for the ones that do not have one');
    return;
  }

  const registry = readRegistry();
  const entries = [];
  const countries = {};
  for (const iso of isos) {
    const { entry, country } = await build(iso);
    entries.push(entry);
    countries[iso] = country;
  }

  await writeRegistry(registry, entries, countries);
  console.log(`\nregistry  ${entries.map((e) => layerId(e.id, e.iso, e.level)).join(', ')}`);
}

/*
 * SOURCES is read by verify-boundaries.js, which needs the id field to line the
 * built layer up against the raw download it came from. Importing this module
 * must therefore not start a build.
 */
const isEntryPoint = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntryPoint) {
  main().catch((err) => {
    console.error('\nbuild failed:', err.message);
    process.exit(1);
  });
}
