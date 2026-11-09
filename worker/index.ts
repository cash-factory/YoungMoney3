import {accountSummaries} from './accountSummaries';
import {selectRecords} from './selectRecords';
import { settleManualTrade } from '../src/lib/settleManualTrade';
import type { TradeInput } from '../src/lib/types';
async function normalizeTrade(item: Record<string,unknown>, owner: unknown, db: D1Database) {
  for (const [field, table] of Object.entries({account_id:'trading_accounts', strategy_id:'trader_strategies', plan_id:'trading_plans', setup_id:'trading_setups', instrument_id:'market_instruments', entry_model_id:'strategy_entry_models'})) {
    if (item[field] != null && !await db.prepare('SELECT id FROM workspace_records WHERE user_id=? AND table_name=? AND id=?').bind(owner,table,item[field]).first()) throw new RequestError(400,'Invalid linked record: '+field);
  }
  try { return settleManualTrade(item as unknown as TradeInput); }
  catch (e) { throw new RequestError(400,e instanceof Error ? e.message : 'Invalid trade.'); }
}
import { mt5Route } from './mt5';
/// <reference types="@cloudflare/workers-types" />
import { WORKSPACE_TABLES } from '../src/lib/workspaceTables';
import { deleteOwnedMedia } from '../src/lib/mediaCleanup';

export interface Env {
  DB: D1Database;
  MEDIA?: R2Bucket;
  PILOT_INVITE_CODE?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

const encoder = new TextEncoder();
const ownedTables = new Set<string>(WORKSPACE_TABLES);
const publicTables = new Set(['provider_catalog', 'provider_offerings', 'prop_firm_rule_versions', 'provider_change_reviews']);

function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } }); }
function now() { return new Date().toISOString(); }
function id() { return crypto.randomUUID(); }
function b64(bytes: ArrayBuffer) { return btoa(String.fromCharCode(...new Uint8Array(bytes))); }
function unb64(value: string) { return Uint8Array.from(atob(value), char => char.charCodeAt(0)); }
async function hashPassword(password: string, salt = b64(crypto.getRandomValues(new Uint8Array(16)))) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unb64(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
  return { salt, hash: b64(bits) };
}
async function sha(value: string) { return b64(await crypto.subtle.digest('SHA-256', encoder.encode(value))); }
const sessionCookie = '__Host-ym_session';
function cookieToken(request: Request) {
  return request.headers.get('cookie')?.split(';').map(value => value.trim())
    .find(value => value.startsWith(sessionCookie + '='))?.slice(sessionCookie.length + 1);
}
function sessionResponse(body: unknown, token = '') {
  const result = response(body);
  result.headers.set('Set-Cookie', `${sessionCookie}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${token ? 2592000 : 0}`);
  return result;
}
async function issueSession(db: D1Database, user: Record<string, unknown>) {
  const token = b64(crypto.getRandomValues(new Uint8Array(32)));
  const expiry = new Date(Date.now() + 2592000000).toISOString();
  const issued = await db.prepare(`INSERT INTO sessions (token_hash,user_id,expires_at,created_at)
    SELECT ?,id,?,? FROM users WHERE id=? AND password_hash=? AND account_status='active'`)
    .bind(await sha(token), expiry, now(), user.id, user.password_hash).run();
  if (!issued.meta.changes) return response({ error: 'Sign in again.' }, 401);
  return sessionResponse({ user: profile(user) }, token);
}
class RequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
async function jsonObject<T>(request: Request, limit = 1024 * 1024): Promise<T> {
  const bytes = await readBoundedBody(request, limit);
  if (!bytes) throw new RequestError(413, 'Request body is too large.');
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new RequestError(400, 'Invalid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestError(400, 'Expected a JSON object.');
  return value as T;
}
async function stringFields(request: Request) {
  const fields = await jsonObject<Record<string, unknown>>(request, 16384);
  if (Object.values(fields).some(v => v !== null && typeof v !== 'string')) throw new RequestError(400, 'Invalid account fields.');
  return fields as Record<string, string>;
}
async function withinAuthBudget(db: D1Database, key: string, maximum: number) {
  const window = Math.floor(Date.now() / 600000);
  const entry = await db.prepare(`INSERT INTO auth_attempts (key,window,hits) VALUES (?,?,1)
    ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN window=excluded.window THEN hits+1 ELSE 1 END,window=excluded.window
    RETURNING hits`).bind(await sha(key), window).first<{ hits: number }>();
  return Boolean(entry && entry.hits <= maximum);
}
function throttled() {
  const result = response({ error: 'Too many attempts. Try again later.' }, 429);
  result.headers.set('Retry-After', '600');
  return result;
}
function profile(row: Record<string, unknown>) { const safe = { ...row }; delete safe.password_hash; delete safe.password_salt; return safe; }
async function currentUser(request: Request, db: D1Database) { const token = cookieToken(request); if (!token) return null; return await db.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.account_status='active'").bind(await sha(token), now()).first<Record<string, unknown>>(); }
async function audit(db: D1Database, actor: string | null, target: string | null, action: string, outcome: string, metadata: unknown = {}) { await db.prepare('INSERT INTO admin_audit_log (id,actor_user_id,target_user_id,action,outcome,metadata,created_at) VALUES (?,?,?,?,?,?,?)').bind(id(), actor, target, action, outcome, JSON.stringify(metadata), now()).run(); }

async function authRoute(request: Request, env: Env, path: string) {
  const input = await stringFields(request);
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  if (!await withinAuthBudget(env.DB, 'ip:' + ip, 80)) return throttled();
  const emailKey = input.email?.trim().toLowerCase();
  if (!emailKey || emailKey.length > 254) return response({ error: 'Valid email required.' }, 400);
  if (!await withinAuthBudget(env.DB, 'email:' + emailKey, 15)) return throttled();
  await env.DB.prepare('DELETE FROM auth_attempts WHERE window < ?').bind(Math.floor(Date.now() / 600000) - 1).run();
  if (path === '/api/auth/signup') {
    if (!env.PILOT_INVITE_CODE) return response({ error: 'Workspace sign-up has not been configured.' }, 503);
    if (!input.invite_code || input.invite_code.trim().toLowerCase() !== env.PILOT_INVITE_CODE.trim().toLowerCase()) return response({ error: 'Invalid pilot invite code.' }, 403);
    const accountCount = await env.DB.prepare('SELECT COUNT(*) AS total FROM users').first<{ total: number }>();
    if ((accountCount?.total || 0) >= 10) return response({ error: 'This pilot has reached its 10-account limit.' }, 403);
    const email = input.email?.trim().toLowerCase(); const username = input.username?.trim().toLowerCase(); const password = input.password || ''; const displayName = input.display_name?.trim() || username;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !username || !/^[a-z0-9_]{3,32}$/.test(username) || password.length < 8) return response({ error: 'Use a valid email, 3â€“32 character username, and password of at least 8 characters.' }, 400);
    const existing = await env.DB.prepare('SELECT id FROM users WHERE email=? OR username=?').bind(email, username).first(); if (existing) return response({ error: 'Email or username is already in use.' }, 409);
    const secured = await hashPassword(password); const userId = id(); const timestamp = now(); const created = await env.DB.prepare('INSERT OR IGNORE INTO users (id,email,username,display_name,password_hash,password_salt,created_at,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM users)<10').bind(userId, email, username, displayName, secured.hash, secured.salt, timestamp, timestamp).run(); if (!created.meta.changes) return response({ error: 'Account unavailable or pilot full.' }, 409); const user = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(userId).first<Record<string, unknown>>(); return issueSession(env.DB, user!);
  }
  if (path === '/api/auth/signin') { const user = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(input.email?.trim().toLowerCase()).first<Record<string, string>>(); if (!user) return response({ error: 'Invalid email or password.' }, 401); const secured = await hashPassword(input.password || '', user.password_salt); if (secured.hash !== user.password_hash) return response({ error: 'Invalid email or password.' }, 401); if (user.account_status === 'suspended') return response({ error: 'This account is suspended.' }, 403); return issueSession(env.DB, user); }
  return response({ error: 'Unknown authentication action.' }, 404);
}

async function sessionRoute(request: Request, env: Env, user: Record<string, unknown>, path: string) {
  if (path === '/api/auth/signout') { const token = cookieToken(request); if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha(token)).run(); return sessionResponse({ ok: true }); }
  const input = await stringFields(request);
  if (path === '/api/auth/profile') {
    const username = input.username?.trim().toLowerCase();
    if (username && !/^[a-z0-9_]{3,32}$/.test(username)) return response({ error: 'Username must be 3â€“32 letters, numbers, or underscores.' }, 400);
    if (username) { const existing = await env.DB.prepare('SELECT id FROM users WHERE username=? AND id<>?').bind(username, user.id).first(); if (existing) return response({ error: 'Username is already in use.' }, 409); }
    await env.DB.prepare('UPDATE users SET username=COALESCE(?,username),display_name=COALESCE(?,display_name),bio=COALESCE(?,bio),trading_style=COALESCE(?,trading_style),updated_at=? WHERE id=?').bind(username || null, input.display_name?.trim() || null, input.bio?.trim() || null, input.trading_style?.trim() || null, now(), user.id).run();
    const updated = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(user.id).first<Record<string, unknown>>(); return response({ user: profile(updated!) });
  }
  if (path === '/api/auth/password') {
    if (!input.current_password || !input.password || input.password.length < 8) return response({ error: 'Enter your current password and a new password of at least 8 characters.' }, 400);
    if (!await withinAuthBudget(env.DB, 'password:' + user.id, 15)) return throttled();
    const previous = await hashPassword(input.current_password, String(user.password_salt));
    if (previous.hash !== user.password_hash) return response({ error: 'Current password is incorrect.' }, 403);
    const secured = await hashPassword(input.password);
    const [changed] = await env.DB.batch([
      env.DB.prepare('UPDATE users SET password_hash=?,password_salt=?,updated_at=? WHERE id=? AND password_hash=?')
        .bind(secured.hash, secured.salt, now(), user.id, previous.hash),
      env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=?)')
        .bind(user.id, user.id, secured.hash),
    ]);
    if (!changed.meta.changes) return response({ error: 'Credentials changed. Sign in again.' }, 409);
    return sessionResponse({ ok: true });
  }
  return response({ error: 'Unknown session action.' }, 404);
}

const fillReviewFields = new Set(['notes','lessons','mistakes','emotional_state','setup_quality','observations','what_went_wrong','strategy_id','setup_id','entry_model_id','plan_id','entry_screenshot_url','entry_voice_note_url','closure_screenshot_url','closure_voice_note_url','screenshot_url','voice_note_url','checklist_items','checklist_completed','checklist_override_reason']);
// Financial or relationship edits must pass the same validation and settlement as new trades.
// Annotation-only edits remain available for older imported journal records.
const tradeRecalculationFields = new Set([
  'pair', 'direction', 'status', 'entry_price', 'exit_price', 'entry_time', 'exit_time',
  'lot_size', 'fees', 'stop_loss', 'take_profit', 'account_id', 'strategy_id',
  'plan_id', 'setup_id', 'instrument_id', 'entry_model_id', 'calculation_snapshot',
  'settlement_currency', 'conversion_rate', 'pnl', 'pnl_decimal', 'outcome',
  'initial_risk', 'planned_r', 'realized_r', 'risk_reward_ratio',
]);

async function databaseRoute(request: Request, env: Env, user: Record<string, unknown>) {
  const input = await jsonObject<{
    action: string;
    table: string;
    id?: string;
    payload?: Record<string, unknown> | Record<string, unknown>[];
    filters?: Record<string, unknown>;
    membershipFilters?: Record<string, unknown[]>;
    or?: string;
    order?: { column: string; ascending?: boolean };
    limit?: number;
  }>(request);
  if (!ownedTables.has(input.table) && !publicTables.has(input.table)) return response({ error: 'Unsupported data collection.' }, 400);
  if (publicTables.has(input.table)) return response({ data: [], count: 0 });
  const table = input.table;
  const filters = input.filters || {};
  if (input.action === 'select') {
    return response(await selectRecords(env.DB,user.id,input));
  }
  if (input.action === 'insert' || input.action === 'upsert') {
    const items = Array.isArray(input.payload) ? input.payload : [input.payload];
    if (!items.length || items.length > 250 || items.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
      return response({ error: 'Supply 1–250 records.' }, 400);
    }
    if (input.action!=='upsert' && table === 'trades' && items.some(item => item?.trade_source === 'mt5')) {
      return response({ error: 'Broker fills must be synchronized by the linked terminal.' }, 403);
    }
    const rows = await Promise.all(items.map(async value => {
      const item = value!;
      const recordId = typeof item.id === 'string' && item.id ? item.id : id();
      const timestamp = now();
      if(input.action==='upsert' && table==='trades' && item.trade_source==='mt5') {
        const existing=await env.DB.prepare("SELECT id FROM workspace_records WHERE id=? AND user_id=? AND table_name='trades'").bind(recordId,user.id).first();
        if(!existing) {
          const audit=await env.DB.prepare('SELECT after_payload FROM trade_audit WHERE user_id=? AND trade_id=? AND after_payload IS NOT NULL ORDER BY sequence DESC LIMIT 1').bind(user.id,recordId).first<{after_payload:string}>();
          if(!audit || JSON.parse(audit.after_payload).trade_source!=='mt5') throw new RequestError(409,'Verified broker history must be recovered from its connector.');
          Object.assign(item,JSON.parse(audit.after_payload));
        }
      }
      const normalized = table==='trades' && input.action==='insert' ? await normalizeTrade(item,user.id,env.DB) : item;
      const payload = { ...normalized, id: recordId, user_id: user.id };
      const json = JSON.stringify(payload);
      const digest = await sha(json);
      const ignore = input.action === 'upsert' || (table === 'trades' && items.length === 1);
      const statement = env.DB.prepare(`INSERT ${ignore ? 'OR IGNORE' : ''} INTO workspace_records
        (id,user_id,table_name,payload,created_at,updated_at,request_hash) VALUES (?,?,?,?,?,?,?)`)
        .bind(recordId, user.id, table, json, timestamp, timestamp, digest);
      return { recordId, timestamp, payload, digest, statement };
    }));
    const results = await env.DB.batch(rows.map(row => row.statement));
    const inserted: Record<string, unknown>[] = [];
    for (const [i, row] of rows.entries()) {
      if (results[i].meta.changes) inserted.push({ ...row.payload, created_at: row.timestamp, updated_at: row.timestamp });
      else if (input.action === 'insert') {
        const previous = await env.DB.prepare('SELECT payload,created_at,updated_at,request_hash FROM workspace_records WHERE id=? AND user_id=? AND table_name=?')
          .bind(row.recordId, user.id, table).first<{ payload: string; created_at: string; updated_at: string; request_hash: string }>();
        if (!previous || previous.request_hash !== row.digest) return response({ error: 'This trade ID is already in use. Refresh before saving.' }, 409);
        inserted.push({ ...JSON.parse(previous.payload), created_at: previous.created_at, updated_at: previous.updated_at });
      }
    }
    return response({ data: inserted, count: inserted.length });
  }
  if (input.action === 'update' || input.action === 'delete') {
    if (typeof input.id !== 'string' || !input.id) return response({ error: 'Record id required.' }, 400);
    const found = await env.DB.prepare('SELECT payload,created_at,updated_at FROM workspace_records WHERE id=? AND user_id=? AND table_name=?')
      .bind(input.id, user.id, table).first<{ payload: string; created_at: string; updated_at: string }>();
    if (!found) return response({ error: 'Record not found.' }, 404);
    const old = JSON.parse(found.payload);
    const isFill = table === 'trades' && old.trade_source === 'mt5';
    const patch = input.payload;
    if (input.action === 'delete' && isFill) return response({ error: 'Broker fills cannot be deleted from the journal.' }, 403);
    if (input.action === 'update') {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return response({ error: 'Supply a record patch.' }, 400);
      if (table === 'trades' && ((!isFill && 'trade_source' in patch && patch.trade_source !== old.trade_source)
        || (isFill && Object.keys(patch).some(key => !fillReviewFields.has(key)))) {
        return response({ error: 'Trade provenance and broker execution fields are read-only.' }, 403);
      }
      if (table === 'trades' && !filters.updated_at) return response({ error: 'Refresh the trade before editing.' }, 428);
    }
    if (table === 'trades' && input.action === 'delete' && !filters.updated_at) {
      return response({ error: 'Refresh the trade before deleting it.' }, 428);
    }
    const revision = filters.updated_at ?? found.updated_at;
    if (revision !== found.updated_at) return response({ error: 'This record changed. Refresh before saving.' }, 409);
    if (input.action === 'delete') {
      const result = await env.DB.prepare('DELETE FROM workspace_records WHERE id=? AND user_id=? AND table_name=? AND updated_at=?')
        .bind(input.id, user.id, table, revision).run();
      return result.meta.changes ? response({ data: null }) : response({ error: 'This record changed. Refresh before deleting.' }, 409);
    }
    const merged = { ...old, ...patch, user_id: user.id, id: input.id };
    const needsTradeRecalculation = table === 'trades' && !isFill
      && Object.keys(patch || {}).some(key => tradeRecalculationFields.has(key) && merged[key] !== old[key]);
    const payload = needsTradeRecalculation
      ? { ...merged, ...await normalizeTrade(merged, user.id, env.DB) }
      : merged;
    const timestamp = new Date(Math.max(Date.now(), Date.parse(found.updated_at) + 1)).toISOString();
    const changed = await env.DB.prepare('UPDATE workspace_records SET payload=?,updated_at=? WHERE id=? AND user_id=? AND table_name=? AND updated_at=?')
      .bind(JSON.stringify(payload), timestamp, input.id, user.id, table, revision).run();
    if (!changed.meta.changes) return response({ error: 'This record changed. Refresh before saving.' }, 409);
    return response({ data: { ...payload, created_at: found.created_at, updated_at: timestamp } });
  }
  return response({ error: 'Unsupported data action.' }, 400);
}

const mediaLimit = 15 * 1024 * 1024;
const allowedMediaTypes = new Set([
  'image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp',
  'audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/x-wav',
]);

function getSupabaseStorageConfig(env: Env) {
  if (!env.SUPABASE_URL && !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'Private media storage is only partially configured. Set both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.' };
  }
  let url: URL;
  try {
    url = new URL(env.SUPABASE_URL);
  } catch {
    return { error: 'SUPABASE_URL must be a valid HTTPS project URL.' };
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    return { error: 'SUPABASE_URL must be a valid HTTPS project URL without credentials or query parameters.' };
  }
  return { url: url.origin, key: env.SUPABASE_SERVICE_ROLE_KEY };
}

async function supabaseStorageRequest(config: { url: string; key: string }, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('apikey', config.key);
  headers.set('authorization', `Bearer ${config.key}`);
  return fetch(`${config.url}/storage/v1/${path}`, { ...init, headers });
}

async function readBoundedBody(request: Request, limit: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function mediaProviderError(status: number) {
  if (status === 404) return response({ error: 'Attachment not found.' }, 404);
  if (status === 409) return response({ error: 'File already exists.' }, 409);
  if (status === 413) return response({ error: 'Attachments must be 15 MB or smaller.' }, 413);
  return response({ error: `Private media storage request failed (HTTP ${status}).` }, 502);
}

interface MediaFile { id: string; name: string; metadata: { mimetype: string } }

async function listR2Media(media: R2Bucket | undefined, owner: string, count: number): Promise<MediaFile[]> {
  if (!media) return [];
  const objects: R2Object[] = [];
  let cursor: string | undefined;
  while (objects.length < count) {
    const page = await media.list({ prefix: `${owner}/`, limit: 1000, cursor });
    objects.push(...page.objects);
    if (!page.truncated || !page.cursor) break;
    cursor = page.cursor;
  }
  return objects.slice(0, count).map(object => ({
    id: object.etag,
    name: object.key.slice(owner.length + 1),
    metadata: { mimetype: object.httpMetadata?.contentType || 'application/octet-stream' },
  }));
}

async function listSupabaseMedia(config: { url: string; key: string }, owner: string, count: number): Promise<{ files: MediaFile[] } | { error: Response }> {
  const files: MediaFile[] = [];
  for (let offset = 0; offset < count; offset += 1000) {
    const limit = Math.min(1000, count - offset);
    const result = await supabaseStorageRequest(config, 'object/list/trading-media', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prefix: owner, limit, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!result.ok) return { error: mediaProviderError(result.status) };
    const entries = await result.json() as { id?: string | null; name?: string; metadata?: { mimetype?: string } | null }[];
    const page = entries.filter(entry => entry.name && entry.id).map(entry => ({
      id: entry.id!,
      name: entry.name!,
      metadata: { mimetype: entry.metadata?.mimetype || 'application/octet-stream' },
    }));
    files.push(...page);
    if (page.length < limit) break;
  }
  return { files };
}

async function mediaRoute(request: Request, env: Env, user: Record<string, unknown>, url: URL) {
  const owner = String(user.id);
  const configuredStorage = getSupabaseStorageConfig(env);
  if (configuredStorage && 'error' in configuredStorage) return response({ error: configuredStorage.error }, 503);
  const supabaseStorage = configuredStorage && 'key' in configuredStorage ? configuredStorage : null;
  if (!supabaseStorage && !env.MEDIA) {
    return response({ error: 'Private media is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY and create the private trading-media bucket.' }, 503);
  }

  if (request.method === 'GET' && url.pathname === '/api/media/page') {
    const cursor = url.searchParams.get('cursor') || '';
    const root = owner + '/';
    const sub = url.searchParams.get('folder') || '';
    if (sub.length>1024 || sub.split('/').some(v=>v==='..'||v==='.'||v.includes('\\')) || sub.startsWith('/')) return response({error:'Invalid media folder.'},400);
    if (url.searchParams.get('provider') === 'r2') {
      if (!env.MEDIA) return response({files:[],folders:[],next:null});
      const page = await env.MEDIA.list({prefix:root,limit:100,cursor:cursor||undefined});
      return response({files:page.objects.map(item=>({name:item.key.slice(root.length),id:item.etag})),folders:[],next:page.truncated?page.cursor:null});
    }
    if (!supabaseStorage) return response({files:[],folders:[],next:null});
    const offset=Number(cursor);
    if(!Number.isSafeInteger(offset)||offset<0) return response({error:'Invalid media cursor.'},400);
    const upstream=await supabaseStorageRequest(supabaseStorage,'object/list/trading-media',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prefix:sub?root+sub:owner,limit:100,offset,sortBy:{column:'name',order:'asc'}})});
    if(!upstream.ok) return mediaProviderError(upstream.status);
    const rows=await upstream.json() as {name:string;id?:string;metadata?:unknown}[];
    const items=rows.map(item=>({...item,name:(sub?sub+'/':'')+item.name}));
    return response({files:items.filter(item=>item.id),folders:items.filter(item=>!item.id).map(item=>item.name),next:rows.length===100?String(offset+100):null});
  }
  if (request.method === 'GET' && url.pathname === '/api/media/list') {
    const prefix = url.searchParams.get('prefix') || owner;
    if (prefix !== owner && prefix !== `${owner}/`) return response({ error: 'Invalid private media prefix.' }, 400);
    const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit')) || 100));
    const offset = Math.min(10000, Math.max(0, Number(url.searchParams.get('offset')) || 0));
    const count = offset + limit;
    let supabaseFiles: MediaFile[] = [];
    if (supabaseStorage) {
      const listed = await listSupabaseMedia(supabaseStorage, owner, count);
      if ('error' in listed) return listed.error;
      supabaseFiles = listed.files;
    }
    const r2Files = await listR2Media(env.MEDIA, owner, count);
    const files = [...new Map([...supabaseFiles, ...r2Files].map(file => [file.name, file])).values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(offset, offset + limit);
    return response({ files });
  }

  const path = url.searchParams.get('path') || '';
  if (!path.startsWith(`${owner}/`) || path.split('/').some(part => !part || part === '.' || part === '..' || part.includes('\\'))) {
    return response({ error: 'Invalid private media path.' }, 400);
  }

  if (request.method === 'PUT' && url.pathname === '/api/media/upload') {
    const declaredSize = Number(request.headers.get('content-length') || 0);
    if (declaredSize > mediaLimit) return response({ error: 'Attachments must be 15 MB or smaller.' }, 413);
    const contentType = (request.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
    if (!allowedMediaTypes.has(contentType)) return response({ error: 'Use a supported PNG, JPEG, WebP, GIF, AVIF, or audio file format.' }, 415);
    const bytes = await readBoundedBody(request, mediaLimit);
    if (!bytes) return response({ error: 'Attachments must be 15 MB or smaller.' }, 413);
    if (!bytes.byteLength) return response({ error: 'The attachment is empty.' }, 400);
    const lease=id();
    const active=await env.DB.prepare("INSERT INTO active_media_uploads(id,owner,expires) SELECT ?,id,? FROM users WHERE id=? AND account_status='active'").bind(lease,Date.now()+900000,owner).run();
    if(!active.meta.changes) return response({error:'Account unavailable for uploads.'},403);
    try {
    if (supabaseStorage) {
      const result = await supabaseStorageRequest(supabaseStorage, `object/trading-media/${path.split('/').map(encodeURIComponent).join('/')}`, {
        method: 'POST',
        headers: { 'content-type': contentType, 'x-upsert': 'false' },
        body: bytes,
      });
      if (!result.ok) return mediaProviderError(result.status);
    } else if (env.MEDIA) {
      const uploaded = await env.MEDIA.put(path, bytes, { httpMetadata: { contentType }, onlyIf: { etagDoesNotMatch: '*' } });
      if (!uploaded) return response({ error: 'File already exists.' }, 409);
    }
    return response({ path });
    } finally { await env.DB.prepare('DELETE FROM active_media_uploads WHERE id=?').bind(lease).run(); }
  }

  if (request.method === 'GET' && url.pathname === '/api/media/download') {
    if (supabaseStorage) {
      const result = await supabaseStorageRequest(supabaseStorage, `object/trading-media/${path.split('/').map(encodeURIComponent).join('/')}`);
      if (result.ok) {
        return new Response(result.body, {
          headers: {
            'content-type': result.headers.get('content-type') || 'application/octet-stream',
            'cache-control': 'private, no-store',
            'x-content-type-options': 'nosniff',
          },
        });
      }
      if (result.status !== 404 || !env.MEDIA) return mediaProviderError(result.status);
    }
    if (!env.MEDIA) return response({ error: 'Attachment not found.' }, 404);
    const object = await env.MEDIA.get(path);
    if (!object) return response({ error: 'Attachment not found.' }, 404);
    return new Response(object.body, {
      headers: {
        'content-type': object.httpMetadata?.contentType || 'application/octet-stream',
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  }

  return response({ error: 'Unsupported media action.' }, 404);
}

async function cleanupMemberMedia(env: Env, ownerId: string): Promise<void> {
  const configuredStorage = getSupabaseStorageConfig(env);
  if (configuredStorage && 'error' in configuredStorage) throw new Error('Private media storage is not configured correctly.');
  const supabaseStorage = configuredStorage && 'key' in configuredStorage ? configuredStorage : null;

  await deleteOwnedMedia(ownerId, {
    listSupabasePage: async (userId, offset, limit) => {
      if (!supabaseStorage) return { paths: [], hasMore: false };
      const result = await supabaseStorageRequest(supabaseStorage, 'object/list/trading-media', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prefix: userId, limit, offset, sortBy: { column: 'name', order: 'asc' } }),
      });
      if (!result.ok) throw new Error('Private media listing failed.');
      const entries = await result.json() as { id?: string | null; name?: string }[];
      const paths = entries.filter(entry => entry.id && entry.name).map(entry => `${userId}/${entry.name}`);
      const folders = entries.filter(entry => !entry.id && entry.name).map(entry => `${userId}/${entry.name}`);
      return { paths, folders, hasMore: entries.length === limit };
    },
    removeSupabase: async paths => {
      if (!supabaseStorage || !paths.length) return;
      const result = await supabaseStorageRequest(supabaseStorage, 'object/trading-media', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prefixes: paths }),
      });
      if (!result.ok) throw new Error('Private media deletion failed.');
    },
    listR2Page: async (prefix, cursor) => {
      if (!env.MEDIA) return { keys: [], truncated: false };
      const page = await env.MEDIA.list({ prefix, limit: 1000, cursor });
      const keys = page.objects.map(object => object.key);
      return page.truncated
        ? { keys, truncated: true, cursor: page.cursor }
        : { keys, truncated: false };
    },
    deleteR2: async keys => { if (env.MEDIA && keys.length) await env.MEDIA.delete(keys); },
  });
  if(supabaseStorage){
    const check=await supabaseStorageRequest(supabaseStorage,'object/list/trading-media',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prefix:ownerId,limit:1})});
    if(!check.ok || (await check.json() as unknown[]).length) throw new Error('Private media remains after deletion.');
  }
  if(env.MEDIA && (await env.MEDIA.list({prefix:ownerId+'/',limit:1})).objects.length) throw new Error('Legacy media remains after deletion.');

}

async function adminRoute(request: Request, env: Env, user: Record<string, unknown>) {
  if (user.role !== 'admin' || user.account_status !== 'active') return response({ error: 'Administrator access required.' }, 403);
  const input = await jsonObject<{ action: string; targetUserId?: string }>(request);
  if (input.action === 'list') {
    const result = await env.DB.prepare(`
      SELECT u.id,u.email,u.username,u.display_name,u.role,u.account_status,u.created_at,u.suspended_at,u.suspension_expires_at,
        (SELECT COUNT(*) FROM workspace_records r WHERE r.user_id=u.id AND r.table_name='trades') AS trade_count,
        (SELECT COUNT(*) FROM workspace_records r WHERE r.user_id=u.id AND r.table_name='trading_plans') AS plan_count
      FROM users u ORDER BY u.created_at DESC
    `).all();
    return response({ members: result.results });
  }
  if (input.action === 'audit') {
    const result = await env.DB.prepare('SELECT * FROM admin_audit_log ORDER BY created_at DESC LIMIT 100').all();
    return response({ entries: result.results });
  }
  if (!input.targetUserId || input.targetUserId === user.id) return response({ error: 'Choose another member; administrators cannot change their own access here.' }, 400);
  const target = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(input.targetUserId).first<Record<string, unknown>>();
  if (!target || target.role === 'admin') return response({ error: 'Member not found or protected.' }, 404);
  if (input.action === 'suspend' || input.action === 'delete') {
    const suspendedAt = now();
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET account_status='suspended',suspended_at=?,suspension_expires_at=NULL,updated_at=? WHERE id=?").bind(suspendedAt, suspendedAt, target.id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(target.id),
    ]);
    if (input.action === 'suspend') {
      await audit(env.DB, String(user.id), String(target.id), 'suspend', 'success');
      return response({ ok: true });
    }
  }
  if (input.action === 'restore') {
    await env.DB.prepare("UPDATE users SET account_status='active',suspended_at=NULL,suspension_expires_at=NULL,updated_at=? WHERE id=?")
      .bind(now(), target.id).run();
    await audit(env.DB, String(user.id), String(target.id), 'restore', 'success');
    return response({ ok: true });
  }
  if (input.action === 'delete') {
    const upload=await env.DB.prepare('SELECT 1 FROM active_media_uploads WHERE owner=? AND expires>? LIMIT 1').bind(target.id,Date.now()).first();
    if(upload) return response({error:'Upload finishing. Account suspended. Retry deletion after the upload completes.'},409);
    try {
      await cleanupMemberMedia(env, String(target.id));
    } catch {
      await audit(env.DB, String(user.id), String(target.id), 'delete', 'failed', { stage: 'media_cleanup' });
      return response({ error: 'Private media cleanup failed. The member account and records were retained; retry after checking storage configuration.' }, 502);
    }
    await env.DB.batch([
      env.DB.prepare('DELETE FROM workspace_records WHERE user_id=?').bind(target.id),
      env.DB.prepare('DELETE FROM users WHERE id=?').bind(target.id),
      env.DB.prepare('INSERT INTO admin_audit_log (id,actor_user_id,target_user_id,action,outcome,metadata,created_at) VALUES (?,?,?,?,?,?,?)')
        .bind(id(), user.id, target.id, 'delete', 'success', '{"records_deleted":true}', now()),
    ]);
    return response({ ok: true });
  }
  return response({ error: 'Unknown administration action.' }, 400);
}

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname, origin } = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
    const requestOrigin = request.headers.get('Origin');
    if (request.method !== 'GET' && ((requestOrigin && requestOrigin !== origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site')) {
      return response({ error: 'Cross-origin mutation rejected.' }, 403);
    }
    try {
      if (request.method === 'GET' && pathname === '/api/health') {
        const ready = await env.DB.prepare('SELECT 1 AS ready').first<{ ready: number }>();
        return ready?.ready === 1 ? response({ status: 'ok', database: 'connected' }) : response({ status: 'unavailable' }, 503);
      }
      if (request.method === 'POST' && pathname.startsWith('/api/mt5/device/')) return await mt5Route(request, env, null);
      if (request.method === 'POST' && ['/api/auth/signup', '/api/auth/signin'].includes(pathname)) return await authRoute(request, env, pathname);
      const user = await currentUser(request, env.DB);
      if (!user) return response({ error: 'Authentication required.' }, 401);
      if(request.method==='GET' && pathname==='/api/account-summaries') return response({rows:await accountSummaries(env.DB,user.id)});
      if (pathname.startsWith('/api/mt5/')) return await mt5Route(request, env, String(user.id));
      if (request.method === 'GET' && pathname === '/api/me') return response({ user: profile(user) });
      if (request.method === 'POST' && ['/api/auth/profile', '/api/auth/password', '/api/auth/signout'].includes(pathname)) return await sessionRoute(request, env, user, pathname);
      if (request.method === 'POST' && pathname === '/api/data') return await databaseRoute(request, env, user);
      if (pathname.startsWith('/api/media/')) return await mediaRoute(request, env, user, new URL(request.url));
      if (request.method === 'POST' && pathname === '/api/admin') return await adminRoute(request, env, user);
      return response({ error: 'Not found.' }, 404);
    } catch (error) {
      if (error instanceof RequestError) return response({ error: error.message }, error.status);
      console.error('Workspace request failed', { path: pathname, requestId: request.headers.get('cf-ray') });
      return response({ error: 'The workspace service could not complete this request.' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
