import path from 'node:path';
import {readJson,json,fingerprint,atomic} from '../ingestion/util.js';
import {cachedResource,boundedMap} from './acquire.js';
import {replayReference} from '../ingestion/acquire.js';
import {evidence} from './adapters.js';
import {text} from './html.js';
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
/** When this pass observed the resource. Unchanged bytes keep their first
 * receipt (and citation), but the new fetch is reported as `capture`. */
export const checkTime=raw=>raw.capture?.retrievedAt||raw.receipt.retrievedAt;
export function textDates(content){
  const dates=new Set(content.match(/\b(?:19|20)\d\d-\d\d-\d\d\b/g)||[]);
  const iso=(y,m,d)=>{const v=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;return new Date(v).toISOString().slice(0,10)===v?v:null;};
  const month=name=>MONTHS.findIndex(m=>m.toLowerCase()===name.toLowerCase());
  // Ranges and pairs that share one year: "12–13 April 2026", "April 12–13, 2026",
  // "4 February and 3 March 2024". Only the shared year is applied.
  const M=MONTHS.join('|');
  for(const m of content.matchAll(new RegExp(String.raw`\b(\d{1,2})\s*[–-]\s*(\d{1,2}) (${M}) ((?:19|20)\d\d)\b`,'gi')))for(const d of [m[1],m[2]]){const v=iso(m[4],month(m[3]),d);if(v)dates.add(v);}
  for(const m of content.matchAll(new RegExp(String.raw`\b(${M}) (\d{1,2})\s*[–-]\s*(\d{1,2}),? ((?:19|20)\d\d)\b`,'gi')))for(const d of [m[2],m[3]]){const v=iso(m[4],month(m[1]),d);if(v)dates.add(v);}
  for(const m of content.matchAll(new RegExp(String.raw`\b(\d{1,2}) (${M}) and (\d{1,2}) (${M}) ((?:19|20)\d\d)\b`,'gi'))){const v=iso(m[5],month(m[2]),m[1]);if(v)dates.add(v);}
  for(let i=0;i<MONTHS.length;i++){
    const patterns=[new RegExp(`\\b(\\d{1,2}) ${MONTHS[i]} ((?:19|20)\\d\\d)\\b`,'gi'),new RegExp(`\\b${MONTHS[i]} (\\d{1,2}),? ((?:19|20)\\d\\d)\\b`,'gi')];
    for(const re of patterns)for(const m of content.matchAll(re)){const d=`${m[2]}-${String(i+1).padStart(2,'0')}-${m[1].padStart(2,'0')}`;if(new Date(d).toISOString().slice(0,10)===d)dates.add(d);}
  }return [...dates].sort();
}
export function authorityFor(registry,country,category,url){
  let host;try{host=new URL(url).hostname;}catch{return null;}
  return registry.profiles.find(p=>p.country===country&&p.categories.includes(category)&&p.domains.some(d=>!d.includes('/')&&(host===d||host.endsWith('.'+d))))||null;
}
export function assessIndex(profile,html,selected,raw,cutoff){
  if(!selected||!profile.rule)return null;
  const content=text(html),dates=textDates(content).filter(d=>d<=cutoff.slice(0,10));
  if(profile.rule==='uk-general-election-index'){
    const headings=[...html.matchAll(/<a\b[^>]*href=["'][^"']*\/general-elections\/\d+[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)].map(m=>text(m[1]));
    const indexed=headings.flatMap(label=>{const normal=textDates(label);const yearFirst=label.match(/^(20\d{2})\s*-\s*(\d{1,2})\s+(\w+)/);if(yearFirst){const month=MONTHS.findIndex(m=>m.toLowerCase()===yearFirst[3].toLowerCase());if(month>=0)normal.push(`${yearFirst[1]}-${String(month+1).padStart(2,'0')}-${yearFirst[2].padStart(2,'0')}`);}return normal;}).filter(d=>d<=cutoff.slice(0,10)).sort();
    if(!/General elections/i.test(content)||!indexed.length||indexed.at(-1)!==selected.date)return null;
    return {kind:'latest-established',independent:true,checked:true,authority:profile.authority,lineage:'primary:uk-parliament',basis:'Official current General elections category index; latest indexed held date matches the selected event',
      date:selected.date,checkedAt:checkTime(raw),citation:evidence(raw,'General elections index links and dates'),rule:profile.rule};
  }
  if(profile.rule==='most-recent-statement'){
    // An authority sentence naming its most recent election of this category.
    const re=new RegExp(String.raw`most recent ${profile.subject} (?:took place|was held) on (?:[A-Z][a-z]+day,? )?(\d{1,2} [A-Z][a-z]+ (?:19|20)\d\d)`,'i'),m=content.match(re);
    const stated=m?textDates(m[1].replace(/(\d)\s?(?:st|nd|rd|th)\b/,'$1'))[0]:null;
    if(!stated||stated>cutoff.slice(0,10)||stated!==selected.date)return null;
    return {kind:'latest-established',checked:true,authority:profile.authority,lineage:profile.lineage||`primary:${profile.authority}`,
      basis:`Official statement "The most recent ${profile.subject} took place on ${m[1]}" matches the selected event`,date:selected.date,checkedAt:checkTime(raw),
      citation:evidence(raw,`"The most recent ${profile.subject} took place on …" statement`),rule:profile.rule};
  }
  if(profile.rule==='registered-statement'){
    // A registered authority sentence naming the election that formed the
    // current institution (e.g. "the seventh convocation ... was formed
    // following the elections held on 1st September 2024"). The pattern is
    // registered per profile with the date in group 1; the matched sentence is kept.
    const m=content.match(new RegExp(profile.statement,'i')),stated=m?textDates(m[1].replace(/(\d)\s?(?:st|nd|rd|th)\b/,'$1'))[0]:null;
    if(!stated||stated>cutoff.slice(0,10)||stated!==selected.date)return null;
    return {kind:'latest-established',checked:true,authority:profile.authority,lineage:profile.lineage||`primary:${profile.authority}`,
      basis:`Official statement: "${m[0].slice(0,240)}" — the current ${profile.subject} was formed by the selected election`,date:selected.date,checkedAt:checkTime(raw),
      citation:evidence(raw,`Registered statement: ${profile.subject}`),rule:profile.rule};
  }
  if(profile.rule==='aec-federal-elections-index'){
    const listed=[...content.matchAll(/((?:19|20)\d\d) federal election – [A-Z][a-z]+day (\d{1,2} [A-Z][a-z]+ (?:19|20)\d\d)/g)].map(m=>textDates(m[2])[0]).filter(d=>d&&d<=cutoff.slice(0,10)).sort();
    if(!listed.length||listed.at(-1)!==selected.date)return null;
    return {kind:'latest-established',checked:true,authority:profile.authority,lineage:profile.lineage||'primary:aec',basis:'Official AEC federal elections index; most recent listed federal election date matches the selected event',
      date:selected.date,checkedAt:checkTime(raw),citation:evidence(raw,'Federal elections: "In this section" dated list of federal elections'),rule:profile.rule};
  }
  if(profile.rule==='canada-past-election-index'){
    if(!/Past Elections|Past elections/i.test(content)||!dates.length||dates.at(-1)!==selected.date)return null;
    return {kind:'latest-established',independent:true,checked:true,authority:profile.authority,lineage:'primary:elections-canada',basis:'Official Past Elections category index; most recent held election date matches selected identity',
      date:selected.date,checkedAt:checkTime(raw),citation:evidence(raw,'Past Elections national general-election list'),rule:profile.rule};
  }return null;
}
export async function acquireAuthorityPass(root,events,options={}){
  const registry=await readJson(path.join(root,'data/latest-authorities.json')),jurisdictions=(await readJson(path.join(root,'data/jurisdictions.json'))).jurisdictions.filter(j=>j.scope==='core');
  const cutoff=options.cutoff||(await readJson(path.join(root,'data/catalog-execution.json'))).executionStartUtc,cache=options.cache||path.join(root,'data/raw/elections');
  const source={id:'latest-authority-evidence',cacheHours:168},attempts=[],assertions=[],resources=[];
  // Offline, the pass recorded online for this cutoff is replayed: the same
  // captures (and the time each was checked) are reassessed, and a recorded
  // fetch failure stays a fetch failure instead of becoming "no offline evidence".
  const auditFile=path.join(root,'build/latest-evidence/authority-audit.json');
  const recorded=options.offline?await readJson(auditFile,null):null,recordedPass=recorded?.cutoff===cutoff?recorded.attempts:null;
  const fetchResource=async(item,url,resource,opts)=>{
    const r=recordedPass?.find(a=>a.country===item.country&&a.category===item.category&&a.url===url);
    // A link the recorded pass never saw (e.g. cited by a record that later
    // code derives) was not attempted; say so, without inventing a check time.
    if(!r&&recordedPass){const e=new Error('Not attempted in the recorded online pass for this cutoff; acquire online to check it');e.unattempted=true;throw e;}
    if(!r)return cachedResource(source,resource,{root,cache,notBefore:cutoff,...opts,...options});
    if(!r.reference){const e=new Error(r.error||'No capture recorded for this cutoff');e.recorded=r;throw e;}
    const raw=await replayReference(cache,r.reference);
    const capture=r.captureId?await readJson(path.join(cache,'receipts',`${r.captureId}.json`)):{retrievedAt:r.checkTime};
    return {...raw,capture,captureId:r.captureId||null,...(r.error?.startsWith('Refresh failed: ')?{fallback:{error:r.error.slice(16)}}:{})};
  };
  const failure=(e,base)=>e.recorded?{...e.recorded,replayed:'Recorded online failure for this cutoff'}:{...base,ok:false,error:e.message,checkTime:e.unattempted?null:new Date().toISOString()};
  const work=jurisdictions.flatMap(j=>['legislative','presidential'].map(category=>({country:j.iso3,category})));
  await boundedMap(work,async item=>{
    const candidates=events.filter(e=>e.country===item.country&&e.category===item.category&&e.holdingStatus==='held'&&e.date<=cutoff.slice(0,10)).sort((a,b)=>(b.endDate||b.date).localeCompare(a.endDate||a.date));
    const selected=candidates[0]||null,profiles=registry.profiles.filter(p=>p.country===item.country&&p.categories.includes(item.category));
    const sourceUrls=candidates.slice(0,2).flatMap(e=>[...(e.rawReferenceUrls||[]),...(e.externalReferences||[]),...(e.providerSources?.match(/https?:\/\/[^\s<>"']+/g)||[])]);
    const urls=[...new Set([...profiles.map(p=>p.indexUrl).filter(Boolean),...sourceUrls.filter(url=>authorityFor(registry,item.country,item.category,url))])].slice(0,3);
    if(!urls.length){attempts.push({...item,ok:false,reason:profiles.length?'Registered authority has no usable indexed/resource link for this event':'No authority profile/resource identified from the registered discoveries; requires country-specific authority registration',nextAction:'Identify the electoral authority or constitutional/parliamentary source for this category; do not interpret missing evidence as non-applicability'});return;}
    for(const url of urls){const profile=authorityFor(registry,item.country,item.category,url);
      try{const raw=await fetchResource(item,url,{key:`${item.country.toLowerCase()}-${item.category}-${fingerprint(url).slice(0,12)}`,url},{timeoutMs:15000,retries:0});resources.push(raw);
        // A capture older than this pass (refresh failed) cannot show the state
        // at this cutoff; it is kept for audit only.
        const stale=!!raw.fallback||Date.parse(checkTime(raw))<Date.parse(cutoff);
        const assertion=stale?null:assessIndex(profile,raw.bytes.toString(),selected,raw,cutoff);if(assertion)assertions.push({...item,eventId:selected.id,...assertion});
        attempts.push({...item,ok:!raw.fallback,url,authority:profile.authority,checkTime:checkTime(raw),captureId:raw.captureId||null,firstCapturedAt:raw.receipt.retrievedAt,reference:raw.reference,...(raw.fallback?{error:`Refresh failed: ${raw.fallback.error}`}:{}),
          assessment:assertion?'qualifying-latest-evidence':stale?`capture from ${checkTime(raw)} predates this cutoff; not used for a latest-election assessment`:'resource-acquired; no supported latest-election assertion extracted',eventId:selected?.id||null,nextAction:assertion?'Review the exact primary evidence and source conflicts':'Add a source-specific locator/rule or review the declaration; a fetched page alone does not establish freshness'});
      }catch(e){attempts.push(failure(e,{...item,url,authority:profile?.authority,nextAction:'Retry permitted source or register an authoritative alternative; continue other countries'}));}
    }
  },2);
  for(const rule of registry.nonApplicabilityRules){
    // One cache key per rule URL: a country may register several constitutional sources.
    const key=rule.url===registry.nonApplicabilityRules.find(r=>r.country===rule.country&&r.category===rule.category).url?`${rule.country.toLowerCase()}-${rule.category}-constitution`:`${rule.country.toLowerCase()}-${rule.category}-constitution-${fingerprint(rule.url).slice(0,12)}`;
    try{const raw=await fetchResource(rule,rule.url,{key,url:rule.url},{timeoutMs:20000,retries:1});resources.push(raw);
      // Typographic apostrophes and spacing must not defeat an exact registered phrase.
      const fold=t=>t.toLowerCase().replace(/[‘’]/g,"'").replace(/\s+/g,' ');
      const content=fold(text(raw.bytes.toString())),matched=rule.requiredText.every(t=>content.includes(fold(t)));
      attempts.push({country:rule.country,category:rule.category,url:rule.url,ok:!raw.fallback,checkTime:checkTime(raw),captureId:raw.captureId||null,firstCapturedAt:raw.receipt.retrievedAt,...(raw.fallback?{error:`Refresh failed: ${raw.fallback.error}`}:{}),reference:raw.reference,assessment:matched?'sourced-non-applicability':'constitutional source did not match registered assertion'});
      if(matched)assertions.push({...rule,kind:'sourced-non-applicability',checkedAt:checkTime(raw),lineage:rule.lineage||`primary:${rule.authority}`,citation:evidence(raw,rule.locator||'Registered constitutional statement of the head of state')});
    }catch(e){attempts.push(failure(e,{country:rule.country,category:rule.category,url:rule.url}));}
  }
  const result={version:1,cutoff,registryHash:fingerprint(registry),attempts:attempts.sort((a,b)=>`${a.country}/${a.category}/${a.url||''}`.localeCompare(`${b.country}/${b.category}/${b.url||''}`)),assertions,
    // Sorted: fetches finish in any order, and the audit must replay byte-identically.
    references:[...new Map(resources.map(r=>[r.reference.receiptId,r.reference])).values()].sort((a,b)=>a.receiptId.localeCompare(b.receiptId))};
  await atomic(auditFile,json(result));return result;
}
