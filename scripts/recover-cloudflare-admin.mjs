#!/usr/bin/env node
// Provider-authorized recovery for the existing owner; never creates a new admin.
import { randomBytes,randomUUID,webcrypto } from 'node:crypto';
import { mkdtemp,rm,writeFile,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildOwnerRecoverySql,sql } from './ownerRecoveryPlan.mjs';

const email=process.env.OWNER_RECOVERY_EMAIL?.trim().toLowerCase();
const password=process.env.OWNER_RECOVERY_PASSWORD;
if(process.env.OWNER_RECOVERY_TARGET!=='production'
  || process.env.OWNER_RECOVERY_CONFIRM!=='RESET_PRODUCTION_OWNER_PASSWORD') {
  throw Error('Set OWNER_RECOVERY_TARGET=production and OWNER_RECOVERY_CONFIRM=RESET_PRODUCTION_OWNER_PASSWORD after verifying backups.');
}
if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  || !password || password.length<16 || password.length>256) {
  throw Error('Set OWNER_RECOVERY_EMAIL and a new OWNER_RECOVERY_PASSWORD of 16–256 characters without putting the password in command history.');
}
const config=JSON.parse(await readFile(resolve('wrangler.jsonc'),'utf8'));
const db=config.d1_databases?.find(row=>row.binding==='DB');
if(config.name!=='ym-fx' || db?.database_name!=='trade-journal-pro')
  throw Error('This operator tool only works with the explicit production Worker/D1 config.');
const childEnv={...process.env};
delete childEnv.OWNER_RECOVERY_PASSWORD;
delete childEnv.OWNER_RECOVERY_CONFIRM;
const invoke=command=>{
  const result=spawnSync('npx',['wrangler','d1','execute',db.database_name,'--remote','--json','--command',command],{encoding:'utf8',env:childEnv});
  if(result.status!==0)throw Error('Cloudflare query failed. Verify Wrangler credentials and D1 access.');
  const response=JSON.parse(result.stdout);
  return response.flatMap(item=>item.results||[]);
};
const schema=invoke("SELECT name FROM sqlite_master WHERE type='table' AND name='recovery_codes'");
if(schema.length!==1) throw Error('Required admin recovery migration 0008 is missing. No account was changed.');
const matching=invoke("SELECT id,role FROM users WHERE email="+sql(email)+" AND role='admin'");
if(matching.length!==1)throw Error('Exactly one existing administrator must match. No account was changed.');
const userId=matching[0].id;
const salt=randomBytes(16).toString('base64');
const key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
const hash=Buffer.from(await webcrypto.subtle.deriveBits({
  name:'PBKDF2',salt:Buffer.from(salt,'base64'),iterations:100000,hash:'SHA-256',
},key,256)).toString('base64');
const statements=buildOwnerRecoverySql({email,userId,hash,salt,auditId:randomUUID(),stamp:new Date().toISOString()});
const folder=await mkdtemp(join(tmpdir(),'ym3-owner-recovery-'));
try {
  const file=join(folder,'recovery.sql');
  await writeFile(file,statements,{mode:0o600});
  const result=spawnSync('npx',['wrangler','d1','execute',db.database_name,'--remote','--file',file],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:childEnv});
  if(result.status!==0)throw Error('Owner recovery write failed; inspect D1 audit and retry from a verified backup if needed.');
  const verify=invoke("SELECT password_hash,(SELECT COUNT(*) FROM sessions s WHERE s.user_id=u.id) AS sessions FROM users u WHERE id="+sql(userId)+" AND role='admin'");
  if(verify.length!==1 || verify[0].password_hash!==hash || Number(verify[0].sessions)!==0)
    throw Error('Recovery verification failed. Investigate the remote D1 state before using the account.');
  console.log('Existing administrator recovered. Prior sessions revoked. Use the new password to sign in; do not publish the credentials.');
}finally{await rm(folder,{recursive:true,force:true});}
