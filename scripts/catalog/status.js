/**
 * Evidence-based election status (status model v4).
 *
 * Facts kept separately, because they coexist:
 *   results        figures reported, by whom, and whether they are complete
 *   outcome        a reported winner / seat allocation, by whom
 *   declaration    an official declaration or proclamation (authority evidence only)
 *   certification  certification, validation or proclamation by a named body
 *   challenges     claims by parties, candidates or observers (allegations,
 *                  protests, recount requests, court filings, rejections). A
 *                  challenge records who, when and where; it changes nothing.
 *   recount        requested | ordered | active | completed. Only an ordered or
 *                  active recount by an authority withholds the outcome.
 *   annulment      whole | partial (with the affected units)
 *   suspension     an authority's suspension of results or proclamation
 *   institution    the new body convened (formation, not results)
 *
 * The primary `state` withholds an outcome only when evidence supports it:
 * incomplete counting, a decisive round still pending, an official recount or
 * suspension in force, or a whole annulment.
 *
 * Timing is separate: `effective` dates of declaration/certification, the
 * source's `published` time, and when this application `captured` it. Facts
 * that became effective after the snapshot cutoff are not applied; they are
 * listed as later developments. Evidence captured after the cutoff about a fact
 * effective before it is marked retrospective.
 */
import {textDates} from './authority-evidence.js';
export const STATES=['scheduled','held-results-unavailable','partial','reported','declared','certified','recount-or-suspension','annulled','unknown'];
/** States whose figures and outcome may be used as settled. */
export const SETTLED=['reported','declared','certified'];
/** States treated as "held, results not settled" for freshness. */
export const UNSETTLED=['held-results-unavailable','partial','recount-or-suspension','annulled'];
export const RECHECK_DAYS=14;
const tierOf=e=>String(e.sourceAuthority||'').startsWith('official')?'official':/IPU|intergovernmental|parliament/i.test(e.sourceAuthority||'')?'provider':/research archive/i.test(e.sourceAuthority||'')?'research-archive':'contributed';
const day=s=>s?String(s).slice(0,10):null;

/**
 * Sentences that concern this contest only: same event year, and no other
 * office, chamber or contest named in them.
 */
export function scopedSentences(plain,{year,category}){
  const other=category==='presidential'?/\bvice[- ]?president|\b(?:legislative|parliamentary|senate|senatorial|gubernatorial|governor|mayoral|municipal|local|regional|provincial|referendum|primar(?:y|ies)|by-election)\b/i
    :/\bpresiden|\b(?:senate|senatorial|upper house|gubernatorial|governor|mayoral|municipal|local|regional|provincial|referendum|primar(?:y|ies)|by-election)\b/i;
  // Article prose only: stop at the reference list, drop citation markers
  // ("[ 1 ]") that otherwise glue sentences together, and skip citation lines
  // (cited headlines are what other publications said, not this source).
  // A section heading ("Controversy [ edit ]") ends the sentence before it.
  const prose=String(plain).split(/\b(?:References|Notes|Citations|Sources|Footnotes)\s*\[\s*edit\s*\]/)[0].replace(/\[\s*(?:\d{1,3}|[a-z]|note \d+|citation needed)\s*\]/gi,' ').replace(/\s*\[\s*edit\s*\]\s*/gi,'. ').replace(/\s+/g,' ');
  return prose.split(/(?<=[.!?])\s+(?=[A-Z"“])/).filter(s=>{
    if(s.length>500||/\bRetrieved\b|\^|\bArchived from\b/.test(s))return false;
    const years=s.match(/\b(?:19|20)\d\d\b/g)||[];
    return !(years.length&&!years.includes(year))&&!other.test(s);
  });
}
const PARTIAL=/\bReporting \d{1,3}(?:\.\d+)?\s?%|\b\d{1,3}(?:\.\d+)?\s?% (?:of (?:the )?)?(?:polling (?:stations|units|places)|precincts|stations|votes|ballots|constituencies) (?:counted|reported|processed|tallied)\b|\b(?:counting|the count|tabulation) (?:is|remains) (?:still )?(?:ongoing|under ?way|in progress|continuing)\b|\b(?:preliminary|provisional|partial|unofficial|incomplete) (?:results|count|tall(?:y|ies)) (?:show|indicate|suggest|put|give)\b/i;
const CERTIFIED=/\b(?:results? (?:was|were|has been|have been) (?:officially )?(?:certified|validated|confirmed|proclaimed)|(?:certified|validated|proclaimed|confirmed) the (?:final |official )?results?)\b/i;
const AUTHORITY=/\b(?:court|tribunal|commission|council|board|authority|electoral|election (?:body|office)|CNE|CENI|INEC|IEC|NEC|CEC)\b/i;
const RECOUNT_ACTIVE=/\brecount (?:is|was) (?:under ?way|ongoing|in progress|being (?:held|conducted))\b/i;
const RECOUNT_ORDERED=/\b(?:ordered|orders|order(?:ed)? a|mandated|approved) (?:a )?(?:partial |full |national |manual )?recount\b|\brecount (?:was|has been|is) (?:ordered|mandated|approved)\b/i;
const RECOUNT_DONE=/\brecount (?:confirmed|upheld|was completed|concluded)\b/i;
const RECOUNT_REQUEST=/\b(?:demanded|requested|called for|sought|asked for|filed for|petitioned for) (?:a )?(?:partial |full |national |manual )?recount\b/i;
const SUSPENSION=/\b(?:suspended|halted) the (?:announcement|publication|proclamation|certification|declaration) of (?:the )?(?:final )?results?\b|\b(?:announcement|publication|proclamation|certification|declaration) of (?:the )?results? (?:is|was|has been|remains) (?:suspended|halted)\b/i;
const CHALLENGE=[
  ['rejection',/\b(?:refused|refuses|declined) to (?:accept|recogni[sz]e|concede)\b|\bresults? (?:were |was )?rejected by\b|\brejected the (?:official )?results?\b|shall not recogni[sz]e\b/i],
  ['court-filing',/\b(?:filed|lodged|submitted) (?:a |an )?(?:petition|appeal|challenge|complaint|lawsuit|case)\b|\bchallenged the results? (?:in|before|at) (?:the )?court\b/i],
  ['allegation',/\b(?:alleg(?:ed|ing|ations?)|claim(?:ed|ing)) (?:of )?(?:widespread |massive )?(?:fraud|irregularities|rigging)\b|\bciting [“"]?(?:glaring |widespread )?irregularities\b/i],
  // "was contested by seven parties" describes competition, not a challenge.
  ['challenge',/\bchallenged the results?\b|\bresults? (?:were |was |are |is )?(?:disputed|contested)\b|\bdisputed (?:election|results)\b/i],
  ['protest',/\b(?:protests?|demonstrations?) (?:against|over|erupted|broke out)\b/i]
];
const ANNUL_PARTIAL=/\b(?:annulled|cancell?ed|voided|nullified)(?: the (?:vote|results?|election))? in (\d+|some|several|a number of|certain|two|three|four|five|six|seven|eight|nine|ten) (constituencies|districts|polling (?:stations|units|places)|precincts|wards|municipalities|seats)\b|\bresults? (?:in|of|for) (\d+|some|several|two|three|four|five) (constituencies|districts|polling stations|precincts) (?:were|was) (?:annulled|cancell?ed|voided)\b/i;
const ABOUT_RESULT=/\b(?:results?|outcome|fraud|rigg(?:ed|ing)|irregularit|annul|winner|victory|vote count|tally|recogni[sz]e|concede)/i;
const PRE_ELECTION=/\b(?:candidacy|candidature|registration|nomination|signatures?|primar(?:y|ies)|plagiarism|nationality)\b/i;
const VERBS=/\b(?:demanded|requested|called for|sought|asked for|challenged|refused|refuses|declined|rejected|filed|lodged|submitted|alleged|claimed|contested|protested|declared that|said|ordered|annulled|cancell?ed)\b/;
/** Who made a claim: the agent of a passive ("contested by X") or the subject before the claim verb. */
const actorOf=s=>{
  const passive=s.match(/\b(?:by|from) (?:the )?([A-Z][\w.'’-]*(?:\s+[A-Z][\w.'’-]*){0,5}(?:\s+\([A-Z]+\))?(?:\s+(?:opposition|government|party|parties|coalition|embassy|commission|court|council|observers|mission))?)/);
  if(passive&&/\b(?:was|were|has been|have been)\b/.test(s.slice(0,passive.index)))return passive[1].trim().replace(/['’]s$/,'')||null;
  const v=s.match(VERBS);if(!v)return null;
  let subject=s.slice(0,v.index).replace(/^(?:However|Following[^,]*|After[^,]*|Subsequently|Meanwhile|Later|Initially),?\s+/i,'')
    .replace(/^(?:On|In|By|Before|During|Since|From)\s+[^,]{1,40},\s*/i,'').replace(/^(?:the|a|an)\s+/i,'').replace(/^(?:opposition |presidential )?candidate\s+/i,'')
    .replace(/,\s*who\b.*$/i,'').replace(/\s+(?:subsequently|later|then|also|immediately)$/i,'').trim().replace(/[,;:]$/,'');
  // A clause fragment ("campaign was", "decision was announced …") is not a claimant.
  if(/\b(?:was|were|is|are|has|had|been|citing)\b/i.test(subject))return null;
  // A pronoun-led subject names nobody; the claimant stays unknown rather than guessed.
  if(!subject||/^(?:he|she|they|it|this|which|who|his|her|their)\b/i.test(subject)||subject.length>80)return null;
  return subject.replace(/['’]s$/,'');
};
const claim=(type,s,locator)=>({type,actor:actorOf(s),date:textDates(s)[0]||null,locator,excerpt:s.trim().slice(0,300)});

/**
 * Status evidence from a cutoff-pinned contributed article. `infobox` is the
 * flattened infobox text of this event; `lead` the article text.
 */
export function articleStatusEvidence({infobox='',lead='',year,category,electedCellText=null}){
  const sentences=scopedSentences(lead.slice(0,12000),{year,category});
  const pick=re=>sentences.filter(s=>re.test(s));
  const box=[...String(infobox).matchAll(new RegExp(PARTIAL.source,'gi'))].map(m=>m[0]);
  const pendingWinner=electedCellText&&/\bTBD\b|\bTBA\b|to be (?:determined|announced|confirmed)|pending/i.test(electedCellText.replace(/^.*?Elected[^A-Za-z]+(?:President|Presidency members?|head of state)/i,''));
  const recount=[];
  for(const s of sentences){
    if(RECOUNT_DONE.test(s))recount.push(claim('recount-completed',s,'scoped lead sentence'));
    else if(RECOUNT_ACTIVE.test(s)&&AUTHORITY.test(s))recount.push(claim('recount-active',s,'scoped lead sentence'));
    else if(RECOUNT_ORDERED.test(s)&&AUTHORITY.test(s))recount.push(claim('recount-ordered',s,'scoped lead sentence'));
    else if(RECOUNT_REQUEST.test(s)||RECOUNT_ORDERED.test(s))recount.push(claim('recount-requested',s,'scoped lead sentence'));
  }
  const challenges=[];
  for(const s of sentences){const hit=CHALLENGE.find(([,re])=>re.test(s));if(hit&&!RECOUNT_REQUEST.test(s)&&ABOUT_RESULT.test(s)&&!PRE_ELECTION.test(s))challenges.push(claim(hit[0],s,'scoped lead sentence'));}
  return {
    partial:[...box.map(t=>({locator:'infobox',excerpt:t})),...pick(PARTIAL).map(s=>({locator:'scoped lead sentence',excerpt:s.trim().slice(0,300)}))],
    certification:pick(CERTIFIED).map(s=>({locator:'scoped lead sentence',excerpt:s.trim().slice(0,300),date:textDates(s)[0]||null})),
    recount,challenges,
    suspension:pick(SUSPENSION).filter(s=>AUTHORITY.test(s)).map(s=>claim('suspension',s,'scoped lead sentence')),
    partialAnnulment:pick(ANNUL_PARTIAL).map(s=>{const m=s.match(ANNUL_PARTIAL);return {...claim('partial-annulment',s,'scoped lead sentence'),units:m?`${m[1]||m[3]} ${m[2]||m[4]}`:null};}),
    winnerPending:pendingWinner?[{locator:'infobox elected row',excerpt:electedCellText.slice(0,200)}]:[]
  };
}

export function classifyStatus(e,cutoff){
  const ev=e.statusEvidence||{},tier=tierOf(e),rs=e.resultStatus,cutoffDay=day(cutoff);
  const elected=(e.candidates||[]).filter(c=>c.elected===true);
  const seated=(e.parties||[]).filter(p=>Number.isFinite(p.seats));
  const allocated=seated.length>0&&e.seatsAtStake>0&&seated.reduce((n,p)=>n+p.seats,0)===e.seatsAtStake;
  const candidateFigures=(e.candidates||[]).some(c=>Number.isFinite(c.votes)||Number.isFinite(c.voteShare));
  const partialEvidence=rs==='official-partial'||(ev.partial||[]).length>0;
  const laterDevelopments=[];
  const effectiveBy=(date,what)=>{if(date&&cutoffDay&&date>cutoffDay){laterDevelopments.push({fact:what,effective:date,note:'Became effective after the snapshot cutoff; not applied to this snapshot'});return false;}return true;};

  // Results: figures reported, by whom, complete or not.
  const results=partialEvidence?{state:'partial',reportedBy:tier}
    :rs==='official-final'||rs==='historical'||allocated||(candidateFigures&&(elected.length||e.derivedOutcome))?{state:'complete',reportedBy:tier,basis:allocated?'Seat allocation reconciles to the seats at stake':rs==='official-final'?'Registered official final results':rs==='historical'?'Research archive of final results':'Candidate figures with a reported outcome'}
    :seated.length||candidateFigures?{state:'reported-unreconciled',reportedBy:tier,basis:'Figures reported but they do not reconcile to a complete result'}
    :{state:'none'};
  // Outcome reported by a source (not yet an official declaration).
  const outcome=(ev.winnerPending||[]).length?{state:'pending',reportedBy:tier,basis:'Source lists the winner as not yet determined'}
    :elected.length===1?{state:'reported',reportedBy:tier,winner:elected[0].name}
    :e.collectivePresidency&&elected.length>1?{state:'reported',reportedBy:tier,members:elected.map(c=>c.name),basis:'Collective presidency'}
    :e.derivedOutcome?.complete?{state:'derived',reportedBy:tier,winner:e.derivedOutcome.elected,rule:e.derivedOutcome.rule}
    :allocated?{state:'reported',reportedBy:tier,basis:'Complete seat allocation'}:{state:'none'};
  // Declaration: an official act or authority publication only.
  let declaration={state:'not-captured'};
  if(e.declaration&&effectiveBy(day(e.declaration.date),'declaration'))declaration={...e.declaration,state:e.declaration.state||'declared'};
  else if(tier==='official'&&rs==='official-final')declaration={state:'declared',by:e.sourceAuthority.replace(/^official: /,''),basis:e.completion?.basis||'Registered official final results publication'};
  // Certification: only what a source states, effective by the cutoff.
  const cert=e.certificationStatus;let certification={state:'not-reported'};
  if(cert){const date=typeof cert==='object'?day(cert.date):null;if(effectiveBy(date,'certification'))certification={state:'certified',by:typeof cert==='object'?cert.by||null:String(cert),date,basis:typeof cert==='object'?cert.state||null:String(cert)};}
  else if((ev.certification||[]).length){const c=ev.certification[0];if(effectiveBy(c.date,'certification'))certification={state:'certified',by:null,date:c.date||null,basis:'Scoped source sentence',evidence:ev.certification};}
  // Recount and challenges: who, what, when; only an authority's ordered or active recount has effect.
  const recounts=(ev.recount||[]).filter(r=>effectiveBy(r.date,r.type));
  const order=['recount-active','recount-ordered','recount-completed','recount-requested'];
  const top=recounts.sort((a,b)=>order.indexOf(a.type)-order.indexOf(b.type))[0];
  const recount=top?{state:top.type.replace('recount-',''),evidence:recounts}:rs==='recount'?{state:'active',evidence:[{locator:'provider status',excerpt:rs}]}:{state:'none-reported'};
  const challenges=(ev.challenges||[]).filter(c=>effectiveBy(c.date,c.type));
  const suspension=(ev.suspension||[]).filter(c=>effectiveBy(c.date,'suspension'));
  const annulment=['annulled','cancelled'].includes(rs)?{scope:'whole',evidence:e.statusSignals||[]}:(ev.partialAnnulment||[]).length?{scope:'partial',units:ev.partialAnnulment.map(a=>a.units).filter(Boolean),evidence:ev.partialAnnulment}:{scope:'none'};
  const institution=e.firstSession?{formed:e.firstSession<=cutoffDay,firstSession:e.firstSession,basis:'Provider first_session_date: the new body convened. This is institutional formation, not results, declaration or certification.'}:null;
  const pendingRound=(e.pendingRound||rs==='official-partial')&&(e.rounds||[]).some(r=>r.date&&r.date>cutoffDay);

  let state,withheldBecause=null;
  if(annulment.scope==='whole'){state='annulled';withheldBecause='Results annulled';}
  else if(e.holdingStatus==='upcoming'||(e.date&&e.date>cutoffDay))state='scheduled';
  else if(['ordered','active'].includes(recount.state)||suspension.length){state='recount-or-suspension';withheldBecause=suspension.length?'Official suspension of results in force':`Official recount ${recount.state}`;}
  else if(pendingRound){state='partial';withheldBecause='Decisive round still pending at the cutoff';}
  // A winner reported on an incomplete displayed count (e.g. "Reporting 99.29%"
  // beside "Elected President X") stands; the figures stay labelled partial.
  else if(outcome.state==='pending'||(results.state==='partial'&&!['reported','derived'].includes(outcome.state))){state='partial';withheldBecause='Counting incomplete or winner not yet determined';}
  else if(certification.state==='certified'&&(declaration.state==='declared'||outcome.state!=='none'||results.state==='complete'))state='certified';
  else if(declaration.state==='declared')state='declared';
  else if(outcome.state!=='none'||results.state==='complete'||results.state==='reported-unreconciled')state='reported';
  else if(e.holdingStatus==='held')state='held-results-unavailable';
  else state='unknown';

  // Timing: effective, published, captured; retrospective evidence flagged.
  const captured=(e.citations||[]).map(c=>c.retrievedAt).filter(Boolean).sort();
  const published=e.sourceArticle?.revisionTime||e.sourceUpdateTime||null;
  const timing={effective:{polling:day(e.endDate||e.date),declaration:day(declaration.date)||null,certification:certification.date||null},published,
    captured:{first:captured[0]||null,last:captured.at(-1)||null},
    retrospective:!!cutoff&&captured.some(t=>t>cutoff)?'Evidence captured after the cutoff; it describes facts effective on or before the cutoff':null};
  const recent=!!day(e.endDate||e.date)&&!!cutoffDay&&(Date.parse(cutoffDay)-Date.parse(day(e.endDate||e.date)))/864e5<RECHECK_DAYS&&day(e.endDate||e.date)<=cutoffDay;
  return {state,withheldBecause,results,outcome,declaration,certification,recount,challenges,suspension,annulment,institution,
    partial:state==='partial'?{evidence:ev.partial?.length?ev.partial:[{locator:'provider status',excerpt:pendingRound?'Later round after the cutoff':rs}]}:null,
    caveats:[...(results.state==='partial'&&state!=='partial'?['figures from an incomplete count; outcome reported']:[]),...challenges.map(c=>`${c.type}${c.actor?` by ${c.actor}`:''}${c.date?` (${c.date})`:''}`),...(recount.state==='requested'?['recount requested (not ordered)']:[]),...(annulment.scope==='partial'?[`partial annulment: ${annulment.units.join(', ')||'some units'}`]:[])],
    timing,laterDevelopments,
    freshnessCheck:recent?{required:true,reason:`Polled within ${RECHECK_DAYS} days of the cutoff; recheck count, declaration and certification`}:{required:false}};
}
