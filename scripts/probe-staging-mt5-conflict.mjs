/** Staging-only real Worker+D1 contract for immutable broker evidence collisions.
 *  Uses a disposable device and demo link, not a real MT5 account or credential.
 */
import assert from 'node:assert/strict';
import { createHash, pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const base='https://ym-fx-staging.ethical-hacker263.workers.dev';
if(process.env.YM3_STAGING_WORKER_NAME!=='ym-fx-staging')
  throw Error('Refusing to probe anything except isolated ym-fx-staging.');
const config='wrangler.staging.jsonc';
const id=randomUUID(),device=randomUUID(),link=randomUUID(),account=randomUUID();
const suffix=randomBytes(6).toString('hex');
const email='evidence_probe_'+suffix+'@example.invalid';
const user='evidence_probe_'+suffix;
const token=randomUUID()+randomUUID(); // Device API requires the existing 72-character bearer format.
const tokenHash=createHash('sha256').update(token).digest('hex');
const salt=randomBytes(16).toString('base64');
const secret=randomBytes(32).toString('base64url');
const passwordHash='pbkdf2-sha256$600000$'+pbkdf2Sync(secret,Buffer.from(salt,'base64'),600000,32,'sha256').toString('base64');
const ticket=String(BigInt('9000000000000000')+BigInt(Math.floor(Math.random()*10000000)));
const otherTicket=String(BigInt(ticket)+1n);
function sql(command){
  const result=spawnSync('npx',['wrangler','d1','execute','DB','--remote','--config',config,'--json','--command',command],
    {encoding:'utf8',timeout:45000,maxBuffer:1024*1024});
  if(result.error||result.status!==0)throw Error('Staging D1 verification failed with exit code '+result.status);
  let parsed;
  try{parsed=JSON.parse(result.stdout);}catch{throw Error('Invalid staging D1 JSON.');}
  if(!Array.isArray(parsed)||parsed.some(part=>part.success===false))
    throw Error('Staging D1 operation was rejected.');
  return parsed[0]?.results?.[0]||null;
}
const esc=s=>String(s).replaceAll("'","''");
const query=async(payload)=>{
  const response=await fetch(base+'/api/mt5/device/sync',{
    method:'POST',headers:{'authorization':'Bearer '+token,'content-type':'application/json'},
    body:JSON.stringify(payload),signal:AbortSignal.timeout(25000),
  });
  let body;
  try{body=await response.json();}catch{throw Error('Staging device sync returned non-JSON HTTP '+response.status);}
  assert.equal(response.status,200,'Staging device sync rejected the disposable probe: '+String(body?.error||'HTTP error'));
  return body;
};
let inserted=false;
try{
  const stamp=new Date().toISOString();
  const expires=Date.now()+3600000;
  sql("INSERT INTO users(id,email,username,display_name,password_hash,password_salt,created_at,updated_at) VALUES('"+
    id+"','"+email+"','"+user+"','Temporary MT5 evidence probe','"+passwordHash+"','"+salt+"','"+stamp+"','"+stamp+"')");
  inserted=true;
  sql("INSERT INTO mt5_devices(id,owner,expires,token_hash,public_key,last_seen,revoked,connector_version) VALUES('"+
    device+"','"+id+"',"+expires+",'"+tokenHash+"','disposable-public-key',"+Date.now()+",0,'0.5.6-rc1')");
  sql("INSERT INTO mt5_links(id,device,owner,account_id,status,server,login,company,currency,trade_mode,access_level,linked_at,expires,monitoring_paused) VALUES('"+
    link+"','"+device+"','"+id+"','"+account+"','connected','Disposable-Demo','900012','Synthetic','USD',0,'trading-restricted','"+stamp+"',"+expires+",0)");
  const first={ticket,position_id:'111',time_msc:Date.now()-86400000,price:1.2,type:0};
  const fixed={kind:'raw',key:'deal-'+ticket,fields:first};
  const original=await query({link,events:[fixed],balance:100,equity:102});
  assert.equal(original.evidence_conflicts_pending,0);
  const originallyStored=sql("SELECT sha256,payload FROM mt5_raw_evidence WHERE link='"+link+"' AND event_key='deal-"+ticket+"'");
  assert.ok(originallyStored?.sha256);
  const conflict={...fixed,fields:{...first,price:1.25}};
  const unrelated={kind:'raw',key:'deal-'+otherTicket,fields:{...first,ticket:otherTicket,position_id:'222'}};
  const accepted=await query({link,events:[conflict,unrelated],balance:100,equity:102});
  assert.equal(accepted.evidence_conflicts_pending,1);
  assert.equal(accepted.evidence_quarantined_in_batch,1);
  assert.equal(accepted.evidence_integrity_status,'needs_review');
  const sameOriginal=sql("SELECT sha256,payload FROM mt5_raw_evidence WHERE link='"+link+"' AND event_key='deal-"+ticket+"'");
  assert.deepEqual(sameOriginal,originallyStored,'Existing broker evidence must not be rewritten.');
  assert.equal(sql("SELECT COUNT(*) AS n FROM mt5_raw_evidence WHERE link='"+link+"' AND event_key='deal-"+otherTicket+"'").n,1,
    'Unrelated evidence must be accepted despite the conflicting prior event.');
  const saved=sql("SELECT candidate_payload,changed_fields,review_status FROM mt5_evidence_conflicts WHERE link='"+link+"'");
  assert.equal(JSON.parse(saved.candidate_payload).price,1.25);
  assert.deepEqual(JSON.parse(saved.changed_fields),['price']);
  assert.equal(saved.review_status,'needs_review');
  const repeated=await query({link,events:[conflict]});
  assert.equal(repeated.evidence_conflicts_pending,1);
  assert.equal(sql("SELECT COUNT(*) AS n FROM mt5_evidence_conflicts WHERE link='"+link+"'").n,1,
    'Repeated connector upload must not duplicate quarantined evidence.');
  const status=sql("SELECT capture_health,last_sync FROM mt5_links WHERE id='"+link+"'");
  assert.equal(status.capture_health,'needs_attention');
  assert.ok(status.last_sync);
  console.log('Verified deployed staging: original immutable, changed candidate audited, other events accepted, retries deduplicated, sync advanced, review remains visible.');
}finally{
  if(inserted){
    sql("DELETE FROM mt5_evidence_conflicts WHERE owner='"+id+"'");
    sql("DELETE FROM mt5_events WHERE link='"+link+"'");
    sql("DELETE FROM mt5_raw_evidence WHERE link='"+link+"'");
    sql("DELETE FROM mt5_cash_movements WHERE link='"+link+"'");
    sql("DELETE FROM mt5_links WHERE owner='"+id+"'");
    sql("DELETE FROM mt5_devices WHERE owner='"+id+"'");
    sql("DELETE FROM sessions WHERE user_id='"+id+"'");
    sql("DELETE FROM users WHERE id='"+id+"' AND email='"+esc(email)+"'");
    console.log('Disposable synthetic owner, device, link and all evidence fixtures deleted from staging.');
  }
}
