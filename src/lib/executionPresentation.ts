import { getExecutionMetrics } from './executionMetrics.ts';
import type { Trade } from './types.ts';

export function formatHoldDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return 'Unknown';
  const total = Math.floor(seconds);
  if (total < 60) return total + 's';
  const days = Math.floor(total / 86400);
  const hours = Math.floor(total % 86400 / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  return [days ? days + 'd' : '', hours ? hours + 'h' : '', minutes ? minutes + 'm' : ''].filter(Boolean).join(' ');
}

export function executionMovement(trade: Trade): string {
  const metrics = getExecutionMetrics(trade);
  if (metrics.pips != null) return metrics.pips.toFixed(1) + ' pips';
  if (metrics.ticks != null) return metrics.ticks.toFixed(1) + ' ticks';
  if (metrics.points != null) return metrics.points.toFixed(4) + ' points';
  return 'Unknown';
}

export function executionStats(trades: Trade[]) {
  const closed = trades.filter(trade => trade.status === 'closed');
  const values = closed.map(getExecutionMetrics);
  const r = values.map(item => item.realized_r).filter((value): value is number => value != null && Number.isFinite(value));
  const durations = values.map(item => item.duration_seconds).filter((value): value is number => value != null && Number.isFinite(value));
  const sessions = new Map<string, number>();
  for (const item of values) for (const session of item.sessions_at_entry ?? []) sessions.set(session, (sessions.get(session) ?? 0) + 1);
  return {
    count: closed.length,
    rCount: r.length,
    meanR: r.length ? r.reduce((sum, value) => sum + value, 0) / r.length : null,
    cumulativeR: r.reduce((sum, value) => sum + value, 0),
    durationCount: durations.length,
    meanDuration: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null,
    initialRiskCount: values.filter(item => item.initial_risk != null && item.initial_risk > 0).length,
    sessions: [...sessions.entries()],
  };
}

type SimulatedExecutionInput = {
  id: string; pair: string; direction: 'long' | 'short'; entry_time: string | null; exit_time: string | null;
  status: 'open' | 'closed'; pnl: number; entry_price: number | null; exit_price: number | null;
  r?: number | null; pips?: number | null;
};

/** A test with no recorded original stop retains unknown monetary risk. */
export function simulatedExecutionTrade(input: SimulatedExecutionInput): Trade {
  return {
    ...input, entry_time: input.entry_time || '', trade_source: 'manual', mistakes: [],
    execution_metrics: {version:1, realized_r:input.r ?? null, planned_r:null, initial_risk:null,
      pips:input.pips ?? null, completeness:['simulated_execution'],timezone_status:input.entry_time ? 'recorded_utc' : 'unknown'},
  } as unknown as Trade;
}
