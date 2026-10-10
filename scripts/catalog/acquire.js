import path from 'node:path';
import {acquireResource,replayReference} from '../ingestion/acquire.js';
import {readJson,json,immutable,fingerprint,atomic} from '../ingestion/util.js';

export async function cachedResource(source, resource, options) {
  const ref=await readJson(path.join(options.cache,'latest',source.id,`${resource.key}.json`),null);
  if(ref && !options.refresh && !options.offline){
    const raw=await replayReference(options.cache,ref);
    // Age is measured on the same clock that stamped the receipt. Using the
    // wall clock here while acquisition used an injected one made a fixed-clock
    // run treat every cached page as stale once a day had really passed.
    const nowMs=Date.parse(options.now ? options.now() : new Date().toISOString());
    // notBefore: a pass that must observe state at or after an instant (its
    // cutoff) never reuses an earlier capture, however young the cache is.
    const recentEnough=!options.notBefore||Date.parse(raw.receipt.retrievedAt)>=Date.parse(options.notBefore);
    if(raw.receipt.url===resource.url && recentEnough && nowMs-Date.parse(raw.receipt.retrievedAt)<(source.cacheHours??24)*3600000) return raw;
  }
  try{return await acquireResource(source,resource,{...options,maxBytes:50*1024*1024});}
  catch(e){
    // A failed refresh does not erase evidence already captured from the same
    // URL: the earlier capture is replayed with its original receipt time and
    // the failure is attached, so its age stays visible.
    if(ref&&!options.offline&&!options.noFallback){const raw=await replayReference(options.cache,ref).catch(()=>null);
      if(raw?.receipt.url===resource.url){raw.fallback={error:e.message,attemptedAt:options.now?options.now():new Date().toISOString(),capturedAt:raw.receipt.retrievedAt};return raw;}}
    throw e;
  }
}
export async function boundedMap(items, fn, concurrency=3){
  let cursor=0; const out=Array(items.length);
  await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{
    while(cursor<items.length){const i=cursor++;try{out[i]={ok:true,value:await fn(items[i],i)};}catch(e){out[i]={ok:false,error:e.message};}}
  })); return out;
}
export function validatePages(pages,{unique=true}={}){
  if(!pages.length)throw new Error('No JSON:API pages');
  const total=pages[0].body.meta?.total;
  if(!Number.isInteger(total)||total<0)throw new Error('Provider total missing');
  const rows=pages.flatMap(p=>p.body.data||[]);
  if(pages.some(p=>p.body.meta?.total!==total||p.body.meta?.row_count!==p.body.data?.length) || rows.length!==total || (unique&&new Set(rows.map(r=>r.id||r.political_party_code)).size!==total))throw new Error('Incomplete or unstable pagination; latest claim cannot be checked');
  return rows;
}
export async function collection(source,entity,options){
  const url=n=>`${source.baseUrl}${entity}?page[size]=${source.pageSize}&page[number]=${n}`;
  // Fresh attempts never fall back to an older capture; that is a last resort
  // after the bounded retry rounds, and it marks the batch degraded.
  const get=async(n,fallback=false)=>{const raw=await cachedResource(source,{key:`${entity}-${n}`,url:url(n)},{...options,noFallback:options.noFallback||!fallback});return {body:JSON.parse(raw.bytes.toString()),raw,page:n};};
  const rounds=options.pageRetryRounds??2;
  const fetchAll=async numbers=>{
    const out=await boundedMap(numbers,n=>get(n));
    // Bounded, resumable retry: captured pages replay from the cache and only the
    // missing ones are fetched again.
    for(let round=0;round<rounds&&out.some(r=>!r.ok);round++){
      const missing=out.map((r,i)=>r.ok?null:i).filter(i=>i!==null),again=await boundedMap(missing.map(i=>numbers[i]),n=>get(n));
      missing.forEach((i,k)=>{if(again[k].ok)out[i]=again[k];});
    }
    const still=out.map((r,i)=>r.ok?null:i).filter(i=>i!==null);
    if(still.length&&!options.noFallback){const last=await boundedMap(still.map(i=>numbers[i]),n=>get(n,true));still.forEach((i,k)=>{if(last[k].ok)out[i]=last[k];});}
    return out;
  };
  const [firstResult]=await fetchAll([1]);
  if(!firstResult.ok)throw new Error(`Incomplete ${entity} pagination after retries (page 1 missing): ${firstResult.error}`);
  const first=firstResult.value,count=Math.max(1,Math.ceil(first.body.meta.total/source.pageSize));
  if(count>source.maxPages)throw new Error('Registered pagination bound exceeded');
  const rest=await fetchAll(Array.from({length:count-1},(_,i)=>i+2));
  if(rest.some(r=>!r.ok))throw new Error(`Incomplete ${entity} pagination after retries (${rest.filter(r=>!r.ok).length}/${count} pages missing): ${rest.filter(r=>!r.ok).map(r=>r.error).join('; ')}`);
  const pages=[first,...rest.map(r=>r.value)];validatePages(pages,{unique:entity!=='political_parties'});
  return {entity,complete:true,pages};
}
export async function downloadCatalog(root,{cache=path.join(root,'data/raw/elections'),...options}={}){
  const registry=await readJson(path.join(root,'data/catalog-sources.json'));
  const policy=await readJson(path.join(root,'data/acquisition-policy.json'),{requiredSources:['ipu-parline','un-scope']});
  // The IPU API can take over 20 s per page under load; one slow page loses the whole collection.
  const attempts=[], sources={}, opts={root,cache,retries:policy.retries??2,timeoutMs:policy.timeoutMs??60000,pageRetryRounds:policy.pageRetryRounds??2,...options};
  for(const source of registry.sources){
    const results=await boundedMap(source.entities||source.resources, async(item)=>source.entities
      ? collection(source,item,opts) : {key:item.key,raw:await cachedResource(source,item,opts)});
    sources[source.id]=results.filter(r=>r.ok).map(r=>r.value);
      results.forEach((r,i)=>{
      const raws=r.ok?(r.value.pages?r.value.pages.map(p=>p.raw):[r.value.raw]):[];
      const fallback=raws.map(x=>x.fallback).filter(Boolean);
      attempts.push({sourceId:source.id,resource:source.entities?.[i]||source.resources[i].key,ok:r.ok,error:r.error||(fallback.length?`Refresh failed (${fallback[0].error}); replayed capture from ${fallback[0].capturedAt}`:null),staleFallback:fallback.length?fallback:undefined,
        searchedUrl:source.entities?`${source.baseUrl}${source.entities[i]}`:source.resources[i].url,
        captures:raws.map(raw=>({url:raw.receipt.url,retrievedAt:raw.receipt.retrievedAt,sha256:raw.reference.sha256,receiptId:raw.reference.receiptId})),
        attemptedAt:r.ok?null:new Date().toISOString()});
    });
  }
  const references=Object.values(sources).flatMap(parts=>parts.flatMap(p=>p.pages?p.pages.map(v=>v.raw.reference):[p.raw.reference]));
  const completeness=acquisitionCompleteness(registry,attempts,policy);
  const payload={version:1,registryHash:fingerprint(registry),references,attempts,completeness};
  const batchId=fingerprint(payload);
  await immutable(path.join(cache,'catalog-batches',`${batchId}.json`),json(payload));
  // Only a complete batch (or an explicitly allowed partial one) becomes the
  // batch that validation replays; a partial refresh never replaces it silently.
  const pointerMoved=completeness.state==='complete'||!!options.allowPartial;
  await atomic(path.join(cache,pointerMoved?'catalog-batch.json':'catalog-batch-partial.json'),json({batchId,completeness}));
  return {registry,sources,attempts,references,batchId,completeness,pointerMoved};
}
/**
 * Required registered collections (registry `required: true`) must all be
 * captured fresh in this download. A stale fallback or a missing page makes the
 * acquisition partial; optional sources are reported but do not block.
 */
export function acquisitionCompleteness(registry,attempts,policy={requiredSources:[]}){
  const required=(policy.requiredSources||[]).filter(id=>registry.sources.some(s=>s.id===id));
  const missing=attempts.filter(a=>required.includes(a.sourceId)&&!a.ok).map(a=>({sourceId:a.sourceId,resource:a.resource,error:a.error}));
  const degraded=attempts.filter(a=>required.includes(a.sourceId)&&a.ok&&a.staleFallback).map(a=>({sourceId:a.sourceId,resource:a.resource,error:a.error}));
  const optional=attempts.filter(a=>!required.includes(a.sourceId)&&!a.ok).map(a=>({sourceId:a.sourceId,resource:a.resource,error:a.error}));
  return {state:missing.length||degraded.length?'partial':'complete',required,missing,degraded,optionalFailures:optional};
}
export async function replayCatalog(root,cache){
  const registry=await readJson(path.join(root,'data/catalog-sources.json'));
  const pointer=await readJson(path.join(cache,'catalog-batch.json'));
  const batch=await readJson(path.join(cache,'catalog-batches',`${pointer.batchId}.json`));
  if(fingerprint(batch)!==pointer.batchId||fingerprint(registry)!==batch.registryHash)throw new Error('Catalog registry changed; run a catalog download');
  const sources={};
  for(const source of registry.sources){
    const refs=batch.references.filter(r=>r.sourceId===source.id), raw=await Promise.all(refs.map(r=>replayReference(cache,r)));
    sources[source.id]=source.entities?source.entities.map(entity=>({entity,complete:true,pages:raw.filter(r=>r.key.startsWith(entity+'-')).sort((a,b)=>Number(a.key.split('-').at(-1))-Number(b.key.split('-').at(-1))).map(r=>({raw:r,body:JSON.parse(r.bytes.toString())}))})).filter(c=>c.pages.length):raw.map(r=>({key:r.key,raw:r}));
  }
  const policy=await readJson(path.join(root,'data/acquisition-policy.json'),{requiredSources:['ipu-parline','un-scope']});
  return {registry,sources,attempts:batch.attempts,references:batch.references,batchId:pointer.batchId,completeness:batch.completeness||acquisitionCompleteness(registry,batch.attempts,policy)};
}
