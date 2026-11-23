import { spawnSync } from 'node:child_process';

const sql=[
 'SELECT',
 "(SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('mt5_conflict_classifications','mt5_recovery_status')) AS tables,",
 "(SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name='mt5_classification_no_update') AS audit_trigger,",
 "(SELECT COUNT(*) FROM d1_migrations WHERE name='0019_mt5_recovery_and_spec_classification.sql') AS migration,",
 "(SELECT COUNT(*) FROM pragma_table_info('mt5_recovery_status') WHERE name IN ('link','owner','state','scanned_through','target_at','unresolved_positions','unobserved_stop_changes','updated_at')) AS recovery_columns,",
 "(SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='mt5_classification_owner') AS owner_index"
].join(' ');

export function assertMt5RecoverySchema(rows) {
  const row=rows?.[0]?.results?.[0];
  if(!Array.isArray(rows)||rows[0]?.success!==true || row?.tables!==2 ||
     row.audit_trigger!==1 || row.migration!==1 || row.recovery_columns!==8 || row.owner_index!==1)
    throw Error('Staging MT5 recovery or conflict classification audit schema is incomplete.');
  return true;
}
if(process.argv[1]?.endsWith('verify-mt5-recovery-schema.mjs')) {
  if(process.env.YM3_STAGING_WORKER_NAME!=='ym-fx-staging')
    throw Error('Refusing non-staging MT5 recovery migration verification.');
  const exe=process.platform==='win32'?'npx.cmd':'npx';
  function query(statement){
    const r=spawnSync(exe,['wrangler','d1','execute','DB','--remote','--config',
      'wrangler.staging.jsonc','--json','--command',statement],
      {encoding:'utf8',timeout:50000,maxBuffer:1024*1024});
    if(r.error||r.status!==0)throw Error('Could not verify separate staging D1 schema.');
    let rows;try{rows=JSON.parse(r.stdout);}catch{throw Error('Invalid staging D1 response.');}
    if(rows?.[0]?.success!==true)throw Error('Staging SQL verification rejected.');
    return rows;
  }
  assertMt5RecoverySchema(query(sql));
  const totals=query(`SELECT
    (SELECT COUNT(*) FROM mt5_conflict_classifications) AS documented_connector_artifacts,
    (SELECT COUNT(*) FROM mt5_evidence_conflicts c WHERE c.review_status='needs_review'
      AND NOT EXISTS(SELECT 1 FROM mt5_conflict_classifications k
        WHERE k.link=c.link AND k.event_key=c.event_key AND k.candidate_sha256=c.candidate_sha256)) AS genuine_unreviewed_candidates`)[0].results[0];
  console.log('Staging MT5 recovery migration and immutable alias audit verified: '+
    JSON.stringify(totals));
}
