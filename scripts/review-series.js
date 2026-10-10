#!/usr/bin/env node
/** Review an already rendered draft run. The receipt binds its plan and pixels. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { ROOT } from './lib/registry.js';
import { sha256, seriesPlanSha256, seriesSourceSha256 } from './lib/series-review.js';

const arg = process.argv.indexOf('--dir');
const dir = path.resolve(arg >= 0 ? process.argv[arg + 1] : 'build/series');
const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

async function main() {
  const man = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
  if (man.kind !== 'election-map-studio/series' || man.review?.status !== 'draft' ||
      !Array.isArray(man.items) || man.items.length !== man.frames) {
    throw new Error('Choose a complete draft series manifest; reviewed or incomplete runs cannot be approved here.');
  }
  if (man.implementationSha256 !== await seriesSourceSha256(ROOT)) {
    throw new Error('The app or archive changed since this draft was generated. Generate a new draft before review.');
  }
  const hashes = [];
  stdout.write(`Review ${man.range.from}–${man.range.to}, step ${man.range.step}, ${man.scope}, ${man.grouping}; ${man.frames} frames.\n`);
  stdout.write(`Canvas ${man.size.width}×${man.size.height}, handle ${man.handle || '(none)'}.\n`);
  for (const f of man.items) {
    if (!/^\d{4}\.png$/.test(f.file)) throw new Error(`Unsafe frame filename: ${f.file}`);
    const bytes = await fs.readFile(path.join(dir, f.file));
    if (!bytes.subarray(0, 8).equals(pngHeader)) throw new Error(`${f.file} is not a valid PNG file header.`);
    hashes.push({ file: f.file, sha256: sha256(bytes) });
    stdout.write(`${f.year} · ${f.source.label} · ${f.boundaries.layer} (${f.boundaries.vintage || 'vintage unstated'})` +
      ` · ${f.coverage.covered}/${f.coverage.universe ?? '?'} covered` +
      ` · gaps: ${f.recordGaps.map((g) => g.unit).join(', ') || 'none'}` +
      ` · caveats: ${f.caveats.map((c) => c.what).join('; ') || 'none'}` +
      ` · notes: ${f.coverageNotes.join('; ') || 'none'}\n`);
  }
  const planSha256 = seriesPlanSha256(man);
  const phrase = `REVIEW ${man.range.from}-${man.range.to}/${man.frames}`;
  stdout.write(`\nInspect every PNG in ${dir} at phone size.\n`);
  const terminal = createInterface({ input: stdin, output: stdout });
  let answer;
  try { answer = await terminal.question(`Type ${phrase} after checking the frames, sources, boundaries and caveats: `); }
  finally { terminal.close(); }
  if (answer.trim() !== phrase) throw new Error('Series review was not confirmed; draft files remain unchanged.');
  const receipt = {
    kind: 'election-map-studio/series-review', version: 1, reviewedAt: new Date().toISOString(),
    acknowledgement: phrase, planSha256, implementationSha256: man.implementationSha256, images: hashes
  };
  await fs.writeFile(path.join(dir, 'approval.json'), JSON.stringify(receipt, null, 2) + '\n');
  stdout.write(`Saved review receipt for ${hashes.length} exact draft frames.\n`);
}
main().catch((error) => { console.error(`Review failed: ${error.message}`); process.exitCode = 1; });
