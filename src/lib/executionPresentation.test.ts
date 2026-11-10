import assert from 'node:assert/strict';
import test from 'node:test';
import { executionMovement, executionStats, formatHoldDuration } from './executionPresentation.ts';
import { dailyPnlData, exportToCSV } from './utils.ts';
import type { Trade } from './types.ts';

const base = {id:'position',status:'closed',entry_time:'2026-11-02T10:00:00Z',exit_time:'2026-11-02T11:00:00Z',pnl:20,pair:'EURUSD',mistakes:[],execution_metrics:{version:1,first_sl:1.09,initial_risk:10,realized_r:2,duration_seconds:3600,pips:20,sessions_at_entry:['London'],fills:[]}} as unknown as Trade;
test('execution summary includes only known R in its denominator',()=>{
  const unknown={...base,id:'unknown',execution_metrics:{version:1,realized_r:null,duration_seconds:null,timezone_status:'unknown'}} as Trade;
  const stats=executionStats([base,unknown]);
  assert.equal(stats.meanR,2);
  assert.equal(stats.rCount,1);
  assert.equal(stats.count,2);
  assert.equal(executionMovement(base),'20.0 pips');
  assert.equal(formatHoldDuration(90061),'1d 1h 1m');
});
test('daily P&L includes partial exit events without counting fills as positions',()=>{
  const partial={...base,status:'open',exit_time:null,execution_metrics:{version:1,exits:[{time:'2026-11-02T10:30:00Z',net_pnl:5},{time:'2026-11-02T10:40:00Z',net_pnl:7}]}} as Trade;
  const result=dailyPnlData([partial],[new Date('2026-11-02T12:00:00Z')])[0];
  assert.equal(result.pnl,12);
  assert.equal(result.trades,1);
});
test('CSV keeps zero-valued execution metrics and preserves nested fill facts',()=>{
  const csv=exportToCSV([{...base,execution_metrics:{...base.execution_metrics!,realized_r:0,pips:0,fills:[{ticket:'123',volume:0.1}]}}]);
  assert.match(csv,/Net Realized R/);
  assert.match(csv,/Hold Seconds/);
  assert.match(csv,/123/);
  assert.match(csv,/"0"/);
});
