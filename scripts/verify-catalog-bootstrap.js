#!/usr/bin/env node
/** Isolated fresh-checkout bootstrap: no raw cache or generated ingestion/catalog. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {ROOT} from './lib/registry.js';
import {readJson,json} from './ingestion/util.js';
// Modes: default = fresh online bootstrap; --from-bundle = export this checkout's
// evidence bundle, then reconstruct offline in an empty checkout and compare.
// --bundle <dir> verifies an already exported bundle (e.g. an earlier snapshot)
// instead of exporting the current generation.
const bundleArg=process.argv.includes('--bundle')?path.resolve(process.argv[process.argv.indexOf('--bundle')+1]):null;
const fromBundle=process.argv.includes('--from-bundle')||!!bundleArg;
const fresh=path.join(ROOT,'build/catalog-bootstrap',randomUUID());
const files=['package.json','data/source-registry.json','data/acquisition-policy.json','data/party-aliases.json','data/parlgov-coverage.json','data/jurisdictions.json','data/catalog-sources.json','data/catalog-execution.json','data/latest-authorities.json','data/latest-discovery-registry.json','data/official-results.json',
  'public/data/world-50m.topo.json','public/data/boundaries.json','public/data/governing.json','public/data/elections/index.json','scripts/build-parlgov.js','scripts/elections.js'];
async function copy(relative){const target=path.join(fresh,relative);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(ROOT,relative),target);}
for(const file of files)await copy(file);
for(const directory of ['scripts/ingestion','scripts/catalog','scripts/lib']){
  async function walk(relative){for(const entry of await fs.readdir(path.join(ROOT,relative),{withFileTypes:true})){const sub=path.join(relative,entry.name);if(entry.isDirectory())await walk(sub);else await copy(sub);}}await walk(directory);
}
const boundaries=await readJson(path.join(ROOT,'public/data/boundaries.json'));
await copy(path.join('public',boundaries.sources['cons:GBR:CONSTITUENCY'].file));
const before={raw:false,ingestion:false,catalog:false};
const started=new Date().toISOString();
const run=args=>new Promise(resolve=>{const child=spawn(process.execPath,args,{cwd:fresh,windowsHide:true,stdio:['ignore','pipe','pipe']});const log=[];child.stdout.on('data',b=>log.push(b));child.stderr.on('data',b=>log.push(b));child.on('exit',code=>resolve({code,log:Buffer.concat(log)}));});
let bundle=null;
if(bundleArg){await fs.cp(bundleArg,path.join(fresh,'.bundle-source'),{recursive:true});bundle=await readJson(path.join(fresh,'.bundle-source','bundle-manifest.json'));}
else if(fromBundle){const out=path.join(fresh,'.bundle-source');const exp=await new Promise(resolve=>{const c=spawn(process.execPath,[path.join(ROOT,'scripts/elections.js'),'bundle','--out',out],{cwd:ROOT,windowsHide:true,stdio:['ignore','pipe','pipe']});const l=[];c.stdout.on('data',b=>l.push(b));c.stderr.on('data',b=>l.push(b));c.on('exit',code=>resolve({code,log:Buffer.concat(l)}));});
  if(exp.code!==0)throw new Error(`Bundle export failed: ${exp.log}`);bundle=await readJson(path.join(out,'bundle-manifest.json'));}
const {code,log}=await run([path.join(fresh,'scripts/elections.js'),'bootstrap',...(bundle?['--bundle',path.join(fresh,'.bundle-source')]:[])]);
await fs.writeFile(path.join(fresh,'bootstrap.log'),log);
const report=await readJson(path.join(fresh,'build/catalog/bootstrap-report.json'),null),completeness=await readJson(path.join(fresh,'build/catalog/acquisition-completeness.json'),null);
const pointer=await readJson(path.join(fresh,'public/data/catalog/current.json'),null);
const ingestion=await readJson(path.join(fresh,'public/data/ingestion/current.json'),null);
const counts=await readJson(path.join(fresh,'build/catalog/coverage.json'),null);
// Success means a complete acquisition that published a generation (and, for a
// bundle, reproduced the source ledger and events). A partial run is reported, not passed.
const catalogOk=code===0&&!!pointer&&report?.completeness?.state==='complete'&&(!bundle||(report.reconstruction?.ledgerMatches&&report.reconstruction?.eventsMatch));
const ingestionFailures=report?.ingestionFailures||completeness?.ingestionFailures||[];
// Overall success needs every registered source; a blocked ingestion source
// (e.g. history from ParlGov) leaves the bootstrap partial even if the catalog published.
const ok=catalogOk&&ingestionFailures.length===0;
const result={version:3,mode:report?.mode||completeness?.mode||'failed',ok,catalogOk,
  completenessSummary:{catalog:report?.completeness?.state||completeness?.completeness?.state||'failed',ingestion:ingestionFailures.length?`partial: ${ingestionFailures.map(f=>f.sourceId).join(', ')} unavailable`:'complete'},exitCode:code,startedAt:started,finishedAt:new Date().toISOString(),freshRoot:path.relative(ROOT,fresh),before,
  completeness:report?.completeness||completeness?.completeness||null,ingestionFailures,
  ingestionGeneration:ingestion?.generation||null,catalogGeneration:pointer?.generation||null,reconstruction:report?.reconstruction||null,
  bundle:bundle?{generation:bundle.generation,references:bundle.references,missingReferences:bundle.missingReferences,files:Object.keys(bundle.files).length}:null,counts,
  network:bundle?'none (offline reconstruction from the evidence bundle)':'registered free public endpoints; no paid API/model',
  note:'Repository dependencies resolved from the enclosing installed checkout; a standalone fresh checkout first runs npm ci.'};
await fs.writeFile(path.join(ROOT,fromBundle?`build/catalog-bundle-reconstruction${bundle?.cutoffUtc?'-'+bundle.cutoffUtc.slice(0,10):''}.json`:'build/catalog-bootstrap-verification.json'),json(result));console.log(json(result));
if(!ok)process.exitCode=1;
