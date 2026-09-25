/**
 * The document: parties, assignments, the active metric, view settings — plus
 * the small amount of shared vocabulary (palette, themes, regions, name
 * aliases) everything else reads from. Nothing here touches the DOM.
 *
 * An assignment is a record, not just a party:
 *   { party: 3, vote: 41.2, seats: 52, turnout: 68.4, margin: 9.1 }
 * Every value is optional. With none of them set, and the metric on "flat",
 * the map behaves exactly as v1 did.
 */

export const PALETTE = ['#3B7DD8', '#D0453E', '#E08A2E', '#3E9E6E', '#8659C4', '#2AA3A3', '#C7B02E', '#8A8F98'];

export const FONT = '"Helvetica Neue",Helvetica,Arial,sans-serif';

export const THEMES = {
  dark: {
    bg: '#0D141C', ocean: '#101C27', land: '#33414F', border: 'rgba(10,16,22,.6)',
    edge: '#2A3B49', grat: 'rgba(255,255,255,.05)', text: '#EDE9E1', muted: '#8B9BA8',
    hover: '#EDE9E1', track: '#1E2C37', ring: 'rgba(13,20,28,.9)', unvalued: '#22303E',
    hatchInk: 'rgba(237,233,225,.62)', backdrop: '#1A2530',
    // Flags mode only: the edge around a flagged unit. See drawFlagCasing.
    casing: 'rgba(6,10,15,.92)',
    flagLand: '#243039'
  },
  light: {
    bg: '#FFFFFF', ocean: '#EBF0F3', land: '#CFD8DE', border: 'rgba(255,255,255,.85)',
    edge: '#B9C4CC', grat: 'rgba(0,0,0,.05)', text: '#141C24', muted: '#5C6B77',
    hover: '#141C24', track: '#E2E8EC', ring: 'rgba(255,255,255,.9)', unvalued: '#E6ECF0',
    hatchInk: 'rgba(20,28,36,.55)', backdrop: '#EDF1F4',
    casing: 'rgba(20,28,36,.78)',
    flagLand: '#C2CCD3'
  }
};

export const REGIONS = {
  'World':         null,
  'Europe':        [[-26, 33], [46, 72]],
  'Asia':          [[25, -12], [150, 56]],
  'Africa':        [[-20, -36], [54, 38]],
  'Americas':      [[-172, -56], [-32, 74]],
  'South America': [[-84, -56], [-33, 14]],
  'Middle East':   [[24, 11], [64, 43]],
  'Oceania':       [[110, -48], [179, 2]],
  'South Asia':    [[59, 4], [98, 38]]
};

export const ALIAS = {
  'usa': 'United States of America', 'us': 'United States of America', 'america': 'United States of America',
  'united states': 'United States of America', 'uk': 'United Kingdom', 'britain': 'United Kingdom',
  'great britain': 'United Kingdom', 'england': 'United Kingdom', 'uae': 'United Arab Emirates',
  'ivory coast': "Côte d'Ivoire", 'czech republic': 'Czechia', 'drc': 'Dem. Rep. Congo',
  'congo-kinshasa': 'Dem. Rep. Congo', 'zaire': 'Dem. Rep. Congo', 'burma': 'Myanmar',
  'holland': 'Netherlands', 'türkiye': 'Turkey', 'turkiye': 'Turkey', 'swaziland': 'eSwatini',
  'north macedonia': 'Macedonia', 'bosnia': 'Bosnia and Herz.', 'east timor': 'Timor-Leste',
  'cape verde': 'Cabo Verde', 'vatican city': 'Vatican', 'south korea': 'South Korea',
  'korea': 'South Korea', 'russia': 'Russia', 'persia': 'Iran', 'dominican rep': 'Dominican Rep.',
  'central african republic': 'Central African Rep.', 'south sudan': 'S. Sudan', 'sudan': 'Sudan',
  'eq. guinea': 'Eq. Guinea', 'equatorial guinea': 'Eq. Guinea', 'png': 'Papua New Guinea',
  'solomon islands': 'Solomon Is.', 'new zealand': 'New Zealand',
  // Long forms, as categories and prose write them. Without these,
  // "Democratic Republic of the Congo" resolves to Congo, which is a
  // different country that this map also holds.
  'democratic republic of the congo': 'Dem. Rep. Congo',
  'dr congo': 'Dem. Rep. Congo', 'congo-kinshasa': 'Dem. Rep. Congo',
  'republic of the congo': 'Congo', 'congo-brazzaville': 'Congo',
  'dominican republic': 'Dominican Rep.',
  'bosnia and herzegovina': 'Bosnia and Herz.',
  'republic of ireland': 'Ireland',
  'united republic of tanzania': 'Tanzania',
  'republic of north macedonia': 'Macedonia',
  'united states of america': 'United States of America',
  'kingdom of eswatini': 'eSwatini', 'republic of korea': 'South Korea',
  'the gambia': 'Gambia', 'the bahamas': 'Bahamas'
};

export const SCHEMA_VERSION = 5;

/**
 * Milestone 3 keyed layers as `admin1:<ISO3>` when Natural Earth was the only
 * boundary set there was. Now that a set has a source, the id carries it:
 * `ne:<ISO3>:ADM1`.
 *
 * The aliases under the old key were typed in by hand, one division at a time.
 * Orphaning them silently is exactly the kind of quiet loss this project keeps
 * catching everywhere else, so old ids are rewritten wherever they appear.
 */
export function migrateLayerId(id) {
  const m = String(id || '').match(/^admin1:([A-Z]{3})$/i);
  return m ? `ne:${m[1].toUpperCase()}:ADM1` : id;
}

/** Rewrite the keys of an object whose keys are layer ids. */
export function migrateLayerKeys(byLayer) {
  const out = {};
  for (const [id, value] of Object.entries(byLayer || {})) {
    const next = migrateLayerId(id);
    // A hand-made correction wins over whatever an old duplicate key held.
    out[next] = next in out ? Object.assign({}, value, out[next]) : value;
  }
  return out;
}

let uid = 1;
export const nextId = () => uid++;
/** Called after loading a file, so new parties never collide with loaded ones. */
export function reserveIds(ids) {
  uid = Math.max(uid, ...ids.map(Number).filter(Number.isFinite)) + 1;
}

export const state = {
  title: '', sub: '', handle: '',
  parties: [
    { id: nextId(), name: 'Party A', color: PALETTE[0] },
    { id: nextId(), name: 'Party B', color: PALETTE[1] }
  ],
  active: null,
  assign: {},          // country name -> { party, vote, seats, turnout, margin }
  metric: 'flat',
  selected: null,      // country name shown in the values editor
  // Colours the person chose for an archive party, keyed by its ParlGov id.
  // The override is stored, never the result, so re-fetching a year keeps them.
  overrides: {},
  // Where an archive-built map came from. Null for a hand-made map.
  provenance: null,
  // Name corrections the person made by hand during an import, scoped to a
  // country and boundary layer so the next import of the same source is clean.
  aliases: {},
  // Which boundary layer is on screen: 'world', or 'admin1:<ISO3>'.
  layer: 'world',
  // The other layers' work. Switching layers parks the current assignments
  // here and takes the new layer's back out, so clicking a country to look at
  // its provinces cannot cost someone a finished map of Europe.
  layerAssign: {},
  proj: 'equalEarth',
  rotate: [-10, -12],
  zoom: 1, pan: [0, 0],
  fit: null,           // [[lon,lat],[lon,lat]] or null
  theme: 'dark',
  grat: false, antarctica: false, dots: true, labels: false,
  /*
   * 'results' or 'flags'. Results is the default and the only mode in which a
   * fill means anything: on a results map the fill is the data, and a flag
   * never replaces it. Flags mode is for maps that are not about results —
   * who votes this year, who we have covered, a teaser before a results post.
   */
  mode: 'results',
  // The countries a flags map shows, by unit key. Deliberately not `assign`:
  // switching mode must not cost anyone a finished results map, and a flag
  // selection is not a result.
  flagged: {}
};
state.active = state.parties[0].id;

/* ---------------- derived ---------------- */

export const partyById = (id) => state.parties.find((p) => p.id === id) || null;

export const recordFor = (name) => state.assign[name] || null;

export function partyFor(name) {
  const rec = state.assign[name];
  return rec ? partyById(rec.party) : null;
}

/** The flat party colour — the ramp lives in metrics.js. */
export function colorFor(name) {
  const p = partyFor(name);
  return p ? p.color : null;
}

export function tally(id) {
  return Object.values(state.assign).filter((r) => r.party === id).length;
}

/** Parties that hold at least one country, biggest first. */
export function standings() {
  return state.parties
    .map((p) => ({ p, n: tally(p.id) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
}

/** Parties in play, in party order — the order the legend uses. */
export const activeParties = () => state.parties.filter((p) => tally(p.id) > 0);

/* ---------------- undo ---------------- */

const history = [];
const HISTORY_LIMIT = 60;

/**
 * Everything a single undo has to put back. Assignments alone are not enough:
 * an apply can replace the party list too, and restoring assignments that
 * point at party ids no longer in the document leaves an uncolourable map.
 */
const UNDOABLE = ['parties', 'assign', 'metric', 'provenance', 'active', 'selected',
                  'layer', 'layerAssign', 'mode', 'flagged'];

const snapshot = () => JSON.stringify(Object.fromEntries(UNDOABLE.map((k) => [k, state[k]])));

/** Snapshot before a mutation that a person would expect to undo. */
export function pushHistory() {
  history.push(snapshot());
  if (history.length > HISTORY_LIMIT) history.shift();
}

export const canUndo = () => history.length > 0;

export function undo() {
  const prev = history.pop();
  if (prev == null) return false;
  Object.assign(state, JSON.parse(prev));
  if (state.selected && !state.assign[state.selected]) state.selected = null;
  emit('parties');
  return true;
}

/* ---------------- mutations ---------------- */

const blank = (party) => ({ party, vote: null, seats: null, turnout: null, margin: null });

/**
 * Click behaviour, unchanged from v1: the same party again clears the country,
 * a different party takes it over. Values already entered survive a takeover —
 * they describe the contest, not the winner.
 */
export function toggleCountry(name) {
  pushHistory();
  const rec = state.assign[name];
  if (rec && rec.party === state.active) {
    delete state.assign[name];
    if (state.selected === name) state.selected = null;
  } else {
    state.assign[name] = rec ? Object.assign({}, rec, { party: state.active }) : blank(state.active);
    state.selected = name;
  }
  emit('assign');
}

/** Flags mode's painting: same gesture, its own selection. */
export function toggleFlag(key) {
  pushHistory();
  if (state.flagged[key]) delete state.flagged[key];
  else state.flagged[key] = true;
  emit('assign');
}

export function setMode(mode) {
  if (mode !== 'results' && mode !== 'flags') return;
  if (state.mode === mode) return;
  pushHistory();
  state.mode = mode;
  emit('parties');
}

/** Whatever painting means in the current mode. */
export const paint = (key) => (state.mode === 'flags' ? toggleFlag(key) : toggleCountry(key));

export function setValue(name, key, value) {
  const rec = state.assign[name];
  if (!rec) return;
  pushHistory();
  state.assign[name] = Object.assign({}, rec, { [key]: value });
  emit('assign');
}

export function clearCountry(name) {
  if (!state.assign[name]) return;
  pushHistory();
  delete state.assign[name];
  if (state.selected === name) state.selected = null;
  emit('assign');
}

export function select(name) {
  state.selected = name;
  emit('select');
}

export function setMetric(id) {
  state.metric = id;
  emit('metric');
}

/**
 * Move to another boundary layer, keeping both layers' work.
 *
 * One document holds every layer's assignments. The alternative — switching
 * layers starts a new document — loses a finished map to a misclick, and this
 * is the mistake that cannot be taken back.
 */
export function switchLayer(id) {
  if (id === state.layer) return false;
  pushHistory();

  // Provenance describes a set of assignments, so it is parked with them.
  state.layerAssign[state.layer] = { assign: state.assign, provenance: state.provenance };

  const parked = state.layerAssign[id] || { assign: {}, provenance: null };
  state.assign = parked.assign;
  state.provenance = parked.provenance;
  delete state.layerAssign[id];

  state.layer = id;
  state.selected = null;
  return true;
}

/** How much work each layer is holding, for the picker. */
export function layerCounts() {
  const out = { [state.layer]: Object.keys(state.assign).length };
  for (const [id, parked] of Object.entries(state.layerAssign)) {
    out[id] = Object.keys((parked && parked.assign) || {}).length;
  }
  return out;
}

/**
 * Replace the whole document with one built from the archive. The person's
 * colour overrides survive because they live in state.overrides, not in the
 * parties this rebuilds.
 */
export function applyDocument({ parties, assign, provenance }) {
  pushHistory();
  state.parties = parties;
  state.assign = assign;
  state.active = parties.length ? parties[0].id : null;
  state.selected = null;
  state.provenance = provenance || null;
  // The archive supplies no vote shares or turnouts. Leaving a ramped metric
  // selected would render every country in the "no value" tone — a map that
  // looks drawn and says nothing.
  state.metric = 'flat';
  emit('parties');
}

/** Recolouring an archive party records an override; a hand-made one does not. */
export function setPartyColor(party, hex) {
  party.color = hex;
  if (party.parlgov_id != null) state.overrides[party.parlgov_id] = hex;
  emit('style');
}

export function addParty() {
  const p = {
    id: nextId(),
    name: 'Party ' + String.fromCharCode(65 + state.parties.length),
    color: PALETTE[state.parties.length % PALETTE.length]
  };
  state.parties.push(p);
  state.active = p.id;
  return p;
}

/** Returns false when this is the last party — the caller says so. */
export function removeParty(id) {
  if (state.parties.length === 1) return false;
  pushHistory();
  state.parties = state.parties.filter((q) => q.id !== id);
  for (const k in state.assign) if (state.assign[k].party === id) delete state.assign[k];
  if (state.selected && !state.assign[state.selected]) state.selected = null;
  if (state.active === id) state.active = state.parties[0].id;
  return true;
}

export function clearAssignments() {
  pushHistory();
  state.assign = {};
  state.selected = null;
  state.provenance = null;
  emit('assign');
}

/* ---------------- save format ---------------- */

/**
 * v1 and the first v2 split wrote `assign[name] = partyId`. Read those as
 * records with no values, so old files open unchanged.
 */
export function migrate(doc) {
  const out = Object.assign({}, doc);
  delete out.version;
  const assign = {};
  for (const [name, v] of Object.entries(out.assign || {})) {
    assign[name] = typeof v === 'number' ? blank(v) : Object.assign(blank(v.party), v);
  }
  out.assign = assign;
  if (!out.metric) out.metric = 'flat';
  if (out.selected === undefined) out.selected = null;
  if (!out.overrides) out.overrides = {};
  out.aliases = migrateLayerKeys(out.aliases);
  out.layerAssign = migrateLayerKeys(out.layerAssign);
  out.layer = migrateLayerId(out.layer || 'world');
  if (out.provenance === undefined) out.provenance = null;
  if (out.mode !== 'flags') out.mode = 'results';
  if (!out.flagged || typeof out.flagged !== 'object') out.flagged = {};
  return out;
}

export const toDocument = () => Object.assign({ version: SCHEMA_VERSION }, state);

/* ---------------- change notification ----------------
 * A country can be coloured from the map, the country list or a party being
 * deleted; every one of those has to refresh the same panels. One channel
 * keeps the panels from having to know about each other.
 */

const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export function emit(kind) {
  for (const fn of listeners) fn(kind);
}
