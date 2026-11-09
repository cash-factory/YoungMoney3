import assert from 'node:assert/strict';
import test from 'node:test';
import type { Trade } from './types.ts';
import { calculateRiskMetrics, dateKeyInTimeZone } from './riskMetrics.ts';

function makeTrade(overrides: Partial<Trade>): Trade {
  return {
    id: 'trade-1',
    account_id: 'account-a',
    status: 'closed',
    entry_time: '2026-10-19T22:30:00.000Z',
    exit_time: '2026-10-20T15:30:00.000Z',
    pnl: -50,
    risk_percent: 0.5,
    ...overrides,
  } as Trade;
}

const options = {
  accountId: 'account-a',
  accountBalance: 10_000,
  timeZone: 'America/New_York',
  now: new Date('2026-10-20T15:00:00.000Z'),
  maxDailyLossPct: 1,
  maxDailyTrades: 5,
  maxRiskPerTradePct: 0.5,
  maxDrawdownPct: 10,
};

test('date keys follow the account timezone and handle invalid zones', () => {
  const boundary = '2026-10-20T03:30:00.000Z';
  assert.equal(dateKeyInTimeZone(boundary, 'America/New_York'), '2026-10-19');
  assert.equal(dateKeyInTimeZone(boundary, 'Invalid/Zone'), '2026-10-20');
});

test('risk metrics scope to one account and count realized losses by close date', () => {
  const trades = [
    makeTrade({}),
    makeTrade({ id: 'overnight', entry_time: '2026-10-19T18:00:00.000Z', exit_time: '2026-10-20T16:30:00.000Z', pnl: -25 }),
    makeTrade({ id: 'other-account', account_id: 'account-b', pnl: -900 }),
    makeTrade({ id: 'open', status: 'open', entry_time: '2026-10-20T12:00:00.000Z', exit_time: null, pnl: -700 }),
  ];

  const metrics = calculateRiskMetrics(trades, options);
  assert.equal(metrics.todayPnl, -75);
  assert.equal(metrics.dailyLossUsed, 75);
  assert.equal(metrics.dailyLossLimitAmount, 100);
  assert.equal(metrics.todayTradeCount, 1);
  assert.equal(metrics.openTradeCount, 1);
  assert.equal(metrics.maxRiskUsedToday, 0.5);
  assert.equal(metrics.timeZone, 'America/New_York');
});

test('absolute USD cap can tighten the percentage loss limit', () => {
  const metrics = calculateRiskMetrics([makeTrade({})], { ...options, maxDailyLossAmount: 60 });
  assert.equal(metrics.dailyLossLimitAmount, 60);
  assert.equal(metrics.dailyLossRemaining, 10);
  assert.equal(metrics.status, 'warning');
});

test('a breached maximum drawdown is a danger state', () => {
  const trades = [
    makeTrade({ id: 'win', pnl: 200, exit_time: '2026-10-19T15:00:00.000Z' }),
    makeTrade({ id: 'loss', pnl: -100, exit_time: '2026-10-20T15:00:00.000Z' }),
  ];
  const metrics = calculateRiskMetrics(trades, { ...options, maxDrawdownPct: 1 });
  assert.equal(metrics.currentDrawdownPct, 1);
  assert.equal(metrics.status, 'danger');
});

test('single-trade limit stays safe before the first trade and is dangerous after one', () => {
  const single = { ...options, maxDailyTrades: 1 };
  assert.equal(calculateRiskMetrics([], single).status, 'safe');
  assert.equal(calculateRiskMetrics([makeTrade({ entry_time: '2026-10-20T12:00:00.000Z', pnl: 0 })], single).status, 'danger');
});

test('an absolute-only daily limit is honored when no percentage cap is configured', () => {
  const metrics = calculateRiskMetrics([makeTrade({})], {
    ...options, maxDailyLossPct: 0, maxDailyLossAmount: 75,
  });
  assert.equal(metrics.dailyLossLimitAmount, 75);
  assert.equal(metrics.dailyLossRemaining, 25);
});
