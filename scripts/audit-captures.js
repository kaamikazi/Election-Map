#!/usr/bin/env node
/**
 * Accounts for every page captured by the authority pass and the official
 * results batch, from the raw bytes. Each capture ends in exactly one class:
 *
 *   extracted-linked        an assertion or official record reached validation
 *   duplicate-or-superseded same bytes as an earlier capture, or a stale fallback
 *   block-or-error-page     interstitial, access denial, 404/500 body, near-empty page
 *   extraction-failure      a document the pipeline cannot read (image-only or
 *                           non-Unicode PDF, script-rendered page)
 *   unrelated               no mention of the selected election (year/date)
 *   insufficient-evidence   mentions the selected election but states nothing
 *                           that a rule can use (no latest/result statement)
 *
 * An HTTP 200 or an official hostname alone is never treated as evidence.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {ROOT} from './lib/registry.js';
import {readJson,json} from './ingestion/util.js';
import {replayReference} from './ingestion/acquire.js';
import {readCatalog} from './catalog/engine.js';
import {text} from './catalog/html.js';
import {pdfPages} from './catalog/pdf.js';
import {textDates} from './catalog/authority-evidence.js';

const BLOCK=/\b(?:just a moment|enable javascript|access denied|forbidden|captcha|attention required|request rejected|are you a robot|checking your browser|page not found|404 not found|not found|service unavailable|bad gateway|error 5\d\d|cloudflare|incapsula|temporarily unavailable|has been removed)\b/i;
const MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december'];

export async function auditCaptures(root=ROOT,{cache=path.join(root,'data/raw/elections')}={}){
  const authority=await readJson(path.join(root,'build/latest-evidence/authority-audit.json'));
  const pointer=await readJson(path.join(cache,'official-results.json'),null);
  const official=pointer?await readJson(path.join(cache,'official-batches',`${pointer.batchId}.json`)):{attempts:[]};
  const {ledger,events}=await readCatalog(path.join(root,'public/data/catalog'));
  const linkedKeys=new Set(events.flatMap(e=>(e.citations||[]).map(c=>c.sha256)));
  const assertionKeys=new Set(authority.assertions.map(a=>a.citation?.sha256).filter(Boolean));
  const captures=[...authority.attempts.filter(a=>a.reference).map(a=>({...a,pass:'authority'})),
    ...official.attempts.filter(a=>a.reference).map(a=>({...a,pass:'official-results'}))]
    .sort((a,b)=>`${a.country}/${a.category}/${a.url}`.localeCompare(`${b.country}/${b.category}/${b.url}`));
  const seen=new Map(),rows=[];
  for(const c of captures){
    const raw=await replayReference(cache,c.reference),bytes=raw.bytes,isPdf=bytes.subarray(0,5).toString('latin1')==='%PDF-';
    const entry=ledger.find(j=>j.iso3===c.country),cats=String(c.category||'').split('+');
    const held=cats.map(k=>entry?.categories[k]?.latestHeld).find(Boolean)||null;
    const base={country:c.country,category:c.category,pass:c.pass,url:c.url,sha256:c.reference.sha256,receiptId:c.reference.receiptId,bytes:bytes.length,
      checkTime:c.checkTime||raw.receipt.retrievedAt,selectedEvent:held?{id:held.id,date:held.date,sourceId:held.sourceId}:null,previousAssessment:c.assessment||c.error||null};
    let content='',pages=null,klass,detail;
    if(isPdf){try{pages=pdfPages(bytes);content=pages.map(p=>`[page ${p.page}] ${p.text}`).join('\n');}catch(e){content='';}}
    else content=text(bytes.toString('utf8'));
    const lower=content.toLowerCase();
    const linked=c.pass==='official-results'?(c.ok&&(linkedKeys.has(c.reference.sha256)||/index/.test(c.sourceId)))
      :/^(?:qualifying-latest-evidence|sourced-non-applicability)$/.test(c.assessment||'')||assertionKeys.has(c.reference.sha256);
    if(linked){klass='extracted-linked';detail=c.assessment||'Parsed by a registered official-results parser'; }
    else if(seen.has(c.reference.sha256)){klass='duplicate-or-superseded';detail=`Same bytes as ${seen.get(c.reference.sha256)}`;}
    else if(/predates this cutoff/.test(c.assessment||'')||c.staleFallback){klass='duplicate-or-superseded';detail='Refresh failed; earlier capture retained for audit only';}
    else if(isPdf&&pages&&pages.length&&content.replace(/\[page \d+\]/g,'').replace(/\s+/g,'').length<pages.length*40){klass='extraction-failure';detail=`Image-only PDF (${pages.length} pages, no text layer); OCR is not available in this pipeline`;}
    else if(isPdf&&(content.match(/[A-Za-zÀ-ž]/g)||[]).length<content.replace(/\s+/g,'').length*0.5){klass='extraction-failure';detail='PDF text uses fonts without a Unicode map; extracted glyphs are not readable text';}
    else if(!isPdf&&BLOCK.test(content.slice(0,1500))){klass='block-or-error-page';detail=content.match(BLOCK)[0];}
    // A large response with almost no text is an application shell rendered by
    // JavaScript: the content exists but this pipeline cannot read it.
    else if(!isPdf&&content.length<300&&bytes.length>=8000){klass='extraction-failure';detail=`Script-rendered page: ${bytes.length} bytes of HTML but ${content.length} characters of text`;}
    else if(!isPdf&&content.length<300){klass='block-or-error-page';detail=`Near-empty response (${bytes.length} bytes, ${content.length} characters of text)`;}
    else{
      const year=held?.date.slice(0,4),d=held?.date;
      const forms=d?[d,`${Number(d.slice(8))} ${MONTHS[Number(d.slice(5,7))-1]} ${year}`,`${MONTHS[Number(d.slice(5,7))-1]} ${Number(d.slice(8))}, ${year}`,`${d.slice(8)}.${d.slice(5,7)}.${year}`,`${Number(d.slice(8))}.${Number(d.slice(5,7))}.${year}`]:[];
      const dateHit=forms.find(f=>lower.includes(f.toLowerCase()))||(content&&d&&textDates(content).includes(d)?d:null);
      if(!held){klass='unrelated';detail='No selected election for this country/category to relate the page to';}
      else if(!dateHit&&!(year&&new RegExp(`\\b${year}\\b`).test(content))){klass='unrelated';detail=`No mention of ${year} or ${d}`;}
      else{klass='insufficient-evidence';const at=lower.indexOf((dateHit||year).toLowerCase());
        detail=dateHit?`Mentions the selected polling date (${dateHit}) but states no latest-election or result fact a rule can use`:`Mentions ${year} only; no polling date or result statement`;
        base.locator=(pages?(content.slice(0,at).match(/\[page (\d+)\]/g)||[]).at(-1)||'':'')+' …'+content.slice(Math.max(0,at-120),at+180).replace(/\s+/g,' ')+'…';}
    }
    if(!seen.has(c.reference.sha256))seen.set(c.reference.sha256,`${c.country}/${c.category} ${c.url}`);
    rows.push({...base,class:klass,detail,format:isPdf?'pdf':'html'});
  }
  const summary=Object.fromEntries(['extracted-linked','duplicate-or-superseded','unrelated','block-or-error-page','extraction-failure','insufficient-evidence'].map(k=>[k,rows.filter(r=>r.class===k).length]));
  const out={version:1,cutoff:authority.cutoff,captures:rows.length,uniqueBytes:seen.size,summary,rows};
  await fs.writeFile(path.join(root,'build/latest-evidence/capture-accounting.json'),json(out));
  return out;
}
if(import.meta.url===`file:///${process.argv[1].replace(/\\/g,'/')}`||process.argv[1]?.endsWith('audit-captures.js')){
  const out=await auditCaptures();console.log(JSON.stringify({cutoff:out.cutoff,captures:out.captures,uniqueBytes:out.uniqueBytes,summary:out.summary},null,2));
}
