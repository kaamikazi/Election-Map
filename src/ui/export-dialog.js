import { $, esc } from './dom.js';
import { state } from '../state.js';
import { BY_KEY, LAYER, WORLD, BOUNDARY, layerCatalogue } from '../geo.js';
import { boundaryWarnings, resultsVintageWarning } from '../vintage.js';
import { toast } from './toast.js';
import { composite, dl, slug } from '../export.js';
import { prepareExport } from '../flags.js';

// The downloaded PNG is rendered at 1.5x the nominal size; the preview is not.
const PNG_SCALE = 1.5;

let outW = 1600, outH = 900;

function options() {
  return { transparent: $('#xTrans').checked, withLegend: $('#xLegend').checked };
}

/**
 * Say it before the image exists, not after it is posted: a map of an election
 * that predates a border change is drawn on borders that did not exist then.
 */
async function showBoundaryWarnings() {
  const box = $('#exportWarn');
  box.innerHTML = '';
  const asOf = state.provenance && state.provenance.asOf;
  if (!asOf) return;

  // The country names in frame. On a province layer the units are provinces,
  // so the country the layer belongs to is what the warning list knows about.
  const names = Object.keys(state.assign)
    .map((k) => BY_KEY.get(k))
    .filter(Boolean)
    .map((f) => f.name);

  if (LAYER !== WORLD && BOUNDARY) {
    try {
      const reg = await layerCatalogue();
      if (reg.countries[BOUNDARY.iso]) names.push(reg.countries[BOUNDARY.iso]);
    } catch (err) { /* no registry, no country name to add */ }
  }

  const lines = boundaryWarnings(String(asOf).slice(0, 10), names, BOUNDARY).map((w) => w.what);

  // The named-change list cannot reach below the country. This one is pure
  // arithmetic on two recorded years and is the only thing that catches a
  // constituency set that was redrawn since the election being drawn on it.
  const gap = resultsVintageWarning(String(asOf).slice(0, 10), BOUNDARY);
  if (gap) lines.push(gap.text);

  if (!lines.length) return;
  box.innerHTML = '<ul class="warns">' +
    lines.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>';
}

/**
 * Every flag the frame needs, decoded, before anything is drawn. If one fails
 * the export stops and says which, instead of shipping a blank country; the
 * preview says so too, because a preview that looks fine and an export that
 * fails would be worse than either.
 */
async function ready() {
  try {
    await prepareExport();
    return true;
  } catch (err) {
    $('#exportWarn').innerHTML = `<ul class="warns"><li>${esc(err.message)}</li></ul>`;
    toast('Some flags did not load, so nothing was exported');
    return false;
  }
}

async function drawPreview() {
  if (!(await ready())) return;
  const cv = composite(outW, outH, options());
  const pv = $('#preview');
  pv.width = outW; pv.height = outH;
  pv.getContext('2d').drawImage(cv, 0, 0);
}

export function initExportDialog() {
  const dlg = $('#exportDlg');

  $('#openExport').addEventListener('click', () => {
    dlg.showModal();
    drawPreview();
    showBoundaryWarnings();
  });
  $('#closeExport').addEventListener('click', () => dlg.close());

  $('#sizeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    outW = +b.dataset.w; outH = +b.dataset.h;
    [...e.currentTarget.children].forEach((x) => x.setAttribute('aria-pressed', x === b));
    drawPreview();
  });

  $('#xLegend').addEventListener('change', drawPreview);
  $('#xTrans').addEventListener('change', drawPreview);

  $('#btnPng').addEventListener('click', async () => {
    if (!(await ready())) return;
    composite(outW * PNG_SCALE, outH * PNG_SCALE, options()).toBlob((b) => {
      dl(b, slug('election-map') + '.png');
      toast('PNG downloaded');
    }, 'image/png');
  });

  $('#btnCopy').addEventListener('click', async () => {
    if (!(await ready())) return;
    try {
      const blob = await new Promise((r) =>
        composite(outW * PNG_SCALE, outH * PNG_SCALE, options()).toBlob(r, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('Copied — paste it into your post');
    } catch (e) {
      toast('Copying is blocked here. Download instead.');
    }
  });
}
