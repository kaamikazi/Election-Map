#!/usr/bin/env node
/**
 * Check every layer in the registry, not just the ones being built today.
 *
 *   node scripts/verify-boundaries.js
 *
 * The blob shipped because nothing re-examined what was already on disk. This
 * runs over all of it and exits non-zero if any layer fails, so it can sit in
 * front of a release the same way the build does.
 */

import fs from 'node:fs';
import path from 'node:path';

import * as d3 from 'd3-geo';

import { ROOT, readRegistry } from './lib/registry.js';
import { verifyLayer, MAX_UNIT_AREA, MAX_LAYER_AREA, MIN_AREA_RATIO } from './lib/verify.js';
import { rewindGeometry } from './lib/rewind.js';
import { SOURCES as CONS_SOURCES } from './build-constituencies.js';

const round = (n) => Math.round(n * 10000) / 10000;

/**
 * Source areas for a layer, read back from the vendored raw file.
 *
 * Without these the sweep can only see a unit that was removed or inverted. A
 * unit ground down to a triangle keeps its area, its count and its name, and
 * the only way to notice is to compare it with what it used to be.
 */
const neAreas = { loaded: false, byId: null };

function baselineFor(entry) {
  if (entry.id === 'ne') {
    if (!neAreas.loaded) {
      neAreas.loaded = true;
      const file = path.join(ROOT, 'data', 'raw',
        `ne_${entry.resolution || '10m'}_admin_1_states_provinces.geojson`);
      if (fs.existsSync(file)) {
        neAreas.byId = {};
        for (const f of JSON.parse(fs.readFileSync(file, 'utf8')).features) {
          const id = f.properties && f.properties.adm1_code;
          if (id && f.geometry) neAreas.byId[id] = d3.geoArea(f);
        }
      }
    }
    return neAreas.byId;
  }

  if (entry.id === 'gb') {
    const file = path.join(ROOT, 'data', 'raw', 'geoboundaries', `${entry.iso}-${entry.level}.geojson`);
    if (!fs.existsSync(file)) return null;
    const out = {};
    for (const f of JSON.parse(fs.readFileSync(file, 'utf8')).features) {
      const id = f.properties && f.properties.shapeID;
      // The raw file is wound the other way; measure what the build measured.
      if (id && f.geometry) out[id] = d3.geoArea({ ...f, geometry: rewindGeometry(f.geometry) });
    }
    return out;
  }

  /*
   * Constituencies need this more than anything else in the registry does. The
   * absolute ceiling is calibrated for provinces and says nothing useful about
   * a unit of 0.00001 sr, so without a baseline the sweep is checking almost
   * nothing here — and this is the level where quantisation inverted eleven
   * rings during the build. The id field comes from the build's own source
   * table rather than being guessed, because it differs by country.
   */
  if (entry.id === 'cons') {
    const spec = CONS_SOURCES[entry.iso];
    if (!spec) return null;
    const file = path.join(ROOT, 'data', 'raw', 'constituencies', `${entry.iso}-${entry.level}.geojson`);
    if (!fs.existsSync(file)) return null;
    const out = {};
    for (const f of JSON.parse(fs.readFileSync(file, 'utf8')).features) {
      const id = f.properties && String(f.properties[spec.idField] || '').trim();
      if (id && f.geometry) out[id] = d3.geoArea({ ...f, geometry: rewindGeometry(f.geometry) });
    }
    return out;
  }

  return null;
}

function main() {
  const registry = readRegistry();
  const ids = Object.keys(registry.sources).sort();
  if (!ids.length) {
    console.log('no layers in the registry');
    return;
  }

  console.log(`checking ${ids.length} layers`);
  console.log(`  a layer may not exceed ${round(MAX_LAYER_AREA)} sr`);
  console.log(`  a unit must keep ${Math.round(MIN_AREA_RATIO * 100)}% of its source area, or stay ` +
    `under ${MAX_UNIT_AREA} sr where no source is on hand\n`);

  const failed = [];
  let missing = 0;
  let unbaselined = 0;
  let worst = { id: null, area: 0, name: null };

  for (const id of ids) {
    const entry = registry.sources[id];
    const file = path.join(ROOT, 'public', entry.file);
    if (!fs.existsSync(file)) {
      console.log(`  MISSING ${id} — ${entry.file}`);
      missing++;
      continue;
    }

    const topo = JSON.parse(fs.readFileSync(file, 'utf8'));
    const areas = baselineFor(entry);
    if (!areas) unbaselined++;
    const result = verifyLayer(topo, { units: entry.units, areas });
    if (result.largest && result.largest.area > worst.area) {
      worst = { id, area: result.largest.area, name: result.largest.name };
    }
    if (!result.ok) {
      failed.push(id);
      console.log(`  FAIL ${id}`);
      for (const p of result.problems) console.log(`       ${p}`);
    }
  }

  console.log(`\nlargest unit anywhere: ${round(worst.area)} sr — ${worst.name} (${worst.id})`);
  if (missing) console.log(`${missing} layer(s) in the registry have no file`);
  if (unbaselined) {
    console.log(`${unbaselined} layer(s) had no vendored source, so only the absolute checks ran`);
  }

  if (failed.length) {
    console.log(`\n${failed.length} layer(s) failed: ${failed.join(', ')}`);
    process.exit(1);
  }
  console.log(`${ids.length - missing} layers pass`);
}

main();
