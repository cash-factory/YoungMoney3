import test from 'node:test';
import assert from 'node:assert/strict';
import {settleManualTrade} from './settleManualTrade.ts';
import {accountLedger} from './tradeFinance.ts';
import type { TradeInput, TradingAccount, TradingAccountAdjustment } from './types.ts';

const input = { pair:'TEST', status:'closed', direction:'long', entry_price:100,exit_price:95,stop_loss:95,
  take_profit:110,lot_size:1,entry_time:'2026-01-01T00:00:00Z',exit_time:'2026-01-02T00:00:00Z',
  calculation_snapshot:{price_increment:1,tick_value:1,conversion_rate:1,account_currency:'USD',quantity_unit:'contracts',asset_class:'future'} } as TradeInput;
test('manual sources post identical realized R and retain separate target R',()=>{
  for(const oldRatio of [2,-1]){
    const trade=settleManualTrade({...input,risk_reward_ratio:oldRatio});
    assert.equal(trade.planned_r,2); assert.equal(trade.realized_r,-1);assert.equal(trade.initial_risk,5);
  }
});
test('settlement rejects invalid grids and chronology and rounds before classifying',()=>{
  assert.throws(()=>settleManualTrade({...input,lot_size:0.6666}));
  assert.throws(()=>settleManualTrade({...input,exit_time:null}));
  assert.equal(settleManualTrade({...input,exit_price:100.004}).outcome,'breakeven');
});
test('manual settlement validates price and lifecycle invariants', () => {
  assert.throws(() => settleManualTrade({ ...input, entry_price: -100 }), /positive fill prices/);
  assert.throws(() => settleManualTrade({ ...input, exit_price: 0 }), /positive fill prices/);
  assert.throws(() => settleManualTrade({ ...input, stop_loss: Number.NaN }), /Stop and target/);
  assert.throws(() => settleManualTrade({ ...input, status: 'open' }), /open trade cannot retain/);
  assert.equal(settleManualTrade({ ...input, status: 'open', exit_price: null, exit_time: null }).outcome, null);
});
test('broker statement balances override journal estimates without changing realized P&L',()=>{
  const account={id:'a',base_currency:'USD',balance:100,broker_balance:250,broker_balance_at:'2026-01-01T00:00:00Z'} as TradingAccount;
  const result=accountLedger(account,[],[{account_id:'a',amount:40} as TradingAccountAdjustment]);
  assert.deepEqual(result,{profit:0,balance:250});
});
test('deposits change balance independently of realized trading profit',()=>{
  const result=accountLedger({id:'a',base_currency:'USD',balance:100} as TradingAccount,[],[{account_id:'a',amount:40} as TradingAccountAdjustment]);
  assert.deepEqual(result,{profit:0,balance:140});
});
