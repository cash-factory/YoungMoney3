import type { RiskSettingsInput, TradingAccount, TradingPlan } from './types.ts';
import type { RiskMetricOptions } from './riskMetrics.ts';

type RiskDefaults = Pick<RiskSettingsInput, 'max_daily_loss_pct' | 'daily_loss_limit_amount' | 'max_daily_trades' | 'max_risk_per_trade_pct' | 'max_drawdown_pct'>;

function strictest(values: (number | null | undefined)[], fallback: number): number {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value) && value > 0);
  return valid.length ? Math.min(...valid) : fallback;
}

/** Shared account-specific policy for the dashboard Risk Guardian and Risk Management page. */
export function accountRiskOptions(
  account: TradingAccount,
  settings: Partial<RiskDefaults> | null | undefined,
  plan: TradingPlan | null | undefined,
): RiskMetricOptions {
  return {
    accountId: account.id,
    accountBalance: account.balance,
    timeZone: account.challenge_reset_timezone || 'UTC',
    maxDailyLossPct: strictest([account.daily_loss_limit_pct, plan?.max_daily_loss_pct, settings?.max_daily_loss_pct], 3),
    maxRiskPerTradePct: strictest([account.risk_per_trade_pct, plan?.max_risk_per_trade_pct, settings?.max_risk_per_trade_pct], 1),
    maxDrawdownPct: strictest([account.max_loss_limit_pct, plan?.max_drawdown_pct, settings?.max_drawdown_pct], 10),
    // A workspace-wide amount denominated in USD must never be applied to another currency.
    maxDailyLossAmount: account.base_currency === 'USD' ? settings?.daily_loss_limit_amount : null,
    maxDailyTrades: settings?.max_daily_trades ?? 5,
  };
}
