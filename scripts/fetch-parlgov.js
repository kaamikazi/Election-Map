#!/usr/bin/env node
/**
 * Vendor the ParlGov release into data/raw/parlgov/ (gitignored).
 *
 *   node scripts/fetch-parlgov.js [--force]
 *
 * ParlGov is a static academic release on Harvard Dataverse, not an API, so it
 * is downloaded once and committed to nobody's runtime path. build-parlgov.js
 * reads only what lands here.
 *
 * The file ids below belong to release 2024 (V1). If the DOI publishes a new
 * version the ids change; this script re-reads the dataset metadata each run
 * and resolves files by name, so a new release is picked up without editing.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.resolve(__dirname, '..', 'data', 'raw', 'parlgov');

const DOI = 'doi:10.7910/DVN/2VZ5ZC';
const DATASET = 'https://dataverse.harvard.edu/api/datasets/:persistentId/?persistentId=' + DOI;
const FILE = (id) => `https://dataverse.harvard.edu/api/access/datafile/${id}`;

const WANTED = [
  'view_election.tab',
  'view_party.tab',
  'view_cabinet.tab',
  'readme.txt',
  'codebook.md'
];

async function main() {
  const force = process.argv.includes('--force');
  await fsp.mkdir(RAW, { recursive: true });

  console.log('meta    ' + DOI);
  const res = await fetch(DATASET);
  if (!res.ok) throw new Error(`Dataverse metadata failed: ${res.status} ${res.statusText}`);
  const meta = await res.json();
  const version = meta.data.latestVersion;

  const license = version.license ? version.license.name : '(none stated)';
  console.log(`        release ${version.versionNumber}.${version.versionMinorNumber}, ${license}`);
  await fsp.writeFile(path.join(RAW, 'dataverse.json'), JSON.stringify(meta, null, 2));

  const byName = new Map(version.files.map((f) => [f.dataFile.filename, f.dataFile]));
  const missing = WANTED.filter((n) => !byName.has(n));
  if (missing.length) throw new Error('release no longer publishes: ' + missing.join(', '));

  for (const name of WANTED) {
    const dest = path.join(RAW, name);
    if (!force && fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      console.log(`cached  ${name}`);
      continue;
    }
    const file = byName.get(name);
    const dl = await fetch(FILE(file.id));
    if (!dl.ok) throw new Error(`${name}: ${dl.status} ${dl.statusText}`);
    const tmp = dest + '.part';
    await pipeline(Readable.fromWeb(dl.body), fs.createWriteStream(tmp));
    await fsp.rename(tmp, dest);
    console.log(`saved   ${name} (${(fs.statSync(dest).size / 1024).toFixed(0)} KB)`);
  }

  console.log('\nnext    node scripts/build-parlgov.js');
}

main().catch((err) => {
  console.error('\nfetch failed:', err.message);
  process.exit(1);
});
