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

/**
 * A cabinet does not stay in office because the archive stopped writing.
 *
 * Intervals here are derived: a cabinet's `to` is the next recorded cabinet's
 * `from`. That is correct while ParlGov has a continuous record and badly wrong
 * where it does not, because the last cabinet before a silence expands to fill
 * it. The archive already refuses to do this at the end of the release — an
 * open-ended final cabinet is "an artefact of the data stopping" — and the same
 * artefact occurs in the middle of a country's record.
 *
 * Generating 1945–2023 as a run is what made it visible. A single 1977 map
 * never touches it; seventy-nine frames put the 1940s on screen, and the
 * archive was asserting that the NSDAP governed Germany until September 1949
 * and that a chancellor assassinated in 1934 governed Austria until 1945. Those
 * are not warnings-level errors. They are the single worst thing this project
 * could publish.
 *
 * MAX_CABINET_YEARS is measured, not chosen: across all 1,584 derived intervals
 * in the release, the longest that is genuinely one cabinet is Canada's Borden
 * ministry at 6.0 years, and every interval longer than that is a gap in the
 * record — Germany 16.6, Austria 12.9, Norway 8.7, Finland 7.5, Malta 7.0,
 * Denmark 6.1. The threshold sits exactly where the data separates, and the
 * separation is tight enough that it is worth stating rather than hiding: see
 * `docs/archive-gaps.md` for the cases that remain wrong below it.
 *
 * Beyond the cap the answer is "no record", which the map already knows how to
 * say — the country goes uncovered and the coverage count drops. That is a
 * true statement about ParlGov, and a blank country is a far smaller error
 * than a confidently coloured wrong one.
 */
export const MAX_CABINET_YEARS = 6;
const MS_PER_YEAR = 365.2425 * 24 * 60 * 60 * 1000;

export function cabinetRecordOn(iso3, date) {
  if (!governing) return { cabinet: null, reason: 'archive not loaded' };
  const c = governing.countries[iso3];
  if (!c) return { cabinet: null, reason: 'country not in the archive' };

  for (let i = c.intervals.length - 1; i >= 0; i--) {
    const iv = c.intervals[i];
    if (iv.from > date || !(iv.to === null || date < iv.to)) continue;

    if (iv.to === null && date > lastCoveredDate()) {
      return { cabinet: null, reason: 'beyond the end of this release' };
    }

    const held = (new Date(date) - new Date(iv.from)) / MS_PER_YEAR;
    if (held > MAX_CABINET_YEARS) {
      return {
        cabinet: null,
        reason: 'record gap',
        gap: {
          country: c.name,
          lastCabinet: iv.name,
          since: iv.from,
          nextRecorded: iv.to,
          years: Math.round(held * 10) / 10
        }
      };
    }
    return { cabinet: iv, reason: null };
  }
  return { cabinet: null, reason: 'no cabinet recorded' };
}

/**
 * The release's own end. Past this, an open-ended final cabinet is an artefact
 * of the data stopping, not evidence that the cabinet is still in office.
 */
let lastDate = null;
export function lastCoveredDate() {
  if (lastDate) return lastDate;
  let max = '';
  for (const c of Object.values(governing.countries)) {
    for (const iv of c.intervals) if (iv.from > max) max = iv.from;
  }
  lastDate = max;
  return max;
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
