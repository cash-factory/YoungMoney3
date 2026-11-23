import type { DecisionReview } from './decisionReplay.ts';

/** No prices or P&L are used as evidence of behavioural change. */
export type ExperimentStatus = 'draft' | 'active' | 'completed';
export type ExperimentMetric = 'plan_adherence';
export interface ImprovementExperiment {
  id: string;
  user_id: string;
  title: string;
  hypothesis: string;
  single_change: string;
  strategy_id: string | null;
  account_id: string | null;
  metric: ExperimentMetric;
  start_date: string;
  end_date: string | null;
  baseline_days: number;
  minimum_samples: number;
  status: ExperimentStatus;
  conclusion: string;
  created_at: string;
  updated_at: string;
}
export type ImprovementExperimentInput = Omit<ImprovementExperiment,
  'id' | 'user_id' | 'created_at' | 'updated_at'>;
type Review = Pick<DecisionReview, 'id' | 'entry_time' | 'strategy_id' | 'account_id' |
  'verdict' | 'pre_reveal_verdict' | 'pre_reveal_at'>;
export interface ExperimentPeriod {
  eligible: number;
  followed: number;
  changed: number;
  uncertain: number;
  pre_reveal: number;
  retrospective: number;
  adherence: number | null;
}
export interface ExperimentEvidence {
  baseline: ExperimentPeriod;
  intervention: ExperimentPeriod;
  percentage_point_change: number | null;
  enough_evidence: boolean;
  limitations: string[];
}
export function validStudyDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + 'T00:00:00Z')) &&
    new Date(value + 'T00:00:00Z').toISOString().startsWith(value);
}
export function validateExperiment(input: ImprovementExperimentInput): string | null {
  if (input.title.trim().length < 3 || input.title.length > 100) return 'Give the experiment a title (3–100 characters).';
  if (input.hypothesis.trim().length < 12 || input.hypothesis.length > 600) return 'Write a testable hypothesis (12–600 characters).';
  if (input.single_change.trim().length < 8 || input.single_change.length > 500) return 'Define the single behavior or rule to change.';
  if (input.metric !== 'plan_adherence') return 'Choose a supported outcome measure.';
  if (!validStudyDate(input.start_date) || (input.end_date && (!validStudyDate(input.end_date) || input.end_date < input.start_date)))
    return 'Choose valid study dates; the end cannot precede the start.';
  if (!Number.isInteger(input.baseline_days) || input.baseline_days < 7 || input.baseline_days > 365)
    return 'Baseline window must be between 7 and 365 days.';
  if (!Number.isInteger(input.minimum_samples) || input.minimum_samples < 5 || input.minimum_samples > 500)
    return 'Minimum evidence must be 5–500 decisions per period.';
  if (!['draft','active','completed'].includes(input.status)) return 'Invalid experiment status.';
  if (input.conclusion.length > 3000) return 'Keep conclusions under 3,000 characters.';
  return null;
}
const empty = (): ExperimentPeriod => ({
  eligible: 0, followed: 0, changed: 0, uncertain: 0,
  pre_reveal: 0, retrospective: 0, adherence: null,
});

export function evaluateExperiment(study: ImprovementExperiment, reviews: Review[]): ExperimentEvidence {
  const baseline = empty(), intervention = empty();
  const start = Date.parse(study.start_date + 'T00:00:00Z');
  const baselineStart = start - study.baseline_days * 86400000;
  // Inclusive through the last UTC day, so a chosen end date is not cut short.
  const end = study.end_date ? Date.parse(study.end_date + 'T00:00:00Z') + 86400000 : Infinity;
  // Reviews may update, but one trade reference is one decision. Latest review wins.
  const seen = new Set<string>();
  for (const review of reviews) {
    if (seen.has(review.id)) continue;
    seen.add(review.id);
    if (study.strategy_id && study.strategy_id !== review.strategy_id) continue;
    if (study.account_id && study.account_id !== review.account_id) continue;
    const at = Date.parse(review.entry_time);
    if (!Number.isFinite(at)) continue;
    const target = at >= baselineStart && at < start ? baseline
      : at >= start && at < end ? intervention : null;
    if (!target) continue;
    const verdict = review.pre_reveal_verdict || review.verdict;
    if (verdict === 'followed') target.followed++;
    else if (verdict === 'changed') target.changed++;
    else target.uncertain++;
    if (verdict === 'followed' || verdict === 'changed') {
      target.eligible++;
      if (review.pre_reveal_verdict && review.pre_reveal_at) target.pre_reveal++;
      else target.retrospective++;
    }
  }
  for (const period of [baseline, intervention])
    period.adherence = period.eligible ? 100 * period.followed / period.eligible : null;
  const enough_evidence = baseline.eligible >= study.minimum_samples &&
    intervention.eligible >= study.minimum_samples;
  const limitations = [
    'Before-and-after observations do not establish causation. Market conditions and trader behavior may also change.',
    'The measure is trader-reported plan adherence, not verified strategy profitability.',
  ];
  if (baseline.retrospective + intervention.retrospective > 0)
    limitations.push('Some decisions were reviewed retrospectively; their original pre-outcome judgement is unavailable.');
  if (baseline.uncertain + intervention.uncertain > 0)
    limitations.push('Uncertain or unreviewed decisions are excluded from the adherence percentage.');
  if (!enough_evidence)
    limitations.push('The selected minimum sample count has not been met in both periods.');
  return {
    baseline, intervention,
    percentage_point_change: baseline.adherence == null || intervention.adherence == null
      ? null : intervention.adherence - baseline.adherence,
    enough_evidence, limitations,
  };
}
