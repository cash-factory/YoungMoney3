/**
 * Deliberately fictional, deterministic display fixtures for the staging showcase.
 * No broker account, MT5 credential, trading fill, or user data is read here.
 * Run only via scripts/write-staging-demo-sql.mjs and a staging-only D1 binding.
 */
export const DEMO_ID = '00000000-0000-4000-8000-00000000d3a0';
export const DEMO_EMAIL = 'showcase@youngmoney3.invalid';
const origin='2026-11-19T17:00:00.000Z';
const weekDay=86_400_000;
const time=(offset=0)=>new Date(Date.parse(origin)+offset*weekDay).toISOString();
const date=(offset=0)=>time(offset).slice(0,10);
const owner=DEMO_ID;
const accountA='demo-account-primary',accountB='demo-account-evaluation';
const plan='demo-plan-core',strategyA='demo-strategy-london',strategyB='demo-strategy-breakout',strategyC='demo-strategy-reversal';
const modelA='demo-entry-model-sweep';
const setupA='demo-setup-liquidity',setupB='demo-setup-breakout',setupC='demo-setup-pullback';
const instruments=['EURUSD','GBPUSD','XAUUSD','USDJPY','NAS100'];
const prices=[1.1502,1.3118,4071.2,153.85,25012.0];
const steps=[.0001,.0001,.1,.01,1];
const out=[];
function record(table,id,fields,stamp=time(-35)) {
  out.push({table,id,payload:{id,user_id:owner,created_at:stamp,updated_at:stamp,...fields}});
}
const base=(name,account_id,amount,broker,number,opts={})=>record('trading_accounts',account_id,{
  name,account_number:number,account_type:opts.account_type||'demo',broker_id:null,broker_name:broker,broker_provider_id:null,
  base_currency:'USD',balance:amount,balance_as_of:time(0),broker_balance:amount,
  broker_balance_at:time(-.01),broker_equity:amount-48.25,broker_equity_at:time(-.01),
  risk_per_trade_pct:.5,default_strategy_id:strategyA,default_plan_id:plan,
  challenge_target_pct:opts.challenge_target_pct||null,daily_loss_limit_pct:3,max_loss_limit_pct:6,
  challenge_reset_timezone:'Etc/UTC',is_active:true
});
base('Exness demo · Sample account',accountA,12640.50,'Exness (illustrative)','90001001');
base('FundedNext evaluation · Sample',accountB,51870.25,'FundedNext (illustrative)','90002002',
  {account_type:'propfirm',challenge_target_pct:8});
record('trading_account_adjustments','demo-deposit-a',{account_id:accountA,amount:12000,reason:'Illustrative starting deposit'},time(-67));
record('trading_account_adjustments','demo-deposit-b',{account_id:accountB,amount:50000,reason:'Illustrative evaluation starting balance'},time(-67));
record('trading_account_adjustments','demo-withdrawal-a',{account_id:accountA,amount:-275,reason:'Sample withdrawal'},time(-10));

record('risk_settings','demo-risk',{max_daily_loss_pct:2,max_daily_trades:4,max_risk_per_trade_pct:.5,
  account_balance:12640.5,max_drawdown_pct:6,daily_loss_limit_amount:252.81});
record('trading_plans',plan,{
  title:'2026 · Rules-based execution plan',
  philosophy:'Protect attention and capital. Only execute a tested setup with a clear invalidation point; process quality comes before P&L.',
  htf_selection:'Mark 4H/1H structure, weekly levels and unfilled liquidity. Determine directional bias without forcing a trade.',
  ltf_execution:'Wait for a liquidity sweep and a 5m shift in structure; seek a clean retest. Minimum planned 1:2 reward to risk.',
  trade_management:'Place the protective stop at the invalidation level at entry. No widening stops; take partial profits by predefined levels.',
  risk_management:'Maximum 0.5% initial risk per idea, two correlated positions maximum, 2% daily loss limit and no trading after 3 losses.',
  mapping_process:'Map London and New York liquidity before the open. Write one invalidation and target for every candidate.',
  entry_models:'Sweep → structure shift → retest; opening-range break and retest; HTF continuation pullback.',
  market_conditions:'Avoid major scheduled releases unless part of a separately reviewed plan.',
  additional_notes:'Demo plan: sample text for design review. It is not trading advice.',
  adherence_score:86,screenshot_url:null,voice_note_url:null
});
for(const [id,name,description] of [
  [strategyA,'London liquidity sweep','Wait for sweep of Asian range and confirmation on the 5m structure.'],
  [strategyB,'NY opening range retest','Use opening-range expansion only with a clean retest and low spread.'],
  [strategyC,'Higher timeframe reversal','Countertrend only at well-defined higher-timeframe zones.']
])record('trader_strategies',id,{name,description,plan_id:plan,is_active:true});
record('strategy_entry_models',modelA,{strategy_id:strategyA,name:'Sweep + confirmed retest',
 description:'5m change of character after Asia high/low sweep, stop beyond sweep wick.',
 earliest_entry_utc:'07:00',requires_opening_stop:true,is_active:true});
for(const [n,label] of ['Bias recorded','News checked','Opening stop specified','Minimum 2R target','Emotional check complete'].entries()){
  record('strategy_checklist_items','demo-check-'+n,{strategy_id:strategyA,entry_model_id:modelA,label,
    is_required:true,sort_order:n,is_active:true});
  record('pre_trade_checklist','demo-pretrade-'+n,{plan_id:plan,label,is_required:true,sort_order:n,is_active:true});
}
for(const [n,rule,category] of [
  ['1','Never widen an initial protective stop','risk'],
  ['2','No trade without a setup and an invalidation point','entry'],
  ['3','Stop after three consecutive losses','discipline'],
  ['4','Do not enter within 10 minutes of tier-one news','news'],
  ['5','Maximum 0.5% per trade, including correlated positions','position_sizing']
])record('trading_rules','demo-rule-'+n,{plan_id:plan,rule_text:rule,category,priority:Number(n),
  is_active:true,times_broken:n==='3'?2:0});
for(const [id,name,category,description,entry,exit] of [
  [setupA,'Asian-range liquidity sweep','reversal','Asian extremes swept into London open, followed by a market structure shift.',
    'Sweep + return inside range + 5m displacement and retest.','Stop beyond sweep; target opposing liquidity, minimum 2R.'],
  [setupB,'New York opening-range retest','breakout','Directional expansion beyond the first 15-minute range.',
    'Hold above/below range and retest within 30 minutes.','Stop beyond the retest low/high; take partial at 1.5R.'],
  [setupC,'4H trend continuation','trend_following','Trend intact, clear impulse and controlled pullback to prior structure.',
    'Use 15m confirmation inside 4H demand/supply.','Stop beyond 4H invalidation, trail only after target one.']
])record('trading_setups',id,{
  name,description,category,market_conditions:description,timeframes:'4H / 1H / 15m / 5m',
  entry_criteria:entry,exit_criteria:exit,example_notes:'Practice setup — simulated evidence only.',
  screenshot_url:null,voice_note_url:null,is_active:true});

for(let i=0;i<5;i++)record('market_instruments','demo-instrument-'+i,{
  symbol:instruments[i],display_name:['Euro / US Dollar','British Pound / US Dollar','Gold / US Dollar','US Dollar / Japanese Yen','Nasdaq 100 CFD'][i],
  asset_class:i<2||i===3?'fx':i===2?'metal':'index',
  chart_symbol:instruments[i],base_currency:i===0?'EUR':i===1?'GBP':i===3?'USD':null,quote_currency:i===3?'JPY':'USD',
  price_increment:steps[i],pip_size:steps[i],price_precision:i===3?3:i===2?2:i===4?1:5,
  contract_multiplier:i===2?100:i===4?1:100000,quantity_unit:'lots',min_quantity:.01,quantity_step:.01,
  example_price:prices[i],example_size:.1,tick_value:1,default_stop_ticks:50,default_target_r:2
});

const rng=(seed)=>{let x=seed;return()=>{x=(1664525*x+1013904223)>>>0;return x/4294967296}};
const random=rng(20261120);
const trades=[];
for(let i=0;i<82;i++){
  const idx=i%instruments.length,symbol=instruments[idx],account=i%4===0?accountB:accountA;
  const direction=i%3===0?'short':'long',sign=direction==='long'?1:-1;
  const isOpen=i>=80;
  const entry=new Date(Date.parse(origin)-(82-i)*.52*weekDay+(i%4)*3600000).toISOString();
  const end=new Date(Date.parse(entry)+(1.3+i%6*1.1)*3600000).toISOString();
  const risk=Math.round((account===accountB?96:42)+random()*20);
  const result=i%13===0?'breakeven':random()>.43?'win':'loss';
  const R=result==='win'?1.5+random()*1.7:result==='loss'?-(.7+random()*.4):0;
  const pnl=isOpen?0:Number((risk*R).toFixed(2));
  const price=Number((prices[idx]+((i%9)-4)*steps[idx]*8).toFixed(idx===4?1:idx===2?2:idx===3?3:5));
  const stop=Number((price-sign*steps[idx]*22).toFixed(idx===4?1:idx===2?2:idx===3?3:5));
  const target=Number((price+sign*steps[idx]*52).toFixed(idx===4?1:idx===2?2:idx===3?3:5));
  const exit=isOpen?null:Number((price+sign*steps[idx]*(R>=0?R*22:R*22)).toFixed(idx===4?1:idx===2?2:idx===3?3:5));
  const session=i%4===0?'new_york':i%3===0?'overlap':'london';
  const discipline=i%11===0;
  const id='demo-trade-'+String(i+1).padStart(3,'0');
  const trade={
    pair:symbol,direction,entry_price:price,exit_price:exit,lot_size:Number((.06+(i%5)*.03).toFixed(2)),
    stop_loss:stop,take_profit:target,status:isOpen?'open':'closed',
    pnl,pnl_decimal:pnl.toFixed(2),pips:isOpen?0:Number((R*22).toFixed(1)),
    outcome:isOpen?null:result,strategy:i%5===0?'NY opening range retest':'London liquidity sweep',
    strategy_id:i%5===0?strategyB:strategyA,entry_model_id:modelA,
    setup_id:i%5===0?setupB:setupA,plan_id:plan,
    session,broker:account===accountA?'Exness (sample)':'FundedNext (sample)',settlement_currency:'USD',
    account_type:account===accountA?'personal':'propfirm',account_id:account,
    entry_time:entry,exit_time:isOpen?null:end,
    initial_risk:risk,realized_r:isOpen?null:Number(R.toFixed(2)),risk_percent:.5,
    risk_reward_ratio:2.4,emotional_state:discipline?'rushed':i%9===0?'anxious':'focused',
    setup_quality:discipline?2:i%7===0?3:5,
    mistakes:discipline?['Entered before confirmation','Impatience']:[],
    lessons:discipline?'Wait for the full trigger; a missed trade is cheaper than a rushed entry.':
      'Marked the invalidation before entry and followed the predefined management plan.',
    notes:isOpen?'Open paper position: awaiting next liquidity level.':
      result==='win'?'Followed setup, managed partials at the planned target.':
      result==='loss'?'Valid stop or setup review; no revenge position opened.':'Stopped at break even after momentum slowed.',
    what_went_wrong:discipline?'Early entry weakened the expected edge.':null,
    observations:'Context: '+session+' session; structural bias confirmed on 1H. Synthetic market example.',
    screenshot_url:null,voice_note_url:null,entry_screenshot_url:null,entry_voice_note_url:null,
    closure_screenshot_url:null,closure_voice_note_url:null,
    calculation_snapshot:null,checklist_items:[{label:'Invalidation defined',checked:true,is_required:true},
      {label:'News checked',checked:!discipline,is_required:true}],
    checklist_completed:!discipline,checklist_override_reason:discipline?'Preview example of discipline variance':null,
    trade_source:i%6===0?'manual':'mt5',
    capture_mode:'legacy',risk_capital_at_entry:account===accountA?12000:50000,
    risk_capital_source:'illustrative starting capital',created_at:entry,updated_at:end
  };
  trades.push({id,...trade});record('trades',id,trade,entry);
}
for(let i=0;i<18;i++){
  const offset=-i*2-1, linked=trades.filter(t=>new Date(t.entry_time).toISOString().slice(0,10)===date(offset)).slice(0,5).map(t=>t.id);
  record('journal_entries','demo-journal-'+i,{
    entry_date:date(offset),entry_type:i%6===0?'weekly':'daily',
    daily_goals:'Only A/B setups, maximum 0.5% planned risk, protect attention before P&L.',
    weekly_focus:'Execution quality and emotional regulation.',
    pre_market_notes:'London: monitor overnight range extremes, calendar risk, and the first confirmed retest. Do not predict breakout direction.',
    post_session_review:i%5===0?'A missed confirmation created avoidable stress. Removed the trade idea and reset.':
      'Waited for structure and respected initial invalidation. Exit followed predefined targets.',
    trading_plan_checklist:[{label:'Risk cap respected',checked:true},{label:'Emotional check',checked:i%5!==0}],
    review_prompts:[{question:'What did I feel?',answer:i%5===0?'Urgency after seeing the first impulse.':'Focused, patient, and willing to skip.'},
      {question:'What improves tomorrow?',answer:'Define the trigger before the session and journal immediately after the exit.'}],
    mood:i%5===0?'anxious':'calm',notes:i%5===0?'Recognized a FOMO pattern and stopped early.':'Process quality improved versus last week.',
    strategy_id:strategyA,plan_id:plan,entry_model_id:modelA,setup_id:setupA,account_id:accountA,
    linked_trade_ids:linked,screenshot_url:null,voice_note_url:null
  },time(offset));
}
for(let i=0;i<8;i++)record('weekly_reviews','demo-weekly-'+i,{
  week_start:date(-i*7-6),week_end:date(-i*7),rating:i===2?3:4+(i%2),
  trades_taken:9+i%5,trades_planned:11+i%5,pnl:Number((160+(i%3===0?-350:1)*(50+i*14)).toFixed(2)),
  settlement_currency:'USD',what_went_well:'Stopped after planned loss limit, respected two confirmation checks and recorded post-trade feelings.',
  what_went_wrong:i%3===0?'Two early entries during London open.':'One trade was held too long after the structure changed.',
  lessons_learned:'Patience is measurable. The best week is not automatically the most profitable week.',
  focus_next_week:'Stop after two rule violations; predefine profit-taking before entry.',
  psychological_notes:'Confidence improved after consistent routines; mild FOMO still appears following missed moves.',
  strategy_id:strategyA,plan_id:plan,entry_model_id:modelA,setup_id:setupA,account_id:accountA,
  screenshot_url:null,voice_note_url:null
},time(-i*7));
for(const [id,title,category,target,current,status] of [
  ['discipline','Achieve 90% plan adherence','discipline',90,84,'active'],
  ['reviews','Complete 20 structured weekly reviews','process',20,8,'active'],
  ['risk','Stay within daily loss cap for 60 sessions','risk',60,46,'active'],
  ['journal','Journal every closed trade for 30 days','process',30,30,'completed'],
  ['sleep','Trade after proper pre-market preparation','personal',20,18,'active']
])record('goals','demo-goal-'+id,{title,description:'Illustrative SMART goal with a measurable progress indicator.',
 category,target_metric:category,target_value:target,current_value:current,deadline:date(30),
 status,goal_type:category==='personal'?'personal':'trading',priority:category==='risk'?'high':'medium',
 progress_notes:'Weekly check-in recorded against the process score.',year:2026,is_template:false});
for(const [n,title,body,tags] of [
  [1,'What a good loss looks like','A planned loss with valid setup and unchanged stop is not a failure. Review execution separately from outcome.',['psychology','risk']],
  [2,'London open checklist','Identify Asia highs/lows; map news; define HTF directional bias; wait for structure shift.',['plan','london']],
  [3,'Rules for stopping after a difficult session','Step away at three losses or 2% daily drawdown. Avoid trying to recover emotion through risk.',['discipline','routine']],
  [4,'Review of gold volatility','Gold responds strongly to calendar surprises. Reduce size and respect the instrument-specific tick value.',['XAUUSD','research']]
])record('notes','demo-note-'+n,{title,content:body,tags,is_pinned:n<=2,screenshot_url:null});
for(const [n,name,kind,units,done] of [
  [1,'Structured trading psychology workshop','course',12,9],
  [2,'Market structure & liquidity workbook','book',18,18],
  [3,'Risk sizing across instruments','video_series',8,5]
])record('study_materials','demo-study-'+n,{title:name,type:kind,status:units===done?'completed':'in_progress',
 progress:Math.round(100*done/units),total_units:units,completed_units:done,
 notes:'Learning notes tied to execution improvements.',url:null,cover_image_url:null});
for(const [n,title,description] of [
  [1,'Opening-range notes','Reference framework for planning a structured NY session.'],
  [2,'Session overlap guide','Time-zone-aware checklist for the London/New York overlap.'],
  [3,'Position sizing principles','Thought process for choosing risk before setting a target.']
])record('resources','demo-resource-'+n,{title,description,category:'article',url:null,tags:['education','process'],thumbnail_url:null});
record('brokers','demo-broker-a',{name:'Exness (sample reference)',account_type:'demo',account_number:'SAMPLE',
 leverage:'1:200',commission:'Instrument-dependent',spread:'Variable',funding_method:'Illustrative',
 login_url:null,notes:'Not a verified or live account.',is_active:true});
record('brokers','demo-broker-b',{name:'FundedNext (sample reference)',account_type:'evaluation',account_number:'SAMPLE',
 leverage:'Illustrative',commission:'Instrument-dependent',spread:'Variable',funding_method:null,
 login_url:null,notes:'Simulated evaluation — no real broker connection.',is_active:true});
record('charting_tools','demo-charting',{name:'Charting journal workspace',subscription_status:'active',
 renewal_date:null,price:0,features:'Markup, replay, high-timeframe alignment',url:null,
 notes:'Preview record only'});
for(let i=0;i<2;i++)record('strategy_test_sessions','demo-session-'+i,{
 name:i?'New York opening-range forward test':'London sweep 60-trade backtest',
 strategy_name:i?'NY opening-range retest':'London liquidity sweep',instrument:i?'GBPUSD':'EURUSD',
 timeframe:'5m',test_type:i?'forward_test':'backtest',start_date:date(-70),end_date:date(-4),
 initial_balance:10000,notes:'Synthetic strategy research: numbers are not historical broker results.',
 screenshot_url:null,voice_note_url:null,strategy_id:i?strategyB:strategyA,plan_id:plan,
 entry_model_id:modelA,entry_model_mode:'one',account_id:accountA,
 setup_id:i?setupB:setupA
});
for(let i=0;i<40;i++)record('strategy_test_trades','demo-test-trade-'+i,{
  session_id:'demo-session-'+(i%3===0?1:0),direction:i%2?'long':'short',entry_price:1.15+i*.0001,
  exit_price:1.15+(i%2?1:-1)*.0003,stop_loss:1.14,take_profit:1.16,
  position_size:.1,pnl:i%3===0?-35:68,r_multiple:i%3===0:-.7:1.4,
  outcome:i%3===0?'loss':'win',entry_time:time(-60+i),exit_time:time(-60+i+.09),
  notes:'Rule-based synthetic test execution',screenshot_url:null,voice_note_url:null,
  account_id:accountA,plan_id:plan,entry_model_id:modelA,setup_id:setupA
},time(-60+i));
record('backtest_results','demo-backtest',{
  name:'London sweep · Q4 simulation',instrument:'EURUSD',strategy_rules:{setup:'Sweep + structure shift',risk_percent:.5},
  equity_curve:Array.from({length:25},(_,i)=>({date:date(-75+i*3),equity:10000+i*81-(i%6===0?95:0)})),
  trades:Array.from({length:25},(_,i)=>({entry_time:time(-75+i*2),exit_time:time(-75+i*2+.08),
    direction:i%2?'long':'short',entry_price:1.14,exit_price:1.142,pnl:i%4===0?-40:82,
    pips:i%4===0?-10:20,outcome:i%4===0?'loss':'win'})),
  start_date:date(-75),end_date:date(-3),initial_balance:10000,final_balance:11655,
  total_trades:25,win_rate:76,profit_factor:2.3,max_drawdown:3.8,sharpe_ratio:1.2,avg_rr:2.1,
  monthly_performance:[{month:'2026-09',pnl:420},{month:'2026-10',pnl:735},{month:'2026-11',pnl:500}],
  screenshot_url:null,voice_note_url:null,strategy_id:strategyA,setup_id:setupA,plan_id:plan,account_id:accountA
});
record('forward_trades','demo-forward',{instrument:'EURUSD',direction:'long',entry_price:1.151,stop_loss:1.148,
 take_profit:1.157,position_size:.1,status:'closed',exit_price:1.155,pnl:48,pips:40,notes:'Controlled entry after structural confirmation.',
 journal_entry:'Patient, calm, independent of previous session results.',emotional_state:'focused',
 entry_time:time(-3),exit_time:time(-3+.09),screenshot_url:null,voice_note_url:null,
 strategy_id:strategyA,setup_id:setupA,plan_id:plan,account_id:accountA});
for(const [i,name,impact] of [[1,'Illustrative high-impact event review','high'],[2,'London open reminder','low']])record('market_sessions','demo-event-'+i,{
 event_name:name,event_date:time(i-5),event_type:i===1?'news':'session_open',
 impact,session:'london',is_no_trade:i===1,notes:'Fictional calendar event for the showcase.'
});
for(let i=0;i<9;i++)record('decision_reviews','demo-decision-'+i,{
  reference:trades[i*5].id,verdict:i%4===0?'changed':'followed',
  note:i%4===0?'Entered early; the next trade will require a full confirmation.':'Executed according to my written plan.',
  account_id:trades[i*5].account_id,symbol:trades[i*5].pair,
  entry_time:trades[i*5].entry_time,strategy_id:strategyA,setup_id:setupA,
  emotional_state:i%4===0?'rushed':'focused'
});
// Reconcile dashboard balances and weekly P&L with these exact synthetic fills.
export const demoAccountBalances={};
for(const account of [accountA,accountB]){
  const opening=account===accountA?12000:50000;
  const transfers=account===accountA?-275:0;
  const realized=trades.filter(t=>t.account_id===account&&t.status==='closed')
    .reduce((sum,t)=>sum+t.pnl,0);
  const balance=Number((opening+transfers+realized).toFixed(2));
  demoAccountBalances[account]=balance;
  const record=out.find(r=>r.table==='trading_accounts'&&r.id===account);
  record.payload.balance=balance;
  record.payload.broker_balance=balance;
  record.payload.broker_equity=Number((balance-48.25).toFixed(2));
}
for(const item of out.filter(r=>r.table==='weekly_reviews')){
  const review=item.payload,start=Date.parse(review.week_start+'T00:00:00.000Z'),
    end=Date.parse(review.week_end+'T00:00:00.000Z')+weekDay;
  const matched=trades.filter(t=>t.account_id===review.account_id&&t.status==='closed'&&
    Date.parse(t.exit_time)>=start&&Date.parse(t.exit_time)<end);
  review.pnl=Number(matched.reduce((sum,t)=>sum+t.pnl,0).toFixed(2));
  review.trades_taken=matched.length;
}
const bt=out.find(r=>r.table==='backtest_results');
const summary=bt.payload,net=summary.trades.reduce((sum,t)=>sum+t.pnl,0),
  wins=summary.trades.filter(t=>t.pnl>0),losses=summary.trades.filter(t=>t.pnl<0);
summary.final_balance=summary.initial_balance+net;
summary.win_rate=Math.round(wins.length/summary.trades.length*100);
summary.profit_factor=Number((wins.reduce((sum,t)=>sum+t.pnl,0)/
  Math.abs(losses.reduce((sum,t)=>sum+t.pnl,0))).toFixed(2));
export const demoRecords=out;
export const demoCounts=Object.fromEntries([...new Set(out.map(x=>x.table))].map(t=>[t,out.filter(x=>x.table===t).length]));
export const demoAccounts={primary:accountA,evaluation:accountB};
export const demoProfile={
  id:DEMO_ID,email:DEMO_EMAIL,username:'sample_trader',display_name:'Alex Morgan · Demo Trader',
  avatar_url:null,bio:'Fictional trader profile for reviewing the YoungMoney3 experience.',
  trading_style:'Intraday · structure and liquidity',role:'member',account_status:'active',created_at:time(-90),updated_at:time(0)
};
