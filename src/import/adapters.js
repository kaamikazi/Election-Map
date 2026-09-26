/**
 * Source adapters.
 *
 * An adapter turns some input into a draft:
 *
 *   { source, rows, columns, index, scope, unitNames }
 *
 * and declares the fields it needs as data, so the review screen can render
 * them without knowing what the adapter is. That is the whole point: the
 * Wikipedia fetcher is a third entry in this file and a `propose` that calls
 * the MediaWiki API — no new screen, no second apply path, no second place
 * where a wrong name can slip through.
 */

import { state, REGIONS } from '../state.js';
import { FEATS, BY_KEY, LAYER, WORLD, BOUNDARY, unitList } from '../geo.js';
import { parseTable, guessColumns } from './parse.js';
import { buildIndex, scopeKey } from './match.js';
import { familyColor, familyLabel, UNFAMILIED } from '../families.js';
import { loadGoverning, governingOn, lastCoveredDate, source as archiveSource } from '../archive.js';
import {
  search, fetchArticle, parseArticleUrl, extractTables, rankTables, summarise,
  findTurnout, countryFromCategories, SCORE_FLOOR
} from './wikipedia.js';

/** Whatever layer is on screen — the world's countries, or one country's units. */
function activeLayer() {
  const units = unitList();
  return {
    units,
    names: units.map((u) => u.name),
    index: buildIndex(units),
    scope: scopeKey(LAYER)
  };
}

/* ---------------------------------------------------------------- clipboard */

const clipboard = {
  id: 'clipboard',
  label: 'Paste a table',
  hint: 'Paste TSV or CSV. For numeric cells: blank keeps values only in same-dataset updates; 0 is a value; [clear] deletes a value.',
  inputs: [
    {
      name: 'text',
      type: 'textarea',
      label: 'Table',
      placeholder: 'Region\tParty\tVotes\tSeats\nPraha\tSpolu\t28,4\t12'
    },
    { name: 'sourceLabel', type: 'text', label: 'Source', placeholder: 'Reviewed source name' },
    { name: 'sourceUrl', type: 'text', label: 'Source URL', placeholder: 'Exact results page or revision' },
    { name: 'datasetId', type: 'text', label: 'Dataset identity', placeholder: 'Country · full date · office/type · round (optional)' }
  ],

  propose({ text, sourceLabel, sourceUrl, datasetId }) {
    const { rows, delimiter } = parseTable(text);
    if (!rows.length) throw new Error('There is nothing to read in that text');

    const { columns, hasHeader } = guessColumns(rows);
    const layer = activeLayer();

    return {
      source: {
        kind: 'clipboard',
        importId: crypto.randomUUID(),
        label: sourceLabel?.trim() || 'Pasted table',
        url: sourceUrl?.trim() || null,
        datasetId: datasetId?.trim() || null,
        fetchedAt: new Date().toISOString().slice(0, 10),
        // A pasted table says nothing about when its results happened, and
        // today's date is not an answer to that. See asOf in proposal.js.
        asOf: null
      },
      rows: hasHeader ? rows.slice(1) : rows,
      columns,
      delimiter,
      hasHeader,
      ...layer
    };
  }
};

/* ---------------------------------------------------------------- archive */

/**
 * The ParlGov archive, as an adapter. It produces the same rows of cells a
 * pasted table does — region, party — so it goes through the same matching,
 * the same review and the same apply. If this one needed a special path, the
 * abstraction would not be real.
 */
const archive = {
  id: 'archive',
  label: 'Historical archive',
  hint: 'Party of the head of government on 1 January, from ParlGov 2024.',
  inputs: [
    { name: 'year', type: 'number', label: 'Year', value: '1977', min: 1900, max: 2023 },
    { name: 'scope', type: 'select', label: 'Scope', value: 'Europe', options: Object.keys(REGIONS) },
    {
      name: 'grouping', type: 'select', label: 'Colour by', value: 'family',
      options: [{ value: 'family', label: 'Party family' }, { value: 'party', label: 'Individual party' }]
    }
  ],

  async propose({ year, scope: region, grouping }) {
    await loadGoverning();

    const y = parseInt(year, 10);
    if (!Number.isFinite(y)) throw new Error('Type a year');
    const date = `${String(y).padStart(4, '0')}-01-01`;
    if (date > lastCoveredDate()) {
      throw new Error(`The archive stops at ${lastCoveredDate().slice(0, 4)}`);
    }

    const box = REGIONS[region];
    const inScope = (mapName) => {
      if (!box) return true;
      const f = BY_KEY.get(mapName);
      if (!f) return false;
      const [[x0, y0], [x1, y1]] = box;
      return f.cen[0] >= x0 && f.cen[0] <= x1 && f.cen[1] >= y0 && f.cen[1] <= y1;
    };

    const all = governingOn(date);
    const universe = all.covered.concat(all.uncovered)
      .filter((c) => c.mapName && inScope(c.mapName)).map((c) => c.mapName);
    const covered = all.covered.filter((c) => c.mapName && inScope(c.mapName));
    // Countries left blank because ParlGov's record has a hole, as distinct
    // from ones it never covered. A blank country on a map is a claim of
    // ignorance, and it is worth being able to say which kind.
    const gaps = (all.gaps || []).filter((c) => c.mapName && inScope(c.mapName));

    if (!covered.length) throw new Error(`No country in ${region} has a cabinet on ${date}`);

    const rows = [];
    const hints = [];
    for (const c of covered) {
      const pm = c.pm;
      const byFamily = grouping !== 'party';
      const key = byFamily ? 'family:' + (pm.family || 'none') : 'party:' + pm.party_id;
      const name = byFamily ? familyLabel(pm.family) : pm.name;
      const base = familyColor(pm.family);

      rows.push([c.mapName, name]);
      hints.push({
        key,
        name,
        color: state.overrides[key] || base || UNFAMILIED,
        // No family is not no data — hatching says "governed, unclassified".
        hatch: !base && !state.overrides[key],
        family: pm.family,
        // What actually governed, whatever the colouring is grouped by.
        label: pm.name
      });
    }

    const src = archiveSource();
    return {
      source: {
        kind: 'archive',
        datasetId: `parlgov:government:${date}:${grouping || 'family'}`,
        label: src ? src.label : 'ParlGov',
        url: src ? src.url : null,
        fetchedAt: date,
        // The archive is asked for a date and answers about that date, so the
        // two coincide here. They do not for every adapter.
        asOf: date,
        universe,
        gaps: gaps.map((c) => ({
          unit: c.mapName, lastCabinet: c.lastCabinet, since: c.since, years: c.years,
          nextRecorded: c.nextRecorded, basis: c.basis, detail: c.detail, evidence: c.evidence
        })),
        notes: [
          ...(date < '1945-01-01' ? ['Pre-1945 archive observations are experimental.'] : []),
          ...covered.flatMap((c) => (c.cabinet.coverage?.notes || [])
            .filter((n) => date >= n.from && date < n.to).map((n) => n.text))
        ],
        what: 'Party of the head of government',
        // Framing and titling the review screen cannot guess at.
        title: `Who governed, ${y}`,
        sub: byFamilySub(grouping),
        fitToData: true
      },
      rows,
      hints,
      columns: [{ index: 0, role: 'unit', header: 'Country' }, { index: 1, role: 'party', header: 'Party' }],
      hasHeader: false,
      ...activeLayer()
    };
  }
};

const byFamilySub = (grouping) => grouping === 'party'
  ? 'Party of the head of government on 1 January'
  : 'Party family of the head of government on 1 January';

/* ---------------------------------------------------------------- wikipedia */

/**
 * Wikipedia, for the countries no structured source covers.
 *
 * ParlGov stops at 37 OECD and EU democracies. Bangladesh, Nigeria, Indonesia,
 * Peru and Kenya have no structured source at all, and they are the reason this
 * adapter exists — judge it on whether it can produce a Bangladesh 2024 map.
 *
 * Two decisions are handed back to the person rather than taken: which article,
 * and which table. Both are places where a confident wrong answer produces a
 * map that looks right and is false.
 */
const wikipedia = {
  id: 'wikipedia',
  label: 'Wikipedia',
  hint: 'Search for an election article, or paste its URL. The winning party goes on the map.',
  inputs: [
    {
      name: 'query', type: 'text', label: 'Search',
      placeholder: '2024 Bangladesh general election — or a wikipedia.org URL'
    },
    { name: 'lang', type: 'text', label: 'Wiki', value: 'en', placeholder: 'en, id, cs, bn…' }
  ],

  async propose({ query, lang, article, table }) {
    const layer = activeLayer();
    let wiki = (lang || 'en').trim().toLowerCase();

    // A URL names both the wiki and the article, so there is nothing to search.
    const fromUrl = parseArticleUrl(query);
    if (fromUrl && !article) {
      wiki = fromUrl.lang;
      article = fromUrl.title;
    }

    if (!article) {
      const text = String(query || '').trim();
      if (!text) throw new Error('Type what to search for, or paste an article URL');
      const hits = await search(wiki, text);
      if (!hits.length) throw new Error(`Nothing on the ${wiki} wiki matches "${text}"`);
      return {
        choose: {
          name: 'article',
          prompt: 'Which article?',
          note: 'Titles are not constructible — "Bangladeshi", "Lok Sabha", "general" versus "legislative". Pick the real one.',
          options: hits.map((h) => ({ value: h.title, label: h.title, detail: h.snippet }))
        }
      };
    }

    const art = await fetchArticle(wiki, article);
    // The layer is handed to the scorer so it can measure a table against the
    // units actually on the map, instead of only reading its headers.
    const ranked = rankTables(extractTables(art.html), { index: layer.index });
    const usable = ranked.filter((r) => r.score >= SCORE_FLOOR);

    if (!usable.length) {
      // A graceful failure is fine here. A wrong table is not.
      throw new Error(
        `No table in "${art.title}" reads as a results table. Open ${art.permalink} ` +
        'and copy the table you want into the clipboard adapter.'
      );
    }

    // A family of tables that differ only by which division they describe:
    // ten of them in the Bangladesh article, one per division. On a province
    // layer that family is the map, so it is offered as one choice.
    const family = divisionFamily(ranked);

    // The choice is always offered, never taken silently: those same ten
    // per-division tables look almost exactly like the national one.
    if (table == null || table === '') {
      const options = usable.slice(0, 8).map((r) => ({
        value: String(r.table.index),
        label: tableLabel(r.table),
        note: r.reasons.join(', '),
        detail: r.table.headers.filter(Boolean).slice(0, 8).join(' · ')
      }));
      if (family) {
        options.unshift({
          value: 'family',
          label: `All ${family.members.length} per-division tables`,
          note: 'one row per division, read from its own table',
          detail: family.members.map((m) => m.unit).join(' · ')
        });
      }
      return {
        choose: {
          name: 'table',
          prompt: `Which table in "${art.title}"?`,
          note: `${ranked.length} tables in the article, ${usable.length} of which read as results.`,
          options
        }
      };
    }

    if (table === 'family') {
      if (!family) throw new Error('That article has no family of per-division tables');
      return divisionDraft(art, family, layer);
    }

    const chosen = usable.find((r) => String(r.table.index) === String(table));
    if (!chosen) throw new Error('That table is no longer in this article');

    /*
     * On a sub-national layer, a results table's rows usually *are* the units:
     * 650 constituencies down the left of one table, rather than one table per
     * region. So the rows go through as themselves and the column-role step —
     * which already exists — decides which column is which. On the world layer
     * the same table still has to be read down to one row, because the unit
     * there is the country.
     */
    if (LAYER !== WORLD) {
      return unitRowsDraft(art, chosen, layer);
    }

    const summary = summarise(chosen.table);
    if (!summary) {
      throw new Error('That table has no party column paired with votes or seats — pick another');
    }

    // Which country, from the article's own categories. They name it in the
    // article's language, which is why this looks for the unit inside them
    // rather than parsing an English phrase.
    const derived = countryFromCategories(art.categories, layer.names);
    const rawUnit = derived || bareTitle(art.title);

    const turnout = findTurnout(art.html);

    return {
      source: {
        kind: 'wikipedia',
        label: art.title,
        url: art.permalink,
        fetchedAt: art.fetchedAt,
        asOf: electionYearFromTitle(art.title)
          ? `${electionYearFromTitle(art.title)}-01-01` : null,
        asOfPrecision: electionYearFromTitle(art.title) ? 'year' : null,
        // Recorded so a posted map is defensible: anyone can open exactly the
        // revision that was read, even if the article has moved on since.
        cite: {
          title: art.title, revid: art.revid, lang: art.lang,
          permalink: art.permalink, article: art.articleUrl,
          license: 'Wikipedia, CC BY-SA 4.0'
        },
        what: 'Winning party',
        fromCache: art.fromCache,
        table: chosen.table.index
      },
      chosen: [
        { name: 'article', label: `${art.title} (rev ${art.revid})` },
        { name: 'table', label: tableLabel(chosen.table) }
      ],
      rows: [[
        rawUnit,
        summary.party,
        summary.vote == null ? '' : String(summary.vote),
        summary.seats == null ? '' : String(summary.seats),
        turnout == null ? '' : String(turnout),
        summary.margin == null ? '' : String(summary.margin)
      ]],
      columns: [
        { index: 0, role: 'unit', header: 'Country' },
        { index: 1, role: 'party', header: 'Winning party' },
        { index: 2, role: 'vote', header: 'Vote share' },
        { index: 3, role: 'seats', header: 'Seat share' },
        { index: 4, role: 'turnout', header: 'Turnout' },
        { index: 5, role: 'margin', header: 'Margin' }
      ],
      hasHeader: false,
      ...layer
    };
  }
};

/**
 * Find a set of tables that are the same table repeated per division.
 *
 * The Bangladesh article captions them "…(12th Jatiya Sangsad) : Barishal
 * Division", "… : Chattogram Division" and so on. Strip the shared prefix and
 * what is left is the division's name — which is exactly the unit a province
 * map needs. Three or more is a family; two is a coincidence.
 */
function divisionFamily(ranked) {
  const captioned = ranked.filter((r) => r.table.caption && r.table.caption.includes(':'));
  const byPrefix = new Map();
  for (const r of captioned) {
    const cut = r.table.caption.lastIndexOf(':');
    const prefix = r.table.caption.slice(0, cut).trim();
    const unit = r.table.caption.slice(cut + 1).trim();
    if (!prefix || !unit) continue;
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix).push({ table: r.table, unit });
  }

  let best = null;
  for (const [prefix, members] of byPrefix) {
    if (members.length < 3) continue;
    if (!best || members.length > best.members.length) best = { prefix, members };
  }
  return best;
}

/**
 * A table whose rows are the units, handed through unchanged.
 *
 * Nothing is summarised and nothing is guessed about which column means what —
 * that is the column-role step's job, and on a table like the UK's, where one
 * column is the 2019 notional result and another is the 2024 winner, it is a
 * job that has to be done by someone who can tell them apart.
 */
function unitRowsDraft(art, chosen, layer) {
  const table = chosen.table;
  const body = table.rows.slice(table.headerCount || 1).filter((r) => r.some((c) => c));
  if (body.length < 2) throw new Error('That table has no rows to read');

  // The extractor knows from the markup which rows were <th>; that is better
  // evidence than the numeric heuristic, which this table defeats by holding no
  // numbers at all.
  const { columns } = guessColumns([table.headers, ...body],
    { knownHeader: (table.headerCount || 0) > 0 });

  return {
    source: wikiSource(art, {
      what: 'Winning party by ' + (BOUNDARY && BOUNDARY.label ? BOUNDARY.label : 'unit'),
      title: art.title,
      fitToData: true
    }),
    chosen: [
      { name: 'article', label: `${art.title} (rev ${art.revid})` },
      { name: 'table', label: `${tableLabel(table)} — ${body.length} rows` }
    ],
    rows: body,
    columns,
    hasHeader: false,
    ...layer
  };
}

/** One row per division, each read from its own table. */
function divisionDraft(art, family, layer) {
  const rows = [];
  const skipped = [];
  for (const m of family.members) {
    const summary = summarise(m.table);
    if (!summary) { skipped.push(m.unit); continue; }
    rows.push([
      m.unit,
      summary.party,
      summary.vote == null ? '' : String(summary.vote),
      summary.seats == null ? '' : String(summary.seats),
      '',
      summary.margin == null ? '' : String(summary.margin)
    ]);
  }
  if (!rows.length) throw new Error('None of those per-division tables could be read');

  return {
    source: wikiSource(art, {
      what: 'Winning party by division',
      title: art.title,
      table: 'per-division tables',
      fitToData: true
    }),
    chosen: [
      { name: 'article', label: `${art.title} (rev ${art.revid})` },
      { name: 'table', label: `${rows.length} per-division tables` }
    ],
    note: skipped.length ? `${skipped.length} of these tables could not be read: ${skipped.join(', ')}` : null,
    rows,
    columns: [
      { index: 0, role: 'unit', header: 'Division' },
      { index: 1, role: 'party', header: 'Winning party' },
      { index: 2, role: 'vote', header: 'Vote share' },
      { index: 3, role: 'seats', header: 'Seat share' },
      { index: 4, role: 'ignore', header: '' },
      { index: 5, role: 'margin', header: 'Margin' }
    ],
    hasHeader: false,
    ...layer
  };
}

/** The citation block, identical whichever shape the draft takes. */
/**
 * The year an article is about, from its title, or nothing.
 *
 * This exists because `fetchedAt` was doing two jobs and is only honest at one
 * of them. When an article is read today, "today" is when it was read — it is
 * not when the election happened, and reasoning about boundary vintages with it
 * produces nonsense like "these results are from 2026".
 *
 * A title is allowed to answer only when it answers unambiguously: exactly one
 * four-digit year in a plausible range. "2024 Bangladeshi general election" and
 * "List of MPs elected in the 2019 United Kingdom general election" each name
 * one year; a title naming two ("the 2019–2024 Parliament") names none as far
 * as this is concerned, because picking one of them would be a guess.
 */
export function electionYearFromTitle(title) {
  const years = [...new Set((String(title || '').match(/\b(1[89]\d\d|20\d\d|21\d\d)\b/g) || []))];
  return years.length === 1 ? Number(years[0]) : null;
}

function wikiSource(art, extra) {
  const year = electionYearFromTitle(art.title);
  return Object.assign({
    kind: 'wikipedia',
    label: art.title,
    url: art.permalink,
    fetchedAt: art.fetchedAt,
    // Only the year is known, so only the year is claimed. A day would be made
    // up, and the boundary comparison works in years anyway.
    asOf: year ? `${year}-01-01` : null,
    asOfPrecision: year ? 'year' : null,
    // Recorded so a posted map is defensible: anyone can open exactly the
    // revision that was read, even if the article has moved on since.
    cite: {
      title: art.title, revid: art.revid, lang: art.lang,
      permalink: art.permalink, article: art.articleUrl,
      license: 'Wikipedia, CC BY-SA 4.0'
    },
    fromCache: art.fromCache
  }, extra);
}

/**
 * Something a person can tell tables apart by. A table with no caption and no
 * heading above it is still identifiable by what its columns are called, and
 * "Table 5" tells nobody anything.
 */
function tableLabel(t) {
  if (t.caption) return t.caption;
  if (t.section) return t.section;
  const cols = [...new Set(t.headers.filter(Boolean))].slice(0, 4).join(' · ');
  return cols || 'Table ' + (t.index + 1);
}

/** "2024 Bangladeshi general election" -> "Bangladeshi", for ranking suggestions. */
function bareTitle(title) {
  return String(title)
    .replace(/\b(19|20)\d{2}\b/g, '')
    .replace(/\b(general|parliamentary|legislative|presidential|national|federal|snap|early)\b/gi, '')
    .replace(/\b(elections?|referendum|umum|pemilihan|legislatif|volby|wybory)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ---------------------------------------------------------------- registry */

export const ADAPTERS = [clipboard, wikipedia, archive];

export const adapterById = (id) => ADAPTERS.find((a) => a.id === id) || ADAPTERS[0];
