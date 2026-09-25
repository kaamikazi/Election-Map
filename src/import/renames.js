/**
 * Documented official renames, and the words that name an administrative level.
 *
 * This is used by the partition probe only, and deliberately not by the
 * matcher that decides which unit a row colours.
 *
 * WHY THE PROBE MAY LOOSEN AND THE MATCHER MAY NOT — BLAST RADIUS.
 *
 * A wrong match colours territory. It puts a party in a region that did not
 * elect it, and the map carries no sign that anything went wrong.
 *
 * A wrong probe mislabels a footnote. It says a unit excludes something it does
 * not, next to a map that is otherwise correct, in a line a reader can check
 * against the source.
 *
 * Those are different consequences, so they get different rules. That is the
 * whole argument. It is *not* that the probe has a second opinion to lean on:
 * containment is a weak check, because a wrongly-resolved name that happens to
 * sit inside the same parent passes it without complaint. Do not take the
 * containment step as licence to relax the matcher — nothing here transfers.
 *
 * Every probe resolution is logged (see partition.js) so a wrong one can be
 * found after the fact rather than staying invisible.
 *
 * Every entry below is a gazetted change, checked against the districts' own
 * articles, not a guess at a spelling.
 */

/** Both spellings of a place, so a source using either resolves. */
export const RENAMES = {
  BGD: [
    // Bangladesh regularised the romanisation of several districts in 2018.
    { a: 'Cumilla', b: 'Comilla', since: 2018 },
    { a: 'Chattogram', b: 'Chittagong', since: 2018 },
    { a: 'Barishal', b: 'Barisal', since: 2018 },
    { a: 'Jashore', b: 'Jessore', since: 2018 },
    { a: 'Bogura', b: 'Bogra', since: 2018 },
    { a: 'Cox\'s Bazar', b: 'Coxs Bazar', since: null },
    { a: 'Netrokona', b: 'Netrakona', since: null },
    { a: 'Brahmanbaria', b: 'Brahamanbaria', since: null }
  ]
};

/**
 * Words that name a level rather than a place. "Cumilla Division" and
 * "Cumilla" are the same region written by two people; the suffix carries no
 * information inside a layer that is entirely one level.
 */
const LEVEL_WORDS = new RegExp(
  '\\s+(' + [
    'division', 'district', 'region', 'province', 'county', 'state', 'zila',
    'zilla', 'upazila', 'prefecture', 'department', 'governorate', 'oblast',
    'voivodeship', 'canton', 'parish', 'municipality', 'constituency'
  ].join('|') + ')$', 'i');

/**
 * Every spelling worth trying for one raw name, most faithful first.
 * @param {string} iso3
 * @param {string} raw
 */
export function probeNames(iso3, raw) {
  const text = String(raw || '').trim();
  if (!text) return [];

  const out = [text];
  const bare = text.replace(LEVEL_WORDS, '').trim();
  if (bare && bare !== text) out.push(bare);

  const table = RENAMES[String(iso3 || '').toUpperCase()] || [];
  for (const base of [...out]) {
    for (const pair of table) {
      if (equal(base, pair.a)) out.push(pair.b);
      else if (equal(base, pair.b)) out.push(pair.a);
    }
  }
  return [...new Set(out)];
}

const equal = (x, y) => String(x).toLowerCase() === String(y).toLowerCase();

/** A name without its level word: "Cumilla Division" -> "Cumilla". */
export const bareName = (raw) => String(raw || '').trim().replace(LEVEL_WORDS, '').trim();
