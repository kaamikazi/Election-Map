/**
 * Matching a name in a table to a unit on the map.
 *
 * Four steps, in order, stopping at the first hit. Then it stops. Fuzzy
 * matching never auto-applies — it only ranks the choices inside the dropdown
 * of a row the person is already fixing by hand. A silent wrong guess is worse
 * than an honest failure, and a wrong election map is the one mistake this
 * cannot take back.
 */

import { state, ALIAS, migrateLayerId, migrateLayerKeys } from '../state.js';

/**
 * Lowercase, strip diacritics, drop punctuation, collapse whitespace, and drop
 * a trailing parenthetical — "Praha (hlavní město)" and "Praha" are the same
 * place written by two people.
 */
export function normalise(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/\([^)]*\)\s*$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/* ---------------------------------------------------------------- aliases */

/**
 * Learned aliases are scoped to the layer, because "Central" means one thing
 * among Czech regions and another among Bangladeshi constituencies — and
 * because two sources for the same country disagree about what units exist at
 * all. The scope is the layer id: 'world', 'ne:BGD:ADM1', 'gb:BGD:ADM1'.
 */
export const scopeKey = (layerId) => migrateLayerId(String(layerId || 'world'));

const STORE_KEY = 'election-map-studio.aliases';

/** Aliases live in the document so they save with it, and in localStorage so
 *  they survive a reload of a map that was never saved. */
export function learnAlias(scope, raw, unit) {
  const key = normalise(raw);
  if (!key || !unit) return;
  if (!state.aliases[scope]) state.aliases[scope] = {};
  if (state.aliases[scope][key] === unit) return;
  state.aliases[scope][key] = unit;
  persist();
}

export function forgetAlias(scope, raw) {
  const key = normalise(raw);
  if (state.aliases[scope]) delete state.aliases[scope][key];
  persist();
}

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state.aliases));
  } catch (err) {
    // A private window or a storage quota is not a reason to lose the import.
  }
}

export function loadAliases() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    // Corrections stored under milestone 3's `admin1:BGD` keys move to the
    // source-qualified `ne:BGD:ADM1` rather than being left behind.
    const stored = migrateLayerKeys(JSON.parse(raw));
    let changed = false;
    for (const [scope, map] of Object.entries(stored)) {
      if (migrateLayerId(scope) !== scope) changed = true;
      state.aliases[scope] = Object.assign({}, map, state.aliases[scope]);
    }
    if (changed || raw !== JSON.stringify(stored)) persist();
  } catch (err) {
    // Unreadable storage is the same as empty storage.
  }
}

/* ---------------------------------------------------------------- matching */

/**
 * Build the lookup for one layer of units.
 *
 * Everything resolves to a unit *key*, never to a name. On the world layer the
 * key happens to be the country's name; on a province layer it is Natural
 * Earth's adm1_code, and the names around it move between releases.
 *
 * @param {{key: string, name: string}[]} units
 */
export function buildIndex(units) {
  const exact = new Map();    // name -> key
  const loose = new Map();    // normalised name -> key
  const nameOf = new Map();   // key -> name
  const ambiguous = new Set();

  for (const { key, name } of units) {
    exact.set(name, key);
    nameOf.set(key, name);
    // A table may quote the id itself; accept that too.
    if (key !== name) exact.set(key, key);
    const norm = normalise(name);
    if (loose.has(norm) && loose.get(norm) !== key) ambiguous.add(norm);
    else loose.set(norm, key);
  }
  return {
    units,
    names: units.map((u) => u.name),
    keys: units.map((u) => u.key),
    exact, loose, nameOf, ambiguous
  };
}

/**
 * @returns {{unit: string|null, how: string, ambiguous?: boolean}}
 *   how: 'exact' | 'learned' | 'alias' | 'normalised' | 'none'
 */
export function matchUnit(raw, index, scope) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return { unit: null, how: 'none' };

  // 1. exact name
  if (index.exact.has(text)) return { unit: index.exact.get(text), how: 'exact' };

  const norm = normalise(text);

  // 2. an alias this person taught us, for this country and layer
  const learned = state.aliases[scope] && state.aliases[scope][norm];
  if (learned && index.nameOf.has(learned)) return { unit: learned, how: 'learned' };

  // 3. the built-in alias table
  const built = ALIAS[text.toLowerCase()] || ALIAS[norm];
  if (built && index.exact.has(built)) return { unit: index.exact.get(built), how: 'alias' };

  // 4. normalised exact
  if (index.ambiguous.has(norm)) return { unit: null, how: 'none', ambiguous: true };
  if (index.loose.has(norm)) return { unit: index.loose.get(norm), how: 'normalised' };

  // And stop.
  return { unit: null, how: 'none' };
}

/* ---------------------------------------------------------------- ranking */

/**
 * Order candidates for a dropdown the person is already opening. This is the
 * only place anything fuzzy is allowed, and it decides nothing — it decides
 * what to show first.
 */
export function rankCandidates(raw, index, limit = 12) {
  const norm = normalise(raw);
  if (!norm) return index.units.slice(0, limit).map((u) => u.name);

  return index.units
    .map((u) => ({ name: u.name, score: similarity(norm, normalise(u.name)) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((x) => x.name);
}

/** Dice coefficient over bigrams: cheap, and forgiving of a missing accent. */
function similarity(a, b) {
  if (a === b) return 1;
  if (b.startsWith(a) || a.startsWith(b)) return 0.9;
  if (b.includes(a) || a.includes(b)) return 0.8;

  const pairs = (s) => {
    const out = [];
    for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
    return out;
  };
  const A = pairs(a), B = pairs(b);
  if (!A.length || !B.length) return 0;

  const pool = B.slice();
  let hits = 0;
  for (const p of A) {
    const i = pool.indexOf(p);
    if (i >= 0) { pool.splice(i, 1); hits++; }
  }
  return (2 * hits) / (A.length + B.length);
}
