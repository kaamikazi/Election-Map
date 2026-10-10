import iso from 'i18n-iso-countries';
import {fingerprint} from '../ingestion/util.js';
import {validatePages} from './acquire.js';
import {text} from './html.js';
import {xlsxRows} from './xlsx.js';

export const day=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}/.test(v)&&Number.isFinite(Date.parse(v.slice(0,10)))&&new Date(v.slice(0,10)).toISOString().slice(0,10)===v.slice(0,10)?v.slice(0,10):null;
export const scalar=(v)=>v?.missing_reason?null:(v?.value??null);
export function at(v,cutoff){
  if(!Array.isArray(v))return scalar(v);
  const active=v.filter(f=>(!f.date_from||f.date_from<=cutoff.slice(0,10))&&(!f.date_to||f.date_to>=cutoff.slice(0,10)));
  return active.sort((a,b)=>(a.date_from||'').localeCompare(b.date_from||'')).at(-1)||null;
}
export const valueAt=(v,cutoff)=>Array.isArray(v)?scalar(at(v,cutoff)):scalar(v);
export const english=v=>typeof v==='string'?v:(v?.en??null);
export function evidence(raw,locator){return {...raw.reference,url:raw.receipt.url,retrievedAt:raw.receipt.retrievedAt,locator};}
export function event(data){
  const key=fingerprint({country:data.country,category:data.category,chamber:data.chamber,office:data.office,date:data.date,
    rounds:(data.rounds||[]).map(r=>({number:r.number??null,date:r.date??data.date,stage:r.stage??null})),
    sourceId:data.sourceId,sourceElectionId:data.sourceElectionId,tier:data.tier||'national'}).slice(0,28);
  return {id:`event-${key}`,rounds:[],tier:'national',jurisdiction:'country',resultStatus:'unknown',certificationStatus:null,
    completion:{state:'unknown',basis:null},parties:[],candidates:[],turnout:null,sourceUpdateTime:null,
    governmentFormation:null,confidence:{basis:'source-reported',independentVerification:false},review:{state:'imported-with-warning',reasons:['Machine checks are not editorial verification.']},...data};
}
export function parseIPU(batch,cutoff){
  const collections=batch.sources['ipu-parline']||[];
  const read=name=>{const c=collections.find(c=>c.entity===name);return c?validatePages(c.pages,{unique:name!=='political_parties'}):[];};
  const countries=read('countries'), parliaments=read('parliaments'), chambers=read('chambers'), elections=read('elections'), parties=read('political_parties');
  const names=new Map(); for(const p of parties){if(!names.has(p.political_party_code))names.set(p.political_party_code,new Set());names.get(p.political_party_code).add(english(p.party_name));}
  const partyNames=new Map([...names].filter(([,v])=>v.size===1).map(([id,v])=>[id,[...v][0]]));
  const locate=(entity,id)=>{const page=collections.find(c=>c.entity===entity)?.pages.find(p=>p.body.data.some(r=>(r.id||r.political_party_code)===id));return page?evidence(page.raw,`data[id=${id}]`):null;};
  const structures=chambers.map(c=>{
    const a=c.attributes, term=scalar(a.struct_parl_status)?.term;
    return {id:c.id,country:iso.alpha2ToAlpha3(c.id.slice(0,2))||null,
      category:term==='upper_chamber'?'upper-house':['lower_chamber','unicameral'].includes(term)?'legislative':null,
      term,name:english(valueAt(a.chamber_name,cutoff))||c.id,direction:valueAt(a.designation_mode,cutoff)?.term||null,
      suspended:valueAt(a.is_suspended_chamber,cutoff),abolished:valueAt(a.is_abolished_chamber,cutoff),
      lastElection:scalar(a.last_election),officialWebsite:valueAt(a.parliamentary_website_url,cutoff),
      citation:locate('chambers',c.id)};
  });
  const events=elections.map(e=>{
    const a=e.attributes,chamber=structures.find(c=>c.id===scalar(a.chamber));
    const range=scalar(a.election_date), date=day(range?.from), endDate=day(range?.to)||date;
    if(!chamber?.country||!chamber.category||!date)return null;
    const totals=scalar(a.seats_per_parties)||[];
    const firstSession=day(scalar(a.first_session_date));
    const last=day(chamber.lastElection?.from);
    const counts=totals.map(p=>({id:`ipu:${p.party}`,name:partyNames.get(p.party)||p.party,
      nameUnresolved:!partyNames.has(p.party),seats:p.total_number_of_seats??null,voteShare:null,votes:null,
      allianceMembers:null,sourcePartyId:p.party,breakdowns:p.vote_breakdown||[]}));
    const voters=scalar(a.number_of_voters),registered=scalar(a.number_registered_electors),turnout=scalar(a.turnout);
    const atElection=valueAt(chambers.find(c=>c.id===chamber.id)?.attributes.designation_mode,date+'T00:00:00.000Z')?.term||null;
    const appointment=atElection==='appointed'||(last===date&&chamber.direction==='appointed');
    const uncertainDesignation=chamber.direction==='appointed'&&atElection===null;
    const holdingStatus=appointment?'appointment':date>cutoff.slice(0,10)?'upcoming':uncertainDesignation?'unconfirmed':(last===date||firstSession||totals.length||scalar(a.display_archive_files)===true?'held':'unconfirmed');
    return event({country:chamber.country,category:chamber.category,chamber:chamber.id,office:chamber.name,direction:atElection,
      date,endDate,rounds:[{date,endDate,number:null,reason:'Round not supplied by provider'}],
      sourceId:'ipu-parline',sourceElectionId:e.id,holdingStatus,
      renewal:scalar(a.scope_of_elections)?.term||'unknown',electionKind:appointment?'appointment':'national-chamber',
      resultStatus:totals.length?'reported-results':'pending-or-missing',parties:counts,seatsAtStake:scalar(a.number_of_seats_at_stake),
      completion:{state:firstSession&&firstSession<=cutoff.slice(0,10)?'completed':'unknown',basis:firstSession?'Provider first_session_date of new legislature; certification still unknown':null},
      firstSession,turnout:turnout===null?null:{percent:turnout,numerator:voters,denominator:registered,
        definition:'voters / registered electors',denominatorKind:'registered-electors',sourceField:'turnout',includesInvalidBallots:'not explicitly supplied'},
      citations:[locate('elections',e.id)],providerSources:english(scalar(a.sources))||null,
      notes:[a.about_the_election?.value?.en||'',a.scope_of_elections?.annotation?.notes?.en||'',a.seats_per_parties?.annotation?.notes?.en||''].filter(Boolean),
      sourceAuthority:'intergovernmental provider; parliament-reported',licence:batch.registry.sources.find(s=>s.id==='ipu-parline').licence,
      latestEvidence:date===last?{checked:true,basis:'Complete IPU election index and chamber last_election assertion; independent latest-election confirmation pending',citation:chamber.citation}:null
    });
  }).filter(Boolean);
  const systems=countries.map(c=>{const p=parliaments.find(p=>p.id===c.id);return {country:scalar(c.attributes.iso_alpha3),system:valueAt(c.attributes.political_system,cutoff)?.term||null,
    subtype:valueAt(c.attributes.political_subsystem,cutoff)?.term||null,structure:valueAt(p?.attributes.structure_of_parliament,cutoff)?.term||null,
    suspended:valueAt(p?.attributes.is_suspended_parliament,cutoff),citation:locate('countries',c.id),parliamentCitation:p?locate('parliaments',p.id):null};});
  for(const c of structures){const d=day(c.lastElection?.from);if(d&&!events.some(e=>e.chamber===c.id&&e.date===d)&&c.category&&c.country)events.push(event({country:c.country,category:c.category,chamber:c.id,office:c.name,direction:c.direction,date:d,endDate:day(c.lastElection?.to)||d,
    sourceId:'ipu-parline',sourceElectionId:`last-election:${c.id}:${d}`,holdingStatus:c.direction==='appointed'?'appointment':d>cutoff.slice(0,10)?'upcoming':'held',resultStatus:'pending-or-missing',renewal:'unknown',electionKind:c.direction==='appointed'?'appointment':'national-chamber',
    citations:[c.citation],sourceAuthority:'IPU chamber last_election',licence:batch.registry.sources.find(s=>s.id==='ipu-parline').licence,
    latestEvidence:{checked:true,basis:'Provider last_election date only; results and independent freshness unconfirmed',citation:c.citation}}));}
  return {events,structures,systems,completeIndex:collections.some(c=>c.entity==='elections')&&collections.some(c=>c.entity==='chambers')};
}
export function parseFEC(batch){
  const parts=batch.sources['usa-electoral-college']||[],raw=parts.find(p=>p.key==='results')?.raw,calendar=parts.find(p=>p.key==='calendar')?.raw;
  if(!raw||!calendar)return [];
  if(calendar.bytes.subarray(0,4).toString()!=='%PDF')throw new Error('FEC registered calendar is not PDF evidence');
  const rows=xlsxRows(raw.bytes),headers=rows[0],totals=rows.find(r=>r[0]==='Total:'),shares=rows.find(r=>r[0]==='Percentage:');
  if(headers[0]!=='STATE'||headers.at(-1)!=='TOTAL VOTES'||!totals||totals[1]!==538||!shares)throw new Error('FEC national summary schema changed');
  const candidates=headers.slice(4,28).map((name,i)=>({id:`FEC:USA:2024:${name}`,name,votes:totals[i+4]??null,voteShare:shares[i+4]==null?null:shares[i+4]*100,
    elected:null,electoralVotes:name==='TRUMP'?totals[2]:name==='HARRIS'?totals[3]:null}));
  const source=batch.registry.sources.find(s=>s.id==='usa-electoral-college'),metadata=source.registeredIdentity;
  const index=parts.find(p=>p.key==='index')?.raw;
  const dates=index?[...index.bytes.toString().matchAll(/Official (20\d{2}) Presidential General Election Results/gi)].map(m=>Number(m[1])):[];
  return [event({country:'USA',category:'presidential',chamber:null,office:'President',date:metadata.date,endDate:metadata.date,direction:metadata.direction,
    rounds:[{date:metadata.date,number:null,stage:'national popular ballot; electors subsequently vote'}],sourceId:source.id,sourceElectionId:'FEC-2024-presidential-general',
    holdingStatus:'held',resultStatus:'official-final',certificationStatus:'FEC compilation of state-certified results',completion:{state:'completed',basis:'Official national compiled results'},
    candidates,totalVotes:totals.at(-1),unallocatedVotes:{noneOfThese:totals[28],scatteredWriteIns:totals[29]},
    electoralCollege:{Trump:totals[2],Harris:totals[3],total:totals[1],majorityNeeded:270,meaning:'electoral votes; never popular-vote shares'},
    citations:[evidence(raw,'OFFICIAL 2024 PRES GE RESULTS!A53:AE54'),evidence(calendar,metadata.locator)],sourceAuthority:'official government compilation',licence:source.licence,
    latestEvidence:dates.length&&Math.max(...dates)===2024?{checked:true,basis:'Latest FEC published presidential results release; election freshness beyond the release still unconfirmed',citation:evidence(index,'Election results section')}:null,
    notes:['No source-reported elected candidate in the acquired workbook. Electoral majority and popular vote totals remain separate; outcome view unavailable until declared outcome evidence is acquired.','Workbook compilation date 2025-01-16 is not an update instant with a timezone.']})];
}
export function parlGovEvents(records,licence){
  const groups=new Map();for(const r of records.filter(r=>r.tier==='national'&&r.jurisdictionLevel==='country')){
    if(!groups.has(r.electionKey))groups.set(r.electionKey,[]);groups.get(r.electionKey).push(r);
  }
  return [...groups.values()].map(rows=>{
    const r=rows[0];return event({country:r.country,category:'legislative',chamber:'lower-or-unicameral',office:r.office,date:r.electionDate,endDate:r.electionDate,
      direction:null,rounds:[{date:r.electionDate,number:null,reason:'Round absent in release'}],holdingStatus:'held',
      sourceId:r.citation.sourceId,sourceElectionId:r.electionIdentity.sourceElectionId,
      resultStatus:'historical',renewal:'unknown',electionKind:'national-chamber',seatsAtStake:r.seatSystem.total,
      parties:rows.map(p=>({id:p.partyIdentity,name:p.party,seats:p.seats,voteShare:p.voteShare,votes:p.votes,allianceMembers:null})),
      citations:rows.map(p=>p.citation),sourceAuthority:'research archive',licence,
      notes:['Unknown rounds retained. Archive maximum date is not a latest-election claim. Vote shares may span electoral systems; compare only their recorded measure.'],
      latestEvidence:null,completion:{state:'unknown',basis:null},canonicalRecords:rows.map(p=>p.id)});
  });
}
export function ukNationalEvent(records,licence){
  const rows=records.filter(r=>r.citation.sourceId==='uk-parliament-2024');if(!rows.length)return [];
  if(rows.length!==4515||new Set(rows.map(r=>r.regionKey)).size!==650||rows.some(r=>!['verified','imported-with-warning'].includes(r.review.state)))return [];
  const groups=new Map();for(const r of rows){if(!groups.has(r.partyIdentity))groups.set(r.partyIdentity,[]);groups.get(r.partyIdentity).push(r);}
  const perRegion=new Map();for(const r of rows){if(!perRegion.has(r.regionKey))perRegion.set(r.regionKey,[]);perRegion.get(r.regionKey).push(r);}
  if([...perRegion.values()].some(rs=>rs.filter(r=>r.winner===true).length!==1||rs.reduce((n,r)=>n+r.votes,0)!==rs[0].validVotes))return [];
  const total=rows.reduce((n,r)=>n+r.votes,0),first=rows[0];
  return [event({country:'GBR',category:'legislative',chamber:'House of Commons',office:'House of Commons',direction:'directly_elected',date:first.electionDate,endDate:first.electionDate,
    rounds:[{number:1,date:first.electionDate,basis:'Registered single-round FPTP convention'}],sourceId:'uk-parliament-2024',sourceElectionId:'national-aggregate-general-election-6',
    holdingStatus:'held',renewal:'full_renewal',electionKind:'national-chamber',resultStatus:'official-final',certificationStatus:null,
    completion:{state:'completed',basis:'Complete 650-constituency declared result positions; certification not independently checked'},
    parties:[...groups].map(([id,rs])=>({id,name:rs[0].party==='Independent'?`Independent: ${rs[0].candidate}`:rs[0].party,
      votes:rs.reduce((n,r)=>n+r.votes,0),voteShare:rs.reduce((n,r)=>n+r.votes,0)/total*100,seats:rs.filter(r=>r.winner===true).length,
      allianceMembers:null,jointTickets:[...new Set(rs.filter(r=>r.alliance).map(r=>r.alliance.adjunctName))],
      derivations:{votes:'SUM(candidate votes grouped by provider primary party identity)',voteShare:'party votes / SUM(all candidate votes) * 100',
        seats:'COUNT(source-reported position-1 candidates by primary party identity); registered single-member constituency system'},
      inputs:rs.map(r=>({record:r.id,region:r.regionKey,votes:r.votes,winner:r.winner}))})),seatsAtStake:650,totalVotes:total,
    citations:[{...first.citation,locator:{records:'All 4515 candidate rows; 650 constituency totals checked'}}],sourceAuthority:'official constituency declaration aggregate',licence,
    latestEvidence:null,notes:['National totals are derived explicitly from reported constituency data, not a declared national winner.','Joint tickets are grouped by the provider primary party identity; adjunct identities remain in jointTickets. Independent candidates remain separate.',
      'Turnout valid-votes/electorate is not substituted for voters/registered-electors. Source update instant and independent latest confirmation remain unknown.']})];
}
export function parseFrance(batch){
  const parts=batch.sources['france-president']||[],raw=parts.find(p=>p.key==='declaration')?.raw;
  if(!raw)return [];
  const content=text(raw.bytes.toString());
  if(!/Proclamation des résultats/.test(content)||!/24 avril 2022/.test(content))return [];
  // Parse the declaration's paragraphs, not a model transcription or vote argmax.
  const rows=[...content.matchAll(/(?:M\.?\s+|Mme\.?\s+)?(Emmanuel MACRON|Marine LE PEN)\s*:\s*([\d\s]{6,})/g)];
  const totals=new Map(rows.map(m=>[m[1],Number(m[2].replace(/\s/g,''))]));
  const elected=/Emmanuel MACRON[^.]{0,120}(?:proclamé|élu)|(?:proclame|proclamé)[^.]{0,120}Emmanuel MACRON/.test(content);
  const candidates=[...totals].map(([name,votes])=>({id:`FRA:president:2022:${name}`,name,votes,voteShare:null,elected:elected?name==='Emmanuel MACRON':null}));
  if(candidates.length!==2)throw new Error('French declaration candidate table changed; adapter review required');
  return [event({country:'FRA',category:'presidential',chamber:null,office:'President of the Republic',direction:'directly_elected',
    date:'2022-04-10',endDate:'2022-04-24',rounds:[{number:1,date:'2022-04-10'},{number:2,date:'2022-04-24',candidates}],
    holdingStatus:'held',resultStatus:'official-final',certificationStatus:'Constitutional Council proclamation',completion:{state:'completed',basis:'Source proclamation'},
    sourceId:'france-president',sourceElectionId:'2022-197-PDR',renewal:'full_renewal',candidates,citations:[evidence(raw,'Decision 2022-197 PDR, national vote table and proclamation')],
    sourceAuthority:'official declaration',licence:batch.registry.sources.find(s=>s.id==='france-president').licence,
    turnout:(()=>{const n=label=>Number(content.match(new RegExp(label+'\\s*:\\s*([\\d\\s]+)'))?.[1]?.replace(/\s/g,''));const numerator=n('Votants'),denominator=n('Électeurs inscrits');return Number.isFinite(numerator)&&denominator>0?{percent:numerator/denominator*100,numerator,denominator,definition:'voters / registered electors',denominatorKind:'registered-electors',round:2,includesInvalidBallots:true,formula:'Constitutional Council second-round Votants / Électeurs inscrits * 100'}:null;})(),
    latestEvidence:null,notes:['Ministry archive freshness index could not be acquired; latest available, latest election unconfirmed. First-round totals are retained separately when available.']})];
}
