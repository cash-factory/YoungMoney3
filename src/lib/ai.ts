import type { Trade, PatternInsight, ComparisonData, DashboardStats } from './types';
import {
  computeDashboardStats, groupByPair, groupByDayOfWeek, groupByDirection, groupBySession, groupByStrategy,
  formatPercent,
} from './utils.ts';
import { parseISO, startOfDay, endOfDay, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';

type MoneyFormatter = (amount: number) => string;

export interface AIResult {
  summary: string;
  suggestions: string[];
  patterns: PatternInsight[];
  comparison: ComparisonData;
}

export function generateAISummary(
  currentTrades: Trade[],
  previousTrades: Trade[],
  periodType: 'daily' | 'weekly' | 'monthly',
  currency = 'USD',
): AIResult {
  const safeCurrency = /^[A-Z]{3}$/.test(currency) ? currency : 'USD';
  const money: MoneyFormatter = amount => new Intl.NumberFormat(undefined, {
    style: 'currency', currency: safeCurrency,
  }).format(amount);
  const stats = computeDashboardStats(currentTrades);
  const prevStats = computeDashboardStats(previousTrades);

  // ---- Summary paragraph ----
  const summary = buildSummary(stats, currentTrades, periodType, money);

  // ---- Suggestions ----
  const suggestions = buildSuggestions(currentTrades, stats, money);

  // ---- Patterns ----
  const patterns = detectPatterns(currentTrades, money);

  // ---- Comparison ----
  const comparison = buildComparison(stats, prevStats, money);

  return { summary, suggestions, patterns, comparison };
}

function buildSummary(stats: DashboardStats, trades: Trade[], periodType: string, money: MoneyFormatter): string {
  const periodLabel = periodType === 'daily' ? 'today' : periodType === 'weekly' ? 'this week' : 'this month';
  if (trades.length === 0) {
    return `No trades were logged ${periodLabel}. Use this time to review your trading plan and prepare for the next session.`;
  }

  const parts: string[] = [];
  parts.push(`You logged ${stats.totalTrades} trade${stats.totalTrades !== 1 ? 's' : ''} ${periodLabel} with a net result of ${money(stats.totalPnl)}.`);
  parts.push(`Your win rate was ${formatPercent(stats.winRate)} (${stats.wins} win${stats.wins !== 1 ? 's' : ''}, ${stats.losses} loss${stats.losses !== 1 ? 'es' : ''}${stats.breakevens ? `, ${stats.breakevens} breakeven` : ''}).`);

  if (stats.avgWin > 0 && stats.avgLoss > 0) {
    parts.push(`Average win: ${money(stats.avgWin)}, average loss: ${money(stats.avgLoss)}.`);
  }

  if (stats.profitFactor !== Infinity && stats.profitFactor > 0) {
    parts.push(`Profit factor: ${stats.profitFactor.toFixed(2)}.`);
  }

  if (stats.currentStreak.type === 'win') {
    parts.push(`You are currently on a ${stats.currentStreak.count}-trade winning streak.`);
  } else if (stats.currentStreak.type === 'loss') {
    parts.push(`You are currently on a ${stats.currentStreak.count}-trade losing streak.`);
  }

  if (stats.bestDay && stats.worstDay) {
    parts.push(`Best day: ${money(stats.bestDay.pnl)}, worst day: ${money(stats.worstDay.pnl)}.`);
  }

  return parts.join(' ');
}

function buildSuggestions(trades: Trade[], stats: DashboardStats, money: MoneyFormatter): string[] {
  const suggestions: string[] = [];

  if (stats.totalTrades) suggestions.push(stats.wins+' of '+stats.totalTrades+' closed trades finished positive. Replay an entry to review the decision.');
  const moods=trades.filter(t=>t.emotional_state);
  if(moods.length) suggestions.push('You recorded how you felt on '+moods.length+' of '+trades.length+' trades. Compare their entry notes.');
  const flagged=trades.filter(t=>t.mistakes?.length);
  if(flagged.length) suggestions.push('You marked something to revisit on '+flagged.length+' trades. Choose one example for your weekly review.');
  if (stats.avgLoss>0) suggestions.push('Average loss on this selection: '+money(stats.avgLoss)+'. Open the underlying trades to check their original risk.');
  return suggestions;
}

function detectPatterns(trades: Trade[], money: MoneyFormatter): PatternInsight[] {
  const patterns: PatternInsight[] = [];
  if (trades.length < 3) return patterns;

  // Best pair
  const pairData = groupByPair(trades).filter(p => p.trades >= 2);
  const bestPair = [...pairData].sort((a, b) => b.pnl - a.pnl)[0];
  const worstPair = [...pairData].sort((a, b) => a.pnl - b.pnl)[0];
  if (bestPair && bestPair.pnl > 0) {
    patterns.push({
      title: `Best performing pair: ${bestPair.pair}`,
      detail: `${money(bestPair.pnl)} over ${bestPair.trades} trades with a ${formatPercent(bestPair.winRate)} win rate.`,
      type: 'positive',
    });
  }
  if (worstPair && worstPair.pnl < 0 && worstPair.pair !== bestPair?.pair) {
    patterns.push({
      title: `Worst performing pair: ${worstPair.pair}`,
      detail: `${money(worstPair.pnl)} over ${worstPair.trades} trades with a ${formatPercent(worstPair.winRate)} win rate. Consider reducing activity on this pair.`,
      type: 'negative',
    });
  }

  // Best day of week
  const dayData = groupByDayOfWeek(trades).filter(d => d.trades >= 2);
  const bestDay = [...dayData].sort((a, b) => b.pnl - a.pnl)[0];
  const worstDay = [...dayData].sort((a, b) => a.pnl - b.pnl)[0];
  if (bestDay && bestDay.pnl > 0) {
    patterns.push({
      title: `Most profitable day: ${bestDay.day}`,
      detail: `${money(bestDay.pnl)} over ${bestDay.trades} trades.`,
      type: 'positive',
    });
  }
  if (worstDay && worstDay.pnl < 0 && worstDay.day !== bestDay?.day) {
    patterns.push({
      title: `Least profitable day: ${worstDay.day}`,
      detail: `${money(worstDay.pnl)} over ${worstDay.trades} trades. Consider being more selective on this day.`,
      type: 'negative',
    });
  }

  // Direction bias
  const dirData = groupByDirection(trades);
  const longPerf = dirData.find(d => d.direction === 'Long');
  const shortPerf = dirData.find(d => d.direction === 'Short');
  if (longPerf && shortPerf && longPerf.trades >= 2 && shortPerf.trades >= 2) {
    if (longPerf.pnl > shortPerf.pnl + Math.abs(shortPerf.pnl) * 0.5) {
      patterns.push({
        title: 'Long bias detected',
        detail: `Long trades (${money(longPerf.pnl)}) significantly outperform short trades (${money(shortPerf.pnl)}). You may have a directional bias to explore.`,
        type: 'neutral',
      });
    } else if (shortPerf.pnl > longPerf.pnl + Math.abs(longPerf.pnl) * 0.5) {
      patterns.push({
        title: 'Short bias detected',
        detail: `Short trades (${money(shortPerf.pnl)}) significantly outperform long trades (${money(longPerf.pnl)}). You may have a directional bias to explore.`,
        type: 'neutral',
      });
    }
  }

  // Strategy performance
  const stratData = groupByStrategy(trades).filter(s => s.trades >= 2);
  const bestStrat = [...stratData].sort((a, b) => b.pnl - a.pnl)[0];
  if (bestStrat && bestStrat.pnl > 0) {
    patterns.push({
      title: `Top strategy: ${bestStrat.strategy}`,
      detail: `${money(bestStrat.pnl)} over ${bestStrat.trades} trades with a ${formatPercent(bestStrat.winRate)} win rate.`,
      type: 'positive',
    });
  }

  // Session performance
  const sessionData = groupBySession(trades).filter(s => s.trades >= 2);
  const bestSession = [...sessionData].sort((a, b) => b.pnl - a.pnl)[0];
  if (bestSession && bestSession.pnl > 0) {
    patterns.push({
      title: `Best trading session: ${bestSession.session}`,
      detail: `${money(bestSession.pnl)} over ${bestSession.trades} trades with a ${formatPercent(bestSession.winRate)} win rate.`,
      type: 'positive',
    });
  }

  return patterns;
}

function buildComparison(current: DashboardStats, previous: DashboardStats, money: MoneyFormatter): ComparisonData {
  const deltas: Record<string, number> = {};
  (['totalPnl', 'totalTrades', 'winRate', 'avgWin', 'avgLoss', 'profitFactor', 'expectancy'] as const).forEach(key => {
    const cur = current[key];
    const prev = previous[key];
    deltas[key] = cur - prev;
  });

  return {
    current: {
      'Net P&L': money(current.totalPnl),
      'Trades': current.totalTrades,
      'Win Rate': formatPercent(current.winRate),
      'Avg Win': money(current.avgWin),
      'Avg Loss': money(current.avgLoss),
      'Profit Factor': current.profitFactor === Infinity ? '∞' : current.profitFactor.toFixed(2),
      'Expectancy': money(current.expectancy),
    },
    previous: {
      'Net P&L': money(previous.totalPnl),
      'Trades': previous.totalTrades,
      'Win Rate': formatPercent(previous.winRate),
      'Avg Win': money(previous.avgWin),
      'Avg Loss': money(previous.avgLoss),
      'Profit Factor': previous.profitFactor === Infinity ? '∞' : previous.profitFactor.toFixed(2),
      'Expectancy': money(previous.expectancy),
    },
    deltas,
  };
}

export function getPeriodTrades(
  trades: Trade[],
  date: Date,
  periodType: 'daily' | 'weekly' | 'monthly'
): { current: Trade[]; previous: Trade[] } {
  let currentStart: Date, currentEnd: Date, prevStart: Date, prevEnd: Date;

  if (periodType === 'daily') {
    currentStart = startOfDay(date);
    currentEnd = endOfDay(date);
    prevStart = startOfDay(subDays(date, 1));
    prevEnd = endOfDay(subDays(date, 1));
  } else if (periodType === 'weekly') {
    currentStart = startOfWeek(date, { weekStartsOn: 1 });
    currentEnd = endOfWeek(date, { weekStartsOn: 1 });
    prevStart = new Date(currentStart);
    prevStart.setDate(prevStart.getDate() - 7);
    prevEnd = new Date(currentEnd);
    prevEnd.setDate(prevEnd.getDate() - 7);
  } else {
    currentStart = startOfMonth(date);
    currentEnd = endOfMonth(date);
    prevStart = new Date(currentStart);
    prevStart.setMonth(prevStart.getMonth() - 1);
    prevEnd = endOfMonth(prevStart);
  }

  // Realized performance is attributed to the close day, like Risk Guardian.
  // Fall back to entry time for older closed records without a recorded close timestamp.
  const closed = trades.filter(trade => trade.status === 'closed');
  const current = closed.filter(trade => isWithinInterval(parseISO(trade.exit_time || trade.entry_time), {
    start: currentStart, end: currentEnd,
  }));
  const previous = closed.filter(trade => isWithinInterval(parseISO(trade.exit_time || trade.entry_time), {
    start: prevStart, end: prevEnd,
  }));

  return { current, previous };
}
