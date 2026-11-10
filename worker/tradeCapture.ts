import Decimal from 'decimal.js-light';
import { finiteMetric, normalizeExecutionMetrics } from '../src/lib/executionMetrics';
import type { ExecutionMetrics, Trade } from '../src/lib/types';

type Fields = Record<string, unknown>;
type Link = { id: string; account_id: string; currency: string; company: string };
const reviewFields = ['notes','lessons','observations','what_went_wrong','strategy','strategy_id','plan_id','setup_id',
  'entry_model_id','emotional_state','mistakes','screenshot_url','voice_note_url','entry_screenshot_url',
  'entry_voice_note_url','closure_screenshot_url','closure_voice_note_url','checklist_items'];
const object = (v: unknown): v is Fields => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

export function validateCaptureMetrics(input: unknown): input is ExecutionMetrics {
  if (!object(input) || input.version !== 1 || typeof input.cycle_id !== 'string' || !/^[0-9-]{1,90}$/.test(input.cycle_id)) return false;
  for (const key of ['entries','exits','fills','stops','stop_observations']) {
    if (input[key] !== undefined && (!Array.isArray(input[key]) || input[key].length > 2000 || input[key].some(v => !object(v)))) return false;
  }
  return JSON.stringify(input).length <= 450000;
}

export function capturePayload(fields: Fields, owner: string, link: Link): Fields {
  const metrics = fields.execution_metrics as ExecutionMetrics | undefined;
  const data: Fields = {};
  for (const key of ['pair','direction','entry_price','exit_price','stop_loss','take_profit','lot_size','status',
    'pnl','entry_time','exit_time','fees','broker_details']) {
    if (key in fields) data[key] = fields[key];
  }
  Object.assign(data, { trade_source: 'mt5', capture_mode: 'live', account_id: link.account_id, user_id: owner,
    settlement_currency: link.currency, broker: link.company, outcome: fields.status === 'open' ? null : Number(fields.pnl) > 0 ? 'win' : Number(fields.pnl) < 0 ? 'loss' : 'breakeven' });
  if (metrics) {
    const source = { ...metrics,
      stops: (metrics.stops ?? metrics.stop_observations as Array<Fields> ?? []).map(stop=>({
        ...stop, observed_at:stop.observed_at ?? (typeof stop.observed_at_ms==='number'?new Date(stop.observed_at_ms).toISOString():null),
      })),
      timezone_status: metrics.time_quality === 'historical_offset_unconfirmed' ? 'unresolved_history'
        : metrics.time_quality === 'unknown' ? 'unknown' : metrics.timezone_status ?? 'inferred_live',
    };
    const normalized = normalizeExecutionMetrics({ ...data, execution_metrics: source } as unknown as Trade);
    const movement = finiteMetric(metrics.movement);
    if (metrics.movement_unit === 'pips') normalized.pips = movement;
    if (metrics.movement_unit === 'ticks') normalized.ticks = movement;
    normalized.points = finiteMetric(metrics.price_movement);
    Object.assign(data, { execution_metrics: normalized, initial_risk: normalized.initial_risk,
      realized_r: normalized.realized_r, planned_r: normalized.planned_r, risk_reward_ratio: normalized.realized_r,
      pips: normalized.pips ?? 0, pnl_decimal: new Decimal(String(fields.pnl)).toString() });
  } else data.pips = 0;
  return data;
}

/** Prepare one atomic projection: preserve annotations, archive replaced legacy rows, and persist evidence. */
export async function persistLifecycle(db: D1Database, owner: string, link: Link, key: string, data: Fields): Promise<D1PreparedStatement[]> {
  const q = (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args);
  const id = link.id + '/' + key;
  const metrics = data.execution_metrics as ExecutionMetrics;
  const statements: D1PreparedStatement[] = [];
  const prior = await q("SELECT payload FROM workspace_records WHERE user_id=? AND table_name='trades' AND id=?", owner, id).first<{payload: string}>();
  const existing = prior ? JSON.parse(prior.payload) as Fields : {};
  // Preserve a known original stop when the connector reconnects with a newer sampled stop.
  const priorMetrics = existing.execution_metrics as ExecutionMetrics | undefined;
  if (priorMetrics?.first_sl != null) {
    for (const name of ['first_sl','first_sl_at','first_sl_source','delayed_sl']) metrics[name] = priorMetrics[name];
  }
  const savedRiskRows=await q('SELECT entry_ticket,payload FROM mt5_risk_snapshots WHERE link=? AND cycle=?',link.id,metrics.cycle_id).all<{entry_ticket:string;payload:string}>();
  const savedRisks=new Map(savedRiskRows.results.map(r=>[r.entry_ticket,JSON.parse(r.payload)]));
  const newRisks:Fields[]=[];
  for (const entry of metrics.entries ?? []) {
    const ticket = String(entry.ticket ?? '');
    if (!/^[0-9]+$/.test(ticket)) continue;
    const saved = savedRisks.get(ticket);
    if (saved) {
      const snapshot = saved;
      for (const name of ['first_sl','first_sl_at','first_sl_source','initial_risk','initial_reward']) {
        if (name in snapshot) entry[name] = snapshot[name];
      }
    } else if (finiteMetric(entry.first_sl) !== null && finiteMetric(entry.initial_risk) !== null) {
      newRisks.push({...entry,ticket});
    }
  }
  if(newRisks.length) statements.push(q("INSERT OR IGNORE INTO mt5_risk_snapshots(link,cycle,entry_ticket,payload,recorded_at) SELECT ?,?,json_extract(value,'$.ticket'),value,? FROM json_each(?)",
    link.id,metrics.cycle_id,new Date().toISOString(),JSON.stringify(newRisks)));
  const entryRisks = (metrics.entries ?? []).map(e => finiteMetric(e.initial_risk));
  if (entryRisks.length && entryRisks.every(n => n !== null && n > 0)) {
    metrics.initial_risk = entryRisks.reduce<Decimal>((sum, n) => sum.plus(n!), new Decimal(0)).toNumber();
  }
  Object.assign(metrics, normalizeExecutionMetrics({ ...data, execution_metrics: metrics } as unknown as Trade));
  data.initial_risk = metrics.initial_risk;
  data.realized_r = metrics.realized_r;
  data.risk_reward_ratio = metrics.realized_r;
  const tickets = Array.isArray(metrics.source_deal_tickets) ? metrics.source_deal_tickets.map(String).filter(t => /^[0-9]+$/.test(t)) : [];
  const legacyKeys = [...tickets.map(t => link.id + '/close-' + t), link.id + '/open-' + metrics.position_id];
  const old = await q("SELECT id,payload FROM workspace_records WHERE user_id=? AND table_name='trades' AND id IN (SELECT value FROM json_each(?))",
    owner, JSON.stringify(legacyKeys)).all<{id:string;payload:string}>();
  const aliases = new Set<string>((existing.original_trade_ids as string[]) ?? []);
  for (const row of old.results) {
    const payload = JSON.parse(row.payload);
    if (payload.trade_source !== 'mt5' || payload.account_id !== link.account_id || payload.direction !== data.direction) continue;
    aliases.add(row.id);
    for (const field of reviewFields) {
      const value = payload[field];
      if (value == null || value === '' || Array.isArray(value) && !value.length) continue;
      if (existing[field] == null || existing[field] === '') existing[field] = value;
      else if (typeof value === 'string' && typeof existing[field] === 'string' && !String(existing[field]).includes(value)
        && ['notes','lessons','observations','what_went_wrong'].includes(field)) existing[field] += '\n\n' + value;
    }

  }
  if(aliases.size) statements.push(q("UPDATE workspace_records SET payload=json_set(payload,'$.superseded_by',?),updated_at=? WHERE user_id=? AND table_name='trades' AND id IN (SELECT value FROM json_each(?))",
    id,new Date().toISOString(),owner,JSON.stringify([...aliases])));
  data.original_trade_ids = [...aliases];
  const annotations = Object.fromEntries(reviewFields.filter(k => existing[k] !== undefined).map(k => [k, existing[k]]));
  const time = new Date().toISOString();
  const incoming = {mistakes: [], ...data, ...annotations, id};
  statements.push(q("INSERT INTO workspace_records(id,user_id,table_name,payload,created_at,updated_at) VALUES(?,?,'trades',?,?,?) ON CONFLICT(id) DO UPDATE SET payload=json_patch(workspace_records.payload,excluded.payload),updated_at=excluded.updated_at WHERE workspace_records.user_id=excluded.user_id AND workspace_records.table_name='trades'",
    id, owner, JSON.stringify(incoming), time, time));
  const fills=(metrics.fills ?? []).filter(fill=>/^\d+$/.test(String(fill.ticket ?? '')));
  if(fills.length) statements.push(q("INSERT INTO mt5_execution_fills(link,ticket,cycle,payload,recorded_at) SELECT ?,json_extract(value,'$.ticket'),?,value,? FROM json_each(?) WHERE true ON CONFLICT(link,ticket) DO UPDATE SET payload=excluded.payload,recorded_at=excluded.recorded_at",
    link.id,metrics.cycle_id,time,JSON.stringify(fills)));
  return statements;
}
