import {realizedExecutionEvents} from './executionMetrics.ts';
import Decimal from 'decimal.js-light';
import type { Trade, TradingAccount, TradingAccountAdjustment } from './types.ts';

export function tradeCurrency(trade: Trade, accounts: TradingAccount[]): string {
  return trade.settlement_currency || trade.calculation_snapshot?.account_currency
    || accounts.find(account => account.id === trade.account_id)?.base_currency || 'Unknown';
}

export function settlement(net: number, currency: string) {
  if (!Number.isFinite(net)) throw new Error('The calculated P&L must be finite.');
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  const posted = new Decimal(net).toDecimalPlaces(digits, Decimal.ROUND_HALF_UP);
  const outcome = posted.isPositive() ? 'win' : posted.isNegative() ? 'loss' : 'breakeven';
  return { pnl: posted.toNumber(), pnl_decimal: posted.toFixed(digits), outcome } as const;
}

export function accountLedger(account: TradingAccount, trades: Trade[], adjustments: TradingAccountAdjustment[]) {
  const profit = realizedExecutionEvents(trades).reduce((sum, {trade,pnl}) =>
    trade.account_id === account.id && tradeCurrency(trade, [account]) === account.base_currency
      ? sum.plus(pnl) : sum, new Decimal(0));
  const balance = adjustments.reduce((sum, adjustment) =>
    adjustment.account_id === account.id ? sum.plus(adjustment.amount) : sum, profit.plus(account.balance));
  return { profit: profit.toNumber(), balance: account.broker_balance ?? balance.toNumber() };
}

export function validateTradeTimes(entry: string, exit: string | null, closed: boolean): string | null {
  const entered = Date.parse(entry);
  if (!Number.isFinite(entered)) return 'Enter a valid entry date and time.';
  if (!closed) return null;
  if (!exit || !Number.isFinite(Date.parse(exit))) return 'Enter the close date and time for this realized trade.';
  return Date.parse(exit) < entered ? 'The exit time must be at or after entry.' : null;
}
