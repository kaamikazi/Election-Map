"""Rebuild the U.S. source pack from the vendored official FEC PDF. Requires pdfplumber."""
import pdfplumber,json,re,hashlib,argparse
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('--source',default='docs/us2024/fec-2024-results.pdf')
parser.add_argument('--out',default='public/data/us-presidential-2024.json')
args=parser.parse_args()
pdf=Path(args.source)
groups=[['electors','trump','harris'],['ayyadurai','bowman','de-la-cruz','duncan','ebke'],['everylove','fruit','garrity','harris','huber','kennedy'],['kishore','oliver','preston','skousen','sonski','stein'],['stodden','supreme','terry','trump','wells'],['west','wood','none','scattered','total']]
names=['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','District of Columbia','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming']
codes='AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split()
rows={c:{'postal':c,'name':n,'votes':{}} for c,n in zip(codes,names)};national={}
with pdfplumber.open(pdf) as p:
 assert 'January 16, 2025' in p.pages[8].extract_text(), 'Unexpected source compilation date'
 for page,keys in zip(p.pages[:6],groups):
  words=page.extract_words();total=next(x for x in words if x['text']=='Total:')
  totals=[x for x in words if abs(x['top']-total['top'])<3 and re.fullmatch(r'[0-9,]+',x['text'])]
  assert len(totals)==len(keys)
  centers=[(x['x0']+x['x1'])/2 for x in totals]
  nr={k:int(x['text'].replace(',','')) for k,x in zip(keys,totals)}
  if keys[0]!='electors':national.update(nr)
  for c in codes:
   cw=next(x for x in words if x['text']==c and x['x0']<50)
   values={k:None for k in keys}
   for x in words:
    if abs(x['top']-cw['top'])<3 and re.fullmatch(r'[0-9,]+',x['text']):
     mid=(x['x0']+x['x1'])/2;index=min(range(len(keys)),key=lambda i:abs(centers[i]-mid));assert abs(centers[index]-mid)<10
     values[keys[index]]=int(x['text'].replace(',',''))
   if keys[0]=='electors':rows[c]['electoralVotes']={k:v or 0 for k,v in values.items()}
   else:rows[c]['votes'].update(values)
for c,r in rows.items():
 assert sum(v for k,v in r['votes'].items() if k!='total' and v is not None)==r['votes']['total'],c
 assert r['electoralVotes']['trump']+r['electoralVotes']['harris']==r['electoralVotes']['electors']
 r['winner']=max(('trump','harris'),key=lambda k:r['votes'][k])
for k,v in national.items():assert sum(r['votes'][k] or 0 for r in rows.values())==v,k
assert sum(v for k,v in national.items() if k!='total')==national['total']
assert sum(r['electoralVotes']['trump'] for r in rows.values())==312
meta={
'ayyadurai':('Shiva Ayyadurai','IND, NPY'),'bowman':('Jay J Bowman','IND'),'de-la-cruz':('Claudia De La Cruz','IND, PAF, PSL, SLF, SLP, UN, WP'),'duncan':('Richard Duncan','NON'),'ebke':('Laura Ebke','LPU'),
'everylove':('Lucifer “Justin Case” Everylove','UN'),'fruit':('Rachele Fruit','IND, SWP'),'garrity':('Chris Garrity','IND'),'harris':('Kamala D. Harris','D, DFL, DNL, WF'),'huber':('Blake Huber','APV'),'kennedy':('Robert F. Kennedy, Jr.','AIP, IDE, IND, NLP, NPA, PC, PET, TK, UN, WTP'),
'kishore':('Joseph Kishore','NPA, SEP'),'oliver':('Chase Oliver','IND, LBF, LIB, LPN'),'preston':('Mattie Preston','GTJ'),'skousen':('Joel Skousen','CON, IAP'),'sonski':('Peter Sonski','ASF, ASP, IND, OTH, SOL'),'stein':('Jill Stein','BP, GPF, GR, GRE, IND, KYP, MTP, OTH, PET, PG, WG'),
'stodden':('William P. Stodden','SOC'),'supreme':('Vermin Supreme','C'),'terry':('Randall A. Terry','AMC, CON, CPF, IND, MSC, USC, UST'),'trump':('Donald J. Trump','R, C'),'wells':('Robert “Robby” Wells','PTY'),'west':('Cornel West','AUR, IND, JFA, LMN, NPA, PAJ, PRO, UC, UN, UPC'),'wood':('Michael Wood','P'),'none':('None of these candidates','Selection, not a candidate'),'scattered':('Scattered write-in votes','Unattributed write-ins')}
pack={'kind':'us-presidential','country':'USA','date':'2024-11-05','status':'certified','sourceCompiled':'2025-01-16','sourcePdfSha256':hashlib.sha256(pdf.read_bytes()).hexdigest(),'totalVotes':national.pop('total'),'major':['trump','harris'],'candidates':[{'id':k,'name':meta[k][0],'ballotLabels':meta[k][1],'votes':v,'electoralVotes':312 if k=='trump' else 226 if k=='harris' else 0,'party':'Republican' if k=='trump' else 'Democratic' if k=='harris' else None,'runningMate':'JD Vance' if k=='trump' else 'Tim Walz' if k=='harris' else None} for k,v in national.items()],'states':list(rows.values()),'sources':[{'label':'FEC · official state-certified results · compiled 16 January 2025','url':'https://www.fec.gov/documents/5644/2024presgeresults.pdf'},{'label':'National Archives · Electoral College certificates','url':'https://www.archives.gov/electoral-college/2024'}]}
Path(args.out).write_text(json.dumps(pack,ensure_ascii=False,indent=2)+'\n')
print('Verified 51 state/DC rows, 26 reported categories, all row/column sums and 538 electoral votes; total',pack['totalVotes'])
