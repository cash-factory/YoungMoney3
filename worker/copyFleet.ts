/**
 * Copy Fleet — separately consented DEMO/LIVE multi-follower control plane.
 *
 * Trading does not happen in Workers. No broker passwords or order_send API
 * exist here: a separately consented local follower is the sole executor.
 * Paused by default, account-verified, version locked, and fail-closed.
 */
interface Env {DB:D1Database}
type Obj=Record<string,unknown>;
type Link={id:string;device:string;owner:string;company:string|null;server:string|null;login:string|null;currency:string|null;trade_mode:number|null;access_level:string;status:string;monitoring_paused:number;last_sync:string|null;broker_balance:number|null;broker_equity:number|null;last_seen:number|null};
type Fleet={id:string;owner:string;name:string;source_link:string;execution_mode:'demo'|'live';state:'paused'|'demo_armed'|'live_armed';version:number;max_age_ms:number;created_at:string;updated_at:string};
type Target={fleet_id:string;follower_link:string;sizing_mode:string;sizing_value:number;max_lots:number;max_daily_loss_pct:number;symbol_map:string;mirror_pending:number;mirror_protection:number;enabled:number;updated_at:string};
const respond=(v:unknown,status=200)=>Response.json(v,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
const fail=(s:string,status=400)=>respond({error:s},status);
const object=(v:unknown):v is Obj=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const str=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length>0&&v.length<=max;
const num=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const stamp=()=>new Date().toISOString();
const qlink="SELECT l.id,l.device,l.owner,l.company,l.server,l.login,l.currency,l.trade_mode,l.access_level,l.status,l.monitoring_paused,l.last_sync,l.broker_balance,l.broker_equity,d.last_seen FROM mt5_links l JOIN mt5_devices d ON d.id=l.device WHERE l.owner=? AND d.owner=? AND d.revoked=0 AND l.status='connected'";
const modes=['risk_pct_equity','fixed_risk','equity_ratio','lot_multiplier'];
const maxTargets=24;
function validSymbolMap(v:unknown):v is Record<string,string> {
  if(!object(v)||Object.keys(v).length>40)return false;
  return Object.entries(v).every(([k,x])=>/^[A-Za-z0-9_.#-]{1,40}$/.test(k)&&typeof x==='string'&&/^[A-Za-z0-9_.#-]{1,40}$/.test(x));
}
function parseTarget(v:unknown) {
  if(!object(v)||!uuid(v.link)||!modes.includes(String(v.mode)) ||
    !num(v.value,0.001,1000000)||!num(v.maxLots,0.01,100)||
    !num(v.maxDailyLossPct,0.1,10)||typeof v.enabled!=='boolean'||
    typeof v.mirrorPending!=='boolean'||typeof v.mirrorProtection!=='boolean'||
    !validSymbolMap(v.symbolMap))return null;
  if(v.mode==='risk_pct_equity'&&Number(v.value)>10)return null;
  if(v.mode==='equity_ratio'&&Number(v.value)>3)return null;
  if(v.mode==='lot_multiplier'&&Number(v.value)>5)return null;
  return {link:String(v.link),mode:String(v.mode),value:Number(v.value),
    maxLots:Number(v.maxLots),maxDailyLossPct:Number(v.maxDailyLossPct),
    symbolMap:JSON.stringify(v.symbolMap),enabled:v.enabled?1:0,
    mirrorPending:v.mirrorPending?1:0,mirrorProtection:v.mirrorProtection?1:0};
}
async function links(db:D1Database,owner:string):Promise<Link[]>{
  const rows=await db.prepare(qlink+" ORDER BY l.company,l.login,l.id").bind(owner,owner).all<Link>();
  return rows.results;
}
function eligible(account:Link|undefined,mode:'demo'|'live',now=Date.now()) {
  return !!account&&account.trade_mode===(mode==='live'?2:0)&&account.monitoring_paused===0&&
    Number(account.last_seen)>now-45000&&
    Number.isFinite(Number(account.broker_equity))&&Number(account.broker_equity)>0;
}
async function audit(db:D1Database,owner:string,fleet:string,event:string,details:Obj){
  await db.prepare("INSERT INTO copy_execution_audit(id,owner,fleet_id,event,details,created_at) VALUES(?,?,?,?,?,?)")
    .bind(crypto.randomUUID(),owner,fleet,event,JSON.stringify(details),stamp()).run();
}
export async function copyFleetOwner(request:Request,env:Env,owner:string,action:string,input:Obj):Promise<Response>{
  const db=env.DB,q=(sql:string,...args:unknown[])=>db.prepare(sql).bind(...args);
  if(action==='fleet-status'){
    const [available,plans,targetRows,consents,reports,taskRows]=await Promise.all([
      links(db,owner),
      q("SELECT * FROM copy_fleets WHERE owner=? ORDER BY updated_at DESC LIMIT 30",owner).all<Fleet>(),
      q("SELECT * FROM copy_fleet_followers WHERE owner=? ORDER BY fleet_id,follower_link",owner).all<Target>(),
      q("SELECT follower_link,demo_authorized,authorization_mode,expires_at FROM copy_device_consents WHERE owner=?",owner).all(),
      q("SELECT * FROM copy_account_reports WHERE owner=? ORDER BY observed_at_ms DESC",owner).all(),
      q("SELECT id,fleet_id,source_key,action,status,follower_link,retcode,result_code,result_payload,created_at,finished_at FROM copy_execution_tasks WHERE owner=? ORDER BY created_at DESC LIMIT 100",owner).all(),
    ]);
    return respond({mode:'demo-and-live',liveExecutionEnabled:true,requiresLocalConsent:true,
      maxFollowersPerFleet:maxTargets,accounts:available,
      fleets:plans.results.map(p=>({...p,targets:targetRows.results.filter(x=>x.fleet_id===p.id).map(t=>({...t,symbol_map:JSON.parse(t.symbol_map)}))})),
      consents:consents.results,reports:reports.results,
      tasks:taskRows.results.map(t=>({...t,result_payload:t.result_payload?JSON.parse(String(t.result_payload)):null}))});
  }
  if(action==='fleet-save'){
    const executionMode=input.executionMode===undefined?'demo':input.executionMode;
    if(executionMode!=='demo'&&executionMode!=='live')return fail('Choose demo or live execution explicitly.');
    if(!str(input.name,64)||String(input.name).trim().length<2||[...String(input.name)].some(char=>char.charCodeAt(0)<32)||
      !uuid(input.sourceLink)||!Array.isArray(input.targets)||input.targets.length<1||input.targets.length>maxTargets)
      return fail('Choose a source, a name and between 1 and 24 follower accounts.');
    const parsed=input.targets.map(parseTarget);
    if(parsed.some(x=>!x))return fail('A follower has invalid sizing, risk or symbol mapping.');
    const targets=parsed as NonNullable<ReturnType<typeof parseTarget>>[];
    if(executionMode==='live' && targets.some(t=>t.maxDailyLossPct>5||
      (t.mode==='risk_pct_equity'&&t.value>2)))
      return fail('Live pilot policies require at most 2% equity risk per entry and 5% daily loss.',409);
    const ids=targets.map(x=>x.link);
    if(new Set(ids).size!==ids.length||ids.includes(String(input.sourceLink)))
      return fail('Each follower must be unique and different from the source.');
    const owned=await links(db,owner);
    const source=owned.find(a=>a.id===input.sourceLink);
    if(!source||(source.trade_mode!==0&&source.trade_mode!==2)||
      (executionMode==='demo'&&source.trade_mode!==0))
      return fail('Select an eligible connected source account owned by this workspace.',403);
    for(const t of targets){
      const follower=owned.find(a=>a.id===t.link);
      if(!follower||follower.trade_mode!==(executionMode==='live'?2:0))
        return fail('Every follower must be connected and match the fleet execution mode.',403);
      if(t.enabled&&follower.access_level!=='trading-enabled')
        return fail('Enabled follower '+t.link.slice(0,8)+' has restricted broker trade access.',409);
      if(t.enabled&&t.mode==='equity_ratio'&&source.currency!==follower.currency)
        return fail('Equity-ratio sizing requires matching account currencies until a verified conversion exists.',409);
    }
    const at=stamp();
    let id:string,version:number;
    if(input.id!==undefined){
      if(!uuid(input.id)||!Number.isSafeInteger(input.version)||Number(input.version)<1)
        return fail('An existing fleet requires a current revision.');
      id=input.id;
      const changed=await q("UPDATE copy_fleets SET name=?,source_link=?,execution_mode=?,version=version+1,updated_at=? WHERE id=? AND owner=? AND version=? AND state='paused'",
        String(input.name).trim(),input.sourceLink,executionMode,at,id,owner,input.version).run();
      if(changed.meta.changes!==1)return fail('This fleet changed or is armed. Pause and refresh before editing.',409);
      version=Number(input.version)+1;
    }else{
      const count=await q("SELECT COUNT(*) AS n FROM copy_fleets WHERE owner=?",owner).first<{n:number}>();
      if((count?.n??0)>=20)return fail('Maximum 20 fleets per workspace.',409);
      id=crypto.randomUUID();version=1;
      await q("INSERT INTO copy_fleets(id,owner,name,source_link,execution_mode,state,version,max_age_ms,created_at,updated_at) VALUES(?,?,?,?,?,'paused',1,12000,?,?)",
        id,owner,String(input.name).trim(),input.sourceLink,executionMode,at,at).run();
    }
    // Reject concurrent stale editors via parent version precondition in EVERY
    // mutation. A failed retry cannot delete the current follower list.
    const queries=[
      q("DELETE FROM copy_fleet_followers WHERE fleet_id=? AND owner=? AND EXISTS(SELECT 1 FROM copy_fleets WHERE id=? AND owner=? AND version=? AND state='paused')",
        id,owner,id,owner,version),
      ...targets.map(t=>q("INSERT INTO copy_fleet_followers(fleet_id,owner,follower_link,sizing_mode,sizing_value,max_lots,max_daily_loss_pct,symbol_map,mirror_pending,mirror_protection,enabled,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM copy_fleets WHERE id=? AND owner=? AND version=? AND state='paused')",
        id,owner,t.link,t.mode,t.value,t.maxLots,t.maxDailyLossPct,t.symbolMap,t.mirrorPending,t.mirrorProtection,t.enabled,at,id,owner,version)),
    ];
    await db.batch(queries);
    await audit(db,owner,id,'configuration_saved',{version,target_count:targets.length,executionMode,armed:false});
    return respond({ok:true,id,version,state:'paused',executionMode,executionEnabled:false});
  }
  if(action==='fleet-preview'){
    if(!uuid(input.id)||!num(input.sourceLots,0.001,100)||!num(input.sourceEquity,1,1e12)||
      !num(input.entry,0.00000001,1e10)||!num(input.stop,0.00000001,1e10)||
      !['buy','sell'].includes(String(input.direction)))return fail('Enter a valid source position with price, stop and equity.');
    if((input.direction==='buy'&&Number(input.stop)>=Number(input.entry))||
       (input.direction==='sell'&&Number(input.stop)<=Number(input.entry)))
      return fail('An entry needs a protective stop on the correct side.');
    const fleet=await q("SELECT * FROM copy_fleets WHERE id=? AND owner=?",input.id,owner).first<Fleet>();
    if(!fleet)return fail('Fleet not found.',404);
    const [accountRows,targets]=await Promise.all([links(db,owner),
      q("SELECT * FROM copy_fleet_followers WHERE fleet_id=? AND owner=?",fleet.id,owner).all<Target>()]);
    const source=accountRows.find(a=>a.id===fleet.source_link);
    const previews=targets.results.map(t=>{
      const account=accountRows.find(a=>a.id===t.follower_link);
      const equity=Number(account?.broker_equity);
      const budget=t.sizing_mode==='risk_pct_equity'?equity*t.sizing_value/100:
        t.sizing_mode==='fixed_risk'?t.sizing_value:null;
      const indicated=t.sizing_mode==='equity_ratio'?Number(input.sourceLots)*equity/Number(input.sourceEquity)*t.sizing_value:
        t.sizing_mode==='lot_multiplier'?Number(input.sourceLots)*t.sizing_value:null;
      return {followerLink:t.follower_link,enabled:!!t.enabled,mode:t.sizing_mode,accountCurrency:account?.currency,
        sizingValue:t.sizing_value,maximumLots:t.max_lots,
        plannedRiskBudget:budget,indicativeLots:indicated!==null?Math.min(t.max_lots,indicated):null,
        brokerValidated:false,needsBrokerPreflight:true,
        notice:'Actual lots, account-currency loss, broker volume step, margin and stops are computed by the follower terminal before any broker order. This preview is not a guarantee.'};
    });
    return respond({simulation:true,executionOccurred:false,sourceLink:fleet.source_link,
      sourceCurrency:source?.currency,direction:input.direction,entry:input.entry,stop:input.stop,previews});
  }
  if(!['fleet-arm','fleet-pause','fleet-pause-all'].includes(action))return fail('Unknown Fleet action.',404);
  if(action==='fleet-pause-all'){
    const at=stamp();
    await db.batch([
      q("UPDATE copy_fleets SET state='paused',version=version+1,updated_at=? WHERE owner=? AND state IN ('demo_armed','live_armed')",at,owner),
      q("UPDATE copy_execution_tasks SET status='cancelled',finished_at=? WHERE owner=? AND status='queued'",Date.now(),owner),
    ]);
    await audit(db,owner,'all','emergency_pause_all',{warning:'Already dispatched broker requests may still complete; inspect follower MT5 terminals.'});
    return respond({ok:true,paused:true,warning:'Already dispatched orders can still complete. Inspect all follower MT5 accounts.'});
  }
  if(!uuid(input.id)||!Number.isSafeInteger(input.version)||Number(input.version)<1)
    return fail('Choose a fleet at its current version.');
  const fleet=await q("SELECT * FROM copy_fleets WHERE id=? AND owner=?",input.id,owner).first<Fleet>();
  if(!fleet||fleet.version!==input.version)return fail('Fleet revision changed. Refresh.',409);
  if(action==='fleet-pause'){
    await db.batch([
      q("UPDATE copy_fleets SET state='paused',version=version+1,updated_at=? WHERE id=? AND owner=? AND version=?",
        stamp(),fleet.id,owner,input.version),
      q("UPDATE copy_execution_tasks SET status='cancelled',finished_at=? WHERE fleet_id=? AND owner=? AND status='queued'",
        Date.now(),fleet.id,owner),
    ]);
    await audit(db,owner,fleet.id,'paused',{reason:'operator'});
    return respond({ok:true,state:'paused',version:fleet.version+1});
  }
  if(fleet.state!=='paused'||input.confirm!==true)
    return fail('Explicitly approve execution before arming.',409);
  if(fleet.execution_mode==='live' && input.liveConfirmation!=='ARM LIVE '+fleet.id.slice(0,8))
    return fail('Live execution requires the fleet-specific confirmation phrase.',409);
  const [owned,targets,consentRows]=await Promise.all([links(db,owner),
    q("SELECT * FROM copy_fleet_followers WHERE fleet_id=? AND owner=? AND enabled=1",fleet.id,owner).all<Target>(),
    q("SELECT follower_link,broker_login,broker_server,expires_at FROM copy_device_consents WHERE owner=? AND demo_authorized=1 AND authorization_mode=? AND expires_at>?",owner,fleet.execution_mode,Date.now()).all<{follower_link:string;broker_login:string|null;broker_server:string|null;expires_at:number}>()]);
  const src=owned.find(x=>x.id===fleet.source_link);
  if(!src||(fleet.execution_mode==='live'&&src.trade_mode!==0&&src.trade_mode!==2)||
     (fleet.execution_mode==='demo'&&src.trade_mode!==0)||src.monitoring_paused!==0||
     Number(src.last_seen)<=Date.now()-45000||Number(src.broker_equity)<=0)
    return fail('The source must be online, verified and have current broker equity.',409);
  if(!targets.results.length)return fail('Enable at least one verified follower first.',409);
  const blocked=targets.results.find(t=>{
    const a=owned.find(x=>x.id===t.follower_link);
    return !eligible(a,fleet.execution_mode)||a?.access_level!=='trading-enabled'||
      !consentRows.results.some(c=>c.follower_link===t.follower_link&&
        c.broker_login===a?.login&&c.broker_server===a?.server);
  });
  if(blocked)return fail('All enabled followers must be online, trading-enabled, mode-matched and locally authorized in their Windows connector.',409);
  const routing=await q("SELECT f.source_link,t.follower_link FROM copy_fleets f JOIN copy_fleet_followers t ON t.fleet_id=f.id WHERE f.owner=? AND f.state IN ('demo_armed','live_armed') AND t.enabled=1",owner)
    .all<{source_link:string;follower_link:string}>();
  const engaged=new Set(routing.results.flatMap(x=>[x.source_link,x.follower_link]));
  if(engaged.has(fleet.source_link)||targets.results.some(t=>engaged.has(t.follower_link)))
    return fail('An account already participates in another armed copy fleet. Chains and feedback loops are blocked.',409);
  const armedState=fleet.execution_mode==='live'?'live_armed':'demo_armed';
  const changed=await q("UPDATE copy_fleets SET state=?,version=version+1,updated_at=? WHERE id=? AND owner=? AND version=? AND state='paused'",
    armedState,stamp(),fleet.id,owner,fleet.version).run();
  if(!changed.meta.changes)return fail('Fleet changed while arming. Refresh.',409);
  await audit(db,owner,fleet.id,armedState,{followers:targets.results.length,executionMode:fleet.execution_mode,explicit_owner_confirmation:true,
    requirement:'mode-matched local device consent and per-order broker risk checks'});
  return respond({ok:true,state:armedState,version:fleet.version+1,
    warning:fleet.execution_mode==='live'?'REAL MONEY: Only the explicitly authorized live followers may execute. Monitor your broker accounts closely.':'Only these demo accounts may copy.'});
}
