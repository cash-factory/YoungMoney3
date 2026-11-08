import type { Trade, PatternInsight, ComparisonData, DashboardStats } from './types';
import {
  computeDashboardStats, groupByPair, groupByDayOfWeek, groupByDirection, groupBySession, groupByStrategy,
  formatCurrency, formatPercent,
} from './utils';
import { parseISO, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';

export interface AIResult {
  summary: string;
  suggestions: string[];
  patterns: PatternInsight[];
  comparison: ComparisonData;
}

export function generateAISummary(
  currentTrades: Trade[],
  previousTrades: Trade[],
  periodType: 'daily' | 'weekly' | 'monthly'
): AIResult {
  const stats = computeDashboardStats(currentTrades);
  const prevStats = computeDashboardStats(previousTrades);

  // ---- Summary paragraph ----
  const summary = buildSummary(stats, currentTrades, periodType);

  // ---- Suggestions ----
  const suggestions = buildSuggestions(currentTrades, stats);

  // ---- Patterns ----
  const patterns = detectPatterns(currentTrades);

  // ---- Comparison ----
  const comparison = buildComparison(stats, prevStats);

  return { summary, suggestions, patterns, comparison };
}

function buildSummary(stats: DashboardStats, trades: Trade[], periodType: string): string {
  const periodLabel = periodType === 'daily' ? 'today' : periodType === 'weekly' ? 'this week' : 'this month';
  if (trades.length === 0) {
    return `No trades were logged ${periodLabel}. Use this time to review your trading plan and prepare for the next session.`;
  }

  const parts: string[] = [];
  parts.push(`You logged ${stats.totalTrades} trade${stats.totalTrades !== 1 ? 's' : ''} ${periodLabel} with a net result of ${formatCurrency(stats.totalPnl)}.`);
  parts.push(`Your win rate was ${formatPercent(stats.winRate)} (${stats.wins} win${stats.wins !== 1 ? 's' : ''}, ${stats.losses} loss${stats.losses !== 1 ? 'es' : ''}${stats.breakevens ? `, ${stats.breakevens} breakeven` : ''}).`);

  if (stats.avgWin > 0 && stats.avgLoss > 0) {
    parts.push(`Average win: ${formatCurrency(stats.avgWin)}, average loss: ${formatCurrency(stats.avgLoss)}.`);
  }

  if (stats.profitFactor !== Infinity && stats.profitFactor > 0) {
    parts.push(`Profit factor: ${stats.profitFactor.toFixed(2)}.`);
  }

  if (stats.currentStreak.type === 'win') {
    parts.push(`You are currently on a ${stats.currentStreak.count}-trade winning streak.`);
  } else if (stats.currentStreak.type === 'loss') {
    parts.push(`You are currently on a ${stats.currentStreak.count}-trade losing streak — consider stepping back to review.`);
  }

  if (stats.bestDay && stats.worstDay) {
    parts.push(`Best day: ${formatCurrency(stats.bestDay.pnl)}, worst day: ${formatCurrency(stats.worstDay.pnl)}.`);
  }

  return parts.join(' ');
}

function buildSuggestions(trades: Trade[], stats: DashboardStats): string[] {
  const suggestions: string[] = [];

  // Win rate analysis
  if (stats.winRate < 40 && stats.totalTrades >= 5) {
    suggestions.push('Your win rate is below 40%. Focus on higher-quality setups and consider waiting for A+ entries rather than forcing trades.');
  } else if (stats.winRate >= 60 && stats.totalTrades >= 5) {
    suggestions.push('Excellent win rate! Make sure your position sizing reflects this edge — consider scaling up on your highest-conviction setups.');
  }

  // Risk-reward
  if (stats.avgRiskReward > 0 && stats.avgRiskReward < 1 && stats.totalTrades >= 5) {
    suggestions.push('Your average risk-reward ratio is below 1:1. Even with a good win rate, this makes it hard to stay profitable. Aim for at least 1:2 R:R on new trades.');
  }

  // Emotional state patterns
  const emotionMap = new Map<string, { count: number; pnl: number }>();
  trades.forEach(t => {
    if (!t.emotional_state) return;
    const ex = emotionMap.get(t.emotional_state) || { count: 0, pnl: 0 };
    ex.count++;
    ex.pnl += t.pnl;
    emotionMap.set(t.emotional_state, ex);
  });
  emotionMap.forEach((v, emotion) => {
    if (v.count >= 3 && v.pnl < 0) {
      suggestions.push(`Trades taken while feeling "${emotion}" have lost ${formatCurrency(Math.abs(v.pnl))} across ${v.count} trades. Consider avoiding trading when in this emotional state.`);
    }
  });

  // Mistake frequency
  const mistakeMap = new Map<string, number>();
  trades.forEach(t => t.mistakes.forEach(m => mistakeMap.set(m, (mistakeMap.get(m) || 0) + 1)));
  mistakeMap.forEach((count, mistake) => {
    if (count >= 3) {
      suggestions.push(`"${mistake}" has been flagged ${count} times. This is a recurring issue — make it a primary focus to eliminate.`);
    }
  });

  // Overtrading
  if (stats.totalTrades >= 10) {
    suggestions.push('You took a high number of trades. Check if any were impulsive or outside your trading plan.');
  }

  // Setup quality vs outcome
  const lowQualityTrades = trades.filter(t => t.setup_quality != null && t.setup_quality <= 2);
  if (lowQualityTrades.length >= 3) {
    const lowQualityPnl = lowQualityTrades.reduce((s, t) => s + t.pnl, 0);
    if (lowQualityPnl < 0) {
      suggestions.push(`You took ${lowQualityTrades.length} trades rated 1-2 stars, which lost ${formatCurrency(Math.abs(lowQualityPnl))}. Consider only taking 3+ star setups.`);
    }
  }

  // Session analysis
  const sessionData = groupBySession(trades);
  const bestSession = sessionData.filter(s => s.trades >= 3).sort((a, b) => b.pnl - a.pnl)[0];
  if (bestSession && bestSession.pnl > 0) {
    suggestions.push(`The ${bestSession.session} session is your most profitable (${formatCurrency(bestSession.pnl)} over ${bestSession.trades} trades). Consider focusing more of your activity here.`);
  }

  // Streak warning
  if (stats.currentStreak.type === 'loss' && stats.currentStreak.count >= 3) {
    suggestions.push(`You've lost ${stats.currentStreak.count} trades in a row. Reduce your risk per trade or take a break to reset mentally before the next entry.`);
  }

  if (suggestions.length === 0) {
    suggestions.push('Your trading looks disciplined. Keep maintaining your process and journaling consistently.');
  }

  return suggestions;
}

function detectPatterns(trades: Trade[]): PatternInsight[] {
  const patterns: PatternInsight[] = [];
  if (trades.length < 3) return patterns;

  // Best pair
  const pairData = groupByPair(trades).filter(p => p.trades >= 2);
  const bestPair = [...pairData].sort((a, b) => b.pnl - a.pnl)[0];
  const worstPair = [...pairData].sort((a, b) => a.pnl - b.pnl)[0];
  if (bestPair && bestPair.pnl > 0) {
    patterns.push({
      title: `Best performing pair: ${bestPair.pair}`,
      detail: `${formatCurrency(bestPair.pnl)} over ${bestPair.trades} trades with a ${formatPercent(bestPair.winRate)} win rate.`,
      type: 'positive',
    });
  }
  if (worstPair && worstPair.pnl < 0 && worstPair.pair !== bestPair?.pair) {
    patterns.push({
      title: `Worst performing pair: ${worstPair.pair}`,
      detail: `${formatCurrency(worstPair.pnl)} over ${worstPair.trades} trades with a ${formatPercent(worstPair.winRate)} win rate. Consider reducing activity on this pair.`,
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
      detail: `${formatCurrency(bestDay.pnl)} over ${bestDay.trades} trades.`,
      type: 'positive',
    });
  }
  if (worstDay && worstDay.pnl < 0 && worstDay.day !== bestDay?.day) {
    patterns.push({
      title: `Least profitable day: ${worstDay.day}`,
      detail: `${formatCurrency(worstDay.pnl)} over ${worstDay.trades} trades. Consider being more selective on this day.`,
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
        detail: `Long trades (${formatCurrency(longPerf.pnl)}) significantly outperform short trades (${formatCurrency(shortPerf.pnl)}). You may have a directional bias to explore.`,
        type: 'neutral',
      });
    } else if (shortPerf.pnl > longPerf.pnl + Math.abs(longPerf.pnl) * 0.5) {
      patterns.push({
        title: 'Short bias detected',
        detail: `Short trades (${formatCurrency(shortPerf.pnl)}) significantly outperform long trades (${formatCurrency(longPerf.pnl)}). You may have a directional bias to explore.`,
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
      detail: `${formatCurrency(bestStrat.pnl)} over ${bestStrat.trades} trades with a ${formatPercent(bestStrat.winRate)} win rate.`,
      type: 'positive',
    });
  }

  // Session performance
  const sessionData = groupBySession(trades).filter(s => s.trades >= 2);
  const bestSession = [...sessionData].sort((a, b) => b.pnl - a.pnl)[0];
  if (bestSession && bestSession.pnl > 0) {
    patterns.push({
      title: `Best trading session: ${bestSession.session}`,
      detail: `${formatCurrency(bestSession.pnl)} over ${bestSession.trades} trades with a ${formatPercent(bestSession.winRate)} win rate.`,
      type: 'positive',
    });
  }

  return patterns;
}

function buildComparison(current: DashboardStats, previous: DashboardStats): ComparisonData {
  const deltas: Record<string, number> = {};
  (['totalPnl', 'totalTrades', 'winRate', 'avgWin', 'avgLoss', 'profitFactor', 'expectancy'] as const).forEach(key => {
    const cur = current[key];
    const prev = previous[key];
    deltas[key] = cur - prev;
  });

  return {
    current: {
      'Net P&L': formatCurrency(current.totalPnl),
      'Trades': current.totalTrades,
      'Win Rate': formatPercent(current.winRate),
      'Avg Win': formatCurrency(current.avgWin),
      'Avg Loss': formatCurrency(current.avgLoss),
      'Profit Factor': current.profitFactor === Infinity ? '∞' : current.profitFactor.toFixed(2),
      'Expectancy': formatCurrency(current.expectancy),
    },
    previous: {
      'Net P&L': formatCurrency(previous.totalPnl),
      'Trades': previous.totalTrades,
      'Win Rate': formatPercent(previous.winRate),
      'Avg Win': formatCurrency(previous.avgWin),
      'Avg Loss': formatCurrency(previous.avgLoss),
      'Profit Factor': previous.profitFactor === Infinity ? '∞' : previous.profitFactor.toFixed(2),
      'Expectancy': formatCurrency(previous.expectancy),
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
    currentStart = date;
    currentEnd = date;
    prevStart = new Date(date);
    prevStart.setDate(prevStart.getDate() - 1);
    prevEnd = prevStart;
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

  const current = trades.filter(t => {
    const d = parseISO(t.entry_time);
    return isWithinInterval(d, { start: currentStart, end: currentEnd });
  });
  const previous = trades.filter(t => {
    const d = parseISO(t.entry_time);
    return isWithinInterval(d, { start: prevStart, end: prevEnd });
  });

  return { current, previous };
}
