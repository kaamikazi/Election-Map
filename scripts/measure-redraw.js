#!/usr/bin/env node
/**
 * How much ground moves under a seat name when a boundary set is redrawn.
 *
 *   node scripts/measure-redraw.js
 *
 * This exists because docs/vintage-stress.md makes a strong claim — that name
 * matching cannot see a redraw, and that the units which do match are often
 * describing different ground — and a strong claim in a document is worth what
 * anyone can check. Running this reproduces every number in it.
 *
 * It compares two vintages of the SAME agency's SAME generalisation, so the
 * difference measured is the redraw and not the vendor:
 *
 *   Dec 2022 BUC — no redistribution happened between 2010 and the 2023 review,
 *                  so these ARE the boundaries the 2019 election was fought on
 *   July 2024 BUC — the set in the registry, which the app would draw 2019
 *                  results onto
 *
 * Overlap is by point sampling rather than polygon clipping, using
 * d3.geoContains — the same containment test the partition probe uses. That is
 * deliberate: this should measure the app's own notion of "inside", not an
 * idealised one it does not share.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import * as d3 from 'd3-geo';

import { ROOT } from './lib/registry.js';
import { rewindGeometry } from './lib/rewind.js';

const RAW_DIR = path.join(ROOT, 'data', 'raw', 'constituencies');
const PAGE = 200;
const TARGET_INSIDE = 240;      // sample points per seat; ±3% on the overlap

const OLD = {
  file: 'GBR-CONSTITUENCY-2022.geojson',
  service: 'https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/' +
    'Westminster_Parliamentary_Constituencies_Dec_2022_UK_BUC/FeatureServer/0',
  idField: 'PCON22CD',
  nameField: 'PCON22NM',
  label: 'Dec 2022 (the 2019 election\'s boundaries)'
};
const NEW = {
  file: 'GBR-CONSTITUENCY.geojson',
  idField: 'PCON24CD',
  nameField: 'PCON24NM',
  label: 'July 2024 (the set in the registry)'
};

/* ---------------------------------------------------------------- fetch */

async function ensure(spec) {
  const file = path.join(RAW_DIR, spec.file);
  if (fs.existsSync(file)) return file;
  if (!spec.service) {
    throw new Error(`${spec.file} is not on disk and has no service to fetch it from. ` +
      'Run scripts/build-constituencies.js GBR first.');
  }

  await fsp.mkdir(RAW_DIR, { recursive: true });
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const url = `${spec.service}/query?where=1%3D1&outFields=${spec.idField},${spec.nameField}` +
      `&returnGeometry=true&outSR=4326&f=geojson&resultOffset=${offset}&resultRecordCount=${PAGE}`;
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    const page = await res.json();
    const feats = (page && page.features) || [];
    out.push(...feats);
    process.stdout.write(`\r  fetching ${spec.file}: ${out.length} units`);
    if (feats.length < PAGE) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  process.stdout.write('\n');
  await fsp.writeFile(file, JSON.stringify({ type: 'FeatureCollection', features: out }));
  return file;
}

const load = (file, spec) => JSON.parse(fs.readFileSync(file, 'utf8')).features
  .filter((f) => f.geometry)
  .map((f) => ({
    name: String(f.properties[spec.nameField] || '').trim(),
    code: String(f.properties[spec.idField] || '').trim(),
    geom: rewindGeometry(f.geometry)
  }));

/* ---------------------------------------------------------------- measure */

/** Points inside `geom`, from a grid refined until enough of them land. */
function samplesInside(geom) {
  const [[w, s], [e, n]] = d3.geoBounds({ type: 'Feature', geometry: geom });
  let pts = [];
  for (let steps = 24; steps <= 300 && pts.length < TARGET_INSIDE; steps *= 2) {
    pts = [];
    const dx = (e - w) / steps;
    const dy = (n - s) / steps;
    if (!(dx > 0) || !(dy > 0)) return [];
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < steps; j++) {
        const p = [w + (i + 0.5) * dx, s + (j + 0.5) * dy];
        if (d3.geoContains(geom, p)) pts.push(p);
      }
    }
  }
  return pts;
}

async function main() {
  const oldSet = load(await ensure(OLD), OLD);
  const newSet = load(await ensure(NEW), NEW);

  const newByName = new Map();
  for (const f of newSet) newByName.set(f.name.toLowerCase(), f);

  const shared = [];
  let vanished = 0;

  for (const o of oldSet) {
    const n = newByName.get(o.name.toLowerCase());
    if (!n) { vanished++; continue; }

    const pts = samplesInside(o.geom);
    if (!pts.length) continue;
    let inside = 0;
    for (const p of pts) if (d3.geoContains(n.geom, p)) inside++;

    shared.push({
      name: o.name,
      kept: inside / pts.length,
      sameCode: o.code === n.code,
      areaRatio: d3.geoArea({ type: 'Feature', geometry: n.geom }) /
                 d3.geoArea({ type: 'Feature', geometry: o.geom })
    });
    if (shared.length % 50 === 0) process.stdout.write(`\r  measured ${shared.length}`);
  }
  process.stdout.write('\n');

  const band = (lo, hi) => shared.filter((s) => s.kept >= lo && s.kept < hi).length;
  const under = (t) => shared.filter((s) => s.kept < t).length;
  const pct = (n) => `${(n * 100).toFixed(0)}%`.padStart(4);

  console.log(`\nold: ${OLD.label} — ${oldSet.length} seats`);
  console.log(`new: ${NEW.label} — ${newSet.length} seats`);
  console.log(`\nnames present in both (these are what name matching matches): ${shared.length}`);
  console.log(`names that vanished (these become honest unmatched rows):      ${vanished}`);

  console.log('\nshare of the OLD seat\'s ground still inside the NEW seat of that name:');
  const bands = [[0.99, 1.01, 'effectively unchanged'], [0.95, 0.99, ''], [0.90, 0.95, ''],
    [0.75, 0.90, ''], [0.50, 0.75, ''], [0.25, 0.50, ''], [-0.01, 0.25, 'different ground']];
  for (const [lo, hi, note] of bands) {
    const label = `${pct(Math.min(Math.max(hi, 0), 1))}..${pct(Math.max(lo, 0))}`;
    console.log(`  ${label}  ${String(band(lo, hi)).padStart(3)}  ${note}`);
  }

  const sorted = shared.map((s) => s.kept).sort((a, b) => a - b);
  console.log(`\nmedian name match kept ${(sorted[Math.floor(sorted.length / 2)] * 100).toFixed(1)}%`);
  console.log(`${under(0.99)} changed at all · ${under(0.90)} lost >10% · ${under(0.75)} lost >25%`);

  const codes = shared.filter((s) => s.sameCode);
  console.log(`\nname matches whose ONS code also survived: ${codes.length}` +
    ` (of which ${codes.filter((s) => s.kept >= 0.99).length} barely moved)`);
  console.log('  so the code is a version stamp, not an identity: a same-code test would');
  console.log(`  reject ${shared.length - codes.length} sound units and catch none of the unsound ones.`);

  console.log('\nworst 10 name matches — same name, least shared ground:');
  for (const w of shared.slice().sort((a, b) => a.kept - b.kept).slice(0, 10)) {
    console.log(`  ${pct(w.kept)}  area x${w.areaRatio.toFixed(2).padStart(5)}  ${w.name}`);
  }
}

main().catch((err) => {
  console.error('\nmeasurement failed:', err.message);
  process.exit(1);
});
