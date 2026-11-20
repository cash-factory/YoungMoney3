/** Synthetic read-only staging preview. Never runs against production. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEMO_ID, DEMO_EMAIL, demoRecords, demoCounts, demoProfile, demoAccounts, demoAccountBalances } from './staging-demo-fixtures.mjs';

const quote=value => "'" + String(value).replaceAll("'","''") + "'";
const field=value=>value==null?'NULL':quote(value);
const fakeDevice='demo-device-unpaired';
const fakeLink='demo-broker-link-preview';

export function buildDemoStatements(){
  if(demoCounts.trades<70||demoCounts.trading_accounts!==2||demoCounts.journal_entries<12||
     !demoCounts.weekly_reviews||!demoCounts.trader_strategies||!demoCounts.decision_reviews)
    throw Error('The preview fixtures are incomplete.');
  const commands=[];
  const userFields=[DEMO_ID,DEMO_EMAIL,demoProfile.username,demoProfile.display_name,
    'DISABLED_DEMO_ACCOUNT_NO_PASSWORD','NO_PASSWORD_ALLOWED','member','active',
    null,demoProfile.bio,demoProfile.trading_style,demoProfile.created_at,demoProfile.updated_at];
  commands.push('INSERT OR IGNORE INTO users (id,email,username,display_name,password_hash,password_salt,role,account_status,avatar_url,bio,trading_style,created_at,updated_at) VALUES ('+
    userFields.map(field).join(',')+')');
  commands.push('DELETE FROM mt5_devices WHERE owner='+quote(DEMO_ID));
  commands.push('DELETE FROM workspace_records WHERE user_id='+quote(DEMO_ID));
  for(const item of demoRecords){
    if(item.payload.user_id!==DEMO_ID||!item.id.startsWith('demo-'))throw Error('Unscoped demo record.');
    commands.push('INSERT INTO workspace_records (id,user_id,table_name,payload,created_at,updated_at) VALUES ('+
      [item.id,DEMO_ID,item.table,JSON.stringify(item.payload),
       item.payload.created_at,item.payload.updated_at].map(field).join(',')+')');
  }
  // Fake PC remains offline, with no usable credential or device token.
  commands.push('INSERT INTO mt5_devices (id,owner,expires,last_seen,public_key,setup_state,connector_version,revoked) VALUES ('+
    [fakeDevice,DEMO_ID,0,0,'SAMPLE_KEY_NOT_CRYPTOGRAPHIC_MATERIAL','ready','SYNTHETIC_PREVIEW',0].map(field).join(',')+')');
  commands.push('INSERT INTO mt5_links (id,device,owner,account_id,status,expires,server,login,company,currency,linked_at,last_sync,broker_balance,broker_equity,monitoring_paused,capture_health,history_status,trade_mode,access_level) VALUES ('+
    [fakeLink,fakeDevice,DEMO_ID,demoAccounts.primary,'connected',0,'Fictional-Sample-Server','90001001',
     'Illustrative broker · Not connected','USD','2026-10-01T10:00:00.000Z','2026-11-19T16:30:00.000Z',
     demoAccountBalances[demoAccounts.primary],Number((demoAccountBalances[demoAccounts.primary]-48.25).toFixed(2)),1,'needs_attention','none',0,'trading-restricted'].map(field).join(',')+')');
  const samples=demoRecords.filter(r=>r.table==='trades'&&r.payload.status==='closed').slice(-17);
  for(let i=0;i<samples.length;i++){
    const trade=samples[i].payload,position=String(790001+i),lifecycle_id=position+':0';
    const summary={
      lifecycle_id,position_id:position,calculation_version:1,symbol:trade.pair,
      direction:trade.direction,status:'closed',
      first_entry_at:trade.entry_time,final_exit_at:trade.exit_time,
      initial_entry_price:String(trade.entry_price),initial_sl:String(trade.stop_loss),initial_tp:String(trade.take_profit),
      initial_sl_provenance:'executed_open_order',initial_stop_provenance:'executed_open_order',
      initial_sl_observed_at:trade.entry_time,current_sl:String(trade.stop_loss),current_tp:String(trade.take_profit),
      remaining_volume:'0',net_realized_profit:String(trade.pnl),
      realized_r:String(trade.realized_r),final_realized_r:String(trade.realized_r),
      initial_risk_account:String(trade.initial_risk),movement:String(trade.pips),movement_unit:'pips',
      settlement_currency:'USD',broker:'Illustrative broker · Sample',
      entries:[{deal_ticket:String(800001+i),time:trade.entry_time,volume:trade.lot_size,
        price:trade.entry_price,stop_loss:trade.stop_loss,take_profit:trade.take_profit}],
      exits:[{deal_ticket:String(810001+i),time:trade.exit_time,volume:trade.lot_size,
        price:trade.exit_price,profit:trade.pnl}],
      capture_completeness:{original_risk:'sample_only',risk_reason:'synthetic_data',session_status:'example'},
      sessions:{status:'example',sessions:[trade.session],overlaps:[]},
      capital_at_entry:{value:String(trade.risk_capital_at_entry),source:'synthetic_balance',observed_at:trade.entry_time}
    };
    const payload=JSON.stringify(summary),digest=createHash('sha256').update(payload).digest('hex');
    commands.push('INSERT INTO mt5_position_versions (link,owner,account_id,lifecycle_id,version,calculation_version,payload,sha256,recorded_at) VALUES ('+
      [fakeLink,DEMO_ID,demoAccounts.primary,lifecycle_id,1,1,payload,digest,trade.exit_time].map(field).join(',')+')');
    const raw={ticket:String(810001+i),position_id:position,order:String(820001+i),symbol:trade.pair,
      type:trade.direction,entry:1,time_msc:Date.parse(trade.exit_time),price:trade.exit_price,
      volume:trade.lot_size,profit:trade.pnl,commission:-.8,fee:0,swap:-.2,
      sl:trade.stop_loss,tp:trade.take_profit,comment:'SYNTHETIC_PREVIEW_ONLY'};
    const text=JSON.stringify(raw);
    commands.push('INSERT INTO mt5_raw_evidence (link,owner,account_id,event_key,evidence_kind,payload,sha256,recorded_at) VALUES ('+
      [fakeLink,DEMO_ID,demoAccounts.primary,'deal-'+raw.ticket,'deal',text,
       createHash('sha256').update(text).digest('hex'),trade.exit_time].map(field).join(',')+')');
  }
  return commands;
}

export function validateStagingConfig(filename){
  const production=JSON.parse(readFileSync(resolve('wrangler.jsonc'),'utf8'));
  const staging=JSON.parse(readFileSync(resolve(filename),'utf8'));
  const live=production.d1_databases.find(item=>item.binding==='DB');
  const stage=staging.d1_databases.find(item=>item.binding==='DB');
  if(!stage||!live||stage.database_id===live.database_id||staging.name===production.name||
     staging.vars?.DEMO_SHOWCASE_ENABLED!=='true'||staging.vars?.MT5_ALLOW_LIVE!=='false')
    throw Error('Refusing to seed a non-staging database.');
  return true;
}

if(process.argv[1]?.endsWith('write-staging-demo-sql.mjs')){
  validateStagingConfig('wrangler.staging.jsonc');
  writeFileSync(resolve('.demo-showcase-seed.sql'),buildDemoStatements().join(';\n')+';\n',{mode:0o600});
  console.log('Prepared',demoRecords.length,'fictional records and 17 offline MT5 sample positions for staging.');
}
