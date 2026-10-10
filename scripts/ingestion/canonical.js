import { fingerprint } from './util.js';

export const REVIEW_STATES = ['verified', 'imported-with-warning', 'needs-review', 'rejected'];
export const IDENTITY_FIELDS = ['country', 'date', 'office', 'round', 'tier', 'jurisdiction', 'sourceId', 'sourceElectionId'];
export const identityKey = (identity) => 'election-' + fingerprint(IDENTITY_FIELDS.map((key) => identity[key] ?? null)).slice(0, 24);
export const sameElection = (a, b) => IDENTITY_FIELDS.every((key) => (a[key] ?? null) === (b[key] ?? null));
export const contestKey = (identity) => fingerprint(IDENTITY_FIELDS.slice(0, 6).map((key) => identity[key] ?? null));
export const normalName = (v) => String(v || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');

/** Strict quoting and row width: truncated or drifted tables do not turn into blanks. */
export function table(bytes, delimiter, required = []) {
  const text = Buffer.from(bytes).toString('utf8').replace(/^\uFEFF/, '');
  const rows = []; let row = [], cell = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      // Dataverse's served TSV uses backslash escapes; CSV uses doubled quotes.
      if (delimiter === '\t' && ch === '\\' && ['"', '\\', 'n', 'r', 't'].includes(text[i + 1])) {
        cell += ({ '"': '"', '\\': '\\', n: '\n', r: '\r', t: '\t' })[text[++i]];
      }
      else if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else cell += ch;
    } else if (ch === '"' && !cell && !closed) quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ''; closed = false; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); if (row.some((v) => v !== '')) rows.push(row);
      row = []; cell = ''; closed = false;
    } else {
      if (closed && !/\s/.test(ch)) throw new Error('Unexpected text after a quoted field');
      if (!closed) cell += ch;
    }
  }
  if (quoted) throw new Error('Interrupted CSV/TSV: unterminated quoted field');
  row.push(cell); if (row.some((v) => v !== '')) rows.push(row);
  const headers = rows.shift()?.map((h) => h.trim());
  if (!headers?.length || new Set(headers).size !== headers.length) throw new Error('Missing or duplicate table headers');
  for (const name of required) if (!headers.includes(name)) throw new Error(`Schema drift: missing column "${name}"`);
  return rows.map((cells, i) => {
    if (cells.length !== headers.length) throw new Error(`Interrupted/schema-drifted table at record ${i + 2}: ${cells.length} fields, expected ${headers.length}`);
    return { values: Object.fromEntries(headers.map((h, j) => [h, cells[j].trim()])), row: i + 2 };
  });
}

export function number(value, field) {
  if (value == null || String(value).trim() === '' || /^(?:n\/a|null)$/i.test(String(value).trim())) return null;
  if (!/^-?\d+(?:\.\d+)?$/.test(String(value).trim())) throw new Error(`Invalid ${field}: ${value}`);
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Invalid ${field}`);
  return n;
}
export function boolean(value, field) {
  if (value == null || value === '') return null;
  if (['true', '1'].includes(String(value).toLowerCase())) return true;
  if (['false', '0'].includes(String(value).toLowerCase())) return false;
  throw new Error(`Invalid boolean ${field}: ${value}`);
}

export function citation(source, resource, row, columns = []) {
  return { sourceId: source.id, provider: source.provider, url: resource.receipt.url,
    sourcePage: source.url, licence: source.licence, retrievedAt: resource.receipt.retrievedAt,
    sha256: resource.receipt.sha256, receiptId: resource.reference.receiptId,
    locator: { resource: resource.key, record: row, columns } };
}

export function party(rawName, rawId, source, aliases) {
  if (!rawName) return { name: null, id: rawId || null, alias: null };
  const alias = aliases.find((a) => a.source === source.id && a.names.some((n) => normalName(n) === normalName(rawName)));
  if (alias && rawId && alias.canonicalId !== rawId) return { name: rawName, id: rawId, aliasConflict: alias.canonicalId };
  return { name: alias?.canonicalName || rawName, id: rawId || alias?.canonicalId || null,
    alias: alias ? { from: rawName, evidence: alias.evidence } : null };
}

export function record(fields) {
  const electionIdentity = fields.electionIdentity;
  const id = fingerprint([identityKey(electionIdentity), fields.regionKey, fields.entityKey]).slice(0, 32);
  const out = { version: 1, ...fields, id, electionKey: identityKey(electionIdentity) };
  out.missingFields = ['votes', 'voteShare', 'seats', 'turnout', 'winner', 'sourceUpdateTime', 'boundaryVintage']
    .filter((k) => out[k] === null || out[k] === undefined);
  if (electionIdentity.round === null) out.missingFields.push('round');
  // Source-provided review/ready flags never enter the canonical model.
  out.confidence = { basis: 'source-reported', factVerification: 'not independently verified' };
  return out;
}
