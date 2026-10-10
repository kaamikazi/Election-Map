import path from 'node:path';
import {readJson,fingerprint} from '../ingestion/util.js';
import {replayReference} from '../ingestion/acquire.js';
import {event,evidence,day} from './adapters.js';
import {text,links,tableBlocks,withDescendants} from './html.js';
import {expandedRows} from './discovery.js';
import {textDates} from './authority-evidence.js';
import {articleStatusEvidence,scopedSentences} from './status.js';

const snak=s=>s?.datavalue?.value;
const claims=(e,p)=>(e?.claims?.[p]||[]).filter(s=>s.rank!=='deprecated'&&s.mainsnak?.snaktype==='value');
const values=(e,p)=>claims(e,p).map(s=>snak(s.mainsnak));
const normal=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const count=s=>/^\d[\d,\s]*$/.test(String(s).trim())?Number(String(s).replace(/[,\s]/g,'')):null;
const share=s=>/^\d+(?:\.\d+)?\s*%?$/.test(String(s).trim())?Number(String(s).replace('%','').trim()):null;
/** Candidate/Votes tables, one group per table, with nesting resolved. */
export function resultTableGroups(html){
  const groups=[];
  for(const block of tableBlocks(html)){
    const rows=expandedRows(block.html),header=rows.find(r=>r.some(c=>/^Candidate$/i.test(c?.text))&&r.some(c=>/^Votes$/i.test(c?.text)));
    if(!header)continue;
    const voteColumns=header.map((c,i)=>/^Votes$/i.test(c?.text)?i:-1).filter(i=>i>=0),percentColumns=header.map((c,i)=>/^(?:%|Percentage|Vote share)$/i.test(c?.text)?i:-1).filter(i=>i>=0);
    const after=rows.slice(rows.indexOf(header)+1),TOTALS=/^(?:Total|Invalid|Blank|Valid|Registered|Turnout|Abstention|Abstained|Null|Voters|Absentees|Absent|Present|Electors|Eligible|Did not vote)s?\b/i;
    // A "Candidate" heading often spans a colour swatch and the name; use the
    // spanned column that actually carries names in the body. Summary rows
    // (Total, Valid votes, ...) span every column and do not count as names.
    const spanned=header.map((c,i)=>/^Candidate$/i.test(c?.text)?i:-1).filter(i=>i>=0);
    const candidate=spanned.map(i=>[i,after.filter(r=>r[i]?.text&&r[i]!==r[i-1]&&!TOTALS.test(r[i].text)&&voteColumns.some(v=>count(r[v]?.text)!==null)).length]).sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0][0];
    const party=header.findIndex((c,i)=>/^Party$/i.test(c?.text)&&!spanned.includes(i));
    const body=after.filter(r=>r[candidate]?.text&&!TOTALS.test(r[candidate].text)&&voteColumns.some(i=>count(r[i]?.text)!==null));
    if(!body.length)continue;
    groups.push({table:block.index,rows:body.map(r=>({name:r[candidate].text.replace(/\[.*?\]/g,'').trim(),party:party>=0?r[party]?.text||null:null,
      rounds:voteColumns.map((i,k)=>({votes:count(r[i]?.text),voteShare:share(r[percentColumns[k]]?.text||''),tableColumn:i})),locator:`National Candidate/Votes table #${block.index}`}))});
  }return groups;
}
export function resultTables(html){return resultTableGroups(html).flatMap(g=>g.rows);}
/** Infobox "Elected President" cell text that says no one was elected. */
export const NO_ELECTED=/\b(?:annull?ed|cancell?ed|suspended|halted|interrupted|nullified|voided|no (?:result|winner)|named|appointed|transitional|interim|acting|vacant|pending|TBD|TBA|to be (?:determined|announced|confirmed))\b/i;
export function electedCell(html){
  return [...html.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m=>m[1]).find(b=>/Elected\s+(?:President|president|Presidency members?|head of state)\b/.test(text(b)))||null;
}
export function electedLabel(html){
  const blocks=[...html.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m=>m[1]);
  for(const block of blocks){if(!/Elected\s+(?:President|president|Presidency member|head of state)\b/.test(text(block)))continue;
    // "Elected Presidency members" lists a collective presidency (see
    // electedMembers); its first name is not the winner.
    if(/Elected\s+Presidency members\b/.test(text(block)))continue;
    // "Elected President: Election results annulled; X named Transitional
    // President" names an appointee, not an election winner.
    if(NO_ELECTED.test(text(block).replace(/^.*?Elected\s+(?:President|president|Presidency members?|head of state)\b/,'')))return null;
    const names=[...block.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map(m=>text(m[1])).filter(n=>n&&!/^President|^Elected|^King|^Party|^Independent$/.test(n));
    if(names.length)return names[0];
  }return null;
}
/** Past-tense statement that polling happened: "elections were held",
 * "held on", "took place on" or "took place in Estonia on". */
const HELD=/\b(?:elections? (?:was|were) held|held on|took place (?:in (?:the )?[A-Z][^.,;]{1,40} )?on)\b/i;
/** A discovery-table date such as "25 May 2025" or "20 Nov 2023"; only a
 * real day-month-year counts (no year-only or month-only entries). */
export function leadDay(dateText){
  const m=String(dateText||'').match(/^\s*(\d{1,2}) ([A-Za-z]{3})[a-z]*\.? (\d{4})\s*$/);if(!m)return null;
  const month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[2].toLowerCase());if(month<0)return null;
  const v=`${m[3]}-${String(month+1).padStart(2,'0')}-${m[1].padStart(2,'0')}`;return new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v?v:null;
}
/** Every word (3+ letters) of a Wikidata label appears in the article text,
 * compared without accents, case or punctuation. */
export function labelInText(label,articleNormal){
  const words=String(label||'').split(/\s+/).map(normal).filter(w=>w.length>2);
  return words.length>0&&words.every(w=>articleNormal.includes(w));
}
/** Members listed in an infobox "Elected Presidency members" row: a collective
 * head of state (e.g. one member per constituent people), not one winner. */
export function electedMembers(html){
  const block=[...html.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m=>m[1]).find(b=>/Elected\s+Presidency members\b/.test(text(b)));
  if(!block||NO_ELECTED.test(text(block).replace(/^.*?Elected\s+Presidency members\b/,'')))return [];
  return [...new Set([...block.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map(m=>text(m[1])).filter(n=>n&&!/^President|^Elected|^Party|^Independent$|^(?:Bosniak|Croat|Serb)s?$/.test(n)))];
}
const NON_PARTY=/^(?:Total|Blank|Invalid|Valid|Null|Registered|Source|Turnout|Spoilt|Abstention|Void|Rejected|Electorate|Eligible)/i;
/**
 * National party seat table of a legislative article. The table must reconcile
 * exactly to the infobox "All N seats" figure, which rules out municipal,
 * regional and upper-house tables and alliance sub-rows that double count.
 * Votes are kept only when a single Votes column exists.
 */
export function partySeatTable(html,rows){
  // The seat figure must belong to the lower/unicameral chamber: skip rows in
  // upper-house or presidential infobox sections and figures naming a senate.
  let section=null,stake=null;
  for(const r of rows){const t=r.cells[0]?.text||'';
    if(r.depth===0&&fullWidth(r)&&SECTION.test(t)){section=t;continue;}
    if(section&&(UPPER.test(section)||PRESIDENTIAL.test(section)))continue;
    const m=t.match(/\bAll ([\d,]+) seats\b(?: in (?:the )?([^.;]{0,80}))?/i);
    if(m&&!UPPER.test(m[2]||'')){stake=Number(m[1].replace(/,/g,''));break;}}
  if(!stake)return null;
  const blocks=tableBlocks(html);
  for(const block of blocks){
    if(/\binfobox\b/.test(block.attrs)||!/\bwikitable\b/.test(block.attrs))continue;
    const all=expandedRows(block.html),hi=all.slice(0,4).findIndex(r=>r.some(c=>/^Party$/i.test(c?.text))&&r.some(c=>/^(?:Total )?Seats$/i.test(c?.text)));
    if(hi<0)continue;
    // Multi-tier tables (list + constituency) carry a "Total seats" column; that
    // is the whole-chamber allocation. Per-tier columns are not mixed in.
    const header=all[hi],totalCols=header.map((c,i)=>/^Total seats$/i.test(c?.text)?i:-1).filter(i=>i>=0);
    const seatCols=totalCols.length===1?totalCols:header.map((c,i)=>/^Seats$/i.test(c?.text)?i:-1).filter(i=>i>=0),voteCols=totalCols.length?[]:header.map((c,i)=>/^Votes$/i.test(c?.text)?i:-1).filter(i=>i>=0);
    if(seatCols.length!==1)continue;
    const spanned=header.map((c,i)=>/^Party$/i.test(c?.text)?i:-1).filter(i=>i>=0),body=all.slice(hi+1);
    // Summary rows ("Total votes", "Registered voters") span the swatch column
    // too; counting them let the empty swatch column win the tie.
    const nameCol=spanned.map(i=>[i,body.filter(r=>r[i]?.text&&r[i]!==r[i-1]&&!NON_PARTY.test(r[i].text)).length]).sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0][0];
    const share=header.findIndex(c=>/^(?:%|Vote %)$/i.test(c?.text));
    const parties=[];
    for(const r of body){const name=(r[nameCol]?.text||'').replace(/\[.*?\]/g,'').trim();if(!name||NON_PARTY.test(name)||NON_PARTY.test(r[0]?.text||''))continue;
      const seats=count(r[seatCols[0]]?.text);if(seats===null)continue;
      parties.push({name,seats,votes:voteCols.length===1?count(r[voteCols[0]]?.text):null,voteShare:share>=0?Number(String(r[share]?.text||'').replace(/[^\d.]/g,''))||null:null});}
    if(!parties.length||parties.reduce((n,p)=>n+p.seats,0)!==stake)continue;
    const total=body.find(r=>/^Total votes$/i.test(r[0]?.text||'')),registered=body.find(r=>/^Registered voters/i.test(r[0]?.text||''));
    const numerator=total?count(total[voteCols[0]]?.text):null,denominator=registered?count(registered[voteCols[0]]?.text):null,percent=registered&&share>=0?Number(String(registered[share]?.text||'').replace(/[^\d.]/g,''))||null:null;
    return {table:block.index,seatsAtStake:stake,parties,turnout:numerator&&denominator&&percent?{numerator,denominator,percent,definition:'Total votes / registered voters as tabulated in the contributed article'}:null};
  }
  return null;
}
/** "Vice President of X" contains "President" but is not the presidency. */
export const presidencyOffice=name=>/president/i.test(name)&&!/\bvice[- ]?president/i.test(name);
/**
 * Infobox text for one category: each row belongs to the nearest preceding
 * full-width heading ("Bosniak member of the presidency", "House of
 * Representatives", …). Rows under the other office's headings are left out,
 * so a presidential "Reporting 96%" line does not describe the legislature.
 */
export function infoboxTextFor(rows,category){
  const presidential=/presiden|head of state/i,legislative=/\b(?:house|assembly|chamber|senate|parliament|congress|legislat|majlis|duma|sejm|diet|seats)\b/i;
  let heading='';const kept=[];
  for(const r of rows){const t=r.cells.map(c=>c?.text||'').join(' ').trim(),head=r.depth===0&&fullWidth(r)?r.cells[0]?.text||'':'';
    if(head&&head.length<80&&!/\d{4}/.test(head)&&!/%/.test(head))heading=head;
    const other=category==='presidential'?legislative.test(heading)&&!presidential.test(heading):presidential.test(heading);
    if(!other)kept.push(t);}
  return kept.join(' ');
}
/** Infobox rows with nested candidate/party tables flattened in document order. */
export function infoboxRows(html){
  const blocks=tableBlocks(html),index=blocks.findIndex(b=>/class=["'][^"']*\binfobox\b/.test(b.attrs));
  if(index<0)return [];
  return withDescendants(blocks,index).flatMap(b=>expandedRows(b.html).map(cells=>({cells,depth:b.depth-blocks[index].depth})));
}
const fullWidth=r=>r.cells.length>0&&r.cells.every(c=>c===r.cells[0]);
const SECTION=/^(?:Presidential election|Presidential|President|Legislative election|Parliamentary election|Chamber of Deputies|House of Representatives|National Assembly|Federal Senate|Senate|Congress|Parliament|Legislature|Legislative Assembly|Chamber|House of Assembly|Upper house|Lower house|National Council|Assembly of the Republic|Congress of Deputies|Plurinational Legislative Assembly|Chamber of Senators)$/i;
const PRESIDENTIAL=/presiden/i,UPPER=/senate|upper|council of states|house of lords|senators/i;
const datedRow=r=>r.depth===0&&fullWidth(r)&&textDates(r.cells[0].text).length>0;
/**
 * Polling dates for one office from an infobox. Combined general-election
 * infoboxes carry per-office sections; the dates under a presidential section
 * are the presidential rounds. A legislature without its own date row in such a
 * box was elected on the first-round polling day only.
 */
export function infoboxDates(rows,category){
  const labelled=rows.find(r=>/^(?:Election date|Date)$/i.test(r.cells[0]?.text||''));
  if(labelled)return {dates:textDates(labelled.cells.slice(1).map(c=>c.text).join(' ')),basis:'Infobox Election date row'};
  const sections=[{title:null,rows:[]}];
  for(const r of rows){const t=r.cells[0]?.text||'';if(r.depth===0&&fullWidth(r)&&SECTION.test(t))sections.push({title:t,rows:[]});else sections.at(-1).rows.push(r);}
  const dateRow=s=>s.rows.find(datedRow);
  const own=sections.slice(1).find(s=>category==='presidential'?PRESIDENTIAL.test(s.title):!PRESIDENTIAL.test(s.title)&&!UPPER.test(s.title));
  const ownRow=own&&dateRow(own);
  if(ownRow)return {dates:textDates(ownRow.cells[0].text),basis:`Infobox "${own.title}" section polling date`};
  const head=dateRow(sections[0]),combined=sections.some(s=>PRESIDENTIAL.test(s.title||''));
  if(head&&category!=='presidential'&&combined&&/first round/i.test(head.cells[0].text))
    return {dates:textDates(head.cells[0].text).slice(0,1),basis:'Combined general-election infobox: legislature dated to the first-round polling day; later rounds are presidential runoffs'};
  if(head)return {dates:textDates(head.cells[0].text),basis:'Infobox polling date row'};
  const shared=sections.slice(1).find(s=>dateRow(s));
  if(!shared)return {dates:textDates(rows.slice(0,3).flatMap(r=>r.cells.map(c=>c.text)).join(' ')),basis:'Infobox heading dates'};
  const row=dateRow(shared),all=textDates(row.cells[0].text);
  if(category!=='presidential'&&PRESIDENTIAL.test(shared.title)&&/first round/i.test(row.cells[0].text))
    return {dates:all.slice(0,1),basis:`Combined general-election infobox: legislature dated to the first-round polling day under "${shared.title}"; later rounds are presidential runoffs`};
  return {dates:all,basis:`Infobox "${shared.title}" section polling date`};
}
/**
 * Cancellation needs a statement that this election (not an earlier one it
 * mentions) was annulled, and no declared outcome. Disputes are kept with the
 * matching excerpt so a reviewer can see why.
 */
export function statusSignals(plain,year,hasOutcome,electedText=null){
  const lead=plain.slice(0,12000),signals=[];
  // Polling took place but the declared results were annulled (e.g. a coup
  // before proclamation). The event is held; its outcome is not established.
  if(electedText&&/\bresults? (?:were )?annull?ed|election annull?ed|results? (?:were )?cancell?ed|nullified\b/i.test(electedText))
    signals.push({kind:'results-annulled',excerpt:electedText.slice(0,240)});
  // "cancelled in 22 constituencies" is a partial cancellation, not the event's.
  for(const m of lead.matchAll(/[^.]{0,160}\b(?:the|this) (?:[\w-]+ ){0,4}elections? (?:was|were|has been|have been) (?:annulled|cancell?ed|voided)\b(?! in (?:\d+|some|several|many|a number of|certain) )[^.]{0,80}/gi)){
    const years=(m[0].match(/\b(?:19|20)\d\d\b/g)||[]).filter(y=>y!==year);
    signals.push({kind:years.length?'other-election-annulment':'annulment',excerpt:m[0].trim()});
  }
  const annulled=signals.find(s=>s.kind==='annulment');
  return {status:signals.some(s=>s.kind==='results-annulled')?'annulled':annulled&&!hasOutcome?'cancelled':null,signals,
    conflicts:annulled&&hasOutcome?[{kind:'annulment-statement-with-declared-outcome',excerpt:annulled.excerpt}]:[]};
}
export function articleEvent(article,raw,cutoff,licence){
  const html=JSON.parse(raw.bytes).parse.text,plain=text(html),rows=infoboxRows(html);
  let {dates,basis:dateBasis}=infoboxDates(rows,article.category);
  // Rounds after the cutoff are not held yet. The event is the held round(s);
  // a later decisive round is recorded as pending, never dropped or guessed.
  const later=dates.filter(d=>d>cutoff.slice(0,10)),allDates=dates;dates=dates.filter(d=>d<=cutoff.slice(0,10));
  if(!dates.length)return null;
  if(!HELD.test(plain.slice(0,12000)))return null;
  const elected=article.category==='presidential'?electedLabel(html):null,members=article.category==='presidential'?electedMembers(html):[];
  const nominees=rows.find(r=>/^(?:Nominee|Candidate)$/i.test(r.cells[0]?.text));
  const known=new Set([...(nominees?nominees.cells.slice(1).map(c=>normal(c.text)):[]),...(elected?[normal(elected)]:[])].filter(Boolean));
  // The national table is the one naming the most infobox nominees/winner
  // (the first on a tie); a combined article also carries party primaries,
  // governors and senators, which name only one of them.
  const groups=resultTableGroups(html),hits=g=>g.rows.filter(r=>known.has(normal(r.name))).length;
  const national=groups.filter(g=>hits(g)).sort((a,b)=>hits(b)-hits(a))[0]||(known.size?null:groups[0])||null;
  const tables=article.category==='presidential'&&national?[...national.rows]:[];
  if(article.category==='presidential'&&!tables.length&&nominees){
    const votes=rows.find(r=>/^Popular vote$|^Votes$/i.test(r.cells[0]?.text)),percent=rows.find(r=>/^Percentage$/i.test(r.cells[0]?.text)),parties=rows.find(r=>/^Party$/i.test(r.cells[0]?.text));
    for(let i=1;i<nominees.cells.length;i++){const name=nominees.cells[i]?.text?.replace(/\[.*?\]/g,'').trim();if(name&&name!==nominees.cells[i-1]?.text)tables.push({name,party:parties?.cells[i]?.text||null,rounds:[{votes:count(votes?.cells[i]?.text),voteShare:share(percent?.cells[i]?.text),roundUnstated:true}],locator:'Infobox nominee columns; round not stated'});}
  }
  const candidates=tables.map(r=>({id:`wikipedia:${article.revid}:${normal(r.name)}`,name:r.name,party:r.party,partyIdentity:null,
    votes:r.rounds.at(-1)?.votes??null,voteShare:r.rounds.at(-1)?.voteShare??null,elected:elected?normal(elected)===normal(r.name):null,roundResults:r.rounds}));
  // One person on several ballot lines (one row per nominating party) is one
  // candidate. The rows are kept; votes stay null when the lines differ, since
  // adding them could double-count a total row.
  for(let i=0;i<candidates.length;i++){const same=normal(candidates[i].name)?candidates.filter((c,k)=>k>i&&normal(c.name)===normal(candidates[i].name)):[];if(!same.length)continue;
    const all=[candidates[i],...same],votes=[...new Set(all.map(c=>c.votes))];
    candidates[i]={...candidates[i],party:[...new Set(all.map(c=>c.party).filter(Boolean))].join(' / ')||null,votes:votes.length===1?votes[0]:null,voteShare:votes.length===1?candidates[i].voteShare:null,
      sourceRows:all.map(c=>({party:c.party,votes:c.votes,voteShare:c.voteShare})),note:'Same person on several ballot lines; merged as one candidate'};
    for(const d of same)candidates.splice(candidates.indexOf(d),1);}
  if(members.length>1){for(const c of candidates)if(members.some(m=>normal(m)===normal(c.name)))c.elected=true;
    for(const m of members)if(!candidates.some(c=>normal(c.name)===normal(m)))candidates.push({id:`wikipedia:${article.revid}:${normal(m)}`,name:m,votes:null,voteShare:null,elected:true,party:null,partyIdentity:null});}
  if(elected&&!candidates.some(c=>c.elected))candidates.push({id:`wikipedia:${article.revid}:${normal(elected)}`,name:elected,votes:null,voteShare:null,elected:true,party:null,partyIdentity:null});
  // No infobox winner: a scoped lead sentence "X was (re-)elected" counts only
  // when X is a row of this event's own candidate table; the sentence is kept.
  let electedBy=elected?'infobox Elected row':null;
  if(article.category==='presidential'&&!elected&&candidates.length){
    for(const sentence of scopedSentences(plain.slice(0,12000),{year:dates[0].slice(0,4),category:'presidential'})){
      // "X was (re-)elected", "X was elected as President", "X was declared
      // the winner" or "X won the election/run-off/second round".
      const m=sentence.match(/\b([A-Z][\w.'’-]+(?: [A-Z][\w.'’-]+){1,4}) (?:(?:was|has been) (?:re-?elected|elected (?:as )?(?:the )?[Pp]resident|declared (?:the )?winner)|won the (?:presidential )?(?:election|run-?off|second round))\b/);if(!m)continue;
      const hit=candidates.find(c=>normal(c.name)===normal(m[1])||normal(m[1]).endsWith(normal(c.name))||normal(c.name).endsWith(normal(m[1])));
      if(hit&&!/\b(?:if|would|could|unless|expected)\b/i.test(sentence)){hit.elected=true;electedBy=`scoped lead sentence: "${sentence.trim().slice(0,200)}"`;break;}
    }
  }
  // A general/parliamentary election article that names no presidential
  // candidate or winner does not identify a presidential election: indirect
  // presidencies are elected by the new parliament later, on another date.
  // Nor does one stating that a body, not the voters, elects the president:
  // a tally of that vote in the article is dated to the later sitting, never
  // to the general-election polling day.
  const general=article.category==='presidential'&&/\b(?:general|parliamentary|legislative) election\b/i.test(article.title||'');
  const chosenBy=general?plain.slice(0,20000).match(/\bPresident (?:is|was|will be) (?:then |subsequently |indirectly )?(?:elected|chosen|appointed) by (?:the )?([^,.;()\[]{2,40})/i):null;
  if(chosenBy&&!/\b(?:popular|people|voters|citizens|direct|universal|vote|votes|ballot|list|lists|round|plurality|majority|system|first[- ]past|ranked|preferential|instant)\b/i.test(chosenBy[1]))
    return {skipped:true,reason:`General-election article states the president is elected by ${chosenBy[1].trim()}; that vote is held separately, so no presidential identity or date is taken from this article`};
  if(general&&!candidates.length&&!elected)
    return {skipped:true,reason:'General-election article names no presidential candidate or winner; an indirect presidency is elected separately, so no presidential identity is taken from this article'};
  // A presidential vote reported inside a general/parliamentary article (e.g.
  // in its aftermath) carries its own date; the legislature's polling day is
  // never used for it. A parliamentary article without that date is not used.
  let separateVote=null;
  // In a combined general-election article only an explicitly indirect vote
  // counts, so a direct presidency's own rounds are never collapsed.
  const parliamentary=/\b(?:parliamentary|legislative) election\b/i.test(article.title||'');
  if(general){
    const m=plain.match(new RegExp(`\\b${parliamentary?'(?:indirect )?':'indirect '}presidential election (?:was|were) held on (\\d{1,2} [A-Z][a-z]+(?:,? \\d{4})?|[A-Z][a-z]+ \\d{1,2}(?:, \\d{4})?)`,'i'));
    // "held on 14 October" without a year: the polling year, and only a day
    // on or after polling and within 120 days of it.
    let d=m?textDates(m[1])[0]||null:null;
    if(m&&!d&&!/\d{4}/.test(m[1])&&dates[0]){const y=textDates(`${m[1]} ${dates[0].slice(0,4)}`)[0];
      if(y&&y>=dates[0]&&Date.parse(y)-Date.parse(dates[0])<=120*864e5)d=y;}
    if(d&&d<=cutoff.slice(0,10)){dates=[d];separateVote={date:d,statement:m[0].trim()};dateBasis=`Separate presidential vote stated in the article: "${separateVote.statement.slice(0,160)}"`;}
    else if(parliamentary)
      return {skipped:true,reason:'Parliamentary-election article: the presidential vote is held separately and its date is not stated, so no presidential identity or date is taken from this article'};}
  const cell=electedCell(html),status=statusSignals(plain,dates[0].slice(0,4),!!elected,cell?text(cell):null);
  // The infobox "Elected President … TBD" row concerns the presidency only.
  const statusEvidence=articleStatusEvidence({infobox:infoboxTextFor(rows,article.category),lead:plain,year:dates[0].slice(0,4),category:article.category,electedCellText:article.category==='presidential'&&cell?text(cell):null});
  const seatTable=article.category==='legislative'?partySeatTable(html,rows):null;
  const parties=seatTable?seatTable.parties.map(p=>({id:`wikipedia:${article.revid}:${normal(p.name)}`,name:p.name,votes:p.votes,voteShare:p.voteShare,seats:p.seats,partyIdentity:null})):[];
  return event({country:article.country,category:article.category,chamber:article.category==='presidential'?null:'National legislature (discovery article)',
    office:article.category==='presidential'?'National presidency':'National legislature',date:dates[0],endDate:dates.at(-1),direction:/\bindirect(?:ly)? (?:presidential )?election|\belected by (?:the )?(?:parliament|national assembly|federal assembly|electoral college)\b/i.test(plain.slice(0,9000))?'indirectly_elected':null,
    ...(separateVote?{direction:'indirectly_elected'}:{}),
    ...(members.length>1?{collectivePresidency:{members,basis:'Infobox "Elected Presidency members" row: a collective presidency, not a single winner'}}:{}),
    rounds:[...dates.map(date=>({date,number:null,reason:separateVote?dateBasis:'Explicit infobox polling dates; ordinal unknown'})),...later.map(date=>({date,number:null,status:'scheduled',reason:'Later round after the cutoff'}))],pendingRound:later.length>0,sourceId:'wikipedia-latest',sourceElectionId:`${article.revid}:${article.category}`,parentSourceElectionId:String(article.revid),holdingStatus:'held',electionKind:'national-election',renewal:'unknown',
    resultStatus:status.status||(elected||candidates.some(c=>c.elected)?'reported-outcome':tables.length||parties.length?'reported-results':'pending-or-missing'),statusSignals:status.signals,statusEvidence,electedEvidence:electedBy,conflicts:status.conflicts,dateBasis,
    candidates:article.category==='presidential'?candidates:[],parties,seatsAtStake:seatTable?.seatsAtStake??null,turnout:seatTable?.turnout||null,certificationStatus:null,completion:{state:elected&&!status.status?'completed':'unknown',basis:'Contributed article outcome claim; certification not established'},
    citations:[{...evidence(raw,`Revision ${article.revid}; ${dateBasis}; ${article.category==='presidential'?`Elected President; ${national?`national Candidate/Votes table #${national.table}`:'infobox nominee columns'}`:seatTable?`party seat table #${seatTable.table} reconciling to "All ${seatTable.seatsAtStake} seats"`:'no reconciling party seat table'}`),url:`https://en.wikipedia.org/w/index.php?oldid=${article.revid}`}],
    sourceArticle:{title:article.title,revid:article.revid,revisionTime:article.revisionTime},sourceAuthority:'collaborative discovery; primary authority confirmation required',licence,
    externalReferences:[...new Set(links(html).filter(u=>/^https?:\/\//.test(u)&&!/wikipedia|wikimedia|google|doi.org/.test(u)))],latestEvidence:null,
    notes:['Cutoff-pinned contributed article reports these election facts; latest-election and authority confirmation remain open.','Before/after office-holder fields are not used to infer an electoral outcome.',
      ...(groups.length>1&&national?[`${groups.length} Candidate/Votes tables in the article; only table #${national.table} (naming the infobox nominees) is used as national results.`]:[])]});
}
/**
 * A Wikidata item and the Wikipedia revision it is linked to describe the same
 * election. When their polling dates disagree neither is authoritative, so both
 * are kept and marked; the date metric is withheld until an authority settles it.
 */
export function linkedDateConflicts(events){
  const groups=new Map();
  for(const e of events){const revid=e.sourceArticle?.revid;if(!revid)continue;const key=`${e.country}|${e.category}|${revid}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(e);}
  for(const rows of groups.values())for(const a of rows)for(const b of rows){
    if(a===b||a.sourceId===b.sourceId||(a.date===b.date&&a.endDate===b.endDate))continue;
    // Only a different first polling day makes the displayed date unreliable;
    // a different last day (e.g. an included runoff) is recorded for review.
    a.conflicts=[...(a.conflicts||[]),{kind:a.date!==b.date?'linked-date-conflict':'linked-end-date-conflict',otherId:b.id,otherSourceId:b.sourceId,dates:{this:[a.date,a.endDate],other:[b.date,b.endDate]},
      note:'Linked contributed records for the same article disagree on polling dates; authority evidence is needed'}];
  }
  return events;
}
export async function parseLatestDiscovery(root,cache,cutoff){
  const pointer=await readJson(path.join(cache,'latest-discovery.json'),null);if(!pointer)return {events:[],attempts:[],references:[],assertions:[]};
  const batch=await readJson(path.join(cache,'latest-discovery-batches',pointer.batchId+'.json'));
  if(fingerprint(batch)!==pointer.batchId||batch.cutoff!==cutoff)throw new Error('Latest discovery batch/cutoff integrity mismatch');
  const sourceRegistry=await readJson(path.join(root,'data/latest-discovery-registry.json'));
  if(fingerprint(sourceRegistry)!==batch.registryHash)throw new Error('Discovery registration changed; acquire the registered pass again');
  const entities=new Map(),rawFor=new Map(),labels=new Map();
  for(const ref of [...batch.entityReferences,...batch.labelReferences]){
    const raw=await replayReference(cache,ref),body=JSON.parse(raw.bytes);
    for(const [id,e]of Object.entries(body.entities||{})){labels.set(id,e.labels?.en?.value||id);if(e.claims&&batch.entityReferences.some(r=>r.receiptId===ref.receiptId)){entities.set(id,e);rawFor.set(id,raw);}}
  }
  const events=[],attempts=batch.countries.flatMap(c=>c.attempts),assertions=[];
  for(const country of batch.countries){
    // One general-election article/entity can be the lead for both the
    // legislature and the presidency; keep one work item per category.
    const graph=country.graphReference?JSON.parse((await replayReference(cache,country.graphReference)).bytes).results.bindings:[];
    const graphIds=new Set(graph.slice(0,12).map(r=>r.event.value.split('/').at(-1)));
    const work=new Map();
    for(const id of graphIds)work.set(`${id}|presidential`,{id,category:'presidential',linked:null});
    for(const a of country.articles.filter(a=>a.entityId)){const key=`${a.entityId}|${a.category}`;work.set(key,{id:a.entityId,category:a.category,linked:a});}
    const combined=new Set(country.articles.filter(a=>a.entityId&&country.articles.some(b=>b.entityId===a.entityId&&b.category!==a.category)).map(a=>a.entityId));
    for(const {id,category,linked} of work.values()){
      const e=entities.get(id);if(!e)continue;
      const dates=claims(e,'P585').filter(s=>snak(s.mainsnak)?.precision>=11).map(s=>({date:day(snak(s.mainsnak).time.replace(/^\+/,'')),statement:s.id,
        qualifiers:s.qualifiers||{},references:s.references||[]})).filter(d=>d.date);
      if(!dates.length){attempts.push({country:country.country,category,sourceId:'wikidata-presidential',ok:false,error:`${id}: no exact day-precision polling date; year-only dates rejected`});continue;}
      const future=dates.some(d=>d.date>cutoff.slice(0,10));let within=dates.filter(d=>d.date<=cutoff.slice(0,10)).sort((a,b)=>a.date.localeCompare(b.date));if(!within.length)continue;
      // A combined general-election entity lists runoff dates too; the
      // legislature was chosen on the first polling day.
      const firstDayOnly=category==='legislative'&&combined.has(id)&&within.length>1;if(firstDayOnly)within=within.slice(0,1);
      const scopes=values(e,'P1001').map(v=>v.id),countries=values(e,'P17').map(v=>v.id),administrative=values(e,'P131').map(v=>v.id);
      if(administrative.length||scopes.some(q=>!countries.includes(q))){attempts.push({country:country.country,category,sourceId:'wikidata-presidential',ok:false,error:`${id}: subnational/ambiguous scope excluded`,scopes,administrative});continue;}
      const officeIds=values(e,'P541').map(v=>v.id),officeNames=officeIds.map(q=>labels.get(q)||q);
      // The country query only returns items typed as a subclass of presidential
      // election (Q858439); that typing is the office evidence when P541 is absent.
      const typed=graphIds.has(id)&&!officeIds.length;
      // "Vice President of X" contains "President" but is not the presidency.
      const presidential=category==='presidential'&&(officeNames.some(presidencyOffice)||typed);
      if(category==='presidential'&&!presidential){attempts.push({country:country.country,category,sourceId:'wikidata-presidential',ok:false,error:`${id}: presidential office not established`,officeNames});continue;}
      const raw=rawFor.get(id),cites=[evidence(raw,`entities.${id}.claims`)],candidateIds=[...new Set([...values(e,'P726'),...values(e,'P991')].map(v=>v.id).filter(Boolean))];
      const winners=category==='presidential'?values(e,'P991').map(v=>v.id):[];
      let article=null,articleText='',tables=[];
      if(linked){const captured=await replayReference(cache,linked.reference);article=JSON.parse(captured.bytes).parse;
        articleText=text(article.text);tables=resultTables(article.text);cites.push({...evidence(captured,`Revision ${linked.revid}; national results/infobox`),url:`https://en.wikipedia.org/w/index.php?oldid=${linked.revid}`});}
      const declared=article?electedLabel(article.text):null,articleNormal=normal(articleText),labelSeen=name=>labelInText(name,articleNormal);
      const candidateRows=candidateIds.map(q=>{const name=labels.get(q)||q,table=tables.find(r=>normal(r.name)===normal(name));
        return {id:`wikidata:${q}`,name,party:table?.party||null,partyIdentity:null,votes:table?.rounds.at(-1)?.votes??null,voteShare:table?.rounds.at(-1)?.voteShare??null,
          // A label must be corroborated by the linked article (every word of
          // it appears there); an unmatched label (e.g. a vandalised one) is
          // kept for audit but never named as the winner.
          elected:article&&!labelSeen(name)?null:!future&&winners.length===1?q===winners[0]:declared&&normal(name)===normal(declared)?true:null,
          ...(article&&!labelSeen(name)?{labelUnconfirmed:'Wikidata label does not appear in the linked article revision'}:{}),
          roundResults:table?.rounds||[],sourceEntity:q};});
      // Election dates/classes alone do not establish that polling took place.
      const reportedHeld=!!winners.length||!!declared||tables.length>0||HELD.test(articleText.slice(0,12000));
      const cell=article?electedCell(article.text):null,signals=statusSignals(articleText,within[0].date.slice(0,4),!!winners.length||!!declared,cell?text(cell):null),disputed=signals.status;
      const statusEvidence=article?articleStatusEvidence({infobox:infoboxRows(article.text).map(r=>r.cells.map(c=>c?.text||'').join(' ')).join(' '),lead:articleText,year:within[0].date.slice(0,4),category,electedCellText:cell?text(cell):null}):{};
      const resultStatus=disputed||(future?'official-partial':candidateRows.some(c=>c.elected===true)?'reported-outcome':tables.length?'reported-results':'pending-or-missing');
      const direction=/\bindirect(?:ly)? (?:presidential )?election|\belected by (?:the )?(?:parliament|national assembly|federal assembly|electoral college)\b/i.test(articleText.slice(0,9000))?'indirectly_elected':
        /\bdirect(?:ly)? (?:presidential )?election|\belected by (?:popular vote|the people|universal suffrage)\b/i.test(articleText.slice(0,9000))?'directly_elected':null;
      const data=event({country:country.country,category,chamber:category==='legislative'?officeNames.join(' / ')||'National legislature':null,
        office:officeNames.join(' / ')|| (category==='presidential'?'National presidency':'National legislature'),direction,
        date:within[0].date,endDate:within.at(-1).date,rounds:within.map(d=>({number:null,date:d.date,statement:d.statement,qualifiers:d.qualifiers,reason:'Source round qualifiers retained; no ordinal guessed'})),
        sourceId:'wikidata-presidential',sourceElectionId:`${id}:${category}`,parentSourceElectionId:id,holdingStatus:reportedHeld?'held':'unconfirmed',electionKind:'national-election',renewal:'unknown',
        resultStatus,statusSignals:signals.signals,statusEvidence,conflicts:signals.conflicts,officeEvidence:typed?'Wikidata instance-of subclass of presidential election (Q858439) from the country query; no P541 statement':officeIds.length?'P541 office statement':null,
        ...(firstDayOnly?{dateBasis:'Combined general-election entity: legislature dated to the first polling day; later dates are runoffs'}:{}),
        candidates:category==='presidential'?candidateRows:[],parties:[],certificationStatus:null,
        completion:{state:candidateRows.some(c=>c.elected===true)&&!disputed&&!future?'completed':'unknown',basis:'Contributed source reports a successful candidate; official declaration verification remains open'},
        citations:cites,sourceAuthority:'collaborative discovery; primary authority confirmation required',licence:sourceRegistry.sources.find(s=>s.id==='wikidata-presidential').licence,
        latestEvidence:null,sourceArticle:linked?{title:linked.title,revid:linked.revid,revisionTime:linked.revisionTime}:null,
        statementReferences:claims(e,'P991').flatMap(s=>s.references||[]),rawReferenceUrls:[...new Set([...claims(e,'P991'),...claims(e,'P585')].flatMap(s=>(s.references||[]).flatMap(r=>(r.snaks?.P854||[]).map(snak))))],
        externalReferences:article?[...new Set(links(article.text).filter(u=>/^https?:\/\//.test(u)&&!/wikipedia|wikimedia|google|doi.org/.test(u)))]:[],
        notes:['Latest available discovery record; latest-election freshness and official certification remain unconfirmed.',
          'Source-reported successful candidate is an attributed contributed claim, not independently verified or inferred from largest votes.',
          ...(future?['A subsequent round/date falls after cutoff; completed outcome is excluded.']:[])]});
      events.push(data);
    }
    for(const lead of country.leads)if(!lead.articleTitles.length)assertions.push({...lead,sourceId:'wikipedia-latest',verified:false,reason:'Discovery N/A or blank is not authority evidence of non-applicability'});
    for(const a of country.articles){const raw=await replayReference(cache,a.reference),parsed=articleEvent(a,raw,cutoff,sourceRegistry.sources.find(s=>s.id==='wikipedia-latest').licence);
      // The discovery "Last" date travels with an unused article: a later
      // cycle that could not be identified still shows an older record is not the latest.
      const lead=country.leads.find(l=>l.category===a.category),leadDate=leadDay(lead?.dateText);
      const unused={country:country.country,category:a.category,sourceId:'wikipedia-latest',ok:false,title:a.title,...(leadDate?{leadDate,leadLocator:lead.locator}:{})};
      // rejected: the evidence rules (not a fetch or parse failure) refuse this
      // article for this category; archived records taken from it are dropped.
      if(parsed?.skipped)attempts.push({...unused,rejected:true,revid:a.revid,error:parsed.reason});
      else if(parsed)events.push(parsed);else attempts.push({...unused,error:'No supported exact infobox date/held-event evidence; unresolved article retained in captured evidence'});}
  }
  linkedDateConflicts(events);
  // Only the latest held / completed candidate and same-date alternatives for each
  // source category enter this pass. No historic expansion occurs. A record that
  // disagrees with a selected one about the same article's dates stays with it.
  const selected=[];for(const country of batch.countries)for(const category of ['legislative','presidential']){
    const candidates=events.filter(e=>e.country===country.country&&e.category===category).sort((a,b)=>b.endDate.localeCompare(a.endDate));
    const last=candidates.find(e=>e.holdingStatus==='held'),complete=candidates.find(e=>e.completion.state==='completed');
    const chosen=candidates.filter(e=>e.id===last?.id||e.id===complete?.id||last&&e.endDate===last.endDate);
    const linked=new Set(chosen.flatMap(e=>(e.conflicts||[]).filter(c=>/^linked-/.test(c.kind)).map(c=>c.otherId)));
    selected.push(...chosen,...candidates.filter(e=>linked.has(e.id)));
  }
  return {events:[...new Map(selected.map(e=>[e.id,e])).values()],attempts,references:batch.references,assertions,batchId:pointer.batchId,
    sourceDefinitions:sourceRegistry.sources};
}
