import { $, esc } from './dom.js';
import { state, ALIAS, partyFor, paint } from '../state.js';
import { FEATS, BOUNDARY } from '../geo.js';
import { flagOf, flagImg } from '../flags.js';

/**
 * The country list, which is also the search results. On the world layer each
 * row carries its flag — colour for the interface that says nothing about the
 * data. The party dot beside it is the data, and stays.
 */
export function syncCountries() {
  // "Search 240 countries" over a list of seven divisions is the wrong noun,
  // so the copy follows whatever the active layer calls its units.
  const label = BOUNDARY && BOUNDARY.label && !/^adm\d$/i.test(BOUNDARY.label)
    ? BOUNDARY.label.toLowerCase() : null;
  const singular = label || (BOUNDARY ? 'unit' : 'country');
  const plural = label ? label + 's' : (BOUNDARY ? 'units' : 'countries and territories');
  $('#findTitle').textContent = 'Find a ' + singular;
  $('#fSearch').placeholder = `Search ${FEATS.length} ${plural}`;

  const q = $('#fSearch').value.trim().toLowerCase();
  const alias = ALIAS[q];
  const box = $('#countryList');
  const flagMode = state.mode === 'flags';
  const marked = (f) => (flagMode ? !!state.flagged[f.key] : state.assign[f.key] != null);

  let list = FEATS;
  if (q) list = FEATS.filter((f) => f.name.toLowerCase().includes(q) || (alias && f.name === alias));

  // With no search term, whatever is already on the map floats to the top.
  const ordered = q ? list : list.slice().sort((a, b) => {
    const A = marked(a), B = marked(b);
    return A === B ? a.name.localeCompare(b.name) : (A ? -1 : 1);
  });

  box.innerHTML = '';
  ordered.slice(0, 300).forEach((f) => {
    const p = flagMode ? null : partyFor(f.key);
    const a2 = flagOf(f);
    const row = document.createElement('div');
    row.className = 'crow';
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    if (flagMode) row.dataset.flagged = state.flagged[f.key] ? '1' : '0';
    row.innerHTML = `${a2 ? flagImg(a2) : '<i class="cdot"></i>'}
      <span>${esc(f.name)}</span>${p ? `<span class="cparty"><i class="cdot" style="background:${p.color}"></i><em>${esc(p.name)}</em></span>` : ''}${
      flagMode && state.flagged[f.key] && !a2 ? '<em>no ISO code</em>' : ''}`;
    row.addEventListener('click', () => paint(f.key));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); paint(f.key); }
    });
    box.appendChild(row);
  });

  if (!ordered.length) {
    box.innerHTML = '<div class="crow"><span style="color:var(--dim)">Nothing matches that name</span></div>';
  }
}

export function initCountries() {
  $('#fSearch').addEventListener('input', syncCountries);
}
