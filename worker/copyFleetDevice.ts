import {deriveCopySignals,validCopyItem,validCopyProof,type SourceItem,type SourceProof} from './copySignals';

type Obj=Record<string,unknown>;
type Device={id:string;owner:string};
type Link={id:string;owner:string;device:string;status:string;trade_mode:number|null;access_level:string;monitoring_paused:number;currency:string|null};
type Fleet={id:string;source_link:string;state:string;updated_at:string;max_age_ms:number;owner:string};
type Target={fleet_id:string;owner:string;follower_link:string;sizing_mode:string;sizing_value:number;max_lots:number;max_daily_loss_pct:number;symbol_map:string;mirror_pending:number;mirror_protection:number;enabled:number};
const respond=(obj:unknown,status=200)=>Response.json(obj,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
const fail=(s:string,status=400)=>respond({error:s},status);
const number=(x:unknown,lo:number,hi:number)=>typeof x==='number'&&Number.isFinite(x)&&x>=lo&&x<=hi;
const validId=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9-]{30,50}$/i.test(x);
const stamp=()=>new Date().toISOString();
const hash=async(s:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))]
  .map(x=>x.toString(16).padStart(2,'0')).join('');
const safeCanonical=(v:unknown):string=>{
  if(Array.isArray(v))return '['+v.map(safeCanonical).join(',')+']';
  if(v&&typeof v==='object')return '{'+Object.entries(v as Obj).sort(([a],[b])=>a.localeCompare(b))
    .map(([key,value])=>JSON.stringify(key)+':'+safeCanonical(value)).join(',')+'}';
  return JSON.stringify(v);
};
export async function copyFleetDevice(db:D1Database,device:Device,action:string,input:Obj):Promise<Response>{
  const q=(sql:string,...args:unknown[])=>db.prepare(sql).bind(...args),now=Date.now();
  if(!validId(input.link))return fail('Linked demo account required.');
  const link=await q("SELECT id,owner,device,status,trade_mode,access_level,monitoring_paused,currency FROM mt5_links WHERE id=? AND device=? AND owner=?",
    input.link,device.id,device.owner).first<Link>();
  if(!link||link.status!=='connected')return fail('Authorized linked account unavailable.',404);
  if(link.trade_mode!==0)return fail('Copy execution is restricted to verified demo accounts.',403);
  if(action==='device/copy-consent'){
    if(typeof input.allowed!=='boolean')return fail('Explicit local demo permission required.');
    if(input.allowed&&link.access_level!=='trading-enabled')
      return fail('This broker login is read-only and cannot execute copy orders.',403);
    const expiry=input.allowed?now+45000:0;
    await q("INSERT INTO copy_device_consents(follower_link,owner,device,demo_authorized,expires_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(follower_link) DO UPDATE SET demo_authorized=excluded.demo_authorized,expires_at=excluded.expires_at,updated_at=excluded.updated_at WHERE copy_device_consents.owner=excluded.owner AND copy_device_consents.device=excluded.device",
      link.id,device.owner,device.id,input.allowed?1:0,expiry,stamp()).run();
    return respond({ok:true,authorized:input.allowed,expires_at:expiry});
  }
  if(action==='device/copy-report'){
    if(!number(input.balance,0,1e13)||!number(input.equity,0,1e13)||
      !number(input.freeMargin,0,1e13)||!number(input.openPositions,0,100000)||
      !Number.isInteger(input.openPositions)||!Number.isInteger(input.pendingOrders)||!number(input.pendingOrders,0,100000)||
      typeof input.connected!=='boolean'||typeof input.tradeAllowed!=='boolean'||
      typeof input.currency!=='string'||input.currency!==link.currency)
      return fail('Invalid account telemetry.');
    await q("INSERT INTO copy_account_reports(link,owner,device,account_currency,account_balance,account_equity,margin_free,open_positions,pending_orders,broker_connected,demo_trading_enabled,observed_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(link) DO UPDATE SET account_balance=excluded.account_balance,account_equity=excluded.account_equity,margin_free=excluded.margin_free,open_positions=excluded.open_positions,pending_orders=excluded.pending_orders,broker_connected=excluded.broker_connected,demo_trading_enabled=excluded.demo_trading_enabled,observed_at_ms=excluded.observed_at_ms WHERE copy_account_reports.owner=excluded.owner AND copy_account_reports.device=excluded.device",
      link.id,device.owner,device.id,link.currency,input.balance,input.equity,input.freeMargin,input.openPositions,input.pendingOrders,
      input.connected?1:0,input.tradeAllowed?1:0,now).run();
    return respond({ok:true});
  }
  if(action==='device/copy-source'){
    if(!Array.isArray(input.items)||input.items.length>120||!input.items.every(validCopyItem)||
      !Array.isArray(input.proofs)||input.proofs.length>120||!input.proofs.every(validCopyProof)||
      !number(input.sourceEquity,0.01,1e13)||input.sourceCurrency!==link.currency||
      !number(input.observedAt,0,now+5000)||now-Number(input.observedAt)>15000)
      return fail('Invalid or stale broker source observation.');
    const items=input.items as SourceItem[],proofs=input.proofs as SourceProof[];
    if(new Set(items.map(x=>x.key)).size!==items.length)return fail('Duplicate broker source item.');
    const prior=await q("SELECT snapshot,observed_at_ms,snapshot_sha256 FROM copy_source_states WHERE source_link=? AND owner=?",link.id,device.owner)
      .first<{snapshot:string;observed_at_ms:number;snapshot_sha256:string}>();
    if(prior&&Number(input.observedAt)<=prior.observed_at_ms)return respond({ok:true,ignored:'out_of_order'});
    const fleets=await q("SELECT * FROM copy_fleets WHERE owner=? AND source_link=? AND state='demo_armed'",device.owner,link.id).all<Fleet>();
    const old:SourceItem[]=prior?JSON.parse(prior.snapshot):[];
    const snapshotsHash=await hash(safeCanonical(items));
    const commands:D1PreparedStatement[]=[];
    let queued=0,skipped=0,baseline=0;
    for(const fleet of fleets.results){
      const isBaseline=!prior||prior.observed_at_ms<Date.parse(fleet.updated_at)||
        Number(input.observedAt)-prior.observed_at_ms>30000;
      if(isBaseline){baseline++;continue;}
      const signals=deriveCopySignals(old,items,proofs,Number(input.observedAt),fleet.max_age_ms);
      if(!signals.length)continue;
      const targets=await q("SELECT * FROM copy_fleet_followers WHERE fleet_id=? AND owner=? AND enabled=1",fleet.id,device.owner).all<Target>();
      for(const target of targets.results){
        const consent=await q("SELECT demo_authorized,expires_at FROM copy_device_consents WHERE follower_link=? AND owner=?",target.follower_link,device.owner)
          .first<{demo_authorized:number;expires_at:number}>();
        if(!consent?.demo_authorized||consent.expires_at<=now){skipped+=signals.length;continue;}
        for(const signal of signals){
          if((signal.action==='place_pending'||signal.action==='modify_pending'||signal.action==='cancel_pending')&&!target.mirror_pending)continue;
          if(signal.action==='modify_sl_tp'&&!target.mirror_protection)continue;
          const matchingProof=proofs.find(p=>p.key===signal.source_key&&
            (signal.action==='close_position'?p.kind==='closed':signal.action==='reduce_position'?p.kind==='reduced':p.kind==='cancelled'));
          const body={
            source:signal.fields,sourceVolume:signal.source_volume,sourceEquity:input.sourceEquity,sourceCurrency:input.sourceCurrency,
            risk:{mode:target.sizing_mode,value:target.sizing_value,maxLots:target.max_lots,
              maxDailyLossPct:target.max_daily_loss_pct,symbolMap:JSON.parse(target.symbol_map),
              mirrorProtection:!!target.mirror_protection},
            confirmedBy:matchingProof?.ticket||null,
          };
          const revision=await hash(safeCanonical({action:signal.action,body}));
          commands.push(q("INSERT OR IGNORE INTO copy_execution_tasks(id,owner,fleet_id,follower_link,source_link,source_key,action,source_revision,payload,status,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,'queued',?,?)",
            crypto.randomUUID(),device.owner,fleet.id,target.follower_link,link.id,signal.source_key,signal.action,revision,JSON.stringify(body),now,now+Math.min(fleet.max_age_ms,12000)));
          queued++;
        }
      }
    }
    // The broker observation and all follower intents commit together.
    await db.batch([
      ...commands,
      q("INSERT INTO copy_source_states(source_link,owner,snapshot,snapshot_sha256,observed_at_ms,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(source_link) DO UPDATE SET snapshot=excluded.snapshot,snapshot_sha256=excluded.snapshot_sha256,observed_at_ms=excluded.observed_at_ms,updated_at=excluded.updated_at WHERE copy_source_states.owner=excluded.owner",
        link.id,device.owner,JSON.stringify(items),snapshotsHash,input.observedAt,stamp()),
    ]);
    return respond({ok:true,intents_queued:queued,intents_skipped_without_consent:skipped,baseline_fleets:baseline});
  }
  if(action==='device/copy-poll'){
    // One claim, one shot: no automatic retry after an unknown broker outcome.
    // If an HTTP reply is lost, the task remains dispatched for manual review.
    const permission=await q("SELECT demo_authorized,expires_at FROM copy_device_consents WHERE follower_link=? AND device=? AND owner=?",
      link.id,device.id,device.owner).first<{demo_authorized:number;expires_at:number}>();
    if(!permission?.demo_authorized||permission.expires_at<=now)return respond({task:null,consentRequired:true});
    await q("UPDATE copy_execution_tasks SET status='cancelled',finished_at=? WHERE follower_link=? AND owner=? AND status='queued' AND expires_at<=?",
      now,link.id,device.owner,now).run();
    const selected=await q(
      "SELECT t.id FROM copy_execution_tasks t JOIN copy_fleets f ON f.id=t.fleet_id JOIN copy_fleet_followers target ON target.fleet_id=f.id AND target.follower_link=t.follower_link WHERE t.owner=? AND t.follower_link=? AND t.status='queued' AND t.expires_at>? AND f.state='demo_armed' AND target.enabled=1 AND f.owner=? ORDER BY t.created_at,t.id LIMIT 1",
      device.owner,link.id,now,device.owner).first<{id:string}>();
    if(!selected)return respond({task:null});
    const task=await q("UPDATE copy_execution_tasks SET status='dispatched',dispatched_at=? WHERE id=? AND status='queued' AND expires_at>? RETURNING id,source_key,action,payload,expires_at",
      now,selected.id,now).first<{id:string;source_key:string;action:string;payload:string;expires_at:number}>();
    return respond({task:task?{id:task.id,sourceKey:task.source_key,action:task.action,
      payload:JSON.parse(task.payload),expiresAt:task.expires_at}:null});
  }
  if(action==='device/copy-ack'){
    if(!validId(input.task)||!['applied','rejected','unknown'].includes(String(input.status))||
      (input.brokerTicket!==null&&input.brokerTicket!==undefined&&
        (typeof input.brokerTicket!=='string'||!(/^[0-9]{1,24}$/.test(input.brokerTicket))))||
      (input.retcode!==null&&input.retcode!==undefined&&(!Number.isInteger(input.retcode)||!number(input.retcode,0,1e9)))||
      typeof input.code!=='string'||input.code.length>80||
      (input.details!==undefined&&(!input.details||typeof input.details!=='object'||Array.isArray(input.details))))
      return fail('Invalid signed follower execution receipt.');
    const row=await q("SELECT t.id,t.fleet_id,t.status FROM copy_execution_tasks t WHERE t.id=? AND t.follower_link=? AND t.owner=?",
      input.task,link.id,device.owner).first<{id:string;fleet_id:string;status:string}>();
    if(!row)return fail('Task not issued to this broker account.',404);
    if(row.status!=='dispatched')return fail('This broker execution has already been accounted for.',409);
    const details=JSON.stringify(input.details||{});
    if(details.length>4096)return fail('Execution receipt too large.');
    const change=await q("UPDATE copy_execution_tasks SET status=?,broker_ticket=?,retcode=?,result_code=?,result_payload=?,finished_at=? WHERE id=? AND follower_link=? AND owner=? AND status='dispatched'",
      input.status,input.brokerTicket||null,input.retcode||null,input.code,details,now,row.id,link.id,device.owner).run();
    if(!change.meta.changes)return fail('Execution receipt changed. Reload.',409);
    await q("INSERT INTO copy_execution_audit(id,owner,fleet_id,follower_link,event,details,created_at) VALUES(?,?,?,?,?,?,?)",
      crypto.randomUUID(),device.owner,row.fleet_id,link.id,'broker_receipt',JSON.stringify({
        task:row.id,status:input.status,retcode:input.retcode||null,code:input.code,
        brokerTicket:input.brokerTicket||null}),stamp()).run();
    return respond({ok:true,final:true});
  }
  return fail('Unknown copy-device action.',404);
}
