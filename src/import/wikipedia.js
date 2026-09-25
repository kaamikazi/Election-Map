/**
 * Wikipedia as a source of election results.
 *
 * Three problems, in order of how much damage they do when they go wrong:
 *
 * 1. Finding the article. Titles are not constructible. "2024 Bangladeshi
 *    general election" uses an irregular demonym, India numbers its Lok Sabha
 *    ordinally, and "general" / "parliamentary" / "legislative" are not
 *    interchangeable. So: search, and let a person pick from real hits.
 * 2. Picking the table. An election article holds an infobox, opinion polling,
 *    a timeline, national results, results by region and sometimes a
 *    constituency list. The Bangladesh 2024 article has twenty-four tables,
 *    ten of which are per-division results that look almost exactly like the
 *    national one. Picking wrong produces a confident, entirely false map, so
 *    the choice is always shown and never taken silently.
 * 3. Reading the table. Ragged rows, merged cells, footnote markers inside
 *    numbers, alliance rows above their component parties. The milestone 4
 *    number parser handles most of it; the rest is fixtures, not heuristics.
 */

import { parseNumber } from './parse.js';
import { ALIAS } from '../state.js';

/* ---------------------------------------------------------------- transport */

const api = (lang, params) =>
  `https://${lang}.wikipedia.org/w/api.php?${params}&format=json&formatversion=2&origin=*`;

/**
 * Swapped out by the test suite so nothing in the suite touches the network.
 * @type {(url: string) => Promise<object>}
 */
let transport = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Wikipedia returned ${res.status}`);
  return res.json();
};

export const setTransport = (fn) => { transport = fn; };

/** One request at a time, with a gap. A person drives this; that is easy to honour. */
let queue = Promise.resolve();
const POLITE_GAP_MS = 250;

function request(url) {
  const run = queue.then(async () => {
    const out = await transport(url);
    await new Promise((r) => setTimeout(r, POLITE_GAP_MS));
    return out;
  });
  queue = run.catch(() => {});
  return run;
}

/* ---------------------------------------------------------------- search */

export async function search(lang, query, limit = 6) {
  const json = await request(api(lang,
    `action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${limit}`));
  if (json.error) throw new Error(json.error.info || 'Search failed');
  return (json.query.search || []).map((hit) => ({
    title: hit.title,
    pageid: hit.pageid,
    snippet: String(hit.snippet || '').replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').trim()
  }));
}

/* ---------------------------------------------------------------- fetch */

/**
 * Articles keyed by revision, so re-running a year costs nothing. The cache
 * lives for the session: a parsed article is about a megabyte and localStorage
 * is not the place for it.
 */
const byRevid = new Map();
const byTitle = new Map();

export const cacheKeyFor = (lang, revid) => `${lang}:${revid}`;
export const cachedRevids = () => [...byRevid.keys()];

/**
 * A Wikipedia URL the person already had open, rather than a title.
 * @returns {{lang: string, title: string}|null}
 */
export function parseArticleUrl(input) {
  const text = String(input || '').trim();
  if (!/^https?:\/\//i.test(text)) return null;
  let url;
  try { url = new URL(text); } catch { return null; }

  const host = url.hostname.match(/^([a-z-]+)\.(m\.)?wikipedia\.org$/i);
  if (!host) return null;
  const lang = host[1].toLowerCase();

  const path = url.pathname.match(/^\/wiki\/(.+)$/);
  if (path) return { lang, title: decodeURIComponent(path[1]).replace(/_/g, ' ') };

  const titleParam = url.searchParams.get('title');
  if (titleParam) return { lang, title: titleParam.replace(/_/g, ' ') };
  return null;
}

/**
 * Fetch and parse one article.
 *
 * Records the revision id, not just the title, and builds the permanent link to
 * that exact revision. Wikipedia changes; a map that cites a title cites
 * something that can be different by the time anyone checks it.
 */
export async function fetchArticle(lang, title) {
  const cachedTitle = byTitle.get(`${lang}:${title}`);
  if (cachedTitle) return { ...byRevid.get(cachedTitle), fromCache: true };

  const json = await request(api(lang,
    'action=parse&prop=text%7Crevid%7Ccategories%7Cdisplaytitle&redirects=1' +
    `&page=${encodeURIComponent(title)}`));
  if (json.error) throw new Error(json.error.info || `Could not read "${title}"`);

  const article = fromParseResponse(lang, json);
  byRevid.set(cacheKeyFor(lang, article.revid), article);
  byTitle.set(`${lang}:${title}`, cacheKeyFor(lang, article.revid));
  byTitle.set(`${lang}:${article.title}`, cacheKeyFor(lang, article.revid));
  return { ...article, fromCache: false };
}

export function fromParseResponse(lang, json) {
  const p = json.parse;
  return {
    lang,
    title: p.title,
    revid: p.revid,
    html: p.text,
    categories: (p.categories || []).filter((c) => !c.hidden)
      .map((c) => String(c.category).replace(/_/g, ' ')),
    // The whole point: anyone can open exactly what was read.
    permalink: `https://${lang}.wikipedia.org/w/index.php?oldid=${p.revid}`,
    articleUrl: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
    fetchedAt: new Date().toISOString()
  };
}

/** Test seam: put a fixture into the cache as though it had been fetched. */
export function seedCache(lang, json) {
  const article = fromParseResponse(lang, json);
  byRevid.set(cacheKeyFor(lang, article.revid), article);
  byTitle.set(`${lang}:${article.title}`, cacheKeyFor(lang, article.revid));
  return article;
}

export const clearCache = () => { byRevid.clear(); byTitle.clear(); };

/* ---------------------------------------------------------------- tables */

const clean = (s) => String(s || '')
  .replace(/ /g, ' ')
  .replace(/\[[^\]]*\]/g, '')      // footnote markers
  .replace(/\s+/g, ' ')
  .trim();

/**
 * Every table in the article, as header names plus rows of cell text, with the
 * section heading it sits under.
 */
export function extractTables(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const out = [];

  // Walk headings and tables together in document order. Which heading a table
  // sits under is most of what decides whether it is a result or an opinion
  // poll, and climbing the DOM from the table does not survive the way
  // MediaWiki wraps sections.
  const sections = new Map();
  let heading = '';
  doc.querySelectorAll('h1,h2,h3,h4,h5,h6,table').forEach((node) => {
    if (/^H[1-6]$/.test(node.tagName)) {
      heading = clean(node.textContent).replace(/\[edit\]$/i, '').trim();
    } else {
      sections.set(node, heading);
    }
  });

  doc.querySelectorAll('table').forEach((el, index) => {
    const headerFlags = [];
    const rows = [...el.querySelectorAll('tr')].map((tr) => {
      const cells = [...tr.querySelectorAll('th,td')];
      // A row made entirely of <th> is a header row. Reading the markup beats
      // guessing from content: a list of members carries no numbers anywhere,
      // and a heuristic that looks for them eats the first row of data.
      headerFlags.push(cells.length > 0 && cells.every((c) => c.tagName === 'TH'));
      return cells.map((cell) => {
        const text = clean(cell.textContent);
        // A cell spanning columns is repeated, so later columns stay aligned.
        const span = Math.min(parseInt(cell.getAttribute('colspan') || '1', 10) || 1, 12);
        return Array(span).fill(text);
      }).flat();
    }).filter((r, i) => { if (!r.length) headerFlags[i] = null; return r.length; });
    const flags = headerFlags.filter((f) => f !== null);

    if (rows.length < 2) return;

    const headRows = headerRows(rows, flags);
    out.push({
      index,
      caption: clean(el.querySelector('caption') && el.querySelector('caption').textContent),
      section: sections.get(el) || sectionOf(el),
      className: el.className || '',
      headers: mergeHeaders(headRows),
      headerText: headRows.map((r) => r.join(' ')).join(' '),
      headerCount: headRows.length,
      rows
    });
  });

  return out;
}

/** The nearest heading above this table. */
function sectionOf(el) {
  let node = el;
  while (node) {
    const prev = node.previousElementSibling;
    if (!prev) { node = node.parentElement; continue; }
    node = prev;
    if (/^H[1-6]$/.test(node.tagName)) return clean(node.textContent).replace(/\[edit\]$/i, '').trim();
    const heading = node.querySelector && node.querySelector('h1,h2,h3,h4,h5,h6');
    if (heading) return clean(heading.textContent).replace(/\[edit\]$/i, '').trim();
  }
  return '';
}

/**
 * The leading rows that hold no numbers.
 *
 * Results tables stack them — "Seats" spanning four columns above "General",
 * "Women", "Total", "+/–" — and once colspan and rowspan are flattened they no
 * longer line up with the data beneath. They are still the best description of
 * what the table contains, so they are kept for scoring, and column roles are
 * worked out from the data instead.
 */
function headerRows(rows, flags) {
  // When the markup says which rows are headers, believe it.
  if (flags && flags.some(Boolean)) {
    const out = [];
    for (let i = 0; i < rows.length && i < 4; i++) {
      if (!flags[i]) break;
      if (rows[i].some((c) => c)) out.push(rows[i]);
    }
    if (out.length) return out;
  }

  const out = [];
  for (const row of rows.slice(0, 4)) {
    if (!row.some((c) => c)) continue;                          // spacer row
    if (row.some((c) => parseNumber(c).value != null)) break;   // data has started
    out.push(row);
    if (out.length === 3) break;
  }
  return out.length ? out : [rows[0]];
}

/** One label per column, for display. Misalignment is expected and harmless. */
function mergeHeaders(headRows) {
  const width = Math.max(...headRows.map((r) => r.length));
  const out = [];
  for (let i = 0; i < width; i++) {
    const parts = [...new Set(headRows.map((r) => r[i]).filter(Boolean))];
    out.push(parts.join(' '));
  }
  return out;
}

/* ---------------------------------------------------------------- scoring */

/*
 * Keywords in the languages this stage is aimed at. The English Wikipedia is
 * often the worse article for exactly the countries here, so the local wiki has
 * to work too.
 */
const WORDS = {
  party: /\b(party|parties|partij|partai|parti|partido|partito|partei|parties|dal|partia|strana)\b/i,
  votes: /\b(votes?|suara|voix|votos|voti|stimmen|hlas|głos|ভোট)\b/i,
  percent: /(%|percent|persen|pourcentage|por ?ciento)/i,
  seats: /\b(seats?|kursi|sièges|escaños|seggi|sitze|mandát|mandat|mandaty|আসন)\b/i,
  change: /(\+\/[-−–]|change|perubahan|\bswing\b|[+-]\/[-−–])/i,
  total: /\b(total|totals|jumlah|gesamt|celkem|razem)\b/i
};

const RESULT_SECTION = /\b(results?|hasil|résultats?|resultados?|risultati|ergebnisse|výsledky|wyniki|ফলাফল)\b/i;
const POLL_SECTION = /\b(poll|polling|opinion|survei|jajak|sondage|encuesta|umfrage|pr[uů]zkum)\b/i;
const SUBDIVISION = /\b(division|province|provinsi|region|state|district|county|departamento|kraj|by (division|region|state|province|constituency))\b/i;
const PRIMARY = /\b(primary|primaries|caucus|nomination|pendahuluan)\b/i;
const CONSTITUENCY = /\b(constituency|constituencies|seat[- ]by[- ]seat|winner|runner[- ]?up|daerah pemilihan)\b/i;

/**
 * Score one table on how much it looks like a national results table.
 * @returns {{score: number, reasons: string[]}}
 */
export function scoreTable(table) {
  const header = table.headerText || table.headers.join(' | ');
  const context = `${table.caption} ${table.section}`;
  const reasons = [];
  let score = 0;

  const add = (n, why) => { score += n; if (why) reasons.push(why); };

  if (WORDS.party.test(header)) add(3, 'names a party column');
  if (WORDS.votes.test(header)) add(2, 'names a votes column');
  if (WORDS.percent.test(header)) add(1, 'has a percentage column');
  if (WORDS.seats.test(header)) add(3, 'names a seats column');
  if (WORDS.change.test(header)) add(1, 'has a change column');
  if (RESULT_SECTION.test(context)) add(3, 'sits under a results heading');

  // Per-region tables are the trap: they look exactly like the national one.
  if (SUBDIVISION.test(context)) add(-4, 'looks like one region, not the whole country');
  if (CONSTITUENCY.test(header) || CONSTITUENCY.test(context)) add(-3, 'looks seat-by-seat');
  if (POLL_SECTION.test(context)) add(-6, 'sits under opinion polling');
  // A party choosing its own candidate is not the election.
  if (PRIMARY.test(context)) add(-6, 'is a party primary, not the election');
  if (/wikitable/.test(table.className)) add(1, null);
  if (table.rows.length < 3) add(-2, 'too few rows to be a result');
  if (table.rows.length > 120) add(-2, 'far too many rows for a national result');

  return { score, reasons };
}

/**
 * Candidate tables, best first, each with why it scored.
 * Anything below the floor is not offered as a result at all.
 */
export const SCORE_FLOOR = 5;

export function rankTables(tables, context = {}) {
  return tables
    .map((t) => {
      const scored = { table: t, ...scoreTable(t) };
      const hit = unitHitRate(t, context.index);
      if (hit.rate >= 0.5) {
        // Measured, not guessed. A table whose rows are the map's own units is
        // a results table for this layer whatever its headers happen to say —
        // and a list of members has no votes, no seats and no percentage
        // column, so keyword scoring alone throws it away.
        scored.score += 10;
        scored.reasons.unshift(
          `${hit.matched} of its ${hit.rows} rows name a unit on this map`);
        scored.unitRows = hit.matched;
      }
      return scored;
    })
    .sort((a, b) => b.score - a.score || a.table.index - b.table.index);
}

/** How much of a table's first text column is made of this layer's units. */
function unitHitRate(table, index) {
  if (!index || !index.loose || !index.loose.size) return { rate: 0, matched: 0, rows: 0 };

  const body = table.rows.slice(table.headerCount || 1).filter((r) => r.some((c) => c));
  if (body.length < 5) return { rate: 0, matched: 0, rows: body.length };

  // Try each of the first few columns; a table often opens with a number.
  let best = 0;
  for (let col = 0; col < Math.min(3, body[0].length); col++) {
    let hits = 0;
    for (const row of body) {
      const cell = normaliseName(row[col]);
      if (cell && index.loose.has(cell)) hits++;
    }
    best = Math.max(best, hits);
  }
  return { rate: best / body.length, matched: best, rows: body.length };
}

/** The same normalisation the matcher uses, kept local to avoid a cycle. */
const normaliseName = (s) => String(s == null ? '' : s)
  .normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .replace(/\([^)]*\)\s*$/, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

/* ---------------------------------------------------------------- reading */

/**
 * Rows that describe the table rather than contest the election. Letting one of
 * these through is the worst failure available here: "Registered voters/Turnout"
 * read as the winning party produces a map that is confident and false.
 */
const SUMMARY_ROW = new RegExp('^(' + [
  'total', 'totals', 'sum', 'source', 'sources', 'note', 'notes', 'majority',
  'turnout', 'registered voters', 'valid votes', 'invalid', 'blank', 'rejected',
  'abstention', 'abstentions', 'electorate', 'votes cast', 'grand total',
  'jumlah', 'sumber', 'catatan', 'suara sah', 'suara tidak sah',
  'celkem', 'razem', 'gesamt', 'insgesamt'
].join('|') + ')\\b', 'i');

/**
 * Read a national results table down to the one thing a country-level map
 * needs: who won, and by how much.
 *
 * Columns are worked out from the data, not from the headers. Real results
 * tables stack headers two deep and span them across four columns, so once the
 * HTML is flattened the header row no longer lines up with anything. The data
 * is unambiguous: one column is consistently names, the rest are consistently
 * numbers.
 *
 * @returns {{party, vote, seats, margin, runnerUp, entries}|null}
 */
export function summarise(table) {
  const body = table.rows.slice(table.headerCount || 1)
    .filter((row) => row.some((c) => c));
  if (body.length < 2) return null;

  const width = Math.max(...body.map((r) => r.length));
  const isNum = (c) => cellNumber(c) != null;

  // The party column: the one that holds names in most rows, leftmost wins.
  let partyCol = -1, bestNames = 0;
  for (let i = 0; i < width; i++) {
    const names = body.filter((r) => r[i] && !isNum(r[i])).length;
    if (names > bestNames) { bestNames = names; partyCol = i; }
  }
  if (partyCol < 0 || bestNames < 2) return null;

  const contestants = body.filter((r) => {
    const name = clean(r[partyCol]);
    return name && !SUMMARY_ROW.test(name) && !isNum(name);
  });
  if (contestants.length < 2) return null;

  // Numeric columns, described by whatever the headers managed to say and by
  // what the numbers themselves look like.
  const numericCols = [];
  for (let i = 0; i < width; i++) {
    if (i === partyCol) continue;
    const values = contestants.map((r) => cellNumber(r[i]));
    const known = values.filter((v) => v != null);
    if (known.length < contestants.length * 0.6) continue;
    // A numbered list down the left is an index, not a result. On the
    // Indonesian article it runs 1..24 and outranks nothing, but it is whole
    // numbers in a plausible range and would otherwise read as seats.
    if (isIndexColumn(values)) continue;
    numericCols.push({
      i,
      values,
      sum: known.reduce((n, v) => n + v, 0),
      max: Math.max(...known),
      anyNegative: known.some((v) => v < 0),
      header: table.headers[i] || ''
    });
  }
  if (!numericCols.length) return null;

  // A change column swings both ways; it is never a count or a share.
  const usable = numericCols.filter((c) => !c.anyNegative && !WORDS.change.test(c.header));
  if (!usable.length) return null;

  // A column of values that sum to about a hundred is a percentage.
  const pctCol = usable.find((c) => c.sum > 85 && c.sum < 115 && c.max <= 100)
    || usable.find((c) => WORDS.percent.test(c.header) && c.max <= 100);

  // Seats: whole numbers, and the largest such total — which on a stacked
  // header picks the "Total" column over "General" and "Women".
  const seatCandidates = usable
    .filter((c) => c !== pctCol && c.values.every((v) => v == null || Number.isInteger(v)))
    .filter((c) => c.max <= 2000);
  const seatCol = seatCandidates.sort((a, b) => b.sum - a.sum)[0] || null;

  // Votes: the big counts, if the table carries them.
  const voteCol = usable.find((c) => c !== pctCol && c !== seatCol && c.max > 2000) || null;

  const rankCol = seatCol || voteCol || pctCol;
  if (!rankCol) return null;

  const entries = contestants.map((r) => ({
    name: clean(r[partyCol]),
    seats: seatCol ? cellNumber(r[seatCol.i]) : null,
    votes: voteCol ? cellNumber(r[voteCol.i]) : null,
    pct: pctCol ? cellNumber(r[pctCol.i]) : null,
    rank: cellNumber(r[rankCol.i])
  })).filter((e) => e.rank != null);

  if (entries.length < 2) return null;

  const sorted = entries.slice().sort((a, b) => b.rank - a.rank);
  const winner = sorted[0];
  const runnerUp = sorted[1];

  const voteTotal = voteCol ? entries.reduce((n, e) => n + (e.votes || 0), 0) : 0;
  const seatTotal = seatCol ? entries.reduce((n, e) => n + (e.seats || 0), 0) : 0;

  const sharePct = (e) => {
    if (e.pct != null) return e.pct;
    if (e.votes != null && voteTotal > 0) return round1(e.votes / voteTotal * 100);
    return null;
  };

  const vote = sharePct(winner);
  const runnerVote = sharePct(runnerUp);

  return {
    party: winner.name,
    vote,
    seats: winner.seats != null && seatTotal > 0 ? round1(winner.seats / seatTotal * 100) : null,
    // Only ever in the same unit as the share it came from; no share, no margin.
    margin: vote != null && runnerVote != null ? round1(vote - runnerVote) : null,
    runnerUp: runnerUp.name,
    seatCount: winner.seats,
    seatTotal: seatTotal || null,
    entries
  };
}

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * One cell as a number.
 *
 * Some wikis render a seat count through a bar template that comes out as
 * "110 / 580". The count is the first half; the second is the size of the
 * chamber, and reading the pair as one number gets nothing.
 */
function cellNumber(text) {
  const s = String(text == null ? '' : text);
  const fraction = s.match(/^\s*(\d[\d.,\s\u00a0]*?)\s*\/\s*\d/);
  return parseNumber(fraction ? fraction[1] : s).value;
}

function isIndexColumn(values) {
  const present = values.filter((v) => v != null);
  if (present.length < 3 || present.length !== values.length) return false;
  if (!present.every(Number.isInteger)) return false;
  return present.every((v, i) => v === i + 1);
}

/** Turnout, when the infobox states it. Null rather than a guess. */
export function findTurnout(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const box = doc.querySelector('table.infobox, table.infobox.vevent') || doc;
  const rows = [...box.querySelectorAll('tr')];
  for (const tr of rows) {
    const label = clean(tr.querySelector('th') && tr.querySelector('th').textContent);
    if (!/\b(turnout|partisipasi|kehadiran|participation|afluencia|wahlbeteiligung|účast|frekwencja)\b/i.test(label)) continue;
    const text = clean(tr.textContent).replace(label, '');
    const m = text.match(/(\d+[.,]?\d*)\s*%/);
    if (m) return parseNumber(m[1]).value;
  }
  return null;
}

/* ---------------------------------------------------------------- country */

/**
 * Which country the article is about, taken from its categories.
 *
 * Categories name the country in the article's own language — "General
 * elections in Bangladesh", "Pemilihan umum di Indonesia tahun 2024" — so this
 * looks for a unit name appearing inside them rather than parsing an English
 * phrase. A unit named by two or more categories is the answer; anything less
 * certain is left for the person to confirm, which is what the review step is.
 *
 * @param {string[]} categories
 * @param {string[]} unitNames
 */
export function countryFromCategories(categories, unitNames, aliases = ALIAS) {
  const units = new Set(unitNames);

  // Every spelling that identifies a unit: the name the map uses, plus the
  // long forms in the alias table. The map calls it "Dem. Rep. Congo"; every
  // category calls it "Democratic Republic of the Congo".
  const candidates = [];
  for (const name of unitNames) {
    if (name.length >= 4) candidates.push({ text: name, unit: name });
  }
  for (const [text, unit] of Object.entries(aliases || {})) {
    if (text.length >= 5 && units.has(unit)) candidates.push({ text, unit });
  }

  const counts = new Map();
  for (const category of categories) {
    const hits = candidates.filter((c) => containsWord(category, c.text));
    // "Congo" is inside "Democratic Republic of the Congo", and they are two
    // different countries that the map holds separately. Only the longest
    // spelling in a category counts; a name swallowed by a longer one is not
    // evidence for anything.
    const maximal = hits.filter((c) =>
      !hits.some((other) => other !== c && other.text.length > c.text.length &&
        containsWord(other.text, c.text)));

    for (const unit of new Set(maximal.map((c) => c.unit))) {
      counts.set(unit, (counts.get(unit) || 0) + 1);
    }
  }
  if (!counts.size) return null;

  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  if (ranked[0][1] < 2) return null;                         // one mention is not enough
  if (ranked[1] && ranked[1][1] === ranked[0][1]) return null; // a tie is not an answer
  return ranked[0][0];
}

/** Whole-word, accent- and case-insensitive containment. */
function containsWord(haystack, needle) {
  const flat = (s) => ' ' + String(s).normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
  return flat(haystack).includes(flat(needle));
}
