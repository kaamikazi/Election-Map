import { $, esc } from './dom.js';
import { toast } from './toast.js';
import { state, tally, addParty, removeParty, setPartyColor, emit } from '../state.js';
import { familyLabel } from '../families.js';

/**
 * Rebuilds the party list. Editing a name or a colour deliberately does NOT
 * come back through here — rebuilding the row would tear the input the user
 * is typing in out from under them.
 */
export function syncParties() {
  const box = $('#partyList');
  box.innerHTML = '';
  state.parties.forEach((p) => {
    const el = document.createElement('div');
    el.className = 'party';
    el.dataset.active = state.active === p.id ? '1' : '0';
    el.style.setProperty('--pc', p.color);
    el.innerHTML = `
      <label class="swatch" style="background:${p.color}"><input type="color" value="${p.color}"></label>
      <input class="pname" value="${esc(p.name)}" spellcheck="false"
        title="${esc(p.parlgov_id != null ? familyLabel(p.family) : p.name)}">
      <span class="tally">${tally(p.id)}</span>
      <button class="kill" title="Remove">×</button>`;

    el.addEventListener('click', (ev) => {
      if (ev.target.closest('.swatch') || ev.target.closest('.kill') || ev.target.classList.contains('pname')) return;
      setActive(p.id);
    });

    el.querySelector('input[type="color"]').addEventListener('input', (ev) => {
      el.querySelector('.swatch').style.background = ev.target.value;
      el.style.setProperty('--pc', ev.target.value);
      setPartyColor(p, ev.target.value);
    });

    el.querySelector('.pname').addEventListener('input', (ev) => {
      p.name = ev.target.value;
      emit('style');
    });

    el.querySelector('.pname').addEventListener('focus', () => setActive(p.id));

    el.querySelector('.kill').addEventListener('click', () => {
      if (!removeParty(p.id)) return toast('Keep at least one party');
      emit('parties');
    });

    box.appendChild(el);
  });
}

/** Colouring a country changes only the numbers, so only the numbers redraw. */
export function syncTallies() {
  [...$('#partyList').children].forEach((row, i) => {
    const p = state.parties[i];
    if (p) row.querySelector('.tally').textContent = tally(p.id);
  });
}

/**
 * Move the selection without rebuilding — see the note on syncParties. The
 * 'active' change is what makes the rest of the interface follow: the row
 * tint, the peek chip, the legend highlight and the painting cursor.
 */
function setActive(id) {
  if (state.active === id) return;
  state.active = id;
  emit('active');
}

export function initParties() {
  $('#addParty').addEventListener('click', () => {
    addParty();
    emit('parties');
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input,textarea')) return;
    const n = +e.key;
    if (n >= 1 && n <= 9 && state.parties[n - 1]) setActive(state.parties[n - 1].id);
  });
}
