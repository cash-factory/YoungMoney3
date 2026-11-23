import type { Trade, TradingAccount, WeeklyReview } from './types.ts';
import type { Mt5PositionVersion } from '../hooks/useMt5Lifecycles.ts';
import { tradeCurrency } from './tradeFinance.ts';

export type ReplayTarget =
  | { kind: 'trade'; trade: Trade }
  | { kind: 'position'; position: Mt5PositionVersion };
export type Verdict = 'followed' | 'changed' | 'unsure';
export interface DecisionReview {
  id: string;
  reference: string;
  strategy_id: string | null;
  entry_model_id: string | null;
  strategy_name: string;
  model_name: string;
  verdict: Verdict | null;
  /** The first judgement recorded before this interface reveals the outcome. Immutable after insertion. */
  pre_reveal_verdict?: Verdict | null;
  pre_reveal_at?: string | null;
  post_outcome_note?: string | null;
  trigger: string;
  note: string;
  voice_note_url: string | null;
  screenshot_url: string | null;
  symbol: string;
  account_id: string | null;
  entry_time: string;
  updated_at: string;
  commitment_id: string | null;
  commitment_text: string;
  commitment_result: Verdict | null;
}
export interface HistoricalRules {
  strategy: string | null;
  model: string | null;
  modelVersion: string | null;
  plan: string | null;
  earliest: string | null;
  requireStop: boolean;
  riskLimit: number | null;
  checklist: string[];
  criteria: string | null;
}
export const EMPTY_RULES: HistoricalRules = {
  strategy: null,
  model: null,
  modelVersion: null,
  plan: null,
  earliest: null,
  requireStop: false,
  riskLimit: null,
  checklist: [],
  criteria: null,
};
export function referenceFor(target: ReplayTarget) {
  return target.kind === 'trade'
    ? 'trade/' + target.trade.id
    : 'position/' + target.position.link + '/' + target.position.lifecycle_id;
}
export function entryFacts(target: ReplayTarget) {
  if (target.kind === 'position') {
    const s = target.position.summary,
      first = s.entries?.[0];
    return {
      symbol: s.symbol,
      time: s.first_entry_at,
      price: s.initial_entry_price,
      direction: s.direction,
      account: target.position.account_id,
      source: 'MT5 opening fill',
      clock: s.capture_completeness?.session_status === 'confirmed',
      stop: first?.initial_sl_provenance === 'executed_open_order' ? first.initial_sl : null,
      stopSource: first?.initial_sl_provenance ?? s.initial_sl_provenance,
      risk:
        s.initial_sl_provenance === 'executed_open_order' && s.entries?.length === 1
          ? finite(s.initial_risk_pct)
          : null,
      checks: null,
      image: null,
      voice: null,
      note: null,
      strategyId: null,
      modelId: null,
      planId: null,
    };
  }
  const t = target.trade,
    e = t.decision_entry;
  const live = e?.capture_mode === 'live' && e.originally_open;
  return {
    symbol: t.pair,
    time: e?.entry_time ?? t.entry_time,
    price: e?.entry_price ?? t.entry_price,
    direction: e?.direction ?? t.direction,
    account: t.account_id || null,
    source:
      t.trade_source === 'mt5'
        ? 'MT5 journal fill'
        : live
          ? 'Manual entry capture'
          : 'Historical journal record',
    clock: t.trade_source !== 'mt5',
    stop: live ? e.stop_loss : null,
    stopSource: live ? 'journal' : 'unavailable',
    risk: live ? finite(e.risk_percent) : null,
    checks: live ? e.checklist_items : null,
    image: live ? e.entry_screenshot_url : null,
    voice: live ? e.entry_voice_note_url : null,
    note: live ? e.entry_note : null,
    strategyId: e ? e.strategy_id : t.strategy_id,
    modelId: e ? e.entry_model_id : t.entry_model_id,
    planId: e ? e.plan_id : t.plan_id,
  };
}
function finite(value: unknown) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
export interface Finding {
  state: 'met' | 'missed' | 'unknown';
  label: string;
  evidence: string;
}
export function evaluateEntry(facts: ReturnType<typeof entryFacts>, rules: HistoricalRules): Finding[] {
  const rows: Finding[] = [];
  if (rules.earliest) {
    const at = Date.parse(facts.time),
      known = facts.clock && Number.isFinite(at);
    const clock = known ? new Date(at).toISOString().slice(11, 16) : '';
    rows.push({
      state: !known ? 'unknown' : clock >= rules.earliest ? 'met' : 'missed',
      label: 'Entry time',
      evidence: known
        ? 'Entry ' + clock + ' UTC · earliest allowed ' + rules.earliest + ' UTC.'
        : 'Broker UTC conversion is unconfirmed.',
    });
  }
  if (rules.requireStop) {
    const stop = finite(facts.stop),
      price = finite(facts.price);
    const known = stop !== null && price !== null && stop > 0;
    const protectedSide = known && (facts.direction === 'long' ? stop < price : stop > price);
    rows.push({
      state: known
        ? protectedSide
          ? 'met'
          : 'missed'
        : facts.stopSource === 'journal'
          ? 'missed'
          : 'unknown',
      label: 'Protective stop at entry',
      evidence: known
        ? 'Opening price ' + price + ' · recorded stop ' + stop + '.'
        : facts.stopSource === 'first_observed'
          ? 'A stop was observed later. The opening order is unverified.'
          : facts.stopSource === 'journal'
            ? 'The original journal entry recorded no stop.'
            : 'Opening-stop evidence is unavailable.',
    });
  }
  if (rules.riskLimit !== null) {
    rows.push({
      state: facts.risk === null ? 'unknown' : facts.risk <= rules.riskLimit ? 'met' : 'missed',
      label: 'Initial risk against plan',
      evidence:
        facts.risk === null
          ? 'Initial risk percentage could not be established.'
          : 'Initial risk ' + facts.risk.toFixed(2) + '% · saved limit ' + rules.riskLimit + '%.',
    });
  }
  for (const item of facts.checks || []) {
    if (item.is_required === false) continue;
    rows.push({
      state: item.checked ? 'met' : 'missed',
      label: item.label,
      evidence: item.checked
        ? 'Marked complete in the original entry checklist.'
        : 'Left unchecked in the original entry checklist.',
    });
  }
  for (const label of rules.checklist)
    if (!(facts.checks || []).some((item) => item.label === label)) {
      rows.push({ state: 'unknown', label, evidence: 'The written rule has no recorded entry check.' });
    }
  if (!rows.length)
    rows.push({
      state: 'unknown',
      label: 'Entry criteria',
      evidence: 'No checkable rule or original checklist is available for this entry.',
    });
  return rows;
}
export function outcomeFacts(target: ReplayTarget, accounts: TradingAccount[]) {
  if (target.kind === 'position') {
    const s = target.position.summary;
    return {
      closed: s.status === 'closed',
      amount: finite(s.net_realized_profit),
      currency: s.settlement_currency,
      r: finite(s.final_realized_r),
      at: s.final_exit_at,
    };
  }
  const t = target.trade;
  return {
    closed: t.status === 'closed',
    amount: finite(t.pnl),
    currency: tradeCurrency(t, accounts),
    r: finite(t.realized_r),
    at: t.exit_time,
  };
}
export function reviewMoney(amount: number | null, currency?: string | null) {
  if (amount === null || !Number.isFinite(amount)) return 'Unavailable';
  return currency && /^[A-Z]{3}$/.test(currency)
    ? new Intl.NumberFormat(undefined, { style: 'currency', currency, currencyDisplay: 'code' }).format(
        amount
      )
    : amount.toLocaleString(undefined, { maximumFractionDigits: 4 }) + ' · currency unconfirmed';
}
export function visibleJournalTrades(trades: Trade[], positions: Mt5PositionVersion[]) {
  const exact = new Set(positions.map((p) => p.link + '/' + p.summary.position_id));
  return trades.filter(
    (t) =>
      t.trade_source !== 'mt5' ||
      !t.broker_details?.position_id ||
      !exact.has(t.id.split('/')[0] + '/' + t.broker_details.position_id)
  );
}
export function replayTargets(trades: Trade[], positions: Mt5PositionVersion[]): ReplayTarget[] {
  const targets: ReplayTarget[] = [
    ...positions.map((position) => ({ kind: 'position' as const, position })),
    ...visibleJournalTrades(trades, positions).map((trade) => ({ kind: 'trade' as const, trade })),
  ];
  return targets.sort((a, b) => Date.parse(entryFacts(b).time) - Date.parse(entryFacts(a).time));
}
export function focusForDay(reviews: WeeklyReview[], day: string, account?: string | null) {
  return reviews
    .filter(
      (r) =>
        r.focus_next_week?.trim() &&
        (!r.account_id || r.account_id === account) &&
        r.week_end < day &&
        Date.parse(day + 'T00:00:00Z') - Date.parse(r.week_end + 'T00:00:00Z') <= 7 * 86400000
    )
    .sort((a, b) => b.week_end.localeCompare(a.week_end) || b.updated_at.localeCompare(a.updated_at))[0];
}
export function currencyOfReview(review: WeeklyReview, accounts: TradingAccount[]) {
  return (
    review.settlement_currency ||
    accounts.find((a) => a.id === review.account_id)?.base_currency ||
    'Unknown'
  );
}
