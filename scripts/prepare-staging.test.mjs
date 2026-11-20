import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const program=resolve('scripts/prepare-staging.mjs');
const production={name:'production',main:'worker/index.ts',compatibility_date:'2026-10-10',assets:{directory:'./dist'},d1_databases:[{binding:'DB',database_name:'prod-db',database_id:'11111111-1111-1111-1111-111111111111'}]};
test('staging refuses production DB and Worker identity',()=>{
  const folder=mkdtempSync(join(tmpdir(),'ym3-staging-'));
  try{
    writeFileSync(join(folder,'wrangler.jsonc'),JSON.stringify(production));
    const run=(vars)=>execFileSync(process.execPath,[program],{cwd:folder,env:{...process.env,...vars},stdio:'pipe'});
    assert.throws(()=>run({YM3_STAGING_D1_ID:production.d1_databases[0].database_id,YM3_STAGING_D1_NAME:'stage-db'}));
    assert.throws(()=>run({YM3_STAGING_D1_ID:'22222222-2222-2222-2222-222222222222',YM3_STAGING_D1_NAME:'prod-db'}));
    assert.throws(()=>run({YM3_STAGING_D1_ID:'22222222-2222-2222-2222-222222222222',YM3_STAGING_D1_NAME:'stage-db',YM3_STAGING_WORKER_NAME:'production'}));
    assert.equal(existsSync(join(folder,'wrangler.staging.jsonc')),false);
    run({YM3_STAGING_D1_ID:'22222222-2222-2222-2222-222222222222',YM3_STAGING_D1_NAME:'stage-db'});
    const config=JSON.parse(readFileSync(join(folder,'wrangler.staging.jsonc'),'utf8'));
    assert.equal(config.d1_databases[0].database_name,'stage-db');
    assert.equal(config.vars.MT5_ALLOW_LIVE,'false');
    assert.deepEqual(config.assets.run_worker_first,['/api/*','/downloads/*']);
    assert.equal(config.name,'ym-fx-staging');
  }finally{rmSync(folder,{recursive:true,force:true})}
});
