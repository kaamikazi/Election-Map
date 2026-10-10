import { test, expect } from '@playwright/test';
import { PARTIES, SEED } from './fixtures/seed.js';

async function open(page) {
  await page.goto('/');
  await page.waitForFunction(() => document.querySelectorAll('#countryList .crow').length > 10);
}

for (const theme of ['dark', 'light']) {
  test(`${theme}: the branded PNG keeps result colours, citations and transparency`, async ({ page }) => {
    await open(page);
    const result = await page.evaluate(async ({ parties, seed, theme }) => {
      const { state } = await import('/src/state.js');
      const { prepareIdentity } = await import('/src/identity.js');
      Object.assign(state, { identity: 'history', theme, parties,
        assign: Object.fromEntries(Object.entries(seed).map(([key, [party]]) => [key, { party, provenance: { party: { source: 'Test fixture · CC0', asOf: '2023-01-01' } } }])),
        fit: [[-26, 33], [46, 72]], title: 'Who governs Europe', sub: 'Illustrative style test',
        handle: '', labels: false, provenance: { source: 'Test fixture · CC0',
          asOf: '2023-01-01', covered: Object.keys(seed).length } });
      await prepareIdentity();
      const before = JSON.stringify({ parties: state.parties, assign: state.assign, provenance: state.provenance });
      const text = [];
      const original = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function(s, ...args) { text.push(s); return original.call(this,s,...args); };
      try {
        const shots = [];
        for (const [w,h] of [[1600,900],[1200,1200],[1200,1500]]) {
          const report = {};
          const cv = window.__studio.composite(w,h,{report});
          const d = cv.getContext('2d').getImageData(0,0,w,h).data;
          const exact = (hex) => {
            const rgb = [1,3,5].map(i => parseInt(hex.slice(i,i+2),16));
            let count=0;
            for(let i=0;i<d.length;i+=4) if(rgb.every((v,j)=>d[i+j]===v)) count++;
            return count;
          };
          shots.push({ width:cv.width,height:cv.height,box:report.projection.box,
            partyPixels:parties.map(p=>exact(p.color)) });
        }
        const transparent = window.__studio.composite(1200,1200,{transparent:true});
        return { shots, text:text.join(' '), before,
          after:JSON.stringify({ parties:state.parties,assign:state.assign,provenance:state.provenance }),
          alpha:transparent.getContext('2d').getImageData(0,0,1,1).data[3] };
      } finally { CanvasRenderingContext2D.prototype.fillText=original; }
    }, { parties:PARTIES,seed:SEED,theme });
    expect(result.before).toBe(result.after);
    expect(result.alpha).toBe(0);
    expect(result.text).toContain('History Through Maps');
    expect(result.text).toContain('Test fixture · CC0');
    for(const shot of result.shots) {
      expect(shot.box[1]).toBeGreaterThan(80*shot.width/1600);
      for(const n of shot.partyPixels) expect(n).toBeGreaterThan(50);
    }
  });
}

test('the style control survives save/open while old documents stay classic', async ({ page }) => {
  await open(page);
  await page.selectOption('#fIdentity','history');
  await page.waitForFunction(()=>window.__studio.state.identity==='history');
  const result=await page.evaluate(async()=>{
    const {toDocument,state}=await import('/src/state.js');
    const {restoreDocument,validateDocument}=await import('/src/restore.js');
    const saved=structuredClone(toDocument());
    state.identity='classic';
    await restoreDocument(saved);
    const old=structuredClone(saved);delete old.identity;
    return {identity:state.identity,old:validateDocument(old).identity};
  });
  expect(result).toEqual({identity:'history',old:'classic'});
  await expect(page.locator('#fIdentity')).toHaveValue('history');
});

test('missing brand assets stop export and leave the control on the working identity', async ({ page }) => {
  await page.route('**/brand/fonts/IMFeENit.ttf', route=>route.abort());
  await open(page);
  await page.selectOption('#fIdentity','history');
  await expect(page.locator('#fIdentity')).toBeEnabled();
  await expect(page.locator('#fIdentity')).toHaveValue('classic');
  const refused=await page.evaluate(()=>{
    window.__studio.state.identity='history';
    try {window.__studio.composite(1200,1200);return false;}
    catch(err){return /identity.*loading/i.test(err.message);}
  });
  expect(refused).toBe(true);
});

test('branded series lock the map box, palette and presentation across years', async ({ page }) => {
  await open(page);
  const result=await page.evaluate(async()=>{
    const {state}=await import('/src/state.js');
    const {planSeries,renderFrame,manifest}=await import('/src/series.js');
    state.identity='history';state.theme='light';
    await planSeries({from:1975,to:1983,width:1200,height:1200,scope:'Europe',grouping:'family'});
    const a=await renderFrame(0);
    const palette=JSON.stringify(state.parties.map(p=>[p.slotKey,p.color]));
    state.theme='dark';state.identity='classic';
    const b=await renderFrame(8);
    return {a:a.projection,b:b.projection,palette,
      after:JSON.stringify(state.parties.map(p=>[p.slotKey,p.color])),presentation:manifest().presentation};
  });
  expect(result.a).toEqual(result.b);
  expect(result.palette).toBe(result.after);
  expect(result.presentation).toEqual({identity:'history',theme:'light'});
});
