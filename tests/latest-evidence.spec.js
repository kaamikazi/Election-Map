import {test,expect} from '@playwright/test';
import {expandedRows,parseWorldwideIndex} from '../scripts/catalog/discovery.js';
import {articleEvent,resultTables,electedLabel,linkedDateConflicts,presidencyOffice} from '../scripts/catalog/discovery-adapter.js';
import {authorityFor,assessIndex} from '../scripts/catalog/authority-evidence.js';
import {applyFreshness} from '../scripts/catalog/freshness.js';
import {classifyStatus} from '../scripts/catalog/status.js';
import {event,valueAt} from '../scripts/catalog/adapters.js';
import {selectLatest,metrics} from '../scripts/catalog/metrics.js';
import {identityCoverage} from '../scripts/catalog/identity-report.js';
const cutoff='2026-10-01T05:00:35.000Z';
const raw=html=>({bytes:Buffer.from(JSON.stringify({parse:{text:html}})),reference:{sourceId:'wikipedia-latest',key:'test',sha256:'a'.repeat(64),receiptId:'b'.repeat(64)},receipt:{url:'https://example.test/SYNTHETIC',retrievedAt:cutoff}});
const box=`<table class="infobox vevent"><tr><th colspan="3">Synthetic election</th></tr><tr><td colspan="3">← 2020 15 June 2025</td></tr><tr><td>Nominee</td><td>Fixture One</td><td>Fixture Two</td></tr><tr><td>Popular vote</td><td>600</td><td>400</td></tr><tr><td>Percentage</td><td>60%</td><td>40%</td></tr><tr><td>President before election<br><a>Fixture Two</a></td><td>Elected President<br><a>Fixture One</a></td></tr></table><p>Presidential elections were held on 15 June 2025. This was an indirect presidential election.</p>`;
test('scalar IPU fields are unboxed once; arrays preserve effective-date selection',()=>{
 expect(valueAt({value:{term:'unicameral'}},cutoff)).toEqual({term:'unicameral'});
 expect(valueAt([{value:false,date_from:'2020-01-01'}],cutoff)).toBe(false);
});
test('worldwide discovery uses Last columns, resolves colspans and never verifies N/A',()=>{
 const html='<table><tr><th rowspan="2">Country</th><th colspan="3">Legislative election</th><th colspan="3">Presidential election</th></tr><tr><th>Term</th><th>Last</th><th>Next</th><th>Term</th><th>Last</th><th>Next</th></tr><tr><td>France</td><td>5</td><td><a href="/wiki/2024_French_legislative_election">30 June 2024</a></td><td>2029</td><td>5</td><td><a href="/wiki/2022_French_presidential_election">10 April 2022</a></td><td>2027</td></tr><tr><td>United Kingdom</td><td>5</td><td><a href="/wiki/2024_United_Kingdom_general_election">4 July 2024</a></td><td>2029</td><td colspan="3">N/A</td></tr></table>';
 const rows=parseWorldwideIndex(html,[]);expect(rows).toHaveLength(4);expect(rows.find(r=>r.country==='FRA'&&r.category==='presidential').articleTitles[0]).toBe('2022_French_presidential_election');
 expect(rows.find(r=>r.country==='GBR'&&r.category==='presidential').scopeNote).toContain('not verified');
});
test('unlabelled infobox polling date and elected column are parsed without argmax',()=>{
 const e=articleEvent({country:'FRA',category:'presidential',revid:1,title:'SYNTHETIC',revisionTime:cutoff},raw(box),cutoff,{name:'SYNTHETIC'});
 expect(e.date).toBe('2025-06-15');expect(e.direction).toBe('indirectly_elected');expect(e.candidates.find(c=>c.elected).name).toBe('Fixture One');expect(e.candidates[0].votes).toBe(600);expect(e.candidates[0].voteShare).toBe(60);
 expect(electedLabel(box)).toBe('Fixture One');expect(metrics(e).presidential.eligible).toBe(true);expect(e.certificationStatus).toBe(null);
});
test('before/after office holders and missing winner cannot become elected candidates',()=>{
 const html=box.replace('Elected President','President after election');const e=articleEvent({country:'FRA',category:'presidential',revid:2,title:'SYNTHETIC'},raw(html),cutoff,{name:'SYNTHETIC'});
 expect(e.candidates.some(c=>c.elected)).toBe(false);expect(metrics(e).presidential.eligible).toBe(false);
});
test('subsequent infobox dates are excluded by the recorded cutoff',()=>{
 expect(articleEvent({country:'FRA',category:'presidential',revid:1},raw(box.replace('15 June 2025','15 June 2027')),cutoff,{})).toBe(null);
});
test('same combined general-election source can identify separate offices',()=>{
 const a=event({country:'FRA',category:'legislative',office:'Assembly',date:'2025-06-15',sourceId:'fixture',sourceElectionId:'1:legislative',parentSourceElectionId:'1'});
 const b=event({country:'FRA',category:'presidential',office:'President',date:'2025-06-15',sourceId:'fixture',sourceElectionId:'1:presidential',parentSourceElectionId:'1'});
 expect(a.id).not.toBe(b.id);expect(a.sourceElectionId).not.toBe(b.sourceElectionId);
});
test('government suffix alone and a copied provider do not confirm the latest election',()=>{
 const registry={profiles:[{country:'CAN',categories:['legislative'],domains:['elections.ca'],authority:'Elections Canada'}]};
 expect(authorityFor(registry,'CAN','legislative','https://www.loc.gov/')).toBe(null);expect(authorityFor(registry,'CAN','legislative','https://www.elections.ca/').authority).toBe('Elections Canada');
 expect(assessIndex({rule:null},'<p>IPU says latest election 2025-06-15</p>',{date:'2025-06-15'},raw(''),cutoff)).toBe(null);
});
test('explicit national authority index supports latest selection with capture locator and time',()=>{
 const html='<h1>General elections</h1><a href="/general-elections/6">4 July 2024</a><a href="/general-elections/5">12 December 2019</a>';
 const r={receipt:{retrievedAt:cutoff,url:'https://example.test/SYNTHETIC'},reference:{sourceId:'fixture',key:'index',sha256:'a'.repeat(64),receiptId:'b'.repeat(64)}};
 const a=assessIndex({rule:'uk-general-election-index',authority:'Synthetic authority'},html,{date:'2024-07-04'},r,cutoff);expect(a.kind).toBe('latest-established');expect(a.citation.locator).toContain('index');expect(a.checkedAt).toBe(cutoff);
 expect(assessIndex({rule:'uk-general-election-index'},html,{date:'2019-12-12'},r,cutoff)).toBe(null);
});
function ledgerEntry(applicability='applicable'){
 const c={applicability,institution:'unknown',reason:'provider assertion',status:'reported-results',latestHeld:{id:'fixture',date:'2024-07-04'},resultsAcquired:true,resultStatus:'reported-results',latestClaim:{checked:true,independentlyConfirmed:false},sourcesSearched:[],citations:[],missingInformation:[]};
 return [{iso3:'GBR',categories:{legislative:structuredClone(c),presidential:structuredClone(c)}}];
}
test('freshness and metric eligibility remain separate and non-applicability needs evidence',()=>{
 const ledger=ledgerEntry('no-applicable-election');applyFreshness(ledger,{attempts:[],assertions:[]});const c=ledger[0].categories.presidential;expect(c.applicability).toBe('unknown');expect(c.latestClaim.independentlyConfirmed).toBe(false);
 const l=ledgerEntry();applyFreshness(l,{assertions:[{country:'GBR',category:'legislative',eventId:'fixture',date:'2024-07-04',kind:'latest-established',checkedAt:cutoff,basis:'Synthetic primary index',citation:{}}]});
 expect(l[0].categories.legislative.freshness).toBe('latest-established');expect(l[0].categories.presidential.freshness).toBe('latest-available-unconfirmed');
});
test('newer pending held event coexists with older completed result',()=>{
 const old=event({country:'FRA',category:'presidential',office:'President',date:'2020-01-01',endDate:'2020-01-01',holdingStatus:'held',sourceId:'test',sourceElectionId:'old',completion:{state:'completed'}}),pending=event({...old,id:'new',date:'2025-01-01',endDate:'2025-01-01',completion:{state:'unknown'},resultStatus:'pending-or-missing'});
 const selected=selectLatest([old,pending],cutoff);expect(selected.held.id).toBe('new');expect(selected.completed.id).toBe(old.id);
});
test('identity counts separate source records from conservative full-identity groups',()=>{
 const a=event({country:'FRA',category:'presidential',office:'President',date:'2024-07-04',endDate:'2024-07-04',rounds:[{number:1,date:'2024-07-04'}],direction:'directly_elected',renewal:'full_renewal',sourceId:'one',sourceElectionId:'1'}),b=event({...a,sourceId:'two',sourceElectionId:'2'});
 const c=identityCoverage([a,b]);expect(c.sourceSpecificRecords).toBe(2);expect(c.conservativeIdentityGroups).toBe(1);expect(c.sourceCounts).toEqual({one:1,two:1});
});

// Regressions for defects found in the 1 October 2026 pass. All markup below is
// SYNTHETIC; names and numbers are fixtures, not election results.
const nested=`<table class="infobox ib-election"><tr><th colspan="2">Synthetic general election</th></tr>
<tr><td colspan="2"><table><tr><td>← 2018</td><td>2026 →</td></tr></table></td></tr>
<tr><th colspan="2">Presidential election</th></tr>
<tr><td colspan="2">2 October 2022 (first round) 30 October 2022 (second round)</td></tr>
<tr><td colspan="2"><table><tr><td>Candidate</td><td>Fixture Red</td><td>Fixture Blue</td></tr><tr><td>Popular vote</td><td>510</td><td>490</td></tr></table></td></tr>
<tr><td colspan="2"><table><tr><td>President before election<br><a>Fixture Blue</a></td><td>Elected President<br><a>Fixture Red</a></td></tr></table></td></tr>
<tr><th colspan="2">Chamber of Deputies</th></tr><tr><td colspan="2">All 13 seats</td></tr></table>
<p>General elections were held on 2 October 2022, with a runoff on 30 October.</p>
<table class="wikitable"><tr><th colspan="2" rowspan="2">Candidate</th><th rowspan="2">Party</th><th colspan="2">First round</th><th colspan="2">Second round</th></tr>
<tr><th>Votes</th><th>%</th><th>Votes</th><th>%</th></tr>
<tr><td style="background:red"></td><td>Fixture Red</td><td>Red Party</td><td>480</td><td>48.0</td><td>510</td><td>51.0</td></tr>
<tr><td style="background:blue"></td><td>Fixture Blue</td><td>Blue Party</td><td>430</td><td>43.0</td><td>490</td><td>49.0</td></tr>
<tr><td style="background:grey"></td><td>Fixture Grey</td><td>Grey Party</td><td>90</td><td>9.0</td><td></td><td></td></tr></table>
<table class="wikitable"><tr><th colspan="2">Candidate</th><th>Votes</th><th>%</th></tr><tr><td></td><td>Fixture Governor</td><td>77</td><td>70</td></tr></table>`;
test('nested infobox tables no longer truncate a combined general-election article',()=>{
 const p=articleEvent({country:'BRA',category:'presidential',revid:11,title:'SYNTHETIC'},raw(nested),cutoff,{name:'SYNTHETIC'});
 expect(p).not.toBe(null);expect([p.date,p.endDate]).toEqual(['2022-10-02','2022-10-30']);expect(p.resultStatus).toBe('reported-outcome');
 // The swatch column is skipped, only the national table naming the nominees is used, and both rounds stay ordered.
 expect(p.candidates.map(c=>c.name)).toEqual(['Fixture Red','Fixture Blue','Fixture Grey']);
 expect(p.candidates[0].roundResults.map(r=>r.votes)).toEqual([480,510]);expect(p.candidates.find(c=>c.elected).name).toBe('Fixture Red');
 const l=articleEvent({country:'BRA',category:'legislative',revid:11,title:'SYNTHETIC'},raw(nested),cutoff,{name:'SYNTHETIC'});
 expect([l.date,l.endDate]).toEqual(['2022-10-02','2022-10-02']);expect(l.dateBasis).toContain('first-round');
});
test('an annulment of a different or partial election does not cancel a held one',()=>{
 const other=box.replace('<p>Presidential','<p>It followed the October 2020 parliamentary elections, which were subsequently annulled. Presidential').replace('This was an indirect','The 2019 election was annulled by the court. This was an indirect');
 const e=articleEvent({country:'KGZ',category:'presidential',revid:12,title:'SYNTHETIC'},raw(other),cutoff,{});
 expect(e.resultStatus).toBe('reported-outcome');expect(e.statusSignals.map(s=>s.kind)).toEqual(['other-election-annulment']);
 expect(selectLatest([e],cutoff).held.id).toBe(e.id);
 const partial=box.replace('This was an indirect','The election was cancelled in 22 constituencies. This was an indirect').replace('Elected President','President after election');
 expect(articleEvent({country:'HTI',category:'presidential',revid:13},raw(partial),cutoff,{}).resultStatus).not.toBe('cancelled');
 const whole=partial.replace('cancelled in 22 constituencies','cancelled by decree');
 expect(articleEvent({country:'HTI',category:'presidential',revid:14},raw(whole),cutoff,{}).resultStatus).toBe('cancelled');
});
test('an annulled result after polling is held but names no elected winner',()=>{
 const html=box.replace('Elected President<br><a>Fixture One</a>','Elected President<br>Election results annulled<br><a>Fixture Officer</a> named Transitional President');
 const e=articleEvent({country:'GNB',category:'presidential',revid:15,title:'SYNTHETIC'},raw(html),cutoff,{});
 expect(e.resultStatus).toBe('annulled');expect(e.candidates.some(c=>c.elected)).toBe(false);expect(e.candidates.some(c=>c.name==='Fixture Officer')).toBe(false);
 expect(e.completion.state).toBe('unknown');expect(selectLatest([e],cutoff).held.id).toBe(e.id);
 expect(metrics(e).presidential.eligible).toBe(false);
});
test('a same-date record carrying results outranks an empty record of the same contest',()=>{
 const empty=event({country:'IND',category:'presidential',office:'President',date:'2022-07-18',endDate:'2022-07-18',holdingStatus:'held',sourceId:'a-empty',sourceElectionId:'1',sourceAuthority:'collaborative discovery',id:'event-0-empty'});
 const full=event({country:'IND',category:'presidential',office:'President',date:'2022-07-18',endDate:'2022-07-18',holdingStatus:'held',sourceId:'z-full',sourceElectionId:'2',sourceAuthority:'collaborative discovery',candidates:[{name:'Fixture',votes:1,elected:true}],resultStatus:'reported-outcome',id:'event-z-full'});
 // The empty record sorts first by id; content must decide, not the id.
 expect(selectLatest([empty,full],cutoff).held.sourceId).toBe('z-full');expect(selectLatest([full,empty],cutoff).held.sourceId).toBe('z-full');
});
test('linked records that disagree on polling dates are both kept and withhold the date metric',()=>{
 const a=event({country:'GTM',category:'legislative',office:'Congress',date:'2023-06-25',endDate:'2023-06-25',holdingStatus:'held',sourceId:'wikipedia-latest',sourceElectionId:'1',sourceArticle:{revid:9}});
 const b=event({country:'GTM',category:'legislative',office:'Congress',date:'2023-08-20',endDate:'2023-08-20',holdingStatus:'held',sourceId:'wikidata-presidential',sourceElectionId:'2',sourceArticle:{revid:9}});
 linkedDateConflicts([a,b]);expect(a.conflicts[0]).toMatchObject({kind:'linked-date-conflict',otherId:b.id});expect(b.conflicts[0].otherId).toBe(a.id);
 expect(metrics(b).date.eligible).toBe(false);expect(metrics(b).date.reason).toContain('disagree');
});
test('authority establishment is not independent corroboration; a second lineage is',()=>{
 const one={country:'GBR',category:'legislative',eventId:'fixture',date:'2024-07-04',kind:'latest-established',lineage:'primary:fixture-parliament',checkedAt:cutoff,basis:'Synthetic',citation:{}};
 const l=ledgerEntry();applyFreshness(l,{assertions:[one]});const c1=l[0].categories.legislative;
 expect(c1.freshness).toBe('latest-established');expect(c1.latestClaim.establishedWithEvidence).toBe(true);expect(c1.latestClaim.independentlyConfirmed).toBe(false);
 const mirror={...one,kind:'latest-corroboration',lineage:'mirror:fixture',derivedFrom:['primary:fixture-parliament']};
 const m=ledgerEntry();applyFreshness(m,{assertions:[one,mirror]});expect(m[0].categories.legislative.freshness).toBe('latest-established');
 const second={...one,kind:'latest-corroboration',lineage:'primary:fixture-commission'};
 const c=ledgerEntry();applyFreshness(c,{assertions:[one,second]});expect(c[0].categories.legislative.freshness).toBe('latest-corroborated');expect(c[0].categories.legislative.latestClaim.independentlyConfirmed).toBe(true);
});

// SYNTHETIC bicameral general-election article: the Senate figure comes first in
// the infobox and its table also reconciles. Only the lower house may be used.
const bicameral=`<table class="infobox ib-election"><tr><th colspan="2">Synthetic election</th></tr>
<tr><td colspan="2">← 2021 12 April 2026 2031 →</td></tr>
<tr><th colspan="2">Senate</th></tr><tr><td colspan="2">All 6 seats in the Senate</td></tr>
<tr><th colspan="2">Chamber of Deputies</th></tr><tr><td colspan="2">All 10 seats in the Chamber of Deputies</td></tr></table>
<p>General elections were held on 12 April 2026.</p>
<table class="wikitable"><tr><th colspan="2">Party</th><th>Votes</th><th>%</th><th>Seats</th></tr>
<tr><td></td><td>Fixture Alpha</td><td>500</td><td>50.0</td><td>4</td></tr><tr><td></td><td>Fixture Beta</td><td>500</td><td>50.0</td><td>2</td></tr>
<tr><td colspan="2">Total votes</td><td>1,000</td><td>100.0</td><td></td></tr></table>
<table class="wikitable"><tr><th colspan="2">Party</th><th>Votes</th><th>%</th><th>Seats</th></tr>
<tr><td></td><td>Fixture Alpha</td><td>520</td><td>52.0</td><td>6</td></tr><tr><td></td><td>Fixture Beta</td><td>480</td><td>48.0</td><td>4</td></tr>
<tr><td colspan="2">Total votes</td><td>1,000</td><td>100.0</td><td></td></tr><tr><td colspan="2">Registered voters/turnout</td><td>2,000</td><td>50.0</td><td></td></tr></table>`;
test('a legislative seat table must reconcile to the lower house, never the senate',()=>{
 const e=articleEvent({country:'PER',category:'legislative',revid:21,title:'SYNTHETIC'},raw(bicameral),cutoff,{name:'SYNTHETIC'});
 expect(e.seatsAtStake).toBe(10);expect(e.parties.map(p=>[p.name,p.seats])).toEqual([['Fixture Alpha',6],['Fixture Beta',4]]);
 expect(e.resultStatus).toBe('reported-results');expect(metrics(e).seats.eligible).toBe(true);expect(metrics(e).turnout.value).toBe(50);
 // A table that does not reconcile to the stated seats yields no party results.
 const broken=articleEvent({country:'PER',category:'legislative',revid:22,title:'SYNTHETIC'},raw(bicameral.replace('<td>6</td></tr><tr><td></td><td>Fixture Beta</td><td>480</td>','<td>7</td></tr><tr><td></td><td>Fixture Beta</td><td>480</td>')),cutoff,{name:'SYNTHETIC'});
 expect(broken.parties).toEqual([]);expect(broken.resultStatus).toBe('pending-or-missing');
});
test('a vice-presidential office is not a presidency, while a joint ticket is',()=>{
 expect(presidencyOffice('Vice President of India')).toBe(false);expect(presidencyOffice('Vice-President of Fixture')).toBe(false);
 expect(presidencyOffice('President of India')).toBe(true);expect(['President of the United States','Vice President of the United States'].some(presidencyOffice)).toBe(true);expect(['Vice President of India'].some(presidencyOffice)).toBe(false);
});
// Status model v3: evidence decides status; age only asks for a recheck. SYNTHETIC fixtures.
const stamp=e=>({...e,status:classifyStatus(e,cutoff)});
test('a recently declared result stays usable; age only requests a freshness recheck',()=>{
 const recent=box.replace('15 June 2025','27 September 2026').replace('held on 15 June 2025','held on 27 September 2026');
 const e=stamp(articleEvent({country:'BIH',category:'presidential',revid:31,title:'SYNTHETIC'},raw(recent),cutoff,{}));
 // A contributed "Elected President" is a reported outcome, not an official declaration.
 expect(e.status.state).toBe('reported');expect(e.status.outcome).toMatchObject({state:'reported',reportedBy:'contributed'});expect(e.status.declaration.state).toBe('not-captured');expect(e.status.freshnessCheck.required).toBe(true);
 expect(metrics(e).presidential.eligible).toBe(true);expect(metrics(e).presidential.value.name).toBe('Fixture One');
 // An official certification recorded on a recent event keeps it usable as certified.
 const certified=stamp({...e,sourceAuthority:'official: Synthetic commission',resultStatus:'official-final',certificationStatus:{state:'certified',by:'Synthetic commission',date:'2026-09-30'}});
 expect(certified.status.state).toBe('certified');expect(metrics(certified).presidential.eligible).toBe(true);
});
test('a partial count keeps its figures labelled but never names a winner',()=>{
 const partial=box.replace('Synthetic election</th></tr>','Synthetic election</th></tr><tr><td colspan="3">Reporting 96.32% as of 15:00 CEST</td></tr>')
  .replace('Elected President<br><a>Fixture One</a>','Elected President<br>TBD');
 const e=stamp(articleEvent({country:'BIH',category:'presidential',revid:33,title:'SYNTHETIC'},raw(partial),cutoff,{}));
 expect(e.status.state).toBe('partial');expect(e.candidates.some(c=>c.elected)).toBe(false);
 const m=metrics(e);expect(m.presidential.eligible).toBe(false);expect(m.presidential.reason).toMatch(/Partial count/);
 expect(m.partialCount.eligible).toBe(true);expect(m.partialCount.value.leading).toEqual(['Fixture One']);expect(m.partialCount.limitations[0]).toMatch(/not a declared winner/);
 expect(m.turnout.eligible).toBe(false);
});
test('a recount request or challenge is a caveat; the reported outcome stands',()=>{
 const html=box.replace('<p>Presidential elections were held on 15 June 2025.','<p>Presidential elections were held on 15 June 2015. Fixture Two demanded a recount on 20 June 2015. The opposition refused to accept the results.').replace(/15 June 2025/g,'15 June 2015');
 const e=stamp(articleEvent({country:'ECU',category:'presidential',revid:34,title:'SYNTHETIC'},raw(html),cutoff,{}));
 expect(e.status.state).toBe('reported');expect(e.status.recount).toMatchObject({state:'requested'});expect(e.status.recount.evidence[0]).toMatchObject({actor:'Fixture Two',date:'2015-06-20'});
 expect(e.status.challenges.map(c=>c.type)).toEqual(['rejection']);expect(e.status.withheldBecause).toBe(null);
 const m=metrics(e);expect(m.presidential.eligible).toBe(true);expect(m.presidential.value.name).toBe('Fixture One');expect(m.presidential.limitations.join(' ')).toMatch(/recount requested/);
});
test('an officially ordered recount withholds the outcome of that contest only',()=>{
 const html=box.replace('<p>Presidential elections were held on 15 June 2025.','<p>Presidential elections were held on 15 June 2025. The Constitutional Court ordered a full recount of the presidential vote.');
 const e=stamp(articleEvent({country:'FIX',category:'presidential',revid:44,title:'SYNTHETIC'},raw(html),cutoff,{}));
 expect(e.status.state).toBe('recount-or-suspension');expect(e.status.recount.state).toBe('ordered');expect(metrics(e).presidential.eligible).toBe(false);expect(metrics(e).presidential.reason).toMatch(/recount ordered/);
 // A recount ordered for the legislative vote is another contest and changes nothing here.
 const other=box.replace('<p>Presidential elections were held on 15 June 2025.','<p>Presidential elections were held on 15 June 2025. The court ordered a recount of the parliamentary vote.');
 expect(stamp(articleEvent({country:'FIX',category:'presidential',revid:45,title:'SYNTHETIC'},raw(other),cutoff,{})).status.state).toBe('reported');
});
test('a partial annulment is scoped to its constituencies; the national allocation stays usable',()=>{
 const html=nested.replace('<p>General elections were held on 2 October 2022, with a runoff on 30 October.</p>','<p>General elections were held on 2 October 2022, with a runoff on 30 October. The electoral court annulled the results in 3 constituencies.</p>');
 const p=stamp(articleEvent({country:'BRA',category:'presidential',revid:46,title:'SYNTHETIC'},raw(html),cutoff,{}));
 expect(p.status.annulment).toMatchObject({scope:'partial',units:['3 constituencies']});expect(p.status.state).not.toBe('annulled');expect(metrics(p).presidential.eligible).toBe(true);
 expect(metrics(p).presidential.limitations.join(' ')).toMatch(/partial annulment: 3 constituencies/);
});
test('a convened legislature without figures is institutional formation, not results',()=>{
 const e=event({country:'FIX',category:'legislative',office:'Synthetic assembly',date:'2025-03-01',endDate:'2025-03-01',holdingStatus:'held',sourceId:'ipu-parline',sourceElectionId:'x',sourceAuthority:'intergovernmental provider; parliament-reported',firstSession:'2025-04-01',resultStatus:'pending-or-missing'});
 const st=classifyStatus(e,cutoff);expect(st.state).toBe('held-results-unavailable');expect(st.institution).toMatchObject({formed:true,firstSession:'2025-04-01'});
 expect(st.declaration.state).toBe('not-captured');expect(st.certification.state).toBe('not-reported');expect(st.results.state).toBe('none');
 // With a complete provider allocation the figures are usable as reported results, still not a declaration.
 const full=classifyStatus({...e,parties:[{id:'a',name:'A',seats:6},{id:'b',name:'B',seats:4}],seatsAtStake:10,resultStatus:'reported-results'},cutoff);
 expect(full.state).toBe('reported');expect(full.results).toMatchObject({state:'complete',reportedBy:'provider'});expect(full.declaration.state).toBe('not-captured');
});
test('later evidence may confirm an earlier fact, but a later development stays out of the earlier snapshot',()=>{
 const base=event({country:'FIX',category:'presidential',office:'President',date:'2025-11-16',endDate:'2025-12-14',holdingStatus:'held',sourceId:'official-x',sourceElectionId:'p',sourceAuthority:'official: Synthetic court',resultStatus:'official-final',
   candidates:[{name:'Winner',elected:true}],citations:[{retrievedAt:'2026-10-07T12:00:00.000Z'}]});
 const earlier=classifyStatus({...base,certificationStatus:{state:'proclaimed',by:'Synthetic court',date:'2026-01-05'}},cutoff);
 expect(earlier.state).toBe('certified');expect(earlier.timing.retrospective).toMatch(/captured after the cutoff/);
 const later=classifyStatus({...base,certificationStatus:{state:'proclaimed',by:'Synthetic court',date:'2026-10-03'}},cutoff);
 expect(later.state).toBe('declared');expect(later.certification.state).toBe('not-reported');expect(later.laterDevelopments).toEqual([expect.objectContaining({fact:'certification',effective:'2026-10-03'})]);
});
test('status evidence about another office, year or contest does not touch this event',()=>{
 const html=box.replace('This was an indirect','The vice-presidential results were disputed by the opposition. The 2019 results were contested. Preliminary results show the referendum passing. Counting is still ongoing in the senate race. This was an indirect');
 const e=stamp(articleEvent({country:'FRA',category:'presidential',revid:35,title:'SYNTHETIC'},raw(html),cutoff,{}));
 expect(e.status.state).toBe('reported');expect(e.status.challenges).toEqual([]);expect(e.status.recount.state).toBe('none-reported');expect(e.status.partial).toBe(null);
 // The same sentences about this contest do apply.
 const own=box.replace('This was an indirect','Preliminary results show Fixture One ahead. This was an indirect').replace('Elected President<br><a>Fixture One</a>','Elected President<br>TBD');
 expect(stamp(articleEvent({country:'FRA',category:'presidential',revid:36,title:'SYNTHETIC'},raw(own),cutoff,{})).status.state).toBe('partial');
});
test('"Elected Presidency members TBD" is not an elected row and names nobody',()=>{
 const html=box.replace('Elected President<br><a>Fixture One</a>','Elected Presidency members<br>TBD (Bosniak)');
 expect(electedLabel(html)).toBe(null);
 const e=stamp(articleEvent({country:'BIH',category:'presidential',revid:37,title:'SYNTHETIC'},raw(html),cutoff,{}));
 expect(e.status.outcome.state).toBe('pending');expect(e.status.state).toBe('partial');expect(metrics(e).presidential.eligible).toBe(false);
});
test('cited headlines and citation-glued text are not status evidence for this contest',()=>{
 const html=box.replace('This was an indirect','The incumbent could not run. [ 1 ] However, Fixture One won outright. [ 2 ] This was an indirect')+
  '<h2>References</h2><span>[ edit ]</span><p>^ "Fixture president reelected, provisional results show" . Fixture News . Retrieved 1 May 2025. ^ "An already disputed election" .</p>';
 const e={...articleEvent({country:'COG',category:'presidential',revid:41,title:'SYNTHETIC'},raw(html.replace('<h2>References</h2><span>[ edit ]</span>','References [ edit ] ')),cutoff,{})};
 const st=classifyStatus(e,cutoff);expect(st.state).toBe('reported');expect(st.partial).toBe(null);expect(st.challenges).toEqual([]);
});
test('a lead sentence names the winner only when that person is in the candidate table',()=>{
 const noRow=box.replace('Elected President<br><a>Fixture One</a>','President after election<br><a>Fixture One</a>');
 const ok=noRow.replace('<p>Presidential elections were held on 15 June 2025.','<p>Presidential elections were held on 15 June 2025. Incumbent president Fixture One was re-elected with 60% of the vote.');
 const e=stamp(articleEvent({country:'SLE',category:'presidential',revid:51,title:'SYNTHETIC'},raw(ok),cutoff,{}));
 expect(e.candidates.find(c=>c.elected).name).toBe('Fixture One');expect(e.electedEvidence).toMatch(/scoped lead sentence: "Incumbent president Fixture One was re-elected/);expect(metrics(e).presidential.eligible).toBe(true);
 const stranger=noRow.replace('<p>Presidential elections were held on 15 June 2025.','<p>Presidential elections were held on 15 June 2025. Fixture Outsider was re-elected as party leader.');
 expect(articleEvent({country:'SLE',category:'presidential',revid:52,title:'SYNTHETIC'},raw(stranger),cutoff,{}).candidates.some(c=>c.elected)).toBe(false);
});
test('a winner reported on an incomplete displayed count stands, with partial figures and no turnout',()=>{
 const html=box.replace('Synthetic election</th></tr>','Synthetic election</th></tr><tr><td colspan="3">Reporting 99.29%</td></tr>');
 const e=stamp(articleEvent({country:'ZMB',category:'presidential',revid:53,title:'SYNTHETIC'},raw(html),cutoff,{}));
 expect(e.status.state).toBe('reported');expect(e.status.results.state).toBe('partial');expect(e.status.caveats).toContain('figures from an incomplete count; outcome reported');
 expect(metrics(e).presidential.eligible).toBe(true);
});
test('a reported turnout stays usable when only seat results are missing; claimants are named',()=>{
 const e=event({country:'FIX',category:'legislative',office:'Synthetic assembly',date:'2025-03-01',endDate:'2025-03-01',holdingStatus:'held',sourceId:'ipu-parline',sourceElectionId:'t',sourceAuthority:'intergovernmental provider; parliament-reported',firstSession:'2025-04-01',
   turnout:{percent:50,numerator:500,denominator:1000,definition:'voters / registered electors'}});
 const s=classifyStatus(e,cutoff);expect(s.state).toBe('held-results-unavailable');expect(metrics({...e,status:s}).turnout.eligible).toBe(true);
 const html=box.replace('This was an indirect','The result was contested by the Fixture People Congress, which demanded a rerun. This was an indirect');
 const c=stamp(articleEvent({country:'SLE',category:'presidential',revid:54,title:'SYNTHETIC'},raw(html),cutoff,{})).status.challenges[0];
 expect(c).toMatchObject({type:'challenge',actor:'Fixture People Congress'});
});
test('a multi-tier table reconciles on its Total seats column; turnout alone does not outrank seat figures',()=>{
 const html=`<table class="infobox ib-election"><tr><th colspan="2">Synthetic</th></tr><tr><td colspan="2">← 2020 1 June 2025 2030 →</td></tr><tr><td colspan="2">All 10 seats in the Assembly</td></tr></table><p>Elections were held on 1 June 2025.</p>
<table class="wikitable"><tr><th colspan="2" rowspan="2">Party</th><th colspan="3">List</th><th colspan="2">Constituency</th><th rowspan="2">Total seats</th></tr><tr><th>Votes</th><th>%</th><th>Seats</th><th>Votes</th><th>Seats</th></tr>
<tr><td></td><td>Fixture A</td><td>600</td><td>60</td><td>3</td><td>500</td><td>3</td><td>6</td></tr><tr><td></td><td>Fixture B</td><td>400</td><td>40</td><td>2</td><td>500</td><td>2</td><td>4</td></tr></table>`;
 const e=articleEvent({country:'ZAF',category:'legislative',revid:61,title:'SYNTHETIC'},raw(html),cutoff,{});
 expect(e.parties.map(p=>[p.name,p.seats])).toEqual([['Fixture A',6],['Fixture B',4]]);expect(e.parties[0].votes).toBe(null);
 const ipu=event({country:'ZAF',category:'legislative',office:'NA',date:e.date,endDate:e.endDate,holdingStatus:'held',sourceId:'ipu',sourceElectionId:'i',sourceAuthority:'IPU Parline',turnout:{percent:50,numerator:5,denominator:10,definition:'x'}});
 expect(selectLatest([ipu,e],cutoff).held.id).toBe(e.id);
});
test('constitutional non-applicability needs a matched source and then is not a missing result',()=>{
 const l=ledgerEntry('no-applicable-election');
 applyFreshness(l,{assertions:[{country:'GBR',category:'presidential',kind:'sourced-non-applicability',assertion:'The Sovereign is head of state',institution:'monarchy',citation:{url:'https://example.test/SYNTHETIC',locator:'Synthetic constitution, art. 1'}}]});
 const c=l[0].categories.presidential;expect(c.freshness).toBe('sourced-non-applicability');expect(c.applicability).toBe('no-applicable-election');
 expect(c.missingInformation).not.toContain('Held election identity');expect(c.citations.at(-1).locator).toBe('Synthetic constitution, art. 1');
});
test('history groups one election across duplicate source records and keeps each record',()=>{
 const a=event({country:'CZE',category:'presidential',office:'President',date:'2018-01-12',endDate:'2018-01-26',holdingStatus:'held',sourceId:'official-x',sourceElectionId:'prez2018',rounds:[{number:1,date:'2018-01-12'},{number:2,date:'2018-01-26'}],direction:'directly_elected',renewal:'full_renewal'});
 const b=event({...a,id:undefined,sourceId:'wikipedia-latest',sourceElectionId:'w2018'});
 const c=event({...a,id:undefined,date:'2013-01-11',endDate:'2013-01-25',sourceElectionId:'prez2013',rounds:[{number:1,date:'2013-01-11'},{number:2,date:'2013-01-25'}]});
 const ic=identityCoverage([a,b,c]);expect(ic.sourceSpecificRecords).toBe(3);expect(ic.conservativeIdentityGroups).toBe(2);
});
test('a general-election article without presidential candidates gives no presidential identity',()=>{
 const html=`<table class="infobox ib-election"><tr><th colspan="2">Synthetic general election</th></tr><tr><td colspan="2">← 2019 10 November 2024 2029 →</td></tr><tr><td colspan="2">All 62 seats in the National Assembly</td></tr></table><p>General elections were held on 10 November 2024. The President is elected by the National Assembly.</p>`;
 const r=articleEvent({country:'MUS',category:'presidential',revid:71,title:'2024 SYNTHETIC general election'},raw(html),cutoff,{});
 expect(r.skipped).toBe(true);expect(r.reason).toMatch(/indirect presidency is elected separately|vote is held separately/);
 expect(articleEvent({country:'MUS',category:'legislative',revid:71,title:'2024 SYNTHETIC general election'},raw(html),cutoff,{}).date).toBe('2024-11-10');
});
test('a held first round with the decisive round after the cutoff is the latest held event, outcome pending',()=>{
 const html=nested.replace('2 October 2022 (first round) 30 October 2022 (second round)','4 October 2026 (first round) 25 October 2026 (second round)').replace('Elected President<br><a>Fixture Red</a>','Elected President<br>TBD')
   .replace('General elections were held on 2 October 2022, with a runoff on 30 October.','General elections were held on 4 October 2026, with a runoff due on 25 October.');
 const late='2026-10-07T18:53:15.000Z';
 const p=articleEvent({country:'BRA',category:'presidential',revid:81,title:'SYNTHETIC'},raw(html),late,{});
 expect(p).not.toBe(null);expect([p.date,p.endDate]).toEqual(['2026-10-04','2026-10-04']);expect(p.rounds.at(-1)).toMatchObject({date:'2026-10-25',status:'scheduled'});
 const st=classifyStatus(p,late);expect(st.state).toBe('partial');expect(st.withheldBecause).toMatch(/Decisive round still pending/);expect(metrics({...p,status:st}).presidential.eligible).toBe(false);
 // The legislature elected on the first-round day is not affected by the presidential "TBD" row.
 const l=articleEvent({country:'BRA',category:'legislative',revid:81,title:'SYNTHETIC'},raw(html),late,{});
 expect(l.date).toBe('2026-10-04');expect(classifyStatus(l,late).outcome.state).not.toBe('pending');
});
test('status text in one office section of a shared infobox does not describe the other office',()=>{
 const html=`<table class="infobox ib-election"><tr><th colspan="2">Synthetic general election</th></tr><tr><td colspan="2">← 2022 4 October 2026 2030 →</td></tr>
<tr><th colspan="2">Fixture member of the presidency</th></tr><tr><td colspan="2">Reporting 96.32% as of 15:00</td></tr>
<tr><th colspan="2">House of Representatives</th></tr><tr><td colspan="2">All 10 seats in the House of Representatives</td></tr></table>
<p>General elections were held on 4 October 2026.</p><table class="wikitable"><tr><th colspan="2">Party</th><th>Votes</th><th>%</th><th>Seats</th></tr>
<tr><td></td><td>Fixture A</td><td>600</td><td>60</td><td>6</td></tr><tr><td></td><td>Fixture B</td><td>400</td><td>40</td><td>4</td></tr></table>`;
 const late='2026-10-05T17:01:31.000Z';
 const l=articleEvent({country:'BIH',category:'legislative',revid:91,title:'SYNTHETIC'},raw(html),late,{});
 expect(l.statusEvidence.partial).toEqual([]);expect(classifyStatus(l,late)).toMatchObject({state:'reported',caveats:[]});
});
test('one candidate on several ballot lines is one elected candidate, with the lines kept',()=>{
 const html=box.replace('<p>Presidential','<table class="wikitable"><tr><th colspan="2">Candidate</th><th>Party</th><th>Votes</th><th>%</th></tr><tr><td></td><td>Fixture One</td><td>Party X</td><td>500</td><td>50</td></tr><tr><td></td><td>Fixture One</td><td>Party Y</td><td>100</td><td>10</td></tr><tr><td></td><td>Fixture Two</td><td>Party Z</td><td>400</td><td>40</td></tr></table><p>Presidential');
 const e=stamp(articleEvent({country:'PAN',category:'presidential',revid:93,title:'SYNTHETIC'},raw(html),cutoff,{}));
 const one=e.candidates.filter(c=>c.name==='Fixture One');expect(one).toHaveLength(1);expect(one[0]).toMatchObject({elected:true,votes:null,party:'Party X / Party Y'});expect(one[0].sourceRows).toHaveLength(2);
 expect(metrics(e).presidential.eligible).toBe(true);
});
test('the national candidate table beats a party primary, and summary rows do not decide the name column',()=>{
 const primary='<table class="wikitable"><tr><th>Candidate</th><th>Results</th><th>Votes</th><th>%</th></tr><tr><td>Fixture One</td><td>Nominated</td><td>900</td><td>90</td></tr><tr><td>Fixture Three</td><td>Eliminated</td><td>100</td><td>10</td></tr></table>';
 const sum=l=>`<tr><td colspan="3">${l}</td><td>10,000</td><td>100</td></tr>`;
 const national='<table class="wikitable"><tr><th colspan="2">Candidate</th><th>Party</th><th>Votes</th><th>%</th></tr><tr><td></td><td>Fixture One</td><td>Party X</td><td>6,000</td><td>60</td></tr><tr><td></td><td>Fixture Two</td><td>Party Z</td><td>4,000</td><td>40</td></tr>'+sum('Total')+sum('Valid votes')+sum('Invalid/blank votes')+sum('Total votes')+sum('Registered voters/turnout')+'</table>';
 const html=box.replace('<p>Presidential',primary+national+'<p>Presidential');
 const e=stamp(articleEvent({country:'KOR',category:'presidential',revid:94,title:'SYNTHETIC'},raw(html),cutoff,{}));
 expect(e.candidates.map(c=>[c.name,c.party,c.votes])).toEqual([['Fixture One','Party X',6000],['Fixture Two','Party Z',4000]]);
 expect(e.candidates.find(c=>c.elected).name).toBe('Fixture One');
});
test('a general-election article whose president is chosen by the legislature gives no presidential identity, even with that tally',()=>{
 const tally='<table class="wikitable"><tr><th colspan="2">Candidate</th><th>Party</th><th>Votes</th><th>%</th></tr><tr><td></td><td>Fixture One</td><td>Opposition</td><td>17</td><td>51.52</td></tr><tr><td></td><td>Fixture Two</td><td>Government</td><td>16</td><td>48.48</td></tr><tr><td colspan="3">Total</td><td>33</td><td>100</td></tr></table>';
 const html=box.replace('<p>Presidential elections were held on 15 June 2025. This was an indirect presidential election.</p>','<p>General elections were held on 15 June 2025. The President is elected by the Fixtureland Assembly from among its members.</p>'+tally);
 const r=articleEvent({country:'MHL',category:'presidential',revid:95,title:'2025 Fixtureland general election'},raw(html),cutoff,{});
 expect(r).toMatchObject({skipped:true,reason:/elected by Fixtureland Assembly/});
 // A popular vote stated the same way is not an indirect presidency.
 const popular=html.replace('elected by the Fixtureland Assembly from among its members','elected by popular vote');
 expect(articleEvent({country:'BRA',category:'presidential',revid:96,title:'2025 Fixtureland general election'},raw(popular),cutoff,{})?.skipped).toBeFalsy();
});
test('assembly ballot summary rows (Voters, Absentees) are not candidates',()=>{
 const t='<table class="wikitable"><tr><th colspan="2">Candidate</th><th>Party</th><th>Votes</th><th>%</th></tr><tr><td></td><td>Fixture One</td><td>X</td><td>160</td><td>67</td></tr><tr><td></td><td>Fixture Two</td><td>Y</td><td>80</td><td>33</td></tr><tr><td colspan="3">Voters</td><td>276</td><td>92</td></tr><tr><td colspan="3">Absentees</td><td>24</td><td>8</td></tr></table>';
 const e=stamp(articleEvent({country:'GRC',category:'presidential',revid:97,title:'SYNTHETIC'},raw(box.replace('<p>Presidential',t+'<p>Presidential')),cutoff,{}));
 expect(e.candidates.map(c=>c.name)).toEqual(['Fixture One','Fixture Two']);
});
test('a collective presidency records every elected member and no single winner',()=>{
 const html=box.replace('<td>Elected President<br><a>Fixture One</a></td>','<td>Elected Presidency members<br><a>Fixture One</a> (Bosniak)<br><a>Fixture Two</a> (Croat)<br><a>Fixture Three</a> (Serb)</td>');
 const e=stamp(articleEvent({country:'BIH',category:'presidential',revid:98,title:'SYNTHETIC'},raw(html),cutoff,{}));
 expect(e.collectivePresidency.members).toEqual(['Fixture One','Fixture Two','Fixture Three']);
 expect(e.candidates.filter(c=>c.elected).map(c=>c.name).sort()).toEqual(['Fixture One','Fixture Three','Fixture Two']);
 expect(e.status.outcome).toMatchObject({state:'reported',members:expect.arrayContaining(['Fixture Three'])});
 const m=metrics(e).presidential;expect(m.eligible).toBe(false);expect(m.reason).toMatch(/Collective presidency: 3 members elected/);
});
test('a Wikidata label is trusted only when every word appears in the linked article',async()=>{
 const {labelInText}=await import('../scripts/catalog/discovery-adapter.js');
 const article='Fixture Al-Name was re-elected with 95% of the vote; Ana Pérez-Gómez came second.'.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
 expect(labelInText('Fixture al-Name',article)).toBe(true);
 expect(labelInText('Ana Perez-Gomez',article)).toBe(true);
 expect(labelInText('Fixture Vandal',article)).toBe(false);
 expect(labelInText('',article)).toBe(false);
});
test('a later cycle listed by discovery stops an older record being presented as the latest',async()=>{
 const {applyFreshness}=await import('../scripts/catalog/freshness.js');
 const {leadDay}=await import('../scripts/catalog/discovery-adapter.js');
 expect([leadDay('25 May 2025'),leadDay('20 Nov 2023'),leadDay('2025'),leadDay('31 Feb 2025')]).toEqual(['2025-05-25','2023-11-20',null,null]);
 const row=()=>({iso3:'SUR',scope:'core',categories:{presidential:{applicability:'applicable',status:'reported',latestHeld:{id:'e2010',date:'2010-07-19',endDate:'2010-07-19'},resultsAcquired:true,
  resultState:{state:'reported'},eligibleMetrics:['date','presidential'],metricReasons:{},missingInformation:[],sourcesSearched:[],citations:[],latestClaim:{}},
  legislative:{applicability:'applicable',status:'missing-evidence',latestHeld:null,eligibleMetrics:[],metricReasons:{},missingInformation:[],sourcesSearched:[],citations:[],latestClaim:{}}}});
 const attempt={country:'SUR',category:'presidential',sourceId:'wikipedia-latest',ok:false,title:'2025 Fixtureland general election',leadDate:'2025-05-25',leadLocator:'presidential Last column',error:'General-election article states the president is elected by National Assembly'};
 const [j]=applyFreshness([row()],{attempts:[attempt],strictNonApplicability:false});const c=j.categories.presidential;
 expect(c.freshness).toBe('newer-held-results-pending');expect(c.eligibleMetrics).toEqual([]);
 expect(c.laterCycle).toMatchObject({date:'2025-05-25',title:'2025 Fixtureland general election'});
 expect(c.metricReasons.presidential).toMatch(/later cycle \(2025-05-25.*2010-07-19 record is not presented as the latest/);
 // A lead dated on or before the selected record changes nothing.
 const [k]=applyFreshness([row()],{attempts:[{...attempt,leadDate:'2010-07-19'}],strictNonApplicability:false});
 expect(k.categories.presidential.eligibleMetrics).toEqual(['date','presidential']);expect(k.categories.presidential.freshness).toBe('latest-available-unconfirmed');
});
test('"took place in <country> on" is a held-event statement; "will take place" is not',()=>{
 const past=box.replace('Presidential elections were held on 15 June 2025.','An indirect election took place in Fixtureland on 15 June 2025.');
 expect(stamp(articleEvent({country:'EST',category:'presidential',revid:99,title:'SYNTHETIC'},raw(past),cutoff,{})).date).toBe('2025-06-15');
 const future=box.replace('Presidential elections were held on 15 June 2025.','An indirect election will take place in Fixtureland on 15 June 2025.');
 expect(articleEvent({country:'EST',category:'presidential',revid:100,title:'SYNTHETIC'},raw(future),cutoff,{})).toBe(null);
});
test('lead-sentence winners: "won the election" and "was elected as President", only for a row of the contest table',()=>{
 const t='<table class="wikitable"><tr><th colspan="2">Candidate</th><th>Party</th><th>Votes</th><th>%</th></tr><tr><td></td><td>Fixture One</td><td>X</td><td>600</td><td>60</td></tr><tr><td></td><td>Fixture Two</td><td>Y</td><td>400</td><td>40</td></tr></table>';
 const base=box.replace('<td>Elected President<br><a>Fixture One</a></td>','<td>President after election<br><a>Fixture One</a></td>');
 for(const [lead,who] of [['Party candidate Fixture One won the election by a margin of 200 votes.','Fixture One'],['The fourth round was held on 15 June 2025, where Fixture Two was elected as President of Fixtureland.','Fixture Two']]){
  const html=base.replace('This was an indirect presidential election.</p>',`This was an indirect presidential election. ${lead}</p>`+t);
  const e=stamp(articleEvent({country:'IND',category:'presidential',revid:101,title:'SYNTHETIC'},raw(html),cutoff,{}));
  expect(e.candidates.filter(c=>c.elected).map(c=>c.name)).toEqual([who]);
 }
 // A name outside the contest table is not taken.
 const other=base.replace('This was an indirect presidential election.</p>','This was an indirect presidential election. Fixture Outsider won the election.</p>'+t);
 expect(stamp(articleEvent({country:'IND',category:'presidential',revid:102,title:'SYNTHETIC'},raw(other),cutoff,{})).candidates.some(c=>c.elected)).toBe(false);
});
test('a presidential vote inside a parliamentary-election article takes its own stated date, or the article is not used',()=>{
 const withVote=box.replace('<p>Presidential elections were held on 15 June 2025. This was an indirect presidential election.</p>','<p>Parliamentary elections were held on 15 June 2025.</p><p>An indirect presidential election was held on 18 June 2025, and Fixture One was re-elected.</p>');
 const e=stamp(articleEvent({country:'NRU',category:'presidential',revid:103,title:'2025 Fixtureland parliamentary election'},raw(withVote),cutoff,{}));
 expect(e.date).toBe('2025-06-18');expect(e.direction).toBe('indirectly_elected');expect(e.candidates.find(c=>c.elected).name).toBe('Fixture One');
 expect(e.citations[0].locator).toMatch(/Separate presidential vote stated in the article/);
 const without=withVote.replace('<p>An indirect presidential election was held on 18 June 2025, and Fixture One was re-elected.</p>','');
 expect(articleEvent({country:'NRU',category:'presidential',revid:104,title:'2025 Fixtureland parliamentary election'},raw(without),cutoff,{})).toMatchObject({skipped:true,reason:/date is not stated/});
});
test('a separate presidential vote date without a year takes the polling year only when it follows polling closely',()=>{
 const html=y=>box.replace('<p>Presidential elections were held on 15 June 2025. This was an indirect presidential election.</p>',`<p>Parliamentary elections were held on 15 June 2025.</p><p>An indirect presidential election was held on ${y}, and Fixture One was re-elected.</p>`);
 expect(stamp(articleEvent({country:'NRU',category:'presidential',revid:105,title:'2025 Fixtureland parliamentary election'},raw(html('18 June')),cutoff,{})).date).toBe('2025-06-18');
 // A day before polling in the same year cannot be the post-election vote.
 expect(articleEvent({country:'NRU',category:'presidential',revid:106,title:'2025 Fixtureland parliamentary election'},raw(html('1 March')),cutoff,{})).toMatchObject({skipped:true});
});
test('"elected by double simultaneous vote" names a method, not a body, so the general-election record stands',()=>{
 const t='<table class="wikitable"><tr><th colspan="2">Candidate</th><th>Party</th><th>Votes</th><th>%</th></tr><tr><td></td><td>Fixture One</td><td>X</td><td>600</td><td>60</td></tr><tr><td></td><td>Fixture Two</td><td>Y</td><td>400</td><td>40</td></tr></table>';
 const html=box.replace('<p>Presidential elections were held on 15 June 2025. This was an indirect presidential election.</p>','<p>General elections were held on 15 June 2025. The President is elected by double simultaneous vote – each party list is headed by its candidate.</p>'+t);
 const e=articleEvent({country:'AGO',category:'presidential',revid:107,title:'2025 Fixtureland general election'},raw(html),cutoff,{});
 expect(e.skipped).toBeFalsy();expect(e.date).toBe('2025-06-15');
});
test('claims must concern the result, and claimants are named without time phrases, roles or headings',async()=>{
 const {articleStatusEvidence}=await import('../scripts/catalog/status.js');
 const ev=lead=>articleStatusEvidence({lead,year:'2025',category:'presidential'});
 // A heading does not become part of the claimant; a complaint about campaign conduct is not a result dispute.
 expect(ev('Controversy [ edit ] Fixture Party filed a complaint with the commission alleging code violations in 2025.').challenges).toEqual([]);
 // Competition is not a challenge.
 expect(ev('The 2025 election was contested by seven political parties.').challenges).toEqual([]);
 // Pre-election complaints are not result disputes.
 expect(ev('In January 2025, candidate Fixture One filed a complaint against Fixture Two over his dual nationality.').challenges).toEqual([]);
 // A result dispute keeps a clean claimant name.
 const a=ev('On 22 August 2025, Fixture One filed a petition with the Supreme Court challenging the results.').challenges[0];
 expect(a).toMatchObject({type:'court-filing',actor:'Fixture One',date:'2025-08-22'});
 const b=ev('In January 2025, candidate Fixture Two filed an appeal seeking the annulment of the results.').challenges[0];
 expect(b.actor).toBe('Fixture Two');
 const c=ev('The 2025 results were rejected by the Fixtureland opposition.').challenges[0];
 expect(c).toMatchObject({type:'rejection',actor:'Fixtureland opposition'});
 // A clause fragment is not a claimant.
 expect(ev('The decision was announced at a special session, citing alleged irregularities in the 2025 results.').challenges[0]?.actor??null).toBe(null);
});
