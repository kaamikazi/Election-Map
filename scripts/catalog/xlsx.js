/** Read the registered FEC OOXML worksheet. Built-in ZIP/DEFLATE only; no paid service. */
import {inflateRawSync} from 'node:zlib';
import {text} from './html.js';
export function xlsxRows(bytes){
  let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){end=i;break;}
  if(end<0)throw new Error('Invalid XLSX ZIP directory');
  const count=bytes.readUInt16LE(end+10),files=new Map();let pos=bytes.readUInt32LE(end+16);
  for(let i=0;i<count;i++){
    if(bytes.readUInt32LE(pos)!==0x02014b50)throw new Error('Invalid XLSX central directory');
    const method=bytes.readUInt16LE(pos+10),compressed=bytes.readUInt32LE(pos+20),size=bytes.readUInt32LE(pos+24),nameLength=bytes.readUInt16LE(pos+28),extra=bytes.readUInt16LE(pos+30),comment=bytes.readUInt16LE(pos+32),offset=bytes.readUInt32LE(pos+42);
    const name=bytes.subarray(pos+46,pos+46+nameLength).toString();
    if(size>10*1024*1024||offset+30>=bytes.length)throw new Error('Oversized/invalid XLSX entry');
    const start=offset+30+bytes.readUInt16LE(offset+26)+bytes.readUInt16LE(offset+28),body=bytes.subarray(start,start+compressed);
    if(name==='xl/sharedStrings.xml'||name==='xl/worksheets/sheet1.xml'){
      const decoded=method===0?body:method===8?inflateRawSync(body,{maxOutputLength:10*1024*1024}):null;
      if(!decoded||decoded.length!==size)throw new Error('Unsupported/truncated XLSX entry');files.set(name,decoded.toString());
    }
    pos+=46+nameLength+extra+comment;
  }
  const strings=[...(files.get('xl/sharedStrings.xml')||'').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m=>text(m[1]));
  const worksheet=files.get('xl/worksheets/sheet1.xml');if(!worksheet)throw new Error('FEC worksheet missing');
  return [...worksheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(m=>{
    const row=[];for(const c of m[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)){
      const ref=c[1].match(/\br="([A-Z]+)\d+"/)?.[1];if(!ref)continue;let index=0;for(const x of ref)index=index*26+x.charCodeAt(0)-64;
      const v=c[2].match(/<v>([\s\S]*?)<\/v>/)?.[1];
      row[index-1]=/\bt="s"/.test(c[1])?strings[Number(v)]:v!==undefined&&v.trim()!==''?Number(v):null;
    }return row;
  });
}
