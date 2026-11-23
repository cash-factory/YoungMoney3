import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTradingPatterns } from './tradingPatterns.ts';
import type { Trade } from './types.ts';
import type { DecisionReview } from './decisionReplay.ts';

const now='2026-11-23T18:00:00.000Z';
const trade=(id:string,opts:Partial<Trade>={}):Trade=>({
  id,user_id:'owner',pair:'EUR/USD',direction:'long',entry_price:1.1,exit_price:1.2,
  lot_size:1,take_profit:null,outcome:'win',status:'closed',pnl:50,pips:10,strategy:null,
  session:'london',broker:null,account_type:'personal',
  entry_time:'2026-11-20T10:00:00.000Z',exit_time:'2026-11-20T10:30:00.000Z',
  risk_percent:1,risk_reward_ratio:2,emotional_state:null,setup_quality:null,
  mistakes:[],lessons:null,notes:null,screenshot_url:null,voice_note_url:null,
  entry_screenshot_url:null,entry_voice_note_url:null,closure_screenshot_url:null,
  closure_voice_note_url:null,what_went_wrong:null,observations:null,strategy_id:null,
  setup_id:null,account_id:'a',instrument_id:null,checklist_items:null,
  checklist_override_reason:null,checklist_completed:false,created_at:now,updated_at:now,
  ...opts,
});
const review=(reference:string,verdict:DecisionReview['verdict'],opts:Partial<DecisionReview>={}):DecisionReview=>({
  id:'review-'+reference,reference,entry_time:'2026-11-21T09:00:00.000Z',
  strategy_id:'strategy-a',entry_model_id:'setup',strategy_name:'Breakout',model_name:'Retest',
  account_id:'a',symbol:'EURUSD',verdict,pre_reveal_at:null,pre_reveal_verdict:null,
  note:'',trigger:'My trigger fired',voice_note_url:null,screenshot_url:null,
  commitment_id:null,commitment_text:'',commitment_result:null,
  updated_at:now,...opts,
});

test('review counts are distinct, account-scoped and prefer the sealed judgement',()=>{
  const reviews=[
    review('trade/one','changed',{pre_reveal_verdict:'followed',pre_reveal_at:'2026-11-21T09:10:00Z'}),
    review('trade/one','changed',{updated_at:'2026-11-20T10:00:00Z'}),
    review('trade/two','changed'),
    review('trade/three','unsure'),
    review('trade/other','followed',{account_id:'b'}),
    review('trade/future','followed',{entry_time:'2026-12-02T00:00:00Z'}),
  ];
  const result=buildTradingPatterns([],reviews,{accountId:'a',now,minimum:3});
  assert.equal(result.reviewed,3);
  assert.equal(result.preReveal,1);
  assert.equal(result.retrospective,2);
  assert.equal(result.plan.numerator,1);
  assert.equal(result.plan.denominator,2);
  assert.equal(result.plan.rate,50);
  assert.equal(result.plan.sufficient,false);
  assert.equal(result.unknown,1);
  assert.equal(result.setups[0].label,'Retest');
  assert.ok(result.limitations.some(message=>message.includes('retrospectively')));
});

test('only original opening-time manual checklists count, not later labels or broker fills',()=>{
  const original={entry_time:'2026-11-21T10:00:00Z',entry_price:1.1,stop_loss:1.08,
    direction:'long',strategy_id:null,entry_model_id:null,plan_id:null,risk_percent:1,
    checklist_items:[{label:'Confirmed',checked:true,is_required:true}],
    entry_screenshot_url:null,entry_voice_note_url:null,capture_mode:'live',
    originally_open:true,entry_note:null};
  const trades=[
    trade('one',{decision_entry:original,emotional_state:'focused'}),
    trade('two',{decision_entry:{...original,checklist_items:[{label:'Confirmed',checked:false,is_required:true}]},emotional_state:'calm'}),
    trade('three',{decision_entry:{...original,originally_open:false},checklist_completed:true}),
    trade('four',{trade_source:'mt5',decision_entry:original,emotional_state:'anxious'}),
  ];
  const result=buildTradingPatterns(trades,[],{now,minimum:3});
  assert.equal(result.sources.originalChecklists,2);
  assert.equal(result.checklist.numerator,1);
  assert.equal(result.checklist.denominator,2);
  assert.equal(result.checklist.rate,50);
  assert.equal(result.sources.journalEmotions,2);
  assert.equal(result.emotions.some(item=>item.label==='anxious'),false);
});

test('after-loss indicator requires a documented same-account prior manual close within 24h',()=>{
  const trades=[
    trade('loss',{pnl:-25,outcome:'loss',entry_time:'2026-11-19T08:00:00Z',exit_time:'2026-11-19T09:00:00Z'}),
    trade('after',{entry_time:'2026-11-19T10:00:00Z',exit_time:'2026-11-19T11:00:00Z'}),
    trade('later',{entry_time:'2026-11-21T12:00:00Z'}),
    trade('other',{account_id:'b',entry_time:'2026-11-19T11:00:00Z'}),
  ];
  const reviews=[
    review('trade/after','followed',{entry_time:'2026-11-19T10:00:00Z'}),
    review('trade/later','changed',{entry_time:'2026-11-21T12:00:00Z'}),
    review('trade/other','changed',{account_id:'b',entry_time:'2026-11-19T11:00:00Z'}),
  ];
  const result=buildTradingPatterns(trades,reviews,{accountId:'a',now,minimum:3});
  assert.equal(result.afterLoss.examined,1);
  assert.equal(result.afterLoss.numerator,1);
  assert.equal(result.afterLoss.rate,100);
  assert.equal(result.afterLoss.sufficient,false);
});

test('90-day window and sparse weekly observations never imply a trend',()=>{
  const reviews=[
    review('trade/old','followed',{entry_time:'2026-01-02T09:00:00Z'}),
    review('trade/one','changed',{entry_time:'2026-11-19T09:00:00Z'}),
    review('trade/two','unsure',{entry_time:'2026-11-19T10:00:00Z'}),
  ];
  const report=buildTradingPatterns([],reviews,{now,window:'90d'});
  assert.equal(report.reviewed,2);
  assert.equal(report.weeks.length,1);
  assert.equal(report.weeks[0].rate,null);
  const lifetime=buildTradingPatterns([],reviews,{now,window:'all'});
  assert.equal(lifetime.reviewed,3);
});

test('setup-specific self-reported discipline is sampled separately and never inferred from P&L',()=>{
  const reviews=Array.from({length:8},(_,i)=>review('trade/setup-'+i,i<5?'followed':'changed',{
    model_name:i<6?'Retest':'Breakout',
    pre_reveal_verdict:i<4?'followed':null,
    pre_reveal_at:i<4?'2026-11-21T09:30:00Z':null,
  }));
  const result=buildTradingPatterns([],reviews,{now,minimum:5});
  const retest=result.setupAdherence.find(row=>row.label==='Retest');
  assert.ok(retest);
  assert.equal(retest.reviewed,6);
  assert.equal(retest.followed,5);
  assert.equal(retest.sealed,4);
  assert.equal(retest.retrospective,2);
  assert.equal(retest.sufficient,true);
  assert.equal(Number(retest.rate?.toFixed(2)),83.33);
  const breakout=result.setupAdherence.find(row=>row.label==='Breakout');
  assert.equal(breakout?.sufficient,false);
});
test('confidence ranges remain absent below minimum evidence and wide with small samples',()=>{
  const rows=Array.from({length:12},(_,i)=>review('trade/wilson-'+i,i<9?'followed':'changed'));
  const report=buildTradingPatterns([],rows,{now,minimum:12});
  assert.equal(report.plan.rate,75);
  assert.ok(report.plan.interval);
  assert.ok(report.plan.interval[0]<75&&report.plan.interval[1]>75);
  assert.ok(report.plan.interval[1]-report.plan.interval[0]>20);
  const insufficient=buildTradingPatterns([],rows.slice(0,4),{now,minimum:12});
  assert.equal(insufficient.plan.interval,null);
  assert.equal(insufficient.plan.sufficient,false);
});

test('10,000 trade/review histories remain linearithmic and account-scoped',()=>{
  const largeTrades=Array.from({length:10000},(_,i)=>trade('bulk-'+i,{
    pnl:i%2===0?-1:1, outcome:i%2===0?'loss':'win',
    entry_time:'2026-11-20T08:00:00Z', exit_time:'2026-11-20T09:00:00Z',
  }));
  const largeReviews=largeTrades.map(t=>review('trade/'+t.id,'followed',{
    entry_time:'2026-11-21T08:00:00Z',
    strategy_name:'Breakout',model_name:'Retest',trigger:'',
  }));
  const started=performance.now();
  const result=buildTradingPatterns(largeTrades,largeReviews,{now,minimum:12});
  const elapsed=performance.now()-started;
  assert.equal(result.reviewed,10000);
  assert.equal(result.afterLoss.examined,10000);
  assert.equal(result.setupAdherence[0].reviewed,10000);
  assert.ok(elapsed<6000,'10k record analysis unexpectedly slow: '+elapsed.toFixed(0)+' ms');
});
