import { $, esc } from './dom.js';
import { state, standings } from '../state.js';
import { BY_KEY } from '../geo.js';
import { flagOfKey, flagImg } from '../flags.js';

/**
 * The results strip: the bar and its legend. The bar is the colour hero of the
 * screen and the one place the whole result reads at a glance, so it gets room.
 *
 * In flags mode there is no result to show, so the strip lists the countries on
 * the map instead — and has no bar, because a bar would be a proportion of
 * nothing.
 */
export function syncResults() {
  const bar = $('#bar'), leg = $('#legend');
  bar.innerHTML = ''; leg.innerHTML = '';

  if (state.mode === 'flags') {
    const keys = Object.keys(state.flagged);
    bar.style.display = 'none';
    $('#stripEmpty').style.display = keys.length ? 'none' : 'block';
    keys.forEach((k) => {
      const f = BY_KEY.get(k);
      const d = document.createElement('div');
      d.className = 'leg';
      d.innerHTML = `${flagImg(flagOfKey(k), 'flag sm') || '<i></i>'}<b>${esc(f ? f.name : k)}</b>`;
      leg.appendChild(d);
    });
    return;
  }

  const counts = standings();
  const total = counts.reduce((s, x) => s + x.n, 0);
  $('#stripEmpty').style.display = total ? 'none' : 'block';
  bar.style.display = total ? 'flex' : 'none';

  counts.forEach(({ p, n }) => {
    const i = document.createElement('i');
    i.style.width = (n / total * 100) + '%';
    i.style.background = p.color;
    bar.appendChild(i);

    const d = document.createElement('div');
    d.className = 'leg';
    d.dataset.party = p.id;
    d.dataset.active = p.id === state.active ? '1' : '0';
    d.style.setProperty('--pc', p.color);
    d.innerHTML = `<i style="background:${p.color}"></i><b>${esc(p.name)}</b>` +
      `<u>${n} · ${Math.round(n / total * 100)}%</u>`;
    leg.appendChild(d);
  });
}
