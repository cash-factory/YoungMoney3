/** Full miniflare/D1 fleet contract: multiple followers, source proofs, demo
 * permissions, broker task queue and emergency stop. Zero real MT5 calls. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

const bundle=await build({entryPoints:['worker/index.ts'],bundle:true,format:'esm',write:false,
  external:['cloudflare:workers']});
const mf=new Miniflare(convertV4MiniflareOptions({
  workers:[{name:'copy-fleet',modules:true,script:bundle.outputFiles[0].text,
    compatibilityDate:'2026-10-10',d1Databases:['DB'],
    durableObjects:{AUTH_KDF:{className:'AuthKdf',useSQLite:true}},
    bindings:{PILOT_INVITE_CODE:'fleet-demo',MT5_ALLOW_LIVE:'false',MT5_LIVE_COPY_EXECUTION:'true'}}],port:0,
}));
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const now=Date.now();
try{
  const db=await mf.getD1Database('DB');
  for(const file of (await readdir('migrations')).sort()){
    const sql=await readFile('migrations/'+file,'utf8');
    let buffer='';
    for(const line of sql.split(/\r?\n/)){
      buffer+=line+'\n';
      if(line.trimEnd().endsWith(';')&&
        (!buffer.trimStart().startsWith('CREATE TRIGGER')||line.trim()==='END;')){
          await db.prepare(buffer.trim()).run();buffer='';
        }
    }
    assert.equal(buffer.trim(),'','Migration parser could not apply '+file);
  }
  async function call(path,body={},cookie='',token=''){
    const response=await mf.dispatchFetch('https://fleet.test/api/'+path,{
      method:'POST',headers:{'content-type':'application/json',
        ...(cookie?{cookie}:{}),...(token?{authorization:'Bearer '+token}:{})},
      body:JSON.stringify(body),
    });
    const result=await response.json();
    return {status:response.status,result};
  }
  const signup=async(n)=>{
    const x=await call('auth/signup',{email:'fleet'+n+'@example.invalid',
      username:'fleet_'+n,display_name:'Demo '+n,password:'sample password only',
      invite_code:'fleet-demo'});
    assert.equal(x.status,200,JSON.stringify(x.result));
    return {cookie:x.result?undefined:undefined,
      user:x.result.user,token:x}; // cookie is extracted in separate call below
  };
  // Extract session Set-Cookie from the full response rather than JSON.
  async function signupUser(n){
    const response=await mf.dispatchFetch('https://fleet.test/api/auth/signup',{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
        email:'fleet'+n+'@example.invalid',username:'fleet_'+n,display_name:'Demo '+n,
        password:'sample password only',invite_code:'fleet-demo',
      }),
    });
    const data=await response.json();
    assert.equal(response.status,200,JSON.stringify(data));
    return {cookie:response.headers.get('set-cookie').split(';')[0],id:data.user.id};
  }
  const owner=await signupUser(1),stranger=await signupUser(2);
  const device1=id(20),device2=id(21),source=id(30),f1=id(31),f2=id(32),f3=id(33),
        foreign=id(34),live=id(35),accountIds=[source,f1,f2,f3,live,foreign];
  const token='A'.repeat(72),strangerToken='B'.repeat(72);
  const sha=s=>createHash('sha256').update(s).digest('hex');
  for(const [d,user,t] of [[device1,owner.id,token],[device2,stranger.id,strangerToken]]){
    await db.prepare("INSERT INTO mt5_devices(id,owner,expires,public_key,last_seen,token_hash,revoked) VALUES(?,?,?,?,?,?,0)")
      .bind(d,user,now+86400000,'fixture public key',now,sha(t)).run();
  }
  let i=0;
  for(const [l,user,d,mode,currency,equity] of [
    [source,owner.id,device1,0,'USD',1000],
    [f1,owner.id,device1,0,'USD',2500],
    [f2,owner.id,device1,0,'EUR',1500],
    [f3,owner.id,device1,0,'USD',200],
    [live,owner.id,device1,2,'USD',3000],
    [foreign,stranger.id,device2,0,'USD',10000],
  ]){
    await db.prepare("INSERT INTO mt5_links(id,device,owner,account_id,status,server,login,company,currency,trade_mode,access_level,last_sync,broker_balance,broker_equity,expires,monitoring_paused) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)")
      .bind(l,d,user,accountIds[i++],'connected','DemoServer',String(5000+i),'Demo broker',
        currency,mode,'trading-enabled',new Date().toISOString(),equity,equity,now+86400000).run();
  }
  const loginFor=Object.fromEntries([source,f1,f2,f3,live,foreign].map((l,i)=>[l,String(5001+i)]));
  const deviceConsent=(link,allowed,mode='demo')=>({link,allowed,mode,login:loginFor[link],server:'DemoServer'});
  const targets=[
    {link:f1,mode:'risk_pct_equity',value:1,maxLots:2,maxDailyLossPct:2,enabled:true,symbolMap:{},mirrorPending:true,mirrorProtection:true},
    {link:f2,mode:'fixed_risk',value:25,maxLots:1,maxDailyLossPct:2,enabled:true,symbolMap:{'EURUSD':'EURUSD.a'},mirrorPending:true,mirrorProtection:true},
    {link:f3,mode:'equity_ratio',value:1,maxLots:0.5,maxDailyLossPct:2,enabled:true,symbolMap:{},mirrorPending:true,mirrorProtection:true},
  ];
  assert.equal((await call('copy/fleet-status',{},stranger.cookie)).result.accounts.length,1);
  assert.equal((await call('copy/fleet-save',{name:'Bad source',sourceLink:source,targets},stranger.cookie)).status,403);
  assert.equal((await call('copy/fleet-save',{name:'Bad live',sourceLink:source,targets:[{...targets[0],link:live}]},owner.cookie)).status,403);
  assert.equal((await call('copy/fleet-save',{name:'Bad owner',sourceLink:source,targets:[{...targets[0],link:foreign}]},owner.cookie)).status,403);
  assert.equal((await call('copy/fleet-save',{name:'Bad duplicate',sourceLink:source,targets:[targets[0],targets[0]]},owner.cookie)).status,400);
  const saved=await call('copy/fleet-save',{name:'London opening orders',sourceLink:source,targets},owner.cookie);
  assert.equal(saved.status,200,JSON.stringify(saved.result));
  const fleet=saved.result.id;
  assert.equal(saved.result.state,'paused');
  assert.equal((await call('copy/fleet-status',{},owner.cookie)).result.fleets[0].targets.length,3);
  const preview=await call('copy/fleet-preview',{id:fleet,sourceLots:0.2,sourceEquity:1000,
    entry:1.1,stop:1.095,direction:'buy'},owner.cookie);
  assert.equal(preview.status,200,JSON.stringify(preview.result));
  assert.equal(preview.result.previews.length,3);
  assert.equal(preview.result.previews.find(x=>x.followerLink===f1).plannedRiskBudget,25);
  assert.equal(preview.result.previews.find(x=>x.followerLink===f2).plannedRiskBudget,25);
  assert.equal(preview.result.previews.find(x=>x.followerLink===f3).indicativeLots,0.04);
  assert.equal(preview.result.executionOccurred,false);
  assert.equal((await call('copy/fleet-arm',{id:fleet,version:1,confirm:true},owner.cookie)).status,409,
    'No browser permission may override local follower authorization.');
  assert.equal((await call('mt5/device/copy-consent',deviceConsent(live,true,'demo'),'',token)).status,403);
  assert.equal((await call('mt5/device/copy-consent',deviceConsent(f1,true),'',strangerToken)).status,404);
  for(const l of [f1,f2,f3]){
    const approved=await call('mt5/device/copy-consent',deviceConsent(l,true),'',token);
    assert.equal(approved.status,200,JSON.stringify(approved.result));
    const t=await call('mt5/device/copy-report',{link:l,balance:2000,equity:1950,freeMargin:1800,
      currency:l===f2?'EUR':'USD',openPositions:1,pendingOrders:2,connected:true,
      tradeAllowed:true},'',token);
    assert.equal(t.status,200);
  }
  const armed=await call('copy/fleet-arm',{id:fleet,version:1,confirm:true},owner.cookie);
  assert.equal(armed.status,200,JSON.stringify(armed.result));
  assert.equal(armed.result.state,'demo_armed');
  assert.equal((await call('copy/fleet-arm',{id:fleet,version:1,confirm:true},owner.cookie)).status,409);
  const sourceReport=await call('mt5/device/copy-report',{link:source,balance:1000,equity:1000,
    freeMargin:1000,currency:'USD',openPositions:0,pendingOrders:0,
    connected:true,tradeAllowed:true},'',token);
  assert.equal(sourceReport.result.sourceActive,true);
  const observedAt=Date.now();
  const item={
    key:'position:888',kind:'position',symbol:'EURUSD',type:0,volume:0.2,
    price:1.1,sl:1.095,tp:1.115,stoplimit:0,expiration:0,time_ms:observedAt,
  };
  const snapshot=async(when,items,proofs=[])=>call('mt5/device/copy-source',{
    link:source,sourceEquity:1000,sourceCurrency:'USD',items,proofs,observedAt:when},'',token);
  const baseline=await snapshot(observedAt+1,[]);
  assert.equal(baseline.status,200,JSON.stringify(baseline.result));
  assert.equal(baseline.result.intents_queued,0);
  const opened=await snapshot(observedAt+2,[item]);
  assert.equal(opened.status,200,JSON.stringify(opened.result));
  assert.equal(opened.result.intents_queued,3);
  let pending=(await db.prepare("SELECT COUNT(*) AS n FROM copy_execution_tasks WHERE fleet_id=? AND action='open_market'").bind(fleet).first()).n;
  assert.equal(pending,3);
  assert.equal((await snapshot(observedAt+2,[item])).result.ignored,'out_of_order');
  assert.equal((await snapshot(observedAt+3,[item])).result.intents_queued,0);
  for(const follower of [f1,f2,f3]){
    const claim=await call('mt5/device/copy-poll',{link:follower},'',token);
    assert.equal(claim.status,200,JSON.stringify(claim.result));
    assert.equal(claim.result.task?.action,'open_market');
    const issued=claim.result.task;
    assert.equal(issued.payload.risk.mode,targets.find(t=>t.link===follower).mode);
    assert.equal((await call('mt5/device/copy-poll',{link:follower},'',token)).result.task,null,
      'An uncertain broker submission cannot be delivered a second time.');
    const ack=await call('mt5/device/copy-ack',{link:follower,task:issued.id,
      status:'applied',code:'broker_confirmed_position',brokerTicket:'123456',retcode:10009,
      details:{lots:0.10,risk_amount:12.5,risk_pct_equity:0.5}},'',token);
    assert.equal(ack.status,200,JSON.stringify(ack.result));
    assert.equal((await call('mt5/device/copy-ack',{link:follower,task:issued.id,
      status:'applied',code:'again',brokerTicket:'123456',retcode:10009},'',token)).status,409);
  }
  const move=await snapshot(observedAt+4,[{...item,sl:1.098}]);
  assert.equal(move.status,200,JSON.stringify(move.result));
  assert.equal(move.result.intents_queued,3);
  const closeNoProof=await snapshot(observedAt+5,[]);
  assert.equal(closeNoProof.result.intents_queued,0,
    'An offline/missing source position must not invent a closing trade.');
  const status=await call('copy/fleet-status',{},owner.cookie);
  assert.equal(status.result.reports.length,4);
  assert.equal(status.result.tasks.length,6);
  const kill=await call('copy/fleet-pause-all',{},owner.cookie);
  assert.equal(kill.status,200);
  const count=(await db.prepare("SELECT COUNT(*) AS n FROM copy_execution_tasks WHERE status='cancelled'").first()).n;
  assert.equal(count,3,'All still-queued SL/TP modifications must be canceled immediately.');
  assert.equal((await call('mt5/device/copy-poll',{link:f1},'',token)).result.task,null);
  assert.equal((await call('copy/fleet-status',{},owner.cookie)).result.fleets[0].state,'paused');
  assert.equal((await call('mt5/device/copy-consent',deviceConsent(f1,false),'',token)).result.authorized,false);
  assert.equal((await call('mt5/device/copy-poll',{link:f1},'',token)).result.consentRequired,true);
  const livePolicy={...targets[0],link:live,value:0.5,maxDailyLossPct:2};
  const liveSaved=await call('copy/fleet-save',{
    name:'Real account pilot',sourceLink:source,executionMode:'live',
    targets:[livePolicy]},owner.cookie);
  assert.equal(liveSaved.status,200,JSON.stringify(liveSaved.result));
  const liveFleet=liveSaved.result.id;
  const confirmation='ARM LIVE '+liveFleet.slice(0,8);
  assert.equal((await call('copy/fleet-arm',{id:liveFleet,version:1,confirm:true},owner.cookie)).status,409);
  assert.equal((await call('copy/fleet-arm',{id:liveFleet,version:1,confirm:true,
    liveConfirmation:confirmation},owner.cookie)).status,409,'Local live consent is mandatory.');
  assert.equal((await call('mt5/device/copy-consent',
    deviceConsent(live,true,'demo'),'',token)).status,403);
  assert.equal((await call('mt5/device/copy-consent',{
    ...deviceConsent(live,true,'live'),login:'incorrect'},'',token)).status,403);
  const consentLive=await call('mt5/device/copy-consent',deviceConsent(live,true,'live'),'',token);
  assert.equal(consentLive.status,200,JSON.stringify(consentLive.result));
  assert.equal(consentLive.result.mode,'live');
  await db.prepare("UPDATE mt5_links SET login='999999' WHERE id=?").bind(live).run();
  assert.equal((await call('copy/fleet-arm',{id:liveFleet,version:1,confirm:true,
    liveConfirmation:confirmation},owner.cookie)).status,409,
    'A local consent cannot be reused after broker account identity changes.');
  await db.prepare("UPDATE mt5_links SET login=? WHERE id=?").bind(loginFor[live],live).run();
  const armedLive=await call('copy/fleet-arm',{
    id:liveFleet,version:1,confirm:true,liveConfirmation:confirmation},owner.cookie);
  assert.equal(armedLive.status,200,JSON.stringify(armedLive.result));
  assert.equal(armedLive.result.state,'live_armed');
  const liveSourceReport=await call('mt5/device/copy-report',{link:source,balance:1000,
    equity:1000,freeMargin:1000,currency:'USD',openPositions:0,pendingOrders:0,
    connected:true,tradeAllowed:true},'',token);
  assert.equal(liveSourceReport.result.sourceActive,true);
  const later=Math.max(Date.now(),observedAt+100);
  const liveFrame=(t,items)=>call('mt5/device/copy-source',{
    link:source,sourceEquity:1000,sourceCurrency:'USD',items,proofs:[],observedAt:t},'',token);
  assert.equal((await liveFrame(later,[])).status,200);
  const newPosition={...item,key:'position:9991',time_ms:later+1};
  const queuedLive=await liveFrame(later+1,[newPosition]);
  assert.equal(queuedLive.status,200,JSON.stringify(queuedLive.result));
  assert.equal(queuedLive.result.intents_queued,1);
  const liveDispatch=await call('mt5/device/copy-poll',{link:live},'',token);
  assert.equal(liveDispatch.status,200,JSON.stringify(liveDispatch.result));
  assert.equal(liveDispatch.result.task.executionMode,'live');
  assert.equal(liveDispatch.result.task.payload.risk.value,0.5);

  assert.equal((await call('copy/fleet-pause-all',{},owner.cookie)).status,200);
  assert.equal((await call('copy/fleet-status',{},owner.cookie)).result.fleets
    .find(x=>x.id===liveFleet).state,'paused');

  await assert.rejects(
    db.prepare("UPDATE copy_execution_audit SET event='rewritten' WHERE fleet_id=?").bind(fleet).run(),
    /immutable|not authorized|constraint|error/i,
    'Copy Fleet audit may not be rewritten.');
  // Scalability: eight configured followers (not three) are independently
  // described and previewed without arming or sending broker orders.
  const extraFollowers=[];
  for(let index=0;index<5;index++){
    const follower=id(100+index);
    await db.prepare("INSERT INTO mt5_links(id,device,owner,account_id,status,server,login,company,currency,trade_mode,access_level,last_sync,broker_balance,broker_equity,expires,monitoring_paused) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)")
      .bind(follower,device1,owner.id,id(200+index),'connected','DemoServer',
        String(6000+index),'Demo broker','USD',0,'trading-enabled',
        new Date().toISOString(),1200,1200,now+86400000).run();
    extraFollowers.push({...targets[0],link:follower,enabled:false});
  }
  const eight=await call('copy/fleet-save',{name:'Eight follower planning fixture',
    sourceLink:source,targets:[...targets,...extraFollowers]},owner.cookie);
  assert.equal(eight.status,200,JSON.stringify(eight.result));
  const eightPreview=await call('copy/fleet-preview',{id:eight.result.id,
    sourceLots:0.2,sourceEquity:1000,entry:1.1,stop:1.095,direction:'buy'},owner.cookie);
  assert.equal(eightPreview.status,200,JSON.stringify(eightPreview.result));
  assert.equal(eightPreview.result.previews.length,8);
  assert.equal((await call('copy/fleet-status',{},owner.cookie)).result.fleets
    .find(x=>x.id===eight.result.id).targets.length,8);
  assert.equal((await call('copy/fleet-status',{},'')).status,401);
  console.log('Copy Fleet: 3 authorized demo followers plus 8-account planning fixture, per-account authorization, fresh source fan-out, no stale/false closes, at-most-once dispatch, audit and global stop verified.');
}finally{await mf.dispose();}
