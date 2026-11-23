import type { Trade } from './types.ts';
import type { DecisionReview } from './decisionReplay.ts';

export type PatternWindow = '90d' | 'all';
export type PatternAssessment = 'pre-reveal' | 'retrospective';
export type PatternVerdict = 'followed' | 'changed' | 'unsure';
export type PatternCategory = { label: string; count: number; share: number };
export type PatternWeek = { start: string; followed: number; changed: number; unknown: number; rate: number | null };
export type PatternMetric = { numerator: number; denominator: number; rate: number | null; sufficient: boolean; interval: [number,number] | null };
export interface SetupAdherence { label: string; reviewed: number; followed: number; changed: number;
  sealed: number; retrospective: number; rate: number | null; sufficient: boolean; }
export interface TradingPatternReport {
  reviewed: number;
  assessable: number;
  preReveal: number;
  retrospective: number;
  importedUnverified: number;
  unknown: number;
  plan: PatternMetric;
  checklist: PatternMetric;
  afterLoss: PatternMetric & { examined: number };
  setups: PatternCategory[];
  setupAdherence: SetupAdherence[];
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
  // Approximate Wilson 95% score interval for a Bernoulli proportion.
  // Interpretation depends on independent observations, which successive trades may violate.
  let interval: [number,number] | null = null;
  if (denominator >= minimum) {
    const p = numerator / denominator, z=1.96, z2=z*z;
    const center = (p+z2/(2*denominator))/(1+z2/denominator);
    const margin = z*Math.sqrt((p*(1-p)+z2/(4*denominator))/denominator)/(1+z2/denominator);
    interval=[100*Math.max(0,center-margin),100*Math.min(1,center+margin)];
  }
  return {
    numerator, denominator, rate: denominator ? 100 * numerator / denominator : null,
    sufficient: denominator >= minimum, interval,
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
  return !row.imported_unverified && row.pre_reveal_at && row.pre_reveal_verdict
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
  const preReveal = rows.filter(row => Boolean(!row.imported_unverified && row.pre_reveal_at && row.pre_reveal_verdict)).length;
  const importedUnverified=rows.filter(row=>row.imported_unverified).length;

  const bySetup = new Map<string, number>();
  const bySetupAdherence = new Map<string, { followed: number; changed: number; sealed: number; retrospective: number }>();
  const byTrigger = new Map<string, number>();
  const byEmotion = new Map<string, number>();
  for (const review of rows) {
    const name = (review.model_name || review.strategy_name || '').trim();
    if (name) {
      const label=name.slice(0,80);
      add(bySetup,label);
      const previous=bySetupAdherence.get(label)||{followed:0,changed:0,sealed:0,retrospective:0};
      const verdict=evidenceVerdict(review);
      if(verdict==='followed'||verdict==='changed') {
        previous[verdict]++;
        if(!review.imported_unverified && review.pre_reveal_verdict && review.pre_reveal_at) previous.sealed++;
        else previous.retrospective++;
      }
      bySetupAdherence.set(label,previous);
    }
    if (review.trigger?.trim()) add(byTrigger, review.trigger.trim().slice(0, 80));
  }

  const manual = trades.filter(trade =>
    trade.trade_source !== 'mt5' && belongs(trade.account_id) && inWindow(trade.entry_time)
  );
  let checked = 0, recordedChecklist = 0;
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
  }

  // Loss-following context comes only from dated, same-account manual close evidence.
  // Index once by account and sort by exit time; individual decisions use binary
  // search instead of scanning every previous trade (important for 10k+ histories).
  const manualById = new Map(manual.map(trade => [trade.id, trade]));
  type PriorLoss = { id: string; exit: number };
  const lossIndex = new Map<string, PriorLoss[]>();
  for (const trade of manual) {
    const exit = safeTime(trade.exit_time);
    if (trade.status!=='closed' || !trade.account_id || exit===null ||
        exit>now || !Number.isFinite(trade.pnl) || trade.pnl>=0) continue;
    const group = lossIndex.get(trade.account_id) || [];
    group.push({ id:trade.id, exit });
    lossIndex.set(trade.account_id,group);
  }
  for (const group of lossIndex.values()) group.sort((a,b)=>a.exit-b.exit);
  let afterLossSeen = 0, afterLossFollowed = 0;
  for (const review of assessable) {
    const entryTime = safeTime(review.entry_time);
    if (!review.account_id || entryTime === null || !review.reference.startsWith('trade/')) continue;
    const reviewedTrade = manualById.get(review.reference.slice(6));
    if (!reviewedTrade || reviewedTrade.account_id!==review.account_id) continue;
    const losses = lossIndex.get(review.account_id) || [];
    let lo=0,hi=losses.length;
    while(lo<hi){
      const mid=(lo+hi)>>>1;
      if(losses[mid].exit<entryTime) lo=mid+1;
      else hi=mid;
    }
    let index=lo-1;
    while(index>=0 && losses[index].id===reviewedTrade.id) index--;
    if(index<0 || entryTime-losses[index].exit>24*3600000) continue;
    afterLossSeen++;
    if (evidenceVerdict(review) === 'followed') afterLossFollowed++;
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
  if (importedUnverified)
    limitations.push(importedUnverified+' restored reviews are historical self-reports; their pre-reveal timestamps are not server-verified.');
  if (rows.length - assessable.length)
    limitations.push('Unknown assessments are excluded from adherence percentages, but remain in the displayed counts.');
  if (recordedChecklist === 0)
    limitations.push('No qualifying, immutable opening-time checklist snapshots exist in this selection.');
  if (afterLossSeen < minimum)
    limitations.push('There are too few documented loss-following decisions to describe a reliable pattern.');
  return {
    reviewed: rows.length, assessable: assessable.length, preReveal,
    retrospective: rows.length - preReveal, importedUnverified, unknown,
    plan: metric(adhered, assessable.length, minimum),
    checklist: metric(checked, recordedChecklist, minimum),
    afterLoss: { ...metric(afterLossFollowed, afterLossSeen, minimum), examined: afterLossSeen },
    setups: percentages(bySetup),
    setupAdherence:[...bySetupAdherence].map(([label,row]):SetupAdherence=>{
      const reviewed=row.followed+row.changed;
      return {label,reviewed,followed:row.followed,changed:row.changed,
        sealed:row.sealed,retrospective:row.retrospective,rate:reviewed?100*row.followed/reviewed:null,
        sufficient:reviewed>=Math.max(5,Math.min(minimum,12))};
    }).sort((a,b)=>b.reviewed-a.reviewed||a.label.localeCompare(b.label)),
    emotions: percentages(byEmotion),
    triggers: percentages(byTrigger),
    weeks,
    sources: { originalChecklists: recordedChecklist, journalEmotions: [...byEmotion.values()].reduce((a,b)=>a+b,0),
      documentedLossSequences: afterLossSeen },
    limitations,
  };
}
