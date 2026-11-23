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
  if (!['status','save','simulate','delete','group-status','group-save','group-preview','group-delete'].includes(action)) return fail('Not found.', 404);
  const input = await payload(request);
  if (!input) return fail('Invalid or oversized request.');
  const db = env.DB;

  // One-to-many copy policy control plane. Every group is kept paused by
  // schema and API; no pending device command or execution endpoint exists.
  if (action==='group-status') {
    const [accounts,groups,events]=await Promise.all([
      availableAccounts(db,owner),
      db.prepare('SELECT * FROM copy_groups WHERE owner=? ORDER BY updated_at DESC LIMIT 30')
        .bind(owner).all<{id:string;owner:string;name:string;source_link:string;followers:string;state:'paused';version:number;created_at:string;updated_at:string}>(),
      db.prepare('SELECT group_id,event,detail,recorded_at FROM copy_group_events WHERE owner=? ORDER BY recorded_at DESC LIMIT 15')
        .bind(owner).all(),
    ]);
    return json({executionEnabled:false,mode:'planning-only',maximumFollowers:20,accounts,
      groups:groups.results.map(row=>({...row,followers:JSON.parse(row.followers)})),
      events:events.results});
  }
  if(action==='group-save') {
    const name=typeof input.name==='string'?input.name.trim():'';
    if(name.length<2||name.length>64||/\p{C}/u.test(name))return fail('Use a group name between 2 and 64 characters.');
    if(!uuidLike(input.sourceLink)||!Array.isArray(input.followers)||input.followers.length<1||input.followers.length>20)
      return fail('Choose a verified source and 1 to 20 followers.');
    const all=await availableAccounts(db,owner);
    const source=all.find(a=>a.id===input.sourceLink);
    if(!source) return fail('Source must be a connected MT5 demo owned by this member.',403);
    const parsed=[] as {link:string;mode:string;value:number;maxLots:number;maxRiskPct:number}[];
    const ids=new Set<string>();
    for(const raw of input.followers){
      if(!isObject(raw)||!uuidLike(raw.link)||raw.link===input.sourceLink||ids.has(raw.link))
        return fail('Follower identities must be distinct and cannot include the source.');
      ids.add(raw.link);
      const account=all.find(a=>a.id===raw.link);
      if(!account)return fail('Each follower must be an owned, verified MT5 demo.',403);
      const mode=String(raw.mode||'');
      if(!['equity_percentage','balance_percentage','fixed_amount','balance_ratio','lot_multiplier'].includes(mode))
        return fail('Choose a supported sizing method for each follower.');
      if(!finite(raw.value,0.000001,1000000)||!finite(raw.maxLots,0.01,50)||
         !finite(raw.maxRiskPct,0.1,10)||!decimalStep(raw.maxLots))
        return fail('Invalid follower risk or maximum lot policy.');
      if((mode==='equity_percentage'||mode==='balance_percentage')&&raw.value>10)
        return fail('Risk percentage cannot exceed 10% of the follower capital.');
      if((mode==='balance_ratio'||mode==='lot_multiplier')&&raw.value>5)
        return fail('Scaling multiplier cannot exceed 5.');
      parsed.push({link:raw.link,mode,value:raw.value,maxLots:raw.maxLots,maxRiskPct:raw.maxRiskPct});
    }
    const ts=now();
    if(input.id!==undefined){
      if(!uuidLike(input.id)||!Number.isSafeInteger(input.version)||Number(input.version)<1)
        return fail('Editing a copy group requires a valid revision.');
      const changed=await db.prepare(`UPDATE copy_groups SET name=?,source_link=?,followers=?,version=version+1,updated_at=?
        WHERE id=? AND owner=? AND state='paused' AND version=?`).bind(name,input.sourceLink,JSON.stringify(parsed),ts,input.id,owner,input.version).run();
      if(!changed.meta.changes)return fail('Copy group changed in another session. Refresh.',409);
      return json({ok:true,id:input.id,version:Number(input.version)+1,state:'paused',executionEnabled:false});
    }
    const total=await db.prepare('SELECT COUNT(*) AS n FROM copy_groups WHERE owner=?').bind(owner).first<{n:number}>();
    if((total?.n??0)>=30)return fail('Maximum 30 paused groups.',409);
    const id=uuid();
    await db.prepare(`INSERT INTO copy_groups(id,owner,name,source_link,followers,state,version,created_at,updated_at)
      VALUES(?,?,?,?,?,'paused',1,?,?)`).bind(id,owner,name,input.sourceLink,JSON.stringify(parsed),ts,ts).run();
    return json({ok:true,id,version:1,state:'paused',executionEnabled:false});
  }
  if(action==='group-delete'||action==='group-preview'){
    if(!uuidLike(input.id))return fail('Select a saved multi-follower group.');
    const group=await db.prepare('SELECT * FROM copy_groups WHERE id=? AND owner=?')
      .bind(input.id,owner).first<{id:string;owner:string;source_link:string;followers:string;state:'paused';version:number}>();
    if(!group)return fail('Copy group not found in your account.',404);
    if(action==='group-delete'){
      if(!Number.isSafeInteger(input.version)||input.version!==group.version)return fail('Group revision changed.',409);
      const result=await db.prepare("DELETE FROM copy_groups WHERE id=? AND owner=? AND version=? AND state='paused'")
        .bind(group.id,owner,group.version).run();
      return result.meta.changes?json({ok:true,deleted:group.id}):fail('Group revision changed.',409);
    }
    const sources=await availableAccounts(db,owner);
    const source=sources.find(x=>x.id===group.source_link);
    const targets=JSON.parse(group.followers) as {link:string;mode:string;value:number;maxLots:number;maxRiskPct:number}[];
    if(!source||targets.some(t=>!sources.some(x=>x.id===t.link)))
      return fail('A source or follower demo disconnected. Revalidate before simulation.',409);
    if(!finite(input.sourceLots,0.01,100)||!decimalStep(input.sourceLots)||
       !isObject(input.lossPerLot))
      return fail('Supply a hypothetical source volume and follower loss per lot in each account currency.');
    const results=[];
    for(const t of targets){
      const follower=sources.find(x=>x.id===t.link)!;
      const perLot=input.lossPerLot[t.link];
      if(!finite(perLot,0.000001,100000000))
        return fail('Each follower needs a positive hypothetical currency loss per lot.');
      const equity=follower.broker_equity,balance=follower.broker_balance;
      if(!finite(equity,0.01,1e15)||!finite(balance,0.01,1e15))
        return fail('Follower broker balance and equity must be fresh, positive figures.',409);
      let unconstrained=0;
      if(t.mode==='equity_percentage')unconstrained=(equity*t.value/100)/perLot;
      if(t.mode==='balance_percentage')unconstrained=(balance*t.value/100)/perLot;
      if(t.mode==='fixed_amount')unconstrained=t.value/perLot;
      if(t.mode==='balance_ratio'){
        if(!finite(source.broker_balance,0.01,1e15))return fail('Source broker balance unavailable.',409);
        unconstrained=input.sourceLots*(balance/source.broker_balance)*t.value;
      }
      if(t.mode==='lot_multiplier')unconstrained=input.sourceLots*t.value;
      const byRisk=equity*t.maxRiskPct/100/perLot;
      const capped=Math.min(unconstrained,t.maxLots,byRisk);
      const lots=Math.floor((capped+1e-10)*100)/100;
      results.push({link:t.link,currency:follower.currency,mode:t.mode,
        indicativeLots:lots,requestedLots:Number(unconstrained.toFixed(6)),
        estimatedLoss:Number((lots*perLot).toFixed(2)),estimatedRiskPct:Number((lots*perLot/equity*100).toFixed(4)),
        capped:lots<unconstrained,unavailable:lots<0.01,
        volumeStepAssumed:0.01,lossPerLotAssumed:perLot});
    }
    return json({simulation:true,brokerValidated:false,executionEnabled:false,state:'paused',
      accountCount:results.length,results,warnings:[
        'All per-lot losses are hypothetical values supplied by the user, NOT broker quotes.',
        'Broker symbol mapping, stop distances, minimum lots, margin, FX conversion and filling are not checked.',
        'Do not treat this preview as permission to trade: only the local MT5 execution agent can validate live broker inputs.'
      ]});
  }

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
