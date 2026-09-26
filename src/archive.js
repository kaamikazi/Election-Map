/**
 * The historical archive: who governed where, and when.
 *
 * governing.json holds, per country, a list of cabinets as date intervals.
 * Answering "which party governed country X on date Y" is a lookup, not a
 * search — and a country with no interval covering Y has no answer, which the
 * map must show as unassigned rather than carrying an earlier year forward.
 */

const GOVERNING_URL = 'data/governing.json';
const INDEX_URL = 'data/elections/index.json';

let governing = null;
let electionIndex = null;

export async function loadGoverning() {
  if (governing) return governing;
  const res = await fetch(GOVERNING_URL);
  if (!res.ok) throw new Error('Could not load ' + GOVERNING_URL + ' (' + res.status + ')');
  governing = await res.json();
  return governing;
}

export async function loadElectionIndex() {
  if (electionIndex) return electionIndex;
  const res = await fetch(INDEX_URL);
  if (!res.ok) throw new Error('Could not load ' + INDEX_URL + ' (' + res.status + ')');
  electionIndex = await res.json();
  return electionIndex;
}

/** One country's full election history, fetched on demand. */
export async function loadCountry(iso3) {
  const index = await loadElectionIndex();
  const entry = index.countries[iso3];
  if (!entry) return null;
  const res = await fetch(entry.file);
  if (!res.ok) throw new Error('Could not load ' + entry.file + ' (' + res.status + ')');
  return res.json();
}

export const source = () => (governing ? governing.source : null);

/**
 * The cabinet in office in `iso3` on `date` (an ISO yyyy-mm-dd string).
 *
 * Intervals are half-open: a cabinet covers [from, to). The last cabinet in a
 * country has `to: null`, which means "still in office as far as this release
 * knows" — the release ends in 2023, so a date after that is honestly beyond
 * the archive and gets nothing.
 */
export function cabinetOn(iso3, date) {
  return cabinetRecordOn(iso3, date).cabinet;
}

/** Recorded intervals and explicit coverage gaps are distinct answers. */
export function cabinetRecordOn(iso3, date) {
  if (!governing) return { cabinet: null, reason: 'archive not loaded' };
  const c = governing.countries[iso3];
  if (!c) return { cabinet: null, reason: 'country not in the archive' };
  if (date > lastCoveredDate()) return { cabinet: null, reason: 'beyond the end of this release' };
  for (let i = c.intervals.length - 1; i >= 0; i--) {
    const iv = c.intervals[i];
    if (date < iv.from) continue;
    if (iv.coverage && date >= iv.to && date < iv.recordedTo) {
      return { cabinet: null, reason: 'record gap', gap: {
        country: c.name, lastCabinet: iv.name, since: iv.to,
        nextRecorded: iv.recordedTo, basis: iv.coverage.basis,
        detail: iv.coverage.reason, evidence: iv.coverage.evidence,
        years: Math.round((Date.parse(date) - Date.parse(iv.to)) / 86400000 / 365.2425 * 10) / 10
      } };
    }
    if (iv.to === null || date < iv.to) return { cabinet: iv, reason: null };
  }
  return { cabinet: null, reason: 'no cabinet recorded' };
}

/** Last dated observation: a conservative publication cutoff, not proof of
 * every country's continuity to that date. See docs/archive-gaps.md. */
export function lastCoveredDate() {
  if (!governing) return null;
  return governing.coverageThrough || Object.values(governing.countries)
    .flatMap((c) => c.intervals).map((iv) => iv.from).sort().at(-1);
}

/** Every country in the archive, with the map feature name it resolves to. */
export function countries() {
  if (!governing) return [];
  return Object.entries(governing.countries).map(([iso3, c]) => ({
    iso3, name: c.name, mapName: c.map_name, cabinets: c.intervals.length
  }));
}

/**
 * Who governed everywhere on one date.
 * @returns {{covered: Array, uncovered: Array, total: number, date: string}}
 */
export function governingOn(date) {
  const covered = [], uncovered = [], gaps = [];
  for (const c of countries()) {
    const rec = cabinetRecordOn(c.iso3, date);
    const cab = rec.cabinet;
    const pm = cab ? cab.parties.find((p) => p.pm) : null;
    if (cab && pm) { covered.push({ ...c, cabinet: cab, pm }); continue; }

    // A country left out because the record has a hole in it is a different
    // thing from one the archive never covered, and a run that reports coverage
    // honestly has to be able to tell them apart.
    if (rec.gap) gaps.push({ ...c, ...rec.gap });
    uncovered.push({
      ...c,
      reason: cab ? 'no party in the prime minister role' : (rec.reason || 'no cabinet recorded')
    });
  }
  return { covered, uncovered, gaps, total: covered.length + uncovered.length, date };
}
