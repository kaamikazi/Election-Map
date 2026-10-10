/** Source-backed national posts share the existing assignments, renderer and exports. */
import { state, DOCUMENT_DEFAULTS, SCHEMA_VERSION } from './state.js';
import { prepareLayer } from './geo.js';
import { presentation, bodyFont, capsFont } from './identity.js';

export const number = n => n.toLocaleString('en-US');
export const share = (n, total) => (100 * n / total).toFixed(2) + '%';
const integer = n => Number.isSafeInteger(n) && n >= 0;
const fail = reason => { throw new Error('Invalid national election: ' + reason); };

export function validateElectionPack(e) {
  if (!e || e.kind !== 'us-presidential' || e.country !== 'USA' || e.date !== '2024-11-05' ||
      e.status !== 'certified' || !integer(e.totalVotes) || !e.totalVotes ||
      !Array.isArray(e.candidates) || e.candidates.length !== 26 ||
      !Array.isArray(e.states) || e.states.length !== 51 ||
      !Array.isArray(e.sources) || e.sources.length !== 2 ||
      e.sources.some(s => !s.label || !/^https:\/\//.test(s.url))) fail('unsupported or incomplete source pack');
  const candidates = new Map(e.candidates.map(c => [c.id, c]));
  if (candidates.size !== 26 || e.candidates.some(c => !c.id || !c.name || !c.ballotLabels ||
      !integer(c.votes) || !integer(c.electoralVotes)) ||
      e.candidates.reduce((n, c) => n + c.votes, 0) !== e.totalVotes) fail('candidate totals do not reconcile');
  const codes = new Set();
  for (const r of e.states) {
    if (!r.postal || codes.has(r.postal) || !r.name || !r.votes || !r.electoralVotes) fail('duplicate or invalid state');
    codes.add(r.postal);
    if (!integer(r.votes.total) || !r.votes.total || Object.keys(r.votes).length !== 27 ||
        e.candidates.some(c => !Object.hasOwn(r.votes, c.id) ||
          (r.votes[c.id] !== null && !integer(r.votes[c.id]))) ||
        e.candidates.reduce((n, c) => n + (r.votes[c.id] ?? 0), 0) !== r.votes.total) fail('state votes do not reconcile');
    const ev = r.electoralVotes;
    if (![ev.electors, ev.trump, ev.harris].every(integer) || ev.trump + ev.harris !== ev.electors) fail('state electoral votes');
    if (!['trump', 'harris'].includes(r.winner) || r.votes[r.winner] == null ||
        e.candidates.some(c => (r.votes[c.id] ?? 0) > r.votes[r.winner])) fail('statewide leader');
  }
  for (const c of e.candidates) {
    if (e.states.reduce((n, r) => n + (r.votes[c.id] ?? 0), 0) !== c.votes ||
        e.states.reduce((n, r) => n + (r.electoralVotes[c.id] ?? 0), 0) !== c.electoralVotes) fail('national/state totals differ');
  }
  if (e.states.reduce((n, r) => n + r.votes.total, 0) !== e.totalVotes ||
      e.candidates.reduce((n, c) => n + c.electoralVotes, 0) !== 538 ||
      candidates.get('trump')?.electoralVotes !== 312 || candidates.get('harris')?.electoralVotes !== 226) fail('Electoral College totals');
}

export function validateNationalDocument(doc = state) {
  const e = doc.nationalElection;
  if (!e) return;
  validateElectionPack(e);
  if (doc.explainer || doc.layer !== 'ne:USA:ADM1' || doc.mode !== 'results' || doc.metric !== 'flat' ||
      Object.keys(doc.assign).length !== 51 || Object.keys(doc.flagged).length) fail('incompatible map or incomplete assignments');
  for (const s of e.states) {
    const a = doc.assign[s.key], candidate = e.candidates.find(c => c.id === s.winner);
    const p = doc.parties.find(p => p.id === a?.party);
    if (!s.key || !a || p?.name !== candidate.party || a.label !== candidate.name ||
        a.seats != null || a.turnout != null || !Number.isFinite(a.vote) ||
        Math.abs(a.vote - 100 * s.votes[s.winner] / s.votes.total) > 1e-8) fail('assignments differ from the source pack');
  }
}

export async function us2024Document(theme = 'light') {
  const res = await fetch('/data/us-presidential-2024.json');
  if (!res.ok) throw new Error('The official U.S. 2024 source pack could not load.');
  const e = await res.json(); validateElectionPack(e);
  const layer = await prepareLayer('ne:USA:ADM1');
  const byName = new Map(layer.feats.map(f => [f.name, f.key]));
  const parties = [{ id: 1, name: 'Republican', color: '#D0453E' }, { id: 2, name: 'Democratic', color: '#3B7DD8' }];
  const source = { source: 'FEC official state-certified presidential results', url: e.sources[0].url,
    asOf: e.date, asOfPrecision: 'day', datasetId: 'fec-us-president-2024', fetchedAt: '2026-10-10' };
  const assign = {};
  for (const s of e.states) {
    s.key = byName.get(s.name);
    if (!s.key) throw new Error('No matching state boundary for ' + s.name);
    const c = e.candidates.find(c => c.id === s.winner), other = s.winner === 'trump' ? 'harris' : 'trump';
    assign[s.key] = { party: s.winner === 'trump' ? 1 : 2, label: c.name,
      vote: 100 * s.votes[s.winner] / s.votes.total, seats: null, turnout: null,
      margin: 100 * (s.votes[s.winner] - s.votes[other]) / s.votes.total,
      datasetId: source.datasetId, provenance: Object.fromEntries(['party', 'label', 'vote', 'margin'].map(k => [k, { ...source }])) };
  }
  return { version: SCHEMA_VERSION, ...structuredClone(DOCUMENT_DEFAULTS), identity: 'history', theme,
    title: 'United States · 2024', sub: 'Presidential election · 5 November 2024 · Certified results',
    layer: 'ne:USA:ADM1', proj: 'albersUsa', parties, active: 1, assign, dots: false,
    provenance: { ...source, covered: 51, universe: Object.keys(assign) }, nationalElection: e };
}

export function nationalSummary(e = state.nationalElection) {
  return ['trump', 'harris'].map(id => {
    const c = e.candidates.find(c => c.id === id);
    return { ...c, statesWon: e.states.filter(s => s.winner === id && s.postal !== 'DC').length,
      dcWon: e.states.some(s => s.winner === id && s.postal === 'DC') };
  });
}

export function nationalNotes() {
  return [
    'Colours = statewide popular-vote leaders. Trump won the presidency with 312 EV (270 of 538 needed). States led are geographic counts, not electoral votes or seats.',
    'ME*: Harris 3 EV, Trump 1 (ME-2). NE*: Trump 4 EV, Harris 1 (NE-2). Statewide + district allocation; district boundaries not shown.',
    'Certified: 50 states + D.C. All 26 FEC categories included. Blank state cells = not reported, not zero; turnout rate not supplied.',
    'Natural Earth 1:10m · public domain · geographic vintage not stated. State/DC geography; no county results inferred. Alaska/Hawaii insets repositioned; Alaska at reduced scale; distant Aleutian islands clipped.'
  ];
}

export function drawNationalSummary(c, W, y, k, pad, { wrap, lines }) {
  if (!state.nationalElection) return y;
  const T = presentation(), width = (W - 2 * pad - 40 * k) / 3;
  const columns = nationalSummary().map(s => ({ label: `${s.name} / ${s.runningMate}`,
    total: `${s.electoralVotes} electoral votes`,
    detail: `${number(s.votes)} popular votes · ${share(s.votes, state.nationalElection.totalVotes)}` }));
  columns.push({ label: 'National popular-vote total', total: number(state.nationalElection.totalVotes),
    detail: '538 electoral votes · 270 needed to win' });
  c.font = `600 ${Math.round(21 * k)}px ${capsFont()}`;
  const lh = Math.max(...columns.map(s => lines(c, s.label, width))) * 25 * k;
  c.font = `600 ${Math.round(29 * k)}px ${bodyFont()}`;
  const th = Math.max(...columns.map(s => lines(c, s.total, width))) * 35 * k;
  c.font = `400 ${Math.round(18 * k)}px ${bodyFont()}`;
  const dh = Math.max(...columns.map(s => lines(c, s.detail, width))) * 24 * k;
  columns.forEach((s, i) => {
    const x = pad + i * (width + 20 * k);
    c.textAlign = 'left'; c.textBaseline = 'top'; c.fillStyle = T.text;
    c.font = `600 ${Math.round(21 * k)}px ${capsFont()}`; wrap(c, s.label, x, y, width, 25 * k);
    c.font = `600 ${Math.round(29 * k)}px ${bodyFont()}`; wrap(c, s.total, x, y + lh + 4 * k, width, 35 * k);
    c.font = `400 ${Math.round(18 * k)}px ${bodyFont()}`; wrap(c, s.detail, x, y + lh + th + 8 * k, width, 24 * k);
  });
  return y + lh + th + dh + 22 * k;
}

/** Measured footer retains every candidate/selection, rather than hiding small totals. */
export function nationalFooter(c, W, k, pad, { lines, wrap }, sidebarWidth = 0) {
  const T = presentation(), e = state.nationalElection, width = W - pad * 2;
  const heading = 'Other reported national popular votes (not an “Other” party)';
  const intro = [...nationalNotes().slice(0, 3), ...(sidebarWidth ? [] : [heading + ':'])];
  const minor = e.candidates.filter(c => !['trump', 'harris'].includes(c.id)).sort((a, b) => b.votes - a.votes);
  const columns = sidebarWidth ? 2 : 4;
  const colWidth = ((sidebarWidth || width) - (columns - 1) * 18 * k) / columns;
  c.font = `400 ${Math.round(16 * k)}px ${bodyFont()}`;
  const introHeights = intro.map(t => lines(c, t, width) * 21 * k + 5 * k);
  const rows = [];
  c.font = `400 ${Math.round(15 * k)}px ${bodyFont()}`;
  for (let i = 0; i < minor.length; i += columns) {
    const cells = minor.slice(i, i + columns).map(s => `${s.name}: ${number(s.votes)}`);
    rows.push({ cells, height: Math.max(...cells.map(t => lines(c, t, colWidth))) * 20 * k });
  }
  const tail = ['Candidate ballot labels vary by state; FEC pp. 7–9 lists every party/independent designation. Scattered write-ins are not attributed to a candidate.',
    nationalNotes()[3], ...e.sources.map(s => `${s.label} · ${s.url.replace(/^https:\/\//, '')}`), ...(state.handle.trim() ? [state.handle.trim()] : [])];
  c.font = `400 ${Math.round(16 * k)}px ${bodyFont()}`;
  const tailHeights = tail.map(t => lines(c, t, width) * 21 * k + 5 * k);
  const candidateHeight = rows.reduce((n, r) => n + r.height, 0);
  const headingHeight = lines(c, heading, sidebarWidth || width) * 21 * k + 10 * k;
  const height = 30 * k + introHeights.reduce((a, b) => a + b, 0) + (sidebarWidth ? 0 : candidateHeight) + 8 * k + tailHeights.reduce((a, b) => a + b, 0);
  const drawCandidates = (x, y) => {
    c.font = `400 ${Math.round(15 * k)}px ${bodyFont()}`;
    c.textAlign = 'left'; c.textBaseline = 'top'; c.fillStyle = T.text;
    if (sidebarWidth) {
      c.font = `400 ${Math.round(16 * k)}px ${bodyFont()}`; wrap(c, heading, x, y, sidebarWidth, 21 * k); y += headingHeight;
      c.font = `400 ${Math.round(15 * k)}px ${bodyFont()}`;
    }
    rows.forEach(row => { row.cells.forEach((t, i) => wrap(c, t, x + i * (colWidth + 18 * k), y, colWidth, 20 * k)); y += row.height; });
  };
  return { height, candidateHeight: candidateHeight + headingHeight, drawCandidates, draw(y) {
    c.font = `400 ${Math.round(16 * k)}px ${bodyFont()}`;
    c.textAlign = 'left'; c.textBaseline = 'top'; c.fillStyle = T.text;
    nationalSummary().forEach((s, i) => {
      const x = pad + i * width / 2;
      c.fillStyle = state.parties.find(p => p.name === s.party).color; c.fillRect(x, y + 3 * k, 12 * k, 12 * k);
      c.fillStyle = T.text; c.fillText(`${s.name} · ${s.party} · ${s.statesWon} states${s.dcWon ? ' + D.C.' : ''} led`, x + 20 * k, y);
    });
    y += 30 * k;
    intro.forEach((t, i) => { wrap(c, t, pad, y, width, 21 * k); y += introHeights[i]; });
    if (!sidebarWidth) { drawCandidates(pad, y); y += candidateHeight; }
    y += 8 * k; c.fillStyle = T.muted; c.font = `400 ${Math.round(16 * k)}px ${bodyFont()}`;
    tail.forEach((t, i) => { wrap(c, t, pad, y, width, 21 * k); y += tailHeights[i]; });
  } };
}
