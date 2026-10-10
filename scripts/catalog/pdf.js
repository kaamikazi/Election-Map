/**
 * Minimal PDF text extraction for registered official publications.
 *
 * Reads page content streams (FlateDecode or uncompressed) in /Pages-tree
 * order, applies each font's ToUnicode CMap when present, and returns text per
 * page so a locator can cite "page N". It does not OCR: image-only pages yield
 * no text and are reported as such. Nothing in the PDF is executed.
 */
import zlib from 'node:zlib';

const latin=b=>Buffer.from(b).toString('latin1');
const ref=(dict,key)=>{const m=dict.match(new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`));return m?Number(m[1]):null;};
const refs=(dict,key)=>{const m=dict.match(new RegExp(`/${key}\\s*(\\[[^\\]]*\\]|\\d+\\s+\\d+\\s+R)`));return m?[...m[1].matchAll(/(\d+)\s+\d+\s+R/g)].map(x=>Number(x[1])):[];};

function decode(obj){
  if(!obj?.stream)return null;
  const filters=(obj.dict.match(/\/Filter\s*(\[[^\]]*\]|\/\w+)/)?.[1]||'').match(/\/\w+/g)||[];
  let data=obj.stream;
  for(const f of filters){
    if(f!=='/FlateDecode')return null;
    try{data=zlib.inflateSync(data);}catch{try{data=zlib.inflateRawSync(data);}catch{return null;}}
  }
  return data;
}
function objects(buf){
  const src=latin(buf),out=new Map();
  for(const m of src.matchAll(/(\d+)\s+(\d+)\s+obj\b/g)){
    const start=m.index+m[0].length,end=src.indexOf('endobj',start);if(end<0)continue;
    const body=src.slice(start,end),sm=body.match(/stream\r?\n/);let dict=body,stream=null;
    if(sm){dict=body.slice(0,sm.index);const s0=start+sm.index+sm[0].length;let s1=src.indexOf('endstream',s0);
      const len=dict.match(/\/Length\s+(\d+)(\s+\d+\s+R)?/);
      if(len&&!len[2]){const n=Number(len[1]);if(/^\r?\n?endstream/.test(src.slice(s0+n,s0+n+12)))s1=s0+n;}
      stream=buf.subarray(s0,s1);}
    out.set(Number(m[1]),{dict,stream});
  }
  // Compressed object streams (PDF 1.5+).
  for(const o of [...out.values()]){
    if(!/\/Type\s*\/ObjStm/.test(o.dict))continue;const data=decode(o);if(!data)continue;
    const first=Number(o.dict.match(/\/First\s+(\d+)/)?.[1]||0),body=latin(data),head=body.slice(0,first).trim().split(/\s+/).map(Number);
    for(let i=0;i+1<head.length;i+=2){const s=first+head[i+1],e=i+3<head.length?first+head[i+3]:body.length;if(!out.has(head[i]))out.set(head[i],{dict:body.slice(s,e),stream:null});}
  }
  return out;
}
function cmap(text){
  const map=new Map(),hex=h=>parseInt(h,16),uni=h=>{const cps=[];for(let i=0;i<h.length;i+=4)cps.push(hex(h.slice(i,i+4)));try{return String.fromCodePoint(...cps);}catch{return '';}};
  for(const b of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))for(const m of b[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g))map.set(hex(m[1]),uni(m[2]));
  for(const b of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))for(const m of b[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]+>|\[[^\]]*\])/g)){
    const lo=hex(m[1]),hi=hex(m[2]);
    if(m[3].startsWith('[')){const list=[...m[3].matchAll(/<([0-9a-fA-F]+)>/g)].map(x=>uni(x[1]));for(let c=lo;c<=hi&&c-lo<list.length;c++)map.set(c,list[c-lo]);}
    else{const base=hex(m[3].slice(1,-1));for(let c=lo;c<=hi&&c-lo<65536;c++){try{map.set(c,String.fromCodePoint(base+(c-lo)));}catch{}}}
  }
  const span=text.match(/begincodespacerange\s*<([0-9a-fA-F]+)>/)?.[1].length;
  return {map,width:span?span/2:2};
}
const unescape=s=>s.replace(/\\([nrtbf()\\]|[0-7]{1,3}|\r?\n)/g,(m,c)=>c==='n'?'\n':c==='r'?'\r':c==='t'?'\t':c==='b'?'\b':c==='f'?'\f':/^[0-7]+$/.test(c)?String.fromCharCode(parseInt(c,8)):/\n/.test(c)?'':c);
function showText(content,fonts){
  let font=null,out='',array=null;
  const map=raw=>{const f=fonts.get(font);if(!f)return raw;let o='';
    if(f.width===1){for(const ch of raw)o+=f.map.get(ch.charCodeAt(0))??ch;return o;}
    for(let i=0;i+1<raw.length;i+=2)o+=f.map.get(raw.charCodeAt(i)*256+raw.charCodeAt(i+1))??'';return o;};
  const tokens=/\/([\w.+-]+)\s+[\d.]+\s+Tf|\((?:\\[\s\S]|[^\\)])*\)|<[0-9a-fA-F\s]*>|\[|\]|\bT[Jj]\b|\bT\*|\bT[dD]\b|\bTm\b|\bET\b/g;
  for(const m of content.matchAll(tokens)){
    const t=m[0];
    if(m[1]){font=m[1];continue;}
    if(t==='['){array=[];continue;}
    if(t===']')continue;
    if(t[0]==='('||t[0]==='<'){const raw=t[0]==='('?unescape(t.slice(1,-1)):Buffer.from(t.slice(1,-1).replace(/\s+/g,'').padEnd(2,'0'),'hex').toString('latin1');
      const v=map(raw);if(array)array.push(v);else out+=v;continue;}
    if(t==='TJ'){out+=(array||[]).join('');array=null;continue;}
    out+=t==='ET'?'\n':' ';
  }
  return out;
}
/** [{page, text}] in document page order. */
export function pdfPages(buf){
  if(!latin(buf.subarray(0,8)).startsWith('%PDF'))throw new Error('Not a PDF');
  const objs=objects(buf),order=[];
  const root=[...objs.values()].find(o=>/\/Type\s*\/Catalog\b/.test(o.dict));
  const walk=(id,depth=0)=>{const o=objs.get(id);if(!o||depth>32)return;
    if(/\/Type\s*\/Pages\b/.test(o.dict))for(const k of refs(o.dict,'Kids'))walk(k,depth+1);else if(/\/Type\s*\/Page\b/.test(o.dict))order.push(id);};
  if(root)walk(ref(root.dict,'Pages'));
  if(!order.length)for(const [id,o]of objs)if(/\/Type\s*\/Page\b/.test(o.dict))order.push(id);
  const fontCache=new Map();
  const resources=(dict,depth=0)=>{const r=ref(dict,'Resources');if(r)return objs.get(r)?.dict||'';const inline=dict.match(/\/Resources\s*(<<[\s\S]*)/)?.[1];if(inline)return inline;
    const parent=ref(dict,'Parent');return parent&&depth<32?resources(objs.get(parent)?.dict||'',depth+1):'';};
  const fontsFor=dict=>{const res=resources(dict),fonts=new Map();
    const fref=res.match(/\/Font\s+(\d+)\s+\d+\s+R/);const fdict=fref?objs.get(Number(fref[1]))?.dict||'':res.match(/\/Font\s*<<([\s\S]*?)>>/)?.[1]||'';
    for(const m of fdict.matchAll(/\/([\w.+-]+)\s+(\d+)\s+\d+\s+R/g)){const fid=Number(m[2]);
      if(!fontCache.has(fid)){const fo=objs.get(fid),tu=fo&&ref(fo.dict,'ToUnicode'),data=tu?decode(objs.get(tu)):null;fontCache.set(fid,data?cmap(latin(data)):null);}
      if(fontCache.get(fid))fonts.set(m[1],fontCache.get(fid));}
    return fonts;};
  return order.map((id,i)=>{const o=objs.get(id);
    const content=refs(o.dict,'Contents').map(c=>decode(objs.get(c))??(objs.get(c)?.stream||null)).filter(Boolean).map(latin).join('\n');
    return {page:i+1,text:showText(content,fontsFor(o.dict)).replace(/[ \t]+/g,' ').replace(/\s*\n\s*/g,'\n').trim()};});
}
/** Whole-document text with "[page N]" markers that serve as locators. */
export function pdfText(buf){return pdfPages(buf).map(p=>`[page ${p.page}] ${p.text}`).join('\n');}
