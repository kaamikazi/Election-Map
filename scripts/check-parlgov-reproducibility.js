#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ROOT } from './lib/registry.js';
import { hash, json, fingerprint, atomic } from './ingestion/util.js';

async function files(dir, prefix = '') {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) out.push(...await files(path.join(dir, entry.name), name + '/'));
    else out.push(name);
  }
  return out.sort();
}
async function main() {
  const gov = JSON.parse(await fs.readFile(path.join(ROOT, 'public/data/governing.json'), 'utf8'));
  const base = path.join(ROOT, 'build', 'parlgov-reproducibility', randomUUID());
  const results = [];
  for (const name of ['a', 'b']) {
    const out = path.join(base, name);
    const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/build-parlgov.js'), '--out-dir', out, '--generated-at', gov.generated],
      { cwd: ROOT, encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
    results.push(out);
  }
  const names = await files(results[0]);
  if (JSON.stringify(names) !== JSON.stringify(await files(results[1]))) throw new Error('ParlGov rebuild file lists differ');
  const hashes = {};
  for (const name of names) {
    const a = await fs.readFile(path.join(results[0], name)), b = await fs.readFile(path.join(results[1], name));
    if (hash(a) !== hash(b)) throw new Error(`Nondeterministic ParlGov output: ${name}`);
    hashes[name] = hash(a);
    const previous = JSON.parse(await fs.readFile(path.join(ROOT, 'public/data', name), 'utf8'));
    const generated = JSON.parse(a);
    // Older builders sampled their clock separately for each output. Compare
    // every substantive field while reporting that operational timestamp.
    delete previous.generated; delete generated.generated;
    if (fingerprint(previous) !== fingerprint(generated)) throw new Error(`ParlGov substantive output changed: ${name}`);
  }
  const report = { version: 1, outputs: names.length, byteReproducible: true, existingSubstantiveDataMatches: true,
    generatedAtUsed: gov.generated, hashes };
  await atomic(path.join(ROOT, 'build/ingestion/parlgov-reproducibility.json'), json(report));
  console.log(`${names.length} ParlGov files are byte-reproducible and match existing substantive data.`);
}
main().catch((e) => { console.error(`ParlGov reproducibility failed: ${e.message}`); process.exitCode = 1; });
