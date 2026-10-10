import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ROOT} from '../scripts/lib/registry.js';
import {json,hash,fingerprint} from '../scripts/ingestion/util.js';
import {CatalogEngine,readCatalog} from '../scripts/catalog/engine.js';
import {downloadCatalog,replayCatalog,validatePages} from '../scripts/catalog/acquire.js';
import {event,parseIPU,day} from '../scripts/catalog/adapters.js';
import {metrics,selectLatest,groupRounds} from '../scripts/catalog/metrics.js';
import {buildLedger,ledgerCounts,historyReport,worldProof} from '../scripts/catalog/ledger.js';
import {geography} from '../scripts/ingestion/validate.js';
import {reviewPublication} from '../src/publication.js';

const cutoff='2026-10-01T05:00:35.000Z';
const source={id:'ipu-parline',parser:'ipu-jsonapi-v1',baseUrl:'https://example.test/ipu/',entities:['countries','parliaments','chambers','elections','political_parties'],pageSize:2,maxPages:5,cacheHours:24,licence:{name:'SYNTHETIC TEST EVIDENCE',attribution:'Synthetic transport fixture'}};
const scope=JSON.parse(await fs.readFile(path.join(ROOT,'data/jurisdictions.json')));
const world=(await geography(ROOT)).layers.get('world');
const val=value=>({value,missing_reason:''});
const timed=value=>[{value,date_from:'2000-01-01',date_to:'',missing_reason:''}];
function national(overrides={}){
  return event({country:'FRA',category:'legislative',chamber:'TEST-LOWER',office:'Synthetic test lower house',direction:'directly_elected',date:'2020-06-01',endDate:'2020-06-01',
    sourceId:'fixture',sourceElectionId:randomUUID(),holdingStatus:'held',renewal:'full_renewal',resultStatus:'official-final',completion:{state:'completed'},
    parties:[{id:'fixture:A',name:'Synthetic A',seats:6,voteShare:60,votes:600},{id:'fixture:B',name:'Synthetic B',seats:4,voteShare:40,votes:400}],seatsAtStake:10,citations:[],...overrides});
}
async function harness(){
  const root=path.join(ROOT,'tests/.tmp/catalog',randomUUID());
  await fs.mkdir(path.join(root,'data'),{recursive:true});await fs.mkdir(path.join(root,'public/data'),{recursive:true});
  await fs.writeFile(path.join(root,'data/catalog-sources.json'),json({version:1,sources:[source],researchedProviders:[]}));
  await fs.writeFile(path.join(root,'data/jurisdictions.json'),json(scope));await fs.writeFile(path.join(root,'data/catalog-execution.json'),json({executionStartUtc:cutoff}));
  for(const f of ['world-50m.topo.json','boundaries.json'])await fs.copyFile(path.join(ROOT,'public/data',f),path.join(root,'public/data',f));
  const rows={countries:[{type:'Country',id:'FR',attributes:{iso_alpha3:val('FRA'),political_system:timed({term:'presidential_system'}),political_subsystem:timed({term:'republic'})}}],
    parliaments:[{type:'Parliament',id:'FR',attributes:{structure_of_parliament:timed({term:'unicameral'}),is_suspended_parliament:timed(false)}}],
    chambers:[{type:'Chamber',id:'FR-LC01',attributes:{struct_parl_status:val({term:'lower_chamber'}),chamber_name:timed({en:'Synthetic test lower house'}),designation_mode:timed({term:'directly_elected'}),is_suspended_chamber:timed(false),last_election:val({from:'2025-01-01T00:00:00.000Z'})}}],
    elections:[{type:'Election',id:'FR-LC01-TEST2020',attributes:{chamber:val('FR-LC01'),election_date:val({from:'2020-06-01T00:00:00.000Z'}),first_session_date:val('2020-06-10T00:00:00.000Z'),scope_of_elections:val({term:'full_renewal'}),number_of_seats_at_stake:val(10),seats_per_parties:val([{party:'fixture-a',total_number_of_seats:6},{party:'fixture-b',total_number_of_seats:4}])}},
      {type:'Election',id:'FR-LC01-TEST2025',attributes:{chamber:val('FR-LC01'),election_date:val({from:'2025-01-01T00:00:00.000Z'}),scope_of_elections:val({term:'full_renewal'})}},
      {type:'Election',id:'FR-LC01-TEST2028',attributes:{chamber:val('FR-LC01'),election_date:val({from:'2028-01-01T00:00:00.000Z'})}}],
    political_parties:[{political_party_code:'fixture-a',party_name:{en:'Synthetic A'}},{political_party_code:'fixture-b',party_name:{en:'Synthetic B'}}]};
  let calls=0;const fetchImpl=async url=>{calls++;const u=new URL(url),entity=u.pathname.split('/').at(-1),n=Number(u.searchParams.get('page[number]')),size=Number(u.searchParams.get('page[size]')),all=rows[entity];if(!all)throw new Error('Unregistered test endpoint');const data=all.slice((n-1)*size,n*size);const body=json({meta:{total:all.length,row_count:data.length},data});return new Response(body,{headers:{'content-length':String(Buffer.byteLength(body)),etag:'synthetic-test'}});};
  const cache=path.join(root,'cache'),database=path.join(root,'database'),reports=path.join(root,'reports');
  const batch=await downloadCatalog(root,{cache,fetchImpl,now:()=>cutoff});
  const engine=await new CatalogEngine({root,cache,database,reports}).setup();
  return {root,cache,database,reports,engine,batch,rows,fetchImpl,get calls(){return calls;}};
}

test('newer held election supersedes archive without substituting pending results',()=>{
  const old=national(),pending=national({date:'2025-01-01',endDate:'2025-01-01',resultStatus:'pending-or-missing',parties:[],completion:{state:'unknown'}});
  const selected=selectLatest([old,pending],cutoff);expect(selected.held.id).toBe(pending.id);expect(selected.completed.id).toBe(old.id);expect(metrics(pending).seats.eligible).toBe(false);
});
test('upcoming elections and cancelled contests do not become held results',()=>{
  const old=national(),upcoming=national({date:'2028-01-01',endDate:'2028-01-01',holdingStatus:'upcoming'}),cancelled=national({date:'2026-01-01',resultStatus:'cancelled'});
  expect(selectLatest([upcoming,cancelled,old],cutoff).held.id).toBe(old.id);
});
test('presidential and legislative selections remain separate with indirect election meaning',()=>{
  const leg=national(),pres=national({category:'presidential',office:'President',direction:'indirectly_elected',candidates:[{id:'P',name:'Synthetic P',elected:true,votes:null}]});
  expect(selectLatest([leg,pres].filter(e=>e.category==='presidential'),cutoff).held.id).toBe(pres.id);expect(metrics(pres).presidential.value.name).toBe('Synthetic P');
});
test('explicit runoff linkage groups rounds; a same-year rerun stays a separate identity',()=>{
  const a=national({sourceId:'fixture',sourceElectionId:'one',parentEventId:'general',rounds:[{number:1,date:'2020-06-01'}]}),b=national({parentEventId:'general',date:'2020-06-20',endDate:'2020-06-20',rounds:[{number:2,date:'2020-06-20'}]}),rerun=national({date:'2020-08-01',endDate:'2020-08-01',electionKind:'rerun'});
  const grouped=groupRounds([a,b,rerun]);expect(grouped).toHaveLength(2);expect(grouped.find(e=>e.grouping).rounds).toHaveLength(2);expect(selectLatest(grouped,cutoff).held.id).toBe(rerun.id);
});
test('partial renewals and by-elections cannot stand for whole-chamber totals',()=>{
  expect(metrics(national({renewal:'partial_renewal'})).seats.eligible).toBe(false);expect(selectLatest([national({electionKind:'by-election'})],cutoff).held).toBe(null);
});
test('ties preserve all leaders; missing totals and alliance overlap disable affected metrics',()=>{
  const tie=national({parties:[{id:'A',name:'A',seats:5,voteShare:50},{id:'B',name:'B',seats:5,voteShare:50}]});expect(metrics(tie).seats.value.tie).toBe(true);expect(metrics(tie).majority.value.majority).toBe(false);
  expect(metrics(national({seatsAtStake:null})).seats.eligible).toBe(false);
  tie.parties[0].allianceMembers=['B'];expect(metrics(tie).seats.reason).toContain('overlap');
});
test('metric-specific eligibility does not require a reported parliamentary winner',()=>{
  const e=national();expect(metrics(e).seats.eligible).toBe(true);expect(metrics(e).vote.eligible).toBe(true);expect(metrics(e).presidential.eligible).toBe(false);expect(metrics(e).turnout.eligible).toBe(false);
  e.parties[1].voteShare=null;expect(metrics(e).vote.eligible).toBe(false);expect(metrics(e).seats.eligible).toBe(true);
});
test('turnout requires coherent numerator and denominator, and zero differs from absent',()=>{
  const e=national({turnout:{percent:0,numerator:0,denominator:100,definition:'voters / registered electors'}});expect(metrics(e).turnout.eligible).toBe(true);
  e.turnout.numerator=null;expect(metrics(e).turnout.eligible).toBe(false);
});
test('incomplete pagination and duplicate election IDs cannot establish freshness',()=>{
  const page={body:{meta:{total:2,row_count:1},data:[{id:'a'}]}};expect(()=>validatePages([page])).toThrow(/Incomplete/);
  expect(()=>validatePages([{body:{meta:{total:2,row_count:2},data:[{id:'a'},{id:'a'}]}}])).toThrow(/Incomplete/);
});
test('stale provider records remain latest available, never silently current',()=>{
  const selected=selectLatest([national()],cutoff);expect(selected.latestChecked).toBe(false);expect(selected.independentlyConfirmedLatest).toBe(false);
});
test('all 195 core states and categories exist, and monarchy, appointed, suspended and missing differ',()=>{
  const ipu={systems:[{country:'GBR',subtype:'constitutional_monarchy',structure:'unicameral'}],structures:[{country:'SAU',category:'legislative',direction:'appointed',citation:{}},{country:'AFG',category:'legislative',suspended:true,citation:{}}]};
  const ledger=buildLedger({jurisdictions:scope.jurisdictions,events:[],ipu,attempts:[],cutoff,world});const counts=ledgerCounts(ledger);expect(counts.coreJurisdictions).toBe(195);
  expect(ledger.find(j=>j.iso3==='GBR').categories.presidential.status).toBe('no-applicable-election');expect(ledger.find(j=>j.iso3==='SAU').categories.legislative.status).toBe('appointed-institution');
  expect(ledger.find(j=>j.iso3==='AFG').categories.legislative.status).toBe('suspended-institution');expect(ledger.find(j=>j.iso3==='FRA').categories.presidential.status).toBe('missing-evidence');
});
test('calendar validation rejects invented full dates',()=>{expect(day('2025-02-31')).toBe(null);expect(day('2024-02-29T00:00:00.000Z')).toBe('2024-02-29');});
test('country geometry needs an exact registered primary name when numeric codes repeat',()=>{
  expect(worldProof(world,'AUS')).toBe(null);expect(worldProof(world,'AUS','Australia').key).toBe('Australia');expect(worldProof(world,'AUS','Australia').excludedFeatures).toContain('Ashmore and Cartier Is.');expect(worldProof(world,'TUV','Tuvalu')).toBe(null);
});
test('same-year offices and changed rounds preserve distinct full identities',()=>{
  const a=national({sourceElectionId:'same',rounds:[{number:1,date:'2020-06-01'}]}),b=national({sourceElectionId:'same',rounds:[{number:2,date:'2020-06-01'}]}),c=national({sourceElectionId:'same',office:'President',rounds:[{number:1,date:'2020-06-01'}]});
  expect(new Set([a.id,b.id,c.id]).size).toBe(3);
  expect(national({sourceElectionId:'same',direction:null,rounds:a.rounds}).id).toBe(a.id);
});
test('appointed renewals do not become held elections, while independent source history still backfills',async()=>{
  const h=await harness();h.rows.chambers[0].attributes.designation_mode=timed({term:'appointed'});
  const batch=await downloadCatalog(h.root,{cache:h.cache,fetchImpl:h.fetchImpl,refresh:true,now:()=>cutoff});
  const parsed=parseIPU(batch,cutoff);expect(parsed.events.every(e=>e.holdingStatus==='appointment')).toBe(true);
  const plan=await h.engine.validate({batch,history:true});expect(plan.phase).toBe('B-history-after-A');expect(plan.ledger.find(j=>j.iso3==='FRA').categories.legislative.status).toBe('appointed-institution');
});
test('fresh checkout without raw or generated catalog bootstraps and replays byte-identically',async()=>{
  const h=await harness();const plan=await h.engine.validate({batch:h.batch});const first=await h.engine.commit(plan);const calls=h.calls;
  const offline=await replayCatalog(h.root,h.cache);const second=await h.engine.commit(await h.engine.validate({batch:offline}));expect(second.generation).toBe(first.generation);expect(second.changed).toBe(false);expect(h.calls).toBe(calls);
  const current=await readCatalog(h.database);expect(current.ledger.filter(j=>j.scope==='core')).toHaveLength(195);expect(current.events.some(e=>e.date==='2028-01-01')).toBe(false);
});
test('cached registered resources avoid repeated unchanged downloads',async()=>{
  // Same fixed clock as the harness's first download, so the result does not depend on today's date.
  const h=await harness(),calls=h.calls;await downloadCatalog(h.root,{cache:h.cache,fetchImpl:h.fetchImpl,now:()=>cutoff});expect(h.calls).toBe(calls);
  // And a clock past the cache window does fetch again: freshness really is checked.
  await downloadCatalog(h.root,{cache:h.cache,fetchImpl:h.fetchImpl,now:()=>'2026-10-03T05:00:35.000Z'});expect(h.calls).toBeGreaterThan(calls);
});
test('an interrupted catalog import and forged plan preserve the prior generation',async()=>{
  const h=await harness();const p=await h.engine.validate({batch:h.batch});const first=await h.engine.commit(p);const next=await h.engine.validate({batch:h.batch,cutoff:'2026-10-02T05:00:35.000Z'});
  await expect(h.engine.commit(next,{failAfter:2})).rejects.toThrow(/Interrupted/);expect((await readCatalog(h.database)).pointer.generation).toBe(first.generation);
  next.counts.coreJurisdictions=194;await expect(h.engine.commit(next)).rejects.toThrow(/changed/);
});
test('verified event changes require the exact validated plan confirmation',async()=>{
  const h=await harness();const p=await h.engine.validate({batch:h.batch}),settled=p.events.find(e=>e.parties.length);
  // This fixture's first-session event has no certification status: explicit source status review is required.
  expect(settled.resultStatus).toBe('reported-results');const decision={reviewer:'Synthetic test editor',decisions:[{id:settled.id,recordHash:settled.recordHash,state:'verified',reason:'Checked synthetic fixture evidence'}]};
  const approved=await h.engine.validate({batch:h.batch,decisions:decision});await h.engine.commit(approved);
  h.rows.elections[0].attributes.seats_per_parties.value[0].total_number_of_seats=7;h.rows.elections[0].attributes.seats_per_parties.value[1].total_number_of_seats=3;
  const changed=await downloadCatalog(h.root,{cache:h.cache,fetchImpl:h.fetchImpl,refresh:true,now:()=>cutoff});const next=await h.engine.validate({batch:changed});
  await expect(h.engine.commit(next)).rejects.toThrow(/confirm-replace/);await h.engine.commit(next,{confirmReplace:next.planId});
  expect((await readCatalog(h.database)).events.find(e=>e.id===settled.id).review.state).toBe('imported-with-warning');
});
test('history reports exact ranges and preserve same-year source and office identities',()=>{
  const a=national({date:'1950-01-01'}),b=national({date:'2020-05-01'}),c=national({date:'2020-05-01',office:'Upper house',category:'upper-house'});
  const r=historyReport(scope.jurisdictions,[a,b,c]).find(j=>j.country==='FRA');expect(r.events).toBe(3);expect(r.earliest).toBe('1950-01-01');expect(r.latest).toBe('2020-05-01');expect(b.id).not.toBe(c.id);
});
test('national schematic mapping, mixed-date citation retention and undo use the real importer',async({page})=>{
  await page.goto('/');await page.waitForFunction(()=>window.__studio);
  const result=await page.evaluate(async()=>{
    const {state,toDocument,undo}=await import('/src/state.js'),{buildProposal,applyProposal}=await import('/src/import/proposal.js'),{buildIndex}=await import('/src/import/match.js'),{FEATS}=await import('/src/geo.js');
    const {snapshotProposal}=await import('/src/import/catalog.js'),{layerHash}=await import('/src/geo.js'),{reviewPublication}=await import('/src/publication.js');
    const before=JSON.stringify(state.assign),geometry={sha256:layerHash(),vintage:null};
    const make=(country,key,date)=>({country,name:country,eventId:country,geometry:{...geometry,layer:'world',key,mode:'schematic'},metric:{eligible:true,value:date},status:'reported-results',latestClaim:{checked:false}});
    const events=['FRA','USA'].map((country,i)=>({id:country,country,date:i?'2024-11-05':'2022-04-10',parties:[],candidates:[],seatsAtStake:null,
      sourceId:'fixture',citations:[{url:'https://example.test/'+country,retrievedAt:'2026-10-01T00:00:00Z',sourceId:'fixture',sha256:'a'.repeat(64),receiptId:'b'.repeat(64),locator:country}],licence:{name:'Synthetic test'},review:{state:'imported-with-warning'}}));
    const draft=snapshotProposal({view:'date',cutoffUtc:'2026-10-01T05:00:35.000Z',geometry,coreJurisdictions:2,rows:[make('FRA','France','2022-04-10'),make('USA','United States of America','2024-11-05')]},
      {index:buildIndex(FEATS),scope:'world',names:FEATS.map(f=>f.name),events,generation:'c'.repeat(64),prefix:'data/test/',manifest:{evidence:{['a'.repeat(64)]:'evidence.bin'}}});
    const proposal=buildProposal(draft),applied=applyProposal(proposal),doc=toDocument();
    const review=reviewPublication(doc,{activeLayerHash:layerHash()}),wrong=reviewPublication({...doc,layer:'cons:GBR:CONSTITUENCY'},{activeLayerHash:layerHash()});
    undo();return {applied,matches:proposal.rows.map(r=>r.how),dates:Object.values(doc.assign).map(r=>r.catalog.event.date),sources:Object.values(doc.assign).map(r=>r.provenance.party.url),
      ready:doc.publication.ready,geometryBlock:wrong.blockers.some(b=>b.code==='catalog-geometry'),cutoff:doc.sub,undo:JSON.stringify(state.assign)===before,blocks:review.blockers};
  });
  expect(result.applied.applied).toBe(2);expect(result.matches).toEqual(['source code','source code']);expect(new Set(result.dates).size).toBe(2);expect(new Set(result.sources).size).toBe(2);
  expect(result.ready).toBe(false);expect(result.geometryBlock).toBe(true);expect(result.undo).toBe(true);expect(result.cutoff).toContain('varying election dates');
});

test('a catalog map exports with its snapshot badge, grouped sources and cutoff, in every X profile',async({page})=>{
  await page.goto('/');await page.waitForFunction(()=>window.__studio&&document.querySelectorAll('#countryList .crow').length>10);
  const r=await page.evaluate(async(cutoffUtc)=>{
    const {state}=await import('/src/state.js'),{buildProposal,applyProposal}=await import('/src/import/proposal.js'),{buildIndex}=await import('/src/import/match.js');
    const {FEATS,layerHash}=await import('/src/geo.js'),{snapshotProposal}=await import('/src/import/catalog.js');
    const {currentReview,approveCurrentMap}=await import('/src/export.js'),{EXPORT_PROFILES}=await import('/src/pack.js');
    // SYNTHETIC TEST EVIDENCE: two countries, one fixture provider, different dates.
    const geometry={sha256:layerHash(),vintage:null};
    const row=(country,key,date)=>({country,name:country,eventId:country,geometry:{...geometry,layer:'world',key,mode:'schematic'},metric:{eligible:true,value:date},status:'reported-results',latestClaim:{checked:false}});
    const events=['FRA','USA'].map((country,i)=>({id:country,country,date:i?'2024-11-05':'2022-04-10',parties:[],candidates:[],seatsAtStake:null,sourceId:'fixture',
      citations:[{url:'https://example.test/'+country,retrievedAt:cutoffUtc,sourceId:'fixture',sha256:'a'.repeat(64),receiptId:'b'.repeat(64),locator:country}],
      licence:{name:'Synthetic test evidence'},review:{state:'imported-with-warning'}}));
    const draft=snapshotProposal({view:'date',cutoffUtc,geometry,coreJurisdictions:2,rows:[row('FRA','France','2022-04-10'),row('USA','United States of America','2024-11-05')]},
      {index:buildIndex(FEATS),scope:'world',names:FEATS.map(f=>f.name),events,generation:'c'.repeat(64),prefix:'data/test/',manifest:{evidence:{['a'.repeat(64)]:'evidence.bin'}}});
    applyProposal(buildProposal(draft));state.handle='@electionmaps';
    await window.__studio.prepareExport();
    const render=(w,h)=>{const report={};window.__studio.composite(w,h,{report});return {badge:report.badge,source:report.source};};
    const draftExport=render(1600,900),draftBlockers=currentReview().blockers.map(b=>b.code);
    approveCurrentMap();
    return {draftExport,draftBlockers,approved:currentReview().publishable,sub:state.sub,
      profiles:EXPORT_PROFILES.map(p=>({id:p.id,...render(p.width,p.height)}))};
  },'2026-10-01T05:00:35.000Z');
  // Unreviewed, it says so; nothing blocks a correctly imported catalog map.
  expect(r.draftBlockers).toEqual([]);
  expect(r.draftExport.badge).toBe('DRAFT · LATEST AVAILABLE SNAPSHOT');
  // One provider entry, not one per country, and the per-country citations are said to travel with the map.
  expect(r.draftExport.source).toMatch(/^Sources: fixture · https:\/\/example\.test\//);
  expect(r.draftExport.source.match(/fixture ·/g)).toHaveLength(1);
  expect(r.draftExport.source).toContain('Per-country identities, dates, raw hashes and citations are retained');
  // The subtitle states the cutoff and that election dates vary.
  expect(r.sub).toContain('2026-10-01T05:00:35.000Z');
  expect(r.sub).toContain('varying election dates');
  // Approved through the real receipt path, every X profile keeps the badge and the attribution.
  expect(r.approved).toBe(true);
  for(const p of r.profiles){expect(p.badge,p.id).toBe('LATEST AVAILABLE SNAPSHOT');expect(p.source,p.id).toMatch(/^Sources: fixture · /);}
});
test('a failed refresh replays the earlier capture with its age and failure recorded; notBefore forces a refresh',async()=>{
  const h=await harness(),later='2026-10-05T17:01:31.000Z';
  // The registered source becomes unreachable after the first capture.
  const failing=async()=>{throw new Error('HTTP 403 for synthetic endpoint');};
  const batch=await downloadCatalog(h.root,{cache:h.cache,fetchImpl:failing,refresh:true,now:()=>later});
  const attempt=batch.attempts.find(a=>a.sourceId===source.id);
  expect(attempt.ok).toBe(true);expect(attempt.error).toMatch(/Refresh failed .*403.*replayed capture from 2026-10-01T05:00:35.000Z/);
  expect(attempt.staleFallback[0].capturedAt).toBe(cutoff);expect(attempt.captures[0].retrievedAt).toBe(cutoff);
  // Offline replay never claims a fallback, and noFallback surfaces the failure.
  await expect(downloadCatalog(h.root,{cache:h.cache,fetchImpl:failing,refresh:true,noFallback:true,now:()=>later})).resolves.toMatchObject({attempts:expect.arrayContaining([expect.objectContaining({ok:false})])});
  // A young cache entry older than the pass cutoff is refetched.
  const calls=h.calls;await downloadCatalog(h.root,{cache:h.cache,fetchImpl:h.fetchImpl,notBefore:'2026-10-01T06:00:00.000Z',now:()=>cutoff});expect(h.calls).toBeGreaterThan(calls);
});
// Acquisition completeness (SYNTHETIC provider responses).
const failingPage=(h,{entity='elections',page=2,times=Infinity,truncate=false}={})=>{let left=times;return async url=>{
  const u=new URL(url);if(u.pathname.endsWith(entity)&&Number(u.searchParams.get('page[number]'))===page){
    if(truncate){const r=await h.fetchImpl(url),body=JSON.parse(await r.text());body.data=body.data.slice(0,0);return new Response(JSON.stringify(body));}
    if(left-->0)throw Object.assign(new Error('Timeout after 60000 ms for synthetic page'),{status:null});}
  return h.fetchImpl(url);};};
test('an interrupted paginated download resumes the missing page and completes',async()=>{
  const h=await harness();
  const batch=await downloadCatalog(h.root,{cache:h.cache,fetchImpl:failingPage(h,{times:1}),refresh:true,retries:0,now:()=>cutoff});
  expect(batch.completeness.state).toBe('complete');expect(batch.pointerMoved).toBe(true);
  expect(batch.attempts.find(a=>a.resource==='elections').ok).toBe(true);
});
test('a truncated or permanently failing page makes the acquisition partial and keeps the replayed batch',async()=>{
  const h=await harness(),before=await fs.readFile(path.join(h.cache,'catalog-batch.json'),'utf8');
  const missing=await downloadCatalog(h.root,{cache:h.cache,fetchImpl:failingPage(h),refresh:true,retries:0,noFallback:true,now:()=>cutoff});
  expect(missing.completeness.state).toBe('partial');expect(missing.completeness.missing[0]).toMatchObject({sourceId:'ipu-parline',resource:'elections'});
  expect(missing.attempts.find(a=>a.resource==='elections').error).toMatch(/after retries/);expect(missing.pointerMoved).toBe(false);
  // A stale fallback for a required collection is degraded, not complete.
  const degraded=await downloadCatalog(h.root,{cache:h.cache,fetchImpl:failingPage(h),refresh:true,retries:0,now:()=>cutoff});
  expect(degraded.completeness.state).toBe('partial');expect(degraded.completeness.degraded.length).toBeGreaterThan(0);
  // A truncated page (fewer rows than declared) is captured but fails validation.
  const truncated=await downloadCatalog(h.root,{cache:h.cache,fetchImpl:failingPage(h,{truncate:true}),refresh:true,retries:0,noFallback:true,now:()=>cutoff});
  expect(truncated.completeness.state).toBe('partial');expect(truncated.attempts.find(a=>a.resource==='elections').error).toMatch(/Incomplete or unstable pagination/);
  expect(await fs.readFile(path.join(h.cache,'catalog-batch.json'),'utf8')).toBe(before);
  expect((await replayCatalog(h.root,h.cache)).completeness.state).toBe('complete');
});
test('a failed refresh preserves the previous complete generation instead of publishing a degraded one',async()=>{
  const h=await harness();const first=await h.engine.validate({batch:h.batch});await h.engine.commit(first);
  const published=(await readCatalog(h.database)).pointer.generation;
  const partial=await downloadCatalog(h.root,{cache:h.cache,fetchImpl:failingPage(h),refresh:true,retries:0,noFallback:true,now:()=>cutoff});
  const plan=await h.engine.validate({batch:partial});expect(plan.acquisition.state).toBe('partial');
  await expect(h.engine.commit(plan)).rejects.toMatchObject({code:'PARTIAL_ACQUISITION'});
  expect((await readCatalog(h.database)).pointer.generation).toBe(published);
  // Publishing a partial generation needs an explicit choice, recorded in the manifest.
  const allowed=await h.engine.validate({batch:partial,allowPartial:true});const r=await h.engine.commit(allowed);
  const m=await readCatalog(h.database);expect(m.pointer.generation).toBe(r.generation);expect(m.manifest.acquisition).toMatchObject({state:'partial',allowPartial:true});
});
