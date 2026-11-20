import { getExecutionMetrics, realizedExecutionEvents } from './executionMetrics.ts';
import { format, parseISO, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay } from 'date-fns';
import type { Trade, DashboardStats } from './types.ts';

export function formatCurrency(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPips(value: number): string {
  const sign = value < 0 ? '-' : '';
  return `${sign}${Math.abs(value).toFixed(1)} pips`;
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatDate(date: string | Date, fmt = 'MMM d, yyyy'): string {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, fmt);
}

export function formatDateTime(date: string | Date): string {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, 'MMM d, yyyy · h:mm a');
}

export function getPipValue(pair: string): number {
  const p = pair.toUpperCase();
  // JPY pairs: 0.01
  if (p.includes('JPY')) return 0.01;
  // Metals: XAU/USD = 0.01 per pip, XAG/USD = 0.001
  if (p === 'XAU/USD') return 0.01;
  if (p === 'XAG/USD') return 0.001;
  // Crypto: BTC/USD, ETH/USD — 1 unit = 1 pip
  if (p.includes('BTC') || p.includes('ETH')) return 1;
  // Indices: US30, NAS100, SPX500, GER40, UK100 — 1 point
  if (['US30', 'NAS100', 'SPX500', 'GER40', 'UK100', 'US500', 'US100', 'GER30'].includes(p)) return 1;
  // Standard FX pairs: 0.0001
  return 0.0001;
}

export type InstrumentType = 'fx' | 'jpy' | 'metal' | 'crypto' | 'index';

export function getInstrumentType(pair: string): InstrumentType {
  const p = pair.toUpperCase();
  if (p.includes('JPY')) return 'jpy';
  if (p === 'XAU/USD' || p === 'XAG/USD') return 'metal';
  if (p.includes('BTC') || p.includes('ETH')) return 'crypto';
  if (['US30', 'NAS100', 'SPX500', 'GER40', 'UK100', 'US500', 'US100', 'GER30'].includes(p)) return 'index';
  return 'fx';
}

export function getPipValuePerLot(pair: string): number {
  // Dollar value per pip per 1.0 standard lot
  const p = pair.toUpperCase();
  if (p.includes('JPY')) return 9.09; // approx for JPY pairs
  if (p === 'XAU/USD') return 1; // $1 per pip per 0.01 lot typically
  if (p === 'XAG/USD') return 50; // $50 per pip per standard lot
  if (p.includes('BTC')) return 1;
  if (p.includes('ETH')) return 1;
  if (['US30', 'NAS100', 'SPX500', 'GER40', 'UK100', 'US500', 'US100', 'GER30'].includes(p)) return 1;
  return 10; // standard FX: $10 per pip per standard lot
}

export function calcPips(pair: string, direction: 'long' | 'short', entry: number, exit: number): number {
  if (!entry || !exit) return 0;
  const diff = direction === 'long' ? exit - entry : entry - exit;
  return diff / getPipValue(pair);
}

export function calcPnl(pips: number, lotSize: number, pair: string): number {
  if (!lotSize) return 0;
  const pipValuePerLot = getPipValuePerLot(pair);
  return pips * lotSize * pipValuePerLot;
}

export function calcRiskReward(entry: number, exit: number, stopLoss: number, direction: 'long' | 'short'): number | null {
  if (!entry || !exit || !stopLoss) return null;
  const risk = Math.abs(entry - stopLoss);
  const reward = direction === 'long' ? Math.abs(exit - entry) : Math.abs(entry - exit);
  if (risk === 0) return null;
  return reward / risk;
}

export function getWeekRange(date: Date) {
  return { start: startOfWeek(date, { weekStartsOn: 1 }), end: endOfWeek(date, { weekStartsOn: 1 }) };
}

export function getMonthRange(date: Date) {
  return { start: startOfMonth(date), end: endOfMonth(date) };
}

export function getDaysInRange(start: Date, end: Date): Date[] {
  return eachDayOfInterval({ start, end });
}

export function isTradeOnDay(trade: Trade, day: Date): boolean {
  return isSameDay(parseISO(trade.entry_time), day);
}

function closedTrades(trades: Trade[]): Trade[] {
  return trades.filter(trade => trade.status === 'closed' && !trade.superseded_by);
}

function realizedAt(trade: Trade): string {
  return trade.exit_time || trade.entry_time;
}

export function computeDashboardStats(trades: Trade[]): DashboardStats {
  const closed = closedTrades(trades);
  const executionEvents = realizedExecutionEvents(trades);
  if (closed.length === 0) {
    return {
      totalPnl: executionEvents.reduce((sum,event)=>sum+event.pnl,0), totalTrades: 0, winRate: 0, wins: 0, losses: 0, breakevens: 0,
      avgWin: 0, avgLoss: 0, bestDay: null, worstDay: null,
      maxConsecutiveWins: 0, maxConsecutiveLosses: 0,
      currentStreak: { type: 'none', count: 0 },
      profitFactor: 0, expectancy: 0, avgRiskReward: 0,
    };
  }

  const sorted = [...closed].sort((a, b) => new Date(realizedAt(a)).getTime() - new Date(realizedAt(b)).getTime());
  const totalPnl = executionEvents.reduce((sum,event)=>sum+event.pnl,0);
  const wins = closed.filter(t => t.outcome === 'win');
  const losses = closed.filter(t => t.outcome === 'loss');
  const breakevens = closed.filter(t => t.outcome === 'breakeven');
  const winRate = (wins.length / closed.length) * 100;
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 0;

  // Best/worst day
  const dayMap = new Map<string, number>();
  executionEvents.forEach(event => {
    const day = format(parseISO(event.at),'yyyy-MM-dd');
    dayMap.set(day,(dayMap.get(day) || 0)+event.pnl);
  });
  let bestDay: { date: string; pnl: number } | null = null;
  let worstDay: { date: string; pnl: number } | null = null;
  dayMap.forEach((pnl, date) => {
    if (!bestDay || pnl > bestDay.pnl) bestDay = { date, pnl };
    if (!worstDay || pnl < worstDay.pnl) worstDay = { date, pnl };
  });

  // Consecutive wins/losses
  let maxWins = 0, maxLosses = 0, curWins = 0, curLosses = 0;
  let currentType: 'win' | 'loss' | 'none' = 'none';
  let currentCount = 0;
  sorted.forEach(t => {
    if (t.outcome === 'win') {
      curWins++;
      curLosses = 0;
      maxWins = Math.max(maxWins, curWins);
    } else if (t.outcome === 'loss') {
      curLosses++;
      curWins = 0;
      maxLosses = Math.max(maxLosses, curLosses);
    } else {
      curWins = 0;
      curLosses = 0;
    }
  });
  // Current streak from the end
  for (let i = sorted.length - 1; i >= 0; i--) {
    const t = sorted[i];
    if (t.outcome === 'breakeven') continue;
    if (currentType === 'none') {
      currentType = t.outcome === 'win' ? 'win' : 'loss';
      currentCount = 1;
    } else if ((t.outcome === 'win' && currentType === 'win') || (t.outcome === 'loss' && currentType === 'loss')) {
      currentCount++;
    } else break;
  }

  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? Infinity : 0) : grossProfit / grossLoss;
  const expectancy = closed.length ? totalPnl / closed.length : 0;
  const rrTrades = closed.map(getExecutionMetrics).map(metrics=>metrics.realized_r).filter((value):value is number=>value!=null && Number.isFinite(value));
  const avgRiskReward = rrTrades.length ? rrTrades.reduce((sum,value)=>sum+value,0)/rrTrades.length : 0;

  return {
    totalPnl, totalTrades: closed.length, winRate,
    wins: wins.length, losses: losses.length, breakevens: breakevens.length,
    avgWin, avgLoss, bestDay, worstDay,
    maxConsecutiveWins: maxWins, maxConsecutiveLosses: maxLosses,
    currentStreak: { type: currentType, count: currentCount },
    profitFactor, expectancy, avgRiskReward,
  };
}

export function equityCurveData(trades: Trade[]): { date: string; equity: number; label: string }[] {
  const sorted = realizedExecutionEvents(trades).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  let running = 0;
  return sorted.map(event => {
    running += event.pnl;
    return {date:event.at,equity:running,label:format(parseISO(event.at),'MMM d')};
  });
}

export function dailyPnlData(trades: Trade[], days: Date[]): { date: string; pnl: number; label: string; trades: number }[] {
  const events=realizedExecutionEvents(trades);
  return days.map(day=>{
    const selected=events.filter(event=>isSameDay(parseISO(event.at),day));
    return {date:format(day,'yyyy-MM-dd'),pnl:selected.reduce((sum,event)=>sum+event.pnl,0),label:format(day,'MMM d'),trades:new Set(selected.map(event=>event.trade.id)).size};
  });
}

export function groupByPair(trades: Trade[]): { pair: string; trades: number; pnl: number; winRate: number }[] {
  const map = new Map<string, { trades: number; pnl: number; wins: number }>();
  closedTrades(trades).forEach(t => {
    const ex = map.get(t.pair) || { trades: 0, pnl: 0, wins: 0 };
    ex.trades++;
    ex.pnl += t.pnl;
    if (t.outcome === 'win') ex.wins++;
    map.set(t.pair, ex);
  });
  return Array.from(map.entries())
    .map(([pair, v]) => ({ pair, trades: v.trades, pnl: v.pnl, winRate: (v.wins / v.trades) * 100 }))
    .sort((a, b) => b.trades - a.trades);
}

export function groupByDayOfWeek(trades: Trade[]): { day: string; trades: number; pnl: number; winRate: number }[] {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const map = new Map<string, { trades: number; pnl: number; wins: number }>();
  days.forEach(d => map.set(d, { trades: 0, pnl: 0, wins: 0 }));
  closedTrades(trades).forEach(t => {
    const day = format(parseISO(realizedAt(t)), 'EEE');
    const ex = map.get(day)!;
    ex.trades++;
    ex.pnl += t.pnl;
    if (t.outcome === 'win') ex.wins++;
  });
  return days.map(day => {
    const v = map.get(day)!;
    return { day, trades: v.trades, pnl: v.pnl, winRate: v.trades ? (v.wins / v.trades) * 100 : 0 };
  });
}

export function groupByDirection(trades: Trade[]): { direction: string; trades: number; pnl: number; winRate: number }[] {
  const map = new Map<string, { trades: number; pnl: number; wins: number }>();
  closedTrades(trades).forEach(t => {
    const ex = map.get(t.direction) || { trades: 0, pnl: 0, wins: 0 };
    ex.trades++;
    ex.pnl += t.pnl;
    if (t.outcome === 'win') ex.wins++;
    map.set(t.direction, ex);
  });
  return Array.from(map.entries()).map(([direction, v]) => ({
    direction: direction === 'long' ? 'Long' : 'Short',
    trades: v.trades, pnl: v.pnl, winRate: (v.wins / v.trades) * 100,
  }));
}

export function groupBySession(trades: Trade[]): { session: string; trades: number; pnl: number; winRate: number }[] {
  const groups=new Map<string,Trade[]>();
  for(const trade of closedTrades(trades)) {
    const sessions=getExecutionMetrics(trade).sessions_at_entry ?? [];
    if(!sessions.length) continue;
    const key=sessions.length>1 ? sessions.join(' / ') : sessions[0];
    groups.set(key,[...(groups.get(key) || []),trade]);
  }
  return [...groups].map(([session,items])=>({session,trades:items.length,pnl:items.reduce((sum,t)=>sum+t.pnl,0),winRate:items.filter(t=>t.outcome==='win').length/items.length*100}));
}

export function groupByStrategy(trades: Trade[]): { strategy: string; trades: number; pnl: number; winRate: number }[] {
  const map = new Map<string, { trades: number; pnl: number; wins: number }>();
  closedTrades(trades).forEach(t => {
    if (!t.strategy) return;
    const ex = map.get(t.strategy) || { trades: 0, pnl: 0, wins: 0 };
    ex.trades++;
    ex.pnl += t.pnl;
    if (t.outcome === 'win') ex.wins++;
    map.set(t.strategy, ex);
  });
  return Array.from(map.entries())
    .map(([strategy, v]) => ({ strategy, trades: v.trades, pnl: v.pnl, winRate: (v.wins / v.trades) * 100 }))
    .sort((a, b) => b.pnl - a.pnl);
}

export function exportToCSV(trades: Trade[]): string {
  const headers = [
    'Position ID','Entry Time UTC','Exit Time UTC','Pair','Direction','Status','Entry','Exit','Current SL','Current TP','Lot Size','Outcome','Net PnL','Currency',
    'Pips','Ticks','Points','First SL','First SL Time','SL Evidence','Delayed SL','Initial Risk','Planned R','Net Realized R','Hold Seconds','Weighted Hold Seconds',
    'Sessions At Entry','Sessions Crossed','Timezone Evidence','Capture Gaps','Fills JSON','Stops JSON','Strategy','Broker','Risk %','Emotion','Setup Quality','Mistakes','Lessons','Notes',
  ];
  const rows=trades.map(trade=>{
    const metrics=getExecutionMetrics(trade);
    const values=[
      trade.id,trade.entry_time,trade.exit_time,trade.pair,trade.direction,trade.status,trade.entry_price,trade.exit_price,trade.stop_loss,trade.take_profit,trade.lot_size,trade.outcome,trade.pnl,trade.settlement_currency || trade.calculation_snapshot?.account_currency,
      metrics.pips,metrics.ticks,metrics.points,metrics.first_sl,metrics.first_sl_at,metrics.first_sl_source,metrics.delayed_sl,metrics.initial_risk,metrics.planned_r,metrics.realized_r,metrics.duration_seconds,metrics.weighted_duration_seconds,
      metrics.sessions_at_entry?.join('; '),metrics.sessions_crossed?.join('; '),metrics.timezone_status,metrics.completeness?.join('; '),JSON.stringify(metrics.fills ?? []),JSON.stringify(metrics.stops ?? []),trade.strategy,trade.broker,trade.risk_percent,trade.emotional_state,trade.setup_quality,trade.mistakes?.join('; '),trade.lessons,trade.notes,
    ];
    return values.map(value=>`"${String(value ?? '').replace(/"/g,'""')}"`).join(',');
  });
  return [headers.join(','),...rows].join('\n');
}

export function downloadFile(content: string, filename: string, mime = 'text/csv') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
