/** Read a committed ingestion generation; proposals still use the shared review/apply. */
import { state, PALETTE } from '../state.js';
import { LAYER, BOUNDARY, layerHash } from '../geo.js';

const sha256 = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
  .map((v) => v.toString(16).padStart(2, '0')).join('');

async function checkedJson(url, expected) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Election database file unavailable: ${url} (${res.status}). Run npm run elections:update.`);
  const bytes = await res.arrayBuffer();
  if (expected && await sha256(bytes) !== expected) throw new Error('Election database evidence/file hash mismatch. Revalidate and rebuild the generation.');
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function databaseDraft({ election, query }, layer) {
  const pointer = await checkedJson('data/ingestion/current.json');
  if (!/^[a-f0-9]{64}$/.test(pointer.generation) || pointer.index !== `data/ingestion/generations/${pointer.generation}/index.json` ||
      pointer.manifest !== `data/ingestion/generations/${pointer.generation}/manifest.json` || !pointer.manifestSha256) throw new Error('Invalid ingestion generation pointer');
  const manifest = await checkedJson(pointer.manifest, pointer.manifestSha256);
  const index = await checkedJson(pointer.index, manifest.files['index.json']);
  const available = index.elections;
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const here = available.filter((e) => e.layer === LAYER && (election === e.key || terms.every((term) => /^\d{4}$/.test(term)
    ? e.identity.date.startsWith(term) : `${e.identity.country} ${e.identity.date} ${e.identity.office} ${e.identity.sourceId}`.toLowerCase().includes(term))));
  if (!election) {
    if (!here.length) throw new Error(available.some((e) => e.layer === LAYER) ? 'No election matches this search on the current layer. Refine the country/date or select another boundary layer.' : available.length ? `Open the required boundary layer first: ${[...new Set(available.map((e) => e.layer))].join(', ')}.` : 'No ingested records are available. Inspect the ingestion report.');
    return { choose: { name: 'election', prompt: 'Which registered election?', note: `${here.length} matches${here.length > 50 ? '; showing the first 50 — refine the search' : ''}. Machine validation is not editorial fact verification. Every imported map starts as a draft.`,
      options: here.slice(0, 50).map((e) => ({ value: e.key,
        label: `${e.identity.country} · ${e.identity.date} · ${e.identity.office} · round ${e.identity.round ?? 'unknown'}`,
        detail: `${e.winners} eligible reported winners · ${e.records} source records · ${e.identity.sourceId} · ${e.layer}${e.winners ? '' : ' · source review required'}` })) } };
  }
  const entry = here.find((e) => e.key === election);
  if (!entry || !/^maps\/election-[a-f0-9]{24}\.json$/.test(entry.file)) throw new Error('Election is unavailable for this geometry; choose again.');
  const data = await checkedJson(`data/ingestion/generations/${pointer.generation}/${entry.file}`, entry.sha256);
  if (!entry.winners) return { reviewOnly: { identity: data.identity, records: data.quarantinedRecords || [],
    evidencePrefix: `data/ingestion/generations/${pointer.generation}/`, evidenceFiles: manifest.evidence || {},
    note: 'These records are quarantined. No winner or compatible geometry is invented. Decisions must cite the exact record hash in an ingestion review file.' } };
  const records = data.records;
  if (!records.length || records.some((r) => r.electionKey !== entry.key || r.winner !== true ||
      !['verified', 'imported-with-warning'].includes(r.review?.state) || r.geometryValidation?.sha256 !== layerHash() ||
      r.layer !== LAYER || r.boundaryVintage !== (BOUNDARY?.vintage ?? null))) {
    throw new Error('Result evidence/review or the loaded boundary file no longer matches validation. Revalidate before importing.');
  }
  if (new Set(records.map((r) => r.regionKey)).size !== records.length) throw new Error('More than one winner claims a region; return to the source review queue.');
  const identity = data.identity, first = records[0], source = data.source;
  const statuses = [...new Set(records.map((r) => r.resultStatus))];
  if (statuses.length !== 1) throw new Error('Mixed result statuses require source review before a map can be built.');
  const colors = new Map();
  const hints = records.map((r) => {
    const key = r.partyIdentity + (r.alliance ? `:joint:${r.alliance.adjunctName}` : '');
    if (!colors.has(key)) colors.set(key, state.parties.find((p) => p.slotKey === key)?.color || PALETTE[colors.size % PALETTE.length]);
    const name = r.party === 'Independent' ? `Independent: ${r.candidate}` : r.party + (r.alliance ? ` / ${r.alliance.adjunctName}` : '');
    return { key, name, color: colors.get(key),
      label: r.party, canonical: r };
  });
  const notes = [];
  if (data.quarantined) notes.push(`${data.quarantined} source records were quarantined; this map is incomplete. See the ingestion review report.`);
  if (records.some((r) => r.turnout !== null)) notes.push('Turnout: valid votes divided by electorate; spoiled ballots excluded.');
  return { ...layer, hasHeader: false, hints, unitKeys: records.map((r) => r.regionKey),
    source: { kind: 'ingestion', label: source.provider, url: first.citation.url, datasetId: entry.key,
      asOf: identity.date, fetchedAt: first.citation.retrievedAt, fitToData: true, completeSnapshot: true,
      title: `${identity.office}, ${identity.date}`, what: 'Reported constituency winner', notes,
      cite: { permalink: first.citation.url, license: `${source.licence.attribution} ${source.licence.url}` },
      evidence: { sourceId: source.id, rawSha256: first.citation.sha256, receiptId: first.citation.receiptId, generation: pointer.generation, parser: source.parser,
        capturedFile: manifest.evidence?.[first.citation.sha256] ? `data/ingestion/generations/${pointer.generation}/${manifest.evidence[first.citation.sha256]}` : null },
      publication: { electionId: entry.key, country: identity.country, office: identity.office,
        electionType: first.electionType || '', round: identity.round, electionDate: identity.date,
        purpose: statuses[0] === 'official-partial' ? 'partial-update' : 'result', status: statuses[0],
        counted: first.counted ?? null, updatedAt: first.sourceUpdateTime } },
    rows: records.map((r, i) => [r.regionName, hints[i].name,
      r.voteShare === null ? '[clear]' : String(r.voteShare), '[clear]',
      r.turnout === null ? '[clear]' : String(r.turnout), '[clear]']),
    columns: ['unit', 'party', 'vote', 'seats', 'turnout', 'margin'].map((role, index) => ({ role, index, header: role })) };
}
