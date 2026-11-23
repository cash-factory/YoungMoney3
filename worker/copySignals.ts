/** Pure source-observation diff. Source history is journal evidence, NOT a
 * command to replay stale market executions after reconnect. Final exits and
 * pending cancellations require explicit fresh broker-order/deal proof.
 */
export type SourceItem={
  key:string;kind:'position'|'pending';symbol:string;type:number;
  volume:number;price:number;sl:number;tp:number;stoplimit:number;
  expiration:number;time_ms:number;
};
export type SourceProof={key:string;kind:'closed'|'reduced'|'cancelled';ticket:string;time_ms:number};
export type CopySignal={
  source_key:string;action:'open_market'|'place_pending'|'modify_sl_tp'|'modify_pending'|
    'cancel_pending'|'reduce_position'|'close_position';
  fields:SourceItem;source_volume:number;
  revision_kind:string;
};
function different(a:SourceItem,b:SourceItem,keys:(keyof SourceItem)[]) {
  return keys.some(k=>a[k]!==b[k]);
}
export function deriveCopySignals(before:SourceItem[],after:SourceItem[],proofs:SourceProof[],nowMs:number,maxAgeMs=12000):CopySignal[] {
  const old=new Map(before.map(x=>[x.key,x])),current=new Map(after.map(x=>[x.key,x]));
  // A source pending order disappearing while a new position appears may be
  // the pending order being triggered. Never ALSO submit a market order for
  // the same instrument without independently proving a distinct entry.
  // Future reconciliation can link filled source order->position ID.
  const vanishedPendingSymbols=new Set(before.filter(x=>x.kind==='pending'&&!current.has(x.key))
    .map(x=>x.symbol));
  const confirmed=(key:string,kind:SourceProof['kind'])=>proofs.some(p=>p.key===key&&p.kind===kind&&
    /^[0-9]{1,24}$/.test(p.ticket)&&p.time_ms<=nowMs&&nowMs-p.time_ms<=maxAgeMs);
  const result:CopySignal[]=[];
  const add=(item:SourceItem,action:CopySignal['action'],volume=item.volume)=>
    result.push({source_key:item.key,action,fields:item,source_volume:volume,revision_kind:action});
  for(const next of after){
    const prior=old.get(next.key);
    // Do not copy trades found on reconnection; their opening price has passed.
    if(!prior){
      if(next.time_ms>nowMs||nowMs-next.time_ms>maxAgeMs)continue;
      if(next.kind==='position'&&(next.type===0||next.type===1) &&
        !vanishedPendingSymbols.has(next.symbol))add(next,'open_market');
      else if(next.kind==='pending'&&next.type>=2&&next.type<=7)add(next,'place_pending');
      continue;
    }
    if(prior.kind!==next.kind||prior.symbol!==next.symbol||prior.type!==next.type)continue;
    if(next.kind==='position'){
      if(next.volume<prior.volume&&confirmed(next.key,'reduced'))
        add(next,'reduce_position',prior.volume-next.volume);
      // Scale-in is deliberately rejected until position/netting accounting
      // explicitly proves the new opening deal, rather than inferring it.
      if(different(prior,next,['sl','tp']))add(next,'modify_sl_tp');
    }else if(different(prior,next,['price','sl','tp','stoplimit','expiration'])){
      add(next,'modify_pending');
    }
  }
  for(const oldItem of before){
    if(current.has(oldItem.key))continue;
    if(oldItem.kind==='position'&&confirmed(oldItem.key,'closed'))
      add(oldItem,'close_position',oldItem.volume);
    else if(oldItem.kind==='pending'&&confirmed(oldItem.key,'cancelled'))
      add(oldItem,'cancel_pending');
  }
  return result;
}
export function validCopyItem(item:unknown):item is SourceItem {
  if(!item||typeof item!=='object'||Array.isArray(item))return false;
  const x=item as Record<string,unknown>;
  const key=String(x.key??'');
  if(!/^(position|pending):[0-9]{1,24}$/.test(key))return false;
  if(x.kind!==(key.startsWith('position:')?'position':'pending'))return false;
  if(typeof x.symbol!=='string'||!/^[A-Za-z0-9._#-]{1,48}$/.test(x.symbol))return false;
  if(!Number.isInteger(x.type)||Number(x.type)<0||Number(x.type)>7)return false;
  if(x.kind==='position'&&Number(x.type)>1)return false;
  if(x.kind==='pending'&&Number(x.type)<2)return false;
  return ['volume','price','sl','tp','stoplimit','expiration','time_ms']
    .every(k=>typeof x[k]==='number'&&Number.isFinite(x[k])&&Number(x[k])>=0) &&
    Number(x.volume)>0&&Number(x.volume)<=1000&&Number(x.time_ms)>0;
}
export function validCopyProof(x:unknown):x is SourceProof {
  if(!x||typeof x!=='object'||Array.isArray(x))return false;
  const p=x as Record<string,unknown>;
  return typeof p.key==='string'&&/^(position|pending):[0-9]{1,24}$/.test(p.key)
    &&['closed','reduced','cancelled'].includes(String(p.kind))
    &&typeof p.ticket==='string'&&/^[0-9]{1,24}$/.test(p.ticket)
    &&Number.isSafeInteger(p.time_ms)&&Number(p.time_ms)>0;
}
