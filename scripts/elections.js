#!/usr/bin/env node
/** Registry → immutable evidence → validation/review → atomic map database. */
import path from 'node:path';
import { ROOT } from './lib/registry.js';
import { IngestionEngine, readDatabase } from './ingestion/engine.js';
import { readJson } from './ingestion/util.js';

const args = process.argv.slice(2), action = args.shift();
const flag = (name) => args.includes('--' + name);
const value = (name, fallback) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : fallback; };

async function main() {
  if (flag('catalog') || ['latest', 'snapshot', 'backfill', 'bootstrap', 'evidence', 'bundle'].includes(action)) {
    const { runCatalog } = await import('./catalog/cli.js');
    await runCatalog(action, args, ROOT); return;
  }
  if (!['discover', 'download', 'validate', 'import', 'update', 'report'].includes(action)) throw new Error('Use discover, download, validate, import, update or report');
  const engine = await new IngestionEngine({ root: ROOT,
    cache: path.resolve(value('cache', path.join(ROOT, 'data/raw/elections'))),
    database: path.resolve(value('database', path.join(ROOT, 'public/data/ingestion'))),
    reports: path.resolve(value('reports', path.join(ROOT, 'build/ingestion'))),
    registryFile: value('registry', undefined) }).setup(value('source', 'all'));
  const decisions = value('decisions', null) ? await readJson(path.resolve(value('decisions'))) : null;
  const options = { offline: flag('offline'), refresh: flag('refresh') };
  if (action === 'discover') { console.log(JSON.stringify(await engine.discover(options), null, 2)); return; }
  if (action === 'download') { const b = await engine.download(options); console.log(`Captured ${b.sources.length} registered sources; batch ${b.batchId}`); return; }
  let batch = null;
  if (action === 'update') batch = await engine.download(options);
  const plan = await engine.validate({ decisions, batch });
  console.log(`Validated plan ${plan.planId}`);
  console.log(`Additions ${plan.changes.additions.length} · changes ${plan.changes.changes.length} · removals ${plan.changes.removals.length} · conflicts ${plan.changes.conflicts.length}`);
  let result = null;
  if (['import', 'update'].includes(action)) {
    try { result = await engine.commit(plan, { confirmReplace: value('confirm-replace', null) }); }
    catch (e) { await engine.report(plan, { committed: false, error: e.message }); throw e; }
  }
  if (action === 'report') { const current = await readDatabase(engine.database); result = { generation: current.pointer?.generation || null, committed: false, reason: 'read-only report' }; }
  const report = await engine.report(plan, result);
  console.log(JSON.stringify({ ...report, changes: { additions: plan.changes.additions.length, changes: plan.changes.changes.length,
    removals: plan.changes.removals.length, conflicts: plan.changes.conflicts.length } }, null, 2));
  console.log(`Evidence and review reports: ${engine.reports}`);
}
main().catch((e) => { console.error(`Election ingestion stopped: ${e.message}`); process.exitCode = 1; });
