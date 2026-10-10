/** Conservative source-independent identity grouping; ambiguous rounds remain labelled. */
import {fingerprint} from '../ingestion/util.js';
export function identityCoverage(events){
  const groups=new Map(),sourceCounts={};
  for(const e of events){
    sourceCounts[e.sourceId]=(sourceCounts[e.sourceId]||0)+1;
    const office=e.category==='legislative'?'lower-or-unicameral':e.category==='presidential'?'presidency':e.chamber||e.office;
    const key=fingerprint({country:e.country,category:e.category,office,tier:e.tier,jurisdiction:e.jurisdiction,date:e.date,endDate:e.endDate,
      rounds:(e.rounds||[]).map(r=>({date:r.date,number:r.number??null})),direction:e.direction||'unknown',renewal:e.renewal||'unknown'});
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(e);
  }
  const identities=[...groups].map(([key,rows])=>({key,country:rows[0].country,category:rows[0].category,date:rows[0].date,endDate:rows[0].endDate,
    sourceRecords:rows.map(e=>({id:e.id,sourceId:e.sourceId,sourceElectionId:e.sourceElectionId})),
    certainty:rows[0].rounds.some(r=>r.number===null)||!rows[0].direction?'provisional; unknown identity dimensions retained':'specified'}));
  return {sourceSpecificRecords:events.length,sourceCounts,conservativeIdentityGroups:identities.length,identities,
    note:'Full dates, category/office, jurisdiction, tier, renewal, rounds and direction are used. Year alone does not merge events; unknown/different dimensions remain separate. Source-specific counts are not counts of distinct physical elections.'};
}
