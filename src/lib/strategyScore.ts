import { getExecutionMetrics } from './executionMetrics';
import type { Trade } from './types';

export interface StrategyScore {
  strategy: string;
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  expectancy: number;
  avgRiskReward: number;
  consistency: number;
  score: number;
  grade: string;
  pnl: number;
  wins: number;
  losses: number;
  bestPair: string | null;
  bestSession: string | null;
  flags: string[];
  edgeRating: 'elite' | 'strong' | 'developing' | 'weak' | 'untested';
}

const GRADE_THRESHOLDS = [
  { min: 85, grade: 'A+' },
  { min: 75, grade: 'A' },
  { min: 65, grade: 'B+' },
  { min: 55, grade: 'B' },
  { min: 45, grade: 'C+' },
  { min: 35, grade: 'C' },
  { min: 25, grade: 'D' },
  { min: 0, grade: 'F' },
];

function gradeForScore(score: number): string {
  return GRADE_THRESHOLDS.find(t => score >= t.min)?.grade ?? 'F';
}

function edgeRatingForScore(score: number, sampleSize: number): StrategyScore['edgeRating'] {
  if (sampleSize < 5) return 'untested';
  if (score >= 75) return 'elite';
  if (score >= 55) return 'strong';
  if (score >= 35) return 'developing';
  return 'weak';
}

function calcConsistency(trades: Trade[]): number {
  if (trades.length < 3) return 0;
  const pnls = trades.map(t => t.pnl);
  const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
  const variance = pnls.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / pnls.length;
  const stdDev = Math.sqrt(variance);
  if (mean === 0) return 0;
  const cv = stdDev / Math.abs(mean);
  // Lower coefficient of variation = higher consistency. Clamp 0-100.
  return Math.max(0, Math.min(100, 100 - cv * 25));
}

function findBestPair(trades: Trade[]): string | null {
  const map = new Map<string, number>();
  trades.forEach(t => {
    if (t.status !== 'closed') return;
    map.set(t.pair, (map.get(t.pair) || 0) + t.pnl);
  });
  if (map.size === 0) return null;
  let best: string | null = null;
  let bestPnl = -Infinity;
  map.forEach((pnl, pair) => {
    if (pnl > bestPnl) { bestPnl = pnl; best = pair; }
  });
  return best;
}

function findBestSession(trades: Trade[]): string | null {
  const map = new Map<string, number>();
  trades.forEach(t => {
    if (t.status !== 'closed' || !t.session) return;
    map.set(t.session, (map.get(t.session) || 0) + t.pnl);
  });
  if (map.size === 0) return null;
  let best: string | null = null;
  let bestPnl = -Infinity;
  map.forEach((pnl, session) => {
    if (pnl > bestPnl) { bestPnl = pnl; best = session; }
  });
  return best;
}

function detectFlags(
  trades: Trade[],
  winRate: number,
  profitFactor: number,
  expectancy: number,
  avgRR: number,
  consistency: number,
): string[] {
  const flags: string[] = [];

  if (winRate >= 70 && expectancy < 0) {
    flags.push('High win rate but negative expectancy — small wins, big losses');
  }
  if (profitFactor < 1 && trades.length >= 5) {
    flags.push('Profit factor below 1.0 — losing money overall');
  }
  if (avgRR > 0 && avgRR < 1 && trades.length >= 5) {
    flags.push('Average R:R below 1:1 — risk exceeds reward');
  }
  if (consistency < 30 && trades.length >= 5) {
    flags.push('Highly inconsistent results — large performance swings');
  }
  const wins = trades.filter(t => t.outcome === 'win');
  if (wins.length === 1 && trades.length >= 5) {
    const singleWinPnl = wins[0].pnl;
    const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
    if (singleWinPnl > 0 && totalPnl > 0 && singleWinPnl / totalPnl > 0.8) {
      flags.push('Profitability depends on a single lucky trade');
    }
  }
  if (trades.length < 5) {
    flags.push('Sample size too small for reliable analysis');
  }
  return flags;
}

export function scoreStrategy(strategyName: string, trades: Trade[]): StrategyScore {
  const strategyTrades = trades.filter(t => t.strategy === strategyName && t.status === 'closed');
  const totalTrades = strategyTrades.length;
  const wins = strategyTrades.filter(t => t.outcome === 'win');
  const losses = strategyTrades.filter(t => t.outcome === 'loss');
  const pnl = strategyTrades.reduce((s, t) => s + t.pnl, 0);
  const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;

  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? Infinity : 0) : grossProfit / grossLoss;

  const expectancy = totalTrades > 0 ? pnl / totalTrades : 0;
  const rrTrades = strategyTrades.map(getExecutionMetrics).map(metrics=>metrics.realized_r).filter((r):r is number=>r!=null);
  const avgRiskReward = rrTrades.length > 0
    ? rrTrades.reduce((sum,r)=>sum+r,0) / rrTrades.length
    : 0;
  const consistency = calcConsistency(strategyTrades);

  // Scoring algorithm — weights designed to reward edge, not just surface metrics
  let score = 0;

  // 1. Profit factor (0-30 pts) — cap at 3.0 for scoring
  const pfCapped = Math.min(profitFactor === Infinity ? 3 : profitFactor, 3);
  score += (pfCapped / 3) * 30;

  // 2. Expectancy (0-20 pts) — positive expectancy is essential
  if (expectancy > 0) {
    score += Math.min(expectancy / 50, 1) * 20;
  }

  // 3. Win rate (0-15 pts) — weighted less than PF because WR alone is misleading
  score += (winRate / 100) * 15;

  // 4. Average R:R (0-15 pts) — reward good reward-to-risk
  const rrCapped = Math.min(avgRiskReward, 3);
  score += (rrCapped / 3) * 15;

  // 5. Consistency (0-10 pts)
  score += (consistency / 100) * 10;

  // 6. Sample size confidence (0-10 pts) — full confidence at 20+ trades
  const sampleConfidence = Math.min(totalTrades / 20, 1);
  score += sampleConfidence * 10;

  score = Math.round(Math.max(0, Math.min(100, score)));

  const flags = detectFlags(strategyTrades, winRate, profitFactor, expectancy, avgRiskReward, consistency);
  const bestPair = findBestPair(strategyTrades);
  const bestSession = findBestSession(strategyTrades);

  return {
    strategy: strategyName,
    totalTrades,
    winRate,
    profitFactor,
    expectancy,
    avgRiskReward,
    consistency,
    score,
    grade: gradeForScore(score),
    pnl,
    wins: wins.length,
    losses: losses.length,
    bestPair,
    bestSession,
    flags,
    edgeRating: edgeRatingForScore(score, totalTrades),
  };
}

export function scoreAllStrategies(trades: Trade[]): StrategyScore[] {
  const strategies = new Set<string>();
  trades.forEach(t => {
    if (t.strategy) strategies.add(t.strategy);
  });
  return Array.from(strategies)
    .map(name => scoreStrategy(name, trades))
    .sort((a, b) => b.score - a.score);
}
