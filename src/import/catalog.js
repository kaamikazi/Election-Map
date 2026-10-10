/** Hash-checked national catalog proposals use the same importer, undo and review. */
import {LAYER,layerHash} from '../geo.js';
export const CATALOG_VIEWS=[{value:'browse',label:'Browse elections'},
  {value:'date',label:'Latest parliamentary election date'},{value:'seats',label:'Largest party by seats'},
  {value:'vote',label:'Largest party by recorded vote share'},{value:'presidential',label:'Latest presidential outcome'},
  {value:'turnout',label:'Turnout: voters / registered electors'},{value:'coverage',label:'Coverage and unresolved results'}];
const sha=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(n=>n.toString(16).padStart(2,'0')).join('');
async function read(url,hash){const r=await fetch(url);if(!r.ok)throw new Error('Catalog unavailable. Run npm run elections:bootstrap for a fresh checkout, or elections:latest and elections:backfill.');
  const b=await r.arrayBuffer();if(hash&&await sha(b)!==hash)throw new Error('Catalog file integrity failure; rebuild before import');return JSON.parse(new TextDecoder().decode(b));}
export function filterCatalog(events,filters){
  const contains=(v,q)=>!q||String(v||'').toLowerCase().includes(String(q).toLowerCase().trim());
  return events.filter(e=>contains(e.country,filters.country)&&contains(e.date,filters.date)&&contains(e.office+' '+e.category,filters.office)&&
    contains(e.chamber,filters.chamber)&&contains(e.status,filters.status)&&contains(e.sourceId,filters.source)&&(!filters.available||e.metrics.includes(filters.available)));
}
export async function catalogDraft(answers,layer){
  if(LAYER!=='world')throw new Error('National catalog views require the country-outline world layer. Subnational results require their own validated geometry and Election database adapter.');
  const pointer=await read('data/catalog/current.json');
  if(!/^[a-f0-9]{64}$/.test(pointer.generation)||pointer.manifest!==`data/catalog/generations/${pointer.generation}/manifest.json`||pointer.index!==`data/catalog/generations/${pointer.generation}/index.json`)throw new Error('Invalid catalog pointer');
  const prefix=`data/catalog/generations/${pointer.generation}/`,manifest=await read(pointer.manifest,pointer.manifestSha256),index=await read(pointer.index,manifest.files['index.json']);
  if(index.geometry.sha256!==layerHash())throw new Error('World outline changed after catalog validation. Revalidate national schematic display.');
  const view=answers.view||'browse';
  if(view==='browse'&&!answers.catalogEvent){
    const matches=filterCatalog(index.events,answers).sort((a,b)=>Number(b.latest)-Number(a.latest)||b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
    if(!matches.length)throw new Error('No acquired event matches these filters; missing evidence is not evidence of no election. See catalog coverage reports.');
    return {choose:{name:'catalogEvent',prompt:'Choose a sourced national election',note:`${matches.length} matches; first 80 shown. Refine filters for country/year browsing. “Latest” means selection from searched sources, with the freshness basis shown next.`,
      options:matches.slice(0,80).map(e=>({value:e.id,label:`${e.country} · ${e.date}${e.endDate!==e.date?' to '+e.endDate:''} · ${e.office}`,
        detail:`${e.scope||'scope unrecorded'} · ${e.sourceId} · ${e.status} · ${e.latest?'latest available selection':'archive event'} · ${e.metrics.join(', ')||'no eligible metric'} · ${e.geometry?'national schematic outline':'geometry unavailable'}${e.subnationalCapabilities?.length?' · compatible subnational views also available':''}`}))}};
  }
  let snapshot,event=null;
  if(view==='browse'){
    const events=await read(prefix+'events.json',manifest.files['events.json']);event=events.find(e=>e.id===answers.catalogEvent);
    if(!event)throw new Error('Catalog event changed; choose again');
    if(!answers.catalogMetric)return {choose:{name:'catalogMetric',prompt:`${event.country} · ${event.office} · ${event.date}: select a view`,
      note:`${event.latestEvidence?.basis||'Latest available; latest election unconfirmed'}. Certification: ${event.certificationStatus||'unknown'}. National modern outline is schematic. Round(s): ${event.rounds.map(r=>r.number??'unknown').join(', ')}.${event.subnationalCapabilities?.map(c=>` Subnational: ${c.eligibleReportedWinners} reported winners; ${c.layer}, vintage ${c.vintage}. ${c.instructions}`).join('')||''}`,
      options:Object.entries(event.metrics).filter(([name])=>name!=='majority').map(([name,m])=>({value:name,label:name==='date'?'Recorded election date':CATALOG_VIEWS.find(v=>v.value===name)?.label||name,
        detail:m.eligible?`Eligible: ${m.formula}; ${m.limitations?.join(' ')||''}`:`Unavailable: ${m.reason}`}))}};
    const metric=event.metrics[answers.catalogMetric];
    if(!metric?.eligible)return {reviewOnly:{identity:{country:event.country,date:event.date,office:event.office,round:null,sourceId:event.sourceId},
      note:`View unavailable: ${metric?.reason||'Unknown metric'}. Other metric eligibility is independent. Sources and national totals are preserved.`,evidencePrefix:prefix,evidenceFiles:manifest.evidence,
      records:(event.parties.length?event.parties:event.candidates.length?event.candidates:[{name:'Election identity'}]).map(r=>({party:r.name,regionName:event.country,
        votes:r.votes??null,voteShare:r.voteShare??null,seats:r.seats??null,winner:r.elected??null,recordHash:event.recordHash,
        review:{state:event.review.state,reasons:[{text:metric?.reason||'Unavailable metric'},...event.notes.map(text=>({text}))]},citation:{...event.citations[0],locator:{record:typeof event.citations[0].locator==='object'?JSON.stringify(event.citations[0].locator):event.citations[0].locator}}}))}};
    snapshot={view:answers.catalogMetric,category:event.category,cutoffUtc:index.cutoffUtc,geometry:index.geometry,coreJurisdictions:1,
      rows:[{country:event.country,name:event.country,geometry:event.geometry,eventId:event.id,metric,status:event.resultStatus,latestClaim:{checked:false,label:'Historical/source-specific event; no latest claim'}}]};
  }else{
    const choice=index.snapshots.find(s=>s.view===view);if(!choice)throw new Error('Unknown catalog view');snapshot=await read(prefix+choice.file,manifest.files[choice.file]);
  }
  const events=event?[event]:await read(prefix+'events.json',manifest.files['events.json']);
  return snapshotProposal(snapshot,{...layer,events,generation:pointer.generation,prefix,manifest,singleEvent:!!event});
}
const FRESHNESS_SHORT={'latest-corroborated':'latest established and corroborated','latest-established':'latest established by authority','latest-available-unconfirmed':'latest available, freshness unconfirmed',
  'newer-held-results-pending':'held, results pending','unknown':'unknown','sourced-non-applicability':'sourced non-applicable'};
const STATE_SHORT={scheduled:'scheduled','held-results-unavailable':'held, results unavailable',partial:'partial/provisional count',reported:'results reported',declared:'officially declared',certified:'certified','recount-or-suspension':'official recount/suspension',annulled:'annulled',unknown:'status unknown'};
const COLORS={missing:'#55616d',pending:'#d29945',nonapplicable:'#c5c9ca',unresolved:'#a46ba2'};
function visual(row,view,cutoff){
  if(!row.metric.eligible){if(row.status==='no-applicable-election'||row.status==='appointed-institution')return {key:'not-applicable',name:'Non-applicable / appointed',color:COLORS.nonapplicable,hatch:true};
    if(row.status==='recount-or-suspension')return {key:'recount',name:'Official recount or suspension in force',color:COLORS.unresolved,hatch:true};
    if(['partial','held-results-unavailable','annulled','scheduled','pending-or-missing','official-partial'].includes(row.status))return {key:'pending',name:'Partial or pending results',color:COLORS.pending,hatch:true};
    return {key:'missing',name:'Missing evidence / metric',color:COLORS.missing,hatch:true};}
  if(view==='coverage'){
    if(row.freshness){const states={'latest-corroborated':['Latest established and independently corroborated','#2c9a92'],'latest-established':['Latest established by authority evidence','#3fbaaa'],'latest-available-unconfirmed':['Latest available; freshness unconfirmed','#668ea9'],'newer-held-results-pending':['Held; results pending / unresolved',COLORS.pending],'unknown':['Unknown',COLORS.missing],'sourced-non-applicability':['Sourced non-applicability',COLORS.nonapplicable]};const [name,color]=states[row.freshness]||['Unknown',COLORS.missing];return {key:row.freshness,name,color,hatch:!['latest-established','latest-corroborated'].includes(row.freshness)};}
    const categories={'declared':['Results declared; freshness unresolved','#287d8e'],'certified':['Certified results','#287d8e'],'partial':['Partial or pending results',COLORS.pending],'held-results-unavailable':['Held; results unavailable',COLORS.pending],
      'reported':['Results reported; no official declaration captured','#287d8e'],'recount-or-suspension':['Official recount or suspension in force',COLORS.unresolved],'annulled':['Results annulled',COLORS.pending],'scheduled':['Scheduled; not yet held',COLORS.missing],'unknown':['Unknown status',COLORS.missing],
      'reported-results':['Results acquired; freshness unresolved','#287d8e'],'official-final':['Official results acquired','#287d8e'],'historical':['Archive; latest unconfirmed','#668ea9'],
      'pending-or-missing':['Pending / missing results',COLORS.pending],'missing-evidence':['Missing evidence',COLORS.missing],'acquisition-failure':['Acquisition failed',COLORS.unresolved],
      'no-applicable-election':['No applicable election',COLORS.nonapplicable],'appointed-institution':['Appointed institution',COLORS.nonapplicable],'suspended-institution':['Suspended institution',COLORS.unresolved]};
    const [name,color]=categories[row.status]||['Unresolved evidence',COLORS.missing];return {key:row.status,name,color,hatch:row.status.includes('missing')};
  }
  if(view==='date'){const year=Number(row.metric.value.slice(0,4)),current=Number(cutoff.slice(0,4)),bucket=year>=current-1?0:year>=current-4?1:year>=current-8?2:3;
    const labels=[`${current-1}–${current}`,`${current-4}–${current-2}`,`${current-8}–${current-5}`,`Before ${current-8}`];return {key:`date-${bucket}`,name:labels[bucket],color:['#2c9a92','#67b3bb','#8c9fc6','#7b7690'][bucket]};}
  // Who established the winner decides the category: an official declaration,
  // a derivation from official figures under a stated rule, or a reported outcome.
  if(view==='presidential'){
    if(row.metric.value?.derived)return {key:'derived-outcome',name:'Derived from official figures under a stated rule',color:'#4f8f7a',hatch:true};
    if(row.metric.outcomeFrom||row.event?.status?.declaration?.state!=='declared')return {key:'reported-outcome',name:'Reported outcome; official declaration not captured',color:'#668ea9',hatch:true};
    return {key:'declared-outcome',name:'Official declaration acquired',color:'#318d8d'};
  }
  if(['seats','vote'].includes(view)&&row.metric.value.tie)return {key:'tie',name:'Tie for largest party',color:'#997dba',hatch:true};
  const percent=view==='seats'?row.metric.value.maximum/row.event.seatsAtStake*100:view==='vote'?row.metric.value.maximum:row.metric.value;
  const bucket=Math.min(3,Math.floor(percent/25));return {key:`${view}-${bucket}`,name:bucket===3?'75–100%':`${bucket*25}–${(bucket+1)*25}%`,color:['#516d82','#377e92','#259f9f','#3fbaaa'][bucket]};
}
export function snapshotProposal(snapshot,{events,generation,prefix,manifest,singleEvent=false,...layer}){
  const notes=[`Latest-election snapshot as of ${snapshot.cutoffUtc}; countries have varying election dates.`,
    'Provider latest assertions are distinguished from independent confirmation. Visible gaps remain unresolved.',
    'Modern country outlines are schematic; outline vintage is not recorded. No historical borders or constituency coverage claimed.',
    'Colours describe date/metric/coverage bands, not equivalent party ideologies. Per-country identities, formulas and citations accompany the saved map.'];
  if(singleEvent)notes[0]='Historical/source-specific election display; no latest-election claim.';
  else notes.push('Scope: 195 UN member and observer states; supplementary outlines are outside this snapshot.');
  const withoutGeometry=snapshot.rows.filter(r=>!r.geometry).map(r=>r.country);
  if(withoutGeometry.length)notes.push(`Country outline unavailable: ${withoutGeometry.join(', ')}. No geometry is invented.`);
  if(snapshot.view==='turnout')notes.push('Turnout: provider voters / registered electors; invalid-ballot treatment may be unreported. Compare recorded definitions only.');
  const rows=snapshot.rows.filter(r=>r.geometry).map(r=>({...r,event:events.find(e=>e.id===r.eventId)||null}));
  const eligible=rows.filter(r=>r.metric.eligible).length;
  const established=rows.filter(r=>r.latestClaim?.establishedWithEvidence).length;
  if(!singleEvent)notes.push(`${established}/${snapshot.coreJurisdictions} latest-election claims established with qualifying primary evidence; metric eligibility is counted separately.`);
  const source={kind:'catalog',label:'National election catalog',url:'https://data.ipu.org/data-tools/api/',datasetId:`catalog:${generation}:${snapshot.view}${singleEvent?':'+rows[0]?.eventId:''}`,
    completeSnapshot:true,fitToData:false,asOf:null,title:singleEvent?`${rows[0]?.country} · ${rows[0]?.event.date} · ${snapshot.view}`:CATALOG_VIEWS.find(v=>v.value===snapshot.view)?.label||snapshot.view,
    sub:singleEvent?'Historical/source-specific national schematic display':`As of ${snapshot.cutoffUtc} · varying election dates · ${eligible}/${snapshot.coreJurisdictions} metric eligible · ${established} latest established`,
    what:CATALOG_VIEWS.find(v=>v.value===snapshot.view)?.label||snapshot.view,notes,
    catalog:{view:snapshot.view,cutoffUtc:snapshot.cutoffUtc,singleEvent,geometry:snapshot.geometry,coreJurisdictions:snapshot.coreJurisdictions,eligible,withoutGeometry:snapshot.rows.filter(r=>!r.geometry).map(r=>r.country)},
    publication:{purpose:'explainer',status:null,country:'Worldwide latest-election catalog',office:'Mixed national election identities',electionDate:null,
      electionType:singleEvent?'national-election-catalog':'latest-election-snapshot',
      note:notes[0]}};
  if(!singleEvent){const tally=Object.entries(rows.reduce((m,r)=>{const k=r.freshness||'unclassified';m[k]=(m[k]||0)+1;return m;},{}));
    notes.push(`Freshness: ${tally.map(([k,n])=>`${n} ${FRESHNESS_SHORT[k]||k}`).join(', ')}. Authority establishment and independent corroboration are counted separately.`);}
  const hints=rows.map(r=>{
    const v=visual(r,snapshot.view,snapshot.cutoffUtc),ev=r.event,cite=ev?.citations?.[0]||r.citations?.[0];
    const value=!r.metric.eligible?`${r.metric.reason||r.status}`:snapshot.view==='date'?`${r.metric.value}`:
      ['seats','vote'].includes(snapshot.view)?`${r.metric.value.names.join(' / ')}${r.metric.value.tie?' (tie)':''}`:snapshot.view==='presidential'?`${r.metric.value.name}`:`${String(r.metric.value)}`;
    // Tooltips carry freshness, result authority and unresolved conflicts with the value.
    // Tooltips name the result status and who reported it; a partial count shows
    // its leader only as a labelled partial figure, never as a winner.
    const st=ev?.status,partial=ev?.metrics?.partialCount?.eligible?ev.metrics.partialCount.value:null;
    const qualifiers=singleEvent?[]:[FRESHNESS_SHORT[r.freshness]||null,
      st?`${STATE_SHORT[st.state]||st.state}${st.state==='reported'&&st.results?.reportedBy?` (${st.results.reportedBy} source)`:st.declaration?.by?` (${st.declaration.by})`:''}`:ev?`${ev.resultStatus||'result'} (contributed/provider source)`:null,
      ...(st?.caveats||[]).slice(0,2),
      st?.institution?.formed&&st.state==='held-results-unavailable'?'body convened; results not captured':null,
      partial?`partial count: ${partial.leading.join(' / ')} leading — not a winner`:null,
      r.metric?.value?.derived?'winner derived from official figures under a stated rule':null,
      r.metric?.outcomeFrom?`${snapshot.view==='turnout'?'turnout':'winner'} reported by ${r.metric.outcomeFrom.sourceId}`:null,
      st?.recount&&['requested','completed'].includes(st.recount.state)?`recount ${st.recount.state}`:null,
      st?.freshnessCheck?.required?'recent: recheck count':null,
      (ev?.conflicts||[]).some(c=>/date/.test(c.kind))?'date conflict unresolved':null].filter(Boolean);
    const label=`${r.country}: ${value}${qualifiers.length?' · '+qualifiers.join(' · '):''}`;
    const mapped={vote:snapshot.view==='vote'&&r.metric.eligible?r.metric.value.maximum:null,seats:snapshot.view==='seats'&&r.metric.eligible?r.metric.value.maximum/ev.seatsAtStake*100:null,
      turnout:snapshot.view==='turnout'&&r.metric.eligible?r.metric.value:null,margin:null};
    return {...v,key:`catalog:${v.key}`,label,
      catalog:{view:snapshot.view,cutoffUtc:snapshot.cutoffUtc,event:ev,metric:r.metric,geometry:r.geometry,status:r.status,freshness:r.freshness||null,latestClaim:r.latestClaim,
        mappedValues:mapped,label,slotKey:`catalog:${v.key}`,legendCategory:v.name,snapshotIdentity:source.datasetId,singleEvent},
      source:{...source,label:ev?`${ev.sourceId} (${r.country})`:`Catalog coverage (${r.country})`,url:cite?.url||source.url,asOf:ev?.date||null,fetchedAt:cite?.retrievedAt||null,
        cite:{permalink:cite?.url||source.url,license:ev?.licence?.attribution||ev?.licence?.name||snapshot.providers?.[cite?.sourceId]?.licence?.attribution||snapshot.providers?.[cite?.sourceId]?.licence?.name||'UN membership and registered-source coverage'},
        evidence:cite?{sourceId:cite.sourceId,rawSha256:cite.sha256,receiptId:cite.receiptId,generation,capturedFile:prefix+manifest.evidence[cite.sha256],locator:cite.locator}:null,
        catalog:{provider:ev?.sourceId||cite?.sourceId||'coverage',country:r.country,eventId:ev?.id||null,cutoffUtc:snapshot.cutoffUtc,
          providerUrl:(ev?.sourceId||cite?.sourceId)==='ipu-parline'?'https://data.ipu.org/':(ev?.sourceId||cite?.sourceId)==='wikidata-presidential'?'https://www.wikidata.org/':(ev?.sourceId||cite?.sourceId)==='wikipedia-latest'?'https://en.wikipedia.org/':ev?.citations?.[0]?.url||snapshot.providers?.[cite?.sourceId]?.url||source.url}}};
  });
  return {...layer,source,hasHeader:false,unitKeys:rows.map(r=>r.geometry.key),hints,
    rows:rows.map((r,i)=>[r.geometry.key,hints[i].name,...['vote','seats','turnout','margin'].map(k=>hints[i].catalog.mappedValues[k]===null?'[clear]':String(hints[i].catalog.mappedValues[k]))]),
    columns:['unit','party','vote','seats','turnout','margin'].map((role,index)=>({role,index,header:role}))};
}
