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
  const code=(await (await call('mt5/pair',{})).json()).code;
  const claim={code,publicKey:'ZmFrZQ=='};
  const token=(await (await call('mt5/device/claim',claim)).json()).token;
  assert.ok(token);assert.equal((await call('mt5/device/claim',claim)).status,403);
  const devices=(await (await call('mt5/status',{})).json()).devices;
  const link=(await (await call('mt5/connect',{device:devices[0].id,envelope:{wrapped:'a',iv:'b',data:'c'}})).json()).id;
  const device=(path,data)=>call('mt5/device/'+path,data,{authorization:'Bearer '+token});
  assert.equal((await (await device('poll',{})).json()).job.id,link);
  assert.equal((await (await device('poll',{})).json()).job,null);
  assert.equal((await device('verified',{link,ok:true,mode:0,login:'42',server:'Demo',company:'Fixtures',currency:'USD',balance:100})).status,200);
  const batch={link,events:[{kind:'trade',key:'close-42',fields:row}]};
  for(let i=0;i<2;i++) assert.equal((await device('sync',batch)).status,200);
  assert.equal((await (await call('data',{action:'select',table:'trades',filters:{trade_source:'mt5'}})).json()).count,1);
  await db.prepare("UPDATE users SET account_status='suspended'").run();
  assert.equal((await call('data',insert)).status,401);
  assert.equal((await device('sync',batch)).status,403);
  const subject=(await signup.json()).user.id;
  const other=await call('auth/signup',{email:'other@example.test',username:'second',password:'local-test-pass',invite_code:'integration'});
  cookie=other.headers.get('set-cookie').split(';')[0];
  assert.deepEqual((await (await call('mt5/status',{})).json()).links,[]);
  assert.equal((await (await call('data',{action:'select',table:'trades'})).json()).count,0);
  await db.prepare("UPDATE users SET role='admin' WHERE username='second'").run();
  objects.add(subject+'/folder/screenshot.png');
  objects.add(subject+'/voice.webm');
  assert.equal((await call('admin',{action:'delete',targetUserId:subject})).status,200);
  assert.equal(objects.size,0);
  console.log('Local D1 passed migrations, cookie issuance, idempotent writes, stale revisions, pairing, demo sync, replay and suspension.');
} finally {await mf.dispose();}


