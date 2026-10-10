import path from 'node:path';
import fs from 'node:fs/promises';
import iso from 'i18n-iso-countries';
import en from 'i18n-iso-countries/langs/en.json' with {type:'json'};
import {text,links} from './html.js';
import {cachedResource,boundedMap} from './acquire.js';
import {readJson,json,immutable,atomic,fingerprint} from '../ingestion/util.js';
iso.registerLocale(en);
export const wikiApi=params=>'https://en.wikipedia.org/w/api.php?'+new URLSearchParams({...params,format:'json',formatversion:'2'});
let queue=Promise.resolve();
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function politeResource(source,resource,options){
  const run=queue.then(async()=>{
    for(let attempt=0;attempt<3;attempt++){
      try{return await cachedResource(source,resource,options);}
      catch(e){if(!/HTTP 429/.test(e.message)||options.offline||attempt===2)throw e;await pause(15000*(attempt+1));}
      finally{await pause(500);}
    }
  });queue=run.catch(()=>{});return run;
}
const COUNTRY_NAMES={'Cape Verde':'CPV','Congo (Kinshasa)':'COD','Congo (Brazzaville)':'COG','Democratic Republic of the Congo':'COD','Republic of the Congo':'COG','Ivory Coast':'CIV','East Timor':'TLS','South Korea':'KOR','North Korea':'PRK','Russia':'RUS','Syria':'SYR','Taiwan':'TWN','Vatican City':'VAT','Palestine':'PSE','Turkey':'TUR','Nauru':'NRU','The Gambia':'GMB'};
export function expandedRows(table){
  const carry=new Map(),out=[];
  for(const m of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
    const row=[];for(const [i,c]of carry){row[i]=c.cell;if(--c.left===0)carry.delete(i);}
    let col=0;
    for(const cell of m[1].matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi)){
      while(row[col])col++;
      const width=Number(cell[1].match(/colspan=["']?(\d+)/i)?.[1]||1),height=Number(cell[1].match(/rowspan=["']?(\d+)/i)?.[1]||1);
      const value={html:cell[2],text:text(cell[2]),links:links(cell[2])};
      for(let j=0;j<width;j++){row[col+j]=value;if(height>1)carry.set(col+j,{cell:value,left:height-1});}col+=width;
    }out.push(row);
  }return out;
}
export function parseWorldwideIndex(html,jurisdictions){
  const rows=[];
  for(const match of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)){
    const expanded=expandedRows(match[1]);if(!expanded[0]?.some(c=>/Legislative election/i.test(c.text))||!expanded[0]?.some(c=>/Presidential election/i.test(c.text)))continue;
    for(const cells of expanded.slice(2)){
      const name=cells[0]?.text.replace(/\[.*?\]/g,'').trim();if(!name)continue;
      const country=COUNTRY_NAMES[name]||iso.getAlpha3Code(name,'en')||jurisdictions.find(j=>j.name===name)?.iso3;
      if(!country)continue;
      for(const [category,column]of [['legislative',2],['presidential',5]]){
        const cell=cells[column];if(!cell)continue;
        const articles=cell.links.filter(v=>v.startsWith('/wiki/')&&!/Help:|File:|Template:/.test(v)).map(v=>decodeURIComponent(v.slice(6)));
        rows.push({country,category,dateText:cell.text,articleTitles:[...new Set(articles)],scopeNote:'Discovery table; N/A is not verified non-applicability',locator:`Country ${name}; ${category} Last column`});
      }
    }
  }return rows;
}
export async function pinnedArticle(source,title,cutoff,options){
  const key='article-'+fingerprint({title,cutoff}).slice(0,24);
  const revision=await politeResource(source,{key:key+'-revision',url:wikiApi({action:'query',prop:'revisions',titles:title,rvprop:'ids|timestamp',rvstart:cutoff,rvlimit:'1',rvdir:'older',redirects:'1'})},options);
  const body=JSON.parse(revision.bytes),page=body.query?.pages?.[0],rev=page?.revisions?.[0];
  if(!rev||Date.parse(rev.timestamp)>Date.parse(cutoff))throw new Error(`No article revision by cutoff: ${title}`);
  const parsed=await politeResource(source,{key:key+'-html',url:wikiApi({action:'parse',oldid:String(rev.revid),prop:'text|revid'})},options);
  const p=JSON.parse(parsed.bytes).parse;if(p?.revid!==rev.revid||typeof p.text!=='string')throw new Error('Wikipedia revision parse mismatch');
  return {title:page.title,revid:rev.revid,revisionTime:rev.timestamp,html:p.text,raw:parsed,revision};
}
/** Full core-country audit. Queries are segmented by registered ISO code, not a global unbounded graph walk. */
export async function acquireLatestDiscovery(root,options={}){
  const cache=options.cache||path.join(root,'data/raw/elections'),cutoff=options.cutoff||(await readJson(path.join(root,'data/catalog-execution.json'))).executionStartUtc;
  const registry=await readJson(path.join(root,'data/latest-discovery-registry.json'));
  const jurisdictions=(await readJson(path.join(root,'data/jurisdictions.json'))).jurisdictions.filter(j=>j.scope==='core');
  const opts={root,cache,retries:0,timeoutMs:20000,...options};
  const source=registry.sources.find(s=>s.id==='wikipedia-latest');
  let index=null,indexFailure=null;
  try{index=await pinnedArticle(source,source.indexTitle,cutoff,opts);}catch(e){indexFailure=e.message;}
  const discovered=index?parseWorldwideIndex(index.html,jurisdictions):[];
  const wikidata=registry.sources.find(s=>s.id==='wikidata-presidential');
  const countryResults=await boundedMap(jurisdictions,async j=>{
    const attempts=[],articles=[];
    const leads=discovered.filter(r=>r.country===j.iso3);
    for(const lead of leads){for(const title of lead.articleTitles.slice(0,2)){
      try{const article=await pinnedArticle(source,title,cutoff,opts);articles.push({...article,category:lead.category,country:j.iso3,indexLocator:lead.locator});attempts.push({country:j.iso3,category:lead.category,sourceId:source.id,title,ok:true,url:article.raw.receipt.url,checkedAt:article.raw.receipt.retrievedAt});}
      catch(e){attempts.push({country:j.iso3,category:lead.category,sourceId:source.id,title,ok:false,error:e.message,checkedAt:new Date().toISOString()});}
    }}
    // Latest candidate index, not historical backfill. DISTINCT removes join duplicates
    // before the bounded limit. Primary P585 precision is checked in entity statements.
    const query=`SELECT DISTINCT ?event ?date ?winner WHERE { ?country wdt:P298 "${j.iso3}". ?event wdt:P17 ?country; wdt:P585 ?date; wdt:P31 ?type. ?type wdt:P279* wd:Q858439. OPTIONAL { ?event wdt:P991 ?winner } FILTER(?date <= "${cutoff}"^^xsd:dateTime) FILTER NOT EXISTS { ?event wdt:P131 ?local. FILTER(?local != ?country) } } ORDER BY DESC(?date) LIMIT 40`;
    let graph=null;
    // The query service allows 60 s per query; a 20 s client limit failed the
    // largest countries (USA, FRA, BRA, IND) on every run. One retry follows.
    try{graph=await cachedResource(wikidata,{key:j.iso3.toLowerCase()+'-latest',url:wikidata.endpoint+'?format=json&query='+encodeURIComponent(query)},{...opts,timeoutMs:Math.max(opts.timeoutMs,65000),retries:Math.max(opts.retries,1)});
      const parsed=JSON.parse(graph.bytes);if(!Array.isArray(parsed.results?.bindings))throw new Error('Malformed country query response');
      attempts.push({country:j.iso3,category:'presidential',sourceId:wikidata.id,ok:true,url:graph.receipt.url,checkedAt:graph.receipt.retrievedAt,rows:parsed.results.bindings.length,
        boundedLatestPage:true,completeHistoricalIndex:false});
    }catch(e){attempts.push({country:j.iso3,category:'presidential',sourceId:wikidata.id,ok:false,error:e.message,checkedAt:new Date().toISOString()});}
    for(const category of ['legislative','presidential'])if(!attempts.some(a=>a.category===category))attempts.push({country:j.iso3,category,sourceId:source.id,ok:false,error:indexFailure||'No usable Last-column event link for this category; N/A remains an unconfirmed discovery assertion',checkedAt:index?.raw.receipt.retrievedAt||new Date().toISOString()});
    console.log(`Latest discovery ${j.iso3}: ${articles.length} cutoff-pinned articles; graph ${graph?'captured':'unavailable'}`);
    return {country:j.iso3,leads,articles,graph,attempts};
  },2);
  const countries=countryResults.map((r,i)=>r.ok?r.value:{country:jurisdictions[i].iso3,articles:[],attempts:[{country:jurisdictions[i].iso3,ok:false,error:r.error}]});
  const latestIds=bindings=>{const first=bindings[0]?.event.value,completed=bindings.find(r=>r.winner)?.event.value;return [...new Set([first,completed].filter(Boolean).map(s=>s.split('/').at(-1)))];};
  const graphIds=[...new Set(countries.flatMap(c=>c.graph?latestIds(JSON.parse(c.graph.bytes).results.bindings):[]))];
  // Also resolve real article Wikidata IDs; never construct a date/article title.
  const titleGroups=[];const titles=[...new Set(countries.flatMap(c=>c.articles.map(a=>a.title)))];for(let i=0;i<titles.length;i+=40)titleGroups.push(titles.slice(i,i+40));
  const mappings=await boundedMap(titleGroups,async group=>politeResource(source,{key:'ids-'+fingerprint(group).slice(0,24),url:wikiApi({action:'query',prop:'pageprops',ppprop:'wikibase_item',titles:group.join('|'),redirects:'1'})},opts),1);
  const articleIds={};for(const r of mappings.filter(r=>r.ok))for(const p of JSON.parse(r.value.bytes).query?.pages||[])if(p.pageprops?.wikibase_item)articleIds[p.title]=p.pageprops.wikibase_item;
  const ids=[...new Set([...graphIds,...Object.values(articleIds)])],groups=[];for(let i=0;i<ids.length;i+=40)groups.push(ids.slice(i,i+40));
  const entities=await boundedMap(groups,async group=>politeResource(wikidata,{key:'entities-'+fingerprint(group).slice(0,24),url:wikidata.entityApi+'?'+new URLSearchParams({action:'wbgetentities',ids:group.join('|'),props:'claims|labels|sitelinks',languages:'en',sitefilter:'enwiki',format:'json'})},opts),1);
  const entityPages=entities.filter(r=>r.ok).map(r=>r.value);
  const related=[...new Set(entityPages.flatMap(raw=>Object.values(JSON.parse(raw.bytes).entities||{}).flatMap(e=>['P541','P991','P726','P31','P17','P1001'].flatMap(k=>(e.claims?.[k]||[]).map(s=>s.mainsnak?.datavalue?.value?.id).filter(Boolean)))))];
  const labelGroups=[];for(let i=0;i<related.length;i+=40)labelGroups.push(related.slice(i,i+40));
  const labels=await boundedMap(labelGroups,async group=>politeResource(wikidata,{key:'labels-'+fingerprint(group).slice(0,24),url:wikidata.entityApi+'?'+new URLSearchParams({action:'wbgetentities',ids:group.join('|'),props:'labels',languages:'en',format:'json'})},opts),1);
  const resources=[...(index?[index.raw,index.revision]:[]),...countries.flatMap(c=>[...c.articles.flatMap(a=>[a.raw,a.revision]),...(c.graph?[c.graph]:[])]),...mappings.filter(r=>r.ok).map(r=>r.value),...entityPages,...labels.filter(r=>r.ok).map(r=>r.value)];
  const references=[...new Map(resources.map(r=>[r.reference.receiptId,r.reference])).values()];
  const payload={version:1,cutoff,registryHash:fingerprint(registry),index:index?{title:index.title,revid:index.revid,htmlReference:index.raw.reference,revisionReference:index.revision.reference}:null,indexFailure,
    countries:countries.map(c=>({country:c.country,leads:c.leads||[],attempts:c.attempts,graphReference:c.graph?.reference||null,
      articles:c.articles.map(a=>({title:a.title,revid:a.revid,revisionTime:a.revisionTime,category:a.category,country:a.country,indexLocator:a.indexLocator,reference:a.raw.reference,revisionReference:a.revision.reference,entityId:articleIds[a.title]||null}))})),
    entityReferences:entityPages.map(r=>r.reference),labelReferences:labels.filter(r=>r.ok).map(r=>r.value.reference),references,
    failures:[...mappings,...entities,...labels].filter(r=>!r.ok).map(r=>r.error)};
  const batchId=fingerprint(payload);await immutable(path.join(cache,'latest-discovery-batches',batchId+'.json'),json(payload));await atomic(path.join(cache,'latest-discovery.json'),json({batchId}));
  await fs.mkdir(path.join(root,'build/latest-evidence'),{recursive:true});await atomic(path.join(root,'build/latest-evidence/discovery-audit.json'),json(payload));
  return {batchId,...payload};
}
