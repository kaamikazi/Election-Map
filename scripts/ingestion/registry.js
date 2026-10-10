import path from 'node:path';
import { readJson, fingerprint } from './util.js';
import { ADAPTERS } from './adapters/index.js';
import { acquireResource } from './acquire.js';

export async function loadRegistry(root, file = path.join(root, 'data/source-registry.json')) {
  const registry = await readJson(file);
  if (registry.version !== 1 || !Array.isArray(registry.sources)) throw new Error('Unsupported source registry');
  const ids = new Set();
  const validDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
  for (const s of registry.sources) {
    if (!s.id || ids.has(s.id) || !s.provider || !s.url || !s.countries?.length || !s.electionLevels?.length ||
        !s.dateRange?.from || !s.dateRange?.to || !s.schema || !s.updateCadence || !s.licence?.name ||
        !s.reliabilityNotes?.length || !s.boundaryCompatibility || !ADAPTERS[s.parser] || !s.resources?.length) {
      throw new Error(`Incomplete/duplicate source registration: ${s.id}`);
    }
    if (new Set(s.resources.map((r) => r.key)).size !== s.resources.length || s.resources.some((r) => !/^https:\/\//.test(r.url))) throw new Error(`Source resources must have unique keys and HTTPS URLs: ${s.id}`);
    if (!validDate(s.dateRange.from) || !validDate(s.dateRange.to) || s.dateRange.from > s.dateRange.to ||
        s.countries.some((c) => !/^[A-Z]{3}$/.test(c))) throw new Error(`Invalid source date/country coverage: ${s.id}`);
    ids.add(s.id);
  }
  return { ...registry, sha256: fingerprint(registry) };
}

/** Discover only the resources declared by a registered provider/page. */
export async function discover(sources, options) {
  const found = [];
  for (const source of sources) {
    const entry = { sourceId: source.id, provider: source.provider, resources: source.resources, notes: [] };
    if (source.discovery?.kind === 'linked-csv' && !options.offline) {
      try {
        const page = await acquireResource(source, { key: 'discovery', url: source.discovery.page }, options);
        const links = [...page.bytes.toString('utf8').matchAll(/href\s*=\s*["']([^"']+)["']/gi)]
          .map((m) => { try { return new URL(m[1].replace(/&amp;/g, '&'), source.discovery.page); } catch { return null; } })
          .filter((u) => u && source.discovery.allowedHosts.includes(u.hostname) && u.pathname === source.discovery.pathname);
        if (!links.length) throw new Error('Registered candidate CSV is no longer linked by the provider page; review the registry');
        entry.pageEvidence = page.reference;
        entry.resources = source.resources.map((r) => ({ ...r, url: links[0].href }));
      } catch (e) { entry.notes.push(`Discovery page unavailable or changed: ${e.message}. Only the already registered endpoint is eligible for download.`); }
    }
    if (options.offline) entry.notes.push('Offline discovery: registered endpoints and cached captures only; no claim about current remote availability.');
    found.push(entry);
  }
  return found;
}
