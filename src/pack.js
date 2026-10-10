/**
 * The publication pack: everything a person needs to post one reviewed map by
 * hand — the images, an editable caption, the metadata and provenance, and the
 * methodology when there are caveats to state.
 *
 * Pure. Every function takes its inputs explicitly and returns text or bytes,
 * so the pack is deterministic: the same reviewed map produces the same files,
 * byte for byte, and the tests read those files directly. No AI model writes
 * the caption; it is assembled from the metadata by fixed rules, and it is a
 * draft for a person to edit, not a finished post.
 */

import { statusLabel, formatUpdated, standingsPrefix, STATUS_LABELS, PURPOSE_LABELS } from './publication.js';

/* ------------------------------------------------------------------ profiles */

export const EXPORT_PROFILES = Object.freeze([
  Object.freeze({ id: 'x-landscape', label: 'X landscape', width: 1600, height: 900 }),
  Object.freeze({ id: 'x-square', label: 'X square', width: 1200, height: 1200 }),
  Object.freeze({ id: 'x-portrait', label: 'X portrait', width: 1080, height: 1350 })
]);

export const CUSTOM_LIMITS = Object.freeze({ min: 600, max: 4096, maxAspect: 3 });

export const profileById = (id) => EXPORT_PROFILES.find((p) => p.id === id) || null;

/** A custom size, checked rather than trusted: too small and the attribution cannot be read. */
export function customProfile(width, height) {
  const w = Number(width), h = Number(height);
  const { min, max, maxAspect } = CUSTOM_LIMITS;
  if (!Number.isInteger(w) || !Number.isInteger(h)) throw new Error('A custom size needs whole-number width and height.');
  if (w < min || h < min || w > max || h > max) throw new Error(`A custom size must be between ${min} and ${max} pixels on each side.`);
  if (Math.max(w / h, h / w) > maxAspect) throw new Error(`A custom size cannot be more than ${maxAspect}:1 in either direction.`);
  return { id: 'custom', label: 'Custom', width: w, height: h };
}

export const profileFile = (p, slug) => `${slug}-${p.id}-${p.width}x${p.height}.png`;

/* ------------------------------------------------------------------ naming */

export function packSlug(pub, title) {
  const base = [pub.electionId || title || 'election-map', pub.status || 'draft']
    .join('-').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (base || 'election-map').slice(0, 80);
}

/* ------------------------------------------------------------------ caption */

export function statusSentence(pub) {
  const counted = pub.counted != null ? `${Math.round(pub.counted * 10) / 10}% counted` : null;
  const asOf = formatUpdated(pub.updatedAt);
  switch (pub.status) {
    case 'official-final': return 'Official final result.';
    case 'official-partial':
      return `Official partial result${counted ? `: ${counted}` : ''}${asOf ? ` as of ${asOf}` : ''}. Not final.`;
    case 'projected':
      return `Projection, not a final result${counted ? ` (${counted})` : ''}${asOf ? `, as of ${asOf}` : ''}.`;
    case 'disputed': return 'The result is disputed and not settled.';
    case 'recount': return 'A recount is pending. The result is not final.';
    case 'polls-open': return `Polls are open. There are no results yet${asOf ? ` (as of ${asOf})` : ''}.`;
    case 'upcoming': return pub.electionDate ? `Upcoming election on ${pub.electionDate}.` : 'Upcoming election.';
    case 'historical': return `Historical archive${pub.electionDate ? ` (${pub.electionDate.slice(0, 4)})` : ''}, not current reporting.`;
    default: return '';
  }
}

/**
 * Short caveats for the caption: only the ones a reader needs in order not to
 * be misled. The full account goes in source-and-methodology.txt.
 */
export function captionCaveats(ctx) {
  const out = [];
  if (ctx.mixed) out.push(`Compiled from ${ctx.sources.length} sources.`);
  if (ctx.gaps.length) out.push(`No reliable archive record for ${ctx.gaps.join(', ')}.`);
  if (ctx.override) out.push('Drawn on boundaries redrawn since the vote.');
  if (ctx.vintageGap) out.push('Boundaries and results are from different years.');
  if (ctx.modernBorders) out.push('Drawn on present-day borders.');
  if ((ctx.publication.note || '').trim()) out.push(ctx.publication.note.trim());
  return out;
}

/**
 * The caption. Fixed structure, fixed wording per status:
 *   headline
 *   identity — country · office · type · round · date
 *   status sentence (never "final" unless it is)
 *   who holds what, worded for the status (leaders, not winners, until final)
 *   caveats
 *   sources, with their exact links
 */
export function captionText(ctx) {
  const pub = ctx.publication;
  const lines = [];
  if (ctx.title) lines.push(ctx.title);
  const identity = [pub.country, pub.office, pub.electionType,
    pub.round ? `Round ${pub.round}` : null, pub.electionDate].filter((x) => x && String(x).trim());
  if (identity.length) lines.push(identity.join(' · '));
  const sentence = statusSentence(pub);
  if (sentence) lines.push(sentence);
  if (pub.updatedAt && !sentence.includes(formatUpdated(pub.updatedAt))) {
    lines.push(`Source last updated: ${formatUpdated(pub.updatedAt)}.`);
  }

  const showStandings = ctx.standings.length && !['upcoming', 'polls-open'].includes(pub.status) &&
    !['flags', 'explainer', 'upcoming'].includes(pub.purpose);
  if (showStandings) {
    const parts = ctx.standings.map((s) => `${s.name} ${s.n}`).join(' · ');
    lines.push(`${standingsPrefix(pub.status, ctx.noun)}: ${parts}.`);
  }
  if (ctx.flagged && ctx.flagged.length) lines.push(ctx.flagged.join(' · '));

  lines.push(...captionCaveats(ctx));

  for (const s of ctx.sources) {
    if (s.manual) continue;
    lines.push(`Source: ${s.source}${s.url ? ' ' + s.url : ''}`);
  }
  return lines.join('\n') + '\n';
}

/** Essential facts survive hand editing; wording beyond these remains editorial. */
export function captionMissing(ctx, text) {
  const missing = [];
  const sentence = statusSentence(ctx.publication);
  if (sentence && !text.includes(sentence)) missing.push('the result status and update time');
  if (ctx.publication.updatedAt && !text.includes(formatUpdated(ctx.publication.updatedAt))) {
    missing.push('the source update instant');
  }
  for (const source of ctx.sources || []) {
    if (source.url && !text.includes(source.url)) missing.push(`source link ${source.url}`);
  }
  for (const caveat of captionCaveats(ctx)) if (!text.includes(caveat)) missing.push(`caveat: ${caveat}`);
  return missing;
}

/** Estimate only: handles links and common weighted code points, not all emoji clusters. */
export function captionLength(text) {
  const replaced = String(text).replace(/https?:\/\/\S+/g, 'x'.repeat(23));
  let n = 0;
  for (const ch of replaced) {
    const code = ch.codePointAt(0);
    n += (code <= 4351 || (code >= 8192 && code <= 8205) ||
      (code >= 8208 && code <= 8223) || (code >= 8242 && code <= 8247)) ? 1 : 2;
  }
  return n;
}

/* ------------------------------------------------------------------ methodology */

/** Whether the map has caveats worth their own file. */
export function hasMeaningfulCaveats(ctx) {
  const pub = ctx.publication;
  return !!(ctx.mixed || ctx.gaps.length || ctx.notes.length || ctx.override || ctx.vintageGap || ctx.modernBorders ||
    ctx.warnings.length || (pub.note || '').trim() ||
    ['official-partial', 'projected', 'disputed', 'recount', 'historical'].includes(pub.status) ||
    ctx.boundaryLine);
}

export function methodologyText(ctx) {
  const pub = ctx.publication;
  const out = [];
  out.push('SOURCE AND METHODOLOGY');
  out.push('');
  out.push(`Map: ${ctx.title || '(no headline)'}`);
  out.push(`Election identity: ${pub.electionId || '(not stated)'}`);
  out.push(`Purpose: ${pub.purpose ? PURPOSE_LABELS[pub.purpose] : '(not stated)'}`);
  out.push(`Status: ${pub.status ? STATUS_LABELS[pub.status] : '(not stated)'} — badge "${statusLabel(pub) || 'none'}"`);
  if (pub.counted != null) out.push(`Counted: ${pub.counted}%`);
  if (pub.updatedAt) out.push(`Result or source last updated: ${formatUpdated(pub.updatedAt)}`);
  out.push(`Election date: ${pub.electionDate || '(not stated)'} (the date of the vote, not of retrieval)`);
  out.push('');
  out.push('Sources');
  if (!ctx.sources.length) out.push('- None. This map carries no sourced values.');
  for (const s of ctx.sources) {
    out.push(`- ${s.source}${s.url ? ` — ${s.url}` : ''}${s.licence ? ` — ${s.licence}` : ''}${s.manual ? ' (entered by hand, unverified)' : ''}`);
    if (s.retrievedAt) out.push(`  Retrieved or imported: ${s.retrievedAt} (not the result update time)`);
  }
  if (ctx.mixed) out.push('Values on this map come from more than one source. Each value records its own source in metadata.json.');
  out.push('');
  out.push('Boundaries');
  out.push(ctx.boundaryLine || 'World outline: Natural Earth, present-day borders. Historical maps are drawn on modern outlines.');
  if (ctx.override) out.push('Results were deliberately drawn on boundaries redrawn after they were cast. Units that kept their name may not have kept their ground.');
  if (ctx.vintageGap) out.push(ctx.vintageGap);
  if (ctx.gaps.length || ctx.notes.length) {
    out.push('');
    out.push('Coverage');
    if (ctx.gaps.length) out.push(`No reliable archive record for: ${ctx.gaps.join(', ')}. Left blank rather than guessed.`);
    for (const n of ctx.notes) out.push(n);
  }
  if (ctx.warnings.length) {
    out.push('');
    out.push('Review notes');
    for (const w of ctx.warnings) out.push(`- ${w}`);
  }
  if ((pub.note || '').trim()) {
    out.push('');
    out.push('Editorial note');
    out.push(pub.note.trim());
  }
  out.push('');
  out.push('Before posting, a person must still check: the election identity, date,');
  out.push('office and round; the status and percentage counted against the source;');
  out.push('the source link and revision; the party grouping and colours; the boundary');
  out.push('set; and the finished image and caption.');
  return out.join('\n') + '\n';
}

/* ------------------------------------------------------------------ metadata */

export function metadataJson(ctx) {
  const pub = ctx.publication;
  const doc = {
    kind: 'election-map-studio/publication-pack',
    version: 1,
    headline: ctx.title || '',
    subtitle: ctx.sub || '',
    handle: ctx.handle || '',
    publication: {
      electionId: pub.electionId, country: pub.country, office: pub.office,
      electionType: pub.electionType, round: pub.round, electionDate: pub.electionDate,
      purpose: pub.purpose, status: pub.status, counted: pub.counted,
      updatedAt: pub.updatedAt, timeInputOffset: pub.timeInputOffset,
      note: pub.note, ready: pub.ready
    },
    statusBadge: ctx.badge,
    timeframe: ctx.timeframe,
    layer: ctx.layer,
    boundary: ctx.boundaryLine || null,
    sources: ctx.sources,
    mixedSources: ctx.mixed,
    coverage: { units: ctx.units, gaps: ctx.gaps, notes: ctx.notes },
    caveats: captionCaveats(ctx),
    review: { blockers: ctx.blockers, warnings: ctx.warnings },
    images: ctx.images,
    caption: { file: 'caption.txt', estimatedXLength: ctx.captionLength, edited: ctx.publication.captionDraft != null },
    values: ctx.values
  };
  return JSON.stringify(doc, null, 2) + '\n';
}

/* ------------------------------------------------------------------ files */

const enc = new TextEncoder();

/**
 * Every file in the pack, in a fixed order.
 * `ctx.pngs` maps each image's file name to its PNG bytes.
 */
export function packFiles(ctx) {
  if (!ctx.reviewed || ctx.blockers.length) throw new Error('A publication pack requires an approved, unblocked review.');
  const caption = ctx.publication.captionDraft ?? captionText(ctx);
  const missing = captionMissing(ctx, caption);
  if (missing.length) throw new Error(`The edited caption omits ${missing[0]}. Review or regenerate it before exporting.`);
  const full = { ...ctx, captionLength: captionLength(caption) };
  const files = [];
  for (const img of ctx.images) {
    const png = ctx.pngs?.[img.file];
    if (!(png instanceof Uint8Array) || png.length < 8 ||
        ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => png[i] === byte)) {
      throw new Error(`Missing or invalid PNG for ${img.file}. No publication pack was built.`);
    }
    files.push({ name: img.file, data: png });
  }
  files.push({ name: 'caption.txt', data: enc.encode(caption) });
  files.push({ name: 'metadata.json', data: enc.encode(metadataJson(full)) });
  if (hasMeaningfulCaveats(ctx)) {
    files.push({ name: 'source-and-methodology.txt', data: enc.encode(methodologyText(ctx)) });
  }
  return files;
}

/* ------------------------------------------------------------------ zip */

/*
 * A stored (uncompressed) ZIP, so the pack is one download. PNGs are already
 * compressed and the text files are small, so deflate would buy little and
 * cost a dependency. Every entry carries the same fixed timestamp
 * (1980-01-01 00:00, the format's epoch) so the archive is deterministic.
 */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export function zipStore(files) {
  const DOS_TIME = 0, DOS_DATE = (0 << 9) | (1 << 5) | 1;
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = f.data instanceof Uint8Array ? f.data : enc.encode(String(f.data));
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint16(10, DOS_TIME, true); local.setUint16(12, DOS_DATE, true);
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true);
    cd.setUint16(12, DOS_TIME, true); cd.setUint16(14, DOS_DATE, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((n, b) => n + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, b) => n + b.length, 0));
  let at = 0;
  for (const b of all) { out.set(b, at); at += b.length; }
  return out;
}

/** Read a stored ZIP back into { name: bytes }. Used by the tests and the demonstration. */
export function unzipStore(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = {};
  let at = 0;
  const dec = new TextDecoder();
  while (at + 30 <= bytes.length && v.getUint32(at, true) === 0x04034b50) {
    const size = v.getUint32(at + 18, true);
    const nameLen = v.getUint16(at + 26, true), extra = v.getUint16(at + 28, true);
    const name = dec.decode(bytes.subarray(at + 30, at + 30 + nameLen));
    const start = at + 30 + nameLen + extra;
    const data = bytes.slice(start, start + size);
    if (crc32(data) !== v.getUint32(at + 14, true)) throw new Error(`CRC mismatch in ${name}`);
    out[name] = data;
    at = start + size;
  }
  return out;
}
