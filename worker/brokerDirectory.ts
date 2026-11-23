/** Optional third-party broker catalogue enrichment, no credentials or user IDs sent.
 * The provider is not MetaQuotes and its catalogue may be old/incomplete.
 * Failures should not prevent direct entry of exact broker/server identifiers.
 */
type ListedBroker={name:string;servers:{name:string;type:'demo'|'real'|'unknown'}[]};
const DIRECTORY_URL='https://broker-servers.apis.tradevps.net/';
const safe=(v:unknown,max=128):v is string=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
export async function optionalBrokerDirectory(get:typeof fetch=fetch):Promise<{
  source:string;verified:false;updatedAt:string|null;brokers:ListedBroker[];
}>{
  const empty={source:'unavailable',verified:false as const,updatedAt:null,brokers:[] as ListedBroker[]};
  try {
    const signal=AbortSignal.timeout(4500);
    const response=await get(DIRECTORY_URL,{method:'GET',signal,headers:{accept:'application/json'}});
    if(!response.ok||Number(response.headers.get('content-length')||0)>300000) return empty;
    const payload:unknown=await response.json();
    if(!payload||typeof payload!=='object'||!('brokers' in payload))return empty;
    const value=payload as {brokers:unknown;metadata?:{lastUpdated?:unknown}};
    if(!Array.isArray(value.brokers)||value.brokers.length>200)return empty;
    const brokers:ListedBroker[]=[];
    for(const raw of value.brokers){
      if(!raw||typeof raw!=='object')continue;
      const item=raw as {name?:unknown;servers?:unknown};
      if(!safe(item.name)||!Array.isArray(item.servers))continue;
      const servers:ListedBroker['servers']=[];
      for(const original of item.servers.slice(0,100)){
        if(!original||typeof original!=='object')continue;
        const entry=original as {name?:unknown;type?:unknown};
        if(!safe(entry.name))continue;
        servers.push({name:entry.name,
          type:entry.type==='demo'||entry.type==='real'?entry.type:'unknown'});
      }
      brokers.push({name:item.name,servers});
    }
    return {source:'third-party-catalogue',verified:false,
      updatedAt:safe(value.metadata?.lastUpdated,40)?value.metadata!.lastUpdated as string:null,
      brokers};
  }catch{return empty;}
}
