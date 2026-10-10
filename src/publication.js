/**
 * Publication metadata, and the review that decides whether a map may be
 * published.
 *
 * This module is pure: every function takes what it needs as arguments and
 * reads no global state, so the rules can be tested directly and the export,
 * the review panel and the content pack all apply the same ones.
 *
 * The distinctions it exists to keep apart:
 *   an election's date is not when its source was retrieved;
 *   official partial is not official final;
 *   projected is not confirmed;
 *   disputed or under recount is not settled;
 *   historical archive data is not current reporting.
 */

import { documentSources, MANUAL_SOURCE } from './provenance.js';
import { captionMissing } from './pack.js';

/* ------------------------------------------------------------------ fields */

export const STATUSES = [
  'upcoming', 'polls-open', 'projected', 'official-partial',
  'official-final', 'disputed', 'recount', 'historical'
];

export const PURPOSES = [
  'result', 'partial-update', 'projection', 'historical', 'upcoming', 'flags', 'explainer'
];

export const STATUS_LABELS = {
  upcoming: 'Upcoming',
  'polls-open': 'Polls open',
  projected: 'Projected',
  'official-partial': 'Official partial',
  'official-final': 'Official final',
  disputed: 'Disputed',
  recount: 'Recount',
  historical: 'Historical'
};

export const PURPOSE_LABELS = {
  result: 'Result',
  'partial-update': 'Partial update',
  projection: 'Projection',
  historical: 'Historical',
  upcoming: 'Upcoming election',
  flags: 'Flags map',
  explainer: 'Explainer'
};

/** Headline and subtitle live in the document's own title and sub fields. */
export const PUBLICATION_DEFAULTS = Object.freeze({
  electionId: null,      // dataset identity: country · date · office · round
  country: '',           // country, territory or organisation
  office: '',            // the office being contested
  electionType: '',      // general, presidential, referendum, local …
  round: null,           // 1, 2 … or null when there are no rounds
  electionDate: null,    // yyyy-mm-dd: when the election happened
  purpose: null,         // one of PURPOSES
  status: null,          // one of STATUSES
  counted: null,         // percentage counted, 0–100, or null
  updatedAt: null,       // when the result or source was last updated (ISO)
  timeInputOffset: '+00:00', // explicit offset used to enter/display updatedAt
  note: '',              // editorial note or caveat
  captionDraft: null,    // exact reviewed caption text; null uses generated text
  captionBasis: null,    // generated caption when the draft was last reviewed
  ready: false,          // the reviewer's explicit "ready to publish"
  approvalFingerprint: null
});

export const freshPublication = () => ({ ...PUBLICATION_DEFAULTS });

/** Statuses a count is still moving under. */
const LIVE = new Set(['polls-open', 'projected', 'official-partial', 'disputed', 'recount']);
/** Statuses that are not a settled final result. */
const UNSETTLED = new Set(['upcoming', 'polls-open', 'projected', 'official-partial', 'disputed', 'recount']);

/** Which statuses each purpose may carry. Flags and explainers may carry any, or none. */
const COMPATIBLE = {
  result: ['official-final', 'official-partial', 'projected', 'disputed', 'recount'],
  'partial-update': ['official-partial', 'projected', 'polls-open'],
  projection: ['projected'],
  historical: ['historical'],
  upcoming: ['upcoming', 'polls-open'],
  flags: null,
  explainer: null
};

/** Purposes that assert something about an election's result. */
const RESULT_PURPOSES = new Set(['result', 'partial-update', 'projection', 'historical']);
const IDENTIFIED_PURPOSES = new Set([...RESULT_PURPOSES, 'upcoming']);

/**
 * Words that claim a settled outcome. Allowed on an official final result and
 * on historical data; a blocker on anything still moving or contested.
 */
const FINAL_WORDS = /\b(final|winners?|won|wins|winning|victory|victorious|landslide|elected|certified|confirmed|clinch(?:es|ed)?|sweeps?|swept|defeats?|defeated|concede[sd]?)\b/i;
const NEGATED_FINALITY = /\b(?:not(?:\s+yet)?|never)\s+(?:the\s+)?(?:final|winner|certified|confirmed|elected)\b|\bno\s+final\s+result\b/gi;

/** An offset is deliberate; named time zones and DST ambiguity are excluded. */
export const validOffset = (s) => typeof s === 'string' && /^[+-](?:0\d|1[0-3]):[0-5]\d$|^[+-]14:00$/.test(s);
export function parseUpdatedInput(local, offset) {
  if (!local) return null;
  if (!validOffset(offset) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new Error('Enter a valid time and an explicit UTC offset, such as +00:00 or +06:00.');
  const iso = `${local}:00${offset}`;
  const millis = Date.parse(iso);
  if (!Number.isFinite(millis) ||
      new Date(millis + offsetMinutes(offset) * 60000).toISOString().slice(0, 16) !== local) {
    throw new Error('That date or time is invalid.');
  }
  return new Date(millis).toISOString();
}

function offsetMinutes(offset) { const sign = offset[0] === '-' ? -1 : 1; return sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6))); }
export function inputTimeAtOffset(instant, offset = '+00:00') {
  if (!instant || !validOffset(offset) || !Number.isFinite(Date.parse(instant))) return '';
  return new Date(Date.parse(instant) + offsetMinutes(offset) * 60000).toISOString().slice(0, 16);
}

const canonical = (x) => Array.isArray(x) ? x.map(canonical)
  : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canonical(x[k])])) : x;

function checksum(data) {
  let a = 2166136261, b = 2166136261;
  for (let i = 0; i < data.length; i++) {
    const ch = data.charCodeAt(i);
    a = Math.imul(a ^ ch, 16777619);
    b = Math.imul(b ^ (ch >>> 8) ^ (i & 255), 16777619);
  }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}

/** Review receipt: detects ordinary edits and a forged ready flag, not a security signature. */
export function reviewFingerprint(doc) {
  const pub = { ...PUBLICATION_DEFAULTS, ...(doc.publication || {}) };
  delete pub.ready; delete pub.approvalFingerprint;
  const data = JSON.stringify(canonical({
    publication: pub, parties: doc.parties, assign: doc.assign, provenance: doc.provenance,
    layer: doc.layer, layerAssign: doc.layerAssign, mode: doc.mode, flagged: doc.flagged,
    metric: doc.metric, title: doc.title, sub: doc.sub, handle: doc.handle,
    proj: doc.proj, rotate: doc.rotate, zoom: doc.zoom, pan: doc.pan, fit: doc.fit,
    theme: doc.theme, grat: doc.grat, antarctica: doc.antarctica, dots: doc.dots, labels: doc.labels
  }));
  return checksum(data);
}

export function captionBasisFor(doc) {
  const pub = { ...PUBLICATION_DEFAULTS, ...(doc.publication || {}) };
  delete pub.ready; delete pub.approvalFingerprint;
  delete pub.captionDraft; delete pub.captionBasis; delete pub.timeInputOffset;
  return checksum(JSON.stringify(canonical({ publication: pub, title: doc.title, sub: doc.sub,
    assign: doc.assign, parties: doc.parties, provenance: doc.provenance, layer: doc.layer })));
}

export function approvePublication(doc, ctx = {}) {
  const before = reviewPublication(doc, ctx);
  if (before.blockers.length) throw new Error(before.blockers[0].text);
  doc.publication.ready = true;
  doc.publication.approvalFingerprint = reviewFingerprint(doc);
  return reviewPublication(doc, ctx);
}

function editorialFinalClaim(text, parties) {
  let wording = String(text || '');
  for (const name of [...new Set((parties || []).map((p) => p.name).filter(Boolean))].sort((a, b) => b.length - a.length)) {
    wording = wording.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
  }
  wording = wording.replace(NEGATED_FINALITY, ' ');
  return FINAL_WORDS.exec(wording);
}

/* ------------------------------------------------------------------ labels */

const pct = (n) => {
  const v = Math.round(n * 10) / 10;
  return (Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)) + '%';
};

const yearOf = (d) => (d && /^\d{4}/.test(d) ? d.slice(0, 4) : null);

/** `2026-09-26T14:05:00Z` → `2026-09-26 14:05 UTC`, always in UTC. */
export function formatUpdated(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 16)} UTC`;
}

/**
 * The status text for the export badge. Deterministic from the metadata alone.
 * Returns '' only when there is no status to state.
 */
export function statusLabel(pub) {
  const p = pub || PUBLICATION_DEFAULTS;
  switch (p.status) {
    case 'official-final': return 'OFFICIAL FINAL';
    case 'official-partial':
      return p.counted != null ? `OFFICIAL PARTIAL · ${pct(p.counted)} COUNTED` : 'OFFICIAL PARTIAL · COUNT NOT STATED';
    case 'projected': return p.counted != null ? `PROJECTED · NOT FINAL · ${pct(p.counted)} COUNTED` : 'PROJECTED · NOT FINAL';
    case 'disputed': return 'DISPUTED · NOT SETTLED';
    case 'recount': return 'RECOUNT PENDING · NOT FINAL';
    case 'polls-open': return 'POLLS OPEN · NO RESULTS YET';
    case 'upcoming': return p.electionDate ? `UPCOMING · ${p.electionDate}` : 'UPCOMING';
    case 'historical': return `HISTORICAL ARCHIVE${yearOf(p.electionDate) ? ' · ' + yearOf(p.electionDate) : ''}`;
    default: return '';
  }
}

/**
 * What the export badge actually says. A map that has not been reviewed and
 * marked ready says DRAFT first, whatever its status, so an unreviewed image
 * cannot pass for a published one.
 */
export function badgeText(pub, { sourced = false, publishable = false } = {}) {
  if (pub?.purpose === 'explainer' && pub.electionType === 'latest-election-snapshot') return `${publishable ? '' : 'DRAFT · '}LATEST AVAILABLE SNAPSHOT`;
  if (pub?.purpose === 'explainer' && pub.electionType === 'national-election-catalog') return `${publishable ? '' : 'DRAFT · '}NATIONAL CATALOG`;
  const label = statusLabel(pub);
  if (!label) return sourced ? 'DRAFT · STATUS NOT SET' : '';
  return publishable ? label : `DRAFT · ${label}`;
}

/** Whether the map should carry a badge at all. Unsourced, unlabelled maps do not. */
export const needsBadge = (pub, sourced) => !!(sourced || (pub && pub.status));

/** How a caption or legend may describe the parties on the map, given the status. */
export function standingsPrefix(status, noun) {
  switch (status) {
    case 'official-final': return `Winning party by ${noun}`;
    case 'official-partial':
    case 'projected':
    case 'polls-open': return `Leading party by ${noun} so far (not final)`;
    case 'disputed':
    case 'recount': return `Declared leader by ${noun} (not settled)`;
    case 'historical': return `By ${noun}`;
    default: return `By ${noun}`;
  }
}

/** A legend title that never claims a winner the status does not support. */
export function legendTitleFor(status) {
  if (status === 'official-final') return 'Winning party';
  if (status && UNSETTLED.has(status)) return 'Leading party (not final)';
  if (status === 'historical') return 'Party shown';
  return 'Winning party';
}

/* ------------------------------------------------------------------ review */

const sourceIsCited = (s) => !!(s.cite?.permalink || s.url);
const isManual = (s) => s.source === MANUAL_SOURCE.source && !s.datasetId;
const isArchive = (s) => typeof s.datasetId === 'string' && s.datasetId.startsWith('parlgov:');

/**
 * The review: what blocks publication, what the reviewer should notice, and
 * the facts the panel shows.
 *
 * @param {object} doc  { publication, assign, provenance, title, sub, mode, flagged }
 * @param {object} ctx  { boundary, boundaryLine, vintageGap, now }
 *   boundary      the active layer's registry entry, or null for the world
 *   boundaryLine  the footer's own boundary text, so the panel shows the same words
 *   vintageGap    resultsVintageWarning() for this map, if any
 *   now           Date for "stale live count" checks; injectable for tests
 */
export function reviewPublication(doc, ctx = {}) {
  const pub = { ...PUBLICATION_DEFAULTS, ...(doc.publication || {}) };
  const assign = doc.assign || {};
  const flagMode = doc.mode === 'flags';
  const sources = flagMode ? [] : documentSources(assign);
  const sourced = !flagMode && !!doc.provenance;
  const blockers = [];
  const warnings = [];
  const block = (code, text) => { if (!blockers.some((b) => b.code === code)) blockers.push({ code, text }); };
  const warn = (code, text) => warnings.push({ code, text });

  const resultPurpose = RESULT_PURPOSES.has(pub.purpose);
  const hasResults = !flagMode && Object.keys(assign).length > 0;

  // ---- what the map is
  if (!pub.purpose) block('purpose', 'Choose what this map is: a result, partial update, projection, historical, upcoming, flags or explainer.');
  if ((IDENTIFIED_PURPOSES.has(pub.purpose) || (!pub.purpose && hasResults)) && !(pub.electionId || '').trim()) {
    block('identity', 'No election identity. Give the country, date, office and round, e.g. "UK · 2024-07-04 · House of Commons · general".');
  }
  const needsStatus = pub.purpose ? COMPATIBLE[pub.purpose] !== null : hasResults;
  if (needsStatus && !pub.status) block('status', 'No result status. Choose upcoming, polls open, projected, official partial, official final, disputed, recount or historical.');
  if (IDENTIFIED_PURPOSES.has(pub.purpose) && !pub.electionDate) block('date', 'No election date. The date the election was held — not when the data was retrieved.');
  if (IDENTIFIED_PURPOSES.has(pub.purpose) && !(pub.office || '').trim()) block('office', 'No office. Say what was contested: president, lower house, mayor, government …');

  // ---- status must fit the purpose
  const allowed = pub.purpose ? COMPATIBLE[pub.purpose] : null;
  if (allowed && pub.status && !allowed.includes(pub.status)) {
    block('status-purpose', `A ${PURPOSE_LABELS[pub.purpose].toLowerCase()} map cannot carry the status "${STATUS_LABELS[pub.status]}".`);
  }

  // ---- counts and times for results that are still moving
  if (pub.status === 'official-partial') {
    if (pub.counted == null) block('counted', 'An official partial result needs the percentage counted.');
    else if (pub.counted >= 100) warn('counted-100', '100% counted but marked partial. If certified, mark it official final; otherwise keep it partial and say why.');
  }
  if (pub.counted != null && (pub.counted < 0 || pub.counted > 100)) block('counted-range', 'Percentage counted must be between 0 and 100.');
  if (LIVE.has(pub.status) && !pub.updatedAt) block('updated', 'A count that is still moving needs the time the result or source was last updated.');
  if (LIVE.has(pub.status) && pub.electionDate && ctx.now) {
    const age = (ctx.now - Date.parse(pub.electionDate)) / 86400000;
    if (age > 60) warn('old-active', `This ${STATUS_LABELS[pub.status].toLowerCase()} result is ${Math.round(age)} days after the election. Recheck the status and update time against the cited source; age alone does not settle a recount or count.`);
  }
  if (pub.electionDate && ctx.now && pub.status !== 'historical') {
    const age = (ctx.now - Date.parse(pub.electionDate)) / 86400000;
    if (age > 60 && !LIVE.has(pub.status)) warn('old-result', `This election was ${Math.round(age)} days ago. Confirm whether the graphic is a retrospective result or current reporting.`);
    if (age > 60 && /\b(current|today|live|breaking|just announced|this week)\b/i.test([doc.title, doc.sub, pub.note].join(' '))) {
      if (LIVE.has(pub.status)) warn('old-current-wording', 'The editorial text says current or live for an old election. Confirm the ongoing count, dispute or recount against a recently updated source.');
      else block('old-current-language', 'The editorial text calls an old settled election current or live. Remove that claim or explain the update precisely.');
    }
  }
  if (pub.updatedAt && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(pub.updatedAt) || !Number.isFinite(Date.parse(pub.updatedAt)))) block('updated-instant', 'The update time must be a UTC instant with an explicit offset at entry.');
  if (!validOffset(pub.timeInputOffset)) block('updated-offset', 'Choose an explicit UTC offset for the update time.');

  // ---- language that claims a settled outcome
  const settledAllowed = pub.status === 'official-final' || pub.status === 'historical';
  if (!settledAllowed) {
    for (const [field, text] of [['headline', doc.title], ['subtitle', doc.sub], ['note', pub.note]]) {
      const m = editorialFinalClaim(text, doc.parties);
      if (m) block(`final-language-${field}`, `The ${field} says "${m[0]}", but the result is ${pub.status ? STATUS_LABELS[pub.status].toLowerCase() : 'not marked final'}. Remove final or winner language.`);
    }
  }

  // ---- sources and citations
  const manual = sources.filter(isManual);
  const uncited = sources.filter((s) => !isManual(s) && !sourceIsCited(s));
  if (resultPurpose && hasResults) {
    if (!sourced || !sources.length) block('source', 'This is a sourced result with no source. Import it with a source and a link, or mark the map as an explainer.');
    if (manual.length) block('manual', 'Some values were entered by hand and carry no source. Re-import them from a cited source or remove them.');
    if (uncited.length) block('citation', `No link or citation for: ${uncited.map((s) => s.source).join(', ')}. Add the exact results page or revision.`);
  }
  if (sources.length > 1) warn('mixed', `This map combines ${sources.length} sources. The export and caption disclose it.`);

  // ---- historical data is not current reporting
  const archiveValues = sources.some(isArchive);
  for (const rec of Object.values(assign)) {
    const data = rec.catalog;
    if (!data) continue;
    if (doc.layer !== 'world' || data.geometry?.mode !== 'schematic' || data.geometry?.sha256 !== ctx.activeLayerHash) block('catalog-geometry', 'National catalog data requires its validated schematic country outline; subnational geometry is a separate claim.');
    if (pub.purpose !== 'explainer' || pub.electionDate !== null || pub.status !== null || pub.electionId !== data.snapshotIdentity) block('catalog-identity', 'This catalog display combines country-specific elections. Preserve its explanatory purpose and snapshot identity; do not claim one election date or a uniform final status.');
    if (!String(doc.sub || '').includes(data.cutoffUtc) && !data.singleEvent) block('catalog-cutoff', 'The export must state the snapshot cutoff and varying election dates.');
    if (rec.label !== data.label || !['vote','seats','turnout','margin'].every(k => rec[k] === data.mappedValues[k])) block('catalog-values', 'Catalog labels or metrics differ from the captured source/derived metric; re-import the intended view.');
    const category = (doc.parties || []).find(p => p.id === rec.party);
    if (category?.slotKey !== data.slotKey || category?.name !== data.legendCategory) block('catalog-category', 'The mapped category differs from the catalog metric or coverage state.');
    if (!data.metric?.eligible && !data.status) block('catalog-review', 'Unavailable catalog metrics must retain an explicit missing/pending/non-applicable state.');
    if (!warnings.some(w => w.code === 'catalog-schematic')) warn('catalog-schematic', 'National schematic display. Source authority, metric eligibility and independent verification are separate; freshness gaps remain visible.');
  }
  for (const rec of Object.values(assign)) {
    const data = rec.ingestion;
    if (!data) continue;
    if (!['verified', 'imported-with-warning'].includes(data.review?.state) || data.winner !== true) {
      block('ingestion-review', 'An ingested result is quarantined or has no source-reported winner. Return to the ingestion review queue.');
    }
    if (pub.electionId !== data.electionKey || pub.country !== data.country || pub.electionDate !== data.electionDate || pub.office !== data.office || pub.round !== data.round) {
      block('ingestion-identity', 'Publication metadata conflicts with the ingested election identity. Import or review the correct election.');
    }
    if (data.electionType && pub.electionType !== data.electionType) block('ingestion-identity', 'Publication election type differs from the registered source election.');
    if ((pub.updatedAt ?? null) !== (data.sourceUpdateTime ?? null)) block('ingestion-time', 'Preserve the source update instant. Retrieval time cannot replace an unknown or different source timestamp.');
    if ((pub.counted ?? null) !== (data.counted ?? null)) block('ingestion-count', 'Percentage counted differs from the ingested source. Re-import a cited update instead of inventing a count.');
    if (rec.vote !== data.voteShare || rec.turnout !== data.turnout || rec.seats !== null || rec.margin !== null) {
      block('ingestion-values', 'Mapped metrics differ from the ingested canonical values. Seat counts are not seat shares; re-import with the source column roles.');
    }
    if (data.geometryValidation?.sha256 !== ctx.activeLayerHash) block('ingestion-geometry', 'The active boundary file differs from the ingested validation evidence. Revalidate before publication.');
    const retrospectiveFinal = pub.status === 'historical' && ['official-final', 'historical'].includes(data.resultStatus);
    if (pub.status !== data.resultStatus && !retrospectiveFinal) {
      block('ingestion-status', `The ingested source status is ${data.resultStatus}. Preserve it; only settled results can become a labelled historical retrospective.`);
    }
  }
  if (archiveValues && pub.status && pub.status !== 'historical') {
    block('historical-as-current', 'These values come from the historical archive, but the status says current reporting. Mark it historical.');
  }
  if (pub.status === 'historical' && !archiveValues && hasResults && !pub.electionDate) {
    block('historical-date', 'A historical map needs the date it describes.');
  }

  // ---- boundaries the existing checks already know are unsafe
  const overridden = sources.some((s) => s.vintageOverride) || !!doc.provenance?.vintageOverride;
  if (overridden && !(pub.note || '').trim()) {
    block('vintage-override', 'Results are drawn on boundaries redrawn since they were cast. Add an editorial note explaining this before publishing.');
  }
  if (ctx.vintageGap) warn('vintage-gap', ctx.vintageGap.text);

  const gaps = [...new Set(sources.flatMap((s) => (s.gaps || []).map((g) => g.unit)))];
  if (gaps.length) warn('coverage-gaps', `Archive coverage is missing or uncertain for: ${gaps.join(', ')}. The export names them.`);

  if (pub.captionDraft != null && pub.captionBasis !== captionBasisFor(doc)) {
    block('caption-stale', 'Metadata changed after the edited caption was reviewed. Review the caption as written or regenerate it.');
  }
  if (pub.captionDraft != null) {
    const essential = captionMissing({ publication: pub, sources: sources.map((s) => ({
      url: s.cite?.permalink || s.url || null, source: s.source
    })), mixed: sources.length > 1, gaps, notes: [...new Set(sources.flatMap((s) => s.notes || []))],
    override: overridden, vintageGap: ctx.vintageGap?.text || null,
    modernBorders: pub.status === 'historical' && doc.layer === 'world' }, pub.captionDraft);
    if (essential.length) block('caption-required', `Edited caption omits ${essential[0]}. Restore it or regenerate the caption.`);
  }

  const publishable = blockers.length === 0 && pub.ready === true && pub.approvalFingerprint === reviewFingerprint(doc);
  const facts = {
    identity: pub.electionId || null,
    country: pub.country || null,
    office: pub.office || null,
    electionType: pub.electionType || null,
    round: pub.round,
    electionDate: pub.electionDate,
    purpose: pub.purpose,
    status: pub.status,
    statusLabel: statusLabel(pub),
    counted: pub.counted,
    updated: formatUpdated(pub.updatedAt),
    timeframe: pub.status === 'historical' || archiveValues ? 'Historical' : (pub.status ? 'Current reporting' : 'Not stated'),
    sources: sources.map((s) => ({
      source: s.source, url: s.cite?.permalink || s.url || null,
      licence: s.cite?.license || null, retrievedAt: s.fetchedAt || null, evidence: s.evidence || null,
      cited: sourceIsCited(s), manual: isManual(s)
    })),
    boundary: ctx.boundaryLine || (ctx.boundary ? ctx.boundary.layerId : 'World outline (Natural Earth, present-day borders)'),
    mixed: sources.length > 1,
    manualValues: manual.length > 0
  };

  return {
    publication: pub,
    sourced,
    blockers,
    warnings,
    facts,
    publishable,
    draft: !publishable,
    badge: needsBadge(pub, sourced) ? badgeText(pub, { sourced, publishable }) : ''
  };
}

/* ------------------------------------------------------------------ import */

/**
 * What an import can honestly say about the publication, and nothing more.
 *
 * The historical archive is historical by definition, so it fills itself in.
 * Anything else only carries across the identity the importer typed; a status
 * is never guessed from a table, because guessing "final" is the error this
 * whole module exists to prevent.
 */
export function suggestPublication(source, { scope } = {}) {
  const pub = freshPublication();
  if (!source) return pub;
  if (source.datasetId) pub.electionId = source.datasetId;
  if (source.kind === 'archive') {
    pub.purpose = 'historical';
    pub.status = 'historical';
    pub.electionDate = source.asOf || null;
    pub.office = 'Head of government';
    pub.electionType = 'Government composition (ParlGov)';
    pub.country = scope || '';
  }
  if (['ingestion', 'catalog'].includes(source.kind) && source.publication) {
    const supplied = source.publication;
    for (const key of ['electionId', 'country', 'office', 'electionType', 'round', 'electionDate', 'purpose', 'status', 'counted', 'updatedAt']) {
      if (supplied[key] !== undefined) pub[key] = supplied[key];
    }
    pub.ready = false; pub.approvalFingerprint = null;
  }
  return pub;
}

/* ------------------------------------------------------------------ files */

/** Validate a stored publication object; returns an error string or null. */
export function publicationError(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return 'publication metadata';
  const str = (k) => p[k] == null || typeof p[k] === 'string';
  for (const k of ['electionId', 'country', 'office', 'electionType', 'electionDate', 'updatedAt', 'note']) {
    if (!str(k)) return `publication ${k}`;
  }
  if (p.electionDate != null && (!/^\d{4}-\d{2}-\d{2}$/.test(p.electionDate) ||
      !Number.isFinite(Date.parse(p.electionDate)) || new Date(p.electionDate).toISOString().slice(0, 10) !== p.electionDate)) return 'publication electionDate';
  if (p.updatedAt != null && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(p.updatedAt) || !Number.isFinite(Date.parse(p.updatedAt)))) return 'publication updatedAt';
  if (p.timeInputOffset != null && !validOffset(p.timeInputOffset)) return 'publication timeInputOffset';
  if (p.captionDraft != null && typeof p.captionDraft !== 'string') return 'publication captionDraft';
  if (p.captionBasis != null && typeof p.captionBasis !== 'string') return 'publication captionBasis';
  if (p.approvalFingerprint != null && typeof p.approvalFingerprint !== 'string') return 'publication approvalFingerprint';
  if (p.status != null && !STATUSES.includes(p.status)) return 'publication status';
  if (p.purpose != null && !PURPOSES.includes(p.purpose)) return 'publication purpose';
  if (p.counted != null && (!Number.isFinite(p.counted) || p.counted < 0 || p.counted > 100)) return 'publication counted';
  if (p.round != null && !(Number.isInteger(p.round) && p.round > 0)) return 'publication round';
  if (typeof p.ready !== 'boolean') return 'publication ready';
  return null;
}
