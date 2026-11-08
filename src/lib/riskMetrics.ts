import type { Trade } from './types.ts';

export interface RiskMetricOptions {
  accountId: string;
  accountBalance: number;
  timeZone: string;
  now?: Date;
  maxDailyLossPct: number;
  maxDailyLossAmount?: number | null;
  maxDailyTrades: number;
  maxRiskPerTradePct: number;
  maxDrawdownPct: number;
}

export interface RiskMetrics {
  todayPnl: number;
  todayTradeCount: number;
  openTradeCount: number;
  maxDailyTrades: number;
  dailyLossLimitAmount: number;
  dailyLossUsed: number;
  dailyLossRemaining: number;
  dailyLossPctUsed: number;
  maxRiskPerTradePct: number;
  maxRiskUsedToday: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  currentDrawdown: number;
  currentDrawdownPct: number;
  maxDrawdownPctLimit: number;
  status: 'safe' | 'warning' | 'danger';
  balance: number;
  timeZone: string;
}

export function dateKeyInTimeZone(value: Date | string, timeZone: string): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;

  const formatter = (zone: string) => new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = formatter(timeZone || 'UTC').formatToParts(date);
  } catch {
    parts = formatter('UTC').formatToParts(date);
  }

  const valueFor = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || '';
  return `${valueFor('year')}-${valueFor('month')}-${valueFor('day')}`;
}

export function calculateRiskMetrics(trades: Trade[], options: RiskMetricOptions): RiskMetrics {
  const now = options.now || new Date();
  const todayKey = dateKeyInTimeZone(now, options.timeZone) || dateKeyInTimeZone(now, 'UTC')!;
  const accountTrades = trades.filter(trade => trade.account_id === options.accountId);
  const enteredToday = accountTrades.filter(trade => dateKeyInTimeZone(trade.entry_time, options.timeZone) === todayKey);
  const closedToday = accountTrades.filter(trade =>
    trade.status === 'closed'
    && trade.exit_time
    && dateKeyInTimeZone(trade.exit_time, options.timeZone) === todayKey,
  );
  const todayPnl = closedToday.reduce((sum, trade) => sum + (Number.isFinite(trade.pnl) ? trade.pnl : 0), 0);
  const balance = Number.isFinite(options.accountBalance) && options.accountBalance > 0 ? options.accountBalance : 0;
  const percentageLimit = balance * Math.max(0, options.maxDailyLossPct) / 100;
  const absoluteLimit = options.maxDailyLossAmount;
  const dailyLossLimitAmount = absoluteLimit != null && Number.isFinite(absoluteLimit) && absoluteLimit > 0
    ? Math.min(percentageLimit, absoluteLimit)
    : percentageLimit;
  const dailyLossUsed = Math.abs(Math.min(todayPnl, 0));
  const dailyLossPctUsed = dailyLossLimitAmount > 0 ? dailyLossUsed / dailyLossLimitAmount * 100 : 0;

  const closedHistory = accountTrades
    .filter(trade => trade.status === 'closed' && Number.isFinite(trade.pnl))
    .sort((left, right) => new Date(left.exit_time || left.entry_time).getTime() - new Date(right.exit_time || right.entry_time).getTime());

  let runningPnl = 0;
  let peakPnl = 0;
  let maxDrawdown = 0;
  for (const trade of closedHistory) {
    runningPnl += trade.pnl;
    peakPnl = Math.max(peakPnl, runningPnl);
    maxDrawdown = Math.max(maxDrawdown, peakPnl - runningPnl);
  }
  const currentDrawdown = peakPnl - runningPnl;
  const maxDrawdownPct = balance > 0 ? maxDrawdown / balance * 100 : 0;
  const currentDrawdownPct = balance > 0 ? currentDrawdown / balance * 100 : 0;
  const riskPcts = enteredToday.filter(trade => trade.risk_percent != null && Number.isFinite(trade.risk_percent)).map(trade => trade.risk_percent!);
  const maxRiskUsedToday = riskPcts.length ? Math.max(...riskPcts) : 0;
  const todayTradeCount = enteredToday.length;
  const maxDailyTrades = Math.max(1, options.maxDailyTrades);
  const maxDrawdownPctLimit = Math.max(0, options.maxDrawdownPct);

  let status: RiskMetrics['status'] = 'safe';
  if ((dailyLossLimitAmount > 0 && dailyLossPctUsed >= 100)
    || todayTradeCount >= maxDailyTrades
    || (maxDrawdownPctLimit > 0 && currentDrawdownPct >= maxDrawdownPctLimit)) {
    status = 'danger';
  } else if (dailyLossPctUsed >= 70 || (maxDailyTrades > 1 && todayTradeCount >= maxDailyTrades - 1) || (maxDrawdownPctLimit > 0 && currentDrawdownPct >= maxDrawdownPctLimit * 0.8)) {
    status = 'warning';
  }

  return {
    todayPnl,
    todayTradeCount,
    openTradeCount: enteredToday.filter(trade => trade.status === 'open').length,
    maxDailyTrades,
    dailyLossLimitAmount,
    dailyLossUsed,
    dailyLossRemaining: dailyLossLimitAmount - dailyLossUsed,
    dailyLossPctUsed,
    maxRiskPerTradePct: options.maxRiskPerTradePct,
    maxRiskUsedToday,
    maxDrawdown,
    maxDrawdownPct,
    currentDrawdown,
    currentDrawdownPct,
    maxDrawdownPctLimit,
    status,
    balance,
    timeZone: options.timeZone || 'UTC',
  };
}