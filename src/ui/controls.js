/** Header, rail toggles, region chips, zoom pad, and save / open / clear. */

import { $ } from './dom.js';
import { toast } from './toast.js';
import { state, REGIONS, reserveIds, clearAssignments, emit, pushHistory,
         toDocument, migrate, undo, canUndo } from '../state.js';
import { clamp } from '../geo.js';
import { dl, slug } from '../export.js';

export function initControls() {
  /* ---- projection: the header control, and the phone's copy in Map style ---- */
  document.querySelectorAll('.projSeg').forEach((seg) => seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-p]'); if (!b) return;
    state.proj = b.dataset.p;
    state.zoom = 1; state.pan = [0, 0];
    syncProjection();
    emit('view');
  }));

  /* ---- region chips ---- */
  const chips = $('#regionChips');
  Object.keys(REGIONS).forEach((k) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = k;
    b.addEventListener('click', () => {
      const r = REGIONS[k];
      state.fit = r; state.zoom = 1; state.pan = [0, 0];
      state.rotate = r ? [-(r[0][0] + r[1][0]) / 2, -(r[0][1] + r[1][1]) / 2] : [-10, -12];
      $('#crumb').textContent = k === 'World' ? 'World results' : k + ' results';
      emit('view');
    });
    chips.appendChild(b);
  });

  /* ---- zoom pad ---- */
  $('#zIn').onclick = () => { state.zoom = clamp(state.zoom * 1.3, 0.6, 18); emit('view'); };
  $('#zOut').onclick = () => { state.zoom = clamp(state.zoom / 1.3, 0.6, 18); emit('view'); };
  $('#zReset').onclick = () => { state.zoom = 1; state.pan = [0, 0]; emit('view'); };

  /* ---- headline fields ---- */
  const fields = { fTitle: 'title', fSub: 'sub', fHandle: 'handle' };
  Object.entries(fields).forEach(([id, key]) => {
    $('#' + id).addEventListener('input', (e) => { state[key] = e.target.value; });
  });

  /* ---- style toggles ---- */
  const togs = { tTheme: 'theme', tGrat: 'grat', tAnt: 'antarctica', tDots: 'dots', tLabels: 'labels' };
  Object.entries(togs).forEach(([id, key]) => {
    $('#' + id).addEventListener('change', (e) => {
      state[key] = key === 'theme' ? (e.target.checked ? 'light' : 'dark') : e.target.checked;
      emit('view');
    });
  });

  /* ---- undo: in the header, and in the sheet where the header has no room ---- */
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="undo"]')) undo();
  });

  /* ---- flags ---- */
  $('#clearFlags').addEventListener('click', () => {
    if (!Object.keys(state.flagged).length) return;
    pushHistory();
    state.flagged = {};
    emit('assign');
    toast('Flags cleared');
  });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    }
  });

  /* ---- your work ---- */
  $('#btnClear').addEventListener('click', () => {
    if (!Object.keys(state.assign).length) return;
    clearAssignments();
    toast('Results cleared');
  });

  $('#btnSave').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(toDocument(), null, 2)], { type: 'application/json' });
    dl(blob, slug('election-map') + '.json');
  });

  $('#btnLoad').addEventListener('click', () => $('#fileIn').click());

  $('#fileIn').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      // v1 files carry no version field and store a bare party id per country;
      // migrate() turns those into records so they load unchanged.
      Object.assign(state, migrate(JSON.parse(await f.text())));
      reserveIds(state.parties.map((p) => p.id));
      syncFormFromState();
      emit('parties');
      toast('Map loaded');
    } catch (err) {
      toast('That file could not be read');
    }
    e.target.value = '';
  });
}

export function syncUndo() {
  document.querySelectorAll('[data-act="undo"]').forEach((b) => { b.disabled = !canUndo(); });
}

function syncProjection() {
  document.querySelectorAll('.projSeg button[data-p]').forEach((x) =>
    x.setAttribute('aria-pressed', String(x.dataset.p === state.proj)));
}

/** Push loaded state back into the inputs that hold it. */
export function syncFormFromState() {
  $('#fTitle').value = state.title || '';
  $('#fSub').value = state.sub || '';
  $('#fHandle').value = state.handle || '';
  $('#tTheme').checked = state.theme === 'light';
  $('#tGrat').checked = !!state.grat;
  $('#tAnt').checked = !!state.antarctica;
  $('#tDots').checked = !!state.dots;
  $('#tLabels').checked = !!state.labels;
  syncProjection();
}
