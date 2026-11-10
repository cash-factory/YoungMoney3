import { spawnSync } from 'node:child_process';

const query = [
  "SELECT",
  "(SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('mt5_raw_evidence','mt5_evidence_corrections','mt5_position_versions','mt5_legacy_position_review')) AS rich_tables,",
  "(SELECT COUNT(*) FROM pragma_table_info('mt5_links') WHERE name IN ('broker_timezone','timezone_confirmed_at','timezone_source','utc_conversion_status')) AS timezone_columns,",
  "(SELECT COUNT(*) FROM d1_migrations WHERE name='0009_mt5_rich_capture.sql') AS new_migration",
].join(' ');

export function assertRichSchema(data) {
  if (!Array.isArray(data) || data[0]?.success !== true) throw new Error('Staging D1 returned an invalid schema response.');
  const row=data[0]?.results?.[0];
  if(row?.rich_tables!==4 || row?.timezone_columns!==4 || row?.new_migration!==1) {
    throw new Error('Migration 0009 is incomplete. Refusing staging Worker deployment.');
  }
  return true;
}

if(process.argv[1]?.endsWith('verify-rich-staging-schema.mjs')){
  const command=process.platform==='win32'?'npx.cmd':'npx';
  const r=spawnSync(command,['wrangler','d1','execute','DB','--remote','--config',
    'wrangler.staging.jsonc','--json','--command',query],
    {encoding:'utf8',maxBuffer:2*1024*1024});
  if(r.error || r.status!==0)throw new Error('Could not verify staging-only D1.');
  let output;
  try{output=JSON.parse(r.stdout);}catch{throw new Error('Staging D1 schema response was not JSON.');}
  assertRichSchema(output);
  console.log('Staging migration 0009: immutable evidence, position versions and timezone columns verified.');
}
