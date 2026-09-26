/**
 * The Proposal: what an adapter produces, what the review screen shows, and
 * what apply consumes. Every adapter — clipboard, a Wikipedia fetcher, the
 * ParlGov archive — hands back this one shape, so there is exactly one review
 * screen and exactly one apply path.
 *
 *   Proposal    { source, columns, rows }
 *   ProposalRow { raw, unit, party, values, status, note }
 */

import { state, nextId, PALETTE, pushHistory, emit } from '../state.js';
import { parseNumber } from './parse.js';
import { matchUnit, rankCandidates, normalise, learnAlias } from './match.js';
import { boundsOf, BOUNDARY } from '../geo.js';
import { applyPartials } from './partition.js';
import { VINTAGE_GRACE_YEARS } from '../vintage.js';
import { sourceRecord, recordSources, summariseSources } from '../provenance.js';

export const VALUE_ROLES = ['vote', 'seats', 'turnout', 'margin'];

/**
 * Build a Proposal from a table of cells and a set of column roles.
 *
 * @param {object} args
 *   source   { kind, label, url, fetchedAt }
 *   rows     string[][] — the body, header already removed
 *   columns  [{ index, role }]
 *   index    unit index from buildIndex()
 *   scope    alias scope key
 */
export function buildProposal({ source, rows, columns, index, scope, hints }) {
  // A year identifies neither an office nor a round. Treat it as unknown even
  // when pasted into the optional identity field.
  if (source?.datasetId && /^\d{4}$/.test(source.datasetId.trim())) source = { ...source, datasetId: null };
  const unitCol = columns.find((c) => c.role === 'unit');
  const partyCol = columns.find((c) => c.role === 'party');
  const valueCols = columns.filter((c) => VALUE_ROLES.includes(c.role));

  const seen = new Map();   // unit -> first row that claimed it

  const proposalRows = rows.map((cells, i) => {
    const rawUnit = unitCol ? (cells[unitCol.index] || '') : '';
    const rawParty = partyCol ? (cells[partyCol.index] || '') : '';

    const raw = { unit: rawUnit, party: rawParty };
    const values = {};
    const notes = [];

    for (const col of valueCols) {
      const cell = cells[col.index] ?? '';
      raw[col.role] = cell;
      // Blank/unavailable is missing. [clear] is an intentional deletion.
      if (String(cell).trim().toLowerCase() === '[clear]') {
        values[col.role] = null;
        notes.push(`${col.role}: clear existing value`);
        continue;
      }
      const { value, note } = parseNumber(cell);
      if (value !== null) values[col.role] = value;
      // A cell that could not be read gets a note, never a silent zero.
      if (note) notes.push(note);
    }

    const hit = unitCol ? matchUnit(rawUnit, index, scope) : { unit: null, how: 'none' };
    let status = hit.unit ? 'matched' : (hit.ambiguous ? 'ambiguous' : 'unmatched');
    if (!rawUnit) { status = 'unmatched'; notes.push('no region name in this row'); }
    if (hit.ambiguous) notes.push('more than one unit normalises to this name');

    if (hit.unit) {
      if (seen.has(hit.unit)) {
        status = 'duplicate';
        notes.push(`row ${seen.get(hit.unit) + 1} already claims ${hit.unit}`);
      } else {
        seen.set(hit.unit, i);
      }
    }

    return {
      i,
      raw,
      unit: hit.unit,
      how: hit.how,
      party: resolvePartySlot(rawParty),
      // An adapter may know more about a party than its name — ParlGov knows
      // its family and therefore its colour. Optional, and ignored when absent.
      hint: hints ? hints[i] || null : null,
      values,
      status,
      note: notes.length ? notes.join('; ') : null,
      candidates: hit.unit ? null : rankCandidates(rawUnit, index)
    };
  });

  return { source, columns, rows: proposalRows, index, scope };
}

/** An existing party with this name, or "new" — resolved at apply time. */
function resolvePartySlot(rawParty) {
  const name = String(rawParty || '').trim();
  if (!name) return null;
  const key = normalise(name);
  const hit = state.parties.find((p) => normalise(p.name) === key);
  return hit ? hit.id : 'new';
}

/** Re-resolve one row after the person changed its unit in the dropdown. */
export function setRowUnit(proposal, row, unitKey) {
  row.unit = unitKey || null;
  row.how = unitKey ? 'chosen' : 'none';
  recount(proposal);
}

/** Recompute duplicates and statuses across the whole proposal. */
export function recount(proposal) {
  const seen = new Map();
  for (const row of proposal.rows) {
    if (!row.unit) {
      row.status = row.status === 'ambiguous' ? 'ambiguous' : 'unmatched';
      continue;
    }
    if (seen.has(row.unit)) {
      row.status = 'duplicate';
      row.note = `row ${seen.get(row.unit) + 1} already claims ${row.unit}`;
    } else {
      seen.set(row.unit, row.i);
      row.status = 'matched';
      if (row.note && row.note.startsWith('row ')) row.note = null;
    }
  }
  return counts(proposal);
}

export function counts(proposal) {
  const out = { matched: 0, ambiguous: 0, unmatched: 0, duplicate: 0 };
  for (const row of proposal.rows) out[row.status]++;
  return out;
}

/* ---------------------------------------------------------------- warnings */

/**
 * Things that are not errors but are very often mistakes. Surfaced up front,
 * never left for the person to notice by scrolling.
 */
export function warnings(proposal) {
  const out = [];
  const nameOf = (key) => (proposal.index && proposal.index.nameOf.get(key)) || key;

  /*
   * No party column at all.
   *
   * This became reachable the moment the guesser stopped inventing one. It has
   * to be said loudly, because every count in the review still reads correctly
   * — the MPs table matched 650 of 650 with no party column selected — and a
   * row whose unit matched is genuinely matched. What it is not is a result.
   * Applying it paints 650 units with no party, which on screen is a map that
   * looks unfinished rather than wrong, and that is the quietest possible way
   * to publish nothing.
   */
  const hasParty = (proposal.columns || []).some((c) => c.role === 'party');
  const namesParty = proposal.rows.some((r) => r.raw.party && r.raw.party.trim());
  if (!hasParty && !namesParty) {
    out.push({
      kind: 'no-party',
      text: 'No column is set to Party, so these rows carry no winner. ' +
            'The units will match and the map will stay blank.'
    });
  }

  const byUnit = new Map();
  for (const row of proposal.rows) {
    if (!row.unit) continue;
    if (!byUnit.has(row.unit)) byUnit.set(row.unit, []);
    byUnit.get(row.unit).push(row);
  }

  for (const [unit, rows] of byUnit) {
    if (rows.length > 1) {
      out.push({
        kind: 'duplicate',
        text: `${rows.length} rows resolve to ${nameOf(unit)} — only the first will apply.`
      });
    }
    const sum = rows.reduce((n, r) => n + (r.values.vote || 0), 0);
    if (sum > 115) {
      out.push({
        kind: 'sum',
        text: `Vote shares for ${nameOf(unit)} add up to ${sum.toFixed(1)}% — is that column a share?`
      });
    }
  }

  // Two different party names collapsing into one slot.
  const slots = new Map();
  for (const row of proposal.rows) {
    const name = row.raw.party && row.raw.party.trim();
    if (!name) continue;
    const key = normalise(name);
    if (!slots.has(key)) slots.set(key, new Set());
    slots.get(key).add(name);
  }
  for (const [, names] of slots) {
    if (names.size > 1) {
      out.push({
        kind: 'party',
        text: `"${[...names].join('" and "')}" will become one party — they normalise the same.`
      });
    }
  }

  /*
   * And the opposite mistake, which only shows up at scale.
   *
   * The check above catches two spellings that collapse into one slot. This
   * catches two spellings that do not: a 650-row table wrote "Scottish
   * National" in seven rows and "Scottish National Party" in two, and the map
   * came out with two legend entries, two colours and the party's seat count
   * split across them. At eight rows a person sees that; at 650 they do not.
   *
   * The rule is a whole-word prefix and nothing cleverer. It has to be a rule
   * rather than a similarity score, because a score would also flag Labour
   * against Liberal and teach people to ignore the warning. It still flags
   * pairs that are genuinely different parties — "Independent" and
   * "Independent Alliance" — which is why it only ever says that two entries
   * exist and leaves the judgement, and the merge, to the person.
   */
  const distinct = [...new Set(proposal.rows
    .map((r) => r.raw.party && r.raw.party.trim())
    .filter(Boolean))];
  for (let i = 0; i < distinct.length; i++) {
    for (let j = 0; j < distinct.length; j++) {
      if (i === j) continue;
      const a = distinct[i], b = distinct[j];
      const [x, y] = [normalise(a), normalise(b)];
      if (x === y || x.length < 3) continue;
      if (!y.startsWith(x + ' ')) continue;
      out.push({
        kind: 'near-party',
        text: `"${a}" and "${b}" will be two separate parties, with two colours ` +
              'and two counts. Merge them in the party list if they are one.'
      });
    }
  }

  // Units on the map the table says nothing about.
  {
    const mentioned = new Set([...byUnit.keys()]);
    const assigned = Object.keys(state.assign);
    const silent = assigned.filter((n) => !mentioned.has(n));
    if (silent.length) {
      out.push({
        kind: 'silent',
        text: `${silent.length} unit${silent.length === 1 ? '' : 's'} already on the map ` +
              `${silent.length === 1 ? 'is' : 'are'} not in this table. Replace removes them; update or combine retains them.`
      });
    }
  }

  return out;
}

/* -------------------------------------------------------- the vintage block */

/**
 * Results older than the boundaries they would be drawn on: refuse.
 *
 * This is the one place the app stops rather than warns, and it is worth
 * saying why, because it was measured rather than assumed.
 *
 * Loading the 2019 Westminster results onto the 2024 seats matches 439 of 651
 * rows by name. Nothing strands, so the partial machinery from milestone 8
 * never runs — it only ever looks at rows that failed — and every one of those
 * 439 units colours in and looks completely ordinary. Comparing the ONS's own
 * pre-redraw (Dec 2022) and post-redraw (July 2024) sets, of the 418 names
 * present in both, only 86 kept essentially all their ground: 332 changed,
 * 173 lost more than a tenth, 84 lost more than a quarter, and Ashford's 2024
 * seat holds 14% of the ground that voted in 2019. The median name match kept
 * 93%. The ONS reissued nearly every code in the redraw, so codes cannot tell
 * the two apart either — only geometry can, and at import time there is only
 * one boundary set in the room.
 *
 * So there is no signal available that would let the map mark which units are
 * unsound. The choice is between drawing something that looks right and is
 * not, and refusing. It refuses, and the person can override deliberately.
 *
 * Only this direction blocks. Results *newer* than the boundaries are just as
 * wrong but they fail loudly: the seats that voted are missing from the map,
 * so the rows go unmatched and the review says so. Silence is what earns a
 * block.
 */
export function vintageBlock(proposal, boundary = BOUNDARY) {
  const src = proposal && proposal.source;
  if (!src || !src.asOf || !boundary || !boundary.vintage) return null;

  const year = Number(String(src.asOf).slice(0, 4));
  const drawn = Number(boundary.vintage);
  if (!Number.isFinite(year) || !Number.isFinite(drawn)) return null;
  if (drawn - year <= VINTAGE_GRACE_YEARS) return null;

  const noun = (boundary.label || 'unit').toLowerCase();
  const plural = /[^aeiou]y$/.test(noun) ? noun.slice(0, -1) + 'ies' : noun + 's';
  return {
    resultsYear: year,
    boundaryVintage: drawn,
    noun: plural,
    text: `These results are from ${year} and these ${plural} represent ${drawn}. ` +
          `A ${noun} that kept its name may not have kept its ground, and nothing ` +
          'on the map can show which. Apply anyway only if you mean to.'
  };
}

/* ---------------------------------------------------------------- apply */

/**
 * Apply the matched rows.
 *
 * Unknown or changed identities replace by default. Explicit same-dataset
 * updates preserve missing values; combinations retain other regions but
 * never carry metrics across an unknown/changed identity. One undo entry.
 *
 * @returns {{applied: number, skipped: number, parties: number}}
 */
export function defaultImportMode(proposal) {
  const id = proposal.source?.datasetId;
  const records = Object.values(state.assign);
  return id && records.length && records.every((r) => r.datasetId === id) ? 'update' : 'replace';
}

export function importBlock(proposal, mode, confirmSame = false) {
  if (!['replace', 'update', 'combine'].includes(mode)) return 'Choose how this import relates to the map.';
  if (mode !== 'update' || !Object.keys(state.assign).length) return null;
  const id = proposal.source?.datasetId;
  const records = Object.values(state.assign);
  if (id && records.some((r) => r.datasetId && r.datasetId !== id)) {
    return 'Dataset identities differ. Replace the map or intentionally combine sources.';
  }
  if ((!id || records.some((r) => !r.datasetId)) && !confirmSame) {
    return 'Identity is unknown. Confirm that the country, election date, office/type and round are the same.';
  }
  return null;
}

export function applyProposal(proposal, { replace, mode = replace === true ? 'replace' : defaultImportMode(proposal), confirmSame = false, learn = true, acceptVintageGap = false } = {}) {
  // Before anything is written: results that predate their boundaries do not
  // apply by accident. See vintageBlock above for what was measured.
  const blocked = acceptVintageGap ? null : vintageBlock(proposal);
  if (blocked) {
    return { applied: 0, skipped: proposal.rows.length, parties: 0, blocked };
  }
  const identityError = importBlock(proposal, mode, confirmSame);
  if (identityError) return { applied: 0, skipped: proposal.rows.length, parties: 0, identityError };

  const usable = proposal.rows.filter((r) => r.unit && r.status === 'matched');
  if (!usable.length) return { applied: 0, skipped: proposal.rows.length, parties: 0 };

  pushHistory('import');

  const assign = mode === 'replace' ? {} : Object.assign({}, state.assign);
  const src = proposal.source || {};
  const incoming = sourceRecord({ ...src, vintageOverride: acceptVintageGap ? vintageBlock(proposal) : null });
  let created = 0;

  for (const row of usable) {
    const old = assign[row.unit];
    const keep = mode === 'update' || (mode === 'combine' && src.datasetId && old?.datasetId === src.datasetId);
    const previous = keep && old ? old : {};
    const provenance = recordSources(previous);
    const hasParty = !!(row.hint || row.raw.party?.trim());
    const party = hasParty ? partyFor(row, () => created++) : { id: previous.party ?? null };
    const record = { ...previous, party: party.id,
      label: row.hint?.label || row.raw.party?.trim() || previous.label || null,
      datasetId: src.datasetId || previous.datasetId || null, provenance };
    if (hasParty) {
      provenance.party = incoming;
      if (record.label) provenance.label = incoming;
    }
    for (const key of VALUE_ROLES) {
      const supplied = Object.hasOwn(row.values, key);
      record[key] = supplied ? row.values[key] : previous[key] ?? null;
      if (supplied) {
        if (record[key] === null) delete provenance[key];
        else provenance[key] = incoming;
      }
    }
    assign[row.unit] = record;

    // A name the person fixed by hand is worth remembering; one that matched on
    // its own is already handled by the rules above it.
    if (learn && row.how === 'chosen') learnAlias(proposal.scope, row.raw.unit, row.unit);
  }

  // A unit whose row describes only part of it says so, and keeps saying so
  // in the document rather than only in the review that produced it.
  applyPartials(assign, proposal.partials || []);

  state.assign = assign;

  // An adapter may know how the map should be framed and titled. Framing to the
  // data matters most when generating many maps across years: coverage changes,
  // so the right frame changes with it.
  if (src.fitToData) {
    const box = boundsOf(Object.keys(assign));
    if (box) { state.fit = box; state.zoom = 1; state.pan = [0, 0]; }
  }
  if (src.title != null) state.title = src.title;
  if (src.sub != null) state.sub = src.sub;

  state.provenance = summariseSources(assign, {
    source: src.label,
    url: src.url || null,
    // When the results happened, which is not when they were downloaded. Null
    // when the source does not say, because today's date is not an answer.
    asOf: src.asOf || null,
    fetchedAt: src.fetchedAt || null,
    covered: Object.keys(assign).length,
    universe: mode === 'combine' ? null : src.universe || null,
    what: src.what || null,
    // The exact thing that was read, so a posted map can be checked against it.
    cite: src.cite || null,
    // A gap the person chose to draw over travels with the map, because the
    // person who sees the map is not the person who made that choice.
    vintageOverride: acceptVintageGap ? vintageBlock(proposal) : null
  });

  emit('parties');
  return { applied: usable.length, skipped: proposal.rows.length - usable.length, parties: created };
}

function partyFor(row, onCreate) {
  // An adapter's hint identifies the slot: two rows with the same key are the
  // same party even if the source spelled them differently.
  if (row.hint) {
    const hit = state.parties.find((p) => p.slotKey === row.hint.key);
    if (hit) return hit;
    const party = {
      id: nextId(),
      name: row.hint.name,
      color: row.hint.color,
      hatch: !!row.hint.hatch,
      family: row.hint.family || null,
      slotKey: row.hint.key,
      parlgov_id: row.hint.key
    };
    state.parties.push(party);
    onCreate();
    return party;
  }

  if (row.party && row.party !== 'new') {
    const existing = state.parties.find((p) => p.id === row.party);
    if (existing) return existing;
  }
  const name = (row.raw.party || '').trim();
  if (name) {
    const key = normalise(name);
    const hit = state.parties.find((p) => normalise(p.name) === key);
    if (hit) return hit;
  } else {
    // A table with no party column — seat counts per country, say — carries no
    // information to group by. One new party per row would be noise, so the
    // rows join the party that is already selected.
    const active = state.parties.find((p) => p.id === state.active);
    if (active) return active;
  }
  const party = {
    id: nextId(),
    name: name || 'Party ' + String.fromCharCode(65 + state.parties.length),
    color: PALETTE[state.parties.length % PALETTE.length]
  };
  state.parties.push(party);
  onCreate();
  return party;
}
