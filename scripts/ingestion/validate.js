import fs from 'node:fs/promises';
import path from 'node:path';
import { fingerprint, hash } from './util.js';
import { identityKey, contestKey, REVIEW_STATES, normalName } from './canonical.js';
import isoCountries from 'i18n-iso-countries';

const UNSETTLED = new Set(['official-partial', 'projected', 'recount', 'disputed', 'polls-open', 'upcoming']);
const STATUSES = new Set([...UNSETTLED, 'official-final', 'historical', 'cancelled', 'upcoming']);
const date = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
export const recordHash = (r) => { const { review, recordHash, ready, approvalFingerprint, ...data } = r; return fingerprint(data); };

export async function geography(root) {
  const registry = JSON.parse(await fs.readFile(path.join(root, 'public/data/boundaries.json'), 'utf8'));
  const layers = new Map();
  const worldBytes = await fs.readFile(path.join(root, 'public/data/world-50m.topo.json'));
  const world = JSON.parse(worldBytes);
  layers.set('world', { keys: new Set(world.objects.countries.geometries.map((g) => g.properties.name)),
    countryCodes: new Map(world.objects.countries.geometries.map((g) => [g.properties.name, String(g.id).padStart(3, '0')])),
    vintage: null, hash: hash(worldBytes), label: 'Present-day world outline', mode: 'schematic' });
  return { registry, layers, async get(id) {
    if (layers.has(id)) return layers.get(id);
    const entry = registry.sources[id];
    if (!entry) return null;
    const file = path.join(root, 'public', entry.file);
    const bytes = await fs.readFile(file);
    const topo = JSON.parse(bytes);
    const units = topo.objects?.units?.geometries;
    if (!Array.isArray(units) || units.length !== entry.units) throw new Error(`Invalid boundary registry/file count for ${id}`);
    const keys = new Set(units.map((g) => g.properties?.id));
    if (keys.has(undefined) || keys.size !== units.length) throw new Error(`Missing/duplicate boundary keys in ${id}`);
    const data = { keys, iso: entry.iso, vintage: entry.vintage, hash: hash(bytes), label: entry.attribution, mode: 'dated' };
    layers.set(id, data); return data;
  } };
}

/** Rules validate the source's claim, not the election's political truth. */
export async function validateRecords(input, { sources, geo, decisions = null }) {
  const bySource = new Map(sources.map((s) => [s.id, s]));
  const records = structuredClone(input);
  const issues = new Map(records.map((r) => [r, []]));
  const issue = (r, code, text, severity = 'review') => issues.get(r).push({ code, text, severity, evidence: r.citation });
  for (const r of records) {
    const source = bySource.get(r.citation?.sourceId), id = r.electionIdentity || {};
    if (!source) { issue(r, 'unknown-source', 'No registered source supplied this record.', 'reject'); continue; }
    if (id.sourceId !== source.id || !id.sourceElectionId ||
        !['country', 'office', 'tier', 'jurisdiction'].every((k) => typeof id[k] === 'string' && id[k].trim()) ||
        !date(id.date) || r.country !== id.country || r.electionDate !== id.date || r.office !== id.office ||
        (id.round !== null && (!Number.isInteger(id.round) || id.round < 1)) ||
        r.round !== id.round || r.tier !== id.tier || r.jurisdictionLevel !== id.jurisdiction) {
      issue(r, 'identity-incomplete', 'Identity needs country, calendar date, office, round, tier, jurisdiction and a source election ID; a year is insufficient.', 'reject');
    }
    if (id.round === null) issue(r, 'round-unknown', 'The source did not record a round. It is not assumed to match any other election.');
    if (!source.countries.includes(r.country) || r.electionDate < source.dateRange.from || r.electionDate > source.dateRange.to) {
      issue(r, 'outside-source-coverage', 'Record country/date is outside this registered source release.', 'reject');
    }
    if (source.subcountries && !source.subcountries.includes(r.providerCountry)) issue(r, 'provider-country', 'Provider jurisdiction country does not match this registered national election scope.', 'reject');
    if (source.identity && ['country', 'date', 'office', 'round', 'tier', 'jurisdiction', 'sourceElectionId'].some((key) => id[key] !== source.identity[key])) {
      issue(r, 'source-identity-mismatch', 'The record does not describe the registered election. Register a separate election/source before importing it.');
    }
    if (r.electionKey !== identityKey(id)) issue(r, 'identity-key', 'Canonical election key does not match its full identity.', 'reject');
    if (!r.citation?.sha256 || !r.citation?.locator || !r.citation.url) issue(r, 'no-evidence', 'Raw evidence hash, citation URL and record locator are required.', 'reject');
    const boundary = await geo.get(r.layer);
    if (!boundary) issue(r, 'boundary-layer', `Boundary layer ${r.layer} does not exist.`, 'reject');
    else {
      r.geometryValidation = { layer: r.layer, sha256: boundary.hash, vintage: boundary.vintage };
      if (!boundary.keys.has(r.regionKey)) issue(r, 'boundary-key', `Region ${r.regionKey} does not resolve in ${r.layer}; no automatic name or nearest-area match.`, 'reject');
      if (r.layer === 'world' && boundary.keys.has(r.regionKey) &&
          boundary.countryCodes.get(r.regionKey) !== String(isoCountries.alpha3ToNumeric(r.country)).padStart(3, '0')) {
        issue(r, 'boundary-country', 'The resolved world feature belongs to a different country code.', 'reject');
      }
      if (r.layer !== 'world' && boundary.iso !== r.country) issue(r, 'boundary-country', 'The subnational boundary layer belongs to a different country.', 'reject');
      if (r.layer === 'world') issue(r, 'schematic-boundaries', 'Historical/national results cannot silently claim accurate geography on the present-day schematic world outline.');
      else if (boundary.vintage == null || r.boundaryVintage == null || boundary.vintage !== r.boundaryVintage ||
               boundary.vintage !== source.boundaryCompatibility.vintage ||
               (source.boundaryCompatibility.boundaryStart && r.boundaryStart !== source.boundaryCompatibility.boundaryStart)) {
        issue(r, 'boundary-vintage', `Results boundary ${r.boundaryVintage ?? 'unknown'} is incompatible with layer vintage ${boundary.vintage ?? 'unknown'}.`, 'reject');
      }
      if (r.boundaryStart && r.electionDate < r.boundaryStart) issue(r, 'boundary-era', 'The election predates the source boundary set even if its calendar year matches.', 'reject');
    }
    for (const field of ['votes', 'seats']) if (r[field] !== null && (!Number.isInteger(r[field]) || r[field] < 0)) issue(r, 'invalid-count', `${field} must be a nonnegative integer or null.`, 'reject');
    for (const field of ['voteShare', 'turnout']) if (r[field] !== null && (!Number.isFinite(r[field]) || r[field] < 0 || r[field] > 100)) issue(r, 'invalid-percent', `${field} must be 0–100 or null.`, 'reject');
    if (r.voteSystem === 'FPTP' && r.validVotes > 0 && r.votes !== null && r.voteShare !== null &&
        Math.abs(r.voteShare - r.votes / r.validVotes * 100) > 0.001) {
      issue(r, 'share-total', 'Reported candidate share disagrees with votes / provider valid votes beyond rounding tolerance.', 'reject');
    }
    if (!r.party || !r.partyIdentity) issue(r, 'party-missing', 'The source does not identify this party; no selected or default party is substituted.');
    if (r.aliasConflict) issue(r, 'party-alias-conflict', `Party name alias disagrees with the supplied canonical ID (${r.aliasConflict}).`);
    if (r.winner === null) issue(r, 'winner-missing', 'No winner field supplied. Votes or seats are not used to invent a winner.');
    if (![true, false, null].includes(r.winner)) issue(r, 'winner-type', 'Winner must be explicitly true, false or null.', 'reject');
    if (r.position != null && (!Number.isInteger(r.position) || r.position < 1)) issue(r, 'result-position', 'Provider result position must be a positive integer ordinal or missing.', 'reject');
    if (!STATUSES.has(r.resultStatus)) issue(r, 'status-unknown', `Unrecognized source result status: ${r.resultStatus}.`);
    if (UNSETTLED.has(r.resultStatus)) issue(r, 'unsettled', `Source status is ${r.resultStatus}; unsettled or pre-result claims need editorial review.`);
    if (['upcoming', 'polls-open'].includes(r.resultStatus) && (r.winner === true || r.votes > 0)) issue(r, 'pre-result-claim', 'A pre-result status contradicts a reported winner or counted votes. No result can be painted.', 'reject');
    if (r.counted != null && (!Number.isFinite(r.counted) || r.counted < 0 || r.counted > 100)) issue(r, 'counted-range', 'Percentage counted must be 0–100 or missing.', 'reject');
    if (r.resultStatus === 'cancelled') issue(r, 'cancelled', 'The source marks the election cancelled; no result may be painted.', 'reject');
    if (r.isNotional || r.isNotionalAggregate) issue(r, 'notional', 'The source marks these as notional results/aggregates, not votes cast by a candidate in this election.', 'reject');
    if (r.isByElection) issue(r, 'by-election', 'This registered release is a general election, not a by-election.', 'reject');
    if (r.generalElectionDate && r.generalElectionDate !== r.electionDate && !r.isByElection) issue(r, 'poll-date-conflict', 'Constituency polling date contradicts the provider general-election date.', 'reject');
    if (r.ambiguousUpdateTime || (r.sourceUpdateTime && (!/(?:Z|[+-]\d{2}:\d{2})$/.test(r.sourceUpdateTime) || !Number.isFinite(Date.parse(r.sourceUpdateTime))))) issue(r, 'ambiguous-update-time', 'Source update time has no unambiguous instant; retrieval time cannot replace it.');
    if (!r.sourceUpdateTime) issue(r, 'update-time-missing', 'Source update instant is not supplied; HTTP metadata and retrieval time remain separate.', 'warning');
    if (r.missingFields.length) issue(r, 'missing-fields', `Not supplied: ${r.missingFields.join(', ')}. Nulls remain null.`, 'warning');
  }

  const groups = (keyOf) => {
    const out = new Map(); for (const r of records) { const k = keyOf(r); if (!out.has(k)) out.set(k, []); out.get(k).push(r); } return out;
  };
  const conflicts = [], duplicates = [];
  const logical = groups((r) => r.id);
  const keep = new Set(records);
  for (const [id, list] of logical) if (list.length > 1) {
    const value = (r) => { const { citation, ...rest } = r; return fingerprint(rest); };
    if (new Set(list.map(value)).size === 1) {
      list[0].duplicateEvidence = list.map((r) => r.citation);
      issue(list[0], 'duplicate-row', `${list.length} identical source rows collapsed with all locators retained.`, 'warning');
      for (const r of list.slice(1)) keep.delete(r);
      duplicates.push({ id, count: list.length });
    } else {
      for (const r of list) { issue(r, 'duplicate-conflict', 'Duplicate result identity has different values; no last-row-wins behavior.', 'reject'); r.logicalId = id; r.id = `${id}-${recordHash(r).slice(0, 12)}`; }
      conflicts.push({ type: 'duplicate-result', records: list.map((r) => r.id) });
    }
  }
  const crossSourceGroups = [
    ...groups((r) => [contestKey(r.electionIdentity), r.regionKey, 'name', normalName(r.party)].join('|')).values(),
    ...groups((r) => [contestKey(r.electionIdentity), r.regionKey, 'id', r.partyIdentity || r.id].join('|')).values()
  ];
  for (const list of crossSourceGroups) {
    if (new Set(list.map((r) => r.electionIdentity.sourceId)).size < 2) continue;
    const value = (r) => fingerprint([r.votes, r.voteShare, r.seats, r.turnout, r.winner, r.resultStatus]);
    if (new Set(list.map(value)).size > 1) {
      for (const r of list) issue(r, 'source-conflict', 'Registered sources disagree on this contest and party. Both claims remain separate.');
      conflicts.push({ type: 'source-conflict', records: list.map((r) => r.id) });
    }
  }
  for (const list of groups((r) => [contestKey(r.electionIdentity), r.regionKey].join('|')).values()) {
    const claims = list.filter((r) => r.winner === true);
    if (new Set(claims.map((r) => r.electionIdentity.sourceId)).size > 1 &&
        new Set(claims.map((r) => normalName(r.party))).size > 1) {
      for (const r of list) issue(r, 'source-conflict', 'Registered sources name different winners for the same constituency.');
      conflicts.push({ type: 'winner-source-conflict', records: claims.map((r) => r.id) });
    }
  }
  for (const list of groups((r) => `${r.electionIdentity.sourceId}|${r.electionIdentity.sourceElectionId}`).values()) {
    if (new Set(list.map((r) => r.electionKey)).size > 1) {
      for (const r of list) issue(r, 'source-identity-collision', 'One provider election ID describes different dates, offices, rounds or jurisdictions. They remain separate for review.');
      conflicts.push({ type: 'identity-conflict', records: list.map((r) => r.id) });
    }
  }
  for (const list of groups((r) => `${r.electionIdentity.sourceId}|${contestKey(r.electionIdentity)}`).values()) {
    if (new Set(list.map((r) => r.electionIdentity.sourceElectionId)).size > 1) {
      for (const r of list) issue(r, 'duplicate-election', 'Different provider election IDs claim the same full contest. No automatic merge.');
    }
  }
  for (const list of groups((r) => `${r.electionKey}|${r.regionKey}`).values()) {
    if (list[0].voteSystem !== 'FPTP' || list[0].resultStatus !== 'official-final') continue;
    const unique = list.filter((r) => keep.has(r));
    if (unique.filter((r) => r.winner === true).length !== 1) for (const r of unique) issue(r, 'winner-count', 'A final FPTP constituency must contain exactly one reported winner.');
    const valid = unique[0]?.validVotes;
    if (valid !== null && unique.every((r) => r.votes !== null) && unique.reduce((n, r) => n + r.votes, 0) !== valid) {
      for (const r of unique) issue(r, 'vote-total', 'Candidate votes do not sum to the provider valid-vote total.', 'reject');
    }
  }

  if (decisions && (!decisions.reviewer?.trim() || !Array.isArray(decisions.decisions))) throw new Error('A review decision file needs a reviewer and decisions array');
  const decisionMap = new Map((decisions?.decisions || []).map((d) => [d.id, d]));
  if (decisionMap.size !== (decisions?.decisions || []).length) throw new Error('Duplicate review decisions');
  const output = records.filter((r) => keep.has(r));
  for (const r of output) {
    const reasons = issues.get(r), rejected = reasons.some((x) => x.severity === 'reject'), needs = reasons.some((x) => x.severity === 'review');
    r.recordHash = recordHash(r);
    r.review = { state: rejected ? 'rejected' : needs ? 'needs-review' : 'imported-with-warning',
      reasons, evidence: r.citation, verification: 'automated checks do not verify political facts' };
    const decision = decisionMap.get(r.id);
    if (decision) {
      if (decision.recordHash !== r.recordHash || !REVIEW_STATES.includes(decision.state) || !decision.reason?.trim()) throw new Error(`Review decision does not match exact evidence for ${r.id}`);
      if (decision.state === 'verified' && (rejected || needs || UNSETTLED.has(r.resultStatus))) throw new Error(`Cannot mark unresolved/disputed record ${r.id} verified`);
      if (decision.state === 'imported-with-warning' && rejected) throw new Error(`Cannot override invalid geography or rejected record ${r.id}`);
      if (!['needs-review', 'rejected'].includes(decision.state) && reasons.some((x) => ['winner-missing', 'winner-count', 'source-conflict', 'source-identity-mismatch', 'source-identity-collision', 'duplicate-election', 'ambiguous-update-time'].includes(x.code))) throw new Error(`Resolve the source/identity/winner conflict before accepting ${r.id}`);
      r.review = { ...r.review, state: decision.state, decision: { reviewer: decisions.reviewer, reason: decision.reason,
        recordHash: decision.recordHash, evidence: r.citation } };
      decisionMap.delete(r.id);
    }
  }
  if (decisionMap.size) throw new Error(`Review decisions reference unknown records: ${[...decisionMap.keys()].join(', ')}`);
  const uniqueConflicts = [...new Map(conflicts.map((c) => [fingerprint([c.type, [...c.records].sort()]), c])).values()];
  return { records: output.sort((a, b) => a.id.localeCompare(b.id)), conflicts: uniqueConflicts, duplicates };
}
