import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

/** Isolated Worker+D1 contract test. This fixture cannot reach production. */
const bundle = await build({
  entryPoints: ['worker/index.ts'], bundle: true, format: 'esm', write: false,
  external: ['cloudflare:workers'],
});
const mf = new Miniflare(convertV4MiniflareOptions({
  workers: [{ name: 'copy-studio-test', modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-10-10', d1Databases: ['DB'],
    durableObjects: { AUTH_KDF: { className: 'AuthKdf', useSQLite: true } },
    bindings: { PILOT_INVITE_CODE: 'local-copy-test', MT5_ALLOW_LIVE: 'false' } }],
  port: 0,
}));
const id=(n)=>('00000000-0000-4000-8000-'+String(n).padStart(12,'0'));
try {
  const db=await mf.getD1Database('DB');
  for(const name of (await readdir('migrations')).sort()) {
    const sql=await readFile('migrations/'+name,'utf8');
    let buffer='';
    for(const line of sql.split(/\r?\n/)){
      buffer+=line+'\n';
      if(line.trimEnd().endsWith(';') && (!buffer.trimStart().startsWith('CREATE TRIGGER') || line.trim()==='END;')){
        await db.prepare(buffer.trim()).run(); buffer='';
      }
    }
    assert.equal(buffer.trim(),'','Unprocessed migration: '+name);
  }
  async function call(path,body={},cookie='',headers={}) {
    const response=await mf.dispatchFetch('https://copy.local.test/api/'+path,{
      method:'POST',headers:{'content-type':'application/json',cookie,...headers},
      body:JSON.stringify(body),
    });
    const result=await response.json();
    return {response,result};
  }
  const signup=async(n)=>{
    const {response,result}=await call('auth/signup',{
      email:'copy-'+n+'@example.invalid',username:'copy_'+n,
      display_name:'Test '+n,password:'sample password for testing',
      invite_code:'local-copy-test',
    });
    assert.equal(response.status,200,JSON.stringify(result));
    return {cookie:response.headers.get('set-cookie').split(';')[0],user:result.user};
  };
  const first=await signup(1);
  const second=await signup(2);
  const device1=id(1),device2=id(2),source=id(3),follower=id(4),live=id(5),theirs=id(6);
  const time=new Date().toISOString();
  const expires=Date.now()+60*60*1000;
  await db.prepare('INSERT INTO mt5_devices(id,owner,expires,public_key,last_seen,revoked) VALUES(?,?,?,?,?,0)')
    .bind(device1,first.user.id,expires,'fixture-public-key',Date.now()).run();
  await db.prepare('INSERT INTO mt5_devices(id,owner,expires,public_key,last_seen,revoked) VALUES(?,?,?,?,?,0)')
    .bind(device2,second.user.id,expires,'fixture-public-key-2',Date.now()).run();
  for(const [uid,device,link,num,mode] of [
    [first.user.id,device1,source,1001,0],
    [first.user.id,device1,follower,1002,0],
    [first.user.id,device1,live,1003,2],
    [second.user.id,device2,theirs,2001,0],
  ]){
    await db.prepare("INSERT INTO mt5_links(id,device,owner,account_id,status,server,login,company,currency,trade_mode,access_level,last_sync,expires,monitoring_paused) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0)")
      .bind(link,device,uid,id(num),'connected','DemoBroker-'+num,String(num),'Verified demo','USD',mode,'trading-enabled',time,expires).run();
  }

  const status=await call('copy/status',{},first.cookie);
  assert.equal(status.response.status,200);
  assert.equal(status.result.executionEnabled,false);
  assert.deepEqual(status.result.accounts.map(a=>a.id).sort(),[source,follower].sort(),
    'Real accounts and other users must be invisible');

  const followers=[follower,id(7),id(8),id(9)];
  for(let i=1;i<followers.length;i++) {
    await db.prepare("INSERT INTO mt5_links(id,device,owner,account_id,status,server,login,company,currency,trade_mode,access_level,last_sync,expires,monitoring_paused,broker_balance,broker_equity) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)")
      .bind(followers[i],device1,first.user.id,id(500+i),'connected','DemoBroker-'+i,String(4000+i),
        'MultiDemo','USD',0,'trading-enabled',time,expires,10000*i,12000*i).run();
  }
  await db.prepare("UPDATE mt5_links SET broker_balance=10000,broker_equity=12000 WHERE id IN (?,?)")
    .bind(source,follower).run();
  const groupFollowers=followers.map((link,i)=>({
    link,mode:['equity_percentage','balance_percentage','fixed_amount','balance_ratio'][i],
    value:i===2?55:1,maxLots:4,maxRiskPct:3,
  }));
  const group={name:'Multi-account four followers',sourceLink:source,followers:groupFollowers};
  assert.equal((await call('copy/group-save',{...group,followers:[...groupFollowers,groupFollowers[0]]},first.cookie)).response.status,400,
    'Duplicate followers cannot be queued.');
  assert.equal((await call('copy/group-save',{...group,followers:[...groupFollowers,{...groupFollowers[0],link:theirs}]},first.cookie)).response.status,403,
    'Cross-owner followers must be rejected.');
  assert.equal((await call('copy/group-save',{...group,followers:[{...groupFollowers[0],link:live}]},first.cookie)).response.status,403,
    'Live followers are excluded even from demo plans.');
  assert.equal((await call('copy/group-save',{...group,followers:groupFollowers.map(x=>({...x,link:source}))},first.cookie)).response.status,400,
    'Source to self cannot be saved.');
  const groupCreated=await call('copy/group-save',group,first.cookie);
  assert.equal(groupCreated.response.status,200,JSON.stringify(groupCreated.result));
  assert.equal(groupCreated.result.executionEnabled,false);
  const groupId=groupCreated.result.id;
  const groupList=await call('copy/group-status',{},first.cookie);
  assert.equal(groupList.response.status,200);
  assert.equal(groupList.result.groups[0].followers.length,4);
  assert.equal(groupList.result.groups[0].state,'paused');
  assert.equal((await call('copy/group-status',{},second.cookie)).result.groups.length,0,'No group leak across users.');
  assert.equal((await call('copy/group-preview',{id:groupId,sourceLots:.2,lossPerLot:Object.fromEntries(followers.map(link=>[link,100]))},second.cookie)).response.status,404);
  const preview=await call('copy/group-preview',{id:groupId,sourceLots:.2,lossPerLot:Object.fromEntries(followers.map(link=>[link,100]))},first.cookie);
  assert.equal(preview.response.status,200,JSON.stringify(preview.result));
  assert.equal(preview.result.simulation,true);
  assert.equal(preview.result.brokerValidated,false);
  assert.equal(preview.result.executionEnabled,false);
  assert.equal(preview.result.results.length,4);
  assert.equal(preview.result.results[0].indicativeLots,1.2,'Equity percentage must use the destination equity.');
  assert.equal(preview.result.results[1].indicativeLots,2,'Balance percentage must use the destination balance.');
  assert.equal(preview.result.results[2].indicativeLots,.55,'Fixed currency risk must use the destination currency.');
  assert.equal(preview.result.results[3].indicativeLots,.8,'Balance ratio uses source volume and follower/source capitals.');
  assert.equal((await call('copy/execute-group',{id:groupId},first.cookie)).response.status,404,
    'No browser endpoint can issue trade orders.');
  assert.equal((await call('copy/group-save',{...group,id:groupId,version:5},first.cookie)).response.status,409);
  assert.equal((await call('copy/group-save',{...group,id:groupId,version:1,name:'Edited group'},first.cookie)).response.status,200);
  assert.equal((await call('copy/group-delete',{id:groupId,version:1},first.cookie)).response.status,409);
  assert.equal((await call('copy/group-delete',{id:groupId,version:2},first.cookie)).response.status,200);
  assert.equal((await call('copy/group-status',{},first.cookie)).result.groups.length,0);
  const audit=await db.prepare("SELECT event FROM copy_group_events WHERE owner=? ORDER BY recorded_at")
    .bind(first.user.id).all();
  assert.deepEqual(audit.results.map(x=>x.event).sort(),['created','deleted','updated']);

  const draft={
    name:'Test currency position sizing',sourceLink:source,followerLink:follower,
    multiplier:2,maxFollowerLots:0.70,maxDailyLossPct:2,
  };
  const unauthorized=await call('copy/save',{...draft,followerLink:theirs},first.cookie);
  assert.equal(unauthorized.response.status,403,'Cross-owner account cannot be followed');
  assert.equal((await call('copy/save',{...draft,followerLink:live},first.cookie)).response.status,403,
    'Live account cannot be configured as a target');
  assert.equal((await call('copy/save',{...draft,sourceLink:follower,followerLink:source},second.cookie)).response.status,403,
    'Other member cannot configure a pair they do not own');
  assert.equal((await call('copy/save',{...draft,followerLink:source},first.cookie)).response.status,400,
    'Same-account copying must be rejected');
  assert.equal((await call('copy/save',{...draft,maxFollowerLots:51},first.cookie)).response.status,400,
    'Unsafe lot limit must fail validation');
  assert.equal((await call('copy/save',{...draft,maxDailyLossPct:99},first.cookie)).response.status,400,
    'Unsafe planned daily loss ceiling must fail validation');
  assert.equal((await call('copy/save',draft,'',{Origin:'https://attacker.example'})).response.status,403,
    'Mutations require a same-origin authenticated session');

  const created=await call('copy/save',draft,first.cookie);
  assert.equal(created.response.status,200,JSON.stringify(created.result));
  assert.equal(created.result.state,'paused','No activation is possible');
  assert.equal(created.result.executionEnabled,false);
  const profileId=created.result.id;
  assert.equal((await call('copy/save',draft,first.cookie)).response.status,409,
    'Duplicate source/follower drafts must not be created');
  assert.equal((await call('copy/simulate',{id:profileId,sourceLots:0.8},second.cookie)).response.status,404,
    'Other members cannot simulate a profile they do not own');
  assert.equal((await call('copy/execute',{id:profileId},first.cookie)).response.status,404,
    'The Worker must have no execution API');
  assert.equal((await call('copy/simulate',{id:profileId,sourceLots:500},first.cookie)).response.status,400,
    'Invalid oversized hypothetical lots must be rejected');

  const simulated=await call('copy/simulate',{id:profileId,sourceLots:0.8},first.cookie);
  assert.equal(simulated.response.status,200);
  assert.equal(simulated.result.uncappedLots,1.6);
  assert.equal(simulated.result.indicativeFollowerLots,0.7);
  assert.equal(simulated.result.cappedByPolicy,true);
  assert.equal(simulated.result.brokerValidated,false);
  assert.equal(simulated.result.dailyLossEnforced,false);
  assert.equal(simulated.result.executionEnabled,false);
  assert.equal(simulated.result.checks.some(check=>check.includes('No order is transmitted')),true);

  const updated=await call('copy/save',{...draft,id:profileId,version:1,multiplier:1},first.cookie);
  assert.equal(updated.response.status,200,JSON.stringify(updated.result));
  assert.equal(updated.result.version,2);
  assert.equal((await call('copy/save',{...draft,id:profileId,version:1},first.cookie)).response.status,409,
    'A stale tab cannot overwrite the new version');
  const saved=await call('copy/status',{},first.cookie);
  assert.equal(saved.result.profiles.length,1);
  assert.equal(saved.result.profiles[0].multiplier,1);
  assert.equal(saved.result.profiles[0].state,'paused');
  assert.equal(saved.result.events.length,2);
  assert.deepEqual(saved.result.events.map(e=>e.event).sort(),['created','updated']);
  assert.equal((await call('copy/delete',{id:profileId,version:1},first.cookie)).response.status,409);
  assert.equal((await call('copy/delete',{id:profileId,version:2},second.cookie)).response.status,404);
  assert.equal((await call('copy/delete',{id:profileId,version:2},first.cookie)).response.status,200);
  const cleaned=await call('copy/status',{},first.cookie);
  assert.equal(cleaned.result.profiles.length,0);
  assert.equal(cleaned.result.events.length,3);
  assert.equal(cleaned.result.events[0].event,'deleted');
  const evidence=await db.prepare('SELECT COUNT(*) AS n FROM mt5_links WHERE id IN (?,?,?)')
    .bind(source,follower,live).first();
  assert.equal(evidence.n,3,'Draft deletion cannot delete broker connections');
  assert.equal((await call('copy/status',{},'')).response.status,401,
    'Anonymous clients cannot enumerate trading plans');

  console.log('Copy Studio: verified owner isolation, demo-only restrictions, immutable paused state, version locks, sizing caps, audit, deletion and absence of execution endpoint.');
} finally {
  await mf.dispose();
}
