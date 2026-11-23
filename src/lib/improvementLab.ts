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
  /** An optional, owner-verified Decision Replay record that motivated this experiment. */
  source_reference?: string | null;
  metric: ExperimentMetric;
  start_date: string;
  end_date: string | null;
  baseline_days: number;
  minimum_samples: number;
  status: ExperimentStatus;
  conclusion: string;
  created_at: string;
  updated_at: string;
  /** Server-issued timestamp when the hypothesis was first locked. Older studies may lack this. */
  activated_at?: string | null;
}
export type ImprovementExperimentInput = Omit<ImprovementExperiment,
  'id' | 'user_id' | 'created_at' | 'updated_at' | 'activated_at'>;
/** Standalone evidence shape so financial calculations stay usable in Workers and the browser. */
type Review = {
  id: string;
  reference?: string;
  entry_time: string;
  strategy_id: string | null;
  account_id: string | null;
  verdict: 'followed' | 'changed' | 'unsure' | null;
  pre_reveal_verdict?: 'followed' | 'changed' | 'unsure' | null;
  pre_reveal_at?: string | null;
};
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
  excluded_intervention: number;
  prospective: boolean;
  limitations: string[];
}
export function validStudyDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + 'T00:00:00Z')) &&
    new Date(value + 'T00:00:00Z').toISOString().startsWith(value);
}
export function validateExperiment(input: ImprovementExperimentInput): string | null {
  if (typeof input.title !== 'string' || input.title.trim().length < 3 || input.title.length > 100) return 'Give the experiment a title (3–100 characters).';
  if (typeof input.hypothesis !== 'string' || input.hypothesis.trim().length < 12 || input.hypothesis.length > 600) return 'Write a testable hypothesis (12–600 characters).';
  if (typeof input.single_change !== 'string' || input.single_change.trim().length < 8 || input.single_change.length > 500) return 'Define the single behavior or rule to change.';
  if (input.metric !== 'plan_adherence') return 'Choose a supported outcome measure.';
  if (input.source_reference != null &&
      (typeof input.source_reference !== 'string' ||
      input.source_reference.length > 300 ||
      !/^(?:trade\/[^/\s]{1,150}|position\/[^/\s]{1,150}\/\d+:\d+)$/.test(input.source_reference)))
    return 'Link a valid decision review or leave the originating observation empty.';
  if (!validStudyDate(input.start_date) || (input.end_date && (!validStudyDate(input.end_date) || input.end_date < input.start_date)))
    return 'Choose valid study dates; the end cannot precede the start.';
  if (!Number.isInteger(input.baseline_days) || input.baseline_days < 7 || input.baseline_days > 365)
    return 'Baseline window must be between 7 and 365 days.';
  if (!Number.isInteger(input.minimum_samples) || input.minimum_samples < 5 || input.minimum_samples > 500)
    return 'Minimum evidence must be 5–500 decisions per period.';
  if (!['draft','active','completed'].includes(input.status)) return 'Invalid experiment status.';
  if (typeof input.conclusion !== 'string' || input.conclusion.length > 3000) return 'Keep conclusions under 3,000 characters.';
  if (input.status === 'completed' && input.conclusion.trim().length < 20) return 'Complete the study with a considered conclusion of at least 20 characters.';
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
  const end = Math.min(Date.now() + 1,
    study.end_date ? Date.parse(study.end_date + 'T00:00:00Z') + 86400000 : Infinity);
  const activation = study.activated_at ? Date.parse(study.activated_at) : NaN;
  const prospective = Number.isFinite(activation) && study.status !== 'draft';
  let excluded_intervention = 0;
  // A broker position lifecycle and manual trade reference each represent one decision.
  // If the transport supplies multiple revisions, the latest version wins.
  const unique = new Map<string, Review>();
  for (const review of reviews) {
    const key = review.reference || review.id;
    const current = unique.get(key);
    if (!current || (Date.parse(review.pre_reveal_at || '') || 0) >=
      (Date.parse(current.pre_reveal_at || '') || 0)) unique.set(key, review);
  }
  for (const review of unique.values()) {
    if (study.strategy_id && study.strategy_id !== review.strategy_id) continue;
    if (study.account_id && study.account_id !== review.account_id) continue;
    const at = Date.parse(review.entry_time);
    if (!Number.isFinite(at)) continue;
    const before = at >= baselineStart && at < start;
    const after = at >= start && at < end;
    if (!before && !after) continue;
    if (after && prospective) {
      const preRevealTime = Date.parse(review.pre_reveal_at || '');
      // Prospective claims require BOTH the original entry and the sealed assessment
      // to occur after the intervention was activated on the server.
      if (at < activation || !Number.isFinite(preRevealTime) || preRevealTime < activation) {
        excluded_intervention++;
        continue;
      }
    }
    const target = before ? baseline : intervention;
    const sealed = Boolean(review.pre_reveal_verdict && review.pre_reveal_at);
    const verdict = sealed ? review.pre_reveal_verdict : review.verdict;
    if (verdict === 'followed') target.followed++;
    else if (verdict === 'changed') target.changed++;
    else target.uncertain++;
    if (verdict === 'followed' || verdict === 'changed') {
      target.eligible++;
      if (sealed) target.pre_reveal++;
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
  if (!prospective) limitations.push('No verifiable server activation time is available. This draft or legacy study is exploratory and cannot support prospective claims.');
  if (excluded_intervention)
    limitations.push(excluded_intervention + ' intervention reviews were excluded because they were retrospective or predated study activation.');
  if (baseline.retrospective + intervention.retrospective)
    limitations.push('Some decisions were reviewed retrospectively; their original pre-outcome judgement is unavailable.');
  if (baseline.uncertain + intervention.uncertain)
    limitations.push('Uncertain or unreviewed decisions are excluded from the adherence percentage.');
  if (!enough_evidence)
    limitations.push('The selected minimum sample count has not been met in both periods.');
  return {
    baseline, intervention,
    percentage_point_change: baseline.adherence == null || intervention.adherence == null
      ? null : intervention.adherence - baseline.adherence,
    enough_evidence, excluded_intervention, prospective, limitations,
  };
}
