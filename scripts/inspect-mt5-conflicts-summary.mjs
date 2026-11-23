/** Zero-PII staging-only aggregate health probe for conflict proliferation. */
import { spawnSync } from 'node:child_process';
if (process.env.YM3_STAGING_WORKER_NAME !== 'ym-fx-staging') throw Error('Staging only.');
const queries=[
 ["Kind totals", "SELECT evidence_kind,COUNT(*) AS candidates,COUNT(DISTINCT event_key) AS distinct_keys,COUNT(DISTINCT link) AS affected_links FROM mt5_evidence_conflicts GROUP BY evidence_kind ORDER BY candidates DESC"],
 ["Changed field totals", "SELECT evidence_kind,changed_fields,COUNT(*) AS candidates,COUNT(DISTINCT event_key) AS distinct_keys FROM mt5_evidence_conflicts GROUP BY evidence_kind,changed_fields ORDER BY candidates DESC LIMIT 20"],
 ["Largest link aggregate", "SELECT evidence_kind,COUNT(*) AS candidates,COUNT(DISTINCT event_key) AS distinct_keys FROM mt5_evidence_conflicts WHERE link=(SELECT link FROM mt5_evidence_conflicts GROUP BY link ORDER BY COUNT(*) DESC LIMIT 1) GROUP BY evidence_kind ORDER BY candidates DESC"],
 ["Observed time spread", "SELECT evidence_kind,substr(recorded_at,1,13) AS utc_hour,COUNT(*) AS candidates FROM mt5_evidence_conflicts WHERE recorded_at>=datetime('now','-2 hours') GROUP BY evidence_kind,substr(recorded_at,1,13) ORDER BY utc_hour DESC,evidence_kind LIMIT 20"],
];
for (const [label,statement] of queries){
  const r=spawnSync('npx',['wrangler','d1','execute','DB','--remote','--config','wrangler.staging.jsonc','--json','--command',statement],
    {encoding:'utf8',maxBuffer:1024*1024,timeout:50000});
  if(r.status!==0||r.error)throw Error('Staging readonly aggregation failed.');
  let data;try{data=JSON.parse(r.stdout);}catch{throw Error('Staging aggregation returned invalid JSON.');}
  if(!Array.isArray(data)||data[0]?.success!==true)throw Error('Staging aggregation failed.');
  console.log(label+': '+JSON.stringify(data[0].results));
}
