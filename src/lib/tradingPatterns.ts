import type { Trade } from './types.ts';
import type { DecisionReview } from './decisionReplay.ts';

export type PatternWindow = '90d' | 'all';
export type PatternAssessment = 'pre-reveal' | 'retrospective';
export type PatternVerdict = 'followed' | 'changed' | 'unsure';
export type PatternCategory = { label: string; count: number; share: number };
export type PatternWeek = { start: string; followed: number; changed: number; unknown: number; rate: number | null };
export type PatternMetric = { numerator: number; denominator: number; rate: number | null; sufficient: boolean };
export interface TradingPatternReport {
  reviewed: number;
  assessable: number;
  preReveal: number;
  retrospective: number;
  unknown: number;
  plan: PatternMetric;
  checklist: PatternMetric;
  afterLoss: PatternMetric & { examined: number };
  setups: PatternCategory[];
  emotions: PatternCategory[];
  triggers: PatternCategory[];
  weeks: PatternWeek[];
  sources: { originalChecklists: number; journalEmotions: number; documentedLossSequences: number };
  limitations: string[];
}
export interface PatternOptions {
  accountId?: string | null;
  window?: PatternWindow;
  now?: string;
  minimum?: number;
}

function safeTime(value: string | null | undefined): number | null {
  const n = Date.parse(value || '');
  return Number.isFinite(n) ? n : null;
}
function metric(numerator: number, denominator: number, minimum: number): PatternMetric {
  return {
    numerator, denominator, rate: denominator ? 100 * numerator / denominator : null,
    sufficient: denominator >= minimum,
  };
}
function percentages(data: Map<string, number>): PatternCategory[] {
  const total = [...data.values()].reduce((sum, n) => sum + n, 0);
  return [...data.entries()].map(([label, count]) => ({
    label, count, share: total ? 100 * count / total : 0,
  })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
function add(map: Map<string, number>, name: string) {
  map.set(name, (map.get(name) || 0) + 1);
}
function mondayUTC(value: number) {
  const day = new Date(value);
  const weekday = day.getUTCDay();
  day.setUTCDate(day.getUTCDate() - (weekday + 6) % 7);
  return day.toISOString().slice(0, 10);
}
function evidenceVerdict(row: DecisionReview): PatternVerdict | null {
  return row.pre_reveal_at && row.pre_reveal_verdict
    ? row.pre_reveal_verdict : row.verdict;
}

/**
 * Descriptive, personal evidence only. No inference of emotion, causality, or profit expectancy.
 * Broker fill rows are excluded from manual entry snapshots to avoid double-counting lifecycles.
 */
export function buildTradingPatterns(
  trades: Trade[],
  reviews: DecisionReview[],
  options: PatternOptions = {},
): TradingPatternReport {
  const now = safeTime(options.now) ?? Date.now();
  const earliest = options.window === 'all' ? -Infinity : now - 90 * 86400000;
  const minimum = Math.max(3, options.minimum ?? 12);
  const accountId = options.accountId && options.accountId !== 'all' ? options.accountId : null;
  const inWindow = (value: string | null | undefined) => {
    const at = safeTime(value);
    return at !== null && at <= now && at >= earliest;
  };
  const belongs = (value: string | null | undefined) => !accountId || value === accountId;

  const unique = new Map<string, DecisionReview>();
  for (const row of reviews) {
    if (!row.reference || !belongs(row.account_id) || !inWindow(row.entry_time)) continue;
    const current = unique.get(row.reference);
    // Duplicate versions, if ever returned, must not inflate a person's evidence count.
    if (!current || (safeTime(row.updated_at) ?? 0) > (safeTime(current.updated_at) ?? 0))
      unique.set(row.reference, row);
  }
  const rows = [...unique.values()];
  const assessable = rows.filter(row => ['followed', 'changed'].includes(evidenceVerdict(row) || ''));
  const adhered = assessable.filter(row => evidenceVerdict(row) === 'followed').length;
  const unknown = rows.length - assessable.length;
  const preReveal = rows.filter(row => Boolean(row.pre_reveal_at && row.pre_reveal_verdict)).length;

  const bySetup = new Map<string, number>();
  const byTrigger = new Map<string, number>();
  const byEmotion = new Map<string, number>();
  for (const review of rows) {
    const name = (review.model_name || review.strategy_name || '').trim();
    if (name) add(bySetup, name.slice(0, 80));
    if (review.trigger?.trim()) add(byTrigger, review.trigger.trim().slice(0, 80));
  }

  const manual = trades.filter(trade =>
    trade.trade_source !== 'mt5' && belongs(trade.account_id) && inWindow(trade.entry_time)
  );
  let checked = 0, recordedChecklist = 0, completed = 0;
  for (const trade of manual) {
    // Only the immutable opening snapshot qualifies as documented execution evidence.
    const entry = trade.decision_entry;
    if (entry?.originally_open && entry.capture_mode === 'live' && Array.isArray(entry.checklist_items)) {
      const required = entry.checklist_items.filter(item => item.is_required);
      if (required.length) {
        recordedChecklist++;
        checked += required.filter(item => item.checked).length === required.length ? 1 : 0;
      }
    }
    if (trade.emotional_state) add(byEmotion, trade.emotional_state);
    if (trade.status === 'closed' && trade.exit_time) completed++;
  }

  // "Following a documented loss" describes order of recorded events, not a trader's emotional response.
  const losses = manual.filter(trade =>
    trade.status === 'closed' && Number.isFinite(trade.pnl) && trade.pnl < 0
    && trade.account_id && safeTime(trade.exit_time) !== null
    && (safeTime(trade.exit_time) ?? Infinity) <= now
  ).sort((a, b) => (safeTime(a.exit_time) ?? 0) - (safeTime(b.exit_time) ?? 0));
  let afterLossSeen = 0, afterLossFollowed = 0;
  for (const review of assessable) {
    const entryTime = safeTime(review.entry_time);
    // Only manual trade references are joined; an imported broker fill isn't an MT5 position lifecycle.
    if (!review.account_id || entryTime === null || !review.reference.startsWith('trade/')) continue;
    const reviewedTrade = manual.find(trade => review.reference === 'trade/' + trade.id);
    if (!reviewedTrade) continue;
    const preceding = losses.filter(t =>
      t.id !== reviewedTrade.id && t.account_id === review.account_id
      && (safeTime(t.exit_time) ?? Infinity) < entryTime
      && entryTime - (safeTime(t.exit_time) ?? 0) <= 24 * 3600000
    ).at(-1);
    if (preceding) {
      afterLossSeen++;
      if (evidenceVerdict(review) === 'followed') afterLossFollowed++;
    }
  }

  const buckets = new Map<string, { followed: number; changed: number; unknown: number }>();
  for (const row of rows) {
    const date = safeTime(row.entry_time);
    if (date === null) continue;
    const key = mondayUTC(date);
    const group = buckets.get(key) || { followed: 0, changed: 0, unknown: 0 };
    const verdict = evidenceVerdict(row);
    if (verdict === 'followed') group.followed++;
    else if (verdict === 'changed') group.changed++;
    else group.unknown++;
    buckets.set(key, group);
  }
  const weeks = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b))
    .slice(-8).map(([start, week]) => ({
      start, ...week,
      rate: week.followed + week.changed >= 3
        ? 100 * week.followed / (week.followed + week.changed) : null,
    }));
  const limitations: string[] = [
    'These are descriptive records, not a psychological diagnosis or a prediction of trading performance.',
    'Self-reported plan adherence is not independently verified against every historical playbook rule.',
  ];
  if (preReveal < rows.length)
    limitations.push('Some reviews were entered or changed retrospectively; their judgement may reflect knowledge of the outcome.');
  if (rows.length - assessable.length)
    limitations.push('Unknown assessments are excluded from adherence percentages, but remain in the displayed counts.');
  if (recordedChecklist === 0)
    limitations.push('No qualifying, immutable opening-time checklist snapshots exist in this selection.');
  if (afterLossSeen < minimum)
    limitations.push('There are too few documented loss-following decisions to describe a reliable pattern.');
  return {
    reviewed: rows.length, assessable: assessable.length, preReveal,
    retrospective: rows.length - preReveal, unknown,
    plan: metric(adhered, assessable.length, minimum),
    checklist: metric(checked, recordedChecklist, minimum),
    afterLoss: { ...metric(afterLossFollowed, afterLossSeen, minimum), examined: afterLossSeen },
    setups: percentages(bySetup),
    emotions: percentages(byEmotion),
    triggers: percentages(byTrigger),
    weeks,
    sources: { originalChecklists: recordedChecklist, journalEmotions: [...byEmotion.values()].reduce((a,b)=>a+b,0),
      documentedLossSequences: afterLossSeen },
    limitations,
  };
}
