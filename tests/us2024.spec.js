import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function start(page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__studio?.state);
  if (page.viewportSize().width < 700) { await page.click('#grab'); await page.click('#grab'); }
  await page.click('#startUS2024');
  await page.waitForFunction(() => !!window.__studio.state.nationalElection);
}

test('official national/state totals, split electors and unreported cells stay distinct', async ({ page }) => {
  await start(page);
  const actual = await page.evaluate(async () => {
    const { state } = await import('/src/state.js');
    const { nationalSummary } = await import('/src/national-election.js');
    const e = state.nationalElection;
    return { total: e.totalVotes, categories: e.candidates.length, rows: e.states.length,
      major: nationalSummary(), me: e.states.find(s => s.postal === 'ME'), ne: e.states.find(s => s.postal === 'NE'),
      ca: e.states.find(s => s.postal === 'CA'),
      records: Object.values(state.assign), provenance: state.provenance };
  });
  expect(actual.total).toBe(155238302); expect(actual.categories).toBe(26); expect(actual.rows).toBe(51);
  expect(actual.major.map(c => [c.votes, c.electoralVotes, c.statesWon, c.dcWon])).toEqual([
    [77302580, 312, 31, false], [75017613, 226, 19, true]]);
  expect(actual.me.electoralVotes).toEqual({ electors: 4, trump: 1, harris: 3 });
  expect(actual.ne.electoralVotes).toEqual({ electors: 5, trump: 4, harris: 1 });
  expect(actual.me.winner).toBe('harris'); expect(actual.ne.winner).toBe('trump');
  expect(actual.ca.votes.scattered).toBeNull();
  expect(actual.records.every(r => r.seats === null && r.turnout === null && r.provenance.vote.source.includes('FEC'))).toBe(true);
  await expect(page.locator('#legendTitle')).toHaveText('Statewide popular-vote leader');
  await expect(page.locator('#legend')).toContainText('312 electoral votes');
  await expect(page.locator('#addParty')).toBeDisabled();
  await expect(page.locator('#partyList .pname').first()).toBeDisabled();
});

test('save/open and full-document undo; state inspection does not paint official results', async ({ page }) => {
  await page.goto('/'); await page.waitForFunction(() => window.__studio?.state);
  const before = await page.evaluate(() => JSON.stringify(window.__studio.state));
  await page.click('#startUS2024'); await page.waitForFunction(() => !!window.__studio.state.nationalElection);
  const result = await page.evaluate(async () => {
    const { state, toDocument, undo, paint, setValue } = await import('/src/state.js');
    const { restoreDocument } = await import('/src/restore.js');
    const saved = structuredClone(toDocument()), ca = state.nationalElection.states.find(s => s.postal === 'CA');
    const assignments = JSON.stringify(state.assign); paint(ca.key); setValue(ca.key, 'seats', 54);
    const unchanged = assignments === JSON.stringify(state.assign), selected = state.selected;
    await restoreDocument(saved);
    const reopened = JSON.stringify(toDocument()); await undo(); await undo();
    return { unchanged, selected, ca: ca.key, reopened, saved: JSON.stringify(saved), after: JSON.stringify(state) };
  });
  expect(result.unchanged).toBe(true); expect(result.selected).toBe(result.ca);
  expect(result.reopened).toBe(result.saved); expect(result.after).toBe(before);
});

for (const [name, w, h] of [['wide', 1600, 900], ['square', 1200, 1200], ['portrait', 1200, 1500]]) {
  test(`${name}: both themes retain all states, every national category and sources; individual export parity`, async ({ page }) => {
    await start(page);
    const r = await page.evaluate(async ({ w, h }) => {
      const { state } = await import('/src/state.js'); const { prepareExport } = await import('/src/flags.js');
      const { compositePair, composite } = await import('/src/export.js'); await prepareExport();
      const before = JSON.stringify(state), text = [];
      const original = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function(s, ...args) { text.push(s); return original.call(this, s, ...args); };
      try {
        const pair = compositePair(w * 1.5, h * 1.5, { withLegend: false });
        const oldTheme = state.theme; state.theme = 'light';
        const lightMatches = composite(w * 1.5, h * 1.5, { withLegend: false }).toDataURL() === pair.light.canvas.toDataURL();
        state.theme = 'dark';
        const darkMatches = composite(w * 1.5, h * 1.5, { withLegend: false }).toDataURL() === pair.dark.canvas.toDataURL();
        state.theme = oldTheme;
        const colours = Object.fromEntries(Object.entries(pair).map(([theme, {canvas}]) => {
          const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
          const counts = state.parties.map(p => {
            const rgb = [1,3,5].map(i => parseInt(p.color.slice(i, i+2),16)); let n=0;
            for(let i=0; i<pixels.length; i+=4) if(rgb.every((v,j)=>pixels[i+j]===v)) n++;
            return n;
          }); return [theme,counts];
        }));
        return { before, after: JSON.stringify(state), lightMatches, darkMatches, colours,
          reports: [pair.light.report,pair.dark.report], text: text.join(' '), names: state.nationalElection.candidates.map(c => c.name) };
      } finally { CanvasRenderingContext2D.prototype.fillText = original; }
    }, { w, h });
    expect(r.before).toBe(r.after); expect(r.lightMatches && r.darkMatches).toBe(true);
    expect(r.reports[0]).toEqual(r.reports[1]);
    expect(r.reports[0].nationalUnits).toHaveLength(51);
    expect(r.reports[0].nationalUnits.every(s => s.visible)).toBe(true);
    for(const counts of Object.values(r.colours)) expect(counts.every(n=>n>500)).toBe(true);
    for(const name of r.names) expect(r.text).toContain(name);
    for(const s of ['312 electoral votes','226 electoral votes','155,238,302','49.80%','48.32%',
      'ME-2','NE-2','not zero','turnout rate not supplied','geographic vintage not stated',
      'fec.gov/documents/5644','archives.gov/electoral-college/2024']) expect(r.text).toContain(s);
  });
}

test('actual paired downloads and export preview use the same rendering path', async ({ page }) => {
  await start(page); await page.click('#openExport');
  await expect(page.locator('#xLegend')).toBeHidden();
  const downloads=[]; page.on('download',d=>downloads.push(d));
  await page.click('#btnThemes'); await expect.poll(()=>downloads.length).toBe(2);
  const r=await page.evaluate(async()=>{
    const {composite,compositePair}=await import('/src/export.js');
    const pair=compositePair(2400,1350);
    return {light:pair.light.canvas.toDataURL().split(',')[1],dark:pair.dark.canvas.toDataURL().split(',')[1],
      preview:document.querySelector('#preview').toDataURL()===composite(1600,900).toDataURL(),theme:window.__studio.state.theme};
  });
  expect(r.preview).toBe(true);expect(r.theme).toBe('light');
  expect((await readFile(await downloads[0].path())).toString('base64')).toBe(r.light);
  expect((await readFile(await downloads[1].path())).toString('base64')).toBe(r.dark);
});

test('partial/mixed data, wrong projection, clipped states and overflow refuse export', async ({ page }) => {
  await start(page);
  const errors=await page.evaluate(async()=>{
    const {state,toDocument}=await import('/src/state.js');const {validateDocument}=await import('/src/restore.js');
    const {compositePair}=await import('/src/export.js');const {prepareExport}=await import('/src/flags.js');await prepareExport();
    const errors=[],saved=JSON.stringify(state);
    for(const change of [d=>d.nationalElection.totalVotes++, d=>d.nationalElection.states.pop(),
      d=>delete d.assign[Object.keys(d.assign)[0]],d=>d.assign[Object.keys(d.assign)[0]].seats=3]){
      const d=structuredClone(toDocument());change(d);try{validateDocument(d);errors.push('accepted')}catch(e){errors.push(e.message)}
    }
    for(const change of [()=>state.proj='mercator',()=>state.zoom=5,()=>state.title='Long title '.repeat(500)]){
      Object.assign(state,JSON.parse(saved));change();try{compositePair(1600,900);errors.push('accepted')}catch(e){errors.push(e.message)}
    }
    Object.assign(state,JSON.parse(saved));return errors;
  });
  expect(errors).toHaveLength(7);expect(errors.every(e=>e!=='accepted')).toBe(true);
  expect(errors[4]).toContain('USA insets');expect(errors[5]).toContain('outside the national map frame');
  expect(errors[6]).toContain('too little map space');
});

test('clearing or changing mode/layer exits national overview; undo restores it', async ({ page }) => {
  await start(page);
  const results=await page.evaluate(async()=>{
    const {state,clearAssignments,setMode,switchLayer,undo,toDocument}=await import('/src/state.js');
    const {loadLayer}=await import('/src/geo.js');const saved=JSON.stringify(toDocument());const checks=[];
    clearAssignments();checks.push(state.nationalElection===null && !document.querySelector('#addParty').disabled && document.querySelector('#nationalNote').hidden);
    await undo();checks.push(JSON.stringify(toDocument())===saved);
    setMode('flags');checks.push(state.nationalElection===null);await undo();checks.push(JSON.stringify(toDocument())===saved);
    switchLayer('world');await loadLayer('world');checks.push(state.nationalElection===null&&state.proj==='equalEarth');
    await undo();checks.push(JSON.stringify(toDocument())===saved);return checks;
  });
  expect(results.every(Boolean)).toBe(true);
});

test('national starter keeps phone controls within the viewport', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});await start(page);
  const r=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,
    states:window.__studio.state.nationalElection.states.length}));
  expect(r.scroll).toBeLessThanOrEqual(r.width);expect(r.states).toBe(51);
});

test('a new results import exits the national post and undo restores source totals and USA framing', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(async () => {
    const { state, undo } = await import('/src/state.js');
    const { adapterById } = await import('/src/import/adapters.js');
    const { buildProposal, applyProposal } = await import('/src/import/proposal.js');
    const saved = JSON.stringify(state);
    const draft = await adapterById('clipboard').propose({ text: 'Region\tParty\tVote\nCalifornia\tTest fixture party\t99', sourceLabel: 'Undo test only', datasetId: 'undo-fixture' });
    const result = applyProposal(buildProposal(draft), { replace: true });
    const exited = state.nationalElection === null && state.proj === 'equalEarth';
    await undo(); return { applied: result.applied, exited, restored: JSON.stringify(state) === saved };
  });
  expect(r.applied).toBe(1); expect(r.exited && r.restored).toBe(true);
});
