import { $, esc } from './dom.js';
import { state, activeParties, THEMES } from '../state.js';
import { NEUTRAL, metricDef, rampSwatches, ticksFor } from '../metrics.js';
import { hatchCss } from '../render.js';
import { BY_KEY } from '../geo.js';
import { flagOfKey, flagImg, FLAG_SET } from '../flags.js';

/**
 * A flags map needs no key to decode it — every flag names its own country —
 * so the panel lists what is on the map and credits whose flags they are.
 */
function flagLegend() {
  $('#legendHead').textContent = 'On the map';
  const keys = Object.keys(state.flagged);
  $('#legendTitle').textContent = keys.length
    ? `${keys.length} ${keys.length === 1 ? 'country' : 'countries'}` : '';
  const box = $('#legendBody');
  if (!keys.length) {
    box.innerHTML = '<p class="empty">Nothing on the map yet.</p>';
    return;
  }
  box.innerHTML = '<div class="swatches">' + keys.map((k) => {
    const f = BY_KEY.get(k);
    const img = flagImg(flagOfKey(k));
    return `<div class="sw">${img || '<i></i>'}${esc(f ? f.name : k)}${
      img ? '' : ' <em>— no ISO code</em>'}</div>`;
  }).join('') + '</div>' +
    `<p class="note">Flags: ${esc(FLAG_SET.name)} ${esc(FLAG_SET.version)}, ${esc(FLAG_SET.licence)}.</p>`;
}

/** A swatch has to look like the fill it stands for, hatching included. */
const swatchStyle = (p) =>
  p.hatch ? `background:${hatchCss(p.color, THEMES[state.theme].hatchInk)}` : `background:${p.color}`;

/**
 * The legend changes shape with the metric: a swatch row when the fill is a
 * flat party colour, a graded strip per party with the metric's own domain
 * when it is ramped. Turnout is party-neutral, so it gets one strip in a hue
 * no party uses.
 *
 * Every party on the map gets a strip — a colour on the map with no legend
 * entry is a colour the reader cannot decode.
 */
export function syncLegend() {
  if (state.mode === 'flags') return flagLegend();
  $('#legendHead').textContent = 'Legend';
  const def = metricDef(state.metric);
  const parties = activeParties();
  $('#legendTitle').textContent = def.id === 'flat' ? 'Winning party' : def.label;

  const box = $('#legendBody');
  if (!parties.length) {
    box.innerHTML = '<p class="empty">Nothing assigned yet.</p>';
    return;
  }

  if (def.id === 'flat') {
    box.innerHTML = '<div class="swatches">' + parties.map((p) =>
      `<div class="sw" data-party="${p.id}" data-active="${p.id === state.active ? 1 : 0}"
        style="--pc:${p.color}"><i style="${swatchStyle(p)}"></i>${esc(p.name)}</div>`
    ).join('') + '</div>';
    return;
  }

  const rows = def.neutral
    ? [{ label: def.label, color: NEUTRAL }]
    : parties.map((p) => ({ label: p.name, color: p.color }));

  const strips = rows.map((r) =>
    `<div class="ramp"><b>${esc(r.label)}</b><div class="strip">` +
    rampSwatches(r.color).map((c) => `<i style="background:${c}"></i>`).join('') +
    '</div></div>'
  ).join('');

  const ticks = ticksFor(def).map((t) => `<span>${esc(t)}</span>`).join('');

  box.innerHTML =
    `<div class="ramps">${strips}</div>` +
    `<div class="ticks">${ticks}</div>` +
    `<p class="note">${esc(def.note)}</p>`;
}
