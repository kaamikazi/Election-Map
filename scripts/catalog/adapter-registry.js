/** Add a parser here and a source definition; the transaction/import engine stays generic. */
import {parseIPU,parseFrance,parseFEC} from './adapters.js';
export const CATALOG_ADAPTERS={
  'ipu-jsonapi-v1':({batch,cutoff})=>parseIPU(batch,cutoff),
  'france-president-html-v1':({batch})=>({events:parseFrance(batch)}),
  'fec-presidential-xlsx-v1':({batch})=>({events:parseFEC(batch)}),
  'un-membership-nav-v1':()=>({events:[]})
};
export function parseCatalogSources(batch,cutoff){
  const result={events:[],structures:[],systems:[]};
  for(const source of batch.registry.sources){
    const adapter=CATALOG_ADAPTERS[source.parser];if(!adapter)throw new Error(`Unregistered catalog parser: ${source.parser}`);
    const parsed=adapter({source,batch,cutoff});
    for(const field of ['events','structures','systems'])result[field].push(...(parsed[field]||[]));
  }
  return result;
}
