/**
 * Evidence bundles: everything an offline reconstruction of a catalog
 * generation needs, and nothing else.
 *
 * A bundle holds the batch records (catalog, discovery, official results), the
 * authority audit, the ingestion source pointers, and every raw blob and
 * receipt they reference. Restoring a bundle into an empty checkout and running
 * `bootstrap --bundle` rebuilds the generation offline; the bundle manifest
 * records the source generation's ledger and event hashes to compare against.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {readJson,json,fingerprint,hash} from '../ingestion/util.js';
import {readCatalog} from './engine.js';

const exists=p=>fs.access(p).then(()=>true,()=>false);
async function copy(from,to){await fs.mkdir(path.dirname(to),{recursive:true});await fs.copyFile(from,to);}

export async function exportBundle(root,{cache=path.join(root,'data/raw/elections'),database=path.join(root,'public/data/catalog'),out}){
  const catalog=await readCatalog(database);if(!catalog.pointer)throw new Error('No catalog generation to bundle');
  const files=[],refs=new Map(),add=r=>{if(r?.receiptId&&r?.sha256)refs.set(r.receiptId,r);};
  const take=async(rel,base=cache,dest='cache')=>{const from=path.join(base,rel);if(!await exists(from))return false;await copy(from,path.join(out,dest,rel));files.push(`${dest}/${rel.replace(/\\/g,'/')}`);return true;};
  for(const r of catalog.manifest.references)add(r);
  // Batch pointers and the batch records they point at.
  for(const [pointerFile,dir]of [['catalog-batch.json','catalog-batches'],['latest-discovery.json','latest-discovery-batches'],['official-results.json','official-batches']]){
    const pointer=await readJson(path.join(cache,pointerFile),null);if(!pointer)continue;await take(pointerFile);await take(path.join(dir,`${pointer.batchId}.json`));
    const batch=await readJson(path.join(cache,dir,`${pointer.batchId}.json`));
    for(const r of [...(batch.references||[]),...(batch.entityReferences||[]),...(batch.labelReferences||[])])add(r);
    for(const c of batch.countries||[]){add(c.graphReference);for(const a of c.articles||[]){add(a.reference);add(a.revisionReference);}}
    if(batch.index){add(batch.index.htmlReference);add(batch.index.revisionReference);}
  }
  // Ingestion sources rebuild offline from their latest pointers.
  const registry=await readJson(path.join(root,'data/source-registry.json'),{sources:[]});
  for(const s of registry.sources){const dir=path.join(cache,'latest',s.id);if(!await exists(dir))continue;
    for(const f of await fs.readdir(dir)){await take(path.join('latest',s.id,f));add(await readJson(path.join(dir,f)));}}
  for(const rel of ['build/latest-evidence/authority-audit.json','build/catalog/official-references.json'])await take(rel,root,'root');
  // Records carried from earlier generations (earlier cutoffs or superseded
  // runs) cannot be re-derived from this cutoff's batches. They travel as an
  // explicit archive; their evidence references are bundled with the rest.
  await fs.mkdir(path.join(out,'cache'),{recursive:true});
  await fs.writeFile(path.join(out,'cache','archived-events.json'),json(catalog.events));files.push('cache/archived-events.json');
  for(const e of catalog.events)for(const c of e.citations||[])if(c.receiptId&&c.sha256)add({receiptId:c.receiptId,sha256:c.sha256});
  const authority=await readJson(path.join(root,'build/latest-evidence/authority-audit.json'),{references:[]});for(const r of authority.references||[])add(r);
  let missing=0;
  for(const r of refs.values()){const ok1=await take(path.join('receipts',`${r.receiptId}.json`)),ok2=await take(path.join('blobs',r.sha256));if(!ok1||!ok2)missing++;}
  const manifest={version:1,kind:'election-map/evidence-bundle',createdAt:new Date().toISOString(),generation:catalog.pointer.generation,cutoffUtc:catalog.manifest.cutoffUtc,
    ledgerHash:fingerprint(catalog.ledger),eventsHash:fingerprint(catalog.events.map(e=>e.recordHash).sort()),references:refs.size,missingReferences:missing,
    files:Object.fromEntries(await Promise.all(files.sort().map(async f=>[f,hash(await fs.readFile(path.join(out,f)))])))};
  await fs.writeFile(path.join(out,'bundle-manifest.json'),json(manifest));
  return manifest;
}
/** Copies a verified bundle into a checkout's cache and build directories. */
export async function restoreBundle(dir,root,{cache=path.join(root,'data/raw/elections')}={}){
  const manifest=await readJson(path.join(dir,'bundle-manifest.json'));
  if(manifest.kind!=='election-map/evidence-bundle')throw new Error('Not an evidence bundle');
  for(const [f,sha]of Object.entries(manifest.files)){
    const bytes=await fs.readFile(path.join(dir,f));if(hash(bytes)!==sha)throw new Error(`Bundle file changed: ${f}`);
    const [scope,...rest]=f.split('/'),rel=rest.join('/');await copy(path.join(dir,f),scope==='cache'?path.join(cache,rel):path.join(root,rel));
  }
  return manifest;
}
