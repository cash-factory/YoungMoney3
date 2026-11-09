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
  const risk = snap && trade.stop_loss != null && trade.stop_loss !== entry
    ? new Decimal(at(trade.stop_loss)).abs().plus(fees) : null;
  const net = closed ? snap ? new Decimal(at(exit!)).minus(fees).toNumber() : trade.pnl : 0;
  const posted = settlement(net,currency);
  const realized = closed && risk?.gt(0) ? new Decimal(posted.pnl_decimal).div(risk).toNumber() : null;
  const planned = risk?.gt(0) && trade.take_profit != null ? new Decimal(at(trade.take_profit)).minus(fees).div(risk).toNumber() : null;
  return { ...trade, ...posted, settlement_currency:currency, initial_risk:risk?.toNumber() ?? null,
    planned_r:planned, realized_r:realized, risk_reward_ratio:realized, outcome:closed ? posted.outcome : null };
}
