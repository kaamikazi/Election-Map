import { $, esc } from './dom.js';
import { state, setMetric } from '../state.js';
import { METRICS, domainLabel } from '../metrics.js';

/** "Colour by" — one metric active at a time, each showing its own domain. */
export function syncMetrics() {
  const box = $('#metricList');
  [...box.children].forEach((b) => b.setAttribute('aria-pressed', b.dataset.m === state.metric));
}

export function initMetrics() {
  const box = $('#metricList');
  box.innerHTML = '';
  METRICS.forEach((m) => {
    const b = document.createElement('button');
    b.className = 'rowbtn';
    b.dataset.m = m.id;
    b.innerHTML = `<span>${esc(m.label)}</span><em>${esc(domainLabel(m))}</em>`;
    b.addEventListener('click', () => setMetric(m.id));
    box.appendChild(b);
  });
  syncMetrics();
}
