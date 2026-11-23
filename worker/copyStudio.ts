import {copyFleetOwner} from './copyFleet';
/**
 * Copy Studio — owner's simulation-only control plane.
 *
 * No order_send, copied orders, terminal actions, device commands, or execution
 * keys live here. A saved profile is permanently paused at the DB constraint.
 * Activating real copying requires a separate reviewed implementation/release.
 */
interface CopyEnv { DB: D1Database }
type RecordValue = Record<string, unknown>;
type Account = {
  id: string; account_id: string; device: string; company: string | null;
  login: string | null; server: string | null; trade_mode: number | null;
  access_level: string; monitoring_paused: number; last_sync: string | null;
  broker_balance: number | null; broker_equity: number | null; currency: string | null;
};
type Profile = {
  id: string; owner: string; name: string; source_link: string; follower_link: string;
  sizing_mode: string; multiplier: number; max_follower_lots: number;
  planned_max_daily_loss_pct: number; state: 'paused'; version: number;
  created_at: string; updated_at: string;
};
const json = (obj: unknown, status = 200) =>
  Response.json(obj, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
const fail = (message: string, status = 400) => json({ error: message }, status);
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const isObject = (x: unknown): x is RecordValue =>
  !!x && typeof x === 'object' && !Array.isArray(x);
const finite = (x: unknown, min: number, max: number): x is number =>
  typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max;
const uuidLike = (x: unknown): x is string =>
  typeof x === 'string' && /^[a-f0-9-]{30,50}$/i.test(x);
const decimalStep = (n: number) => Math.abs(Math.round(n * 100) - n * 100) < 0.00000001;

async function payload(request: Request): Promise<RecordValue | null> {
  if (Number(request.headers.get('content-length') || 0) > 8192) return null;
  const raw = await request.text();
  if (raw.length > 8192) return null;
  try { const parsed: unknown = JSON.parse(raw); return isObject(parsed) ? parsed : null; }
  catch { return null; }
}

async function availableAccounts(db: D1Database, owner: string): Promise<Account[]> {
  const rows = await db.prepare(
    "SELECT l.id,l.account_id,l.device,l.company,l.login,l.server,l.trade_mode,l.access_level," +
    "l.monitoring_paused,l.last_sync,l.broker_balance,l.broker_equity,l.currency " +
    "FROM mt5_links l JOIN mt5_devices d ON d.id=l.device " +
    "WHERE l.owner=? AND d.owner=? AND d.revoked=0 AND l.status='connected' AND l.trade_mode=0 " +
    "ORDER BY l.company,l.login,l.id"
  ).bind(owner, owner).all<Account>();
  return rows.results;
}

async function validatedPair(db: D1Database, owner: string, source: string, follower: string) {
  if (source === follower) return null;
  const accounts = await availableAccounts(db, owner);
  const first = accounts.find(account => account.id === source);
  const second = accounts.find(account => account.id === follower);
  return first && second ? { source: first, follower: second } : null;
}

export async function copyStudioRoute(request: Request, env: CopyEnv, owner: string): Promise<Response> {
  if (request.method !== 'POST') return fail('POST required.', 405);
  const action = new URL(request.url).pathname.slice('/api/copy/'.length);
  if (!['status','save','simulate','delete'].includes(action) && !action.startsWith('fleet-'))
    return fail('Not found.', 404);
  const input = await payload(request);
  if (!input) return fail('Invalid or oversized request.');
  if(action.startsWith('fleet-')) return copyFleetOwner(request,env,owner,action,input);
  const db = env.DB;

  if (action === 'status') {
    const [accounts, profiles, events] = await Promise.all([
      availableAccounts(db, owner),
      db.prepare('SELECT * FROM copy_profiles WHERE owner=? ORDER BY updated_at DESC LIMIT 30')
        .bind(owner).all<Profile>(),
      db.prepare('SELECT profile_id,event,details,created_at FROM copy_profile_events WHERE owner=? ORDER BY created_at DESC LIMIT 8')
        .bind(owner).all<{profile_id:string;event:string;details:string;created_at:string}>(),
    ]);
    return json({
      executionEnabled: false, mode: 'simulation-only',
      accounts, profiles: profiles.results, events: events.results,
      limits: { maximumProfiles: 20, maxMultiplier: 3, maxFollowerLots: 50 },
    });
  }

  if (action === 'save') {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (name.length < 2 || name.length > 64 || /\p{C}/u.test(name))
      return fail('Give this simulation a name between 2 and 64 characters.');
    if (!uuidLike(input.sourceLink) || !uuidLike(input.followerLink) ||
        input.sourceLink === input.followerLink)
      return fail('Choose two different, connected MT5 demo accounts.');
    if (!finite(input.multiplier, 0.10, 3) ||
        !finite(input.maxFollowerLots, 0.01, 50) || !decimalStep(input.maxFollowerLots) ||
        !finite(input.maxDailyLossPct, 0.25, 10))
      return fail('Check the multiplier, maximum lots, and planned daily-loss limit.');
    const pair = await validatedPair(db, owner, input.sourceLink, input.followerLink);
    if (!pair) return fail('Both accounts must be connected demos owned by this member.', 403);
    if (pair.source.currency && pair.follower.currency &&
        pair.source.currency !== pair.follower.currency)
      return fail('This preview requires the source and follower to use the same account currency.', 409);

    const timestamp = now();
    if (input.id !== undefined) {
      if (!uuidLike(input.id) || !Number.isSafeInteger(input.version) ||
          Number(input.version) < 1) return fail('An existing profile needs a valid version.');
      const updated = await db.prepare(
        "UPDATE copy_profiles SET name=?,source_link=?,follower_link=?,multiplier=?," +
        "max_follower_lots=?,planned_max_daily_loss_pct=?,version=version+1,updated_at=? " +
        "WHERE id=? AND owner=? AND version=? AND state='paused'"
      ).bind(name,input.sourceLink,input.followerLink,input.multiplier,
        input.maxFollowerLots,input.maxDailyLossPct,timestamp,input.id,owner,input.version).run();
      if (!updated.meta.changes) return fail('This draft has changed or is no longer available. Refresh before editing.', 409);
      return json({ ok: true, id: input.id, version: Number(input.version)+1, state: 'paused', executionEnabled: false });
    }

    const count = await db.prepare('SELECT COUNT(*) AS total FROM copy_profiles WHERE owner=?')
      .bind(owner).first<{ total: number }>();
    if ((count?.total || 0) >= 20) return fail('You have reached the 20-draft limit.', 409);
    const duplicate = await db.prepare(
      'SELECT id FROM copy_profiles WHERE owner=? AND source_link=? AND follower_link=?'
    ).bind(owner,input.sourceLink,input.followerLink).first<{id:string}>();
    if (duplicate) return fail('This source/follower pair already has a draft.', 409);
    const id = uuid();
    await db.prepare(
      "INSERT INTO copy_profiles(id,owner,name,source_link,follower_link,sizing_mode," +
      "multiplier,max_follower_lots,planned_max_daily_loss_pct,state,version,created_at,updated_at) " +
      "VALUES(?,?,?,?,?,'fixed_multiplier',?,?,?,'paused',1,?,?)"
    ).bind(id,owner,name,input.sourceLink,input.followerLink,input.multiplier,
      input.maxFollowerLots,input.maxDailyLossPct,timestamp,timestamp).run();
    return json({ ok: true, id, version: 1, state: 'paused', executionEnabled: false });
  }

  if (!uuidLike(input.id)) return fail('Choose a Copy Studio draft.');
  const profile = await db.prepare('SELECT * FROM copy_profiles WHERE id=? AND owner=?')
    .bind(input.id, owner).first<Profile>();
  if (!profile) return fail('This draft is not available in your workspace.', 404);

  if (action === 'delete') {
    if (!Number.isSafeInteger(input.version) || Number(input.version) !== profile.version)
      return fail('This draft changed. Refresh and try again.', 409);
    const deleted = await db.prepare("DELETE FROM copy_profiles WHERE id=? AND owner=? AND version=? AND state='paused'")
      .bind(profile.id, owner, profile.version).run();
    if (!deleted.meta.changes) return fail('This draft changed. Refresh and try again.', 409);
    return json({ ok: true, deleted: profile.id });
  }

  if (action === 'simulate') {
    if (!finite(input.sourceLots, 0.01, 100) || !decimalStep(input.sourceLots))
      return fail('Enter a hypothetical source position between 0.01 and 100.00 lots in 0.01 increments.');
    const pair = await validatedPair(db, owner, profile.source_link, profile.follower_link);
    if (!pair) return fail('One of these accounts is no longer a connected demo. No simulation was run.', 409);

    // This is an indicative quantity preview, not a broker order. Broker-specific
    // volume min/step/max, margin, current pricing, and fill risk are NOT known.
    // Rounding down to 0.01 is a display convention, not a valid lot-step guarantee.
    const raw = input.sourceLots * profile.multiplier;
    const capped = Math.min(raw, profile.max_follower_lots);
    const indicativeLots = Math.floor((capped + 1e-10) * 100) / 100;
    return json({
      simulation: true, executionEnabled: false, state: 'paused', brokerValidated: false,
      sourceLots: input.sourceLots, multiplier: profile.multiplier,
      uncappedLots: Number(raw.toFixed(6)), indicativeFollowerLots: indicativeLots,
      maximumLots: profile.max_follower_lots, cappedByPolicy: raw > profile.max_follower_lots,
      plannedMaxDailyLossPct: profile.planned_max_daily_loss_pct,
      dailyLossEnforced: false,
      followerTradeAccess: pair.follower.access_level,
      checks: [
        'Demo-account ownership verified',
        'Order sizing is indicative; MT5 instrument limits and margin are not checked',
        'Daily-loss threshold is a saved plan, not active enforcement',
        'No order is transmitted to a connector, MT5 terminal, or broker',
      ],
    });
  }
  return fail('Not found.', 404);
}
