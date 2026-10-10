/** Historical locator documents use the existing map and composite renderers.
 * Institution sizes are prose facts, never assignment records or seat metrics.
 */
import { state, DOCUMENT_DEFAULTS } from './state.js';
import { presentation, bodyFont, capsFont } from './identity.js';

export async function athensDocument(theme = 'light') {
  const response = await fetch('/data/athens-democracy.json');
  if (!response.ok) throw new Error('The Athens source pack could not load.');
  const pack = await response.json();
  return { version: 7, ...structuredClone(DOCUMENT_DEFAULTS),
    identity: 'history', theme, proj: 'mercator',
    title: pack.title, sub: pack.subtitle, fit: pack.fit,
    explainer: pack.explainer };
}

export function validateExplainer(doc) {
  const e = doc.explainer;
  if (e == null) return;
  const text = (s) => typeof s === 'string' && s.trim().length > 0;
  const list = (a, check) => Array.isArray(a) && a.length > 0 && a.every(check);
  if (e.kind !== 'historical-locator' || !text(e.countryKey) || !text(e.period) ||
      !text(e.legend) || !text(e.caveat) || !text(e.geography) ||
      !list(e.facts, f => f && text(f.label) && text(f.detail)) ||
      !list(e.sources, s => s && text(s.label) && text(s.url) && /^https:\/\//.test(s.url)) ||
      !e.point || !text(e.point.label) || !Array.isArray(e.point.coordinates) ||
      e.point.coordinates.length !== 2 || !e.point.coordinates.every(Number.isFinite) ||
      Math.abs(e.point.coordinates[0]) > 180 || Math.abs(e.point.coordinates[1]) > 90) {
    throw new Error('Invalid historical locator content.');
  }
  assertExplainerCompatible(doc);
}

export function assertExplainerCompatible(doc = state) {
  if (!doc.explainer) return;
  if (doc.layer !== 'world' || doc.mode !== 'results' || doc.metric !== 'flat' ||
      Object.keys(doc.assign).length || Object.keys(doc.flagged).length || doc.provenance) {
    throw new Error('Historical locators cannot contain election results, flags or electoral layers. Import results or leave the explainer before adding them.');
  }
}

export function explainerFooter() {
  const e = state.explainer;
  if (!e) return [];
  return [e.legend, e.caveat, e.geography,
    `Reform period: ${e.period}.`,
    ...e.sources.map(s => `${s.label} · ${s.url.replace(/^https:\/\//, '')}`),
    ...(state.handle.trim() ? [state.handle.trim()] : [])];
}

/** Three fact columns, measured before reserving the map box. */
export function drawExplainerFacts(c, W, top, k, pad, { lines, wrap }) {
  const e = state.explainer;
  if (!e) return top;
  const T = presentation(), gap = 28 * k;
  const columns = Math.min(3, e.facts.length), width = (W - pad * 2 - gap * (columns - 1)) / columns;
  let y = top;
  for (let start = 0; start < e.facts.length; start += columns) {
    const row = e.facts.slice(start, start + columns);
    c.font = `600 ${Math.round(24 * k)}px ${capsFont()}`;
    const labelHeight = Math.max(...row.map(f => lines(c, f.label, width))) * 30 * k;
    c.font = `400 ${Math.round(21 * k)}px ${bodyFont()}`;
    const detailHeight = Math.max(...row.map(f => lines(c, f.detail, width))) * 26 * k;
    row.forEach((f, i) => {
      const x = pad + i * (width + gap);
      c.textAlign = 'left'; c.textBaseline = 'top'; c.fillStyle = T.text;
      c.font = `600 ${Math.round(24 * k)}px ${capsFont()}`;
      wrap(c, f.label, x, y, width, 30 * k);
      c.font = `400 ${Math.round(21 * k)}px ${bodyFont()}`;
      c.fillStyle = T.muted;
      wrap(c, f.detail, x, y + labelHeight + 4 * k, width, 26 * k);
    });
    y += labelHeight + detailHeight + 26 * k;
  }
  return y;
}
