import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const id = process.env.YM3_STAGING_D1_ID?.trim();
const name = process.env.YM3_STAGING_D1_NAME?.trim();
const workerName = process.env.YM3_STAGING_WORKER_NAME?.trim() || 'ym-fx-staging';
if (!id || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) {
  throw new Error('YM3_STAGING_D1_ID must be the UUID of a separate staging D1 database.');
}
if (!name || !/^[a-z0-9][a-z0-9-]{2,62}$/i.test(name)) {
  throw new Error('YM3_STAGING_D1_NAME is required (for example youngmoney3-staging).');
}
if (!/^[a-z][a-z0-9-]{2,62}$/.test(workerName)) {
  throw new Error('Use a valid staging Worker name.');
}
const production=JSON.parse(readFileSync(resolve('wrangler.jsonc'),'utf8'));
const live=production.d1_databases?.find(row=>row.binding==='DB');
if (!live?.database_id) throw new Error('Production DB binding is missing.');
if (id.toLowerCase()===live.database_id.toLowerCase() || name===live.database_name) {
  throw new Error('Refusing to use the production D1 database for staging.');
}
if (workerName===production.name) throw new Error('Staging Worker name must differ from production.');
const stage={
  $schema:production.$schema,
  name:workerName,
  main:production.main,
  compatibility_date:production.compatibility_date,
  assets:production.assets,
  d1_databases:[{binding:'DB',database_name:name,database_id:id}],
  vars:{MT5_ALLOW_LIVE:'false'},
};
const output=resolve('wrangler.staging.jsonc');
writeFileSync(output,JSON.stringify(stage,null,2)+'\n',{flag:'w',mode:0o600});
console.log('Created a staging-only Worker config. Validate D1 names, configure staging secrets, then migrate and deploy staging.');
