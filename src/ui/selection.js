import { $, esc } from './dom.js';
import { state, recordFor, partyFor, setValue, clearCountry } from '../state.js';
import { BY_KEY } from '../geo.js';
import { FIELDS } from '../metrics.js';
import { number, share } from '../national-election.js';

/**
 * The values editor for one division. Typing here must not rebuild the panel
 * under the cursor, so the inputs are written once per selection and the
 * number fields commit on change rather than on every keystroke.
 */
export function syncSelection(force = false) {
  const box = $('#selPanel');
  const key = state.selected;
  const rec = key ? recordFor(key) : null;
  const feature = key ? BY_KEY.get(key) : null;
  const name = feature ? feature.name : key;
  if (state.nationalElection) {
    const e = state.nationalElection, s = e.states.find(s => s.key === key);
    box.dataset.for = '';
    box.innerHTML = s ? `<div class="selname">${esc(s.name)} · ${number(s.votes.total)} popular votes</div>` +
      e.candidates.map(c => `<p class="note">${esc(c.name)}: ${s.votes[c.id] == null ? 'Not reported' : `${number(s.votes[c.id])} · ${share(s.votes[c.id], s.votes.total)}`}</p>`).join('') +
      `<p class="note">Electoral votes: Trump ${s.electoralVotes.trump}, Harris ${s.electoralVotes.harris}. No parliamentary seats or turnout rate asserted.</p>` :
      '<p class="empty">Tap a state to inspect the official results. Result editing is disabled for this source-backed post; open or import another document to map different data.</p>';
    return;
  }

  if (!rec) {
    box.dataset.for = '';
    box.innerHTML = '<p class="empty">Nothing selected. Tap a country on the map to give it the active party, then set its numbers here.</p>';
    return;
  }

  // An archive map may colour by family, so name what actually governed and
  // put the colour bucket after it.
  const caption = () => {
    const p = partyFor(key);
    const bucket = p ? p.name : '—';
    return rec.label && rec.label !== bucket ? `${rec.label} · ${bucket}` : bucket;
  };

  // Already showing this division — refresh only what can have changed elsewhere.
  if (!force && box.dataset.for === key) {
    box.querySelector('.selparty').textContent = caption();
    return;
  }

  box.dataset.for = key;
  box.innerHTML = `
    <div class="selname">${esc(name)}</div>
    <div class="selparty">${esc(caption())}</div>
    <div class="vals"></div>
    <button class="clearsel">Clear assignment</button>`;

  const vals = box.querySelector('.vals');
  FIELDS.forEach((f) => {
    const label = document.createElement('label');
    label.innerHTML = `<span>${esc(f.label)}</span>
      <input type="number" step="0.1" value="${rec[f.key] ?? ''}"><u>${esc(f.unit)}</u>`;
    label.querySelector('input').addEventListener('change', (e) => {
      const raw = e.target.value.trim();
      setValue(key, f.key, raw === '' ? null : parseFloat(raw));
    });
    vals.appendChild(label);
  });

  box.querySelector('.clearsel').addEventListener('click', () => clearCountry(key));
}
