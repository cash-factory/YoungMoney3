import Decimal from 'decimal.js-light';
import type { ExecutionMetrics, Trade } from './types.ts';

const markets = [
  { name: 'Sydney', zone: 'Australia/Sydney', open: 8, close: 17 },
  { name: 'Tokyo', zone: 'Asia/Tokyo', open: 9, close: 18 },
  { name: 'London', zone: 'Europe/London', open: 8, close: 17 },
  { name: 'New York', zone: 'America/New_York', open: 8, close: 17 },
];
const clocks = markets.map(m => new Intl.DateTimeFormat('en-GB', {
  timeZone: m.zone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', weekday: 'short',
}));

export function sessionsAt(instant: string | number): string[] {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return [];
  return markets.flatMap((market, i) => {
    const parts = clocks[i].formatToParts(date);
    const value = (key: string) => parts.find(p => p.type === key)?.value;
    if (['Sat', 'Sun'].includes(value('weekday') || '')) return [];
    const hour = Number(value('hour')) + Number(value('minute')) / 60;
    return hour >= market.open && hour < market.close ? [market.name] : [];
  });
}

export function finiteMetric(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function crossedSessions(start: number, end: number): string[] {
  const found = new Set([...sessionsAt(start), ...sessionsAt(end)]);
  // After a full week every market has been visited; cap long holds at eight days.
  const stop = Math.min(end, start + 8 * 86400000);
  for (let at = start; at <= stop; at += 30 * 60000) sessionsAt(at).forEach(s => found.add(s));
  return [...found];
}

/** Read-only facade used by all views. Unknown legacy facts remain null. */
export function getExecutionMetrics(trade: Trade): ExecutionMetrics {
  const captured = trade.execution_metrics;
  const start = Date.parse(trade.entry_time);
  const end = trade.exit_time ? Date.parse(trade.exit_time) : NaN;
  const safeTimes = captured?.timezone_status !== 'unknown' && captured?.timezone_status !== 'unresolved_history';
  const canTime = safeTimes && Number.isFinite(start);
  const sessionNames = { asian: 'Tokyo', london: 'London', new_york: 'New York', sydney: 'Sydney', overlap: 'Overlap' };
  return {
    ...captured,
    version: 1,
    planned_r: finiteMetric(captured?.planned_r ?? trade.planned_r),
    realized_r: finiteMetric(captured?.realized_r ?? trade.realized_r),
    initial_risk: finiteMetric(captured?.initial_risk ?? trade.initial_risk),
    first_sl: finiteMetric(captured?.first_sl),
    pips: captured ? finiteMetric(captured.pips) : trade.trade_source === 'mt5' ? null : finiteMetric(trade.pips),
    ticks: finiteMetric(captured?.ticks),
    points: finiteMetric(captured?.points),
    duration_seconds: finiteMetric(captured?.duration_seconds) ?? (Number.isFinite(end) && Number.isFinite(start) && end >= start ? (end - start) / 1000 : null),
    weighted_duration_seconds: finiteMetric(captured?.weighted_duration_seconds),
    sessions_at_entry: captured?.sessions_at_entry ?? (canTime ? sessionsAt(start) : trade.session ? [sessionNames[trade.session]] : []),
    sessions_crossed: captured?.sessions_crossed ?? (canTime && Number.isFinite(end) ? crossedSessions(start, end) : []),
    fills: captured?.fills ?? [],
    stops: captured?.stops ?? [],
    completeness: captured?.completeness ?? (trade.trade_source === 'mt5' ? ['legacy_initial_risk_unknown'] : []),
  };
}

/** Money actually realized by each exit, including partial closes of open positions. */
export function realizedExecutionEvents(trades: Trade[]): Array<{ trade: Trade; at: string; pnl: number }> {
  return trades.filter(t => !t.superseded_by).flatMap(trade => {
    const exits = trade.execution_metrics?.exits;
    if (exits?.length) return exits.flatMap(exit => {
      const at = String(exit.time ?? exit.exit_time ?? '');
      const amount = finiteMetric(exit.net_pnl ?? exit.net ?? exit.pnl);
      return amount !== null && Number.isFinite(Date.parse(at)) ? [{ trade, at, pnl: amount }] : [];
    });
    return trade.status === 'closed' && trade.exit_time ? [{ trade, at: trade.exit_time, pnl: trade.pnl }] : [];
  });
}

export function normalizeExecutionMetrics(trade: Trade): ExecutionMetrics {
  const source = trade.execution_metrics;
  const result = getExecutionMetrics(trade);
  if (source) {
    const risk = finiteMetric(source.initial_risk);
    const closedRisk = finiteMetric(source.closed_risk);
    result.initial_risk_decimal = risk !== null && risk > 0 ? new Decimal(String(source.initial_risk)).toString() : null;
    result.initial_risk = risk !== null && risk > 0 ? risk : null;
    const denominator = trade.status === 'closed' ? result.initial_risk : closedRisk;
    const realized = finiteMetric(source.realized_net ?? source.net_pnl ?? trade.pnl);
    result.realized_r = denominator && denominator > 0 && realized !== null
      ? new Decimal(realized).div(denominator).toNumber() : null;
  }
  return result;
}
