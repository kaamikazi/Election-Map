/**
 * The shell: which mode the map is in, and how the controls reach a hand at
 * each size.
 *
 *   desktop  rail | map | legend, as columns
 *   tablet   an icon rail; one group flies out over the map
 *   phone    the map first; controls in a bottom sheet that snaps to
 *              peek — party chips, so painting never needs the sheet open
 *              half — parties, search, layer
 *              full — everything, import included
 *
 * The panels are the same DOM at every size. This file only decides which of
 * them are showing, so nothing is duplicated and nothing drifts out of sync.
 *
 * Colour comes from the data. The active party tints its row, its chip, its
 * legend entry and the painting cursor, so switching party is visible
 * everywhere at once. Buttons, toggles and focus rings keep the one neutral
 * accent, so a party colour is never mistaken for a control.
 */

import { $, esc } from './dom.js';
import { state, setMode, emit, tally, toggleFlag } from '../state.js';
import { flagOfKey, flagImg } from '../flags.js';
import { BY_KEY } from '../geo.js';

const phone = () => window.matchMedia('(max-width:699px)').matches;
const tablet = () => window.matchMedia('(min-width:700px) and (max-width:999px)').matches;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion:reduce)').matches;

/* ------------------------------------------------------------------ mode */

export function syncMode() {
  document.body.dataset.mode = state.mode;
  [...$('#modeSeg').children].forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
  $('#stripEmpty').textContent = state.mode === 'flags'
    ? 'No flags yet. Tap countries to add them.'
    : 'No results yet. Pick a party, then tap countries.';
  $('#map').setAttribute('aria-label', state.mode === 'flags'
    ? 'Map. Tap a country to add or remove its flag.'
    : 'Map. Tap a country to paint it with the active party.');
}

/* ------------------------------------------------ colour from the data */

/** The active party's colour, everywhere the interface can show it. */
export function syncActive() {
  const p = state.parties.find((q) => q.id === state.active);
  const colour = p ? p.color : null;

  // rows in the rail
  [...$('#partyList').children].forEach((row, i) => {
    const q = state.parties[i];
    if (!q) return;
    row.dataset.active = q.id === state.active ? '1' : '0';
    row.style.setProperty('--pc', q.color);
  });

  // legend highlight, in the strip and the side panel
  document.querySelectorAll('[data-party]').forEach((el) => {
    el.dataset.active = String(+el.dataset.party === state.active ? 1 : 0);
  });

  // the cursor carries the party, so the map says what a tap will do
  const map = $('#map');
  if (state.mode === 'flags' || !colour) map.style.cursor = 'crosshair';
  else map.style.cursor = paintCursor(colour);

  syncPeek();
}

/** A dot in the party's colour, ringed so it reads on any fill beneath it. */
function paintCursor(hex) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">` +
    `<circle cx="12" cy="12" r="7" fill="${hex}" stroke="#0D141C" stroke-width="3"/>` +
    `<circle cx="12" cy="12" r="8.6" fill="none" stroke="#EDE9E1" stroke-width="1.2"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, crosshair`;
}

/* ------------------------------------------------------------------ peek */

/**
 * The peek row. In results mode it is the party list as chips — pick one and
 * tap the map, without ever opening the sheet. In flags mode there is nothing
 * to pick, so it shows the flags already on the map.
 */
export function syncPeek() {
  const box = $('#peek');
  if (!box) return;
  if (state.mode === 'flags') {
    const keys = Object.keys(state.flagged);
    box.innerHTML = keys.length
      ? keys.map((k) => {
        const f = BY_KEY.get(k);
        return `<span class="pchip">${flagImg(flagOfKey(k), 'flag sm')}${esc(f ? f.name : k)}</span>`;
      }).join('')
      : '<span class="pchip note">Tap countries to add their flags</span>';
    return;
  }
  box.innerHTML = state.parties.map((p) =>
    `<button class="pchip" data-pid="${p.id}" aria-pressed="${p.id === state.active}"
      style="--pc:${p.color}"><i style="background:${p.color}"></i>${esc(p.name)}
      <u>${tally(p.id)}</u></button>`).join('');
}

/** The Flags section: what is on the map, each removable. */
export function syncFlagPanel() {
  const box = $('#flagPicked');
  if (!box) return;
  const keys = Object.keys(state.flagged);
  box.innerHTML = keys.map((k) => {
    const f = BY_KEY.get(k);
    const a2 = flagOfKey(k);
    return `<span class="fchip">${flagImg(a2, 'flag sm')}${esc(f ? f.name : k)}${
      a2 ? '' : ' <em>no ISO code</em>'}<button data-unflag="${esc(k)}"
      aria-label="Remove ${esc(f ? f.name : k)}">×</button></span>`;
  }).join('');
}

/* ------------------------------------------------------ tablet: fly-outs */

function setFly(group) {
  const main = $('#main');
  if (!group || main.dataset.fly === group) delete main.dataset.fly;
  else main.dataset.fly = group;
  [...$('#railIcons').children].forEach((b) =>
    b.setAttribute('aria-expanded', String(b.dataset.g === main.dataset.fly)));
}

/* -------------------------------------------------------- phone: sheet */

const SNAPS = ['peek', 'half', 'full'];

export function setSnap(snap) {
  const sheet = $('#sheet');
  if (!SNAPS.includes(snap)) return;
  sheet.dataset.snap = snap;
  $('#grab').setAttribute('aria-label',
    snap === 'full' ? 'Show fewer controls' : 'Show more controls');
  // The map box changes size as the sheet moves; redraw once it settles.
  setTimeout(() => emit('view'), reducedMotion() ? 0 : 260);
}

function initSheet() {
  const sheet = $('#sheet');
  const grab = $('#grab');
  let drag = null;
  let justDragged = false;

  // A tap on the handle steps through the snaps; a drag goes where it is let
  // go. The click that follows a drag's pointerup is swallowed.
  grab.addEventListener('click', () => {
    if (justDragged) { justDragged = false; return; }
    const i = SNAPS.indexOf(sheet.dataset.snap);
    setSnap(SNAPS[(i + 1) % SNAPS.length]);
  });

  const start = (e) => {
    if (!phone()) return;
    drag = { y: e.clientY, h: sheet.getBoundingClientRect().height,
      top: sheet.getBoundingClientRect().top, moved: false, id: e.pointerId };
    sheet.classList.add('dragging');
    grab.setPointerCapture(e.pointerId);
  };
  const move = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    if (Math.abs(dy) > 4) drag.moved = true;
    const vh = window.innerHeight;
    const y = Math.max(0, Math.min(drag.h - 60, drag.top + dy - (vh - drag.h)));
    sheet.style.transform = `translateY(${y}px)`;
  };
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    sheet.classList.remove('dragging');
    const shownPx = window.innerHeight - sheet.getBoundingClientRect().top;
    sheet.style.transform = '';
    if (drag.moved) {
      const vh = window.innerHeight;
      const targets = { peek: 96, half: vh * 0.58, full: drag.h };
      const snap = SNAPS.reduce((best, s) =>
        (Math.abs(targets[s] - shownPx) < Math.abs(targets[best] - shownPx) ? s : best), 'peek');
      setSnap(snap);
    }
    justDragged = drag.moved;
    drag = null;
  };
  grab.addEventListener('pointerdown', start);
  grab.addEventListener('pointermove', move);
  grab.addEventListener('pointerup', end);
  grab.addEventListener('pointercancel', end);

  $('#peek').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pid]');
    if (!b) return;
    state.active = +b.dataset.pid;
    emit('active');
  });
}

/* ------------------------------------------------------------------ init */

export function initShell() {
  $('#modeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setMode(b.dataset.mode);
  });

  $('#railIcons').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setFly(b.dataset.g);
  });
  // A fly-out closes on Escape, or when the map is tapped outside it.
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setFly(null); });
  $('#canvasWrap').addEventListener('pointerdown', () => { if (tablet()) setFly(null); });

  initSheet();

  $('#flagPicked').addEventListener('click', (e) => {
    const b = e.target.closest('[data-unflag]');
    if (b) toggleFlag(b.dataset.unflag);
  });

  // Crossing a breakpoint resets the transient layout state rather than
  // carrying a phone's open sheet into a tablet's fly-out.
  for (const q of ['(max-width:699px)', '(min-width:700px) and (max-width:999px)']) {
    window.matchMedia(q).addEventListener('change', () => {
      setFly(null);
      $('#sheet').dataset.snap = 'peek';
      emit('view');
    });
  }

  syncMode();
  syncActive();
  syncFlagPanel();
}
