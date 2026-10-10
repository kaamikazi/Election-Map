import {test,expect} from '@playwright/test';
import {PARSERS,indexAssertions,germanDates} from '../scripts/catalog/official-results.js';
import {assessIndex,textDates,checkTime} from '../scripts/catalog/authority-evidence.js';
import {selectLatest,metrics} from '../scripts/catalog/metrics.js';
import {event} from '../scripts/catalog/adapters.js';
import {text} from '../scripts/catalog/html.js';
import {pdfPages} from '../scripts/catalog/pdf.js';
import {classifyStatus} from '../scripts/catalog/status.js';

// All markup is SYNTHETIC. Names and figures are fixtures shaped like the
// registered publications, not real results.
const cutoff='2026-10-05T17:01:31.000Z';
const raw=(html,url='https://example.test/SYNTHETIC')=>({bytes:Buffer.from(html),receipt:{url,retrievedAt:cutoff},reference:{sourceId:'official-results',key:'k',sha256:'a'.repeat(64),receiptId:'b'.repeat(64)}});
const src=(id,parser,keys)=>({id,parser,authority:'Synthetic authority',terms:'SYNTHETIC',resources:keys.map(key=>({key,url:'https://example.test/'+key}))});

const cz=`<p>Election of the President held on 13&ndash;14 January 2023</p>
<table id="pe2_t1" class="table"><tr><th>x</th></tr>
<tr><td>1st round</td><td>10</td><td>10</td><td>100.00</td><td>1&nbsp;000</td><td>600</td><td>60.00</td><td>600</td><td>590</td><td>98.33</td></tr>
<tr><td>2nd round</td><td>10</td><td>10</td><td>100.00</td><td>1&nbsp;000</td><td>700</td><td>70.00</td><td>700</td><td>690</td><td>98.57</td></tr></table>
<table id="pe2_t2" class="table"><tr><th>Candidate</th></tr>
<tr><td>1</td><td>Fixture Low</td><td>Citizen</td><td>NONE</td><td>90</td><td>15.25</td><td>X</td><td>X</td></tr>
<tr><td>*2</td><td>Fixture Winner</td><td>Citizen</td><td>NONE</td><td>200</td><td>33.90</td><td>400</td><td>57.97</td></tr>
<tr><td>+3</td><td>Fixture Runner</td><td>Deputies</td><td>P</td><td>300</td><td>50.85</td><td>290</td><td>42.03</td></tr></table>`;
test('official two-round table keeps the authority elected marker, both rounds and checked turnout',()=>{
 const {events:[e]}=PARSERS['cze-volby-president'](src('cz','cze-volby-president',['cze-prez2023-pe2']),{'cze-prez2023-pe2':raw(cz)},cutoff);
 expect(e.date).toBe('2023-01-13');expect(e.endDate).toBe(null);expect(e.rounds[1].date).toBe(null);
 // The first-round leader is not the winner: only the "*" marker decides.
 expect(e.candidates.find(c=>c.elected).name).toBe('Fixture Winner');expect(e.candidates.find(c=>c.name==='Fixture Runner').elected).toBe(false);
 expect(e.candidates.find(c=>c.name==='Fixture Low').roundResults).toHaveLength(1);
 expect(e.sourceAuthority).toMatch(/^official: /);expect(e.resultStatus).toBe('official-final');
 const m=metrics(e);expect(m.presidential.value.name).toBe('Fixture Winner');expect(m.turnout.eligible).toBe(true);expect(m.turnout.value).toBe(70);
});
test('an official page without an elected marker is rejected, not guessed',()=>{
 expect(()=>PARSERS['cze-volby-president'](src('cz','cze-volby-president',['cze-prez2023-pe2']),{'cze-prez2023-pe2':raw(cz.replace('*2','2'))},cutoff)).toThrow(/elected/);
});
const at=`<p>Kundmachung der Wahlvorschläge für die Bundespräsidentenwahl am 9. Oktober 2022 veröffentlicht.</p>
<p>Die Bundeswahlbeh&ouml;rde hat das amtliche Endergebnis der Bundespr&auml;sidentenwahl am 17. Oktober 2022 festgestellt.</p>
<p>Wahlberechtigte 1.000 Wahlbeteiligung 65,0% abgegebene Stimmen 650 ung&uuml;ltige Stimmen 10 g&uuml;ltige Stimme 640</p>
<table><tr><th>Bundesland</th><th colspan="2">Fixture A</th><th colspan="2">Van der Bellen Fixture</th></tr>
<tr><td>Land</td><td>10</td><td>50,0%</td><td>10</td><td>50,0%</td></tr><tr><td>Österreich</td><td>240</td><td>37,5%</td><td>400</td><td>62,5%</td></tr></table>`;
test('official totals without an elected statement keep the winner unknown; dates are polling day not determination day',()=>{
 const {events:[e]}=PARSERS['aut-bmi-president'](src('at','aut-bmi-president',['aut-bp2022-start']),{'aut-bp2022-start':raw(at)},cutoff);
 expect(e.date).toBe('2022-10-09');expect(e.certificationStatus.date).toBe('2022-10-17');
 expect(e.candidates.map(c=>c.votes)).toEqual([240,400]);expect(e.candidates.every(c=>c.elected===null)).toBe(true);
 expect(metrics(e).presidential.eligible).toBe(false);expect(metrics(e).turnout.eligible).toBe(true);
 expect(germanDates('am 1. Jänner 2024 und 31. Februar 2024')).toEqual(['2024-01-01']);
});
test('an indirect election statement records the electing body and no invented vote counts',()=>{
 const html='<p>His Highness Fixture Ruler is the President of the Fixture State and the ruler of X. He was elected on 14 May 2022 by decision of the members of the Federal Supreme Council.</p>';
 const {events:[e]}=PARSERS['are-fsc-president'](src('ae','are-fsc-president',['are-fsc']),{'are-fsc':raw(html.replace('Fixture State','United Arab Emirates'))},cutoff);
 expect(e.direction).toBe('indirectly_elected');expect(e.date).toBe('2022-05-14');expect(e.candidates[0]).toMatchObject({name:'Fixture Ruler',elected:true,votes:null,voteShare:null});
 expect(()=>PARSERS['are-fsc-president'](src('ae','are-fsc-president',['are-fsc']),{'are-fsc':raw('<p>Fixture Ruler is the President.</p>')},cutoff)).toThrow();
});
test('a year-based official index establishes latest only when its newest year is the selected election',()=>{
 const idx={country:'CZE',category:'presidential',years:[2023,2018],label:'Synthetic index',sourceId:'fixture-index',authority:'Synthetic',raw:raw('')};
 const ledger=date=>[{iso3:'CZE',categories:{presidential:{latestHeld:{id:'e1',date}}}}];
 const ok=indexAssertions(ledger('2023-01-13'),[idx],cutoff);expect(ok.assertions[0]).toMatchObject({kind:'latest-established',date:'2023-01-13',lineage:'primary:fixture-index'});
 expect(indexAssertions(ledger('2018-01-12'),[idx],cutoff).assertions).toHaveLength(0);
 expect(indexAssertions(ledger('2023-01-13'),[{...idx,years:[2023,2023]}],cutoff).assertions).toHaveLength(0);
});
test('authority statements and dated indexes are checked against the selected date',()=>{
 const r=raw('');
 const statement=assessIndex({rule:'most-recent-statement',subject:'general election',authority:'Synthetic commission'},'<p>The most recent general election took place on Friday 29 November 2024.</p>',{date:'2024-11-29'},r,cutoff);
 expect(statement).toMatchObject({kind:'latest-established',date:'2024-11-29'});
 expect(assessIndex({rule:'most-recent-statement',subject:'general election'},'<p>The most recent general election took place on Friday 29 November 2024.</p>',{date:'2020-02-08'},r,cutoff)).toBe(null);
 const aec='<li>2025 federal election – Saturday 3 May 2025</li><li>2022 federal election – Saturday 21 May 2022</li>';
 expect(assessIndex({rule:'aec-federal-elections-index',authority:'Synthetic'},aec,{date:'2025-05-03'},r,cutoff).kind).toBe('latest-established');
 expect(assessIndex({rule:'aec-federal-elections-index'},aec,{date:'2022-05-21'},r,cutoff)).toBe(null);
});
test('date ranges and shared-year pairs yield every polling day',()=>{
 expect(textDates('12–13 April 2026 (first round) 7 June 2026')).toEqual(['2026-04-12','2026-04-13','2026-06-07']);
 expect(textDates('April 12–13, 2026')).toEqual(['2026-04-12','2026-04-13']);
 expect(textDates('4 February and 3 March 2024')).toEqual(['2024-02-04','2024-03-03']);
 expect(text('&Ouml;sterreich &ndash; g&uuml;ltige &amp;auml;')).toBe('Österreich – gültige &auml;');
});
test('a contributed record days after a provider record does not displace it',()=>{
 const ipu=event({country:'IDN',category:'legislative',office:'DPR',date:'2024-02-14',endDate:'2024-02-14',holdingStatus:'held',sourceId:'ipu',sourceElectionId:'1',sourceAuthority:'IPU Parline',parties:[{id:'p',name:'P',seats:1}]});
 const wiki=event({country:'IDN',category:'legislative',office:'DPR',date:'2024-02-24',endDate:'2024-02-24',holdingStatus:'held',sourceId:'wiki',sourceElectionId:'2',sourceAuthority:'collaborative discovery'});
 const s=selectLatest([ipu,wiki],cutoff);expect(s.held.id).toBe(ipu.id);expect(s.conflicts[0]).toMatchObject({kind:'cross-source-date-proximity',otherId:wiki.id});expect(s.alternatives).toContain(wiki.id);
 const later=event({country:'IDN',category:'legislative',office:'DPR',date:'2026-06-14',endDate:'2026-06-14',holdingStatus:'held',sourceId:'wiki',sourceElectionId:'3',sourceAuthority:'collaborative discovery'});
 expect(selectLatest([ipu,later],cutoff).held.id).toBe(later.id);
});
test('an unchanged page refetched for this pass is checked now, though its first receipt is older',()=>{
 // Same bytes keep their first receipt (1 October); the new fetch is the capture.
 const r={...raw('<li>2025 federal election – Saturday 3 May 2025</li>'),capture:{retrievedAt:'2026-10-07T12:00:00.000Z'}};
 r.receipt={...r.receipt,retrievedAt:'2026-10-01T15:34:44.678Z'};
 expect(checkTime(r)).toBe('2026-10-07T12:00:00.000Z');
 const a=assessIndex({rule:'aec-federal-elections-index',authority:'Synthetic'},'<li>2025 federal election – Saturday 3 May 2025</li>',{date:'2025-05-03'},r,cutoff);
 expect(a.checkedAt).toBe('2026-10-07T12:00:00.000Z');expect(a.citation.retrievedAt).toBe('2026-10-01T15:34:44.678Z');
});
test('an empty provider record of the same contest does not hide a record with reported seats',()=>{
 const ipu=event({country:'IDN',category:'legislative',office:'DPR',date:'2024-02-14',endDate:'2024-02-14',holdingStatus:'held',sourceId:'ipu',sourceElectionId:'1',sourceAuthority:'IPU Parline'});
 const wiki=event({country:'IDN',category:'legislative',office:'DPR',date:'2024-02-14',endDate:'2024-02-14',holdingStatus:'held',sourceId:'wiki',sourceElectionId:'2',sourceAuthority:'collaborative discovery',parties:[{id:'p',name:'Fixture',seats:1}]});
 const s=selectLatest([ipu,wiki],cutoff);expect(s.held.id).toBe(wiki.id);expect(s.alternatives).toEqual(expect.arrayContaining([ipu.id,wiki.id]));
 // When both carry results the stronger authority still wins.
 const ipuFull={...ipu,parties:[{id:'q',name:'Fixture',seats:1}]};expect(selectLatest([ipuFull,wiki],cutoff).held.id).toBe(ipu.id);
});
// SYNTHETIC minimal PDF: one page, one uncompressed content stream.
function syntheticPdf(lines){
  const content='BT /F1 10 Tf '+lines.map(l=>`(${l.replace(/[()\\]/g,m=>'\\'+m)}) Tj T*`).join(' ')+' ET';
  const objs=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>',`<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
  let body='%PDF-1.4\n';objs.forEach((o,i)=>{body+=`${i+1} 0 obj\n${o}\nendobj\n`;});return Buffer.from(body+'trailer << /Root 1 0 R >>\n%%EOF','latin1');
}
test('captured official PDF evidence reaches validation as a labelled derived outcome',()=>{
  const pdf=syntheticPdf(['OFFICIAL 2024 PRESIDENTIAL GENERAL ELECTION RESULTS','General Election Date: 11/05/2024','Source: Synthetic','ELECTORAL VOTES CAST FOR FIXTURE ONE (A)','ELECTORAL VOTES CAST FOR FIXTURE TWO (B)','AA 6 6','BB 4 4','Total: 10 6 4','Total Electoral Votes Needed to Win = 6']);
  expect(pdfPages(pdf)[0].text).toContain('Total Electoral Votes Needed to Win = 6');
  const r={bytes:pdf,receipt:{url:'https://example.test/SYNTHETIC.pdf',retrievedAt:cutoff},reference:{sourceId:'official-results',key:'usa-fec-2024-pdf',sha256:'c'.repeat(64),receiptId:'d'.repeat(64)}};
  const {events:[e]}=PARSERS['usa-fec-electoral-votes'](src('us','usa-fec-electoral-votes',['usa-fec-2024-pdf']),{'usa-fec-2024-pdf':r},cutoff);
  expect(e.date).toBe('2024-11-05');expect(e.candidates.every(c=>c.elected===null)).toBe(true);expect(e.derivedOutcome).toMatchObject({elected:'FIXTURE ONE',complete:true});
  const m=metrics({...e,status:classifyStatus(e,cutoff)});expect(m.presidential.eligible).toBe(true);expect(m.presidential.value).toMatchObject({name:'FIXTURE ONE',derived:true});expect(m.presidential.formula).toMatch(/^derived:/);
  // Without the threshold statement there is no derived outcome, and no winner.
  const bare=syntheticPdf(['General Election Date: 11/05/2024','Source: Synthetic','ELECTORAL VOTES CAST FOR FIXTURE ONE (A)','ELECTORAL VOTES CAST FOR FIXTURE TWO (B)','Total: 10 6 4']);
  expect(()=>PARSERS['usa-fec-electoral-votes'](src('us','usa-fec-electoral-votes',['usa-fec-2024-pdf']),{'usa-fec-2024-pdf':{...r,bytes:bare}},cutoff)).toThrow(/threshold/);
});
test('a registered authority statement about the current legislature establishes only the matching election',()=>{
  const prof={rule:'registered-statement',subject:'Fixture assembly',authority:'Synthetic parliament',statement:String.raw`\b\w+ convocation of the Fixture Assembly was formed following the elections held on ([^.]{4,30}?\d{4})`};
  const html='<p>The seventh convocation of the Fixture Assembly was formed following the elections held on 1 st September 2024. Other text.</p>';
  expect(assessIndex(prof,html,{date:'2024-09-01'},raw(html),cutoff)).toMatchObject({kind:'latest-established',date:'2024-09-01'});
  expect(assessIndex(prof,html,{date:'2020-02-09'},raw(html),cutoff)).toBe(null);
  expect(assessIndex(prof,'<p>An election of the Fixture Assembly was held on 1 September 2024.</p>',{date:'2024-09-01'},raw(''),cutoff)).toBe(null);
});
test('an official court proclamation is a declared and qualified result for the runoff it names',()=>{
  const first=raw('<p>Elección presidencial verificada con fecha 16 de noviembre de 2025. Debe procederse a una segunda votación (balotaje), circunscrita a los candidatos que obtuvieron las dos más altas mayorías relativas en el proceso: Doña Fixture Uno Dos Don Fixture Tres Cuatro II. RIGOR</p>');
  const proc=raw('<p>En audiencia pública y solemne celebrada el lunes 05 de enero de 2026 en su sede, el Tribunal proclamó al ciudadano señor Fixture Tres Cuatro como Presidente Electo de la República. Hizo entrega de la sentencia mediante la cual se calificaron los comicios celebrados el 14 de diciembre de 2025, en segunda votación. Se dio lectura al acta, declarándose electo al señor Fixture Tres Cuatro para el período.</p>');
  const {events:[e]}=PARSERS['chl-tricel-president'](src('cl','chl-tricel-president',['chl-tricel-first-round','chl-tricel-proclamation']),{'chl-tricel-first-round':first,'chl-tricel-proclamation':proc},cutoff);
  expect([e.date,e.endDate]).toEqual(['2025-11-16','2025-12-14']);expect(e.candidates.find(c=>c.elected).name).toBe('Fixture Tres Cuatro');expect(e.candidates.every(c=>c.votes===null)).toBe(true);
  const st=classifyStatus(e,cutoff);expect(st.state).toBe('certified');expect(st.declaration.source).toBe('official');expect(st.certification.date).toBe('2026-01-05');
});
test('the Swiss parliament dispatch and archive give an indirect election and a year-offset latest index',()=>{
 const news=raw('<p>Mercredi 10 décembre 2025, 12h50 Dépêche ATS Berne</p><p>Fixture Person présidera la Confédération helvétique en 2026. L\'Assemblée fédérale l\'a élu mercredi par 203 voix sur 210 bulletins valables.</p>');
 const archive=raw('<table><tr><td>2026</td><td>Président de la Confédération</td><td>Fixture Person</td><td>UDC</td><td>VD</td><td>DFFR</td><td>203</td></tr><tr><td>2025</td><td>Présidente de la Confédération</td><td>Fixture Earlier</td><td>PLR</td><td>SG</td><td>DFF</td><td>168</td></tr></table>');
 const out=PARSERS['che-parlament-president'](src('ch','che-parlament-president',['che-president-2026-news','che-president-archive']),{'che-president-2026-news':news,'che-president-archive':archive},cutoff);
 const e=out.events[0];expect(e).toMatchObject({date:'2025-12-10',direction:'indirectly_elected'});expect(e.candidates[0]).toMatchObject({name:'Fixture Person',votes:203,elected:true});
 const ledger=[{iso3:'CHE',categories:{presidential:{latestHeld:{id:'e',date:'2025-12-10'}}}}];
 expect(indexAssertions(ledger,out.indexes.map(i=>({...i,sourceId:'ch'})),cutoff).assertions[0]).toMatchObject({kind:'latest-established',date:'2025-12-10'});
 // A dispatch whose vote total disagrees with the archive row is rejected.
 expect(()=>PARSERS['che-parlament-president'](src('ch','che-parlament-president',['che-president-2026-news','che-president-archive']),{'che-president-2026-news':news,'che-president-archive':raw(archive.bytes.toString().replace('>203<','>199<'))},cutoff)).toThrow(/does not match/);
});
test('the Czech results parser reads older page layouts and takes the election from the URL',()=>{
 const older=cz.replace('1st round','The 1st round').replace('2nd round','The 2nd round').replace(/id="pe2_t\d"/g,'').replace('13&ndash;14 January 2023','12 – 13 January 2018');
 const r={...raw(older,'https://volby.gov.cz/pls/prez2018/pe2?xjazyk=EN')};
 const {events:[e]}=PARSERS['cze-volby-president'](src('cz','cze-volby-president',['cze-prez2018-pe2']),{'cze-prez2018-pe2':r},cutoff);
 expect(e.sourceElectionId).toBe('prez2018');expect(e.date).toBe('2018-01-12');expect(e.candidates.find(c=>c.elected).name).toBe('Fixture Winner');
});
test('write-once evidence repairs an interrupted zero-byte write but refuses a real collision',async()=>{
 const {immutable}=await import('../scripts/ingestion/util.js');
 const fsp=await import('node:fs/promises'),os=await import('node:os'),p=await import('node:path');
 const dir=await fsp.mkdtemp(p.join(os.tmpdir(),'immutable-')),file=p.join(dir,'blob');
 await fsp.writeFile(file,'');await immutable(file,Buffer.from('SYNTHETIC evidence'));expect(await fsp.readFile(file,'utf8')).toBe('SYNTHETIC evidence');
 await immutable(file,Buffer.from('SYNTHETIC evidence'));
 await expect(immutable(file,Buffer.from('different bytes'))).rejects.toThrow(/collision/);
 expect((await fsp.readdir(dir)).filter(f=>f.endsWith('.tmp'))).toEqual([]);
 await fsp.rm(dir,{recursive:true});
});
test('an offline authority pass replays the recorded online attempts, failures included',async()=>{
 const {acquireAuthorityPass}=await import('../scripts/catalog/authority-evidence.js');
 const fsp=await import('node:fs/promises'),os=await import('node:os'),p=await import('node:path');
 const root=await fsp.mkdtemp(p.join(os.tmpdir(),'authority-')),cache=p.join(root,'cache');
 await fsp.mkdir(p.join(root,'data'),{recursive:true});
 await fsp.writeFile(p.join(root,'data/jurisdictions.json'),JSON.stringify({jurisdictions:[{iso3:'AAA',scope:'core'},{iso3:'BBB',scope:'core'}]}));
 await fsp.writeFile(p.join(root,'data/latest-authorities.json'),JSON.stringify({version:1,nonApplicabilityRules:[],profiles:[
  {authority:'Synthetic A',categories:['legislative'],country:'AAA',domains:['a.example.test'],indexUrl:'https://a.example.test/index',rule:'most-recent-statement'},
  {authority:'Synthetic B',categories:['legislative'],country:'BBB',domains:['b.example.test'],indexUrl:'https://b.example.test/index',rule:'most-recent-statement'}]}));
 let clock='2026-10-05T18:00:00.000Z';
 const fetchImpl=async url=>{if(url.includes('b.example'))throw Object.assign(new Error('HTTP 403 for '+url),{status:403});
  return new Response('<p>SYNTHETIC index</p>',{status:200,headers:{'content-type':'text/html'}});};
 const online=await acquireAuthorityPass(root,[],{cache,cutoff,fetchImpl,now:()=>clock});
 clock='2026-10-09T00:00:00.000Z';
 const offline=await acquireAuthorityPass(root,[],{cache,cutoff,offline:true,fetchImpl:()=>{throw new Error('network used offline');}});
 const pick=r=>r.attempts.filter(a=>a.url).map(({replayed,...a})=>a);
 expect(pick(offline)).toEqual(pick(online));
 expect(offline.attempts.find(a=>a.country==='BBB'&&a.url)).toMatchObject({ok:false,error:/HTTP 403/,replayed:/Recorded online failure/});
 expect(offline.attempts.find(a=>a.country==='AAA'&&a.url).checkTime).toBe('2026-10-05T18:00:00.000Z');
});
test('an offline replay reports a link the recorded pass never saw as not attempted, identically on every run',async()=>{
 const {acquireAuthorityPass}=await import('../scripts/catalog/authority-evidence.js');
 const fsp=await import('node:fs/promises'),os=await import('node:os'),p=await import('node:path');
 const root=await fsp.mkdtemp(p.join(os.tmpdir(),'authority-')),cache=p.join(root,'cache');
 await fsp.mkdir(p.join(root,'data'),{recursive:true});
 await fsp.writeFile(p.join(root,'data/jurisdictions.json'),JSON.stringify({jurisdictions:[{iso3:'AAA',scope:'core'}]}));
 await fsp.writeFile(p.join(root,'data/latest-authorities.json'),JSON.stringify({version:1,nonApplicabilityRules:[],profiles:[
  {authority:'Synthetic A',categories:['legislative'],country:'AAA',domains:['a.example.test'],rule:'most-recent-statement'}]}));
 // Online: no record cites an authority link, so nothing is fetched.
 const online=await acquireAuthorityPass(root,[],{cache,cutoff,fetchImpl:()=>{throw new Error('unexpected fetch');}});
 expect(online.attempts.filter(a=>a.url)).toEqual([]);
 // Later code derives a record citing an authority link: offline it was not attempted.
 const ev=[{country:'AAA',category:'legislative',holdingStatus:'held',date:'2025-01-01',id:'e1',rawReferenceUrls:['https://a.example.test/results']}];
 const runs=[];for(let i=0;i<2;i++)runs.push(await acquireAuthorityPass(root,ev,{cache,cutoff,offline:true}));
 const [a,b]=runs.map(r=>r.attempts.filter(x=>x.url));
 expect(a).toHaveLength(1);expect(a[0]).toMatchObject({ok:false,checkTime:null,error:/Not attempted in the recorded online pass/});
 expect(b.map(({replayed,...x})=>x)).toEqual(a.map(({replayed,...x})=>x));
});
test('the Czech record note names its own election year, not a fixed one',()=>{
 const {events:[e]}=PARSERS['cze-volby-president'](src('cz','cze-volby-president',['cze-prez2013-pe2']),{'cze-prez2013-pe2':raw(cz,'https://volby.gov.cz/pls/prez2013/pe2?xjazyk=EN')},cutoff);
 expect(e.asOfCutoff).toMatch(/completed 2013 count/);expect(e.sourceElectionId).toBe('prez2013');
});
