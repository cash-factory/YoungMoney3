import assert from 'node:assert/strict';
import test from 'node:test';
import { generateAISummary, getPeriodTrades } from './ai.ts';
import type { Trade } from './types.ts';

function closed(id: string, entry: Date, exit: Date, pnl: number): Trade {
  return {
    id, account_id: 'account-eur', status: 'closed', pair: 'EUR/USD', direction: 'long',
    entry_time: entry.toISOString(), exit_time: exit.toISOString(), pnl,
    outcome: pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven',
    mistakes: [],
  } as Trade;
}

test('daily period includes the full close date and previous local calendar day', () => {
  const today = new Date(2026, 9, 20, 12);
  const current = closed('overnight', new Date(2026, 9, 19, 23), new Date(2026, 9, 20, 16), 25);
  const previous = closed('previous', new Date(2026, 9, 18, 22), new Date(2026, 9, 19, 15), -10);
  const open = { ...current, id: 'open', status: 'open' } as Trade;
  const periods = getPeriodTrades([current, previous, open], today, 'daily');
  assert.deepEqual(periods.current.map(trade => trade.id), ['overnight']);
  assert.deepEqual(periods.previous.map(trade => trade.id), ['previous']);
});

test('insight narrative uses the selected account currency', () => {
  const trade = closed('eu', new Date(2026, 9, 20, 9), new Date(2026, 9, 20, 16), 25);
  const result = generateAISummary([trade], [], 'daily', 'EUR');
  assert.match(result.summary, /€/);
  assert.match(String(result.comparison.current['Net P&L']), /€/);
});
