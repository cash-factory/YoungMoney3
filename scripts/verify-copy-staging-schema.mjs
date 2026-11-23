import { spawnSync } from 'node:child_process';

const query = [
  'SELECT',
  "(SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('copy_profiles','copy_profile_events')) AS copy_tables,",
  "(SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('copy_profile_audit_create','copy_profile_audit_update','copy_profile_audit_delete','copy_events_no_update')) AS copy_triggers,",
  "(SELECT COUNT(*) FROM d1_migrations WHERE name='0017_copy_studio_drafts.sql') AS copy_migration,",
  "(SELECT COUNT(*) FROM pragma_table_info('copy_profiles') WHERE name IN ('owner','source_link','follower_link','state','version')) AS ownership_fields"
].join(' ');

export function assertCopySchema(data) {
  if (!Array.isArray(data) || data[0]?.success !== true) throw Error('Staging D1 copy schema verification failed.');
  const row=data[0]?.results?.[0];
  if(row?.copy_tables!==2 || row.copy_triggers!==4 || row.copy_migration!==1 || row.ownership_fields!==5)
    throw Error('Copy Studio migration 0017, ownership columns or audit triggers are missing; release blocked.');
  return true;
}
if (process.argv[1]?.endsWith('verify-copy-staging-schema.mjs')) {
  const executable=process.platform==='win32'?'npx.cmd':'npx';
  const result=spawnSync(executable,['wrangler','d1','execute','DB','--remote','--config',
    'wrangler.staging.jsonc','--json','--command',query],
    {encoding:'utf8',maxBuffer:2*1024*1024});
  if(result.error||result.status!==0)throw Error('Remote staging D1 verification failed.');
  let data;
  try{data=JSON.parse(result.stdout);}catch{throw Error('Copy schema query was not valid JSON.');}
  assertCopySchema(data);
  console.log('Verified staging-only Copy Studio tables, audit triggers and migration 0017.');
}
