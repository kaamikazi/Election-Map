import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { loadRegistry, discover } from './registry.js';
import { acquireResource, replayReference } from './acquire.js';
import { parseSource, ADAPTERS } from './adapters/index.js';
import { geography, validateRecords, recordHash } from './validate.js';
import { json, hash, fingerprint, readJson, immutable, atomic, inside } from './util.js';

const require = createRequire(import.meta.url);
const isoCountries = require('i18n-iso-countries');

export async function readDatabase(database) {
  const pointer = await readJson(path.join(database, 'current.json'), null);
  if (!pointer) return { pointer: null, records: [], manifest: null };
  if (!/^[a-f0-9]{64}$/.test(pointer.generation)) throw new Error('Invalid database generation pointer');
  const folder = path.join(database, 'generations', pointer.generation);
  const manifest = await readJson(path.join(folder, 'manifest.json'));
  const { generation, ...payload } = manifest;
  if (generation !== pointer.generation || fingerprint(payload) !== generation) throw new Error('Database manifest integrity failure');
  for (const [file, digest] of Object.entries(manifest.files)) {
    if (hash(await fs.readFile(inside(folder, file))) !== digest) throw new Error(`Database file integrity failure: ${file}`);
  }
  return { pointer, manifest, records: await readJson(path.join(folder, 'records.json')) };
}

export class IngestionEngine {
  constructor({ root, cache = path.join(root, 'data/raw/elections'), database = path.join(root, 'public/data/ingestion'),
    reports = path.join(root, 'build/ingestion'), registryFile, ...options }) {
    Object.assign(this, { root, cache, database, reports, registryFile, options });
  }
  async setup(selection) {
    this.registry = await loadRegistry(this.root, this.registryFile);
    this.sources = !selection || selection === 'all' ? this.registry.sources
      : this.registry.sources.filter((s) => selection.split(',').includes(s.id));
    if (!this.sources.length || (selection && selection !== 'all' && this.sources.length !== new Set(selection.split(',')).size)) throw new Error('Unknown source ID; use elections:discover');
    return this;
  }
  async discover(options = {}) {
    const data = await discover(this.sources, { root: this.root, cache: this.cache, ...this.options, ...options });
    await atomic(path.join(this.reports, 'discovery.json'), json({ registrySha256: this.registry.sha256, sources: data }));
    return data;
  }
  async download(options = {}) {
    const discovered = await this.discover(options);
    const entries = [], failures = [];
    for (const entry of discovered) {
      const source = this.sources.find((s) => s.id === entry.sourceId), refs = [], captures = [];
      try {
        for (const resource of entry.resources) {
          const data = await acquireResource(source, resource, { root: this.root, cache: this.cache,
            preferLocal: source.id === 'parlgov-2024' && !options.refresh, ...this.options, ...options });
          refs.push(data.reference); if (data.captureId) captures.push(data.captureId);
        }
        entries.push({ sourceId: source.id, references: refs, captures, discoveryNotes: entry.notes });
      } catch (e) { failures.push({ sourceId: source.id, error: e.message }); }
    }
    const batch = { version: 1, registrySha256: this.registry.sha256, sources: entries, failures };
    const batchId = fingerprint(batch);
    await immutable(path.join(this.cache, 'batches', `${batchId}.json`), json(batch));
    await atomic(path.join(this.cache, 'last-download.json'), json({ batchId }));
    await atomic(path.join(this.reports, 'download.json'), json({ batchId, ...batch }));
    if (failures.length) { const e = new Error(`Download failed for ${failures.map((f) => f.sourceId).join(', ')}; the working database is intact`); e.failures = failures; throw e; }
    return { batchId, ...batch };
  }
  async cachedBatch() {
    const sources = [];
    for (const source of this.sources) {
      const references = [];
      for (const resource of source.resources) {
        let ref = await readJson(path.join(this.cache, 'latest', source.id, `${resource.key}.json`), null);
        if (!ref) ref = (await acquireResource(source, resource, { root: this.root, cache: this.cache, ...this.options, offline: true })).reference;
        references.push(ref);
      }
      sources.push({ sourceId: source.id, references });
    }
    return { version: 1, registrySha256: this.registry.sha256, sources, failures: [] };
  }
  async validate({ decisions = null, batch = null } = {}) {
    batch ||= await this.cachedBatch();
    if (batch.failures.length || batch.registrySha256 !== this.registry.sha256) throw new Error('Acquisition failed or source registry changed; download/review the registered sources again');
    const previous = await readDatabase(this.database);
    const aliases = (await readJson(path.join(this.root, 'data/party-aliases.json'))).aliases;
    const worldIndex = await readJson(path.join(this.root, 'public/data/elections/index.json'));
    const worldNames = Object.fromEntries(Object.entries(worldIndex.countries).map(([iso, c]) => [iso, c.map_name]));
    const parsed = [], snapshots = [], loaded = new Map();
    for (const source of this.sources) {
      const entry = batch.sources.find((s) => s.sourceId === source.id);
      if (!entry || entry.references.length !== source.resources.length) throw new Error(`Incomplete source snapshot for ${source.id}`);
      const resources = [];
      for (const resource of source.resources) {
        const ref = entry.references.find((r) => r.key === resource.key);
        if (!ref) throw new Error(`Missing ${source.id}/${resource.key}`);
        const replay = await replayReference(this.cache, ref);
        if (replay.receipt.url !== resource.url || (resource.expectedMd5 && hash(replay.bytes, 'md5') !== resource.expectedMd5) ||
            (resource.expectedSha256 && hash(replay.bytes) !== resource.expectedSha256)) throw new Error('Cached evidence does not match the registered resource/release');
        resources.push(replay);
      }
      const result = parseSource({ source, resources, aliases, worldNames });
      if (!result.complete) throw new Error(`${source.id} is an incomplete source snapshot; removals and database updates are not safe`);
      parsed.push(...result.records); loaded.set(source.id, resources);
      snapshots.push({ sourceId: source.id, parser: result.parser, parserVersion: result.parserVersion,
        resources: entry.references, records: result.records.length, complete: result.complete });
    }
    const selected = new Set(this.sources.map((s) => s.id));
    const retained = previous.records.filter((r) => !selected.has(r.citation.sourceId));
    const checked = await validateRecords([...retained, ...parsed], { sources: this.registry.sources,
      geo: await geography(this.root), decisions });
    const before = new Map(previous.records.map((r) => [r.id, r]));
    for (const r of checked.records) {
      const old = before.get(r.id);
      if (old?.review.decision && old.recordHash === r.recordHash &&
          fingerprint(old.review.reasons.map((x) => x.code).sort()) === fingerprint(r.review.reasons.map((x) => x.code).sort()) &&
          !decisions?.decisions.some((d) => d.id === r.id)) r.review = old.review;
    }
    const changes = { additions: [], changes: [], removals: [], conflicts: checked.conflicts, duplicates: checked.duplicates };
    const after = new Map(checked.records.map((r) => [r.id, r]));
    for (const r of checked.records) {
      const old = before.get(r.id);
      if (!old) changes.additions.push({ id: r.id, electionKey: r.electionKey });
      else if (old.recordHash !== r.recordHash || fingerprint(old.review) !== fingerprint(r.review)) {
        changes.changes.push({ id: r.id, electionKey: r.electionKey, before: old.recordHash, after: r.recordHash,
          previouslyVerified: old.review.state === 'verified', fields: Object.keys({ ...old, ...r }).sort()
            .filter((k) => !['id', 'recordHash'].includes(k) && fingerprint(old[k] ?? null) !== fingerprint(r[k] ?? null)) });
      }
    }
    for (const old of previous.records) if (!after.has(old.id)) changes.removals.push({ id: old.id, electionKey: old.electionKey, previouslyVerified: old.review.state === 'verified', reason: 'absent from a complete registered-source snapshot' });
    const payload = { version: 1, registrySha256: this.registry.sha256, aliasesSha256: fingerprint(aliases),
      governingInputs: { coverageSha256: hash(await fs.readFile(path.join(this.root, 'data/parlgov-coverage.json'))),
        builderSha256: hash(await fs.readFile(path.join(this.root, 'scripts/build-parlgov.js'))) },
      previousGeneration: previous.pointer?.generation || null, selectedSources: [...selected].sort(), snapshots,
      records: checked.records, changes };
    const plan = { ...payload, planId: fingerprint(payload) };
    await immutable(path.join(this.cache, 'plans', `${plan.planId}.json`), json(plan));
    await atomic(path.join(this.reports, 'validation.json'), json(plan));
    this.loaded = loaded;
    this.validatedPlanId = plan.planId;
    return plan;
  }
  async buildGoverning(plan) {
    if (!plan.selectedSources.includes('parlgov-2024')) return null;
    if (plan.records.some((r) => r.citation.sourceId === 'parlgov-2024' && r.review.state === 'rejected')) return null;
    const dir = path.join(this.cache, 'builds', plan.planId);
    const raw = path.join(dir, 'raw'), out = path.join(dir, 'generated');
    const keys = { elections: 'view_election.tab', parties: 'view_party.tab', cabinets: 'view_cabinet.tab' };
    for (const resource of this.loaded.get('parlgov-2024')) await immutable(path.join(raw, keys[resource.key]), resource.bytes);
    const existing = await readJson(path.join(this.root, 'public/data/governing.json'));
    const built = spawnSync(process.execPath, [path.join(this.root, 'scripts/build-parlgov.js'),
      '--raw-dir', raw, '--out-dir', out, '--generated-at', existing.generated], { cwd: this.root, encoding: 'utf8', windowsHide: true });
    if (built.status !== 0) throw new Error(`Validated ParlGov rebuild failed: ${built.stderr || built.stdout}`);
    return fs.readFile(path.join(out, 'governing.json'));
  }
  async commit(plan, { confirmReplace = null, failAfter = null } = {}) {
    const { planId, ...payloadToVerify } = plan;
    if (this.validatedPlanId !== planId || fingerprint(payloadToVerify) !== planId) {
      throw new Error('The import plan was not validated in this engine or changed after validation; validate again');
    }
    for (const snapshot of plan.snapshots) for (const ref of snapshot.resources) await replayReference(this.cache, ref);
    if ((await loadRegistry(this.root, this.registryFile)).sha256 !== plan.registrySha256 ||
        fingerprint((await readJson(path.join(this.root, 'data/party-aliases.json'))).aliases) !== plan.aliasesSha256 ||
        hash(await fs.readFile(path.join(this.root, 'data/parlgov-coverage.json'))) !== plan.governingInputs.coverageSha256 ||
        hash(await fs.readFile(path.join(this.root, 'scripts/build-parlgov.js'))) !== plan.governingInputs.builderSha256) {
      throw new Error('Registry, aliases or governing build evidence changed after validation; validate again');
    }
    const currentGeo = await geography(this.root);
    for (const r of plan.records) {
      const layer = await currentGeo.get(r.layer);
      if (r.geometryValidation && (!layer || layer.hash !== r.geometryValidation.sha256 || layer.vintage !== r.geometryValidation.vintage)) {
        throw new Error('Boundary evidence changed after validation; validate again');
      }
    }
    const protectedChanges = [...plan.changes.changes, ...plan.changes.removals].filter((r) => r.previouslyVerified);
    if (protectedChanges.length && confirmReplace !== plan.planId) {
      const e = new Error(`${protectedChanges.length} verified records would be changed/removed. Inspect validation.json and explicitly pass --confirm-replace ${plan.planId}`);
      e.code = 'REVIEW_CONFIRMATION_REQUIRED'; throw e;
    }
    const lock = path.join(this.database, '.import.lock');
    await fs.mkdir(path.dirname(lock), { recursive: true });
    let handle;
    try { handle = await fs.open(lock, 'wx'); }
    catch (e) { if (e.code === 'EEXIST') throw new Error('Another import owns the lock. Review the lock before recovering an interrupted importer.'); throw e; }
    try {
      await handle.writeFile(json({ pid: process.pid, planId: plan.planId, sources: plan.selectedSources, acquiredAt: new Date().toISOString() }));
      const before = await readDatabase(this.database);
      if ((before.pointer?.generation || null) !== plan.previousGeneration) throw new Error('Database changed since validation; validate again before import');
      const governing = await this.buildGoverning(plan);
      const files = { 'records.json': json(plan.records),
        'review-queue.json': json(plan.records.filter((r) => r.review.state !== 'verified').map((r) => ({ id: r.id, electionKey: r.electionKey, recordHash: r.recordHash, ...r.review }))) };
      const groups = new Map();
      for (const r of plan.records) { if (!groups.has(r.electionKey)) groups.set(r.electionKey, []); groups.get(r.electionKey).push(r); }
      const elections = [];
      for (const [key, records] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
        const winners = records.filter((r) => r.winner === true && ['verified', 'imported-with-warning'].includes(r.review.state));
        const first = records[0], file = `maps/${key}.json`;
        const notes = [...new Set(records.flatMap((r) => r.review.reasons.filter((x) => x.severity !== 'warning').map((x) => x.text)))];
        files[file] = json({ version: 1, electionKey: key, identity: first.electionIdentity, layer: first.layer,
          source: this.registry.sources.find((s) => s.id === first.citation.sourceId),
          records: winners, totalRecords: records.length, quarantined: records.filter((r) => ['needs-review', 'rejected'].includes(r.review.state)).length, notes });
        const mapData = JSON.parse(files[file]);
        mapData.quarantinedRecords = records.filter((r) => ['needs-review', 'rejected'].includes(r.review.state));
        files[file] = json(mapData);
        elections.push({ key, identity: first.electionIdentity, layer: first.layer, winners: winners.length,
          records: records.length, file, sha256: hash(files[file]) });
      }
      files['index.json'] = json({ version: 1, elections });
      if (governing) files['governing.json'] = governing;
      const oldSources = before.manifest?.snapshots || [];
      const snapshots = [...oldSources.filter((s) => !plan.selectedSources.includes(s.sourceId)), ...plan.snapshots].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
      const evidence = {};
      for (const snapshot of snapshots) for (const ref of snapshot.resources) {
        const captured = await replayReference(this.cache, ref);
        const format = this.registry.sources.find((s) => s.id === snapshot.sourceId)?.schema.format;
        const file = `evidence/${ref.sha256}.${['csv', 'tsv', 'json'].includes(format) ? 'txt' : 'bin'}`;
        files[file] = captured.bytes;
        files[`receipts/${ref.receiptId}.json`] = json(captured.receipt);
        evidence[ref.sha256] = file;
      }
      const payload = { version: 1, registrySha256: plan.registrySha256, aliasesSha256: plan.aliasesSha256,
        governingInputs: governing ? plan.governingInputs : before.manifest?.governingInputs || null,
        evidence,
        snapshots, files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, hash(bytes)])),
        governing: governing ? 'validated-rebuild' : 'unchanged; no validated ParlGov rebuild in this transaction' };
      const generation = fingerprint(payload), folder = path.join(this.database, 'generations', generation);
      let count = 0;
      for (const [file, bytes] of Object.entries(files)) {
        await immutable(inside(folder, file), bytes);
        if (failAfter && ++count === failAfter) throw new Error('Simulated interrupted import before pointer commit');
      }
      await immutable(path.join(folder, 'manifest.json'), json({ ...payload, generation }));
      const prefix = `data/ingestion/generations/${generation}`;
      const pointer = { version: 1, generation, manifest: `${prefix}/manifest.json`, index: `${prefix}/index.json`,
        manifestSha256: hash(json({ ...payload, generation })),
        governing: governing ? `${prefix}/governing.json` : before.pointer?.governing || null,
        governingSha256: governing ? hash(governing) : before.pointer?.governingSha256 || null };
      await atomic(path.join(this.database, 'current.json'), json(pointer));
      return { generation, changed: generation !== before.pointer?.generation, protectedChanges: protectedChanges.length,
        governing: payload.governing };
    } finally { await handle.close(); await fs.unlink(lock); }
  }
  async report(plan, result = null) {
    const counts = Object.fromEntries(['verified', 'imported-with-warning', 'needs-review', 'rejected'].map((state) => [state, plan.records.filter((r) => r.review.state === state).length]));
    const coverage = this.registry.sources.map((source) => {
      const rows = plan.records.filter((r) => r.citation.sourceId === source.id);
      return { sourceId: source.id, provider: source.provider, registeredCountries: source.countries,
        countriesWithRecords: [...new Set(rows.map((r) => r.country))].sort(), levels: source.electionLevels,
        dateRange: rows.length ? { from: rows.map((r) => r.electionDate).sort()[0], to: rows.map((r) => r.electionDate).sort().at(-1) } : null,
        records: rows.length, mapEligibleWinners: rows.filter((r) => r.winner === true && ['verified', 'imported-with-warning'].includes(r.review.state)).length,
        licence: source.licence, reliabilityNotes: source.reliabilityNotes };
    });
    const covered = new Set(plan.records.map((r) => r.country));
    const missing = Object.entries(isoCountries.getAlpha3Codes()).filter(([iso, a2]) => a2 !== 'XK' && !covered.has(iso)).map(([iso]) => iso).sort();
    const unresolved = plan.records.filter((r) => ['needs-review', 'rejected'].includes(r.review.state)).map((r) => ({ id: r.id, recordHash: r.recordHash, electionKey: r.electionKey, state: r.review.state, reasons: r.review.reasons, citation: r.citation }));
    const update = { version: 1, planId: plan.planId, previousGeneration: plan.previousGeneration,
      result, sources: plan.snapshots, counts, changes: plan.changes };
    for (const [name, value] of Object.entries({ 'source-coverage': coverage, 'missing-countries': { universe: 'ISO 3166 alpha-3; territories included', missing, note: 'No data is invented for missing countries. Coverage is not a claim of current/live results.' }, 'unresolved-review': unresolved, 'update-manifest': update })) {
      await atomic(path.join(this.reports, `${name}.json`), json(value));
    }
    await atomic(path.join(this.reports, 'report.md'), [
      '# Election ingestion coverage and update report', '', `Plan: ${plan.planId}`, `Database: ${result?.generation || 'not committed by this run'}`, '',
      ...Object.entries(counts).map(([state, n]) => `- ${state}: ${n}`),
      `- Additions: ${plan.changes.additions.length}; changes: ${plan.changes.changes.length}; removals: ${plan.changes.removals.length}; conflicts: ${plan.changes.conflicts.length}`,
      '', '## Source coverage', ...coverage.map((s) => `- ${s.provider}: ${s.records} records; ${s.countriesWithRecords.length} countries; ${s.mapEligibleWinners} eligible reported winners.`),
      '', '## Missing countries', `${missing.length} ISO countries/territories have no normalized records.`, missing.join(', '),
      '', '## Unresolved review', `${unresolved.length} records need review or are rejected. See unresolved-review.json for every reason and raw-evidence locator.`,
      ...unresolved.slice(0, 12).map((r) => `- ${r.id}: ${r.reasons.map((x) => x.code).join(', ')} · ${r.citation.url}`),
      '', 'Machine checks do not verify election facts or approve publication.', ''
    ].join('\n'));
    return { counts, missingCountries: missing.length, unresolved: unresolved.length, changes: plan.changes, result };
  }
}
