/**
 * The browser half of the publication pack: read the live document, render
 * one PNG per chosen profile through the same composite() every export uses,
 * and hand the lot to the pure builders in pack.js.
 */

import { state, standings } from './state.js';
import { BOUNDARY, LAYER, WORLD } from './geo.js';
import { composite, currentReview, coverageLimitations } from './export.js';
import { prepareExport } from './flags.js';
import { vintageLine } from './vintage.js';
import { documentSources, recordSources } from './provenance.js';
import { reviewFingerprint } from './publication.js';
import { packFiles, packSlug, profileFile, zipStore } from './pack.js';
import { BY_KEY } from './geo.js';

const unitNoun = () => {
  if (LAYER === WORLD || !BOUNDARY) return 'country';
  const l = (BOUNDARY.label || '').toLowerCase();
  return !l || /^adm\d$/.test(l) ? 'region' : l;
};

/** Everything the pure builders need, read once from the document. */
export function packContext(review, profiles) {
  const pub = review.publication;
  const flagMode = state.mode === 'flags';
  const sources = flagMode ? [] : documentSources(state.assign);
  const slug = packSlug(pub, state.title);
  const limitations = flagMode ? [] : sources.flatMap((s) => s.notes || []);
  return {
    publication: pub,
    reviewed: review.publishable,
    title: state.title.trim(),
    sub: state.sub.trim(),
    handle: state.handle.trim(),
    badge: review.badge,
    timeframe: review.facts.timeframe,
    noun: unitNoun(),
    standings: flagMode ? [] : standings().map(({ p, n }) => ({ name: p.name, n })),
    flagged: flagMode ? Object.keys(state.flagged).map((k) => (BY_KEY.get(k) || {}).name || k) : [],
    sources: review.facts.sources,
    mixed: review.facts.mixed,
    units: flagMode ? Object.keys(state.flagged).length : Object.keys(state.assign).length,
    gaps: [...new Set(sources.flatMap((s) => (s.gaps || []).map((g) => g.unit)))],
    notes: [...new Set(limitations)],
    override: sources.some((s) => s.vintageOverride) || !!state.provenance?.vintageOverride,
    vintageGap: (review.warnings.find((w) => w.code === 'vintage-gap') || {}).text || null,
    modernBorders: pub.status === 'historical' && LAYER === WORLD,
    warnings: review.warnings.map((w) => w.text),
    blockers: review.blockers.map((b) => b.text),
    boundaryLine: vintageLine(BOUNDARY) || null,
    limitationsLine: flagMode ? '' : coverageLimitations(),
    layer: state.layer,
    images: profiles.map((p) => ({ profile: p.id, label: p.label, width: p.width, height: p.height, file: profileFile(p, slug) })),
    // Per-value provenance, so every number in the image can be traced.
    values: flagMode ? {} : Object.fromEntries(Object.entries(state.assign).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, r]) => [key, {
        name: (BY_KEY.get(key) || {}).name || key,
        party: (state.parties.find((p) => p.id === r.party) || {}).name || null,
        label: r.label ?? null, vote: r.vote ?? null, seats: r.seats ?? null,
        turnout: r.turnout ?? null, margin: r.margin ?? null,
        ingestion: r.ingestion || null,
        catalog: r.catalog || null,
        sources: Object.fromEntries(Object.entries(recordSources(r)).map(([f, s]) => [f, s.source]))
      }])),
    slug
  };
}

const pngBytes = (canvas) => new Promise((resolve, reject) => canvas.toBlob((b) => {
  if (!b) return reject(new Error('The browser could not encode the image.'));
  b.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
}, 'image/png'));

/**
 * Build the pack for the map on screen. Refuses unless the review has no
 * blockers and a person has marked the map ready: a pack is the thing that
 * gets posted, and a draft must not be one keystroke from the timeline.
 *
 * @returns {{ name: string, bytes: Uint8Array, files: {name, data}[] }}
 */
export async function buildPublicationPack(profiles, { now = Date.now(), withLegend = true } = {}) {
  if (!profiles || !profiles.length) throw new Error('Choose at least one export profile for the pack.');
  const review = currentReview(now);
  if (review.blockers.length) throw new Error(`Publication is blocked: ${review.blockers[0].text}`);
  if (!review.publishable) throw new Error('Mark the map "reviewed — ready to publish" before exporting the pack.');
  const initialFingerprint = reviewFingerprint(state);
  const stillReviewed = () => {
    if (reviewFingerprint(state) !== initialFingerprint || !currentReview(now).publishable) {
      throw new Error('The map or publication metadata changed while the pack was being built. Review the current map and try again.');
    }
  };
  await prepareExport();
  stillReviewed();

  const ctx = packContext(review, profiles);
  ctx.pngs = {};
  for (const img of ctx.images) {
    // composite() throws with an actionable message if the profile cannot fit
    // the status and attribution; that message reaches the reviewer unchanged.
    const cv = composite(img.width, img.height, { now, withLegend });
    ctx.pngs[img.file] = await pngBytes(cv);
    stillReviewed();
  }
  stillReviewed();
  const files = packFiles(ctx);
  return { name: `${ctx.slug}-publication-pack.zip`, bytes: zipStore(files), files };
}
