import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { buildDemoStatements } from './write-staging-demo-sql.mjs';
import { DEMO_ID, demoCounts } from './staging-demo-fixtures.mjs';

const bundle=await build({entryPoints:['worker/index.ts'],bundle:true,format:'esm',write:false});
const objects=new Set();
const storage=async req=>{
  const data=await req.json();
  if(req.method==='DELETE'){
    for(const key of data.prefixes) assert.equal(objects.delete(key),true,'Must delete the fully qualified owner key');
    return Response.json({});
  }
  const entries=new Map();
  for(const key of objects) if(key.startsWith(data.prefix+'/')){
    const [name,...tail]=key.slice(data.prefix.length+1).split('/');
    entries.set(name,{name,id:tail.length?null:'object-id'});
  }
  return Response.json([...entries.values()].slice(data.offset||0,(data.offset||0)+data.limit));
};
const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'journal',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2025-12-01',
  outboundService:storage,d1Databases:['DB'],bindings:{PILOT_INVITE_CODE:'integration',SUPABASE_URL:'https://storage.test',SUPABASE_SERVICE_ROLE_KEY:'fixture',DEMO_SHOWCASE_ENABLED:'true'}}],port:0}));
try {
  const db=await mf.getD1Database('DB');
  for(const name of (await readdir('migrations')).sort()){
    const sql=await readFile('migrations/'+name,'utf8');
    let buffer='';
    for(const line of sql.split(/\r?\n/)){
      buffer+=line+'\n';
      if(line.trimEnd().endsWith(';') && (!buffer.trimStart().startsWith('CREATE TRIGGER') || line.trim()==='END;')){
        await db.prepare(buffer.trim()).run();buffer='';
      }
    }
  }
  let cookie='';
  const call=async(path,body,headers={})=>mf.dispatchFetch('https://journal.example/api/'+path,{method:'POST',
    headers:{'content-type':'application/json',cookie,...headers},body:JSON.stringify(body)});
  const signup=await call('auth/signup',{email:'member@example.test',username:'member',password:'local-test-pass',invite_code:'integration'});
  assert.equal(signup.status,200);cookie=signup.headers.get('set-cookie').split(';')[0];
  assert.match(signup.headers.get('set-cookie'),/HttpOnly/);
  assert.match(signup.headers.get('set-cookie'),/SameSite=Strict/);
  // Consume the response while its Miniflare request context is still live.
  const subject=(await signup.json()).user.id;
  assert.equal((await call('data',{action:'select',table:'trades'}, {'Sec-Fetch-Site':'same-site'})).status,403);
  assert.equal((await call('data',{action:'select',table:'trades'}, {'Origin':'https://a.journal.example'})).status,403);
  const row={id:'demo-trade',pair:'TEST',settlement_currency:'USD',direction:'long',entry_price:100,exit_price:95,
    lot_size:1,status:'closed',entry_time:'2026-01-01T00:00:00Z',exit_time:'2026-01-02T00:00:00Z',pnl:-5};
  const insert={action:'insert',table:'trades',payload:row};
  for(let i=0;i<2;i++) assert.equal((await call('data',insert)).status,200);
  assert.equal((await call('data',{...insert,payload:{...row,pnl:2}})).status,409);
  const records=(await (await call('data',{action:'select',table:'trades'})).json()).data;
  assert.equal(records.length,1);
  const patch={action:'update',id:row.id,table:'trades',filters:{updated_at:records[0].updated_at},payload:{notes:'reviewed'}};
  assert.equal((await call('data',patch)).status,200);
  assert.equal((await call('data',patch)).status,409);
  const stats=await mf.dispatchFetch('https://journal.example/api/account-summaries',{headers:{cookie}});
  assert.equal((await stats.json()).rows[0].profit,'-5');

  // A corrected manual trade must be recalculated at the Worker boundary, not trusted
  // because a browser has submitted stale P&L or a changed trade direction.
  const calculation={
    price_increment:1,tick_value:1,conversion_rate:1,account_currency:'USD',
    quantity_unit:'contracts',asset_class:'future',
  };
  const calculated={...row,id:'calculated-trade',calculation_snapshot:calculation,pnl:500};
  assert.equal((await call('data',{action:'insert',table:'trades',payload:calculated})).status,200);
  const before=(await (await call('data',{action:'select',table:'trades',filters:{id:calculated.id}})).json()).data[0];
  assert.equal(before.pnl,-5);
  const recalculated=await call('data',{action:'update',table:'trades',id:calculated.id,
    filters:{updated_at:before.updated_at},payload:{direction:'short',pnl:-999}});
  assert.equal(recalculated.status,200);
  const after=(await recalculated.json()).data;
  assert.equal(after.pnl,5);
  assert.equal(after.outcome,'win');
  assert.equal((await call('data',{action:'delete',table:'trades',id:calculated.id})).status,428);
  assert.equal((await call('data',{action:'delete',table:'trades',id:calculated.id,
    filters:{updated_at:before.updated_at}})).status,409);
  assert.equal((await call('data',{action:'delete',table:'trades',id:calculated.id,
    filters:{updated_at:after.updated_at}})).status,200);
  assert.equal((await call('data',{action:'insert',table:'trades',payload:{
    ...row,id:'invalid-lifecycle',status:'open',pnl:0,
  }})).status,400);

  // Legacy trades may not have an explicit source field: that still means manual.
  const legacy=await call('data',{action:'update',table:'trades',id:row.id,
    filters:{updated_at:(await (await call('data',{action:'select',table:'trades',filters:{id:row.id}})).json()).data[0].updated_at},
    payload:{trade_source:'manual',notes:'Reviewed historical entry'}});
  assert.equal(legacy.status,200);
  // Non-trade relationships are owner-scoped too (including restore/upsert writes).
  const accountId='owned-account';
  assert.equal((await call('data',{action:'insert',table:'trading_accounts',
    payload:{id:accountId,name:'Demo',base_currency:'USD',balance:100}})).status,200);
  assert.equal((await call('data',{action:'insert',table:'trading_account_adjustments',
    payload:{account_id:'missing-account',amount:10,reason:'Deposit'}})).status,400);
  assert.equal((await call('data',{action:'upsert',table:'trading_account_adjustments',
    payload:{id:'invalid-adjustment',account_id:'missing-account',amount:10,reason:'Deposit'}})).status,400);
  assert.equal((await call('data',{action:'insert',table:'trading_account_adjustments',
    payload:{id:'valid-adjustment',account_id:accountId,amount:10,reason:'Deposit'}})).status,200);

  const code=(await (await call('mt5/pair',{})).json()).code;
  const installation='11111111-1111-4111-8111-111111111111';
  const claim={code,publicKey:'ZmFrZQ==',installationId:installation};
  const token=(await (await call('mt5/device/claim',claim)).json()).token;
  assert.ok(token);assert.equal((await call('mt5/device/claim',claim)).status,409);
  const devices=(await (await call('mt5/status',{})).json()).devices;
  const device=(path,data)=>call('mt5/device/'+path,data,{authorization:'Bearer '+token});
  assert.equal((await call('mt5/rename-pc',{device:devices[0].id,name:'Desk PC · Studio'})).status,200);
  assert.equal((await call('mt5/rename-pc',{device:devices[0].id,name:'a'})).status,400);
  assert.equal((await call('mt5/rename-pc',{device:'invalid',name:'Other PC'})).status,404);
  assert.equal((await (await call('mt5/status',{})).json()).devices[0].pc_name,'Desk PC · Studio');
  const anotherCode=(await (await call('mt5/pair',{})).json()).code;
  const duplicate=await call('mt5/device/claim',{...claim,code:anotherCode,publicKey:'TmV3S2V5'});
  assert.equal(duplicate.status,409,'A second pairing from the same connector install is rejected');
  assert.equal((await duplicate.json()).code,'pc_already_paired');
  assert.equal((await (await call('mt5/status',{})).json()).devices.length,1);
  assert.equal((await call('mt5/device/claim',{code:anotherCode,publicKey:'TmV3S2V5',installationId:'bad'})).status,400);
  const pcRenamed=await device('rename',{name:'Trading Laptop - Main'});
  assert.equal(pcRenamed.status,200);
  assert.equal((await (await call('mt5/status',{})).json()).devices[0].pc_name,'Trading Laptop - Main');
  const foreign=await device('presence',{setup:'ready',version:'0.5.1-rc1',installationId:'22222222-2222-4222-8222-222222222222'});
  assert.equal(foreign.status,409,'A valid token cannot silently switch installations');
  assert.equal((await foreign.json()).code,'pc_identity_mismatch');
  const presence=async(setup='ready')=>(await device('presence',{setup,version:'0.5.1-rc1',installationId:installation})).json();
  await db.prepare('UPDATE mt5_devices SET last_seen=0 WHERE id=?').bind(devices[0].id).run();
  const firstCheckin=await presence('install');
  assert.equal(firstCheckin.device,devices[0].id);
  assert.equal(firstCheckin.name,'Trading Laptop - Main');
  const loginRequest={device:devices[0].id,server:'Demo',envelope:{wrapped:'a',iv:'b',data:'c'}};
  assert.equal((await call('mt5/connect',loginRequest)).status,409);
  assert.equal((await presence()).pending,null);
  const failedAttempt=(await (await call('mt5/connect',loginRequest)).json()).id;
  await db.prepare("UPDATE mt5_links SET status='failed',last_error='Simulated login failure' WHERE id=?").bind(failedAttempt).run();
  assert.equal((await call('mt5/remove-failed',{link:'not-my-link'})).status,409);
  assert.equal((await (await call('mt5/remove-failed',{link:failedAttempt})).json()).removed,1);
  assert.equal((await (await call('mt5/status',{})).json()).links.some(l=>l.id===failedAttempt),false);
  const stale=(await (await call('mt5/connect',loginRequest)).json()).id;
  await db.prepare("UPDATE mt5_links SET status='expired' WHERE id=?").bind(stale).run();
  assert.equal((await (await call('mt5/clear-failed',{})).json()).removed,1);
  const link=(await (await call('mt5/connect',loginRequest)).json()).id;
  const pendingExpiry=await db.prepare('SELECT expires FROM mt5_links WHERE id=?').bind(link).first();
  assert.ok(pendingExpiry.expires-Date.now()>9*60*1000,'Slow MT5 preparation needs a ten-minute pending window');
  assert.deepEqual((await presence()).pending,{id:link,server:'Demo'});
  assert.equal((await (await device('poll',{request:'different-request'})).json()).job,null);
  assert.equal((await (await device('poll',{request:link})).json()).job.id,link);
  const claimedExpiry=await db.prepare('SELECT expires FROM mt5_links WHERE id=?').bind(link).first();
  assert.ok(claimedExpiry.expires-Date.now()>11*60*1000,'Broker IPC/login needs a twelve-minute verification window');
  assert.equal((await (await device('poll',{})).json()).job,null);
  assert.equal((await device('verified',{link,ok:true,mode:0,trade_access:true,login:'42',server:'Demo',company:'Fixtures',currency:'USD',balance:100})).status,200);
  const verifiedAccess=(await (await call('mt5/status',{})).json()).links.find(l=>l.id===link);
  assert.equal(verifiedAccess.access_level,'trading-enabled');
  assert.equal(verifiedAccess.trade_mode,0);
  assert.equal((await call('mt5/remove-failed',{link})).status,409,'Connected accounts must never be removed using cleanup.');
  assert.equal((await (await call('mt5/clear-failed',{})).json()).removed,0);
  const liveBalance=await device('sync',{link,events:[],balance:165.5,equity:178.25});
  assert.equal(liveBalance.status,200);
  const linkedAccount=(await (await call('mt5/status',{})).json()).links[0].account_id;
  const accountBefore=(await (await call('data',{action:'select',table:'trading_accounts',filters:{id:linkedAccount}})).json()).data[0];
  assert.equal(accountBefore.broker_balance,165.5);
  assert.equal(accountBefore.broker_equity,178.25);
  assert.ok(accountBefore.broker_balance_at);
  assert.equal((await call('data',{action:'update',table:'trading_accounts',id:linkedAccount,
    payload:{broker_balance:999999,broker_equity:0}})).status,200);
  const accountAfter=(await (await call('data',{action:'select',table:'trading_accounts',filters:{id:linkedAccount}})).json()).data[0];
  assert.equal(accountAfter.broker_balance,165.5);
  assert.equal(accountAfter.broker_equity,178.25);
  assert.equal((await device('sync',{link,events:[{kind:'trade',key:'close-765',fields:{...row,lot_size:-1}}]})).status,400);
  assert.equal((await device('sync',{link,events:[{kind:'trade',key:'arbitrary-777',fields:row}]})).status,400);
  const batch={link,events:[{kind:'trade',key:'close-42',fields:row}]};
  for(let i=0;i<2;i++) assert.equal((await device('sync',batch)).status,200);
  const imported=(await (await call('data',{action:'select',table:'trades',filters:{trade_source:'mt5'}})).json());
  assert.equal(imported.count,1);
  assert.equal((await call('data',{action:'update',table:'trades',id:imported.data[0].id,
    filters:{updated_at:imported.data[0].updated_at},payload:{strategy_id:'foreign-strategy'}})).status,400);
  assert.equal((await call('data',{action:'upsert',table:'trades',payload:{
    ...row,id:'forged-restore',account_id:'foreign-account',
  }})).status,400);
  // Historical ranges must be explicit, owner-scoped and validated on the API.
  for (const days of [0, 36526, 1.5]) {
    assert.equal((await call('mt5/history-request',{link,mode:'days',days})).status,400);
  }
  for (const since of ['2024-02-30','not-a-date','1900-01-01']) {
    assert.equal((await call('mt5/history-request',{link,mode:'from_date',since})).status,400);
  }
  assert.equal((await call('mt5/history-request',{link,mode:'unrecognized'})).status,400);
  assert.equal((await call('mt5/history-request',{link,days:30})).status,200);
  const history=(await (await device('sync',{link,events:[]})).json()).history;
  const older={...row,entry_time:new Date(Date.now()-9*86400000).toISOString(),
    exit_time:new Date(Date.now()-8*86400000).toISOString()};
  const outside={...older,entry_time:new Date(Date.now()-50*86400000).toISOString(),
    exit_time:new Date(Date.now()-45*86400000).toISOString()};
  assert.equal((await call('mt5/history-preview',{link})).status,409,'Do not preview unfinished scans');
  assert.equal((await device('sync',{link,events:[{kind:'history',key:'history:'+history.id+':close-outside',fields:outside}]})).status,200);
  const keys=Array.from({length:102},(_,i)=>'history:'+history.id+':close-'+(1000+i));
  for(let i=0;i<keys.length;i+=30) {
    const events=keys.slice(i,i+30).map(key=>({kind:'history',key,fields:older}));
    assert.equal((await device('sync',{link,events,history_done:i+30>=keys.length?history.id:undefined})).status,200);
  }
  assert.equal((await (await call('data',{action:'select',table:'trades',filters:{trade_source:'mt5'}})).json()).count,1);
  const page1=(await (await call('mt5/history-preview',{link,offset:0})).json());
  assert.equal(page1.link,link);
  assert.equal(page1.request,history.id);
  assert.equal(page1.rows.length,100);
  assert.equal(page1.more,true);
  assert.equal((await call('mt5/history-preview',{link,request:'previous-scan',offset:100})).status,409);
  const page2=(await (await call('mt5/history-preview',{link,request:history.id,offset:100})).json());
  assert.equal(page2.request,history.id);
  assert.equal(page2.rows.length,2);
  assert.equal(page2.more,false);
  assert.equal((await call('mt5/history-import',{link,request:history.id,expected_count:100})).status,409);
  let more=true;
  while(more) {
    const result=await call('mt5/history-import',{link,request:history.id,expected_count:102});
    assert.equal(result.status,200);
    more=(await result.json()).more;
  }
  assert.equal((await (await call('data',{action:'select',table:'trades',filters:{trade_source:'mt5'}})).json()).count,103);
  assert.equal((await (await call('mt5/history-import',{link,request:history.id,expected_count:102})).json()).added,0);
  // A request persisted under an older policy cannot bypass the cap by
  // becoming ready before the deployment. Keep all evidence, reject approval.
  const approvedSince=(await db.prepare('SELECT history_since FROM mt5_links WHERE id=?')
    .bind(link).first()).history_since;
  await db.prepare('UPDATE mt5_links SET history_since=? WHERE id=?')
    .bind(Date.now()-120*86400000,link).run();
  assert.equal((await call('mt5/history-preview',{link,offset:0})).status,409);
  assert.equal((await call('mt5/history-import',{link,request:history.id,expected_count:102})).status,409);
  await db.prepare('UPDATE mt5_links SET history_since=? WHERE id=?')
    .bind(approvedSince,link).run();
  // An extended duration is valid after the earlier scan finishes.
  assert.equal((await call('mt5/history-request',{link,mode:'days',days:180})).status,200);
  let selected=(await (await device('sync',{link,events:[]})).json()).history;
  assert.equal(selected.mode,'days');
  assert.equal((await call('mt5/history-decline',{link,request:selected.id})).status,200);
  assert.equal((await call('mt5/history-request',{link,mode:'all'})).status,200);
  selected=(await (await device('sync',{link,events:[]})).json()).history;
  assert.equal(selected.mode,'all');
  assert.equal(selected.since,0);
  assert.equal((await call('mt5/history-decline',{link,request:selected.id})).status,200);

  assert.equal((await call('mt5/history-request',{link,mode:'from_date',since:'2025-01-15'})).status,200);
  selected=(await (await device('sync',{link,events:[]})).json()).history;
  assert.equal(selected.since,Date.parse('2025-01-15T00:00:00.000Z'));
  assert.equal((await call('mt5/history-decline',{link,request:selected.id})).status,200);

  assert.equal((await call('mt5/history-request',{link,mode:'since_last_deposit'})).status,200);
  selected=(await (await device('sync',{link,events:[]})).json()).history;
  assert.equal(selected.status,'resolving');
  assert.equal(selected.mode,'since_last_deposit');
  assert.equal((await call('mt5/history-preview',{link,request:selected.id})).status,409);
  assert.equal((await device('history-anchor',{link,request:selected.id,found:true,since:-1,ticket:'1',amount:100})).status,400);
  const boundary=Date.now()-7*86400000;
  assert.equal((await device('history-anchor',{link,request:selected.id,found:true,since:boundary,ticket:'777',amount:100})).status,200);
  assert.equal((await device('history-anchor',{link,request:selected.id,found:true,since:boundary,ticket:'777',amount:100})).status,409);
  selected=(await (await device('sync',{link,events:[]})).json()).history;
  assert.equal(selected.since,boundary);
  assert.equal(selected.anchor_ticket,'777');
  assert.equal((await device('history-progress',{link,request:selected.id,scanned_until:boundary-1})).status,409);
  assert.equal((await device('history-progress',{link,request:selected.id,scanned_until:boundary+1000})).status,200);
  assert.equal((await call('mt5/history-decline',{link,request:selected.id})).status,200);

  assert.equal((await call('mt5/history-request',{link,mode:'since_first_deposit'})).status,200);
  selected=(await (await device('sync',{link,events:[]})).json()).history;
  assert.equal(selected.status,'resolving');
  assert.equal((await device('history-anchor',{link,request:selected.id,found:false})).status,200);
  assert.equal((await (await device('sync',{link,events:[]})).json()).history.status,'no_deposit');
  // Rich capture contract: immutable evidence, latest projection, owner isolation
  // and separate, explicit broker timezone/UTC conversion evidence.
  assert.equal((await call('mt5/timezone-confirm',{link,timezone:'not-a-timezone',confirm:true})).status,400);
  assert.equal((await call('mt5/timezone-confirm',{link,timezone:'Europe/Athens',confirm:false})).status,400);
  const zone=await call('mt5/timezone-confirm',{link,timezone:'Europe/Athens',confirm:true});
  assert.equal(zone.status,200);
  assert.equal((await zone.json()).utc_conversion_status,'unverified');
  const confirmed=await call('mt5/timezone-confirm',{
    link,timezone:'Europe/Athens',confirm:true,utcEvidence:'broker_statement_checked'
  });
  assert.equal((await confirmed.json()).utc_conversion_status,'confirmed');
  const withZone=(await (await call('mt5/status',{})).json()).links.find(item=>item.id===link);
  assert.equal(withZone.broker_timezone,'Europe/Athens');
  assert.equal(withZone.utc_conversion_status,'confirmed');
  const fill={ticket:'781',position_id:'789',time_msc:1736500000000,volume:1,price:1.1,type:0,order:'700'};
  const evidenceEvent={kind:'raw',key:'deal-781',fields:fill};
  assert.equal((await device('sync',{link,events:[evidenceEvent]})).status,200);
  assert.equal((await device('sync',{link,events:[evidenceEvent]})).status,200);
  assert.equal((await device('sync',{link,events:[{...evidenceEvent,fields:{...fill,price:1.2}}]})).status,409,
    'An immutable broker ticket must not silently mutate on replay');
  const rawCount=await db.prepare('SELECT COUNT(*) AS count FROM mt5_raw_evidence WHERE link=?').bind(link).first();
  assert.equal(rawCount.count,1);
  // Cash transfers are detected from raw immutable MT5 DEAL_TYPE_BALANCE
  // history, including deals predating the pairing. They are NOT trade P&L.
  const cashTime=Date.now()-12*86400000;
  const deposit={ticket:900001,type:2,time_msc:cashTime,profit:1250,comment:'Sample balance credit'};
  const withdrawal={ticket:900002,type:2,time_msc:cashTime+1000,profit:-325,comment:'Sample balance debit'};
  const bonus={ticket:900003,type:6,time_msc:cashTime+2000,profit:100};
  const cashEvents=[deposit,withdrawal,bonus].map(d=>({kind:'raw',key:'deal-'+d.ticket,fields:d}));
  assert.equal((await device('sync',{link,events:cashEvents})).status,200);
  assert.equal((await device('sync',{link,events:cashEvents})).status,200);
  let cashResult=await call('mt5/cash-movements',{link});
  assert.equal(cashResult.status,200);
  let cash=(await cashResult.json());
  assert.equal(cash.rows.length,2,'Broker credits/bonuses must not be silently called deposits');
  assert.equal(cash.summary.incoming,1250);
  assert.equal(cash.summary.outgoing,325);
  assert.equal(cash.summary.netCashFlow,925);
  assert.equal(cash.summary.externalFlowsVerified,false);
  assert.equal(cash.summary.overallProfitVerified,false);
  assert.equal(cash.summary.scanStatus,'not_started');
  const oldRaw=await device('sync',{link,events:[{kind:'raw',key:'deal-900001',fields:{...deposit,profit:2000}}]});
  assert.equal(oldRaw.status,409,'Existing broker balance evidence cannot be changed');
  assert.equal((await device('sync',{link,events:[],cashScan:{cursor:-1,complete:false}})).status,400);
  assert.equal((await device('sync',{link,events:[],cashScan:{cursor:0,complete:false}})).status,200);
  cash=(await (await call('mt5/cash-movements',{link})).json());
  assert.equal(cash.summary.scanStatus,'scanning');
  assert.equal((await device('sync',{link,events:[],cashScan:{cursor:0,complete:true}})).status,200);
  cash=(await (await call('mt5/cash-movements',{link})).json());
  assert.equal(cash.summary.scanStatus,'epoch_scanned');
  assert.equal(cash.rows[0].ticket,'900002');
  assert.equal((await call('mt5/cash-movements',{link:'not-a-real-link'})).status,404);

  const projected={
    calculation_version:1,lifecycle_id:'789:0',position_id:'789',symbol:'EURUSD',
    direction:'long',status:'closed',
    first_entry_at:'2026-01-01T00:00:00.000Z',final_exit_at:'2026-01-01T00:30:00.000Z',
    initial_risk_account:'12.5',final_realized_r:'1.2',net_realized_profit:'15',
    capture_completeness:{original_risk:'known',session_status:'confirmed'},
    entries:[{deal_ticket:'781'}],exits:[{deal_ticket:'782'}],
  };
  const rich={kind:'lifecycle',key:'lifecycle:789:0',fields:projected};
  assert.equal((await device('sync',{link,events:[rich]})).status,200);
  assert.equal((await device('sync',{link,events:[rich]})).status,200);
  let latest=(await (await call('mt5/positions',{})).json()).rows;
  assert.equal(latest.length,1);
  assert.equal(latest[0].version,1);
  assert.equal(latest[0].summary.final_realized_r,'1.2');
  assert.equal(latest[0].account_id,linkedAccount);
  const revised={...projected,net_realized_profit:'16',final_realized_r:'1.28'};
  assert.equal((await device('sync',{link,events:[{...rich,fields:revised}]})).status,200);
  latest=(await (await call('mt5/positions',{})).json()).rows;
  assert.equal(latest.length,1,'One lifecycle row regardless of revised projections');
  assert.equal(latest[0].version,2);
  assert.equal(latest[0].summary.net_realized_profit,'16');
  const allVersions=await db.prepare('SELECT COUNT(*) AS count FROM mt5_position_versions WHERE link=? AND lifecycle_id=?')
    .bind(link,'789:0').first();
  assert.equal(allVersions.count,2);
  const evidence=(await (await call('mt5/position-evidence',{link,lifecycle_id:'789:0'})).json()).rows;
  assert.equal(evidence.length,1);
  assert.equal(evidence[0].payload.ticket,'781');
  assert.equal((await call('mt5/position-evidence',{link,lifecycle_id:'not-a-position'})).status,400);

  const brokerRef='position/'+link+'/789:0';
  const brokerReview={id:'review/'+subject+'/'+brokerRef,reference:brokerRef,verdict:'unsure',note:'Waited for my trigger.'};
  assert.equal((await call('data',{action:'insert',table:'decision_reviews',payload:{...brokerReview,strategy_id:'missing'}})).status,400);
  const writeReview=()=>call('data',{action:'insert',table:'decision_reviews',payload:brokerReview});
  const posted=await writeReview();
  assert.equal(posted.status,200);
  const reviewVersion=(await posted.json()).data[0].updated_at;
  assert.equal((await writeReview()).status,200, 'Retrying an identical annotation is idempotent.');
  assert.equal((await call('data',{action:'insert',table:'decision_reviews',payload:{...brokerReview,verdict:'changed'}})).status,409);
  const revise={action:'update',table:'decision_reviews',id:brokerReview.id,filters:{updated_at:reviewVersion},payload:{verdict:'followed'}};
  assert.equal((await call('data',revise)).status,200);
  assert.equal((await call('data',revise)).status,409);
  assert.equal((await (await call('mt5/status',{})).json()).links.find(l=>l.id===link).pending_reviews,0);
  const contextInput={reference:'trade/'+row.id,strategy_id:'as-of-strategy',entry_model_id:'as-of-model'};
  const effective='2025-12-31T09:00:00.000Z';
  for(const [table,id,payload] of [
    ['trader_strategies','as-of-strategy',{name:'Opening range'}],
    ['strategy_entry_models','as-of-model',{name:'Retest',strategy_id:'as-of-strategy',earliest_entry_utc:'09:15',requires_opening_stop:true}]
  ]) await db.prepare('INSERT INTO workspace_records(id,user_id,table_name,payload,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .bind(id,subject,table,JSON.stringify({id,...payload}),effective,effective).run();
  const readRules=async()=>(await (await call('decision/context',contextInput)).json());
  assert.equal((await readRules()).earliest,'09:15');
  assert.equal((await call('data',{action:'update',table:'strategy_entry_models',id:'as-of-model',payload:{earliest_entry_utc:'11:45'}})).status,200);
  assert.equal((await readRules()).earliest,'09:15','Later playbook changes cannot rewrite the rule at entry.');
  // Two independent demo/contest accounts can coexist for one journal owner.
  const secondLink=(await (await call('mt5/connect',{device:devices[0].id,envelope:{wrapped:'d',iv:'e',data:'f'}})).json()).id;
  assert.equal((await (await device('poll',{})).json()).job.id,secondLink);
  assert.equal((await device('verified',{link:secondLink,ok:true,mode:1,trade_access:false,login:'43',server:'Demo',company:'Fixtures',currency:'EUR',balance:200})).status,200);
  const linked=(await (await call('mt5/status',{})).json()).links;
  assert.equal(linked.filter(l=>l.status==='connected').length,2);
  const secondAccount = linked.find(l => l.id === secondLink);
  assert.equal(secondAccount.access_level,'trading-restricted');
  assert.notEqual(secondAccount.account_id,linkedAccount);
  assert.equal(secondAccount.server,verifiedAccess.server);
  assert.equal((await call('mt5/set-monitoring',{link:secondLink,paused:true})).status,200);
  assert.deepEqual((await presence()).paused,[secondLink]);
  assert.equal((await device('sync',{link:secondLink,events:[]})).status,423);
  assert.equal((await device('sync',{link,events:[]})).status,200);
  assert.equal((await device('set-monitoring',{link:secondLink,paused:false})).status,200);
  assert.deepEqual((await presence()).paused,[]);
  assert.equal((await device('sync',{link:secondLink,events:[]})).status,200);
  // Independent logins on a single broker server can reuse every broker ticket.
  const secondEvents = [
    {...evidenceEvent,fields:{...fill,price:1.3}},
    {...rich,fields:{...projected,net_realized_profit:'-7',final_realized_r:'-0.56'}},
  ];
  for (let i=0; i<2; i++) {
    const ack=await (await device('sync',{link:secondLink,events:secondEvents})).json();
    assert.equal(ack.pending_reviews,1);
  }
  const separate=(await (await call('mt5/positions',{})).json()).rows;
  assert.equal(separate.length,2);
  const firstPosition=separate.find(p=>p.link===link), secondPosition=separate.find(p=>p.link===secondLink);
  assert.deepEqual([firstPosition.account_id,firstPosition.summary.settlement_currency,firstPosition.summary.net_realized_profit,firstPosition.version],[linkedAccount,'USD','16',2]);
  assert.deepEqual([secondPosition.account_id,secondPosition.summary.settlement_currency,secondPosition.summary.net_realized_profit,secondPosition.version],[secondAccount.account_id,'EUR','-7',1]);
  const secondEvidence=(await (await call('mt5/position-evidence',{link:secondLink,lifecycle_id:'789:0'})).json()).rows;
  assert.equal(secondEvidence[0].payload.price,1.3);
  const firstEvidence=(await (await call('mt5/position-evidence',{link,lifecycle_id:'789:0'})).json()).rows;
  assert.equal(firstEvidence[0].payload.price,1.1);
  const secondRef='position/'+secondLink+'/789:0';
  assert.equal((await call('data',{action:'insert',table:'decision_reviews',payload:{
    id:'review/'+subject+'/'+secondRef,reference:secondRef,verdict:'changed',note:'Second demo.',
  }})).status,200);
  const reviewRows=(await (await call('data',{action:'select',table:'decision_reviews'})).json()).data;
  assert.equal(reviewRows.find(r=>r.reference===brokerRef).account_id,linkedAccount);
  assert.equal(reviewRows.find(r=>r.reference===secondRef).account_id,secondAccount.account_id);
  assert.equal(reviewRows.find(r=>r.reference===brokerRef).verdict,'followed');
  assert.equal(reviewRows.find(r=>r.reference===secondRef).verdict,'changed');
  assert.equal((await call('mt5/retry-session',{link:secondLink})).status,200);
  assert.equal((await device('capture-issue',{link:secondLink})).status,200);
  assert.equal((await (await call('mt5/status',{})).json()).links.find(l=>l.id===secondLink).capture_health,'needs_attention');
  assert.deepEqual((await (await device('retries',{})).json()).rows.map(r=>r.id),[secondLink]);
  await device('sync',{link,events:[]});
  assert.equal((await (await device('retries',{})).json()).rows.length,1);
  const receipt=await (await device('sync',{link:secondLink,events:[]})).json();
  assert.ok(receipt.synced_at);
  assert.deepEqual((await (await device('retries',{})).json()).rows,[]);
  await db.prepare('UPDATE mt5_links SET trade_mode=2 WHERE id=?').bind(secondLink).run();
  assert.equal((await device('sync',{link:secondLink,events:[]})).status,403,'Pausing real capture blocks existing linked devices');
  assert.equal((await call('mt5/history-request',{link:secondLink,days:30})).status,403);
  await db.prepare('UPDATE mt5_links SET trade_mode=1 WHERE id=?').bind(secondLink).run();
  assert.equal((await device('sync',{link:secondLink,events:[]})).status,200);
  // Replacing a one-fill scan with another one-fill scan still invalidates its preview.
  async function scanHistoryFill(key) {
    assert.equal((await call('mt5/history-request',{link:secondLink,days:30})).status,200);
    const scan=(await (await device('sync',{link:secondLink,events:[]})).json()).history;
    const events=[{kind:'history',key:'history:'+scan.id+':close-'+key,fields:older}];
    assert.equal((await device('sync',{link:secondLink,events,history_done:scan.id})).status,200);
    const page=await (await call('mt5/history-preview',{link:secondLink,request:scan.id,offset:0})).json();
    assert.equal(page.rows.length,1);
    return page.request;
  }
  const replaced=await scanHistoryFill(931), replacement=await scanHistoryFill(932);
  assert.notEqual(replaced,replacement);
  assert.equal((await call('mt5/history-import',{link:secondLink,request:replaced,expected_count:1})).status,409);
  assert.equal((await call('mt5/history-decline',{link:secondLink,request:replaced})).status,409);
  const accepted=await (await call('mt5/history-import',{link:secondLink,request:replacement,expected_count:1})).json();
  assert.equal(accepted.added,1);
  assert.equal((await (await call('data',{action:'select',table:'trades',filters:{id:secondLink+'/close-931'}})).json()).count,0);
  assert.equal((await (await call('data',{action:'select',table:'trades',filters:{id:secondLink+'/close-932'}})).json()).data[0].account_id,secondAccount.account_id);
  const pendingReal=(await (await call('mt5/connect',{device:devices[0].id,envelope:{wrapped:'g',iv:'h',data:'i'}})).json()).id;
  assert.equal((await (await device('poll',{})).json()).job.id,pendingReal);
  assert.equal((await device('verified',{link:pendingReal,ok:true,mode:'2',trade_access:true,login:'44',server:'Real',company:'Fixtures',currency:'USD',balance:100})).status,400);
  assert.equal((await device('verified',{link:pendingReal,ok:true,mode:2,trade_access:true,login:'44',server:'Real',company:'Fixtures',currency:'USD',balance:100})).status,409);
  assert.equal((await (await call('mt5/status',{})).json()).links.find(l=>l.id===pendingReal).status,'failed');
  assert.equal((await call('admin',{action:'overview'})).status,403);
  await db.prepare("UPDATE users SET account_status='suspended'").run();
  assert.equal((await call('data',insert)).status,401);
  assert.equal((await device('sync',batch)).status,403);
  const other=await call('auth/signup',{email:'other@example.test',username:'second',password:'local-test-pass',invite_code:'integration'});
  cookie=other.headers.get('set-cookie').split(';')[0];
  assert.deepEqual((await (await call('mt5/status',{})).json()).links,[]);
  assert.equal((await call('mt5/rename-pc',{device:devices[0].id,name:'Intrusion'})).status,404);
  assert.deepEqual((await (await call('mt5/positions',{})).json()).rows,[]);
  assert.equal((await call('decision/context',contextInput)).status,404);
  assert.equal((await call('mt5/retry-session',{link})).status,404);
  assert.equal((await (await call('data',{action:'select',table:'decision_reviews'})).json()).count,0);
  assert.equal((await call('mt5/timezone-confirm',{link,timezone:'Etc/UTC',confirm:true})).status,404);
  assert.equal((await call('mt5/position-evidence',{link,lifecycle_id:'789:0'})).status,404);
  assert.equal((await (await call('data',{action:'select',table:'trades'})).json()).count,0);
  assert.equal((await call('data',{action:'update',table:'trades',id:row.id,
    filters:{updated_at:records[0].updated_at},payload:{notes:'intrusion'}})).status,404);
  assert.equal((await call('mt5/history-preview',{link})).status,404);
  assert.equal((await call('mt5/history-request',{link,days:30})).status,404);
  assert.equal((await call('data',{action:'insert',table:'trading_account_adjustments',
    payload:{id:'foreign-adjustment',account_id:linkedAccount,amount:4,reason:'cross-user'}})).status,400);
  await db.prepare("UPDATE users SET role='admin' WHERE username='second'").run();
  const overview=await call('admin',{action:'overview'});
  assert.equal(overview.status,200);
  assert.equal((await overview.json()).users.total,2);
  assert.equal((await call('admin',{action:'set-signups',paused:true})).status,200);
  assert.equal((await call('auth/signup',{email:'blocked@example.test',username:'third',password:'local-test-pass',invite_code:'integration'})).status,403);
  assert.equal((await call('admin',{action:'set-signups',paused:false})).status,200);
  assert.equal((await call('admin',{action:'set-mt5-capture',paused:true})).status,400);
  assert.equal((await call('admin',{action:'set-mt5-capture',paused:true,currentPassword:'wrong'})).status,403);
  assert.equal((await call('admin',{action:'set-mt5-capture',paused:true,currentPassword:'local-test-pass'})).status,200);
  assert.equal((await device('sync',{link,events:[]})).status,403);
  assert.equal((await call('mt5/pair',{})).status,403);
  assert.equal((await call('mt5/history-request',{link,days:30})).status,404,'Other user cannot access source link while capture is paused');
  assert.equal((await call('admin',{action:'overview'}).then(r=>r.json())).mt5CapturePaused,true);
  assert.equal((await call('admin',{action:'set-mt5-capture',paused:false,currentPassword:'local-test-pass'})).status,200);
  assert.equal((await device('sync',{link,events:[]})).status,403,'Suspended account stays blocked after global capture resumes');
  assert.equal((await call('admin',{action:'issue-recovery',targetUserId:subject,currentPassword:'local-test-pass'})).status,409,'Suspended accounts cannot be reset');
  assert.equal((await call('admin',{action:'restore',targetUserId:subject})).status,200);
  assert.equal((await device('sync',{link,events:[]})).status,200,'Restored account can sync when global capture is enabled');
  assert.equal((await call('admin',{action:'issue-recovery',targetUserId:subject,currentPassword:'wrong'})).status,403);
  assert.equal((await call('admin',{action:'issue-recovery',targetUserId:subject})).status,400);
  const grantResponse=await call('admin',{action:'issue-recovery',targetUserId:subject,currentPassword:'local-test-pass'});
  assert.equal(grantResponse.status,200);
  const grant=await grantResponse.json();
  assert.match(grant.code,/^[A-Za-z0-9_-]{43}$/);
  const stored=await db.prepare('SELECT token_hash FROM recovery_codes WHERE user_id=?').bind(subject).first();
  assert.notEqual(stored.token_hash,grant.code,'Never persist recovery secrets in plaintext');
  const loggedIn=await call('auth/signin',{email:'member@example.test',password:'local-test-pass'});
  assert.equal(loggedIn.status,200);
  const memberCookie=loggedIn.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('auth/recover',{email:'member@example.test',code:grant.code,password:'123'})).status,400);
  const redeemed=await call('auth/recover',{email:'member@example.test',code:grant.code,password:'new secure passphrase 123'});
  assert.equal(redeemed.status,200);
  assert.equal((await call('auth/recover',{email:'member@example.test',code:grant.code,password:'another secure passphrase'})).status,400);
  assert.equal((await call('auth/signin',{email:'member@example.test',password:'local-test-pass'})).status,401);
  const newSession=await call('auth/signin',{email:'member@example.test',password:'new secure passphrase 123'});
  assert.equal(newSession.status,200);
  const newMemberCookie=newSession.headers.get('set-cookie').split(';')[0];
  assert.equal((await mf.dispatchFetch('https://journal.example/api/me',{headers:{cookie:memberCookie}})).status,401);
  assert.equal((await call('admin',{action:'revoke-sessions',targetUserId:subject})).status,200);
  assert.equal((await mf.dispatchFetch('https://journal.example/api/me',{headers:{cookie:newMemberCookie}})).status,401);
  assert.equal((await call('admin',{action:'issue-recovery',targetUserId:subject,currentPassword:'local-test-pass'})).status,200);
  assert.equal((await call('admin',{action:'revoke-recovery',targetUserId:subject})).status,200);
  objects.add(subject+'/folder/screenshot.png');
  objects.add(subject+'/voice.webm');
  assert.equal((await call('admin',{action:'delete',targetUserId:subject})).status,200);
  assert.equal(objects.size,0);
  // Preview is a real isolated account on staging, but cannot mutate state.
  const availability=await mf.dispatchFetch('https://journal.example/api/demo/available');
  assert.equal((await availability.json()).enabled,true);
  for(const statement of buildDemoStatements())await db.prepare(statement).run();
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM workspace_records WHERE user_id=? AND table_name='trades'").bind(DEMO_ID).first()).n,demoCounts.trades);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM mt5_position_versions WHERE owner=?").bind(DEMO_ID).first()).n,17);
  assert.equal((await mf.dispatchFetch('https://journal.example/api/demo/enter',{method:'POST'})).status,401,
    'Invite-only staging must not issue anonymous preview sessions');
  const entrance=await mf.dispatchFetch('https://journal.example/api/demo/enter',{
    method:'POST',headers:{cookie}});
  assert.equal(entrance.status,200);
  const demoCookie=entrance.headers.get('set-cookie').split(';')[0];
  const demo=async (path,payload={},method='POST')=>mf.dispatchFetch('https://journal.example/api/'+path,{
    method,headers:{cookie:demoCookie,'content-type':'application/json'},
    body:method==='GET'?undefined:JSON.stringify(payload)});
  const demoUser=await (await demo('me',{},'GET')).json();
  assert.equal(demoUser.user.id,DEMO_ID);
  assert.equal(demoUser.user.password_hash,undefined);
  assert.equal((await (await demo('data',{action:'select',table:'trades'})).json()).count,demoCounts.trades);
  assert.equal((await (await demo('data',{action:'select',table:'journal_entries'})).json()).count,demoCounts.journal_entries);
  assert.equal((await (await demo('data',{action:'select',table:'goals'})).json()).count,demoCounts.goals);
  assert.equal((await (await demo('mt5/positions',{})).json()).rows.length,17);
  assert.equal((await (await demo('mt5/status',{})).json()).links.length,1);
  assert.equal((await demo('account-summaries',{},'GET')).status,200);
  for(const [path,body] of [
    ['data',{action:'insert',table:'trades',payload:{pair:'EURUSD'}}],
    ['data',{action:'update',table:'notes',id:'demo-note-1',payload:{content:'tamper'}}],
    ['data',{action:'delete',table:'journal_entries',id:'demo-journal-1'}],
    ['mt5/pair',{}],
    ['mt5/history-request',{link:'demo-broker-link-preview',days:30}],
    ['mt5/revoke',{device:'demo-device-unpaired'}],
    ['admin',{action:'overview'}],
    ['auth/profile',{display_name:'Tampered'}],
    ['auth/password',{password:'attempt',current_password:'unknown'}],
  ])assert.equal((await demo(path,body)).status,403,'Read-only preview route: '+path);
  assert.equal((await demo('media/upload',{})).status,403);
  assert.equal((await call('auth/signin',{email:'showcase@youngmoney3.invalid',password:'anything'})).status,401);
  assert.equal((await demo('auth/signout',{})).status,200);
  assert.equal((await demo('me',{},'GET')).status,401);
  console.log('Local D1 passed migrations, authentication, idempotent writes, account isolation, scan revisions, replay and suspension.');
} finally {await mf.dispose();}


