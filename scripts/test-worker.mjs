import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

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
  outboundService:storage,d1Databases:['DB'],bindings:{PILOT_INVITE_CODE:'integration',SUPABASE_URL:'https://storage.test',SUPABASE_SERVICE_ROLE_KEY:'fixture'}}],port:0}));
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
  const claim={code,publicKey:'ZmFrZQ=='};
  const token=(await (await call('mt5/device/claim',claim)).json()).token;
  assert.ok(token);assert.equal((await call('mt5/device/claim',claim)).status,403);
  const devices=(await (await call('mt5/status',{})).json()).devices;
  const link=(await (await call('mt5/connect',{device:devices[0].id,envelope:{wrapped:'a',iv:'b',data:'c'}})).json()).id;
  const device=(path,data)=>call('mt5/device/'+path,data,{authorization:'Bearer '+token});
  assert.equal((await (await device('poll',{})).json()).job.id,link);
  assert.equal((await (await device('poll',{})).json()).job,null);
  assert.equal((await device('verified',{link,ok:true,mode:0,trade_access:true,login:'42',server:'Demo',company:'Fixtures',currency:'USD',balance:100})).status,200);
  const verifiedAccess=(await (await call('mt5/status',{})).json()).links.find(l=>l.id===link);
  assert.equal(verifiedAccess.access_level,'trading-enabled');
  assert.equal(verifiedAccess.trade_mode,0);
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
  await call('mt5/history-request',{link,days:30});
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
  assert.equal(page1.rows.length,100);
  assert.equal(page1.more,true);
  const page2=(await (await call('mt5/history-preview',{link,offset:100})).json());
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
  // Two independent demo/contest accounts can coexist for one journal owner.
  const secondLink=(await (await call('mt5/connect',{device:devices[0].id,envelope:{wrapped:'d',iv:'e',data:'f'}})).json()).id;
  assert.equal((await (await device('poll',{})).json()).job.id,secondLink);
  assert.equal((await device('verified',{link:secondLink,ok:true,mode:1,trade_access:false,login:'43',server:'Contest',company:'Fixtures',currency:'EUR',balance:200})).status,200);
  const linked=(await (await call('mt5/status',{})).json()).links;
  assert.equal(linked.filter(l=>l.status==='connected').length,2);
  assert.equal(linked.find(l=>l.id===secondLink).access_level,'trading-restricted');
  const pendingReal=(await (await call('mt5/connect',{device:devices[0].id,envelope:{wrapped:'g',iv:'h',data:'i'}})).json()).id;
  assert.equal((await (await device('poll',{})).json()).job.id,pendingReal);
  assert.equal((await device('verified',{link:pendingReal,ok:true,mode:'2',trade_access:true,login:'44',server:'Real',company:'Fixtures',currency:'USD',balance:100})).status,400);
  assert.equal((await device('verified',{link:pendingReal,ok:true,mode:2,trade_access:true,login:'44',server:'Real',company:'Fixtures',currency:'USD',balance:100})).status,409);
  assert.equal((await (await call('mt5/status',{})).json()).links.find(l=>l.id===pendingReal).status,'failed');
  assert.equal((await call('admin',{action:'overview'})).status,403);
  await db.prepare("UPDATE users SET account_status='suspended'").run();
  assert.equal((await call('data',insert)).status,401);
  assert.equal((await device('sync',batch)).status,403);
  const subject=(await signup.json()).user.id;
  const other=await call('auth/signup',{email:'other@example.test',username:'second',password:'local-test-pass',invite_code:'integration'});
  cookie=other.headers.get('set-cookie').split(';')[0];
  assert.deepEqual((await (await call('mt5/status',{})).json()).links,[]);
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
  assert.equal((await call('admin',{action:'issue-recovery',targetUserId:subject,currentPassword:'local-test-pass'})).status,409,'Suspended accounts cannot be reset');
  assert.equal((await call('admin',{action:'restore',targetUserId:subject})).status,200);
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
  console.log('Local D1 passed migrations, cookie issuance, idempotent writes, stale revisions, pairing, demo sync, replay and suspension.');
} finally {await mf.dispose();}


