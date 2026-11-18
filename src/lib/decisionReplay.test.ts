import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMPTY_RULES,
  entryFacts,
  evaluateEntry,
  focusForDay,
  outcomeFacts,
  replayTargets,
  reviewMoney,
  type ReplayTarget,
} from './decisionReplay.ts';
import { riskCapital } from './tradeFinance.ts';
import type { Trade, WeeklyReview, TradingAccount } from './types.ts';
import type { Mt5PositionVersion } from '../hooks/useMt5Lifecycles.ts';

const time = '2026-11-11T09:12:00Z';
const trade = {
  id: 'one',
  pair: 'EUR/USD',
  direction: 'long',
  entry_time: time,
  entry_price: 1.2,
  status: 'closed',
  pnl: 40,
  strategy_id: 'later',
  settlement_currency: 'ZAR',
  decision_entry: {
    entry_time: time,
    entry_price: 1.2,
    direction: 'long',
    originally_open: true,
    capture_mode: 'live',
    strategy_id: null,
    entry_model_id: null,
    plan_id: null,
    stop_loss: 1.18,
    risk_percent: 0.8,
    checklist_items: [{ label: 'Retest', checked: true, is_required: true }],
  },
} as Trade;
const manual: ReplayTarget = { kind: 'trade', trade };
const position = {
  link: 'link-a',
  account_id: 'a',
  lifecycle_id: '321:0',
  summary: {
    position_id: '321',
    symbol: 'EURUSD',
    direction: 'long',
    status: 'open',
    first_entry_at: time,
    initial_entry_price: '1.2',
    initial_sl_provenance: 'first_observed',
    entries: [{ initial_sl: '1.18', initial_sl_provenance: 'first_observed' }],
    capture_completeness: { session_status: 'unconfirmed' },
  },
} as unknown as Mt5PositionVersion;

test('outcomes and later tags cannot alter the evidence at entry', () => {
  const facts = entryFacts(manual);
  assert.equal(facts.strategyId, null);
  const rules = {
    ...EMPTY_RULES,
    earliest: '09:15',
    riskLimit: 1,
    requireStop: true,
    checklist: ['Retest', 'Volume confirmed'],
  };
  assert.deepEqual(
    evaluateEntry(facts, rules).map((f) => [f.label, f.state]),
    [
      ['Entry time', 'missed'],
      ['Protective stop at entry', 'met'],
      ['Initial risk against plan', 'met'],
      ['Retest', 'met'],
      ['Volume confirmed', 'unknown'],
    ]
  );
  const loss = { kind: 'trade', trade: { ...trade, pnl: -80 } } as const;
  assert.deepEqual(evaluateEntry(entryFacts(loss), rules), evaluateEntry(facts, rules));
  assert.equal(outcomeFacts(loss, []).amount, -80);
});
test('later observed stop and unconfirmed clock never become retroactive proof', () => {
  const findings = evaluateEntry(entryFacts({ kind: 'position', position }), {
    ...EMPTY_RULES,
    earliest: '09:15',
    requireStop: true,
    riskLimit: 1,
  });
  assert.ok(findings.every((f) => f.state === 'unknown'));
  assert.match(findings.find((f) => f.label === 'Protective stop at entry')!.evidence, /observed later/);
  for (const original of [undefined, { ...trade.decision_entry!, originally_open: false }]) {
    const facts = entryFacts({ kind: 'trade', trade: { ...trade, decision_entry: original } });
    assert.equal(facts.stop, null);
    assert.equal(evaluateEntry(facts, EMPTY_RULES)[0].state, 'unknown');
  }
});
test('exact linked positions count once and separate broker links remain independent', () => {
  const legacy = {
    ...trade,
    id: 'link-a/deal-1',
    trade_source: 'mt5',
    broker_details: { position_id: '321' },
  } as Trade;
  const other = { ...legacy, id: 'link-b/deal-1' };
  assert.equal(replayTargets([trade, legacy, other], [position]).length, 3);
  assert.match(reviewMoney(40, 'ZAR'), /ZAR/);
  assert.match(reviewMoney(40, null), /currency unconfirmed/);
  assert.equal(reviewMoney(null, 'USD'), 'Unavailable');
});
test('weekly commitments are scoped to the next week and account', () => {
  const r = {
    id: 'week',
    account_id: 'a',
    week_end: '2026-11-08',
    focus_next_week: 'Wait for the close',
    updated_at: time,
  } as WeeklyReview;
  assert.equal(focusForDay([r], '2026-11-09', 'a')?.id, 'week');
  assert.equal(focusForDay([r], '2026-11-09', 'b'), undefined);
  assert.equal(focusForDay([r], '2026-11-16', 'a'), undefined);
});
test('risk capital preserves zero equity and states each fallback', () => {
  const account = {
    id: 'a',
    base_currency: 'ZAR',
    balance: 200,
    broker_balance: 180,
    broker_equity: 0,
  } as TradingAccount;
  assert.deepEqual(riskCapital(account, [], []), {
    value: 0,
    source: 'Broker equity',
    observedAt: null,
  });
  assert.equal(riskCapital({ ...account, broker_equity: undefined }, [], []).source, 'Broker balance');
  assert.equal(
    riskCapital({ ...account, broker_equity: undefined, broker_balance: undefined }, [], []).value,
    200
  );
});
