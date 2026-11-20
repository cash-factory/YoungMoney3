import {normalizeExecutionMetrics} from './executionMetrics.ts';
import Decimal from 'decimal.js-light';
import { instrumentPnlFromSnapshot, validQuantity } from './instrumentMath.ts';
import { settlement, validateTradeTimes } from './tradeFinance.ts';
import type { MarketInstrument, TradeInput } from './types.ts';

/** Recalculate manual journal postings at every write boundary from the captured contract. */
export function settleManualTrade(trade: TradeInput): TradeInput {
  const closed = trade.status === 'closed';
  const error = validateTradeTimes(trade.entry_time, trade.exit_time, closed);
  if (error) throw new Error(error);
  if (!['open','closed'].includes(trade.status) || !['long','short'].includes(trade.direction)
    || !trade.pair || !Number.isFinite(trade.lot_size) || Number(trade.lot_size) <= 0) throw new Error('Invalid trade size, direction or symbol.');
  const snap = trade.calculation_snapshot;
  const currency = snap?.account_currency ?? trade.settlement_currency;
  if (!currency || !/^[A-Z]{3}$/.test(currency)) throw new Error('Choose a settlement currency.');
  const fees = trade.fees ?? 0;
  if (!Number.isFinite(fees) || fees < 0) throw new Error('Invalid fees.');
  if (snap && !validQuantity(snap as unknown as MarketInstrument, trade.lot_size!)) throw new Error('Size is outside the contract quantity grid.');
  const entry = trade.entry_price, exit = trade.exit_price;
  if (entry == null || !Number.isFinite(entry) || entry <= 0
    || (closed && (exit == null || !Number.isFinite(exit) || exit <= 0))) {
    throw new Error('Enter valid positive fill prices.');
  }
  if (!closed && (exit != null || trade.exit_time != null)) {
    throw new Error('An open trade cannot retain a closing price or time.');
  }
  if ([trade.stop_loss, trade.take_profit].some(price => price != null && (!Number.isFinite(price) || price <= 0))) {
    throw new Error('Stop and target prices must be positive finite numbers.');
  }
  const at = (price: number) => instrumentPnlFromSnapshot(snap!,trade.direction,entry,price,trade.lot_size!);
  const firstStop=trade.execution_metrics?.first_sl ?? trade.stop_loss;
  const stopLoss = snap && firstStop != null ? at(firstStop) : null;
  const risk = stopLoss !== null && stopLoss < 0 ? new Decimal(stopLoss).abs() : null;
  const net = closed ? snap ? new Decimal(at(exit!)).minus(fees).toNumber() : trade.pnl : 0;
  const posted = settlement(net,currency);
  const realized = closed && risk?.gt(0) ? new Decimal(posted.pnl_decimal).div(risk).toNumber() : null;
  const firstTarget=trade.execution_metrics?.first_tp ?? trade.take_profit;
  const planned = risk?.gt(0) && firstTarget != null ? new Decimal(at(firstTarget)).div(risk).toNumber() : null;
  const move=closed ? new Decimal(exit!).minus(entry).times(trade.direction==='long'?1:-1) : null;
  const captured = {
    ...trade, ...posted,
    execution_metrics: {
      version:1 as const, first_sl:firstStop ?? null, first_tp:firstTarget ?? null,
      first_sl_source:trade.execution_metrics?.first_sl_source ?? 'user_entered',
      first_sl_at:trade.execution_metrics?.first_sl_at ?? trade.entry_time,
      delayed_sl:trade.execution_metrics?.delayed_sl ?? false,
      initial_risk:risk?.toNumber() ?? null, closed_risk:closed ? risk?.toNumber() ?? null : 0,
      planned_r:planned, realized_r:realized, timezone_status:'user_entered',
      pips:move && snap?.pip_size ? move.div(snap.pip_size).toNumber() : null,
      ticks:move && snap ? move.div(snap.price_increment).toNumber() : null,
      points:move?.toNumber() ?? null,
    },
  };
  return { ...trade, ...posted, execution_metrics:normalizeExecutionMetrics(captured as unknown as import('./types.ts').Trade), settlement_currency:currency, initial_risk:risk?.toNumber() ?? null,
    planned_r:planned, realized_r:realized, risk_reward_ratio:realized, outcome:closed ? posted.outcome : null };
}
