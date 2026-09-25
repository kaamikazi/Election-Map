/** Pointer, pinch, wheel and hover behaviour on the map canvas. */

import { $, esc } from './dom.js';
import { state, partyFor, recordFor, paint } from '../state.js';
import { flagOf, flagImg } from '../flags.js';
import { metricDef } from '../metrics.js';
import { pick, clamp, lastBase } from '../geo.js';
import { setHover, getHover, schedule } from '../render.js';

/* ---------------- tooltip ---------------- */

/** Party, plus the number the map is currently coloured by. */
function tipLine(key) {
  const p = partyFor(key);
  if (!p) return '';
  const rec = recordFor(key);
  // An archive map may colour by family, so name what actually governed.
  const bits = [rec.label || p.name];
  const def = metricDef(state.metric);
  if (def.domain) {
    const v = rec[def.id];
    bits.push(v == null || !isFinite(v) ? 'no ' + def.label.toLowerCase() : v + def.unit);
  }
  return bits.join('  ·  ');
}

function showTip(f, x, y) {
  const tip = $('#tip');
  const line = state.mode === 'flags'
    ? (state.flagged[f.key] ? (flagOf(f) ? 'On the map' : 'No ISO code in the boundary data') : '')
    : tipLine(f.key);
  tip.innerHTML = `<span class="tiprow">${flagImg(flagOf(f), 'flag sm')}${esc(f.name)}</span>` +
    `${line ? `<small>${esc(line)}</small>` : ''}`;
  tip.style.opacity = 1;
  moveTip(x, y);
}

/*
 * Nothing depends on hover. A finger has no hover, so a tap shows the tooltip
 * for the unit it landed on, for long enough to read, and then lets it go.
 */
let tapTimer = null;
function tapTip(f, x, y) {
  showTip(f, x, y);
  clearTimeout(tapTimer);
  tapTimer = setTimeout(hideTip, 1800);
}
function moveTip(x, y) {
  const tip = $('#tip');
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}
function hideTip() { $('#tip').style.opacity = 0; }

/* ---------------- pointers ---------------- */

export function initInteraction(canvas) {
  const ptrs = new Map();
  let drag = null, pinch = null, moved = 0;

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, [e.offsetX, e.offsetY]);
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: state.zoom };
      drag = null;
    } else {
      drag = { x: e.offsetX, y: e.offsetY, pan: [...state.pan], rot: [...state.rotate] };
      moved = 0;
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, [e.offsetX, e.offsetY]);
    // A touch that is not dragging has no hover to show.
    if (e.pointerType !== 'mouse' && !drag && !pinch) return;

    if (pinch && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      state.zoom = clamp(pinch.z * (d / pinch.d), 0.6, 18);
      schedule();
      return;
    }

    if (drag) {
      const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
      moved = Math.max(moved, Math.hypot(dx, dy));
      if (moved > 4) {
        hideTip();
        if (state.proj === 'globe') {
          const k = 90 / Math.max(lastBase.s0 * state.zoom, 1);   // one radius of drag ≈ 90°
          state.rotate = [drag.rot[0] + dx * k, clamp(drag.rot[1] - dy * k, -89, 89)];
        } else {
          state.pan = [drag.pan[0] + dx / lastBase.s0, drag.pan[1] + dy / lastBase.s0];
        }
        schedule();
      }
      return;
    }

    const f = pick(e.offsetX, e.offsetY);
    if (f !== getHover()) {
      setHover(f);
      schedule();
      if (f) showTip(f, e.offsetX, e.offsetY); else hideTip();
    } else if (f) {
      moveTip(e.offsetX, e.offsetY);
    }
  });

  function endPtr(e) {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (drag && moved <= 4) {
      const f = pick(e.offsetX, e.offsetY);
      if (f) {
        paint(f.key);
        if (e.pointerType !== 'mouse') tapTip(f, e.offsetX, e.offsetY);
      }
    }
    drag = null;
  }
  canvas.addEventListener('pointerup', endPtr);
  canvas.addEventListener('pointercancel', (e) => { ptrs.delete(e.pointerId); drag = null; pinch = null; });
  // A finger lifting off the glass fires pointerleave too. That is not the
  // mouse leaving the map, and treating it as one hid every tap's tooltip the
  // instant it appeared.
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return;
    setHover(null); hideTip(); schedule();
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const nz = clamp(state.zoom * Math.exp(-e.deltaY * 0.0016), 0.6, 18);
    // Keep the point under the cursor fixed. The globe rotates instead of panning,
    // so it just scales about its centre.
    if (state.proj !== 'globe' && lastBase.s0) {
      const r = canvas.getBoundingClientRect();
      const cx = e.clientX - r.left, cy = e.clientY - r.top;
      const T = [lastBase.t0[0] + state.pan[0] * lastBase.s0,
                 lastBase.t0[1] + state.pan[1] * lastBase.s0];
      const f = nz / state.zoom;
      const Tx = cx - (cx - T[0]) * f, Ty = cy - (cy - T[1]) * f;
      state.pan = [(Tx - lastBase.t0[0]) / lastBase.s0, (Ty - lastBase.t0[1]) / lastBase.s0];
    }
    state.zoom = nz;
    schedule();
  }, { passive: false });
}
