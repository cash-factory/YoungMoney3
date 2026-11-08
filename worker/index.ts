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
async function issueSession(db: D1Database, userId: string) { const token = b64(crypto.getRandomValues(new Uint8Array(32))); const expiry = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(); await db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)').bind(await sha(token), userId, expiry, now()).run(); return token; }
function profile(row: Record<string, unknown>) { const safe = { ...row }; delete safe.password_hash; delete safe.password_salt; return safe; }
async function currentUser(request: Request, db: D1Database) { const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, ''); if (!token) return null; return await db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(await sha(token), now()).first<Record<string, unknown>>(); }
async function audit(db: D1Database, actor: string | null, target: string | null, action: string, outcome: string, metadata: unknown = {}) { await db.prepare('INSERT INTO admin_audit_log (id,actor_user_id,target_user_id,action,outcome,metadata,created_at) VALUES (?,?,?,?,?,?,?)').bind(id(), actor, target, action, outcome, JSON.stringify(metadata), now()).run(); }

async function authRoute(request: Request, env: Env, path: string) {
  const input = await request.json<Record<string, string>>();
  if (path === '/api/auth/signup') {
    if (!env.PILOT_INVITE_CODE) return response({ error: 'Workspace sign-up has not been configured.' }, 503);
    if (!input.invite_code || input.invite_code.trim().toLowerCase() !== env.PILOT_INVITE_CODE.trim().toLowerCase()) return response({ error: 'Invalid pilot invite code.' }, 403);
    const accountCount = await env.DB.prepare('SELECT COUNT(*) AS total FROM users').first<{ total: number }>();
    if ((accountCount?.total || 0) >= 10) return response({ error: 'This pilot has reached its 10-account limit.' }, 403);
    const email = input.email?.trim().toLowerCase(); const username = input.username?.trim().toLowerCase(); const password = input.password || ''; const displayName = input.display_name?.trim() || username;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !username || !/^[a-z0-9_]{3,32}$/.test(username) || password.length < 8) return response({ error: 'Use a valid email, 3–32 character username, and password of at least 8 characters.' }, 400);
    const existing = await env.DB.prepare('SELECT id FROM users WHERE email=? OR username=?').bind(email, username).first(); if (existing) return response({ error: 'Email or username is already in use.' }, 409);
    const secured = await hashPassword(password); const userId = id(); const timestamp = now(); await env.DB.prepare('INSERT INTO users (id,email,username,display_name,password_hash,password_salt,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').bind(userId, email, username, displayName, secured.hash, secured.salt, timestamp, timestamp).run(); const token = await issueSession(env.DB, userId); const user = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(userId).first<Record<string, unknown>>(); return response({ token, user: profile(user!) });
  }
  if (path === '/api/auth/signin') { const user = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(input.email?.trim().toLowerCase()).first<Record<string, string>>(); if (!user) return response({ error: 'Invalid email or password.' }, 401); const secured = await hashPassword(input.password || '', user.password_salt); if (secured.hash !== user.password_hash) return response({ error: 'Invalid email or password.' }, 401); if (user.account_status === 'suspended') return response({ error: 'This account is suspended.' }, 403); const token = await issueSession(env.DB, user.id); return response({ token, user: profile(user) }); }
  return response({ error: 'Unknown authentication action.' }, 404);
}

async function sessionRoute(request: Request, env: Env, user: Record<string, unknown>, path: string) {
  if (path === '/api/auth/signout') { const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, ''); if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha(token)).run(); return response({ ok: true }); }
  const input = await request.json<Record<string, string>>();
  if (path === '/api/auth/profile') {
    const username = input.username?.trim().toLowerCase();
    if (username && !/^[a-z0-9_]{3,32}$/.test(username)) return response({ error: 'Username must be 3–32 letters, numbers, or underscores.' }, 400);
    if (username) { const existing = await env.DB.prepare('SELECT id FROM users WHERE username=? AND id<>?').bind(username, user.id).first(); if (existing) return response({ error: 'Username is already in use.' }, 409); }
    await env.DB.prepare('UPDATE users SET username=COALESCE(?,username),display_name=COALESCE(?,display_name),bio=COALESCE(?,bio),trading_style=COALESCE(?,trading_style),updated_at=? WHERE id=?').bind(username || null, input.display_name?.trim() || null, input.bio?.trim() || null, input.trading_style?.trim() || null, now(), user.id).run();
    const updated = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(user.id).first<Record<string, unknown>>(); return response({ user: profile(updated!) });
  }
  if (path === '/api/auth/password') { if (!input.password || input.password.length < 8) return response({ error: 'Use at least 8 characters.' }, 400); const secured = await hashPassword(input.password); await env.DB.prepare('UPDATE users SET password_hash=?,password_salt=?,updated_at=? WHERE id=?').bind(secured.hash, secured.salt, now(), user.id).run(); return response({ ok: true }); }
  return response({ error: 'Unknown session action.' }, 404);
}

async function databaseRoute(request: Request, env: Env, user: Record<string, unknown>) {
  const input = await request.json<{
    action: string;
    table: string;
    id?: string;
    payload?: Record<string, unknown> | Record<string, unknown>[];
    filters?: Record<string, unknown>;
    membershipFilters?: Record<string, unknown[]>;
    or?: string;
    order?: { column: string; ascending?: boolean };
    limit?: number;
  }>();
  if (!ownedTables.has(input.table) && !publicTables.has(input.table)) return response({ error: 'Unsupported data collection.' }, 400);
  if (publicTables.has(input.table)) return response({ data: [], count: 0 });
  const table = input.table;
  const filters = input.filters || {};
  if (input.action === 'select') {
    const rows = await env.DB.prepare('SELECT id,payload,created_at,updated_at FROM workspace_records WHERE user_id=? AND table_name=? ORDER BY created_at DESC')
      .bind(user.id, table).all<{ id: string; payload: string; created_at: string; updated_at: string }>();
    let data = rows.results.map(row => ({ ...JSON.parse(row.payload), id: row.id, user_id: user.id, created_at: row.created_at, updated_at: row.updated_at }));
    for (const [key, value] of Object.entries(filters)) data = data.filter(row => value === null ? row[key] == null : String(row[key]) === String(value));
    for (const [key, values] of Object.entries(input.membershipFilters || {})) {
      data = data.filter(row => values.some(value => String(row[key]) === String(value)));
    }
    if (input.or) {
      const match = /^([a-z_]+)\.is\.null,([a-z_]+)\.eq\.([a-zA-Z0-9_-]+)$/.exec(input.or);
      if (!match || match[1] !== match[2]) return response({ error: 'Unsupported OR filter.' }, 400);
      data = data.filter(row => row[match[1]] == null || String(row[match[2]]) === match[3]);
    }
    if (input.order?.column) data.sort((a, b) => String(a[input.order!.column] ?? '').localeCompare(String(b[input.order!.column] ?? '')) * (input.order?.ascending === false ? -1 : 1));
    const count = data.length;
    if (Number.isInteger(input.limit) && input.limit! >= 0) data = data.slice(0, Math.min(input.limit, 1000));
    return response({ data, count });
  }
  if (input.action === 'insert' || input.action === 'upsert') {
    const payloads = Array.isArray(input.payload) ? input.payload : [input.payload || {}];
    if (payloads.length > 500 || payloads.some(item => !item || typeof item !== 'object' || Array.isArray(item))) return response({ error: 'Invalid record payload.' }, 400);
    const inserted: Record<string, unknown>[] = [];
    for (const item of payloads) {
      const recordId = typeof item.id === 'string' && item.id ? item.id : id();
      const timestamp = now();
      const payload = { ...item, id: recordId, user_id: user.id };
      const statement = input.action === 'upsert' ? 'INSERT OR IGNORE' : 'INSERT';
      const result = await env.DB.prepare(`${statement} INTO workspace_records (id,user_id,table_name,payload,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
        .bind(recordId, user.id, table, JSON.stringify(payload), timestamp, timestamp).run();
      if (result.meta.changes) inserted.push({ ...payload, id: recordId, created_at: timestamp, updated_at: timestamp });
    }
    return response({ data: inserted, count: inserted.length });
  }
  if (input.action === 'update') { if (!input.id) return response({ error: 'Record id required.' }, 400); const found = await env.DB.prepare('SELECT payload,created_at FROM workspace_records WHERE id=? AND user_id=? AND table_name=?').bind(input.id, user.id, table).first<{ payload: string; created_at: string }>(); if (!found) return response({ error: 'Record not found.' }, 404); const timestamp = now(); const updatePayload = input.payload && !Array.isArray(input.payload) ? input.payload : {}; const payload = { ...JSON.parse(found.payload), ...updatePayload, id: input.id, user_id: user.id }; await env.DB.prepare('UPDATE workspace_records SET payload=?,updated_at=? WHERE id=? AND user_id=?').bind(JSON.stringify(payload), timestamp, input.id, user.id).run(); return response({ data: { ...payload, created_at: found.created_at, updated_at: timestamp } }); }
  if (input.action === 'delete') { if (!input.id) return response({ error: 'Record id required.' }, 400); await env.DB.prepare('DELETE FROM workspace_records WHERE id=? AND user_id=? AND table_name=?').bind(input.id, user.id, table).run(); return response({ data: null }); }
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
    if (supabaseStorage) {
      const result = await supabaseStorageRequest(supabaseStorage, `object/trading-media/${path.split('/').map(encodeURIComponent).join('/')}`, {
        method: 'POST',
        headers: { 'content-type': contentType, 'x-upsert': 'false' },
        body: bytes,
      });
      if (!result.ok) return mediaProviderError(result.status);
    } else if (env.MEDIA) {
      if (await env.MEDIA.head(path)) return response({ error: 'File already exists.' }, 409);
      await env.MEDIA.put(path, bytes, { httpMetadata: { contentType } });
    }
    return response({ path });
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
      return { paths, hasMore: entries.length === limit };
    },
    removeSupabase: async paths => {
      if (!supabaseStorage || !paths.length) return;
      const result = await supabaseStorageRequest(supabaseStorage, 'object/trading-media', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prefixes: paths.map(path => path.slice(ownerId.length + 1)) }),
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
}

async function adminRoute(request: Request, env: Env, user: Record<string, unknown>) {
  if (user.role !== 'admin' || user.account_status !== 'active') return response({ error: 'Administrator access required.' }, 403);
  const input = await request.json<{ action: string; targetUserId?: string }>();
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
  if (input.action === 'suspend') {
    const suspendedAt = now();
    await env.DB.prepare("UPDATE users SET account_status='suspended',suspended_at=?,suspension_expires_at=NULL,updated_at=? WHERE id=?")
      .bind(suspendedAt, suspendedAt, target.id).run();
    await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(target.id).run();
    await audit(env.DB, String(user.id), String(target.id), 'suspend', 'success');
    return response({ ok: true });
  }
  if (input.action === 'restore') {
    await env.DB.prepare("UPDATE users SET account_status='active',suspended_at=NULL,suspension_expires_at=NULL,updated_at=? WHERE id=?")
      .bind(now(), target.id).run();
    await audit(env.DB, String(user.id), String(target.id), 'restore', 'success');
    return response({ ok: true });
  }
  if (input.action === 'delete') {
    try {
      await cleanupMemberMedia(env, String(target.id));
    } catch {
      await audit(env.DB, String(user.id), String(target.id), 'delete', 'failed', { stage: 'media_cleanup' });
      return response({ error: 'Private media cleanup failed. The member account and records were retained; retry after checking storage configuration.' }, 502);
    }
    await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(target.id).run();
    await env.DB.prepare('DELETE FROM workspace_records WHERE user_id=?').bind(target.id).run();
    await audit(env.DB, String(user.id), String(target.id), 'delete', 'success', { records_deleted: true });
    await env.DB.prepare('DELETE FROM users WHERE id=?').bind(target.id).run();
    return response({ ok: true });
  }
  return response({ error: 'Unknown administration action.' }, 400);
}

export default { async fetch(request, env): Promise<Response> { const url = new URL(request.url); if (request.method === 'OPTIONS') return new Response(null, { status: 204 }); try { if (request.method === 'GET' && url.pathname === '/api/health') { const readiness = await env.DB.prepare('SELECT 1 AS ready').first<{ ready: number }>(); return readiness?.ready === 1 ? response({ status: 'ok', database: 'connected' }) : response({ status: 'unavailable', database: 'unavailable' }, 503); } if (request.method === 'POST' && (url.pathname === '/api/auth/signup' || url.pathname === '/api/auth/signin')) return authRoute(request, env, url.pathname); const user = await currentUser(request, env.DB); if (!user) return response({ error: 'Authentication required.' }, 401); if (user.account_status === 'suspended') return response({ error: 'Account suspended.' }, 403); if (request.method === 'GET' && url.pathname === '/api/me') return response({ user: profile(user) }); if (request.method === 'POST' && ['/api/auth/profile', '/api/auth/password', '/api/auth/signout'].includes(url.pathname)) return sessionRoute(request, env, user, url.pathname); if (request.method === 'POST' && url.pathname === '/api/data') return databaseRoute(request, env, user); if (url.pathname.startsWith('/api/media/')) return mediaRoute(request, env, user, url); if (request.method === 'POST' && url.pathname === '/api/admin') return adminRoute(request, env, user); return response({ error: 'Not found.' }, 404); } catch { return response({ error: 'The workspace service could not complete this request.' }, 500); } } } satisfies ExportedHandler<Env>;
