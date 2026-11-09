import assert from 'node:assert/strict';
import test from 'node:test';
import { accountRiskOptions } from './riskPolicy.ts';
import type { RiskSettingsInput, TradingAccount, TradingPlan } from './types.ts';

const account = {
  id: 'account-a', base_currency: 'USD', balance: 10_000, risk_per_trade_pct: 2,
  daily_loss_limit_pct: 3, max_loss_limit_pct: 8, challenge_reset_timezone: 'Africa/Johannesburg',
} as TradingAccount;
const settings = {
  max_daily_loss_pct: 5, max_daily_trades: 4, max_risk_per_trade_pct: 1.5,
  max_drawdown_pct: 10, daily_loss_limit_amount: 250, account_balance: 10_000,
} as RiskSettingsInput;
const plan = {
  max_daily_loss_pct: 2, max_risk_per_trade_pct: 1, max_drawdown_pct: 6,
} as TradingPlan;

test('account, plan and workspace risk guards resolve to the strictest configured limits', () => {
  assert.deepEqual(accountRiskOptions(account, settings, plan), {
    accountId: 'account-a', accountBalance: 10_000, timeZone: 'Africa/Johannesburg',
    maxDailyLossPct: 2, maxDailyLossAmount: 250, maxDailyTrades: 4,
    maxRiskPerTradePct: 1, maxDrawdownPct: 6,
  });
});

test('USD-denominated absolute cap never carries over to another account currency', () => {
  assert.equal(accountRiskOptions({ ...account, base_currency: 'EUR' }, settings, plan).maxDailyLossAmount, null);
});
