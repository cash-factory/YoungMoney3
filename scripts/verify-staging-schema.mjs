import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const QUERY = "SELECT (SELECT COUNT(*) FROM pragma_table_info('mt5_links') WHERE name IN ('history_id','history_since','trade_mode','access_level')) AS mt5_columns, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('recovery_codes','site_settings')) AS admin_tables, (SELECT COUNT(*) FROM d1_migrations WHERE name IN ('0006_mt5_history.sql','0007_mt5_access_level.sql','0008_admin_operations.sql')) AS required_migrations";

export function assertStagingSchema(json) {
  const rows = Array.isArray(json) ? json : null;
  if (!rows?.length || rows.some(result=>result.success === false)) throw Error('Staging D1 verification query failed.');
  const result = rows[0]?.results?.[0];
  if (result?.mt5_columns !== 4 || result?.admin_tables !== 2 || result?.required_migrations !== 3) {
    throw Error('Staging schema is incomplete: require MT5 history/access columns and admin recovery tables from migrations 0006–0008.');
  }
  return true;
}

export function verifyRemoteStaging() {
  const command=process.platform==='win32' ? 'npx.cmd' : 'npx';
  const result=spawnSync(command,['wrangler','d1','execute','DB','--remote',
    '--config','wrangler.staging.jsonc','--json','--command',QUERY],
    {encoding:'utf8',maxBuffer:2*1024*1024});
  if(result.error || result.status!==0) throw Error('Could not inspect staging D1; Worker deployment is blocked.');
  let data;
  try{ data=JSON.parse(result.stdout); }
  catch{throw Error('Staging D1 did not return valid structured JSON; Worker deployment is blocked.');}
  assertStagingSchema(data);
  console.log('Staging migration verification passed for 0006, 0007 and 0008.');
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  verifyRemoteStaging();
}
