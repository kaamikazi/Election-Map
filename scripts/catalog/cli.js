import path from 'node:path';
import fs from 'node:fs/promises';
import {CatalogEngine,readCatalog} from './engine.js';
import {IngestionEngine,readDatabase} from '../ingestion/engine.js';
import {readJson,json,fingerprint} from '../ingestion/util.js';
import {replayCatalog} from './acquire.js';

/** Writes the result of a run that must not publish, and sets a failing exit code. */
async function partial(engine,report){
  await fs.mkdir(engine.reports,{recursive:true});await fs.writeFile(path.join(engine.reports,'acquisition-completeness.json'),json(report));
  console.error(`Partial acquisition: nothing published; previous generation preserved. See ${path.join(engine.reports,'acquisition-completeness.json')}`);
  process.exitCode=3;
}

export async function runCatalog(action,args,root){
  const flag=n=>args.includes('--'+n),value=(n,d)=>{const i=args.indexOf('--'+n);return i<0?d:args[i+1];};
  const engine=await new CatalogEngine({root,cache:path.resolve(value('cache',path.join(root,'data/raw/elections'))),
    database:path.resolve(value('database',path.join(root,'public/data/catalog'))),reports:path.resolve(value('reports',path.join(root,'build/catalog')))}).setup();
  if(action==='discover'){console.log(JSON.stringify(await readJson(path.join(root,'data/catalog-sources.json')),null,2));return;}
  const acquisition={offline:flag('offline'),refresh:flag('refresh'),allowPartial:flag('allow-partial')};
  const config=await readJson(path.join(root,'data/catalog-execution.json'));
  if(action==='backfill'&&config.historicalExpansionPaused)throw new Error('Historical expansion is paused by the current task; latest evidence work remains active');
  if(action==='bundle'){
    const {exportBundle}=await import('./bundle.js');const out=path.resolve(value('out',path.join(root,'build/evidence-bundle')));
    console.log(JSON.stringify(await exportBundle(root,{cache:engine.cache,database:engine.database,out}),(k,v)=>k==='files'?Object.keys(v).length:v,2));return;
  }
  if(action==='evidence'){
    const {acquireLatestDiscovery}=await import('./discovery.js');
    const {parseLatestDiscovery}=await import('./discovery-adapter.js');
    const {acquireAuthorityPass}=await import('./authority-evidence.js');
    const {acquireOfficialResults}=await import('./official-results.js');
    // --reuse-discovery keeps an already captured discovery batch for this cutoff
    // (it is slow and rate-limited); everything else is still acquired.
    const pointer=await readJson(path.join(engine.cache,'latest-discovery.json'),null);
    const captured=pointer&&(await readJson(path.join(engine.cache,'latest-discovery-batches',pointer.batchId+'.json'),{})).cutoff===config.executionStartUtc;
    if(!flag('offline')&&!(flag('reuse-discovery')&&captured))await acquireLatestDiscovery(root,{...acquisition,cache:engine.cache,cutoff:config.executionStartUtc});
    if(!flag('offline'))await acquireOfficialResults(root,{...acquisition,cache:engine.cache,cutoff:config.executionStartUtc});
    const discovery=await parseLatestDiscovery(root,engine.cache,config.executionStartUtc);
    const base=await engine.validate({cutoff:config.executionStartUtc,skipAuthority:true});
    await acquireAuthorityPass(root,[...base.events,...discovery.events],{...acquisition,cache:engine.cache,cutoff:config.executionStartUtc});
    const plan=await engine.validate({cutoff:config.executionStartUtc,allowPartial:acquisition.allowPartial});
    let result;try{result=await engine.commit(plan,{confirmReplace:value('confirm-replace',null)});}
    catch(e){if(e.code!=='PARTIAL_ACQUISITION')throw e;await engine.report(plan,{committed:false,error:e.message});await partial(engine,{mode:'evidence',acquisition:plan.acquisition,error:e.message});return;}
    console.log(JSON.stringify(await engine.report(plan,result),null,2));return;
  }
  if(action==='bootstrap'){
    // Three distinct modes; the report says which one ran and how complete it was.
    const bundleDir=value('bundle',null);let bundle=null;
    if(bundleDir){const {restoreBundle}=await import('./bundle.js');bundle=await restoreBundle(path.resolve(bundleDir),root,{cache:engine.cache});acquisition.offline=true;}
    const mode=bundle?'offline-reconstruction':acquisition.offline?'offline-replay':'fresh-online';
    const db=await readDatabase(path.join(root,'public/data/ingestion'));
    const failures=[];
    if(!db.pointer){
      const registry=await readJson(path.join(root,'data/source-registry.json'));
      for(const source of registry.sources){
        try{const ingestion=await new IngestionEngine({root,cache:engine.cache}).setup(source.id);const batch=await ingestion.download({...acquisition,refresh:!acquisition.offline});const plan=await ingestion.validate({batch});const result=await ingestion.commit(plan);await ingestion.report(plan,result);}
        catch(e){failures.push({sourceId:source.id,error:e.failures||e.message});console.warn(`Bootstrap source unavailable: ${source.id}; other sources continue.`);}
      }
    }
    await fs.mkdir(engine.reports,{recursive:true});await fs.writeFile(path.join(engine.reports,'bootstrap-failures.json'),JSON.stringify(failures,null,2)+'\n');
    const batch=acquisition.offline?await replayCatalog(root,engine.cache):await engine.download(acquisition);
    const base={mode,startedFrom:bundle?{bundleGeneration:bundle.generation,ledgerHash:bundle.ledgerHash}:null,catalogBatch:batch.batchId,completeness:batch.completeness,ingestionFailures:failures};
    if(batch.completeness?.state!=='complete'&&!acquisition.allowPartial){await partial(engine,{...base,mode:'partial-acquisition',requestedMode:mode});return;}
    const cutoff=value('cutoff',null)||(bundle?bundle.cutoffUtc:null);
    const a=await engine.validate({batch,cutoff,official:!acquisition.offline,offline:acquisition.offline,allowPartial:acquisition.allowPartial});let result=await engine.commit(a,{confirmReplace:value('confirm-replace',null)});await engine.report(a,result);
    if(!config.historicalExpansionPaused){const b=await engine.validate({batch,history:true,cutoff:a.cutoffUtc,offline:acquisition.offline,allowPartial:acquisition.allowPartial});result=await engine.commit(b,{confirmReplace:value('confirm-replace',null)});await engine.report(b,result);}
    const current=await readCatalog(engine.database);
    const report={...base,generation:current.pointer.generation,cutoffUtc:current.manifest.cutoffUtc,ledgerHash:fingerprint(current.ledger),eventsHash:fingerprint(current.events.map(e=>e.recordHash).sort()),
      reconstruction:bundle?{ledgerMatches:fingerprint(current.ledger)===bundle.ledgerHash,eventsMatch:fingerprint(current.events.map(e=>e.recordHash).sort())===bundle.eventsHash,
        events:current.events.length,carriedFromArchive:(await readJson(path.join(engine.cache,'archived-events.json'),[])).filter(a=>!a.citations?.some(c=>c.retrievedAt>=current.manifest.cutoffUtc)).length}:null};
    await fs.writeFile(path.join(engine.reports,'bootstrap-report.json'),json(report));console.log(json(report));return;
  }
  let batch=null;
  if(['download','update','latest','backfill'].includes(action)&&(!flag('offline')||action!=='backfill'))batch=await engine.download(acquisition);
  if(action==='download'&&batch.completeness?.state==='complete'){console.log(JSON.stringify({batchId:batch.batchId,completeness:batch.completeness,attempts:batch.attempts},null,2));return;}
  const decisions=value('decisions',null)?await readJson(path.resolve(value('decisions'))):null;
  if(batch&&batch.completeness?.state!=='complete'&&!acquisition.allowPartial&&action==='download'){console.log(JSON.stringify({batchId:batch.batchId,completeness:batch.completeness,pointerMoved:batch.pointerMoved},null,2));await partial(engine,{mode:'download',batchId:batch.batchId,completeness:batch.completeness});return;}
  const plan=await engine.validate({batch,cutoff:value('cutoff',null),history:action==='backfill',decisions,official:flag('official')||action==='latest',offline:flag('offline'),allowPartial:acquisition.allowPartial,archiveBase:value('archive-base',null)});
  let result=null;
  try{if(['import','update','latest','snapshot','backfill'].includes(action))result=await engine.commit(plan,{confirmReplace:value('confirm-replace',null)});}
  catch(e){await engine.report(plan,{committed:false,error:e.message});if(e.code==='PARTIAL_ACQUISITION'){await partial(engine,{mode:action,acquisition:plan.acquisition,error:e.message});return;}throw e;}
  if(action==='report')result={generation:(await readCatalog(engine.database)).pointer?.generation,committed:false};
  console.log(JSON.stringify(await engine.report(plan,result),null,2));
  console.log(`Catalog reports: ${engine.reports}`);
}
