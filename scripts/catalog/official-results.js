/**
 * Registered official results and official category indexes.
 *
 * Acquisition captures each registered resource once (immutable receipts);
 * parsing always runs from captured bytes, so a corrected parser re-reads the
 * same evidence. Parsers only report what the publication states: an elected
 * candidate needs the authority's own marker or sentence, never the largest
 * vote, and unknown figures stay null.
 */
import path from 'node:path';
import {readJson,json,immutable,atomic,fingerprint} from '../ingestion/util.js';
import {replayReference} from '../ingestion/acquire.js';
import {cachedResource,boundedMap} from './acquire.js';
import {event,evidence} from './adapters.js';
import {text,tableBlocks} from './html.js';
import {expandedRows} from './discovery.js';
import {textDates} from './authority-evidence.js';
import {pdfPages} from './pdf.js';
const FRENCH=['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
/** "10 décembre 2025" → 2025-12-10. */
export function frenchDates(content){
  const out=new Set();
  for(const m of String(content).matchAll(/\b(\d{1,2})(?:er)? (janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre) ((?:19|20)\d\d)\b/gi)){
    const v=`${m[3]}-${String(FRENCH.indexOf(m[2].toLowerCase())+1).padStart(2,'0')}-${m[1].padStart(2,'0')}`;if(new Date(v).toISOString().slice(0,10)===v)out.add(v);}
  return [...out].sort();
}
const SPANISH=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
/** "14 de diciembre de 2025" → 2025-12-14. */
export function spanishDates(content){
  const out=new Set();
  for(const m of String(content).matchAll(/\b(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre) de ((?:19|20)\d\d)\b/gi)){
    const v=`${m[3]}-${String(SPANISH.indexOf(m[2].toLowerCase())+1).padStart(2,'0')}-${m[1].padStart(2,'0')}`;if(new Date(v).toISOString().slice(0,10)===v)out.add(v);}
  return [...out].sort();
}

const SOURCE={id:'official-results',cacheHours:168};
const GERMAN_MONTHS=['jänner','februar','märz','april','mai','juni','juli','august','september','oktober','november','dezember'];
/** "9. Oktober 2022" → 2022-10-09 (also "Januar"). */
export function germanDates(content){
  const out=new Set();
  for(const m of String(content).matchAll(/\b(\d{1,2})\.\s*(Jänner|Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s+((?:19|20)\d\d)\b/gi)){
    const name=m[2].toLowerCase()==='januar'?'jänner':m[2].toLowerCase(),i=GERMAN_MONTHS.indexOf(name);if(i<0)continue;
    const v=`${m[3]}-${String(i+1).padStart(2,'0')}-${m[1].padStart(2,'0')}`;if(new Date(v).toISOString().slice(0,10)===v)out.add(v);
  }return [...out].sort();
}
/** Space/nbsp-grouped integers ("1 975 056"). */
const spaced=s=>{const t=String(s??'').replace(/[\s ]/g,'');return /^\d+$/.test(t)?Number(t):null;};
/** Dot-grouped integers ("2.299.590"). */
const dotted=s=>{const t=String(s??'').trim();return /^\d{1,3}(?:\.\d{3})*$/.test(t)?Number(t.replace(/\./g,'')):null;};
const decimal=s=>{const t=String(s??'').trim().replace(',','.');return /^\d+(?:\.\d+)?$/.test(t)?Number(t):null;};
const pageText=raw=>text(raw.bytes.toString('utf8'));
const official=(src,data)=>event({tier:'national',sourceId:src.id,sourceAuthority:`official: ${src.authority}`,holdingStatus:'held',electionKind:'national-election',
  licence:{name:src.terms,url:src.resources[0].url},latestEvidence:null,...data});

export const PARSERS={
  'cze-volby-president'(src,raws){
    // One registered results page per election (prez2013, prez2018, prez2023, …).
    const raw=Object.values(raws)[0],html=raw.bytes.toString('utf8'),plain=text(html),election=(raw.receipt.url.match(/prez(\d{4})/)||[])[1]||'unknown';
    const held=plain.match(/held on ([^.]*?\d{4})/i),dates=held?textDates(held[1].replace(/&ndash;/g,'–')):[];
    if(!dates.length)throw new Error('No polling date statement on the captured page');
    // Tables are found by content, not ids: the summary has the round rows, the
    // candidate table the numbered (*/+) candidate rows.
    const blocks=tableBlocks(html),roundRow=r=>/^(?:The )?(?:1st|2nd) round$/i.test(r[0]?.text||'');
    const summary=blocks.find(b=>expandedRows(b.html).filter(roundRow).length===2),table=blocks.find(b=>expandedRows(b.html).some(r=>/^\*\d+$/.test(r[0]?.text||'')));
    if(!summary||!table)throw new Error('Expected a two-round summary table and a candidate table with an elected (*) row');
    const rounds=expandedRows(summary.html).filter(roundRow).map(r=>({label:r[0].text,wards:spaced(r[1]?.text),processedPercent:decimal(r[3]?.text),
      electorate:spaced(r[4]?.text),issued:spaced(r[5]?.text),turnoutPercent:decimal(r[6]?.text),returned:spaced(r[7]?.text),valid:spaced(r[8]?.text)}));
    if(rounds.length!==2||rounds.some(r=>r.electorate===null||r.issued===null))throw new Error('Round summary rows unreadable');
    const rows=expandedRows(table.html).filter(r=>/^[*+]?\d+$/.test(r[0]?.text||''));
    const candidates=rows.map(r=>{const r2=spaced(r[6]?.text);return {id:`volby:prez${election}:${r[0].text.replace(/[*+]/,'')}`,name:r[1].text,party:r[2]?.text||null,partyMembership:r[3]?.text||null,partyIdentity:null,
      elected:r[0].text.startsWith('*'),advanced:/^[*+]/.test(r[0].text),votes:r2??spaced(r[4]?.text),voteShare:r2!==null?decimal(r[7]?.text):decimal(r[5]?.text),
      roundResults:[{round:1,votes:spaced(r[4]?.text),voteShare:decimal(r[5]?.text)},...(r2!==null?[{round:2,votes:r2,voteShare:decimal(r[7]?.text)}]:[])]};});
    if(candidates.filter(c=>c.elected).length!==1)throw new Error('Expected exactly one candidate marked elected (*)');
    const final=rounds[1],processed=rounds.every(r=>r.processedPercent===100);
    return {events:[official(src,{country:'CZE',category:'presidential',office:'President of the Czech Republic',chamber:null,direction:'directly_elected',
      date:dates[0],endDate:null,sourceElectionId:`prez${election}`,renewal:'not-applicable',
      rounds:[{number:1,date:dates[0],endDate:dates.at(-1),turnout:{numerator:rounds[0].issued,denominator:rounds[0].electorate,percent:rounds[0].turnoutPercent}},
        {number:2,date:null,reason:'Second-round polling dates are not stated on the captured result page',turnout:{numerator:final.issued,denominator:final.electorate,percent:final.turnoutPercent}}],
      resultStatus:processed?'official-final':'official-partial',certificationStatus:null,candidates,parties:[],
      turnout:{numerator:final.issued,denominator:final.electorate,percent:final.turnoutPercent,definition:'Issued envelopes / voters in the electoral roll, second (decisive) round',round:2},
      completion:{state:processed?'completed':'unknown',basis:`Official result table marks the elected candidate (*); ${processed?'100% of wards processed':'not all wards processed'}`},
      citations:[evidence(raw,'Voting result: summary table pe2_t1 (both rounds) and candidate table pe2_t2; "*" marks the elected candidate')],
      asOfCutoff:`The captured page reports the ${processed?'completed':'incomplete'} ${election} count (${processed?'100% of wards processed':'not all wards processed'}); the result predates the cutoff.`,
      notes:['Official results of the Czech Statistical Office for the State Election Commission.','Second-round polling dates are not on the captured page and remain unknown; the event end date is not asserted.']})]};
  },
  'cze-volby-index'(src,raws,cutoff){
    const raw=raws['cze-volby-index'],plain=pageText(raw),year=Number(cutoff.slice(0,4));
    const years=label=>{const m=plain.match(new RegExp(label+'((?:\\s+(?:19|20)\\d\\d)+)'));return m?m[1].trim().split(/\s+/).map(Number).filter(y=>y<=year):[];};
    return {indexes:[{country:'CZE',category:'presidential',years:years('President of the Czech Republic'),label:'President of the Czech Republic',raw},
      {country:'CZE',category:'legislative',years:years('Chamber of Deputies'),label:'Chamber of Deputies',raw}].filter(i=>i.years.length)};
  },
  'aut-bmi-president'(src,raws){
    const raw=raws['aut-bp2022-start'],plain=pageText(raw);
    // "Bundespräsidentenwahl am 9. Oktober 2022" names polling day; the same
    // phrase followed by "festgestellt" is the result determination date.
    const dates=[...new Set([...plain.matchAll(/Bundespräsidentenwahl am (\d{1,2}\.\s*[A-Za-zä]+\s+\d{4})(?!\s+festgestellt)/g)].flatMap(m=>germanDates(m[1])))];
    if(dates.length!==1)throw new Error(`Expected one polling date statement, found ${dates.length}`);
    const certified=plain.match(/Bundeswahlbehörde hat das amtliche Endergebnis der Bundespräsidentenwahl am (\d{1,2}\.\s*[A-Za-zä]+\s+\d{4}) festgestellt/);
    const electorate=plain.match(/Wahlberechtigte ([\d.]+) Wahlbeteiligung ([\d,]+)\s*% abgegebene Stimmen ([\d.]+)/);
    // National totals: the Bundesländer table carries a national row; read the
    // table whose header lists the candidates.
    const html=raw.bytes.toString('utf8'),blocks=tableBlocks(html);
    const t=blocks.map(b=>expandedRows(b.html)).find(rows=>rows.some(r=>r.some(c=>/Van der Bellen/.test(c?.text||'')))&&rows.some(r=>/^(?:Österreich|Gesamt)/i.test(r[0]?.text||'')));
    if(!t)throw new Error('No national results row in the captured tables');
    const head=t.find(r=>r.some(c=>/Van der Bellen/.test(c?.text||''))),total=t.find(r=>/^(?:Österreich|Gesamt)/i.test(r[0]?.text||''));
    const names=[...new Set(head.slice(1).map(c=>c?.text).filter(Boolean))];
    const candidates=names.map((name,i)=>({id:`bmi:bp2022:${i+1}`,name,party:null,partyIdentity:null,elected:null,votes:dotted(total[1+i*2]?.text),voteShare:decimal(String(total[2+i*2]?.text||'').replace('%','')),roundResults:[]}));
    if(candidates.some(c=>c.votes===null))throw new Error('Candidate vote cells unreadable');
    const valid=plain.match(/gültige Stimmen?\s+([\d.]+)/);
    return {events:[official(src,{country:'AUT',category:'presidential',office:'Federal President of Austria',chamber:null,direction:'directly_elected',
      date:dates[0],endDate:dates[0],sourceElectionId:'bp2022',renewal:'not-applicable',rounds:[{number:1,date:dates[0]}],
      resultStatus:'official-final',certificationStatus:certified?{state:'official-final-result-determined',by:'Bundeswahlbehörde (Federal Electoral Board)',date:germanDates(certified[1])[0]||null}:null,
      candidates,parties:[],validVotes:valid?dotted(valid[1]):null,
      turnout:electorate?{numerator:dotted(electorate[3]),denominator:dotted(electorate[1]),percent:decimal(electorate[2]),definition:'Votes cast including invalid (abgegebene Stimmen) / eligible voters (Wahlberechtigte)'}:null,
      completion:{state:'unknown',basis:'Official final result determined; the captured page does not state who was elected, and no winner is inferred from the vote ranking'},
      citations:[evidence(raw,'Bundespräsidentenwahl 2022: polling date, Ergebnis nach Bundesländern national row, Federal Electoral Board determination statement')],
      asOfCutoff:`Official final result determined${certified&&germanDates(certified[1])[0]?` on ${germanDates(certified[1])[0]}`:''}; predates the cutoff.`,
      notes:['Official BMI publication of the Federal Electoral Board result.','The page gives national candidate totals but no explicit elected statement; the elected field stays unknown.']})]};
  },
  'aut-bmi-index'(src,raws,cutoff){
    const year=Number(cutoff.slice(0,4)),years=(raw,re)=>[...new Set([...pageText(raw).matchAll(re)].map(m=>Number(m[1])))].filter(y=>y<=year).sort((a,b)=>b-a);
    return {indexes:[{country:'AUT',category:'presidential',years:years(raws['aut-bp-index'],/Bundespräsidentenwahl ((?:19|20)\d\d)/g),label:'Bundespräsidentenwahlen',raw:raws['aut-bp-index']},
      {country:'AUT',category:'legislative',years:years(raws['aut-nr-index'],/Nationalratswahl ((?:19|20)\d\d)/g),label:'Nationalratswahlen',raw:raws['aut-nr-index']}].filter(i=>i.years.length)};
  },
  'chl-tricel-president'(src,raws){
    // Two court documents: the first-round declaration (no absolute majority,
    // runoff between two named candidates) and the proclamation after the runoff.
    const first=pageText(raws['chl-tricel-first-round']),proc=pageText(raws['chl-tricel-proclamation']);
    const r1=first.match(/elección presidencial verificada con fecha (\d{1,2} de \w+ de \d{4})/i),runoff=first.match(/segunda votación \(balotaje\), circunscrita a los candidatos que obtuvieron las dos más altas mayorías relativas en el proceso: (Doña|Don) (.+?) (Doña|Don) (.+?) II\./);
    const r2=proc.match(/comicios celebrados el (\d{1,2} de \w+ de \d{4}), en segunda votación/i),declared=proc.match(/declarándose electo al señor ([A-ZÁÉÍÓÚÑ][\wáéíóúñ]+(?: [A-ZÁÉÍÓÚÑ][\wáéíóúñ]+){0,4})/),
      proclaimed=proc.match(/audiencia pública y solemne celebrada el (?:\w+ )?(\d{1,2} de \w+ de \d{4})[^.]*?proclamó al ciudadano señor ([^.]+?) como Presidente Electo/i);
    if(!r1||!r2||!declared||!proclaimed||!runoff)throw new Error('Expected first-round declaration, runoff candidates, runoff date and proclamation');
    const d1=spanishDates(r1[1])[0],d2=spanishDates(r2[1])[0],dp=spanishDates(proclaimed[1])[0];
    const names=[runoff[2].trim(),runoff[4].trim()],winner=names.find(n=>n.includes(declared[1].split(' ')[0])&&n.includes(declared[1].split(' ').at(-1)));
    if(!winner)throw new Error('Proclaimed person is not one of the runoff candidates');
    return {events:[official(src,{country:'CHL',category:'presidential',office:'President of the Republic of Chile',chamber:null,direction:'directly_elected',
      date:d1,endDate:d2,sourceElectionId:'presidential-2025',renewal:'not-applicable',
      rounds:[{number:1,date:d1,outcome:'No absolute majority (Constitution art. 26); runoff ordered'},{number:2,date:d2}],
      resultStatus:'official-final',certificationStatus:{state:'qualified-and-proclaimed',by:'Tribunal Calificador de Elecciones',date:dp},
      declaration:{state:'declared',source:'official',basis:'Acta de Proclamación: "declarándose electo" by the Tribunal Calificador de Elecciones'},
      candidates:names.map((name,i)=>({id:`tricel:2025:${i+1}`,name,party:null,partyIdentity:null,elected:name===winner,votes:null,voteShare:null,roundResults:[{round:2,votes:null,voteShare:null}]})),
      parties:[],turnout:null,completion:{state:'completed',basis:'Proclamation of the President-elect'},
      citations:[evidence(raws['chl-tricel-proclamation'],'News of the proclamation: runoff date, "declarándose electo"'),evidence(raws['chl-tricel-first-round'],'First-round official results declaration: runoff candidates')],
      asOfCutoff:`Proclamation dated ${dp}; predates the cutoff.`,
      notes:['Vote counts are in the Actas de Declaración (PDF) and are not read here; votes stay null.','Only the two runoff candidates are listed; first-round candidates are not.']})]};
  },
  'usa-fec-electoral-votes'(src,raws){
    // Official FEC compilation: state electoral votes per candidate and the
    // stated threshold. The elected candidate is DERIVED from those, under the
    // threshold the same document states; it is labelled as derived.
    const raw=raws['usa-fec-2024-pdf'],pages=pdfPages(raw.bytes),p1=pages[0]?.text.replace(/\s+/g,' ')||'';
    const dateText=(p1.match(/General Election Date: ?([\d\/ ]+?) ?Source/)?.[1]||'').replace(/ /g,''),date=dateText.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);const header=[...p1.matchAll(/ELECTORAL VOTES CAST FOR ([A-Z][A-Z. ]+?) \((\w)\)/g)];
    const total=p1.match(/Total: ?(\d+) (\d+) (\d+) Total Electoral Votes Needed to Win = (\d+)/);
    if(!date||header.length!==2||!total)throw new Error('Expected election date, two electoral-vote columns and the stated threshold');
    const d=`${date[3]}-${date[1].padStart(2,'0')}-${date[2].padStart(2,'0')}`,[all,a,b,need]=total.slice(1).map(Number);
    if(a+b!==all)throw new Error('Electoral votes do not reconcile to the total');
    const cands=header.map((h,i)=>({id:`fec:2024:${i+1}`,name:h[1].trim(),party:h[2],partyIdentity:null,elected:null,electoralVotes:[a,b][i],votes:null,voteShare:null,roundResults:[]}));
    const winners=cands.filter(c=>c.electoralVotes>=need);
    return {events:[official(src,{country:'USA',category:'presidential',office:'President of the United States',chamber:null,direction:'indirectly_elected',electorate:'Electoral College',
      date:d,endDate:d,sourceElectionId:'pres-2024-electoral-votes',renewal:'not-applicable',rounds:[{number:1,date:d}],resultStatus:'official-final',certificationStatus:null,
      candidates:cands,parties:[],turnout:null,completion:{state:winners.length===1?'completed':'unknown',basis:'Derived from complete official electoral-vote totals'},
      derivedOutcome:winners.length===1?{elected:winners[0].name,method:'electoral votes ≥ threshold stated in the source',rule:`"Total Electoral Votes Needed to Win = ${need}" (same document)`,inputs:{total:all,[cands[0].name]:a,[cands[1].name]:b},complete:a+b===all}:null,
      citations:[evidence(raw,'PDF page 1: state electoral votes table, totals and "Total Electoral Votes Needed to Win"')],
      asOfCutoff:`FEC compilation of certified ${date[3]} results; predates the cutoff.`,
      notes:['The elected candidate is derived from electoral votes under the stated threshold; the FEC table itself does not declare a winner.','Popular-vote totals are published separately and do not determine the outcome.']})]};
  },
  'che-parlament-president'(src,raws){
    // Parliament news dispatch of the election by the United Federal Assembly,
    // and the Parliament's archive table of presidents by administrative year.
    const news=pageText(raws['che-president-2026-news']),archive=pageText(raws['che-president-archive']);
    const stamp=news.match(/(?:Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche) (\d{1,2} \S+ \d{4}), \d{1,2}h\d{2}/),date=stamp?frenchDates(stamp[1])[0]:null;
    const result=news.match(/([A-ZÉ][\wé'-]+(?: [A-ZÉ][\wé'-]+){1,3}) présidera la Confédération helvétique en (\d{4})\. L'Assemblée fédérale l'a élu \w+ par (\d+) voix sur (\d+) bulletins valables/);
    if(!date||!result)throw new Error('Expected the dispatch date and "élu … par N voix sur M bulletins valables"');
    const year=Number(result[2]),row=archive.match(new RegExp(`${year}\\s*Président(?:e)? de la Confédération\\s*(.+?)\\s+[A-Z][A-Z-]+\\s+[A-Z]{2}\\s+[A-Z]{3,5}\\s+(\\d+)`));
    const years=[...new Set([...archive.matchAll(/((?:19|20)\d\d)\s*Président(?:e)? de la Confédération/g)].map(m=>Number(m[1])))].sort((a,b)=>b-a);
    // The name comes from the Parliament's archive row; the dispatch must name
    // the same person with the same vote total.
    const name=row?.[1].trim();
    if(!row||Number(row[2])!==Number(result[3])||!news.includes(`${name} présidera`))throw new Error('Archive row for the administrative year does not match the dispatch');
    return {events:[official(src,{country:'CHE',category:'presidential',office:`President of the Swiss Confederation (${year})`,chamber:null,direction:'indirectly_elected',electorate:'United Federal Assembly',
      date,endDate:date,sourceElectionId:`president-${year}`,renewal:'not-applicable',rounds:[{number:1,date}],resultStatus:'official-final',certificationStatus:null,
      declaration:{state:'declared',by:'United Federal Assembly (reported on the Parliament website)',date,basis:`"L'Assemblée fédérale l'a élu … par ${result[3]} voix sur ${result[4]} bulletins valables"`},
      candidates:[{id:`parlament.ch:president:${year}`,name,party:null,partyIdentity:null,elected:true,votes:Number(result[3]),voteShare:null,roundResults:[{round:1,votes:Number(result[3])}]}],
      validVotes:Number(result[4]),parties:[],turnout:null,completion:{state:'completed',basis:'Election by the United Federal Assembly'},
      citations:[evidence(raws['che-president-2026-news'],`Dispatch of ${stamp[1]}: "élu … par ${result[3]} voix sur ${result[4]} bulletins valables"`),evidence(raws['che-president-archive'],`Archive table row ${year}: Président de la Confédération, ${result[3]} voix`)],
      asOfCutoff:`Election on ${date}; predates the cutoff.`,
      notes:['The President of the Confederation chairs the collegial Federal Council for one administrative year; elected by the Federal Assembly, not by popular vote.','The Parliament website republishes the news-agency (ATS) dispatch; the archive table is the Parliament\'s own record.']})],
      indexes:[{country:'CHE',category:'presidential',years,yearOffset:1,label:'Parliament archive of presidents of the Confederation (administrative years)',raw:raws['che-president-archive']}]};
  },
  'are-fsc-president'(src,raws){
    const raw=raws['are-fsc'],plain=pageText(raw);
    const m=plain.match(/([A-Z][^.]{3,140}?) is the President of the United Arab Emirates[^.]*\.\s*He was elected on (\d{1,2} \w+ \d{4}) by (?:a )?decision of the members of the Federal Supreme Council/i);
    if(!m)throw new Error('No Federal Supreme Council election statement on the captured page');
    const date=textDates(m[2])[0];if(!date)throw new Error('Election date unreadable');
    const name=m[1].replace(/^(?:His Highness|H\.\s*H\.)\s*/i,'').trim();
    return {events:[official(src,{country:'ARE',category:'presidential',office:'President of the United Arab Emirates',chamber:null,direction:'indirectly_elected',electorate:'Federal Supreme Council (rulers of the seven emirates)',
      date,endDate:date,sourceElectionId:`fsc-${date}`,renewal:'not-applicable',rounds:[{number:1,date}],resultStatus:'official-final',certificationStatus:null,
      candidates:[{id:`u.ae:president:${date}`,name,party:null,partyIdentity:null,elected:true,votes:null,voteShare:null,roundResults:[]}],parties:[],turnout:null,
      completion:{state:'completed',basis:'Official portal states the election by decision of the Federal Supreme Council on this date'},
      citations:[evidence(raw,'The Federal Supreme Council: "He was elected on … by decision of the members of the Federal Supreme Council"')],
      asOfCutoff:`Statement describes the election of ${date}; retrieved after the cutoff.`,
      notes:['Indirect election by the Federal Supreme Council; no popular vote exists, so votes and shares are not applicable rather than missing.']})]};
  }
};

export async function acquireOfficialResults(root,options={}){
  const registry=await readJson(path.join(root,'data/official-results.json'));
  const cutoff=options.cutoff||(await readJson(path.join(root,'data/catalog-execution.json'))).executionStartUtc,cache=options.cache||path.join(root,'data/raw/elections');
  const attempts=[],references=[];
  const items=registry.sources.flatMap(src=>src.resources.map(resource=>({src,resource})));
  const results=await boundedMap(items,async({src,resource})=>cachedResource(SOURCE,{key:resource.key,url:resource.url},{root,cache,timeoutMs:30000,retries:2,maxBytes:20*1024*1024,notBefore:cutoff,...options}),3);
  results.forEach((r,i)=>{const {src,resource}=items[i];
    attempts.push({sourceId:src.id,country:src.country,category:src.category||src.categories.join('+'),url:resource.url,ok:r.ok,error:r.error||null,authority:src.authority,
      checkTime:r.ok?(r.value.capture?.retrievedAt||r.value.receipt.retrievedAt):new Date().toISOString(),reference:r.ok?r.value.reference:null,key:resource.key});
    if(r.ok)references.push(r.value.reference);});
  const payload={version:1,cutoff,registryHash:fingerprint(registry),references,attempts};
  const batchId=fingerprint(payload);
  await immutable(path.join(cache,'official-batches',`${batchId}.json`),json(payload));
  await atomic(path.join(cache,'official-results.json'),json({batchId}));
  return {batchId,...payload};
}
/** Replays the captured batch and runs every registered parser on it. */
export async function replayOfficialResults(root,cache,cutoff){
  const pointer=await readJson(path.join(cache,'official-results.json'),null);
  if(!pointer)return {events:[],indexes:[],attempts:[],references:[],sourceDefinitions:[]};
  const batch=await readJson(path.join(cache,'official-batches',`${pointer.batchId}.json`));
  if(fingerprint(batch)!==pointer.batchId)throw new Error('Official results batch integrity mismatch');
  if(batch.cutoff!==cutoff)return {events:[],indexes:[],attempts:[],references:[],sourceDefinitions:[],stale:`Official batch belongs to ${batch.cutoff}`};
  const registry=await readJson(path.join(root,'data/official-results.json'));
  if(fingerprint(registry)!==batch.registryHash)throw new Error('Official results registry changed; acquire again');
  const events=[],indexes=[],attempts=[...batch.attempts];
  for(const src of registry.sources){
    const refs=batch.references.filter(r=>src.resources.some(x=>x.key===r.key));
    if(refs.length!==src.resources.length){attempts.push({sourceId:src.id,country:src.country,ok:false,stage:'parse',error:'Not every registered resource was captured; parser not run'});continue;}
    const raws=Object.fromEntries(await Promise.all(refs.map(async r=>[r.key,{...await replayReference(cache,r),checkedAt:batch.attempts.find(a=>a.key===r.key&&a.ok)?.checkTime||null}])));
    try{const out=PARSERS[src.parser](src,raws,cutoff);events.push(...(out.events||[]));indexes.push(...(out.indexes||[]).map(i=>({...i,sourceId:src.id,authority:src.authority})));
      attempts.push({sourceId:src.id,country:src.country,ok:true,stage:'parse',parser:src.parser,events:(out.events||[]).length,indexes:(out.indexes||[]).length});}
    catch(e){attempts.push({sourceId:src.id,country:src.country,ok:false,stage:'parse',parser:src.parser,error:e.message});}
  }
  for(const u of registry.attemptedUnsupported||[])attempts.push({sourceId:'official-results',country:u.country,category:u.category,url:u.url,ok:false,error:u.outcome,alternative:u.alternative,authority:u.authority});
  return {events,indexes,attempts,references:batch.references,batchId:pointer.batchId,
    sourceDefinitions:registry.sources.map(s=>({id:s.id,provider:s.authority,licence:{name:s.terms},url:s.resources[0].url}))};
}
/**
 * An official complete category index establishes the selected event as the
 * latest when the newest listed election (by the cutoff) is the selected
 * event's, and the index lists a single election in that year.
 */
export function indexAssertions(ledger,indexes,cutoff){
  const out=[],audit=[];
  for(const idx of indexes){
    const c=ledger.find(j=>j.iso3===idx.country)?.categories[idx.category];const held=c?.latestHeld;
    const latest=Math.max(...idx.years),sameYear=idx.years.filter(y=>y===latest).length;
    const base={country:idx.country,category:idx.category,sourceId:idx.sourceId,url:idx.raw.receipt.url,checkTime:idx.raw.checkedAt||idx.raw.receipt.retrievedAt,reference:idx.raw.reference,authority:idx.authority};
    if(!held){audit.push({...base,ok:true,assessment:`Official index lists ${latest} as the newest election; no held identity selected to compare`});continue;}
    const heldYear=Number(held.date.slice(0,4))+(idx.yearOffset||0);
    if(heldYear!==latest||sameYear!==1){audit.push({...base,ok:true,assessment:`Official index newest year ${latest} does not match the selected event (${held.date}); freshness not established`});continue;}
    out.push({country:idx.country,category:idx.category,eventId:held.id,date:held.date,kind:'latest-established',checked:true,authority:idx.authority,lineage:`primary:${idx.sourceId}`,
      basis:`Official ${idx.label} index (complete category list by year) lists ${latest} as the most recent election by the cutoff; the selected event is the ${latest} election (${held.date})`,
      checkedAt:idx.raw.checkedAt||idx.raw.receipt.retrievedAt,citation:evidence(idx.raw,`${idx.label}: listed election years ${idx.years.join(', ')}`),rule:'official-category-index-by-year'});
    audit.push({...base,ok:true,assessment:'qualifying-latest-evidence'});
  }
  return {assertions:out,audit};
}
