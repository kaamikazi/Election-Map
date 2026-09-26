/** A file open and a cross-layer undo share the same atomic restoration path. */
import { state, migrate, reserveIds, pushHistory, emit, DOCUMENT_DEFAULTS } from './state.js';
import { prepareLayer, loadLayerData, activate } from './geo.js';

const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const fail = (what) => { throw new Error(`Invalid map: ${what}. Open a valid Election Map Studio JSON file.`); };
const pair = (v) => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite);

export function validateDocument(input) {
  const safeKeys = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('reserved object key');
      safeKeys(child);
    }
  };
  safeKeys(input);
  if (!object(input) || !Array.isArray(input.parties) || !object(input.assign)) fail('missing parties or assignments');
  if (input.version != null && (!Number.isInteger(input.version) || input.version > 6)) fail('unsupported document version');
  const doc = { ...structuredClone(DOCUMENT_DEFAULTS), ...migrate(input) };
  // Ignore unrecognised fields; they must never become application state.
  for (const key of Object.keys(doc)) if (!Object.hasOwn(DOCUMENT_DEFAULTS, key)) delete doc[key];
  const ids = new Set();
  for (const p of doc.parties) {
    if (!object(p) || !Number.isFinite(p.id) || ids.has(p.id) || typeof p.name !== 'string' ||
        typeof p.color !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(p.color)) fail('invalid party');
    ids.add(p.id);
  }
  if (!doc.parties.length) fail('empty party list');
  for (const key of ['title', 'sub', 'handle', 'layer']) if (typeof doc[key] !== 'string') fail(key);
  if (!['world'].includes(doc.layer) && !/^[a-z0-9-]+:[A-Z]{3}:[A-Za-z0-9_-]+$/.test(doc.layer)) fail('boundary layer');
  if (!['equalEarth', 'mercator', 'globe'].includes(doc.proj) || !['light', 'dark'].includes(doc.theme) ||
      !['flat', 'vote', 'seats', 'turnout', 'margin'].includes(doc.metric)) fail('map style or metric');
  if (!Number.isFinite(doc.zoom) || doc.zoom <= 0 || !pair(doc.pan) || !pair(doc.rotate) ||
      (doc.fit !== null && (!Array.isArray(doc.fit) || doc.fit.length !== 2 || !doc.fit.every(pair)))) fail('map framing');
  for (const key of ['grat', 'antarctica', 'dots', 'labels']) if (typeof doc[key] !== 'boolean') fail(key);
  for (const key of ['aliases', 'overrides', 'layerAssign', 'flagged']) if (!object(doc[key])) fail(key);
  const validateSource = (p) => {
    if (!object(p)) fail('source attribution');
    for (const key of ['source', 'url', 'asOf', 'asOfPrecision', 'datasetId', 'fetchedAt']) {
      if (p[key] != null && typeof p[key] !== 'string') fail(`source ${key}`);
    }
    if (p.cite != null && (!object(p.cite) || Object.values(p.cite).some((v) => v != null && !['string', 'number'].includes(typeof v)))) fail('source citation');
    if (p.notes != null && (!Array.isArray(p.notes) || p.notes.some((n) => typeof n !== 'string'))) fail('coverage notes');
    if (p.gaps != null && (!Array.isArray(p.gaps) || p.gaps.some((g) => !object(g) || typeof g.unit !== 'string'))) fail('coverage gaps');
    if (p.universe != null && (!Array.isArray(p.universe) || p.universe.some((x) => typeof x !== 'string'))) fail('coverage universe');
    if (p.sources != null) {
      if (!Array.isArray(p.sources)) fail('sources');
      p.sources.forEach(validateSource);
    }
  };
  if (doc.provenance != null) validateSource(doc.provenance);
  const validateAssignments = (assign) => {
    if (!object(assign)) fail('assignments');
    for (const r of Object.values(assign)) {
      if (!object(r) || (r.party != null && !ids.has(r.party))) fail('assignment references an unknown party');
      for (const key of ['vote', 'seats', 'turnout', 'margin']) if (r[key] != null && !Number.isFinite(r[key])) fail(`non-numeric ${key}`);
      if (r.label != null && typeof r.label !== 'string') fail('record label');
      if (r.datasetId != null && typeof r.datasetId !== 'string') fail('dataset identity');
      if (r.provenance != null && (!object(r.provenance) || Object.values(r.provenance).some((p) => !object(p) || typeof p.source !== 'string'))) fail('record sources');
      if (r.provenance) Object.values(r.provenance).forEach(validateSource);
      if (r.excludes != null && (!Array.isArray(r.excludes) || r.excludes.some((x) => typeof x !== 'string'))) fail('partial coverage');
    }
  };
  validateAssignments(doc.assign);
  for (const parked of Object.values(doc.layerAssign)) {
    if (!object(parked) || !object(parked.assign)) fail('saved layer');
    if (parked.provenance != null) validateSource(parked.provenance);
    // Parked v1 assignments used bare numeric party ids too.
    parked.assign = migrate({ assign: parked.assign }).assign;
    validateAssignments(parked.assign);
  }
  if (!ids.has(doc.active)) doc.active = doc.parties[0].id;
  if (doc.selected && !doc.assign[doc.selected]) doc.selected = null;
  return doc;
}

let restoring = false;
export async function restoreDocument(input, { remember = true } = {}) {
  if (restoring) throw new Error('Another map is loading. Wait for it to finish and try again.');
  restoring = true;
  const before = JSON.stringify(state);
  try {
    const doc = validateDocument(structuredClone(input));
    const active = await prepareLayer(doc.layer);
    const checkKeys = (assign, layer, id) => {
      const missing = Object.keys(assign).filter((key) => !layer.byKey.has(key));
      if (missing.length) throw new Error(`${missing.length} saved regions are absent from ${id}, including ${missing[0]}. Restore the matching boundary files.`);
    };
    checkKeys(doc.assign, active, doc.layer);
    for (const [id, parked] of Object.entries(doc.layerAssign)) checkKeys(parked.assign, await loadLayerData(id), id);
    if (JSON.stringify(state) !== before) throw new Error('The map changed while the file was loading. Try opening it again.');
    if (remember) pushHistory('document');
    activate(doc.layer);
    Object.assign(state, doc);
    reserveIds(doc.parties.map((p) => p.id));
    emit('parties');
    return true;
  } finally {
    restoring = false;
  }
}
