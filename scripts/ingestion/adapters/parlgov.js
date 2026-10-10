import { table, number, record, citation } from '../canonical.js';

export function parseParlGov({ source, resources, worldNames }) {
  const byKey = new Map(resources.map((r) => [r.key, r]));
  const elections = byKey.get('elections'), parties = byKey.get('parties'), cabinets = byKey.get('cabinets');
  if (!elections || !parties || !cabinets) throw new Error('ParlGov requires the election, party and cabinet files together');
  const partyRows = table(parties.bytes, '\t', source.schema.partyRequired);
  if (!partyRows.length) throw new Error('Empty ParlGov party snapshot');
  const partyIndex = new Map(partyRows.map(({ values: r }) => [r.party_id, r]));
  if (partyIndex.size !== partyRows.length || partyIndex.has('')) throw new Error('Missing or duplicate ParlGov party IDs');
  const cabinetRows = table(cabinets.bytes, '\t', source.schema.cabinetRequired);
  if (!cabinetRows.length) throw new Error('Empty ParlGov cabinet snapshot');
  for (const { values: r } of cabinetRows) {
    if (!r.cabinet_id || !/^\d{4}-\d{2}-\d{2}$/.test(r.start_date) || !Number.isFinite(Date.parse(r.start_date)) ||
        new Date(r.start_date).toISOString().slice(0, 10) !== r.start_date || !source.countries.includes(r.country_name_short)) throw new Error('Invalid ParlGov cabinet identity/date/country');
    if (!['0', '1'].includes(r.cabinet_party) || !['0', '1'].includes(r.prime_minister) ||
        (r.prime_minister === '1' && r.cabinet_party !== '1') || (r.cabinet_party === '1' && !partyIndex.has(r.party_id))) throw new Error('Invalid ParlGov cabinet party/PM evidence');
    if (r.seats !== undefined && number(r.seats, 'cabinet seats') < 0) throw new Error('Invalid negative cabinet seats');
  }
  const records = table(elections.bytes, '\t', source.schema.electionRequired).map(({ values: r, row }) => {
    if (!['parliament', 'ep'].includes(r.election_type)) throw new Error(`Unknown ParlGov election type: ${r.election_type}`);
    if (!partyIndex.has(r.party_id)) throw new Error(`ParlGov party ${r.party_id} is absent from the party release`);
    const identity = { country: r.country_name_short, date: r.election_date,
      office: r.election_type === 'ep' ? 'European Parliament' : 'National lower house',
      round: null, tier: r.election_type === 'ep' ? 'supranational' : 'national', jurisdiction: 'country',
      sourceId: source.id, sourceElectionId: r.election_id };
    const p = partyIndex.get(r.party_id);
    return record({ country: identity.country, electionDate: identity.date, electionIdentity: identity,
      office: identity.office, round: null, tier: identity.tier, jurisdictionLevel: 'country',
      regionKey: worldNames[identity.country] || r.country_name, regionName: r.country_name,
      layer: 'world', entityKey: r.party_id, party: p.party_name_english || p.party_name,
      partyIdentity: `parlgov:party:${r.party_id}`, alliance: null,
      votes: null, voteShare: number(r.vote_share, 'vote share'), seats: number(r.seats, 'seats'),
      turnout: null, winner: null, sourceUpdateTime: null, boundaryVintage: null,
      resultStatus: 'historical', voteSystem: 'not recorded in release view',
      seatSystem: { unit: 'count', total: number(r.seats_total, 'seats total') },
      citation: citation(source, elections, row, ['election_id', 'party_id', 'vote_share', 'seats']),
      fieldEvidence: { party: { rawPartyId: r.party_id, partySha256: parties.receipt.sha256 },
        voteShare: { column: 'vote_share', unit: 'percent' }, seats: { column: 'seats', unit: 'count' } }
    });
  });
  if (!records.length) throw new Error('Empty ParlGov election snapshot');
  const covered = new Set(records.map((r) => r.country));
  return { records, complete: source.countries.every((country) => covered.has(country)), cabinetRows: cabinetRows.length };
}
