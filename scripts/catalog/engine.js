import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJson,json,fingerprint,hash,immutable,atomic,inside} from '../ingestion/util.js';
import {replayReference} from '../ingestion/acquire.js';
import {readDatabase,IngestionEngine} from '../ingestion/engine.js';
import {geography} from '../ingestion/validate.js';
import {downloadCatalog,replayCatalog,boundedMap,cachedResource} from './acquire.js';
import {ukNationalEvent} from './adapters.js';
import {parseCatalogSources} from './adapter-registry.js';
import {buildLedger,ledgerCounts,historyReport,worldProof} from './ledger.js';
import {metrics,selectLatest} from './metrics.js';
import {text,links} from './html.js';
import {parseLatestDiscovery} from './discovery-adapter.js';
import {applyFreshness} from './freshness.js';
import {identityCoverage} from './identity-report.js';
import {replayOfficialResults,indexAssertions} from './official-results.js';
import {classifyStatus,SETTLED} from './status.js';

export async function readCatalog(database){
  const pointer=await readJson(path.join(database,'current.json'),null);if(!pointer)return {pointer:null,events:[],ledger:[]};
  if(!/^[a-f0-9]{64}$/.test(pointer.generation))throw new Error('Invalid catalog pointer');
  const dir=path.join(database,'generations',pointer.generation),manifest=await readJson(path.join(dir,'manifest.json'));
  const {generation,...payload}=manifest;
  if(fingerprint(payload)!==generation||generation!==pointer.generation)throw new Error('Catalog manifest integrity failure');
  for(const [file,sha]of Object.entries(manifest.files))if(hash(await fs.readFile(inside(dir,file)))!==sha)throw new Error(`Catalog evidence changed: ${file}`);
  return {pointer,manifest,events:await readJson(path.join(dir,'events.json')),ledger:await readJson(path.join(dir,'ledger.json'))};
}
const eventHash=e=>{const {recordHash,review,...data}=e;return fingerprint(data);};
export class CatalogEngine {
  constructor({root,cache=path.join(root,'data/raw/elections'),database=path.join(root,'public/data/catalog'),reports=path.join(root,'build/catalog')}={}){Object.assign(this,{root,cache,database,reports});}
  async download(options={}){return downloadCatalog(this.root,{cache:this.cache,...options});}
  async setup(){
    this.scope=await readJson(path.join(this.root,'data/jurisdictions.json'));
    if(this.scope.version!==1||this.scope.jurisdictions.filter(j=>j.scope==='core').length!==195||new Set(this.scope.jurisdictions.map(j=>j.iso3)).size!==this.scope.jurisdictions.length)throw new Error('Jurisdiction registry must include 195 distinct UN core states and identified supplementary scope');
    return this;
  }
  async officialReferences(ipu,options={}){
    const source={id:'ipu-official-references',cacheHours:168};
    // One bounded reference per jurisdiction, from the registered IPU source field.
    // Only government-domain URLs are eligible, never arbitrary links or news sites.
    const candidates=this.scope.jurisdictions.filter(j=>j.scope==='core').map(j=>{
      const chosen=selectLatest(ipu.events.filter(e=>e.country===j.iso3&&e.category==='legislative'),this.cutoff).held;
      const urls=(chosen?.providerSources?.match(/https:\/\/[^\s<>"']+/g)||[]).filter(url=>{
        try{const u=new URL(url);return /(?:^|\.)(?:gov|gouv|go|gob)\.[a-z.]+$/.test(u.hostname)||/(?:^|\.)(?:gov|gouv)$/.test(u.hostname);}catch{return false;}
      });
      return {country:j.iso3,eventId:chosen?.id,url:urls[0]?.replace(/[),.;]+$/,'')||null};
    });
    const fetched=await boundedMap(candidates.filter(c=>c.url),async c=>{
      const raw=await cachedResource(source,{key:`${c.country.toLowerCase()}-reference`,url:c.url},{root:this.root,cache:this.cache,...options,retries:0,timeoutMs:10000,maxBytes:8*1024*1024});
      return {...c,reference:raw.reference,retrievedAt:raw.receipt.retrievedAt,state:'official-reference-acquired',note:'Acquired the IPU-cited government resource; no generic HTML heuristic independently verifies its election facts or freshness.'};
    });
    let n=0;return candidates.map(c=>!c.url?{...c,state:'missing-official-resource',reason:'No supported government URL in the latest IPU election source field; national electoral authority discovery remains open'}:
      fetched[n++]?.ok?fetched[n-1].value:{...c,state:'acquisition-failure',reason:fetched[n-1].error});
  }
  async validate({batch=null,cutoff=null,history=false,decisions=null,official=false,offline=false,skipAuthority=false,allowPartial=false,archiveBase=null}={}){
    if(!this.scope)await this.setup();
    const config=await readJson(path.join(this.root,'data/catalog-execution.json'));
    this.cutoff=cutoff||config.executionStartUtc;
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(this.cutoff)||!Number.isFinite(Date.parse(this.cutoff)))throw new Error('Snapshot cutoff must be an explicit UTC instant');
    batch ||= await replayCatalog(this.root,this.cache);
    const existingIngestion=await readDatabase(path.join(this.root,'public/data/ingestion'));
    const ingestionRegistry=await readJson(path.join(this.root,'data/source-registry.json'),{sources:[]});
    const ukSource=ingestionRegistry.sources.find(s=>s.id==='uk-parliament-2024');
    const ipu=parseCatalogSources(batch,this.cutoff),officialEvents=[...ukNationalEvent(existingIngestion.records,ukSource?.licence)];
    for(const e of officialEvents.filter(e=>e.sourceId==='uk-parliament-2024')){
      const records=existingIngestion.records.filter(r=>r.citation.sourceId===e.sourceId),first=records[0];
      e.subnationalCapabilities=[{sourceElectionKey:first.electionKey,layer:first.layer,vintage:first.boundaryVintage,
        geometryHash:first.geometryValidation?.sha256,eligibleReportedWinners:records.filter(r=>r.winner===true).length,
        metrics:['reported constituency winner','candidate votes and vote share','valid-votes/electorate turnout'],
        instructions:'Select this compatible boundary layer and use the Election database importer; national views remain schematic.'}];
    }
    const discovery=await parseLatestDiscovery(this.root,this.cache,this.cutoff);
    const officialResults=await replayOfficialResults(this.root,this.cache,this.cutoff);
    const all=[...ipu.events,...officialEvents,...officialResults.events,...discovery.events].sort((a,b)=>a.id.localeCompare(b.id));
    // Evidence-based status is stamped against this snapshot's cutoff before
    // selection, metrics and the ledger read it.
    for(const e of all)e.status=classifyStatus(e,this.cutoff);
    const geo=await geography(this.root),world=await geo.get('world');
    const jurisdictions=this.scope.jurisdictions.map(j=>{const raw=batch.sources['un-scope']?.find(p=>p.key===(j.unStatus==='observer'?'observers':'members'))?.raw;
      return {...j,...(j.scope==='core'&&raw?{evidence:{...raw.reference,url:raw.receipt.url,retrievedAt:raw.receipt.retrievedAt,locator:`UN membership entry: ${j.name}`}}:{})};});
    const ledger=buildLedger({jurisdictions,events:all,ipu,attempts:batch.attempts,cutoff:this.cutoff,world,research:batch.registry.researchedProviders});
    // The evidence pass validates once before acquiring this cutoff's authority
    // evidence; that preliminary plan is never committed.
    const authority=skipAuthority?{attempts:[],assertions:[],references:[]}:await readJson(path.join(this.root,'build/latest-evidence/authority-audit.json'),{attempts:[],assertions:[],references:[]});
    if(authority.cutoff&&authority.cutoff!==this.cutoff)throw new Error('Authority evidence belongs to a different snapshot cutoff');
    const officialIndex=indexAssertions(ledger,officialResults.indexes,this.cutoff);
    if(config.latestEvidenceMode)applyFreshness(ledger,{attempts:[...discovery.attempts,...authority.attempts,...officialResults.attempts.filter(a=>a.category),...officialIndex.audit],
      assertions:[...authority.assertions,...officialIndex.assertions]});
    const scopeRaw=batch.sources['un-scope']?.find(p=>p.key==='members')?.raw;
    if(scopeRaw){const nav=scopeRaw.bytes.toString().match(/<ul class="list-group s-lg-boxnav">([\s\S]*?)<\/ul>/)?.[1];
      const names=nav?[...nav.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)].map(m=>text(m[1])).slice(2):[];
      if(names.length!==193||this.scope.jurisdictions.filter(j=>j.unStatus==='member').some(j=>!names.includes(j.name)))throw new Error('UN membership reference changed; review the versioned jurisdiction registry');}
    const refs=official?await this.officialReferences(ipu,{offline}):await readJson(path.join(this.reports,'official-references.json'),[]);
    for(const j of ledger){const r=refs.find(r=>r.country===j.iso3);if(r)j.categories.legislative.sourcesSearched.push(r);}
    const counts=ledgerCounts(ledger);
    // A complete PASS means every core category was processed; unresolved facts stay unresolved.
    const checkpoint={version:1,cutoffUtc:this.cutoff,scopeHash:fingerprint(this.scope),counts,
      ledgerHash:fingerprint(ledger),passComplete:counts.coreJurisdictions===195&&Object.values(counts.categories).every(c=>c.entries===195),
      meaning:'Complete jurisdiction coverage pass, not universal verified factual coverage'};
    await atomic(path.join(this.reports,'phase-a-ledger.json'),json(ledger));
    await atomic(path.join(this.reports,'phase-a-pass.json'),json(checkpoint));
    await atomic(path.join(this.reports,'official-references.json'),json(refs));
    const previous=await readCatalog(this.database);
    // Records carried forward must come from a snapshot at or before this
    // cutoff. When the published generation belongs to a later snapshot, walk
    // its chain back to the newest generation whose cutoff is not later, so later
    // developments never enter an earlier snapshot's records.
    previous.archiveBase=previous.manifest?.generation||null;
    // An explicit archive base (e.g. to rebuild an earlier snapshot after a
    // later one was published) names the generation whose records carry over.
    if(archiveBase){const m=await readJson(path.join(this.database,'generations',archiveBase,'manifest.json'));
      if(m.cutoffUtc>this.cutoff)throw new Error('Archive base belongs to a later snapshot');
      previous.events=await readJson(path.join(this.database,'generations',archiveBase,'events.json'));previous.manifest={...previous.manifest,references:m.references};previous.archiveBase=archiveBase;}
    else if(previous.manifest&&previous.manifest.cutoffUtc>this.cutoff){
      let gen=previous.manifest.previousGeneration,base=null;
      while(gen){const m=await readJson(path.join(this.database,'generations',gen,'manifest.json'),null);if(!m)break;if(m.cutoffUtc<=this.cutoff){base=gen;break;}gen=m.previousGeneration;}
      // Generations written before manifests recorded their parent: use the
      // generation registered for the newest snapshot at or before this cutoff.
      if(!base)base=(config.previousSnapshots||[]).filter(x=>x.generation&&x.cutoffUtc<=this.cutoff).sort((a,b)=>b.cutoffUtc.localeCompare(a.cutoffUtc))[0]?.generation||null;
      previous.events=base?await readJson(path.join(this.database,'generations',base,'events.json')):[];
      previous.manifest={...previous.manifest,references:base?(await readJson(path.join(this.database,'generations',base,'manifest.json'))).references:[]};
      previous.archiveBase=base;
    }
    // A checkout reconstructed from an evidence bundle has no generation chain;
    // the bundle's archive stands in for the previous generation's records.
    let archivedRefs=[];
    if(!previous.pointer){const archived=await readJson(path.join(this.cache,'archived-events.json'),null);
      if(archived){previous.events=archived;archivedRefs=archived.flatMap(e=>(e.citations||[]).filter(c=>c.receiptId&&c.sha256&&c.sourceId&&c.key).map(c=>({sourceId:c.sourceId,key:c.key,sha256:c.sha256,receiptId:c.receiptId})));}}
    let events=all.filter(e=>ledger.some(j=>Object.values(j.categories).some(c=>c.latestHeld?.id===e.id||c.latestCompleted?.id===e.id)));
    const references=[...batch.references,...discovery.references,...(authority.references||[]),...officialResults.references,...refs.filter(r=>r.reference).map(r=>r.reference),...(existingIngestion.manifest?.snapshots||[]).filter(s=>s.sourceId==='uk-parliament-2024').flatMap(s=>s.resources)];
    let ingestionGeneration=existingIngestion.pointer?.generation||previous.manifest?.ingestionGeneration||null;
    if(history){
      if(config.historicalExpansionPaused)throw new Error('Historical expansion is paused; run the latest-election evidence pass instead');
      if(!checkpoint.passComplete)throw new Error('Complete the worldwide Phase A ledger pass before historical backfill');
      const ingestion=await readDatabase(path.join(this.root,'public/data/ingestion'));
      // IPU history can backfill even when a different archive is access-blocked.
      ingestionGeneration=ingestion.pointer?.generation||null;
      const {parlGovEvents}=await import('./adapters.js');
      const registry=await readJson(path.join(this.root,'data/source-registry.json'),{sources:[]});
      events=[...all,...parlGovEvents(ingestion.records,registry.sources.find(s=>s.id==='parlgov-2024')?.licence)];
      references.push(...(ingestion.manifest?.snapshots||[]).flatMap(s=>s.resources));
    }
    // Keep immutable archived events when a refresh/backfill is narrower. Never make
    // a failed source disappear or call an archived maximum date fresh.
    const logical=e=>fingerprint([e.country,e.category,e.chamber,e.office,e.date,e.sourceId,e.sourceElectionId,e.tier,
      (e.rounds||[]).map(r=>({number:r.number??null,date:r.date??e.date,stage:r.stage??null}))]);
    // Re-normalising the same captured bytes with a corrected adapter supersedes
    // the earlier normalisation (the earlier generation keeps it). Different
    // bytes for one provider identity remain a reviewable conflict.
    const sourceKey=e=>JSON.stringify([e.country,e.sourceId,e.sourceElectionId]),evidenceKey=e=>JSON.stringify((e.citations||[]).map(c=>c.sha256).filter(Boolean).sort());
    const renormalised=new Map(events.map(e=>[sourceKey(e),e]));
    // A pinned article revision is immutable content even when the parse API
    // re-renders it with different bytes, so it counts as the same evidence.
    const sameEvidence=(n,e)=>(evidenceKey(n)===evidenceKey(e)&&evidenceKey(e)!=='[]')||(!!e.sourceArticle?.revid&&n.sourceArticle?.revid===e.sourceArticle.revid);
    // An article the current rules reject for a category (e.g. a general
    // election whose president a parliament elects later) no longer supports
    // records an earlier normalisation took from it, at any revision. A fetch
    // or parse failure is not a rejection and keeps the archived record.
    const rejectedArticle=new Map((discovery?.attempts||[]).filter(a=>a.rejected&&a.title).map(a=>[`${a.country}|${a.category}|${a.title}`,a]));
    const rejectedBy=e=>e.sourceId==='wikipedia-latest'&&e.sourceArticle?.title?rejectedArticle.get(`${e.country}|${e.category}|${e.sourceArticle.title}`):null;
    const kept=previous.events.filter(e=>{const n=renormalised.get(sourceKey(e));return !(n&&logical(n)!==logical(e)&&sameEvidence(n,e))&&!rejectedBy(e);});
    const byId=new Map(kept.map(e=>[logical(e),e]));for(const e of events)byId.set(logical(e),e);events=[...byId.values()].sort((a,b)=>a.id.localeCompare(b.id));
    const previousById=new Map(previous.events.map(e=>[e.id,e]));
    for(const e of events){
      e.scope=this.scope.jurisdictions.find(j=>j.iso3===e.country)?.scope||'outside-registered-scope';
      e.status=classifyStatus(e,this.cutoff);e.geometry=worldProof(world,e.country,this.scope.jurisdictions.find(j=>j.iso3===e.country)?.name);e.metrics=metrics(e);e.recordHash=eventHash(e);
      const old=previousById.get(e.id);
      e.review=old?.recordHash===e.recordHash?old.review:{state:'imported-with-warning',reasons:['Machine validation; independent editorial verification not performed.',...(e.rounds.some(r=>r.number===null)?['Round unknown in source']:[]),...(!e.certificationStatus?['Certification status unknown']:[])]};
      const decision=decisions?.decisions?.find(d=>d.id===e.id);
      if(decision){if(!decisions.reviewer||decision.recordHash!==e.recordHash||!decision.reason||decision.state!=='verified'||!e.geometry||!SETTLED.includes(e.status?.state))throw new Error(`Invalid/unsettled catalog verification decision: ${e.id}`);
        e.review={state:'verified',reviewer:decisions.reviewer,reason:decision.reason,recordHash:e.recordHash};}
    }
    const changes={additions:[],changes:[],removals:[],conflicts:[]};
    for(const e of events){const old=previousById.get(e.id);if(!old)changes.additions.push({id:e.id});else if(old.recordHash!==e.recordHash||fingerprint(old.review)!==fingerprint(e.review))changes.changes.push({id:e.id,before:old.recordHash,after:e.recordHash,previouslyVerified:old.review.state==='verified'});}
    const activeIds=new Set(events.map(e=>e.id));for(const e of previous.events)if(!activeIds.has(e.id))changes.removals.push({id:e.id,previouslyVerified:e.review.state==='verified',
      reason:rejectedBy(e)?`Article rejected for this category under current evidence rules: ${rejectedBy(e).error}; immutable earlier generation retained`:'Superseded normalization of the same full provider identity; immutable earlier generation retained'});
    const histories=historyReport(this.scope.jurisdictions,events);
    for(const j of ledger)for(const c of Object.values(j.categories))if(c.selectionAlternatives.length>1)changes.conflicts.push({country:j.iso3,category:c.category,eventIds:c.selectionAlternatives,reason:'Same-date provider/chamber alternatives retained; do not merge identity or select an authority silently'});
    const providerIds=new Map();for(const e of events){const key=JSON.stringify([e.country,e.sourceId,e.sourceElectionId]);if(!providerIds.has(key))providerIds.set(key,[]);providerIds.get(key).push(e);}
    for(const rows of providerIds.values())if(rows.length>1){changes.conflicts.push({eventIds:rows.map(e=>e.id),reason:'Provider election identity has conflicting date/office/chamber/round claims; kept separate for review'});
      for(const e of rows){e.identityConflict=true;e.metrics=Object.fromEntries(Object.keys(e.metrics).map(m=>[m,{eligible:false,value:null,reason:'Conflicting provider election identity requires review'}]));e.recordHash=eventHash(e);
        e.review={state:'needs-review',reasons:['Conflicting provider election identities require explicit source/adapter correction; cannot be verified by a flag.']};
        const selected=ledger.find(j=>j.iso3===e.country)?.categories[e.category];if(selected?.latestHeld?.id===e.id){selected.status='needs-review';selected.eligibleMetrics=[];selected.metricReasons=Object.fromEntries(Object.keys(e.metrics).map(m=>[m,e.metrics[m].reason]));}}}
    Object.assign(counts,ledgerCounts(ledger));
    changes.changes=[];
    for(const e of events){const old=previousById.get(e.id);if(old&&(old.recordHash!==e.recordHash||fingerprint(old.review)!==fingerprint(e.review)))changes.changes.push({id:e.id,before:old.recordHash,after:e.recordHash,previouslyVerified:old.review.state==='verified'});}
    const unresolved=ledger.flatMap(j=>Object.values(j.categories).filter(c=>!c.latestClaim.independentlyConfirmed||!c.resultsAcquired).map(c=>({country:j.iso3,scope:j.scope,category:c.category,status:c.status,missing:c.missingInformation,nextAction:c.nextAction,sources:c.sourcesSearched,citations:c.citations})));
    const codeFiles=['engine.js','adapters.js','adapter-registry.js','metrics.js','ledger.js','acquire.js','xlsx.js','html.js','discovery.js','discovery-adapter.js','authority-evidence.js','freshness.js','identity-report.js','official-results.js','status.js'];
    const implementation=Object.fromEntries(await Promise.all(codeFiles.map(async f=>[f,hash(await fs.readFile(fileURLToPath(new URL(f,import.meta.url))))])));
    const uniqRefs=[...new Map([...(previous.manifest?.references||[]),...archivedRefs,...references].map(r=>[`${r.sourceId}/${r.key}/${r.receiptId}`,r])).values()].sort((a,b)=>fingerprint(a).localeCompare(fingerprint(b)));
    const payload={version:1,cutoffUtc:this.cutoff,phase:history||previous.manifest?.phase==='B-history-after-A'?'B-history-after-A':'A-latest',scopeHash:fingerprint(this.scope),registryHash:fingerprint(batch.registry),implementation,
      previousGeneration:previous.pointer?.generation||null,archiveBase:previous.archiveBase||null,ingestionGeneration,batchId:batch.batchId,references:uniqRefs,
      acquisition:{state:batch.completeness?.state||'unknown',missing:batch.completeness?.missing||[],degraded:batch.completeness?.degraded||[],optionalFailures:batch.completeness?.optionalFailures||[],allowPartial:!!allowPartial},
      geometry:{sha256:world.hash,vintage:world.vintage,displayPurpose:'National schematic country outline, not historical geometry'},
      events,ledger,counts,history:histories,unresolved,attempts:batch.attempts,officialReferences:refs,checkpoint,changes,
      sourceDefinitions:[...batch.registry.sources,...ingestionRegistry.sources,...(discovery.sourceDefinitions||[]),...(officialResults.sourceDefinitions||[])],officialBatchId:officialResults.batchId||null,discoveryBatchId:discovery.batchId||null,identityCoverage:identityCoverage(events)};
    const plan={...payload,planId:fingerprint(payload)};this.validated=plan.planId;
    await immutable(path.join(this.cache,'catalog-plans',`${plan.planId}.json`),json(plan));
    await atomic(path.join(this.reports,'validation.json'),json(plan));
    return plan;
  }
  async commit(plan,{confirmReplace=null,failAfter=null}={}){
    const {planId,...body}=plan;if(this.validated!==planId||fingerprint(body)!==planId)throw new Error('Catalog plan was changed or not validated');
    // A partial acquisition never replaces the published generation unless the
    // caller explicitly allowed it at validation (and the manifest says so).
    if(plan.acquisition&&plan.acquisition.state!=='complete'&&!plan.acquisition.allowPartial){
      const err=new Error(`Partial acquisition (${plan.acquisition.state}): ${[...plan.acquisition.missing,...plan.acquisition.degraded].map(m=>`${m.sourceId}/${m.resource}`).join(', ')||'completeness unknown'}; the previous generation is preserved. Retry the download, or pass --allow-partial to publish a labelled partial generation.`);
      err.code='PARTIAL_ACQUISITION';throw err;}
    if(fingerprint(await readJson(path.join(this.root,'data/jurisdictions.json')))!==plan.scopeHash||fingerprint(await readJson(path.join(this.root,'data/catalog-sources.json')))!==plan.registryHash)throw new Error('Catalog registration changed after validation');
    for(const [file,sha]of Object.entries(plan.implementation))if(hash(await fs.readFile(fileURLToPath(new URL(file,import.meta.url))))!==sha)throw new Error('Catalog implementation changed after validation');
    if((await geography(this.root)).layers.get('world').hash!==plan.geometry.sha256)throw new Error('Catalog boundary changed after validation');
    const protectedRows=[...plan.changes.changes,...plan.changes.removals].filter(r=>r.previouslyVerified);
    if(protectedRows.length&&confirmReplace!==planId)throw new Error(`Verified catalog events would change. Inspect validation.json; pass --confirm-replace ${planId}`);
    const lock=path.join(this.database,'.import.lock');await fs.mkdir(this.database,{recursive:true});let handle;
    try{handle=await fs.open(lock,'wx');}catch(e){if(e.code==='EEXIST')throw new Error('Another catalog import owns the database lock; inspect before recovering');throw e;}
    try{
      await handle.writeFile(json({pid:process.pid,planId}));
      const previous=await readCatalog(this.database);if((previous.pointer?.generation||null)!==plan.previousGeneration)throw new Error('Catalog changed since validation');
      const files={'events.json':json(plan.events),'ledger.json':json(plan.ledger),'history.json':json(plan.history),'unresolved.json':json(plan.unresolved)};
      const snapshots={};
      for(const view of ['date','seats','vote','presidential','turnout','coverage']){
        const category=view==='presidential'?'presidential':'legislative';
        snapshots[view]={view,category,cutoffUtc:plan.cutoffUtc,geometry:plan.geometry,coreJurisdictions:195,
          providers:Object.fromEntries(plan.sourceDefinitions.map(s=>[s.id,{provider:s.provider,licence:s.licence,url:s.baseUrl||s.url||s.resources?.[0]?.url}])),
          rows:plan.ledger.filter(j=>j.scope==='core').map(j=>{const c=j.categories[category],e=plan.events.find(e=>e.id===c.latestHeld?.id);
            const oe=view==='presidential'&&c.outcomeFromAlternative?plan.events.find(x=>x.id===c.outcomeEventId):view==='turnout'&&c.turnoutEventId?plan.events.find(x=>x.id===c.turnoutEventId):null;
            const metric=view==='coverage'?{eligible:true,value:c.freshness||c.status}:c.laterCycle?{eligible:false,value:null,reason:c.latestClaim.label}:oe?{...oe.metrics[view],outcomeFrom:{eventId:oe.id,sourceId:oe.sourceId,note:view==='turnout'?'Turnout reported by a same-contest record; the selected record carries the seat figures':'Outcome reported by a same-contest record; the selected record carries the totals'}}:e?.metrics[view]||{eligible:false,reason:c.reason};
            return {country:j.iso3,name:j.name,geometry:c.geometry,eventId:e?.id||null,latestClaim:c.latestClaim,status:c.status,freshness:c.freshness||null,metric,
              citations:[...(e?.citations||c.citations),...(oe?oe.citations:[])],certificationStatus:c.certificationStatus,missing:c.missingInformation};})};
        files[`snapshots/${view}.json`]=json(snapshots[view]);
      }
      const evidence={};for(const ref of plan.references){const raw=await replayReference(this.cache,ref),file=`evidence/${ref.sha256}.bin`;
        files[file]=raw.bytes;files[`receipts/${ref.receiptId}.json`]=json(raw.receipt);evidence[ref.sha256]=file;}
      files['index.json']=json({version:1,cutoffUtc:plan.cutoffUtc,phase:plan.phase,counts:plan.counts,geometry:plan.geometry,
        events:plan.events.map(e=>({id:e.id,country:e.country,date:e.date,endDate:e.endDate,category:e.category,office:e.office,chamber:e.chamber,status:e.status?.state||e.resultStatus,
          sourceId:e.sourceId,scope:e.scope,holdingStatus:e.holdingStatus,geometry:e.geometry,subnationalCapabilities:e.subnationalCapabilities||[],metrics:Object.entries(e.metrics).filter(([,v])=>v.eligible).map(([k])=>k),
          latest:plan.ledger.find(j=>j.iso3===e.country)?.categories[e.category]?.latestHeld?.id===e.id})),
        snapshots:Object.keys(snapshots).map(view=>({view,file:`snapshots/${view}.json`}))});
      const payload={version:1,cutoffUtc:plan.cutoffUtc,scopeHash:plan.scopeHash,registryHash:plan.registryHash,implementation:plan.implementation,acquisition:plan.acquisition,
        phase:plan.phase,ingestionGeneration:plan.ingestionGeneration,evidence,references:plan.references,
        files:Object.fromEntries(Object.entries(files).map(([f,b])=>[f,hash(b)]))};
      const generation=fingerprint(payload),dir=path.join(this.database,'generations',generation);let count=0;
      for(const [file,bytes]of Object.entries(files)){await immutable(inside(dir,file),bytes);if(failAfter&&++count===failAfter)throw new Error('Interrupted catalog import before atomic pointer');}
      const manifest={...payload,generation};await immutable(path.join(dir,'manifest.json'),json(manifest));
      const prefix=`data/catalog/generations/${generation}`;
      await atomic(path.join(this.database,'current.json'),json({version:1,generation,manifest:`${prefix}/manifest.json`,manifestSha256:hash(json(manifest)),index:`${prefix}/index.json`}));
      return {generation,changed:previous.pointer?.generation!==generation};
    }finally{await handle.close();await fs.unlink(lock);}
  }
  async report(plan,result=null){
    for(const [name,value]of Object.entries({'worldwide-ledger':plan.ledger,'coverage':plan.counts,'country-coverage':plan.ledger,'unresolved-facts':plan.unresolved,
      'acquisition-failures':{registered:plan.attempts.filter(a=>!a.ok),officialReferences:plan.officialReferences.filter(r=>r.state==='acquisition-failure')},
      'historical-coverage':plan.history,'election-identity-counts':plan.identityCoverage,'update-manifest':{planId:plan.planId,cutoffUtc:plan.cutoffUtc,phase:plan.phase,result,changes:plan.changes,references:plan.references}}))await atomic(path.join(this.reports,`${name}.json`),json(value));
    await atomic(path.join(this.reports,'report.md'),[
      '# Worldwide election catalog coverage', '',`Snapshot cutoff: ${plan.cutoffUtc} (Asia/Dhaka ${new Date(Date.parse(plan.cutoffUtc)+21600000).toISOString().slice(0,10)}).`,
      `Phase: ${plan.phase}. Core: 195 UN states; supplementary: ${plan.counts.supplementaryJurisdictions}.`,
      'A complete ledger pass is not complete factual coverage. Provider freshness assertions, authority, machine validation and independent editorial verification are separate.',
      '', '| Category | Held identity | Latest established by authority | Independently corroborated | Results acquired | Seat metric | Vote metric | Outcome | Turnout |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
      ...Object.entries(plan.counts.categories).map(([k,c])=>`| ${k} | ${c.identityEstablished} | ${c.evidencedLatestClaim} | ${c.independentlyConfirmedLatest} | ${c.resultsAcquired} | ${c.metricEligible.seats} | ${c.metricEligible.vote} | ${c.metricEligible.presidential} | ${c.metricEligible.turnout} |`),
      '',`Catalog events: ${plan.events.length}. Countries with held historical records: ${plan.history.filter(h=>h.events>0).length}. Independently verified events: ${plan.events.filter(e=>e.review.state==='verified').length}.`,
      'Exact per-country date ranges and acquired dates are in historical-coverage.json. Gaps are not evidence of no election.',
      '', '## Country-by-country core ledger',
      '| Country | Legislative date | Status | Latest assertion | Presidential date | Status | Upper-house date |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...plan.ledger.filter(j=>j.scope==='core').map(j=>`| ${j.iso3} ${j.name} | ${j.categories.legislative.latestHeld?.date||'unknown'} | ${j.categories.legislative.status} | ${j.categories.legislative.latestClaim.label} | ${j.categories.presidential.latestHeld?.date||'unknown'} | ${j.categories.presidential.status} | ${j.categories['upper-house'].latestHeld?.date||'unknown'} |`),
      '', 'See worldwide-ledger.json for all category reasons, citations, searched sources and next actions. See acquisition-failures.json and unresolved-facts.json for remaining work.', ''
    ].join('\n'));
    return {counts:plan.counts,eventCount:plan.events.length,historyCountries:plan.history.filter(h=>h.events>0).length,result};
  }
}
