#!/usr/bin/env node
/**
 * Retrospective findings for an earlier snapshot.
 *
 * Compares an earlier snapshot generation with a later one. A latest held
 * event in the later snapshot that is dated on or before the earlier cutoff,
 * but was not the earlier snapshot's selection, is a fact that later evidence
 * established about the earlier date. It is recorded here, labelled, with its
 * evidence; the earlier generation itself is never changed.
 *
 * Usage: node scripts/retrospective-findings.js <earlierGeneration> <laterGeneration>
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {ROOT} from './lib/registry.js';
import {readJson,json} from './ingestion/util.js';

const [earlier,later]=process.argv.slice(2);
const dir=g=>path.join(ROOT,'public/data/catalog/generations',g);
const [mA,mB]=await Promise.all([readJson(path.join(dir(earlier),'manifest.json')),readJson(path.join(dir(later),'manifest.json'))]);
if(mA.cutoffUtc>=mB.cutoffUtc)throw new Error('The first generation must be the earlier snapshot');
const [LA,LB,EB]=await Promise.all([readJson(path.join(dir(earlier),'ledger.json')),readJson(path.join(dir(later),'ledger.json')),readJson(path.join(dir(later),'events.json'))]);
const cutoffDay=mA.cutoffUtc.slice(0,10),findings=[];
for(const j of LB.filter(j=>j.scope==='core'))for(const category of ['legislative','presidential']){
  const b=j.categories[category],a=LA.find(x=>x.iso3===j.iso3)?.categories[category];
  if(!b?.latestHeld||b.latestHeld.date>cutoffDay)continue;
  if(a?.latestHeld&&a.latestHeld.date>=b.latestHeld.date)continue;
  const e=EB.find(x=>x.id===b.latestHeld.id),cite=(e?.citations||[])[0]||{};
  findings.push({country:j.iso3,category,label:'retrospective',
    fact:`Election held ${b.latestHeld.date}${b.latestHeld.endDate&&b.latestHeld.endDate!==b.latestHeld.date?`–${b.latestHeld.endDate}`:''}, on or before the earlier cutoff ${mA.cutoffUtc}`,
    earlierSnapshotSelection:a?.latestHeld?{date:a.latestHeld.date,sourceId:a.latestHeld.sourceId}:null,
    laterStatusAtLaterCutoff:b.resultState?.state||b.status,
    evidence:{sourceId:cite.sourceId||e?.sourceId||null,url:cite.url||null,sha256:cite.sha256||null,locator:cite.locator||null,capturedAt:cite.retrievedAt||null,published:e?.sourceArticle?.revisionTime||null},
    note:'Established by evidence captured for the later snapshot. The earlier snapshot is unchanged; its pinned sources had not recorded this event at its cutoff. Results reported after the earlier cutoff are later developments, not part of this finding.'});
}
const out={version:1,earlierGeneration:earlier,earlierCutoff:mA.cutoffUtc,laterGeneration:later,laterCutoff:mB.cutoffUtc,findings};
const file=path.join(ROOT,'build/catalog',`retrospective-${mA.cutoffUtc.slice(0,10)}.json`);
await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,json(out));
console.log(json({file:path.relative(ROOT,file),findings:findings.map(f=>`${f.country} ${f.category}: ${f.fact}`)}));
