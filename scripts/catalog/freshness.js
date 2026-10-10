/**
 * Primary-evidence state is separate from result/metric/reviewer state.
 *
 * Freshness states (latest-election-evidence-standard v2):
 * - latest-established: captured authority evidence supports the selected event
 *   as the latest held by the cutoff. One authority suffices.
 * - latest-corroborated: as above, and a second qualifying assertion from a
 *   different evidence lineage (not a copy of the first) agrees.
 * - latest-available-unconfirmed: a held record exists; nothing checked that no
 *   newer event was held.
 * - newer-held-results-pending: the latest held record has no settled results.
 * - unknown: no held identity.
 * - sourced-non-applicability: a constitutional/authority source says the
 *   category has no national election.
 */
export const FRESHNESS_STATES=['latest-corroborated','latest-established','latest-available-unconfirmed','newer-held-results-pending','unknown','sourced-non-applicability'];
import {UNSETTLED} from './status.js';
function laterCycle(c){
  const held=c.latestHeld&&(c.latestHeld.endDate||c.latestHeld.date);
  const a=held&&c.sourcesSearched.find(a=>a.sourceId==='wikipedia-latest'&&!a.ok&&a.leadDate&&a.leadDate>held);
  return a?{date:a.leadDate,title:a.title,locator:a.leadLocator,reason:a.error}:null;
}
export function applyFreshness(ledger,{attempts=[],assertions=[],strictNonApplicability=true}={}){
  for(const j of ledger)for(const category of ['legislative','presidential']){
    const c=j.categories[category],primary=assertions.filter(a=>a.country===j.iso3&&a.category===category);
    c.sourcesSearched.push(...attempts.filter(a=>a.country===j.iso3&&a.category===category));
    const nonApplicable=primary.find(a=>a.kind==='sourced-non-applicability');
    // The authority states the latest election by its polling date; it supports
    // whichever selected record carries that date (source identities differ).
    const matching=primary.filter(a=>['latest-established','latest-corroboration'].includes(a.kind)&&!!c.latestHeld&&a.date===c.latestHeld.date);
    const established=matching.find(a=>a.kind==='latest-established');
    // Corroboration must come from a different lineage than the establishing
    // authority; a mirror of the same publication is the same lineage.
    const corroboration=established?matching.find(a=>a!==established&&a.lineage&&a.lineage!==established.lineage&&!(a.derivedFrom||[]).includes(established.lineage)):null;
    c.provisionalInstitutionAssertion={applicability:c.applicability,institution:c.institution,reason:c.reason};
    if(c.applicability==='no-applicable-election'&&strictNonApplicability&&!nonApplicable){
      c.applicability='unknown';c.status='missing-evidence';c.reason='Provider/discovery non-applicability assertion is not yet verified by a category-specific constitutional/authority source';
      c.missingInformation.push('Primary non-applicability evidence');c.nextAction='Verify the institutional category with a registered constitutional or national authority source';
    }
    if(nonApplicable){c.applicability='no-applicable-election';c.institution=nonApplicable.institution||c.institution;c.status='no-applicable-election';c.freshness='sourced-non-applicability';
      c.reason=nonApplicable.assertion||c.reason;c.nonApplicabilityEvidence=nonApplicable;c.citations.push(nonApplicable.citation);
      c.missingInformation=c.missingInformation.filter(m=>!['Held election identity','Latest-election confirmation'].includes(m));c.nextAction='Recheck sourced institutional classification on the next snapshot';}
    // Discovery lists a later cycle for this category whose article could not
    // be used (e.g. a general election after which a parliament elects the
    // president): the selected older record is not presented as the latest.
    else if(!established&&(c.laterCycle=laterCycle(c))){
      c.freshness='newer-held-results-pending';
      c.latestClaim.label=`Discovery lists a later cycle (${c.laterCycle.date}, ${c.laterCycle.title}) whose ${category} identity is not established; the ${c.latestHeld.date} record is not presented as the latest`;
      for(const m of c.eligibleMetrics)c.metricReasons[m]=c.latestClaim.label;c.eligibleMetrics=[];
      if(!c.missingInformation.includes('Identity of the later cycle'))c.missingInformation.push('Identity of the later cycle');
      c.nextAction='Identify the later cycle from the national authority or parliamentary record';}
    else if(established){
      c.freshness=corroboration?'latest-corroborated':'latest-established';
      c.latestClaim={...c.latestClaim,checked:true,label:corroboration?'Latest election established by authority evidence and independently corroborated':'Latest election established with primary authority evidence',
        basis:established.basis,evidence:established,checkTime:established.checkedAt,corroboration:corroboration||null};
      c.citations.push(established.citation,...(corroboration?[corroboration.citation]:[]));
      c.missingInformation=c.missingInformation.filter(m=>m!=='Latest-election confirmation');
    }
    // A declared/certified election whose figures are not captured is not
    // "results pending": the outcome was declared; only the figures are missing.
    else if(c.latestHeld&&!c.resultsAcquired&&['declared','certified'].includes(c.resultState?.state)){c.freshness='latest-available-unconfirmed';c.latestClaim.label='Declared election; result figures not captured; freshness unconfirmed';
      if(!c.missingInformation.includes('Result figures'))c.missingInformation.push('Result figures');}
    else if(c.latestHeld&&(!c.resultsAcquired||UNSETTLED.includes(c.resultState?.state))){c.freshness='newer-held-results-pending';c.latestClaim.label=c.resultState?.state==='annulled'?'Held event; declared results annulled; freshness unconfirmed':'Held event reported; results pending/unresolved and freshness unconfirmed';}
    else if(c.latestHeld){c.freshness='latest-available-unconfirmed';c.latestClaim.label='Latest available record; freshness unconfirmed';}
    else c.freshness='unknown';
    c.latestClaim.establishedWithEvidence=!!established;
    // Authority establishment is not independent corroboration.
    c.latestClaim.independentlyConfirmed=!!corroboration;
    c.latestClaim.evidenceStandard='latest-election-evidence-standard/v2';
    c.latestClaim.editoriallyVerified=false;
    c.evidencePass={processed:true,attemptCount:c.sourcesSearched.length,authorityResourceCount:attempts.filter(a=>a.country===j.iso3&&a.category===category&&a.ok).length,
      note:'A processed ledger row is not completed factual coverage. Authority establishment, independent corroboration and editorial verification are separate.'};
  }return ledger;
}
