import assert from 'node:assert/strict';
import test from 'node:test';
import { sessionsAt, getExecutionMetrics, realizedExecutionEvents } from './executionMetrics.ts';
import { calculateRiskMetrics } from './riskMetrics.ts';
import type { Trade } from './types.ts';

const partial = {id:'lifecycle',account_id:'account',status:'open',entry_time:'2026-06-01T07:00:00Z',
  exit_time:null,pnl:6,execution_metrics:{version:1,initial_risk:10,closed_risk:5,realized_r:1.2,
  first_sl:95,exits:[{ticket:'42',time:'2026-06-01T09:00:00Z',net_pnl:'6'}]}} as unknown as Trade;

test('sessions follow market-local DST and include overlaps',()=>{
  assert.deepEqual(sessionsAt('2026-06-01T12:30:00Z'),['London','New York']);
  assert.deepEqual(sessionsAt('2026-01-05T12:30:00Z'),['London']);
  assert.deepEqual(sessionsAt('2026-06-06T12:30:00Z'),[]);
});
test('partial exits affect daily risk once while position remains open',()=>{
  const events=realizedExecutionEvents([partial,{...partial,id:'old',superseded_by:partial.id}]);
  assert.equal(events.length,1);assert.equal(events[0].pnl,6);
  const result=calculateRiskMetrics([partial],{accountId:'account',accountBalance:100,maxDailyLossPct:3,
    maxDailyTrades:5,maxRiskPerTradePct:1,maxDrawdownPct:10,timeZone:'UTC',now:new Date('2026-06-01T12:00:00Z')});
  assert.equal(result.todayPnl,6);assert.equal(result.openTradeCount,1);
});
test('unknown historical timezone does not fabricate session labels',()=>{
  const t={...partial,execution_metrics:{version:1,timezone_status:'unresolved_history'}} as Trade;
  assert.deepEqual(getExecutionMetrics(t).sessions_at_entry,[]);
  assert.equal(getExecutionMetrics(t).first_sl,null);
});
