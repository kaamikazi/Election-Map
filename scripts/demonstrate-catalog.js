#!/usr/bin/env node
/** Real application proposals and renderer; snapshots keep visible gaps and citations. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from '@playwright/test';
import {ROOT} from './lib/registry.js';
import {json} from './ingestion/util.js';
const out=path.join(ROOT,'build/catalog-demonstration'),port=5203,base=`http://127.0.0.1:${port}`;
await fs.mkdir(out,{recursive:true});
const server=spawn(process.execPath,[path.join(ROOT,'scripts/dev-server.js'),'--port',String(port)],{cwd:ROOT,windowsHide:true,stdio:['ignore','pipe','pipe']});let browser;
try{
  let ready=false;for(let i=0;i<60;i++){try{if((await fetch(base)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}if(!ready)throw new Error('Local demonstration server unavailable');
  browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:900}});
  const manifest={version:1,kind:'worldwide-catalog/real-app-drafts',drafts:[]};
  for(const view of ['date','seats','vote','presidential','turnout','coverage']){
    await page.goto(base);await page.waitForFunction(()=>document.querySelectorAll('#countryList .crow').length>10);
    const result=await page.evaluate(async view=>{
      const {adapterById}=await import('/src/import/adapters.js'),{buildProposal,applyProposal}=await import('/src/import/proposal.js'),{state,toDocument}=await import('/src/state.js');
      const draft=await adapterById('catalog').propose({view});const proposal=buildProposal(draft),applied=applyProposal(proposal);
      state.metric='flat';state.publication.ready=false;state.publication.approvalFingerprint=null;await window.__studio.prepareExport();
      const report={},png=window.__studio.composite(1600,1200,{report}).toDataURL('image/png');
      return {applied,eligible:draft.source.catalog.eligible,withoutGeometry:draft.source.catalog.withoutGeometry,cutoffUtc:draft.source.catalog.cutoffUtc,
        map:toDocument(),png,badge:report.badge,exactKeys:proposal.rows.filter(r=>r.how==='source code').length};
    },view);
    await fs.writeFile(path.join(out,`${view}.png`),Buffer.from(result.png.split(',')[1],'base64'));
    await fs.writeFile(path.join(out,`${view}-map.json`),json(result.map));
    const citations=Object.fromEntries(Object.values(result.map.assign).map(r=>[r.catalog.event?.country||r.label.split(':')[0],{
      eventId:r.catalog.event?.id||null,date:r.catalog.event?.date||null,endDate:r.catalog.event?.endDate||null,office:r.catalog.event?.office||null,
      view:r.catalog.view,metric:r.catalog.metric,status:r.catalog.status,latestClaim:r.catalog.latestClaim,citations:r.catalog.event?.citations||[],geometry:r.catalog.geometry}]));
    await fs.writeFile(path.join(out,`${view}-country-citations.json`),json({cutoffUtc:result.cutoffUtc,countries:citations}));
    await page.screenshot({path:path.join(out,`${view}-desktop.png`)});
    manifest.drafts.push({view,applied:result.applied.applied,eligible:result.eligible,exactKeys:result.exactKeys,withoutGeometry:result.withoutGeometry,
      cutoffUtc:result.cutoffUtc,badge:result.badge,png:`${view}.png`,map:`${view}-map.json`,citations:`${view}-country-citations.json`,ready:false});
  }
  await page.goto(base);await page.waitForFunction(()=>document.querySelectorAll('#countryList .crow').length>10);
  await page.click('#openImport');await page.click('[data-a="catalog"]');await page.fill('#in_country','FRA');await page.fill('#in_date','2022');await page.click('#btnPropose');
  await page.waitForSelector('#reviewBody .option');await page.screenshot({path:path.join(out,'catalog-search.png')});
  await page.locator('#reviewBody .option').first().click();await page.waitForFunction(()=>document.querySelector('#reviewBody .prompt')?.textContent.includes('select a view'));
  await page.screenshot({path:path.join(out,'catalog-metric-reasons.png')});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'catalog-mobile.png')});
  await fs.writeFile(path.join(out,'export-manifest.json'),json(manifest));console.log(json(manifest));
}finally{if(browser)await browser.close();server.kill();}
