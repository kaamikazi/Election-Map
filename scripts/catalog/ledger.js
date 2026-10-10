import iso from 'i18n-iso-countries';
import {metrics,selectLatest} from './metrics.js';
export const CATEGORIES=['legislative','presidential','upper-house'];
export function worldProof(world,country,registeredName=null){
  const code=iso.alpha3ToNumeric(country),allMatches=[...world.countryCodes].filter(([,n])=>n===String(code).padStart(3,'0'));
  const matches=allMatches.length>1?allMatches.filter(([name])=>name===registeredName):allMatches;
  return matches.length===1?{layer:'world',key:matches[0][0],sha256:world.hash,vintage:world.vintage,
    ...(allMatches.length>1?{resolution:'Exact registered national name and ISO numeric code; other same-code features excluded',excludedFeatures:allMatches.filter(([name])=>name!==matches[0][0]).map(([name])=>name)}:{}),
    displayPurpose:'Schematic national statistics on the repository modern country-outline layer; no historical border or constituency claim',mode:'schematic'}:null;
}
export function buildLedger({jurisdictions,events,ipu,attempts,cutoff,world,research=[]}){
  return jurisdictions.map(j=>{
    const system=ipu.systems.find(s=>s.country===j.iso3),chambers=ipu.structures.filter(c=>c.country===j.iso3&&!c.abolished);
    const categories=Object.fromEntries(CATEGORIES.map(category=>{
      const selected=selectLatest(events.filter(e=>e.country===j.iso3&&e.category===category),cutoff);
      const matching=chambers.filter(c=>c.category===category);
      let applicability='unknown',institution='unknown',reason='Institution applicability not established by acquired evidence';
      if(category==='presidential'&&system?.subtype?.includes('monarchy')){applicability='no-applicable-election';institution='monarchy';reason='IPU political subsystem reports a monarchy; no presidential contest substituted with a royal appointment';}
      else if(category==='upper-house'&&system?.structure==='unicameral'){applicability='no-applicable-election';institution='unicameral';reason='IPU parliament structure reports one chamber';}
      else if(matching.length){applicability='applicable';institution=matching.every(c=>c.suspended)||system?.suspended===true?'suspended':matching.every(c=>c.direction==='appointed')?'appointed':'elected-or-mixed';reason=institution==='appointed'?'IPU reports appointed membership; missing election is not a zero-result contest':institution==='suspended'?'IPU reports suspended institution; historical elections remain distinct':'IPU chamber registration';}
      else if(selected.held){applicability='applicable';institution='elected';reason='Held election evidence acquired';}
      const e=selected.held,m=e?metrics(e):{};
      // Outcome attribution: the selected record may hold official totals without
      // a winner statement while a same-contest alternative reports the winner.
      // The outcome then comes from that alternative, and says so.
      const alternatives=events.filter(x=>selected.alternatives.includes(x.id)&&x.id!==e?.id&&x.date===e?.date);
      const outcomeEvent=category!=='presidential'||!e?null:m.presidential?.eligible?e:alternatives.find(x=>metrics(x).presidential.eligible)||null;
      // Same attribution for a figure the selected record lacks: turnout reported
      // by a same-contest record (e.g. IPU beside a contributed seat table).
      const turnoutEvent=!e||m.turnout?.eligible?null:alternatives.find(x=>metrics(x).turnout.eligible)||null;
      const failed=attempts.filter(a=>!a.ok&&(a.sourceId==='ipu-parline'||a.sourceId===e?.sourceId));
      const status=applicability==='no-applicable-election'?applicability:institution==='suspended'?'suspended-institution':institution==='appointed'?'appointed-institution':e?(e.status?.state||e.resultStatus):failed.length?'acquisition-failure':'missing-evidence';
      const searched=[...attempts.filter(a=>a.sourceId==='ipu-parline'||a.sourceId===e?.sourceId),...research.map(s=>({sourceId:s.id,url:s.url,ok:false,state:s.state,reason:s.reason}))];
      return [category,{category,applicability,institution,reason,direction:e?.direction||matching[0]?.direction||null,
        latestHeld:e?{id:e.id,date:e.date,endDate:e.endDate,office:e.office,chamber:e.chamber,sourceId:e.sourceId,renewal:e.renewal}:null,
        latestCompleted:selected.completed?{id:selected.completed.id,date:selected.completed.date,endDate:selected.completed.endDate}:null,
        latestClaim:{checked:selected.latestChecked,independentlyConfirmed:selected.independentlyConfirmedLatest,
          label:selected.latestChecked?'Provider latest-election assertion checked; independent freshness unconfirmed':e?'Latest available; latest election unconfirmed':'Latest election unconfirmed',
          basis:e?.latestEvidence?.basis||selected.reason},selectionAlternatives:selected.alternatives,conflicts:[...(selected.conflicts||[]),...(e?.conflicts||[])],
        resultStatus:e?.resultStatus||null,certificationStatus:e?.certificationStatus||null,status,
        // Evidence-based status v3: declaration, certification and dispute kept apart.
        resultState:e?.status?{state:e.status.state,withheldBecause:e.status.withheldBecause,results:e.status.results,outcome:e.status.outcome,declaration:e.status.declaration,certification:e.status.certification,
          recount:e.status.recount,challenges:e.status.challenges,suspension:e.status.suspension,annulment:e.status.annulment,institution:e.status.institution,partial:e.status.partial,caveats:e.status.caveats,
          timing:e.status.timing,laterDevelopments:e.status.laterDevelopments,freshnessCheck:e.status.freshnessCheck}:null,
        resultsAcquired:!!e&&(e.parties.length>0||e.candidates.length>0||!!e.turnout),
        outcomeEventId:outcomeEvent?.id||null,outcomeFromAlternative:!!outcomeEvent&&outcomeEvent.id!==e?.id,turnoutEventId:turnoutEvent?.id||null,
        eligibleMetrics:[...new Set([...Object.entries(m).filter(([,v])=>v.eligible).map(([name])=>name),...(outcomeEvent&&outcomeEvent.id!==e?.id?['presidential']:[]),...(turnoutEvent?['turnout']:[])])],metricReasons:Object.fromEntries(Object.entries(m).filter(([,v])=>!v.eligible).map(([name,v])=>[name,v.reason])),
        geometry:worldProof(world,j.iso3,j.name),sourcesSearched:searched,citations:[...(e?.citations||[]),...(matching.map(c=>c.citation)),...(system?.citation?[system.citation]:[]),...(j.evidence?.url?[j.evidence]:[])],
        missingInformation:[...(!e?['Held election identity']:[]),...(!selected.latestChecked?['Latest-election confirmation']:[]),...(e&&!e.certificationStatus?['Certification status']:[]),...(e&&!e.sourceUpdateTime?['Source update instant']:[]),...Object.values(m).filter(v=>!v.eligible).map(v=>v.reason)],
        nextAction:applicability==='no-applicable-election'?'Recheck sourced institutional classification on the next snapshot':institution==='appointed'?'Recheck designation; do not invent an election':failed.length?'Retry registered failed source; compare national declarations':!e?'Find national electoral authority evidence of the last held election':'Check national declaration and current authority index; resolve missing metrics or freshness before claiming complete coverage'}];
    }));
    return {...j,cutoffUtc:cutoff,asiaDhakaDate:new Date(Date.parse(cutoff)+6*3600000).toISOString().slice(0,10),categories};
  });
}
export function ledgerCounts(ledger){
  const core=ledger.filter(j=>j.scope==='core');
  return {coreJurisdictions:core.length,supplementaryJurisdictions:ledger.length-core.length,
    categories:Object.fromEntries(CATEGORIES.map(category=>{const entries=core.map(j=>j.categories[category]);return [category,{
      entries:entries.length,identityEstablished:entries.filter(e=>e.latestHeld).length,latestClaimChecked:entries.filter(e=>e.latestClaim.checked).length,
      independentlyConfirmedLatest:entries.filter(e=>e.latestClaim.independentlyConfirmed).length,completedIdentity:entries.filter(e=>e.latestCompleted).length,
      evidencedLatestClaim:entries.filter(e=>e.latestClaim.establishedWithEvidence).length,
      freshness:Object.fromEntries([...new Set(entries.map(e=>e.freshness||'unclassified'))].sort().map(f=>[f,entries.filter(e=>(e.freshness||'unclassified')===f).length])),
      resultsAcquired:entries.filter(e=>e.resultsAcquired).length,geometryAvailable:entries.filter(e=>e.geometry).length,
      metricEligible:Object.fromEntries(['date','seats','vote','presidential','turnout','majority'].map(m=>[m,entries.filter(e=>e.eligibleMetrics.includes(m)).length])),
      states:Object.fromEntries([...new Set(entries.map(e=>e.status))].sort().map(s=>[s,entries.filter(e=>e.status===s).length]))}];}))};
}
export function historyReport(jurisdictions,events){
  return jurisdictions.map(j=>{const recorded=events.filter(e=>e.country===j.iso3),rows=recorded.filter(e=>e.holdingStatus==='held');const dates=[...new Set(rows.map(e=>e.date))].sort(),allDates=recorded.map(e=>e.date).sort();
    return {country:j.iso3,name:j.name,scope:j.scope,recordedEvents:recorded.length,events:rows.length,holdingUnconfirmed:recorded.filter(e=>e.holdingStatus==='unconfirmed').length,
      appointedRenewals:recorded.filter(e=>e.holdingStatus==='appointment').length,earliestRecorded:allDates[0]||null,latestRecorded:allDates.at(-1)||null,distinctDates:dates.length,earliest:dates[0]||null,latest:dates.at(-1)||null,
      sourceRanges:[...new Set(rows.map(e=>e.sourceId))].map(sourceId=>{const d=rows.filter(e=>e.sourceId===sourceId).map(e=>e.date).sort();return {sourceId,events:d.length,earliest:d[0],latest:d.at(-1)};}),
      eligibleMetrics:Object.fromEntries(['date','seats','vote','presidential','turnout'].map(m=>[m,rows.filter(e=>metrics(e)[m].eligible).length])),
      gaps:['Coverage is source-bounded; intervals without records do not prove no election.',...(rows.some(e=>e.rounds.some(r=>r.number===null))?['Some rounds unknown']:[])],coveredDates:dates};});
}
