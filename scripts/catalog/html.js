/** Small, source-specific HTML helpers; executable source content is never run. */
// Named entities seen in registered official publications (German/French/Spanish
// result pages). Unknown names are left as written.
const NAMED={auml:'ä',ouml:'ö',uuml:'ü',Auml:'Ä',Ouml:'Ö',Uuml:'Ü',szlig:'ß',eacute:'é',egrave:'è',ecirc:'ê',aacute:'á',agrave:'à',acirc:'â',iacute:'í',oacute:'ó',uacute:'ú',ntilde:'ñ',ccedil:'ç',Eacute:'É',ndash:'–',mdash:'—',shy:'',laquo:'«',raquo:'»',rsquo:'’',lsquo:'‘',rdquo:'”',ldquo:'„',hellip:'…',euro:'€',copy:'©',deg:'°'};
export function text(html) {
  return String(html || '').replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ').replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => String.fromCodePoint(n[0].toLowerCase() === 'x' ? parseInt(n.slice(1),16) : Number(n)))
    .replace(/&([a-z]+);/gi,(m,n)=>NAMED[n]??m).replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&apos;|&#39;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')
    // Zero-width characters (U+200B…, BOM) split table cells invisibly.
    .replace(/[\u200b-\u200d\ufeff]/g,'').replace(/\s+/g,' ').trim();
}
export function tables(html) {
  return [...String(html).matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(m =>
    [...m[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(r=>[...r[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c=>text(c[1]))));
}
/**
 * Every <table> in document order with nesting resolved. `html` is the table's
 * own content with nested tables cut out, so row/cell regexes see only that
 * level; `children` index the nested blocks. A lazy <table>…</table> match
 * stops at the first nested close tag and silently truncates infoboxes.
 */
export function tableBlocks(html) {
  const source=String(html||''),blocks=[],stack=[];
  for(const m of source.matchAll(/<table\b([^>]*)>|<\/table\s*>/gi)){
    if(m[0][1]!=='/'){const block={attrs:m[1]||'',depth:stack.length,start:m.index,contentStart:m.index+m[0].length,cuts:[],children:[],parent:stack.at(-1)?.index??null,index:blocks.length};
      blocks.push(block);stack.at(-1)?.children.push(block.index);stack.push(block);continue;}
    const block=stack.pop();if(!block)continue;
    block.end=m.index+m[0].length;
    let inner='',at=block.contentStart;for(const [s,e]of block.cuts){inner+=source.slice(at,s);at=e;}inner+=source.slice(at,m.index);
    block.html=inner;stack.at(-1)?.cuts.push([block.start,block.end]);
  }
  for(const b of stack){b.html=source.slice(b.contentStart);b.end=source.length;}
  return blocks.map(({cuts,contentStart,...b})=>b);
}
/** A block followed by all of its descendants, in document order. */
export function withDescendants(blocks,index){
  const out=[blocks[index]];for(const child of blocks[index].children)out.push(...withDescendants(blocks,child));return out;
}
export const links =html => [...String(html).matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map(m=>m[1].replace(/&amp;/g,'&'));
