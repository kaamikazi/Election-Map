/**
 * Boundaries have a date, and it is not the election's date.
 *
 * Natural Earth ships present-day borders. This archive reaches back to 1900.
 * At world level the map half survives that, because a world outline reads as a
 * schematic. At province level it stops being survivable: modern German states
 * do not describe 1977, and a reader who knows that will say so — correctly.
 *
 * This does not attempt a history of borders. It is a short list of the changes
 * big enough that drawing over them is a visible error, which is enough to
 * catch most of what anyone would actually post. The right response to a hit is
 * a warning, not a refusal: the person may know exactly what they are doing.
 */

/**
 * Each entry: the units it concerns, the date before which today's boundaries
 * misrepresent them, and what a reader would notice.
 */
export const BOUNDARY_CHANGES = [
  {
    id: 'germany',
    until: '1990-10-03',
    units: ['Germany'],
    what: 'Germany was two states until reunification on 3 October 1990; today\'s outline shows one.'
  },
  {
    id: 'ussr',
    until: '1991-12-26',
    units: ['Russia', 'Ukraine', 'Belarus', 'Kazakhstan', 'Uzbekistan', 'Estonia', 'Latvia',
            'Lithuania', 'Georgia', 'Armenia', 'Azerbaijan', 'Moldova', 'Kyrgyzstan',
            'Tajikistan', 'Turkmenistan'],
    what: 'These were republics of the Soviet Union until December 1991, not separate states.'
  },
  {
    id: 'yugoslavia',
    until: '1992-04-27',
    units: ['Serbia', 'Croatia', 'Slovenia', 'Bosnia and Herz.', 'Macedonia', 'Montenegro', 'Kosovo'],
    what: 'These were republics of Yugoslavia until 1991–92; Montenegro until 2006 and Kosovo until 2008.'
  },
  {
    id: 'czechoslovakia',
    until: '1993-01-01',
    units: ['Czechia', 'Slovakia'],
    what: 'Czechia and Slovakia were one state, Czechoslovakia, until 1 January 1993.'
  },
  {
    id: 'sudan',
    until: '2011-07-09',
    units: ['Sudan', 'S. Sudan'],
    what: 'South Sudan separated from Sudan on 9 July 2011; before that the border did not exist.'
  },
  {
    id: 'eritrea',
    until: '1993-05-24',
    units: ['Ethiopia', 'Eritrea'],
    what: 'Eritrea was part of Ethiopia until May 1993.'
  },
  {
    id: 'yemen',
    until: '1990-05-22',
    units: ['Yemen'],
    what: 'North and South Yemen were separate states until May 1990.'
  }
];

/**
 * Which of these a map runs into.
 *
 * The registry says what year a boundary set represents; this table says when a
 * country's borders actually changed. They do different jobs, and the warning
 * is sharper for having both: not "these borders may be wrong" but "you are
 * drawing 1977 on boundaries that represent 2015".
 *
 * @param {string|null} asOf   the document's date, ISO yyyy-mm-dd
 * @param {string[]} unitNames names of the units in frame
 * @param {object|null} boundary the registry entry for the active layer
 * @returns {{id, what, units: string[], drawnOn: number|null}[]}
 */
export function boundaryWarnings(asOf, unitNames, boundary = null) {
  if (!asOf) return [];
  const present = new Set(unitNames);
  const drawnOn = boundary && boundary.vintage ? boundary.vintage : null;
  const out = [];
  for (const change of BOUNDARY_CHANGES) {
    if (asOf >= change.until) continue;
    const hit = change.units.filter((u) => present.has(u));
    if (!hit.length) continue;
    const when = String(asOf).slice(0, 4);
    const on = drawnOn ? `boundaries representing ${drawnOn}` : 'present-day boundaries';
    out.push({
      id: change.id,
      units: hit,
      drawnOn,
      what: `${change.what} This map is dated ${when} and is drawn on ${on}.`
    });
  }
  return out;
}

/**
 * What the map is drawn on: the source, the year it represents, and its licence.
 * Empty when there is nothing to state — the world outline is a schematic.
 *
 * The year comes from the boundary's own metadata. The previous version of this
 * printed "present-day boundaries" for everything, which was not true of
 * Bangladesh and could not have told you which other countries it was not true
 * of either.
 */
export function vintageLine(boundary) {
  if (!boundary) return '';
  const bits = [];
  const what = boundary.label ? boundary.label.toLowerCase() : boundary.level;
  bits.push(`Boundaries: ${boundary.sourceAgency} ${what}`);
  bits.push(boundary.vintage ? `representing ${boundary.vintage}` : 'year not stated');
  if (boundary.licence) bits.push(boundary.licence);
  return bits.join(' · ');
}

/**
 * One attribution line per distinct licence in play.
 *
 * The open releases mix CC0, CC BY and ODbL depending on the country and even
 * on the level — Bangladesh's divisions are CC0 and its districts are CC BY 3.0
 * IGO — so there is no single line that covers a map. Share-alike terms in
 * particular are not interchangeable with attribution-only ones.
 */
export function attributionLines(boundaries) {
  const seen = new Map();
  for (const b of boundaries) {
    if (!b || !b.attribution) continue;
    if (!seen.has(b.attribution)) seen.set(b.attribution, b);
  }
  return [...seen.keys()];
}

/* ------------------------------------------------- results against boundaries */

/**
 * A gap between when the results happened and what year the lines represent.
 *
 * BOUNDARY_CHANGES above is a hand-written list of country-level changes big
 * enough to name. Nothing like that list can exist below the country: the
 * United Kingdom redrew all 650 of its constituencies for 2024, Bangladesh
 * renamed and re-cut districts, and there is no table of named events that
 * would catch either. What is available instead is arithmetic — the registry
 * records what year each boundary set represents, and a document records when
 * its results happened — and at constituency scale that arithmetic is the whole
 * warning. 2019 results on the 2024 seats are not slightly wrong in a few
 * places; every unit on the map is a different area from the one that voted.
 *
 * It fires in both directions, because old lines under new results are the same
 * error seen from the other end, and that is the more common way to make it.
 * A gap of a year or less is inside the noise of how a boundary set is dated —
 * the ONS set is "July 2024" and the election was 4 July 2024 — so it is quiet.
 *
 * A boundary with no stated vintage produces nothing. That is not the same as
 * no gap and the footer already says "year not stated"; inventing a comparison
 * against a year nobody recorded would be a guess wearing a warning's clothes.
 *
 * @param {string|null} asOf the document's date, ISO yyyy-mm-dd
 * @param {object|null} boundary the registry entry for the active layer
 * @returns {{kind: string, gap: number, text: string}|null}
 */
export const VINTAGE_GRACE_YEARS = 1;

export function resultsVintageWarning(asOf, boundary) {
  if (!asOf || !boundary || !boundary.vintage) return null;
  const year = Number(String(asOf).slice(0, 4));
  if (!Number.isFinite(year)) return null;

  const drawn = Number(boundary.vintage);
  const gap = drawn - year;
  if (Math.abs(gap) <= VINTAGE_GRACE_YEARS) return null;

  const noun = (boundary.label || boundary.level || 'unit').toLowerCase();
  const plural = noun.endsWith('y') ? noun.slice(0, -1) + 'ies' : noun + 's';
  // Below the country, a boundary set's year is a redistribution year; above it,
  // the same gap is likelier to mean a handful of borders moved.
  const churn = boundary.level && boundary.level !== 'ADM0'
    ? `${plural} are redrawn between elections`
    : 'boundaries may have moved in between';

  return gap > 0
    ? {
      kind: 'vintage-old-results',
      gap,
      text: `These results are from ${year} and the ${plural} on screen represent ${drawn} — ` +
            `${churn}, so some units here may not be the ones that voted.`
    }
    : {
      kind: 'vintage-old-boundaries',
      gap,
      text: `These results are from ${year} and the ${plural} on screen represent ${drawn} — ` +
            `${churn}, so some units that voted may not be on this map.`
    };
}
