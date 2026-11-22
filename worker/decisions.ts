type Bag = Record<string, unknown>;
type Historical = { payload: string | null; effective_at: string };
const string = (v: unknown) => (typeof v === 'string' ? v : '');
export function freezeDecisionEntry(record: Bag) {
  const fields = [
    'entry_time',
    'entry_price',
    'stop_loss',
    'direction',
    'strategy_id',
    'entry_model_id',
    'plan_id',
    'risk_percent',
    'checklist_items',
    'entry_screenshot_url',
    'entry_voice_note_url',
    'capture_mode',
  ];
  return {
    ...Object.fromEntries(fields.map((key) => [key, record[key] ?? null])),
    originally_open: record.status === 'open',
    entry_note: record.capture_mode === 'live' && record.status === 'open' ? record.notes || null : null,
  };
}
export async function decisionSource(
  db: D1Database,
  owner: string,
  ref: unknown
): Promise<{
  time: string;
  account: string | null;
  symbol: string;
  plan: string | null;
  clock: boolean;
} | null> {
  if (typeof ref !== 'string' || ref.length > 300) return null;
  if (ref.startsWith('trade/')) {
    const row = await db
      .prepare("SELECT payload FROM workspace_records WHERE table_name='trades' AND user_id=? AND id=?")
      .bind(owner, ref.slice(6))
      .first<{ payload: string }>();
    if (!row) return null;
    const t = JSON.parse(row.payload);
    return {
      time: t.decision_entry?.entry_time || t.entry_time,
      account: t.account_id ?? null,
      symbol: t.pair,
      plan: t.decision_entry ? t.decision_entry.plan_id : (t.plan_id ?? null),
      clock: t.trade_source !== 'mt5',
    };
  }
  const match = /^position\/([^/]+)\/(\d+:\d+)$/.exec(ref);
  if (!match) return null;
  const row = await db
    .prepare(
      'SELECT v.payload,v.account_id FROM mt5_position_versions v JOIN mt5_links l ON v.link=l.id JOIN mt5_devices d ON l.device=d.id WHERE v.owner=? AND l.owner=? AND d.owner=? AND d.revoked=0 AND v.link=? AND v.lifecycle_id=? ORDER BY v.version DESC LIMIT 1'
    )
    .bind(owner, owner, owner, match[1], match[2])
    .first<{ payload: string; account_id: string }>();
  if (!row) return null;
  const s = JSON.parse(row.payload);
  return {
    time: s.first_entry_at,
    account: row.account_id,
    symbol: s.symbol,
    plan: null,
    clock: s.capture_completeness?.session_status === 'confirmed',
  };
}
export async function historicalRules(
  db: D1Database,
  owner: string,
  source: NonNullable<Awaited<ReturnType<typeof decisionSource>>>,
  input: Bag
) {
  const instant = Date.parse(source.time);
  const at = Number.isFinite(instant) ? new Date(instant).toISOString() : null;
  const get = async (table: string, id: unknown) => {
    if (!string(id) || !source.clock || !at) return null;
    const r = await db
      .prepare(
        'SELECT payload,effective_at FROM decision_playbook_history WHERE owner=? AND collection=? AND record_id=? AND effective_at<=? ORDER BY effective_at DESC,sequence DESC LIMIT 1'
      )
      .bind(owner, table, id, at)
      .first<Historical>();
    return r?.payload ? { ...JSON.parse(r.payload), revision: r.effective_at } : null;
  };
  const [strategy, entryModel] = await Promise.all([
    get('trader_strategies', input.strategy_id),
    get('strategy_entry_models', input.entry_model_id),
  ]);
  const model = strategy && entryModel?.strategy_id === strategy.id ? entryModel : null;
  const plan = await get('trading_plans', source.plan || strategy?.plan_id);
  const tests =
    source.clock && (strategy || plan)
      ? await db
          .prepare(
            `SELECT payload FROM (
    SELECT payload,ROW_NUMBER() OVER(PARTITION BY collection,record_id ORDER BY effective_at DESC,sequence DESC) AS rank
    FROM decision_playbook_history WHERE owner=? AND collection IN ('strategy_checklist_items','pre_trade_checklist') AND effective_at<=?
  ) WHERE rank=1 AND payload IS NOT NULL AND COALESCE(json_extract(payload,'$.is_active'),1)=1
    AND COALESCE(json_extract(payload,'$.is_required'),1)=1 AND (
    (json_extract(payload,'$.strategy_id')=? AND (json_extract(payload,'$.entry_model_id') IS NULL OR json_extract(payload,'$.entry_model_id')=?))
    OR (json_extract(payload,'$.plan_id')=? AND json_extract(payload,'$.strategy_id') IS NULL))
    ORDER BY json_extract(payload,'$.sort_order'),json_extract(payload,'$.label')`
          )
          .bind(owner, at, strategy?.id ?? null, model?.id ?? null, plan?.id ?? null)
          .all<{ payload: string }>()
      : null;
  return {
    strategy: strategy?.name ?? null,
    model: model?.name ?? null,
    modelVersion: model?.revision ?? null,
    plan: plan?.title ?? null,
    earliest: model?.earliest_entry_utc || null,
    requireStop: model?.requires_opening_stop === true,
    riskLimit:
      typeof plan?.max_risk_per_trade_pct === 'number' && plan.max_risk_per_trade_pct > 0
        ? plan.max_risk_per_trade_pct
        : null,
    criteria: model?.description || strategy?.description || null,
    checklist: [...new Set((tests?.results || []).map((r) => String(JSON.parse(r.payload).label)))],
  };
}
