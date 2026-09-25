/**
 * Stranding a row is not always a local failure.
 *
 * The Bangladesh 2024 article reports results by the Election Commission's ten
 * regions. Eight of those are divisions and match a boundary. The other two —
 * Cumilla and Faridpur — are not divisions at all: they are districts carved
 * out of divisions that *did* match. Cumilla District is part of Chattogram
 * Division and Faridpur District is part of Dhaka Division.
 *
 * So the Chattogram row does not describe the Chattogram polygon. It describes
 * Chattogram minus Cumilla, and the map fills the whole polygon with it. The
 * stranded row is visible; the damage it does to the row that matched is not.
 *
 * This finds that damage:
 *
 *   1. a stranded name is looked up in a deeper level of the same country
 *   2. if it resolves, its centroid is tested against the units that matched
 *   3. the containing unit is marked partial, recording what it excludes
 *
 * Nothing here guesses. A stranded name that does not resolve at a deeper level
 * stays stranded, and a resolved unit whose centroid falls inside nothing
 * matched is reported as exactly that.
 *
 * NAMING RULE. The footnote is a statement about the table's data, so it speaks
 * in the table's names throughout: "Chattogram excludes Cumilla". Polygon
 * labels speak in the boundary set's names, so the map says "Chittagong". Two
 * names for one place, each in its own voice, is a legible difference between
 * two sources; mixing them inside one sentence is not. The boundary spelling is
 * kept alongside in the audit record, where the comparison is the point.
 *
 * Every resolution the probe makes is recorded — the name the table used, the
 * unit it resolved to, and the parent it landed in — so a wrong one can be
 * audited afterwards instead of quietly standing.
 */

import { state } from '../state.js';
import { BOUNDARY, BY_KEY, layerCatalogue, loadLayerData } from '../geo.js';
import { buildIndex, matchUnit, scopeKey } from './match.js';
import { probeNames, bareName } from './renames.js';

/** ADM1 → ADM2 → ADM3. Deeper means more units inside the same country. */
const DEPTH = (level) => {
  const m = String(level || '').match(/^ADM(\d)$/i);
  return m ? Number(m[1]) : (String(level).toUpperCase() === 'CONSTITUENCY' ? 9 : 0);
};

/**
 * Layers of the same country at a deeper level, shallowest first — districts
 * before sub-districts, since the parent of a stranded region is more likely
 * one step down than three.
 */
async function deeperLayers(boundary) {
  if (!boundary) return [];
  const reg = await layerCatalogue();
  const here = DEPTH(boundary.level);
  return Object.entries(reg.sources)
    .filter(([, e]) => e.iso === boundary.iso && DEPTH(e.level) > here)
    .map(([layerId, e]) => ({ layerId, ...e }))
    .sort((a, b) => DEPTH(a.level) - DEPTH(b.level));
}

/**
 * @param {object} proposal
 * @returns {{partials: object[], resolved: object[], checked: boolean}}
 *   partials: [{ parentKey, parentName, excludes: [{ name, level, source }] }]
 */
export async function findPartitions(proposal) {
  const empty = { partials: [], resolved: [], checked: false };
  const boundary = BOUNDARY;
  if (!boundary) return empty;                 // the world layer has no deeper level here

  const stranded = proposal.rows.filter((r) => !r.unit && r.raw.unit);
  if (!stranded.length) return empty;

  const matched = proposal.rows.filter((r) => r.unit);
  if (!matched.length) return empty;

  let layers;
  try {
    layers = await deeperLayers(boundary);
  } catch (err) {
    return empty;
  }
  if (!layers.length) return empty;

  const byParent = new Map();
  const resolved = [];

  for (const entry of layers) {
    let deep;
    try {
      deep = await loadLayerData(entry.layerId);
    } catch (err) {
      continue;                                 // a level with no file is not an error
    }
    const index = buildIndex(deep.feats.map((f) => ({ key: f.key, name: f.name })));
    const scope = scopeKey(entry.layerId);

    for (const row of stranded) {
      if (row.partitionOf) continue;            // already explained by a shallower level

      // The probe may try a name without its level word, and either side of a
      // documented rename — see renames.js for why that is allowed here and
      // not in the matcher. Whatever it finds still has to be confirmed by
      // geometry below.
      let hit = null;
      for (const candidate of probeNames(boundary.iso, row.raw.unit)) {
        const attempt = matchUnit(candidate, index, scope);
        if (attempt.unit) { hit = attempt; break; }
      }
      if (!hit) continue;

      const feature = deep.byKey.get(hit.unit);
      if (!feature) continue;

      const parent = containingUnit(feature, matched);
      if (!parent) {
        // It resolved at depth but sits inside nothing that matched. Worth
        // saying, and not worth inventing a parent for.
        resolved.push({ row: row.i, name: feature.name, level: entry.level, parent: null });
        continue;
      }

      row.partitionOf = parent.unit;

      const record = {
        // What the table called each side of the relation.
        raw: bareName(row.raw.unit),
        parentRaw: bareName(parent.raw.unit),
        // What the boundary sets call them.
        resolvedName: feature.name,
        resolvedKey: hit.unit,
        parentKey: parent.unit,
        parentBoundaryName: proposal.index.nameOf.get(parent.unit) || parent.unit,
        level: entry.level,
        source: entry.sourceAgency,
        how: hit.how
      };
      resolved.push(record);
      log(record);

      if (!byParent.has(parent.unit)) byParent.set(parent.unit, []);
      byParent.get(parent.unit).push({
        // What the table called it. The parent is a thing on the map and takes
        // the boundary's name; the exclusion is a thing in the data and takes
        // the data's — the article reports "Cumilla" and the 2020 boundary set
        // still spells it "Comilla".
        name: bareName(row.raw.unit),
        boundaryName: feature.name,
        level: entry.level,
        source: entry.sourceAgency
      });
    }
  }

  const partials = [...byParent].map(([parentKey, excludes]) => {
    // Named as the table named it — see the naming rule above.
    const row = matched.find((r) => r.unit === parentKey);
    return {
      parentKey,
      parentName: row ? bareName(row.raw.unit) : (proposal.index.nameOf.get(parentKey) || parentKey),
      parentBoundaryName: proposal.index.nameOf.get(parentKey) || parentKey,
      excludes
    };
  });

  return { partials, resolved, checked: true };
}

/**
 * Every probe resolution, newest last. Kept in the module for the session and
 * written into the document on apply, because a claim nobody can check later is
 * a claim that stands unexamined.
 */
const probeLog = [];
export const probeHistory = () => probeLog.slice();

function log(record) {
  probeLog.push({ at: new Date().toISOString(), ...record });
  // eslint-disable-next-line no-console
  console.info(
    `[partition] "${record.raw}" resolved to ${record.resolvedName} (${record.level}, ` +
    `${record.source}, via ${record.how}) inside ${record.parentBoundaryName}`);
}

/** Centroid containment: enough to answer which matched unit a region sits in. */
function containingUnit(feature, matchedRows) {
  const point = d3.geoCentroid(feature);
  if (!point || !isFinite(point[0])) return null;

  for (const row of matchedRows) {
    const candidate = unitFeature(row.unit);
    if (candidate && d3.geoContains(candidate, point)) return row;
  }
  return null;
}

/** The active layer's feature for a key. BY_KEY is a live binding. */
const unitFeature = (key) => BY_KEY.get(key) || null;

/** Fold the partials into the records, so they save and reach the export. */
export function applyPartials(assign, partials) {
  for (const p of partials) {
    const rec = assign[p.parentKey];
    if (!rec) continue;
    assign[p.parentKey] = {
      ...rec,
      // The footnote reads from this; the detail below is what makes the claim
      // checkable once the review screen is long gone.
      excludes: p.excludes.map((e) => e.name),
      partialName: p.parentName,
      excludesDetail: p.excludes.map((e) => ({
        name: e.name, boundaryName: e.boundaryName, level: e.level, source: e.source
      }))
    };
  }
  return assign;
}

/** "Chattogram excludes Cumilla · Dhaka excludes Faridpur" */
export function partialNotes(assign, nameOf) {
  const out = [];
  for (const [key, rec] of Object.entries(assign || {})) {
    if (!rec || !rec.excludes || !rec.excludes.length) continue;
    // The table's name for the parent, recorded at apply time, in preference to
    // the boundary set's — one sentence, one voice.
    const name = rec.partialName || (nameOf && nameOf(key)) || key;
    out.push(`${name} excludes ${rec.excludes.join(', ')}`);
  }
  return out.sort();
}

/** Everything the export and the review need, from the document alone. */
export const documentPartials = () => partialNotes(
  state.assign,
  (key) => {
    const f = BY_KEY.get(key);
    return f ? f.name : key;
  }
);
