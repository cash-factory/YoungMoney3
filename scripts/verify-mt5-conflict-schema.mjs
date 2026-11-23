import { spawnSync } from 'node:child_process';

const sql=[
 'SELECT',
 "(SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='mt5_evidence_conflicts') AS conflict_table,",
 "(SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name='mt5_conflicts_no_update') AS immutable_trigger,",
 "(SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='mt5_conflicts_owner_recent') AS owner_index,",
 "(SELECT COUNT(*) FROM d1_migrations WHERE name='0018_mt5_evidence_conflict_quarantine.sql') AS applied,",
 "(SELECT COUNT(*) FROM pragma_table_info('mt5_evidence_conflicts') WHERE name IN ('link','owner','account_id','event_key','evidence_kind','original_sha256','candidate_sha256','candidate_payload','changed_fields','review_status','recorded_at')) AS columns"
].join(' ');

export function assertEvidenceConflictSchema(rows) {
  if(!Array.isArray(rows)||rows[0]?.success!==true)throw Error('Staging D1 conflict schema query failed.');
  const row=rows[0]?.results?.[0];
  if(row?.conflict_table!==1 || row.immutable_trigger!==1 || row.owner_index!==1 || row.applied!==1 || row.columns!==11)
    throw Error('Missing immutable conflict quarantine, owner index or migration 0018. Refusing staging deploy.');
  return true;
}

if(process.argv[1]?.endsWith('verify-mt5-conflict-schema.mjs')){
  const exe=process.platform==='win32'?'npx.cmd':'npx';
  const run=spawnSync(exe,['wrangler','d1','execute','DB','--remote','--config',
    'wrangler.staging.jsonc','--json','--command',sql],
    {encoding:'utf8',maxBuffer:2*1024*1024,timeout:60000});
  if(run.error||run.status!==0)throw Error('Could not query the isolated staging D1 conflict schema.');
  let rows;
  try { rows=JSON.parse(run.stdout); } catch { throw Error('Staging D1 returned invalid schema JSON.'); }
  assertEvidenceConflictSchema(rows);
  console.log('Verified isolated staging conflict quarantine with 11 columns, immutable trigger and migration 0018.');
}
