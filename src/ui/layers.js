/**
 * The boundary layer picker.
 *
 * Three things it has to be honest about:
 *
 * 1. Switching layers keeps both layers' work. One document holds every
 *    layer's assignments, and the picker says so — the alternative is losing a
 *    finished map of Europe to a misclick, which is not recoverable.
 * 2. A country can have more than one boundary set, and they disagree. Natural
 *    Earth has seven Bangladeshi divisions; geoBoundaries has eight, because
 *    Mymensingh split from Dhaka in 2015. Both are shown with their unit counts
 *    and the year they represent, so the difference is visible before the
 *    choice rather than after the export.
 * 3. A boundary set has a vintage and a licence, and neither is uniform. The
 *    older set is never hidden: the vendored Natural Earth files are frozen and
 *    offline, which is what makes an export reproducible.
 */

import { $, esc } from './dom.js';
import { toast } from './toast.js';
import { state, switchLayer, layerCounts, emit } from '../state.js';
import {
  WORLD, FEATS, BOUNDARY, loadLayer, layerCatalogue,
  boundaryCountries, boundarySources, boundsOf, isLayerLoaded
} from '../geo.js';
import { flagOfIso3, flagImg } from '../flags.js';

let countries = null;
let sources = [];          // sources for the country currently shown
let shownIso = null;
let busy = false;
let filter = '';

export async function initLayers() {
  const box = $('#layerPanel');
  box.innerHTML = '<p class="hint">Looking for boundary sources…</p>';
  try {
    await layerCatalogue();
    countries = await boundaryCountries();
  } catch (err) {
    box.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
    return;
  }
  shownIso = BOUNDARY ? BOUNDARY.iso : '';
  if (shownIso) sources = await boundarySources(shownIso);
  render();
}

export function syncLayers() {
  if (countries) render();
}

function render() {
  const box = $('#layerPanel');
  const counts = layerCounts();
  const onWorld = state.layer === WORLD;

  box.innerHTML = `
    <div id="layerList">
      <button class="rowbtn" data-l="${WORLD}" aria-pressed="${onWorld}">
        <span>Countries</span><em>${counts[WORLD] ? counts[WORLD] + ' assigned' : '241'}</em>
      </button>
    </div>
    <div id="layerCountryWrap">
      <label class="field"><input id="layerFind" placeholder="Sub-national — find a country"
        value="${esc(filter)}" autocomplete="off" aria-label="Find a country's boundaries"></label>
      <div id="layerCountry" role="listbox" aria-label="Countries with boundaries">${countryRows()}</div>
    </div>
    ${sourceList(counts)}
    <p class="hint">${countries.length} countries have boundaries built.
      Switching keeps each layer's work — nothing is lost by looking.</p>
    ${vintageNote()}`;

  $('#layerList').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) go(b.dataset.l);
  });
  $('#layerCountry').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-iso]');
    if (!b) return;
    shownIso = b.dataset.iso === shownIso ? '' : b.dataset.iso;
    sources = shownIso ? await boundarySources(shownIso) : [];
    render();
  });
  $('#layerFind').addEventListener('input', (e) => {
    filter = e.target.value;
    $('#layerCountry').innerHTML = countryRows();
  });
  const list = $('#sourceList');
  if (list) {
    list.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) go(b.dataset.l);
    });
  }
}

/**
 * The countries with boundaries built, each with its flag. A <select> cannot
 * carry an image, and a list of 234 bare names is the one place in the app a
 * flag does real work: it is how a person finds their country at a glance.
 * The flag comes from the registry's own alpha-3 code; the handful of Natural
 * Earth codes that are not ISO get none rather than a guess.
 */
function countryRows() {
  const q = filter.trim().toLowerCase();
  const list = q ? countries.filter((c) => c.name.toLowerCase().includes(q)) : countries;
  if (!list.length) return '<p class="hint" style="padding:8px 10px">No boundaries built for that name.</p>';
  return list.map((c) => `<button class="lrow" role="option" data-iso="${esc(c.iso)}"
      aria-selected="${c.iso === shownIso}">${flagImg(flagOfIso3(c.iso)) || '<i class="cdot"></i>'}
      <span>${esc(c.name)}</span><em>${c.sources > 1 ? c.sources + ' sources' : ''}</em></button>`).join('');
}

/**
 * Every source for the chosen country, newest first. Unit counts and vintages
 * sit side by side because that is what makes the choice self-evident:
 * "7 units, year not stated" next to "8 units, 2015" answers itself.
 */
function sourceList(counts) {
  if (!shownIso || !sources.length) return '';
  return `<div id="sourceList">${sources.map((s) => `
    <button class="rowbtn source" data-l="${esc(s.layerId)}" aria-pressed="${s.layerId === state.layer}">
      <span>${esc(s.label || s.level)} <u>${esc(s.sourceAgency)}</u></span>
      <em>${s.units} units · ${s.vintage ? s.vintage : 'year not stated'}${
        counts[s.layerId] ? ' · ' + counts[s.layerId] + ' assigned' : ''}</em>
    </button>`).join('')}</div>`;
}

function vintageNote() {
  if (!BOUNDARY) return '';
  const year = BOUNDARY.vintage
    ? `They represent <b>${BOUNDARY.vintage}</b>.`
    : 'The source states <b>no year</b> for them.';
  return `<p class="vintage">${esc(BOUNDARY.sourceAgency)} · ${esc(BOUNDARY.licence)}.
    ${year} A map of an earlier election is drawn on them anyway, and the export says so.</p>`;
}

async function go(id) {
  if (busy || id === state.layer) return;
  busy = true;
  if (!isLayerLoaded(id)) {
    $('#layerPanel').insertAdjacentHTML('beforeend', '<p class="hint">Loading boundaries…</p>');
  }

  try {
    await loadLayer(id === WORLD ? WORLD : id);
  } catch (err) {
    // A country with no file is a normal outcome, not a failure.
    toast(err.message);
    busy = false;
    render();
    return;
  }

  switchLayer(id);

  // Frame the new layer on itself: its assignments if there are any, otherwise
  // every unit, so opening a layer shows the country and not the globe.
  const assigned = Object.keys(state.assign);
  const frame = boundsOf(assigned.length ? assigned : FEATS.map((f) => f.key));
  if (frame) { state.fit = frame; state.zoom = 1; state.pan = [0, 0]; }
  else if (id === WORLD) { state.fit = null; state.zoom = 1; state.pan = [0, 0]; }

  shownIso = BOUNDARY ? BOUNDARY.iso : '';
  sources = shownIso ? await boundarySources(shownIso) : [];
  $('#crumb').textContent = crumbFor();
  busy = false;
  emit('parties');
}

function crumbFor() {
  if (!BOUNDARY) return 'World results';
  const name = (countries.find((c) => c.iso === BOUNDARY.iso) || {}).name || BOUNDARY.iso;
  return `${name} · ${BOUNDARY.label || BOUNDARY.level}`;
}
