/** Metric eligibility is independent of a missing winner and of editorial verification. */
import {classifyStatus,SETTLED} from './status.js';
/** The evidence-based status; the engine stamps it with the snapshot cutoff. */
export const statusOf=e=>e.status||classifyStatus(e,null);
const ok=(value,inputs,formula,limitations=[])=>({eligible:true,value,inputs,formula,limitations});
const no=reason=>({eligible:false,value:null,reason});
export function rankMetric(e,field){
  if(e.holdingStatus!=='held')return no('Election not established as held');
  const st=statusOf(e);
  if(!SETTLED.includes(st.state))return no(st.state==='partial'?'Partial count: figures shown only as labelled partial results; no largest party is asserted':st.withheldBecause||`Result status: ${st.state}`);
  if(e.renewal==='partial_renewal'||e.electionKind==='by-election')return no('Partial renewal/by-election totals do not describe the whole chamber');
  const rows=e.parties||[];
  if(!rows.length||rows.some(r=>r[field]===null||r[field]===undefined||!Number.isFinite(r[field])||r[field]<0))return no(`Missing or invalid ${field} among recorded parties`);
  if(field==='seats'&&rows.some(r=>!Number.isInteger(r.seats)))return no('Seat counts must be integers; fractional values require source review');
  if(new Set(rows.map(r=>r.id)).size!==rows.length)return no('Duplicate party identity');
  if(rows.some(r=>r.allianceMembers?.some(id=>rows.some(other=>other.id===id))))return no('Alliance and component party overlap; double counting unresolved');
  if(e.mixedTiers)return no('Mixed electoral tiers; no common ranking denominator');
  const total=rows.reduce((n,r)=>n+r[field],0);
  if(field==='seats'&&(!(e.seatsAtStake>0)||total!==e.seatsAtStake))return no('Party seats do not reconcile to seats at stake; incomplete/uncontested/reserved seats require review');
  if(field==='voteShare'&&(total<98||total>102))return no('Recorded shares are incomplete or overlap; cannot establish a largest party across all contestants');
  const maximum=Math.max(...rows.map(r=>r[field])), tied=rows.filter(r=>r[field]===maximum);
  const value={partyIds:tied.map(r=>r.id),names:tied.map(r=>r.name),maximum,tie:tied.length>1};
  return ok(value,rows.map(r=>({id:r.id,name:r.name,value:r[field]})),`argmax(${field}) over non-overlapping recorded parties; ties retained`,
    ['Derived ranking, not a declared election winner or a governing coalition.',...(st.caveats||[]).map(c=>`Caveat: ${c}`),...(field==='voteShare'?['Largest by the provider recorded share; tiers/ballot definitions may differ across countries.']:[])]);
}
export function metrics(e){
  const largestSeats=rankMetric(e,'seats'),largestVote=rankMetric(e,'voteShare');
  const elected=(e.candidates||[]).filter(c=>c.elected===true);
  const st=statusOf(e),turnout=e.turnout, majority=largestSeats.eligible?ok({majority:largestSeats.value.maximum>e.seatsAtStake/2,threshold:Math.floor(e.seatsAtStake/2)+1},
    {seats:largestSeats.value.maximum,total:e.seatsAtStake},'largest party seats > seats at stake / 2',['Seat majority in this election only; no government formation inference.']):no(largestSeats.reason);
  return {
    date:e.holdingStatus!=='held'?no('Upcoming or unconfirmed held status'):(e.conflicts||[]).some(c=>c.kind==='linked-date-conflict')?no('Linked contributed records disagree on polling dates'):ok(e.date,{date:e.date,endDate:e.endDate},'source election date; varying dates per country'),
    seats:largestSeats,vote:largestVote,majority,
    // A leading candidate in a partial count is never an elected winner.
    presidential:e.category!=='presidential'?no('Not a presidential contest'):
      (e.holdingStatus==='held'&&elected.length===1&&SETTLED.includes(st.state)?ok(elected[0],{declared:elected[0].id,outcome:st.outcome,declaration:st.declaration},st.declaration.state==='declared'?'officially declared elected candidate':'source-reported elected candidate',
        ['Popular-vote leader and Electoral College outcome remain distinct.',
         ...(st.declaration.state!=='declared'?[`Elected candidate reported by a ${st.outcome.reportedBy} source; official declaration${st.certification.state==='certified'?'':' and certification'} not captured.`]:[]),
         ...(st.caveats||[]).map(c=>`Caveat: ${c}; the reported outcome stands unless an authority acts on it.`)]):
      // A derived outcome needs the rule and complete inputs from the source, and
      // stays labelled as derived rather than reported.
      e.holdingStatus==='held'&&!elected.length&&SETTLED.includes(st.state)&&e.derivedOutcome?.complete&&e.derivedOutcome.rule?ok({name:e.derivedOutcome.elected,derived:true},e.derivedOutcome.inputs,`derived: ${e.derivedOutcome.method}`,
        [`Derived under ${e.derivedOutcome.rule}; the source does not itself declare the winner.`,...(st.caveats||[]).map(c=>`Caveat: ${c}`)]):
        no(st.state==='partial'?'Partial count: no winner declared':st.withheldBecause||(e.collectivePresidency?`Collective presidency: ${e.collectivePresidency.members.length} members elected (${e.collectivePresidency.members.join(', ')}); no single winner`:'No single source-reported elected candidate in settled results'))),
    // Partial figures stay available, labelled, without becoming a ranking.
    partialCount:st.state!=='partial'?no('Not a partial count'):(()=>{const rows=(e.parties?.length?e.parties:e.candidates||[]).filter(r=>Number.isFinite(r.votes)||Number.isFinite(r.voteShare)||Number.isFinite(r.seats));
      if(!rows.length)return no('Partial count without figures');const key=rows.every(r=>Number.isFinite(r.votes))?'votes':rows.every(r=>Number.isFinite(r.voteShare))?'voteShare':'seats';
      const top=Math.max(...rows.map(r=>r[key]??-1)),leaders=rows.filter(r=>r[key]===top);
      return ok({leading:leaders.map(r=>r.name),field:key,value:top,evidence:st.partial?.evidence||[]},rows.map(r=>({name:r.name,value:r[key]})),'leader in the partial count as reported',['Partial count: not a declared winner, largest party or final share.']);})(),
    // A reported turnout figure stays usable when only seat results are missing;
    // it is withheld for incomplete counts, annulment and recounts in force.
    turnout:['partial','scheduled','annulled','recount-or-suspension'].includes(st.state)||st.results?.state==='partial'?no(`Turnout not final: result status ${st.results?.state==='partial'?'partial count':st.state}`):turnout&&Number.isFinite(turnout.percent)&&turnout.percent>=0&&turnout.percent<=100&&Number.isFinite(turnout.numerator)&&turnout.numerator>=0&&Number.isFinite(turnout.denominator)&&turnout.denominator>0&&turnout.definition&&
      Math.abs(turnout.numerator/turnout.denominator*100-turnout.percent)<0.1?ok(turnout.percent,turnout,'reported turnout checked against source numerator / denominator',['Comparison only within the same recorded denominator definition.']):no('Missing/inconsistent turnout numerator, denominator or definition')
  };
}
export const PROXIMITY_DAYS=90;
export function selectLatest(events,cutoff){
  const held=events.filter(e=>e.holdingStatus==='held'&&e.date<=cutoff.slice(0,10)&&!['by-election','rerun-only'].includes(e.electionKind)&&e.resultStatus!=='cancelled');
  const authority=e=>e.sourceAuthority?.startsWith('official')?0:/IPU|intergovernmental/i.test(e.sourceAuthority||'')?1:/research archive/i.test(e.sourceAuthority||'')?2:3;
  // Within one date and authority tier, a record carrying results outranks an
  // empty one for the same contest; the id tie-break used to pick the empty one.
  const content=e=>(e.parties?.length||e.candidates?.length||e.turnout?1:0)+(e.completion?.state==='completed'?1:0);
  // Same contest (same dates): a record carrying results comes first, then the
  // stronger authority. An empty provider record must not hide reported
  // results; both identities stay listed as alternatives.
  // Seat or candidate figures count; a turnout figure alone does not outrank a
  // same-contest record that carries the actual seat or vote results.
  const has=e=>((e.parties||[]).some(p=>Number.isFinite(p.seats)||Number.isFinite(p.votes))||(e.candidates||[]).some(c=>Number.isFinite(c.votes)||c.elected===true))?1:0;
  const sorted=held.sort((a,b)=>(b.endDate||b.date).localeCompare(a.endDate||a.date)||(a.date===b.date?has(b)-has(a):0)||authority(a)-authority(b)||content(b)-content(a)||b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
  let latest=sorted[0]||null,conflicts=[];
  // A contributed record dated shortly after the newest provider/official record
  // is far more often the same contest with a disputed or mis-parsed date than a
  // new national election. It must not displace the record that carries the
  // results; both stay visible as an unresolved date conflict.
  const strong=sorted.find(e=>authority(e)<=2);
  if(latest&&strong&&authority(latest)>2){
    // Only a differing date is a conflict; an identical-date record is the same
    // contest and is ordered by the results-first rule above.
    const sameDates=e=>e.date===strong.date&&(e.endDate||e.date)===(strong.endDate||strong.date);
    const near=sorted.filter(e=>authority(e)>2&&!sameDates(e)&&(Date.parse(e.date)-Date.parse(strong.endDate||strong.date))/864e5<=PROXIMITY_DAYS&&(e.endDate||e.date)>=(strong.endDate||strong.date));
    if(near.includes(latest)){conflicts=near.map(e=>({kind:'cross-source-date-proximity',otherId:e.id,otherSourceId:e.sourceId,dates:{selected:[strong.date,strong.endDate||strong.date],other:[e.date,e.endDate||e.date]},
      note:`Contributed record within ${PROXIMITY_DAYS} days of the provider record; treated as conflicting dates for the same contest, not a newer election`}));latest=strong;}
  }
  const tied=latest?sorted.filter(e=>e.date===latest.date):[];
  return {held:latest,alternatives:[...new Set([...tied.map(e=>e.id),...conflicts.map(c=>c.otherId)])],conflicts,completed:sorted.find(e=>e.completion.state==='completed'&&(e.endDate||e.date)<=cutoff.slice(0,10))||null,
    reason:latest?`Most recent held event in searched providers as of ${cutoff}; same-date alternatives prefer official evidence, retain each source identity and differences`:'No held identity established from acquired sources',
    latestChecked:!!latest?.latestEvidence?.checked,independentlyConfirmedLatest:!!latest?.latestEvidence?.independent};
}
/** Only explicit provider event linkage groups rounds; same-year similarity does not. */
export function groupRounds(events){
  const groups=new Map();for(const e of events){const key=e.parentEventId?JSON.stringify([e.country,e.category,e.office,e.chamber,e.direction,e.sourceId,e.parentEventId]):e.id;
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(e);}
  return [...groups.values()].map(rows=>{if(rows.length===1)return rows[0];rows.sort((a,b)=>(a.endDate||a.date).localeCompare(b.endDate||b.date));
    const last=rows.at(-1);return {...last,id:`group:${last.sourceId}:${last.parentEventId}`,date:rows[0].date,endDate:last.endDate||last.date,
      rounds:rows.flatMap(r=>r.rounds),citations:rows.flatMap(r=>r.citations),grouping:{basis:'Explicit provider parentEventId',members:rows.map(r=>r.id)}};});
}
