/** Attribution follows values, never the most recently opened source. */
export const RECORD_FIELDS = ['party', 'label', 'vote', 'seats', 'turnout', 'margin'];
export const MANUAL_SOURCE = { source: 'Manual / unverified data', datasetId: null };

export function sourceRecord(src = {}) {
  return {
    source: src.label || src.source || 'Unspecified source', url: src.url || null,
    datasetId: src.datasetId || null, asOf: src.asOf || null,
    importId: src.importId || null,
    asOfPrecision: src.asOfPrecision || null, fetchedAt: src.fetchedAt || null,
    cite: src.cite || null, gaps: src.gaps || [], notes: src.notes || [],
    vintageOverride: src.vintageOverride || null
  };
}

// Old documents have only map-wide attribution. It cannot establish which
// retained value came from that source, so do not upgrade it into certainty.
export function recordSources(record) {
  const out = {};
  for (const key of RECORD_FIELDS) {
    if (record[key] != null) out[key] = record.provenance?.[key] || MANUAL_SOURCE;
  }
  return out;
}

export function documentSources(assign) {
  const sources = new Map();
  for (const rec of Object.values(assign)) {
    for (const src of Object.values(recordSources(rec))) {
      const key = JSON.stringify(src);
      sources.set(key, src);
    }
  }
  return [...sources.values()];
}

export function summariseSources(assign, extra = {}) {
  const sources = documentSources(assign);
  const dates = new Set(sources.map((s) => s.asOf));
  const ids = new Set(sources.map((s) => s.datasetId));
  return {
    ...extra, ...(sources.length === 1 ? sources[0] : { url: null, cite: null, fetchedAt: null, vintageOverride: null }), sources,
    source: sources.length === 1 ? sources[0].source : 'Mixed sources',
    mixed: sources.length > 1, covered: Object.keys(assign).length,
    asOf: dates.size === 1 ? sources[0]?.asOf : null,
    datasetId: ids.size === 1 ? sources[0]?.datasetId : null
  };
}
