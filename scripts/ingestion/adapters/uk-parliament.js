import { table, number, boolean, party, record, citation, normalName } from '../canonical.js';

export function parseUKParliament({ source, resources, aliases }) {
  const data = resources.find((r) => r.key === 'candidacies');
  if (!data) throw new Error('The UK Parliament adapter requires its candidate CSV');
  const rows = table(data.bytes, ',', source.schema.required);
  const records = rows.map(({ values: r, row }) => {
    const identity = { ...source.identity, date: r['Election polling date'],
      sourceId: source.id, sourceElectionId: r['General election URL'] };
    for (const [column, key] of [['Office', 'office'], ['Tier', 'tier'], ['Jurisdiction', 'jurisdiction']]) {
      if (Object.hasOwn(r, column)) identity[key] = r[column] || null;
    }
    if (Object.hasOwn(r, 'Round')) identity.round = number(r.Round, 'round');
    delete identity.roundBasis;
    delete identity.roundEvidence;
    const regionKey = r['Constituency geographic code'];
    const person = [r['Candidate given name'], r['Candidate family name']].filter(Boolean).join(' ');
    const entityKey = r['Candidate MNIS ID'] || [regionKey, normalName(person), r['Main party MNIS ID'] || 'non-party'].join(':');
    const independent = boolean(r['Candidate is standing as independent'], 'independent');
    const speaker = boolean(r['Candidate is standing as Commons Speaker'], 'speaker');
    let rawParty = r['Main party name'], rawPartyId = r['Main party MNIS ID'] ? `uk-parliament:party:${r['Main party MNIS ID']}` : null;
    if (independent) { rawParty = 'Independent'; rawPartyId = `uk-parliament:independent:${entityKey}`; }
    if (speaker) { rawParty = 'Speaker'; rawPartyId = 'uk-parliament:speaker'; }
    const p = party(rawParty, rawPartyId, source, aliases);
    const adjunct = r['Adjunct party name'] || null;
    const validVotes = number(r['Election valid vote count'], 'valid votes');
    const electorate = number(r.Electorate, 'electorate');
    const share = number(r['Candidate vote share'], 'candidate vote share');
    const position = number(r['Candidate result position'], 'candidate result position');
    const sourceStatus = r['Result status'] || source.resultStatus;
    const resultStatus = sourceStatus === 'partial' ? 'official-partial' : sourceStatus;
    const rawUpdate = r['Source updated at'] || null;
    const updateDate = rawUpdate?.slice(0, 10);
    const validUpdate = rawUpdate && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(rawUpdate) &&
      /^\d{4}-\d{2}-\d{2}$/.test(updateDate) && Number.isFinite(Date.parse(rawUpdate)) &&
      new Date(updateDate + 'T00:00:00Z').toISOString().slice(0, 10) === updateDate;
    const sourceUpdateTime = validUpdate ? new Date(rawUpdate).toISOString() : null;
    return record({ country: 'GBR', electionDate: identity.date, electionIdentity: identity,
      office: identity.office, round: identity.round, tier: identity.tier, jurisdictionLevel: identity.jurisdiction,
      electionType: 'General',
      regionKey, regionName: r['Constituency name'], layer: source.boundaryCompatibility.layer,
      providerCountry: r['Country name'],
      entityKey, candidate: person, party: p.name, partyIdentity: p.id,
      alliance: adjunct ? { mainPartyId: p.id, adjunctName: adjunct, scheme: 'source-reported joint candidacy' } : null,
      votes: number(r['Candidate vote count'], 'candidate votes'), voteShare: share === null ? null : share * 100,
      seats: null, turnout: validVotes !== null && electorate > 0 ? validVotes / electorate * 100 : null,
      winner: position === null || !Number.isInteger(position) || position < 1 ? null : position === 1,
      sourceUpdateTime, boundaryVintage: Number(r['Boundary set start date'].slice(0, 4)) || null,
      ambiguousUpdateTime: !!rawUpdate && !validUpdate,
      counted: number(r['Percentage counted'], 'percentage counted'),
      boundaryStart: r['Boundary set start date'], resultStatus, voteSystem: 'FPTP', seatSystem: { unit: 'count', total: null },
      validVotes, electorate, position,
      generalElectionDate: r['General election polling date'],
      isNotional: boolean(r['General election is notional'], 'notional'),
      isNotionalAggregate: boolean(r['Candidate is notional political party aggregate'], 'notional aggregate'),
      isByElection: boolean(r['Election is by-election'], 'by-election'),
      partyAlias: p.alias, aliasConflict: p.aliasConflict || null,
      citation: citation(source, data, row, ['Constituency geographic code', 'Main party MNIS ID', 'Candidate vote count', 'Candidate result position']),
      fieldEvidence: { voteShare: { column: 'Candidate vote share', operation: 'fraction * 100', raw: r['Candidate vote share'] },
        party: { idColumn: 'Main party MNIS ID', idNamespace: 'MNIS party IDs, not election-results website URL IDs', url: r['Main party URL'] || null },
        round: Object.hasOwn(r, 'Round') ? { column: 'Round', raw: r.Round } : { convention: source.identity.roundBasis, evidence: source.identity.roundEvidence },
        sourceUpdateTime: { column: 'Source updated at', raw: rawUpdate, normalization: 'explicit-offset instant to UTC; otherwise retained for review' },
        turnout: { operation: 'valid votes / electorate * 100', excludes: 'invalid/spoiled ballots',
          evidence: 'https://electionresults.parliament.uk/general-elections/6' },
        winner: { column: 'Candidate result position', operation: 'equals 1; never inferred from votes' } }
    });
  });
  return { records, complete: new Set(records.map((r) => r.regionKey)).size === source.schema.expectedRegions };
}
