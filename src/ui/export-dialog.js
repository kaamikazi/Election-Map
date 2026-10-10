/**
 * Review and export.
 *
 * Review is the step before export, in the same dialog, so nothing can be
 * exported without the reviewer looking at what it claims: which election,
 * what status, how much is counted, where the numbers came from, what the
 * boundaries are. The rules live in publication.js; this file only shows them
 * and writes the reviewer's edits back to the document.
 *
 * A PNG can always be downloaded — drafts need looking at — but an unreviewed
 * image says DRAFT on it. The publication pack, the thing that gets posted,
 * is only available once nothing blocks it and a person has marked it ready.
 */

import { $, esc } from './dom.js';
import { state, emit } from '../state.js';
import { BY_KEY, LAYER, WORLD, BOUNDARY, layerCatalogue } from '../geo.js';
import { boundaryWarnings, resultsVintageWarning, vintageLine } from '../vintage.js';
import { toast } from './toast.js';
import { composite, dl, slug, currentReview, approveCurrentMap, provenanceLine, coverageLimitations, overrideLine } from '../export.js';
import { prepareExport } from '../flags.js';
import { STATUSES, STATUS_LABELS, PURPOSES, PURPOSE_LABELS, parseUpdatedInput, inputTimeAtOffset, validOffset, captionBasisFor } from '../publication.js';
import { profileById, customProfile, EXPORT_PROFILES } from '../pack.js';
import { buildPublicationPack, packContext } from '../publish.js';
import { captionText, captionLength } from '../pack.js';

let profileId = 'x-landscape';

/* --------------------------------------------------------------- profiles */

/** The profile chosen in the dialog; throws for a custom size that cannot work. */
function activeProfile() {
  if (profileId !== 'custom') return profileById(profileId);
  return customProfile(+$('#customW').value, +$('#customH').value);
}

function packProfiles() {
  const chosen = [...document.querySelectorAll('input[name="packProfile"]:checked')].map((i) => i.value);
  return chosen.map((id) => (id === 'custom' ? customProfile(+$('#customW').value, +$('#customH').value) : profileById(id)));
}

function options() {
  return { transparent: $('#xTrans').checked, withLegend: $('#xLegend').checked };
}

/* ---------------------------------------------------------- the metadata form */

const FIELDS = [
  ['pubElectionId', 'electionId', 'text'],
  ['pubCountry', 'country', 'text'],
  ['pubOffice', 'office', 'text'],
  ['pubType', 'electionType', 'text'],
  ['pubRound', 'round', 'int'],
  ['pubDate', 'electionDate', 'date'],
  ['pubPurpose', 'purpose', 'enum'],
  ['pubStatus', 'status', 'enum'],
  ['pubCounted', 'counted', 'number'],
  ['pubUpdated', 'updatedAt', 'utc'],
  ['pubNote', 'note', 'text']
];

function fillForm() {
  const pub = state.publication;
  $('#pubPurpose').innerHTML = '<option value="">Choose…</option>' +
    PURPOSES.map((p) => `<option value="${p}">${esc(PURPOSE_LABELS[p])}</option>`).join('');
  $('#pubStatus').innerHTML = '<option value="">Choose…</option>' +
    STATUSES.map((s) => `<option value="${s}">${esc(STATUS_LABELS[s])}</option>`).join('');
  for (const [id, key, kind] of FIELDS) {
    const v = pub[key];
    $('#' + id).value = kind === 'utc' ? inputTimeAtOffset(v, pub.timeInputOffset) : (v == null ? '' : String(v));
  }
  $('#pubOffset').value = pub.timeInputOffset || '';
  $('#pubTimeIssue').textContent = '';
  $('#pubHeadline').value = state.title;
  $('#pubSub').value = state.sub;
  $('#pubReady').checked = currentReview().publishable;
}

function readField(id, key, kind) {
  const raw = $('#' + id).value.trim();
  switch (kind) {
    case 'int': return raw !== '' && Number.isInteger(+raw) && +raw > 0 ? +raw : null;
    case 'number': return raw !== '' && Number.isFinite(+raw) ? +raw : null;
    case 'enum':
    case 'date': return raw || null;
    case 'utc': return parseUpdatedInput(raw, $('#pubOffset').value.trim());
    default:
      // The identity is absent or present; the descriptive fields may be empty.
      if (key === 'note') return $('#' + id).value;
      return key === 'electionId' ? (raw || null) : raw;
  }
}

/* ---------------------------------------------------------------- showing */

const li = (items, cls) => (items.length
  ? `<ul class="${cls}">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '');

/** Draft or ready, wherever the map's publication state is shown. */
export function syncPublicationChip() {
  const r = currentReview();
  for (const el of [$('#pubChip'), $('#pubStateDlg')]) {
    if (!el) continue;
    el.textContent = r.publishable ? 'Ready to publish' : 'Draft';
    el.dataset.state = r.publishable ? 'ready' : 'draft';
  }
  return r;
}

function renderReview() {
  const r = syncPublicationChip();
  $('#pubBlockers').innerHTML = r.blockers.length
    ? `<p class="pubhead">Publication is blocked until these are fixed. This map can still be saved and exported as a draft.</p>${li(r.blockers.map((b) => b.text), 'blockers')}`
    : '<p class="pubhead ok">Nothing blocks publication. Check the facts below, then mark it reviewed.</p>';
  $('#pubWarnings').innerHTML = li(r.warnings.map((w) => w.text), 'warns');

  const f = r.facts;
  const fact = (k, v) => `<dt>${esc(k)}</dt><dd>${v}</dd>`;
  const sources = f.sources.length
    ? f.sources.map((s) => `${esc(s.source)}${s.url ? ` · <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a>` : ''}${
      s.retrievedAt ? ` · retrieved/imported ${esc(s.retrievedAt)}` : ''}${
      s.evidence?.rawSha256 ? ` · Raw SHA-256: ${esc(s.evidence.rawSha256)}` : ''}${
      s.evidence?.capturedFile ? ` · <a href="${esc(s.evidence.capturedFile)}" target="_blank" rel="noopener">Captured raw file</a>` : ''}${
      s.manual ? ' <em>entered by hand, no source</em>' : (s.cited ? '' : ' <em>no link or citation</em>')}`).join('<br>')
    : '<em>No sourced values</em>';
  $('#pubFacts').innerHTML =
    fact('Status', f.statusLabel ? `<b>${esc(f.statusLabel)}</b>` : '<em>Not set</em>') +
    fact('Timeframe', esc(f.timeframe)) +
    fact('Source updated', f.updated ? esc(f.updated) : '<em>Not stated</em>') +
    fact('Sources', sources) +
    fact('Boundaries', esc(f.boundary)) +
    (f.mixed ? fact('Mixed sources', 'Yes — disclosed in the export and the caption') : '') +
    (f.manualValues ? fact('Hand-entered values', 'Yes — no source') : '');

  const ready = $('#pubReady');
  ready.disabled = r.blockers.length > 0;
  if (ready.disabled) ready.checked = false;
  const pack = $('#btnPack');
  pack.disabled = !r.publishable;
  pack.title = r.publishable ? '' : (r.blockers.length ? 'Fix the blocking items first' : 'Mark the map reviewed first');
  return r;
}

function renderTexts(r, profile) {
  const t = (k, v) => (v ? `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>` : '');
  const flagMode = state.mode === 'flags';
  const caveat = [vintageLine(BOUNDARY), flagMode ? '' : coverageLimitations(), flagMode ? '' : overrideLine()]
    .filter(Boolean).join(' ');
  $('#exportTexts').innerHTML =
    t('Status badge', r.badge || 'None — unsourced map with no status') +
    t('Headline', state.title.trim() || '(none)') +
    t('Subtitle', state.sub.trim()) +
    t('Source footer', flagMode ? '' : provenanceLine()) +
    t('Boundary and coverage', caveat) +
    (r.facts.mixed ? t('Mixed sources', 'The footer lists every source; each value keeps its own.') : '') +
    captionPreview(r);
  $('#profileDims').textContent = profile ? `${profile.label} · ${profile.width} × ${profile.height} px` : '';
}

/** The exact editable caption, with an explicitly estimated X length. */
function captionPreview(r) {
  let text;
  try { text = state.publication.captionDraft ?? captionText(packContext(r, [])); } catch (err) { return ''; }
  const n = captionLength(text);
  const over = n > 280 ? ' — estimated over the standard 280-character limit' : n >= 250 ? ' — near the standard limit; check in X before posting' : '';
  const stale = state.publication.captionDraft != null && state.publication.captionBasis !== captionBasisFor(state);
  return `<dt>Caption draft</dt><dd><textarea id="pubCaption" rows="9" aria-label="Caption draft">${esc(text)}</textarea>
    <p class="hint" id="captionCount">Estimated ${n} / 280 weighted characters${over}. Links count as 23; Unicode and emoji can differ in X. Confirm in X before posting.</p>
    ${stale ? '<p class="err">Metadata changed since this caption was reviewed. Check every status, source and caveat.</p>' : ''}
    <button type="button" class="btn" id="captionRegenerate">Regenerate from metadata</button>
    ${stale ? '<button type="button" class="btn" id="captionAcknowledge">Keep reviewed caption</button>' : ''}</dd>`;
}

let pending = null;
/** Re-run the review and redraw, at most once per frame while someone types. */
function refresh() {
  if (pending) return;
  pending = requestAnimationFrame(async () => {
    pending = null;
    const r = renderReview();
    let profile = null;
    try { profile = activeProfile(); } catch (err) { return exportError(err); }
    renderTexts(r, profile);
    await drawPreview(profile);
  });
}

/* ---------------------------------------------------------------- export */

/**
 * Say it before the image exists, not after it is posted: a map of an election
 * that predates a border change is drawn on borders that did not exist then.
 */
async function boundaryWarningLines() {
  const asOf = state.publication.electionDate || (state.provenance && state.provenance.asOf);
  if (!asOf) return [];
  const names = Object.keys(state.assign).map((k) => BY_KEY.get(k)).filter(Boolean).map((f) => f.name);
  if (LAYER !== WORLD && BOUNDARY) {
    try {
      const reg = await layerCatalogue();
      if (reg.countries[BOUNDARY.iso]) names.push(reg.countries[BOUNDARY.iso]);
    } catch (err) { /* no registry, no country name to add */ }
  }
  const lines = boundaryWarnings(String(asOf).slice(0, 10), names, BOUNDARY).map((w) => w.what);
  const gap = resultsVintageWarning(String(asOf).slice(0, 10), BOUNDARY);
  if (gap) lines.push(gap.text);
  return lines;
}

async function ready() {
  try {
    await prepareExport();
    return true;
  } catch (err) {
    exportError(err);
    return false;
  }
}

async function drawPreview(profile) {
  const box = $('#exportWarn');
  const warn = await boundaryWarningLines();
  if (!(await ready())) return;
  const pv = $('#preview');
  pv.width = profile.width; pv.height = profile.height;
  try {
    pv.getContext('2d').drawImage(composite(profile.width, profile.height, options()), 0, 0);
    box.innerHTML = li(warn, 'warns');
  } catch (err) {
    exportError(err, warn);
  }
}

/** An export that cannot be truthful stops and says why, where the reviewer is looking. */
function exportError(err, extra = []) {
  $('#exportWarn').innerHTML = li([`Export stopped: ${err.message}`, ...extra], 'warns errors');
  toast(`Export stopped: ${err.message}`);
}

export function initExportDialog() {
  const dlg = $('#exportDlg');

  $('#openExport').addEventListener('click', () => {
    fillForm();
    dlg.showModal();
    refresh();
  });
  $('#closeExport').addEventListener('click', () => dlg.close());

  // Metadata edits go straight into the document. Changing anything the
  // reviewer signed off withdraws the sign-off.
  for (const [id, key, kind] of FIELDS) {
    if (kind === 'utc') continue;
    const el = $('#' + id);
    el.addEventListener(el.tagName === 'SELECT' || kind === 'date' ? 'change' : 'input', () => {
      state.publication[key] = readField(id, key, kind);
      state.publication.ready = false;
      $('#pubReady').checked = false;
      refresh();
    });
  }
  const updateTime = () => {
    const offset = $('#pubOffset').value.trim();
    state.publication.timeInputOffset = validOffset(offset) ? offset : null;
    try {
      state.publication.updatedAt = readField('pubUpdated', 'updatedAt', 'utc');
      $('#pubTimeIssue').textContent = '';
    } catch (err) {
      state.publication.updatedAt = null;
      $('#pubTimeIssue').textContent = err.message;
    }
    state.publication.ready = false;
    $('#pubReady').checked = false;
    refresh();
  };
  $('#pubUpdated').addEventListener('change', updateTime);
  $('#pubOffset').addEventListener('change', updateTime);
  $('#pubHeadline').addEventListener('input', (e) => {
    state.title = e.target.value; $('#fTitle').value = e.target.value;
    state.publication.ready = false; $('#pubReady').checked = false;
    refresh();
  });
  $('#pubSub').addEventListener('input', (e) => {
    state.sub = e.target.value; $('#fSub').value = e.target.value;
    state.publication.ready = false; $('#pubReady').checked = false;
    refresh();
  });
  $('#pubReady').addEventListener('change', (e) => {
    if (e.target.checked) {
      try { approveCurrentMap(); } catch (err) { toast(err.message); state.publication.ready = false; }
    } else state.publication.ready = false;
    e.target.checked = state.publication.ready;
    refresh();
    emit('view');
  });

  $('#exportTexts').addEventListener('input', (e) => {
    if (e.target.id !== 'pubCaption') return;
    state.publication.captionDraft = e.target.value;
    state.publication.captionBasis = captionBasisFor(state);
    state.publication.ready = false;
    $('#pubReady').checked = false;
    const n = captionLength(e.target.value);
    $('#captionCount').textContent = `Estimated ${n} / 280 weighted characters${n > 280 ? ' — estimated over the standard limit' : n >= 250 ? ' — near the limit' : ''}. Links count as 23; Unicode and emoji can differ in X. Confirm in X before posting.`;
    renderReview();
  });
  $('#exportTexts').addEventListener('click', (e) => {
    if (e.target.id === 'captionRegenerate') {
      state.publication.captionDraft = null;
      state.publication.captionBasis = null;
      state.publication.ready = false;
      refresh();
    }
    if (e.target.id === 'captionAcknowledge') {
      state.publication.captionBasis = captionBasisFor(state);
      state.publication.ready = false;
      refresh();
    }
  });

  $('#profileSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    profileId = b.dataset.profile;
    [...e.currentTarget.children].forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    $('#customSize').hidden = profileId !== 'custom';
    refresh();
  });
  $('#customW').addEventListener('input', refresh);
  $('#customH').addEventListener('input', refresh);
  $('#xLegend').addEventListener('change', refresh);
  $('#xTrans').addEventListener('change', refresh);

  $('#btnPng').addEventListener('click', async () => {
    if (!(await ready())) return;
    try {
      const p = activeProfile();
      const r = currentReview();
      composite(p.width, p.height, options()).toBlob((b) => {
        dl(b, `${slug('election-map')}-${p.id}-${p.width}x${p.height}${r.publishable ? '' : '-draft'}.png`);
        toast(r.publishable ? 'PNG downloaded' : 'Draft PNG downloaded — it is marked DRAFT');
      }, 'image/png');
    } catch (err) { exportError(err); }
  });

  $('#btnCopy').addEventListener('click', async () => {
    if (!(await ready())) return;
    try {
      const p = activeProfile();
      const blob = await new Promise((r) => composite(p.width, p.height, options()).toBlob(r, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('Copied — paste it into your post');
    } catch (e) {
      toast(e && e.message && /fit|space|status/i.test(e.message) ? `Export stopped: ${e.message}` : 'Copying is blocked here. Download instead.');
    }
  });

  $('#btnPack').addEventListener('click', async () => {
    try {
      const pack = await buildPublicationPack(packProfiles(), { withLegend: $('#xLegend').checked });
      dl(new Blob([pack.bytes], { type: 'application/zip' }), pack.name);
      toast(`Publication pack downloaded: ${pack.files.length} files`);
    } catch (err) { exportError(err); }
  });
}

export { EXPORT_PROFILES };
