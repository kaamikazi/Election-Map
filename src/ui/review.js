/**
 * The review screen.
 *
 * It knows about Proposals and nothing about where they came from. Adapters
 * declare their inputs as data and this renders them, so a fetcher is a new
 * entry in adapters.js and no new UI at all. If this file ever grows a branch
 * on `source.kind`, the abstraction has stopped being real.
 */

import { $, esc } from './dom.js';
import { toast } from './toast.js';
import { ROLES } from '../import/parse.js';
import { ADAPTERS, adapterById } from '../import/adapters.js';
import {
  buildProposal, applyProposal, counts, warnings, recount, setRowUnit, vintageBlock,
  defaultImportMode, importBlock
} from '../import/proposal.js';
import { findPartitions } from '../import/partition.js';
import { flagOfKey, flagImg } from '../flags.js';

let draft = null;       // what the adapter returned, before column roles are settled
let proposal = null;    // the built Proposal
let current = ADAPTERS[0];
// Ticked by hand, per import, never carried over. See blockHtml().
let overrideGap = false;
let importMode = 'replace';
let confirmSame = false;

/**
 * Answers to choices an adapter asked for, keyed by the input name it wanted
 * filled. An adapter that needs a decision mid-flight returns
 *
 *   { choose: { name, prompt, options: [{ value, label, detail, note }] } }
 *
 * and this asks, then calls propose again with the answer added. It is a
 * generic step in the contract, not a screen: any adapter can use it, and this
 * file still has no idea what a wiki is.
 */
let answers = {};

/** Where the cursor should land after the next re-render. */
let resumeAt = null;

const STATUS_LABEL = {
  matched: 'matched', ambiguous: 'ambiguous', unmatched: 'unmatched', duplicate: 'duplicate'
};

export function initReview() {
  const dlg = $('#importDlg');

  // adapter picker
  const seg = $('#adapterSeg');
  seg.innerHTML = ADAPTERS.map((a, i) =>
    `<button data-a="${esc(a.id)}" aria-pressed="${i === 0}">${esc(a.label)}</button>`).join('');
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    current = adapterById(b.dataset.a);
    [...seg.children].forEach((x) => x.setAttribute('aria-pressed', x === b));
    renderInputs();
    clearReview();
  });

  // Import opens from the header, or from the sheet where the header has no room.
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="import"]')) return;
    renderInputs();
    clearReview();
    dlg.showModal();
  });
  $('#closeImport').addEventListener('click', () => dlg.close());
  $('#cancelImport').addEventListener('click', () => dlg.close());
  $('#btnPropose').addEventListener('click', propose);
  $('#btnApply').addEventListener('click', apply);

  renderInputs();
}

/** Render whatever fields the adapter says it needs. */
function renderInputs() {
  const box = $('#adapterInputs');
  box.innerHTML =
    `<p class="hint">${esc(current.hint || '')}</p>` +
    current.inputs.map((f) => {
      const id = 'in_' + f.name;
      if (f.type === 'textarea') {
        return `<label class="field"><textarea id="${id}" rows="7"
          placeholder="${esc(f.placeholder || '')}"></textarea></label>`;
      }
      if (f.type === 'select') {
        const opts = f.options.map((o) => {
          const value = typeof o === 'string' ? o : o.value;
          const label = typeof o === 'string' ? o : o.label;
          return `<option value="${esc(value)}"${value === f.value ? ' selected' : ''}>${esc(label)}</option>`;
        }).join('');
        return `<label class="field inline"><span>${esc(f.label)}</span>
          <select id="${id}">${opts}</select></label>`;
      }
      return `<label class="field inline"><span>${esc(f.label)}</span>
        <input id="${id}" type="${esc(f.type)}" value="${esc(f.value || '')}"
        placeholder="${esc(f.placeholder || '')}"></label>`;
    }).join('');

  $('#btnPropose').textContent = current.id === 'clipboard' ? 'Read table' : 'Fetch';
}

function inputValues() {
  const out = {};
  for (const f of current.inputs) out[f.name] = $('#in_' + f.name).value;
  return out;
}

function clearReview(keepAnswers = false) {
  draft = null;
  proposal = null;
  // A decision made about one import does not carry to the next one.
  overrideGap = false;
  confirmSame = false;
  if (!keepAnswers) answers = {};
  $('#reviewBody').innerHTML = '';
  $('#btnApply').disabled = true;
  $('#proposeErr').textContent = '';
}

async function propose(keepAnswers = false) {
  clearReview(keepAnswers);
  let result;
  try {
    result = await current.propose({ ...inputValues(), ...answers });
  } catch (err) {
    $('#proposeErr').textContent = err.message;
    return;
  }

  if (result && result.choose) {
    renderChoice(result.choose);
    return;
  }
  draft = result;
  importMode = defaultImportMode(draft);
  rebuild();
}

/** Ask the question the adapter asked, then carry on where it left off. */
function renderChoice(choose) {
  $('#reviewBody').innerHTML = `
    <div class="choose">
      <p class="prompt">${esc(choose.prompt)}</p>
      ${choose.note ? `<p class="hint">${esc(choose.note)}</p>` : ''}
      <div class="options">${choose.options.map((o, i) => `
        <button class="option" data-v="${esc(String(o.value))}" ${i === 0 ? 'data-best="1"' : ''}>
          <b>${esc(o.label)}</b>
          ${o.note ? `<u>${esc(o.note)}</u>` : ''}
          ${o.detail ? `<span>${esc(o.detail)}</span>` : ''}
        </button>`).join('')}</div>
    </div>`;

  $('#reviewBody').querySelectorAll('.option').forEach((b) => {
    b.addEventListener('click', () => {
      answers[choose.name] = b.dataset.v;
      propose(true);
    });
  });
}

/** Re-derive the proposal from the current column roles. Matching is cheap. */
function rebuild() {
  proposal = buildProposal(draft);
  renderReview();
  checkPartitions();
}

/**
 * A stranded row can mean a matched row is now partial — the stranded region
 * was carved out of one that matched. That needs a deeper boundary level, so it
 * is asynchronous and lands after the first render rather than holding it up.
 */
async function checkPartitions() {
  const forProposal = proposal;
  let found;
  try {
    found = await findPartitions(forProposal);
  } catch (err) {
    return;
  }
  if (proposal !== forProposal) return;       // the person moved on
  proposal.partials = found.partials;
  if (found.partials.length) renderReview();
}

/* ---------------------------------------------------------------- render */

function renderReview() {
  const c = counts(proposal);
  const warns = warnings(proposal);
  const usable = c.matched;

  // A standing block disables Apply outright. Leaving the button live and
  // failing on click would teach people that the button lies.
  const blocked = !overrideGap && vintageBlock(proposal);
  const identityError = importBlock(proposal, importMode, confirmSame);
  $('#btnApply').disabled = usable === 0 || !!blocked || !!identityError;
  $('#btnApply').textContent = identityError ? 'Confirm dataset' : blocked ? 'Blocked'
    : usable ? `Apply ${usable} row${usable === 1 ? '' : 's'}` : 'Apply';

  $('#reviewBody').innerHTML = `
    ${(draft.chosen || []).length ? `<div class="chosen">${draft.chosen.map((c) => `
      <span class="chip-chosen"><em>${esc(c.name)}</em> ${esc(c.label)}
        <button data-n="${esc(c.name)}" title="Choose again">change</button></span>`).join('')}</div>` : ''}
    <div class="counts">
      ${['matched', 'unmatched', 'ambiguous', 'duplicate'].map((k) =>
        `<span class="count ${k}" ${c[k] ? '' : 'data-zero="1"'}>
          <b>${c[k]}</b> ${STATUS_LABEL[k]}</span>`).join('')}
    </div>
    ${blockHtml()}
    <label class="field"><span>How does this data relate to the map?</span>
      <select id="importMode">
        <option value="replace" ${importMode === 'replace' ? 'selected' : ''}>Different / unknown dataset — replace this layer</option>
        <option value="update" ${importMode === 'update' ? 'selected' : ''}>Update the same election / dataset</option>
        <option value="combine" ${importMode === 'combine' ? 'selected' : ''}>Intentionally combine sources / datasets</option>
      </select></label>
    <p class="hint">${importMode === 'replace'
      ? 'Old regions and metrics are removed. Only reviewed rows in this import remain.'
      : importMode === 'update'
        ? 'Omitted regions and missing values remain, with their original sources. A year alone does not identify an election.'
        : 'Omitted regions remain with their own sources. Changed or unknown datasets reset all metrics in touched regions. Exports disclose mixed sources.'}</p>
    ${importMode === 'update' ? `<label class="tog"><input type="checkbox" id="confirmSame" ${confirmSame ? 'checked' : ''}> I checked the country, date, office/type and round: this is the same dataset.</label>` : ''}
    ${identityError ? `<p class="err">${esc(identityError)}</p>` : ''}
    ${warns.length ? `<ul class="warns">${warns.map((w) =>
      `<li>${esc(w.text)}</li>`).join('')}</ul>` : ''}
    ${partialsHtml()}
    <div class="cols">${columnControls()}</div>
    <div class="rows">${rowsHtml()}</div>
    <datalist id="unitOptions">${
      draft.names.map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>`;

  $('#importMode').onchange = (e) => { importMode = e.target.value; confirmSame = false; renderReview(); };
  if ($('#confirmSame')) $('#confirmSame').onchange = (e) => { confirmSame = e.target.checked; renderReview(); };

  // Changing a choice — which table was read, say — has to happen before any
  // matching is trusted, so it throws the proposal away and asks again.
  $('#reviewBody').querySelectorAll('.chip-chosen button').forEach((b) => {
    b.addEventListener('click', () => {
      delete answers[b.dataset.n];
      propose(true);
    });
  });

  const xv = $('#reviewBody').querySelector('#xVintage');
  if (xv) {
    xv.addEventListener('change', (e) => {
      overrideGap = e.target.checked;
      renderReview();
    });
  }

  $('#reviewBody').querySelectorAll('.colrole').forEach((sel) => {
    sel.addEventListener('change', (e) => {
      const col = draft.columns.find((x) => x.index === +e.target.dataset.i);
      col.role = e.target.value;
      rebuild();
    });
  });

  /*
   * Keyboard: Enter takes the top suggestion and moves on, arrows walk the
   * unmatched rows. Correcting a country's provinces is a one-off job of
   * dozens of rows, and it has to be doable without reaching for the mouse.
   */
  const pickers = [...$('#reviewBody').querySelectorAll('.unitpick')];
  const step = (from, dir) => {
    const i = pickers.indexOf(from);
    const next = pickers[i + dir];
    if (next) { next.focus(); next.select(); }
  };

  pickers.forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!input.value.trim() && input.dataset.top) input.value = input.dataset.top;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      if (e.key === 'ArrowDown' && !input.value) { e.preventDefault(); step(input, 1); }
      if (e.key === 'ArrowUp' && !input.value) { e.preventDefault(); step(input, -1); }
    });
  });

  // Land on whatever still needs a decision.
  const firstUnmatched = pickers.find((x) => !x.value);
  if (resumeAt === 'next-unmatched' && firstUnmatched) firstUnmatched.focus();
  else if (resumeAt != null) {
    const same = pickers.find((x) => +x.dataset.i === resumeAt);
    if (same) { same.focus(); same.select(); }
  } else if (firstUnmatched && document.activeElement === document.body) {
    firstUnmatched.focus();
  }
  resumeAt = null;

  $('#reviewBody').querySelectorAll('.unitpick').forEach((input) => {
    input.addEventListener('change', (e) => {
      const row = proposal.rows.find((r) => r.i === +e.target.dataset.i);
      const typed = e.target.value.trim();
      const hit = draft.index.exact.has(typed) ? draft.index.exact.get(typed) : null;
      if (typed && !hit) {
        e.target.setAttribute('aria-invalid', 'true');
        return;
      }
      e.target.removeAttribute('aria-invalid');
      setRowUnit(proposal, row, hit);
      recount(proposal);
      // Re-rendering resorts the list, so carry the cursor to whatever still
      // needs a decision rather than dropping it back to the top of the page.
      resumeAt = hit ? 'next-unmatched' : row.i;
      renderReview();
    });
  });
}

/**
 * Units the table only partly describes. This is not a warning about the
 * import — the import is fine — it is a statement about what the map will mean.
 */
function partialsHtml() {
  const partials = proposal.partials || [];
  if (!partials.length) return '';
  return '<ul class="warns partials">' + partials.map((p) =>
    `<li><b>${esc(p.parentName)}</b> is only partly described by its row —
      the table reports ${esc(p.excludes.map((e) => e.name).join(', '))}
      separately, and ${p.excludes.length === 1 ? 'it sits' : 'they sit'} inside it.</li>`
  ).join('') + '</ul>';
}

/**
 * The vintage block, and the only way past it.
 *
 * Shown above the warnings rather than among them, because it is not advice:
 * Apply does nothing while it stands. The override is a checkbox the person
 * ticks, never a default and never remembered between imports — the whole
 * value of it is that someone decided, once, for this map.
 */
function blockHtml() {
  const b = vintageBlock(proposal);
  if (!b) return '';
  return `<div class="block">
    <p>${esc(b.text)}</p>
    <label><input type="checkbox" id="xVintage"${overrideGap ? ' checked' : ''}>
      Draw ${esc(String(b.resultsYear))} results on ${esc(String(b.boundaryVintage))}
      ${esc(b.noun)} anyway — the export will say so</label>
  </div>`;
}

function columnControls() {
  return draft.columns.map((col) => {
    const head = col.header || `Column ${col.index + 1}`;
    // Two headers can read alike — "Affiliation in notional 2019 election" and
    // "Member returned in 2024" sit three columns apart in the same table — and
    // the value is what tells them apart.
    const sample = col.sample ? `<em title="${esc(col.sample)}">${esc(col.sample)}</em>` : '';
    return `<label class="col${col.contested ? ' contested' : ''}"${
      col.contested ? ' title="Another column reads the same way — pick the one you mean"' : ''}>
      <span>${esc(head)}</span>
      ${sample}
      <select class="colrole" data-i="${col.index}">${ROLES.map((r) =>
        `<option value="${r.id}"${r.id === col.role ? ' selected' : ''}>${esc(r.label)}</option>`
      ).join('')}</select>
    </label>`;
  }).join('');
}

const VALUE_KEYS = ['vote', 'seats', 'turnout', 'margin'];

function rowsHtml() {
  // Failures first. A problem the person has to scroll to find is a problem
  // they will apply without seeing.
  const order = { unmatched: 0, ambiguous: 1, duplicate: 2, matched: 3 };
  const rows = proposal.rows.slice().sort((a, b) =>
    (order[a.status] - order[b.status]) || (a.i - b.i));

  const shown = rows.slice(0, 400);
  const hidden = rows.length - shown.length;

  return shown.map((r) => {
    const vals = VALUE_KEYS
      .filter((k) => r.values[k] != null)
      .map((k) => `<em>${k} ${r.values[k]}</em>`).join('');

    // An unmatched row gets its own list, ranked for this name, so the likely
    // answer is the first thing offered. Correcting a layer is a long job the
    // first time and this is most of what makes it bearable.
    const ranked = !r.unit && r.candidates && r.candidates.length;
    const listId = ranked ? `opts_${r.i}` : 'unitOptions';

    // The flag is the matched unit's, not a guess at the raw name's: it shows
    // what the row resolved to, which is the thing being reviewed.
    return `<div class="rrow" data-s="${r.status}" data-i="${r.i}">
      <span class="rawunit">${flagImg(r.unit ? flagOfKey(r.unit) : null, 'flag sm')}<span
        class="raw" title="${esc(r.raw.unit)}">${esc(r.raw.unit || '(blank)')}</span></span>
      <input class="unitpick" list="${listId}" data-i="${r.i}"
        ${ranked ? `data-top="${esc(r.candidates[0])}"` : ''}
        value="${esc(r.unit ? (proposal.index.nameOf.get(r.unit) || r.unit) : '')}"
        placeholder="${ranked ? esc(r.candidates[0]) + '?' : 'pick a unit'}">
      ${ranked ? `<datalist id="${listId}">${
        r.candidates.map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>` : ''}
      <span class="how">${esc(r.how === 'none' ? '' : r.how)}</span>
      <span class="vals">${esc(r.raw.party || '')}${vals}</span>
      ${r.note ? `<span class="rnote">${esc(r.note)}</span>` : ''}
      ${r.partitionOf ? `<span class="rnote">part of ${esc(
        proposal.index.nameOf.get(r.partitionOf) || r.partitionOf)}, which is marked partial</span>` : ''}
    </div>`;
  }).join('') + (hidden > 0 ? `<p class="hint">${hidden} more rows not shown.</p>` : '');
}

/* ---------------------------------------------------------------- apply */

function apply() {
  const result = applyProposal(proposal, { mode: importMode, confirmSame, acceptVintageGap: overrideGap });
  if (result.identityError) return toast(result.identityError);

  // Refused outright, rather than having matched nothing: a different failure
  // and it has to read as one.
  if (result.blocked) {
    return toast(`Not applied — ${result.blocked.resultsYear} results on ` +
      `${result.blocked.boundaryVintage} ${result.blocked.noun}`);
  }

  if (!result.applied) return toast('Nothing matched, so nothing was applied');

  // The rows that failed stay on screen so they can be fixed and applied again.
  renderReview();
  toast(`${result.applied} applied` + (result.skipped ? `, ${result.skipped} still unmatched` : ''));
  if (!result.skipped) $('#importDlg').close();
}
