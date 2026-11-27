import {copyFleetDevice} from './copyFleetDevice';
import {optionalBrokerDirectory} from './brokerDirectory';
interface Bindings { DB: D1Database; MT5_ALLOW_LIVE?: string; MT5_ALLOW_LIVE_COPY?: string; MT5_LIVE_COPY_EXECUTION?:string }
type Fields = Record<string, unknown>;
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (message: string, status = 400) => json({ error: message }, status);
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const hash = async (value: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(x => x.toString(16).padStart(2, '0')).join('');
const limited = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const isObject = (v: unknown): v is Fields => v !== null && typeof v === 'object' && !Array.isArray(v);
const timestamp = (v: unknown): v is string => limited(v, 40) && Number.isFinite(Date.parse(v));
const sortedEvidenceJson = (value: unknown): string => {
  // Preserve array ordering, values and number/string types; sort only object keys.
  const sorted = (entry: unknown): unknown => Array.isArray(entry) ? entry.map(sorted)
    : isObject(entry) ? Object.fromEntries(Object.keys(entry).sort().map(key => [key,sorted(entry[key])])) : entry;
  return JSON.stringify(sorted(value));
};
const changedEvidenceFields = (oldFields: unknown, nextFields: Fields) => {
  if (!isObject(oldFields)) return ['record_shape'];
  return [...new Set([...Object.keys(oldFields),...Object.keys(nextFields)])]
    .filter(key=>sortedEvidenceJson(oldFields[key])!==sortedEvidenceJson(nextFields[key]))
    .sort().slice(0,100);
};

const installationId = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const pcLabel = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const name=v.trim();
  return name.length>=2 && name.length<=48 && /^[\p{L}\p{N}][\p{L}\p{N} ._()'&·–-]*$/u.test(name) ? name : null;
};
async function body(request: Request): Promise<Fields | null> {
  const reader = request.body?.getReader();
  if (!reader) return {};
  const decoder = new TextDecoder();
  let size = 0, content = '';
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 196608) { await reader.cancel(); return null; }
    content += decoder.decode(chunk.value, { stream: true });
  }
  try { const parsed: unknown = JSON.parse(content + decoder.decode()); return isObject(parsed) ? parsed : null; }
  catch { return null; }
}

export async function mt5Route(request: Request, env: Bindings, owner: string | null): Promise<Response> {
  const action = new URL(request.url).pathname.slice('/api/mt5/'.length);
  if (request.method !== 'POST') return fail('POST required.', 405);
  const db = env.DB;
  const q = (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args);
  const parsed = await body(request);
  if (!parsed) return fail('Invalid connector request.');
  const input: Fields = parsed;
  const unix = Date.now();
  // Live account capture is independently gated from explicit local order consent.
  // The copy pilot flag does not, by itself, enable trading or arm any fleet.
  const liveAccountCaptureAllowed = env.MT5_ALLOW_LIVE==='true'||env.MT5_ALLOW_LIVE_COPY==='true';
  const capturePaused = async () => {
    const setting=await q("SELECT value FROM site_settings WHERE key='mt5_capture_paused'").first<{value:string}>();
    return setting?.value==='true';
  };
  const HISTORY_EPOCH = 0; // Earliest MT5/Unix-compatible broker timestamp.
  const remainingReviews=(link:string)=>q("SELECT COUNT(DISTINCT lifecycle_id) AS n FROM mt5_position_versions v WHERE v.link=? AND NOT EXISTS (SELECT 1 FROM workspace_records w WHERE w.id='review/'||v.owner||'/position/'||v.link||'/'||v.lifecycle_id AND w.user_id=v.owner AND w.table_name='decision_reviews')",link).first<{n:number}>();
  async function setMonitoring(ownerId: string, deviceId: string | null = null) {
    if (!limited(input.link,64) || typeof input.paused !== 'boolean') return fail('Choose an account and monitoring state.');
    const changed = await q(`UPDATE mt5_links SET monitoring_paused=?,
      retry_requested_at=CASE WHEN ? THEN NULL ELSE COALESCE(retry_requested_at,?) END
      WHERE id=? AND owner=? AND status='connected' AND (? IS NULL OR device=?) AND device IN
      (SELECT id FROM mt5_devices WHERE owner=? AND revoked=0)`,
      Number(input.paused),Number(input.paused),now(),input.link,ownerId,deviceId,deviceId,ownerId).run();
    return changed.meta.changes ? json({ok:true}) : fail('Account unavailable.',404);
  }
  if (owner) {
    if(action==='broker-directory') {
      // The unverified broker catalogue is a convenience only. Never forward
      // account credentials, device tokens, account numbers or request payloads.
      return json(await optionalBrokerDirectory());
    }
    if (action === 'status') {
      const devices = await q('SELECT id,pc_name,public_key,last_seen,setup_state,connector_version FROM mt5_devices WHERE owner=? AND revoked=0 AND public_key IS NOT NULL', owner).all();
      const links = await q('SELECT l.device,l.monitoring_paused,l.retry_requested_at,l.capture_health,l.id,l.account_id,l.status,l.company,l.server,l.login,l.access_level,l.trade_mode,l.history_id,l.history_status,l.history_since,l.history_authorized_since,l.history_mode,l.history_anchor_at,l.history_anchor_ticket,l.history_anchor_amount,l.history_scanned_until,l.cash_history_cursor,l.cash_history_completed_at,l.last_sync,l.broker_balance,l.broker_equity,l.currency,l.gap,l.last_error,l.expires,l.broker_timezone,l.timezone_confirmed_at,l.timezone_source,l.utc_conversion_status FROM mt5_links l JOIN mt5_devices d ON d.id=l.device WHERE d.owner=? AND d.revoked=0', owner).all();
      const accounts=await q("SELECT id,json_extract(payload,'$.name') AS name FROM workspace_records WHERE user_id=? AND table_name='trading_accounts' ORDER BY created_at",owner).all();
      const states=await Promise.all(links.results.map(async link=>({
        ...link,
        pending_reviews:(await remainingReviews(String(link.id)))?.n??0,
        evidence_conflicts_pending:(await q(`SELECT COUNT(*) AS n FROM mt5_evidence_conflicts c WHERE c.link=? AND c.owner=? AND c.review_status='needs_review'
        AND NOT EXISTS (SELECT 1 FROM mt5_conflict_classifications k
          WHERE k.link=c.link AND k.event_key=c.event_key AND k.candidate_sha256=c.candidate_sha256)`,link.id,owner).first<{n:number}>())?.n??0,
        connector_spec_artifacts:(await q("SELECT COUNT(*) AS n FROM mt5_conflict_classifications WHERE link=? AND owner=?",link.id,owner).first<{n:number}>())?.n??0,
        recovery:(await q("SELECT state,scanned_through,target_at,unresolved_positions,unobserved_stop_changes,updated_at FROM mt5_recovery_status WHERE link=? AND owner=?",link.id,owner).first())??null
      })));
      const discoveries=await q(`SELECT a.device,a.slot,a.login,a.server,a.account_name,a.company,a.currency,a.trade_mode,a.last_seen,
        l.id AS link,l.status AS link_status FROM mt5_discovered_accounts a
        JOIN mt5_devices d ON d.id=a.device AND d.owner=a.owner AND d.revoked=0
        LEFT JOIN mt5_discovery_approvals v ON v.device=a.device AND v.slot=a.slot AND v.link=(SELECT a2.link FROM mt5_discovery_approvals a2 WHERE a2.device=a.device AND a2.slot=a.slot ORDER BY a2.requested_at DESC LIMIT 1)
        LEFT JOIN mt5_links l ON l.id=v.link AND l.owner=a.owner
        WHERE a.owner=? ORDER BY a.last_seen DESC LIMIT 256`, owner).all();
      const scans=await q('SELECT device,requested_at,completed_at,request_id FROM mt5_device_scans WHERE owner=?',owner).all();
      return json({ accounts:accounts.results, devices: devices.results, links: states,
        discoveries:discoveries.results, scans:scans.results,
        demoOnly: !liveAccountCaptureAllowed, capturePaused: await capturePaused() });
    }

    // Explicit owner request: asks the paired Windows app to inspect its own
    // already-open MT5 terminals. This does not authorize monitoring or orders.
    if (action === 'scan-local-accounts') {
      if (!limited(input.device,64)) return fail('Choose a paired computer.');
      const pc=await q('SELECT id FROM mt5_devices WHERE id=? AND owner=? AND revoked=0 AND public_key IS NOT NULL AND last_seen>?',input.device,owner,unix-90000).first();
      if (!pc) return fail('Open Signal Desk on that PC before scanning.',409);
      const requestId=uuid();
      await q(`INSERT INTO mt5_device_scans(device,owner,request_id,requested_at,completed_at)
        VALUES(?,?,?,?,NULL)
        ON CONFLICT(device) DO UPDATE SET request_id=excluded.request_id,
        requested_at=excluded.requested_at,completed_at=NULL`,
        input.device,owner,requestId,unix).run();
      return json({ok:true,request:requestId,state:'requested'});
    }
    if (action === 'monitor-discovered-account') {
      if (!limited(input.device,64)||!limited(input.slot,64)||input.monitor!==true)
        return fail('Choose a discovered account and confirm monitoring.');
      if(await capturePaused()) return fail('Account monitoring is paused by your administrator.',403);
      const found=await q(`SELECT a.login,a.server,a.trade_mode,a.last_seen
        FROM mt5_discovered_accounts a JOIN mt5_devices d ON d.id=a.device
        WHERE a.owner=? AND a.device=? AND a.slot=? AND d.owner=? AND d.revoked=0
        AND d.public_key IS NOT NULL AND d.last_seen>?`,
        owner,input.device,input.slot,owner,unix-90000).first<{login:string;server:string;trade_mode:number;last_seen:number}>();
      if(!found||found.last_seen<unix-5*60*1000) return fail('Account verification is stale. Scan the device again.',409);
      if(found.trade_mode===2&&!liveAccountCaptureAllowed) return fail('Real-account read-only capture requires staging approval.',403);
      const pendingSlot=await q(`SELECT a.link FROM mt5_discovery_approvals a JOIN mt5_links l ON l.id=a.link WHERE a.device=? AND a.slot=? AND l.status='verifying' AND l.expires>?`,input.device,input.slot,unix).first();
      if(pendingSlot) return fail('This local MT5 login is already awaiting confirmation.',409);
      const existing=await q(`SELECT l.id FROM mt5_links l JOIN mt5_devices d ON d.id=l.device
        WHERE d.owner=? AND d.revoked=0 AND l.login=? AND l.server=?
        AND (l.status='connected' OR (l.status='verifying' AND l.expires>?))`,
        owner,found.login,found.server,unix).first();
      if(existing) return fail('This broker login is already linked or awaiting local approval.',409);
      if(input.account!==undefined&&(!limited(input.account,100)||
          !await q("SELECT id FROM workspace_records WHERE user_id=? AND table_name='trading_accounts' AND id=?",owner,input.account).first()))
        return fail('Choose one of your existing journal accounts.');
      const id=uuid(),accountId=input.account||uuid(),expires=unix+30*60*1000;
      await db.batch([
        q(`INSERT INTO mt5_links(id,device,owner,account_id,status,expires,server,monitoring_paused)
          VALUES(?,?,?,?,?,?,?,0)`,id,input.device,owner,accountId,'verifying',expires,found.server),
        q(`INSERT INTO mt5_discovery_approvals(link,device,owner,slot,login,server,requested_at)
          VALUES(?,?,?,?,?,?,?)`,id,input.device,owner,input.slot,found.login,found.server,unix),
      ]);
      return json({ok:true,link:id,state:'awaiting_local_verification',monitoring:false,
        message:'Selection saved. Signal Desk must verify this same MT5 login before capture starts.'});
    }
    if (action === 'evidence-conflicts') {
      if (!limited(input.link,64)) return fail('Select a connected MT5 account.');
      const account=await q("SELECT l.id FROM mt5_links l JOIN mt5_devices d ON d.id=l.device WHERE l.id=? AND l.owner=? AND d.owner=? AND d.revoked=0 AND l.status='connected'",
        input.link,owner,owner).first();
      if(!account) return fail('Broker account unavailable.',404);
      const items=await q(`SELECT event_key,evidence_kind,changed_fields,original_sha256,candidate_sha256,recorded_at,review_status
        FROM mt5_evidence_conflicts c WHERE c.link=? AND c.owner=? AND c.review_status='needs_review'
        AND NOT EXISTS (SELECT 1 FROM mt5_conflict_classifications k
          WHERE k.link=c.link AND k.event_key=c.event_key AND k.candidate_sha256=c.candidate_sha256) ORDER BY c.recorded_at DESC,c.event_key LIMIT 101`,input.link,owner)
        .all<{event_key:string;evidence_kind:string;changed_fields:string;original_sha256:string;candidate_sha256:string;recorded_at:string;review_status:string}>();
      return json({rows:items.results.slice(0,100).map(item=>({
        event_key:item.event_key,evidence_kind:item.evidence_kind,
        changed_fields:JSON.parse(item.changed_fields),recorded_at:item.recorded_at,
        review_status:item.review_status,
        original_fingerprint:item.original_sha256.slice(0,12),
        candidate_fingerprint:item.candidate_sha256.slice(0,12),
      })),has_more:items.results.length>100});
    }
    if (action === 'cash-review') {
      if(!limited(input.link,64) || !limited(input.ticket,24) || !/^\d+$/.test(String(input.ticket)))
        return fail('Select a broker balance transaction.');
      const category=String(input.classification||'');
      if(!['external_deposit','external_withdrawal','broker_adjustment','internal_transfer','unresolved'].includes(category))
        return fail('Choose what this balance transaction represents.');
      const statement=typeof input.statementReference==='string'?input.statementReference.trim():'';
      const note=typeof input.note==='string'?input.note.trim():'';
      if(statement.length>120 || note.length>320 || input.confirm!==true)
        return fail('Review the broker record and confirm your classification.');
      if((category==='external_deposit'||category==='external_withdrawal') && statement.length<3)
        return fail('Provide a statement reference before confirming external money movement.');
      const movement=await q(`SELECT c.ticket,c.direction FROM mt5_cash_movements c
        JOIN mt5_links l ON l.id=c.link JOIN mt5_devices d ON d.id=l.device
        WHERE c.link=? AND c.ticket=? AND c.owner=? AND d.owner=? AND d.revoked=0
          AND l.status='connected'`,input.link,input.ticket,owner,owner)
        .first<{ticket:string;direction:string}>();
      if(!movement) return fail('This broker transaction is unavailable.',404);
      if((category==='external_deposit'&&movement.direction!=='in') ||
         (category==='external_withdrawal'&&movement.direction!=='out'))
        return fail('This category disagrees with the broker transaction sign.');
      const reviewedAt=now();
      await db.batch([
        q(`INSERT INTO mt5_cash_reviews(link,ticket,owner,classification,statement_reference,note,attested_at,revision)
           VALUES(?,?,?,?,?,?,?,1)
           ON CONFLICT(link,ticket) DO UPDATE SET classification=excluded.classification,
             statement_reference=excluded.statement_reference,note=excluded.note,
             attested_at=excluded.attested_at,revision=mt5_cash_reviews.revision+1
           WHERE mt5_cash_reviews.owner=excluded.owner`,
          input.link,input.ticket,owner,category,statement||null,note||null,reviewedAt),
        q(`INSERT INTO mt5_cash_review_events
           (id,link,ticket,owner,classification,statement_reference,note,revision,attested_at)
           SELECT ?,link,ticket,owner,classification,statement_reference,note,revision,attested_at
           FROM mt5_cash_reviews WHERE link=? AND ticket=? AND owner=?`,
          uuid(),input.link,input.ticket,owner)
      ]);
      return json({ok:true,classification:category,reviewedAt});
    }
    if (action === 'cash-movements') {
      if(!limited(input.link,64)) return fail('Select a linked broker account.');
      const account=await q(`SELECT l.id,l.currency,l.broker_balance,l.broker_equity,l.linked_at,
        l.cash_history_cursor,l.cash_history_completed_at,l.performance_baseline_balance,
        l.performance_baseline_equity,l.performance_baseline_at,l.gap,l.utc_conversion_status
        FROM mt5_links l JOIN mt5_devices d ON d.id=l.device
        WHERE l.id=? AND d.owner=? AND d.revoked=0 AND l.status='connected'`,
        input.link,owner).first<{id:string;currency:string;broker_balance:number|null;
        broker_equity:number|null;linked_at:string;cash_history_cursor:number|null;cash_history_completed_at:string|null;
        performance_baseline_balance:number|null;performance_baseline_equity:number|null;performance_baseline_at:string|null;
        gap:number;utc_conversion_status:string|null}>();
      if(!account) return fail('Linked broker account unavailable.',404);
      const offset=Number(input.offset??0);
      if(!Number.isSafeInteger(offset)||offset<0||offset>100000) return fail('Invalid cash ledger page.');
      const page=await q(`SELECT c.ticket,c.amount,c.currency,c.direction,c.classification,c.broker_time_msc,c.recorded_at,
         r.classification AS reviewed_classification,r.statement_reference,r.note,r.attested_at,r.revision
         FROM mt5_cash_movements c LEFT JOIN mt5_cash_reviews r
           ON r.link=c.link AND r.ticket=c.ticket AND r.owner=c.owner
         WHERE c.link=? AND c.owner=?
         ORDER BY c.broker_time_msc DESC,c.ticket DESC LIMIT 51 OFFSET ?`,
         account.id,owner,offset).all();
      const totals=await q(`SELECT COUNT(*) AS count,
         SUM(CASE WHEN direction='in' THEN CAST(amount AS REAL) ELSE 0 END) AS incoming,
         SUM(CASE WHEN direction='out' THEN CAST(amount AS REAL) ELSE 0 END) AS outgoing
         FROM mt5_cash_movements WHERE link=? AND owner=?`,account.id,owner)
         .first<{count:number;incoming:number|null;outgoing:number|null}>();
      const baselineAt=account.performance_baseline_at?Date.parse(account.performance_baseline_at):null;
      // Before-link credits remain visible, but must not be subtracted again.
      // The MT5 raw timestamp's broker-clock offset requires account verification.
      const sinceBaseline=baselineAt===null ? null : await q(`SELECT
        COUNT(*) AS count,
        SUM(CASE WHEN r.classification IN ('external_deposit','external_withdrawal')
          THEN CAST(c.amount AS REAL) ELSE 0 END) AS reviewed_external_net,
        SUM(CASE WHEN r.classification IN ('external_deposit','external_withdrawal','internal_transfer','broker_adjustment')
          THEN CAST(c.amount AS REAL) ELSE 0 END) AS reviewed_nontrading_net,
        SUM(CASE WHEN r.classification IS NULL OR r.classification='unresolved' THEN 1 ELSE 0 END) AS unresolved
        FROM mt5_cash_movements c LEFT JOIN mt5_cash_reviews r
          ON r.link=c.link AND r.ticket=c.ticket AND r.owner=c.owner
        WHERE c.link=? AND c.owner=? AND c.broker_time_msc>=?`,
        account.id,owner,baselineAt)
        .first<{count:number;reviewed_external_net:number|null;reviewed_nontrading_net:number|null;unresolved:number|null}>();
      const pending=sinceBaseline?.unresolved??null;
      const externalNet=sinceBaseline?.reviewed_external_net??0;
      // Internal transfers and broker adjustments change cash, not trade P&L.
      // Preserve external-only net independently for statement reconciliation.
      const nonTradingNet=sinceBaseline?.reviewed_nontrading_net??0;
      const deltaBalance=account.broker_balance===null||account.performance_baseline_balance===null
        ?null:account.broker_balance-account.performance_baseline_balance-nonTradingNet;
      const deltaEquity=account.broker_equity===null||account.performance_baseline_equity===null
        ?null:account.broker_equity-account.performance_baseline_equity-nonTradingNet;
      const cashIn=totals?.incoming??0,cashOut=totals?.outgoing??0;
      const netCash=cashIn+cashOut;
      const fullyScanned=Boolean(account.cash_history_completed_at);
      return json({
        link:account.id,currency:account.currency,rows:page.results.slice(0,50),
        nextOffset:offset+Math.min(50,page.results.length),more:page.results.length>50,
        summary:{count:totals?.count??0,incoming:cashIn,outgoing:Math.abs(cashOut),
          netCashFlow:netCash,brokerBalance:account.broker_balance,brokerEquity:account.broker_equity,
          cashAdjustedBalance:account.broker_balance==null?null:account.broker_balance-netCash,
          cashAdjustedEquity:account.broker_equity==null?null:account.broker_equity-netCash,
          scanStatus:fullyScanned?'epoch_scanned':account.cash_history_cursor==null?'not_started':'scanning',
          cursor:account.cash_history_cursor,scanCompletedAt:account.cash_history_completed_at,
          linkedPeriod:{
            baselineAt:account.performance_baseline_at,
            openingBalance:account.performance_baseline_balance,
            openingEquity:account.performance_baseline_equity,
            reviewedExternalNet:externalNet,reviewedNonTradingNet:nonTradingNet,
            unresolvedMovements:pending,reviewedCount:sinceBaseline?.count??null,
            deltaBalance:pending===0?deltaBalance:null,
            deltaEquity:pending===0?deltaEquity:null,
            status:baselineAt===null?'awaiting_baseline':pending!==0?'review_required':
              account.gap?'capture_gap':account.utc_conversion_status!=='confirmed'?'timezone_unverified':'indicative',
            independentlyVerified:false,
            basis:'Change since first observed snapshot, less owner-attested deposits, withdrawals, internal transfers and broker adjustments. Not verified lifetime P&L.'
          },
          // A DEAL_TYPE_BALANCE credit may be a broker correction; neither this
          // nor subtracting cash flow proves profit since account inception.
          externalFlowsVerified:false, overallProfitVerified:false,
          methodology:'Balance operations include potential deposits, withdrawals and corrections. Confirm against broker statements. Cash-adjusted values are not verified lifetime P&L.'}
      });
    }
    if (action === 'set-monitoring') return setMonitoring(owner);
    if (action === 'rename-pc') {
      if (!limited(input.device,64)) return fail('Choose a paired PC.');
      const name=pcLabel(input.name);
      if (!name) return fail('Choose a PC name between 2 and 48 characters, using letters, numbers or common punctuation.');
      const renamed=await q("UPDATE mt5_devices SET pc_name=? WHERE id=? AND owner=? AND revoked=0 AND public_key IS NOT NULL",
        name,input.device,owner).run();
      return renamed.meta.changes ? json({ok:true,device:input.device,name}) : fail('Paired PC unavailable.',404);
    }
    if (action === 'remove-failed' || action === 'clear-failed') {
      // Failed/expired requests are metadata, not journal accounts. Never
      // delete a connected link, broker evidence, or already imported fills.
      const evidenceGuard = `NOT EXISTS (SELECT 1 FROM mt5_events e WHERE e.link=mt5_links.id)
        AND NOT EXISTS (SELECT 1 FROM mt5_raw_evidence r WHERE r.link=mt5_links.id)
        AND NOT EXISTS (SELECT 1 FROM mt5_position_versions v WHERE v.link=mt5_links.id)`;
      if (action === 'remove-failed' && !limited(input.link,64)) return fail('Choose a failed account attempt.');
      const sql = `DELETE FROM mt5_links WHERE owner=? AND status IN ('failed','expired')
        AND device IN (SELECT id FROM mt5_devices WHERE owner=? AND revoked=0)
        ${action === 'remove-failed' ? 'AND id=?' : ''}
        AND ${evidenceGuard}`;
      const result = await q(sql,...(action==='remove-failed'?[owner,owner,input.link]:[owner,owner])).run();
      if (action==='remove-failed' && !result.meta.changes)
        return fail('Only your failed or expired attempts without broker evidence can be removed.',409);
      return json({ok:true,removed:result.meta.changes});
    }
    if(action==='retry-session'){
      if(!limited(input.link,64))return fail('Choose a linked account.');
      if(await capturePaused())return fail('Capture is paused in staging.',409);
      const result=await q("UPDATE mt5_links SET retry_requested_at=COALESCE(retry_requested_at,?) WHERE id=? AND owner=? AND status='connected' AND monitoring_paused=0 AND device IN (SELECT id FROM mt5_devices WHERE owner=? AND revoked=0)",now(),input.link,owner,owner).run();
      return result.meta.changes?json({ok:true}):fail('Account unavailable.',404);
    }
    if (action === 'timezone-confirm') {
      if(!limited(input.link,64) || !limited(input.timezone,96) || input.confirm!==true)
        return fail('Choose a broker timezone and explicitly confirm it.');
      const linked=await q("SELECT l.id FROM mt5_links l JOIN mt5_devices d ON d.id=l.device WHERE l.id=? AND d.owner=? AND d.revoked=0 AND l.status='connected'",input.link,owner).first();
      if(!linked) return fail('Linked account unavailable.',404);
      try { new Intl.DateTimeFormat('en-US',{timeZone:String(input.timezone)}).format(new Date()); }
      catch { return fail('Use a valid IANA timezone (for example Europe/Athens).'); }
      // Confirming a timezone alone does NOT verify the broker's historical
      // conversion of MT5 raw timestamps. A separate attestation is required.
      const conversion=input.utcEvidence==='broker_statement_checked'?'confirmed':'unverified';
      await q("UPDATE mt5_links SET broker_timezone=?,timezone_confirmed_at=?,timezone_source='account_owner',utc_conversion_status=? WHERE id=?",
        input.timezone,now(),conversion,input.link).run();
      return json({ok:true,utc_conversion_status:conversion});
    }
    if (action === 'positions') {
      const offset=Number(input.offset ?? 0);
      if(!Number.isSafeInteger(offset)||offset<0||offset>10000) return fail('Invalid page.');
      const rows=await q(`SELECT latest.link,latest.account_id,latest.lifecycle_id,latest.version,latest.recorded_at,latest.payload
        FROM (
          SELECT v.*,ROW_NUMBER() OVER(PARTITION BY v.link,v.lifecycle_id ORDER BY v.version DESC) AS rn
          FROM mt5_position_versions v
          JOIN mt5_links l ON l.id=v.link JOIN mt5_devices d ON d.id=l.device
          WHERE v.owner=? AND l.owner=? AND d.owner=? AND d.revoked=0
        ) latest WHERE latest.rn=1 ORDER BY latest.recorded_at DESC LIMIT 101 OFFSET ?`,
        owner,owner,owner,offset).all<{link:string;account_id:string;lifecycle_id:string;version:number;recorded_at:string;payload:string}>();
      const page=rows.results.slice(0,100);
      return json({rows:page.map(row=>({...row,summary:JSON.parse(row.payload),payload:undefined})),
        more:rows.results.length>100,nextOffset:offset+page.length});
    }
    if (action === 'position-evidence') {
      if(!limited(input.link,64)||!limited(input.lifecycle_id,80))
        return fail('Choose a linked position.');
      const access=await q('SELECT 1 FROM mt5_links l JOIN mt5_devices d ON d.id=l.device WHERE l.id=? AND l.owner=? AND d.owner=? AND d.revoked=0',input.link,owner,owner).first();
      if(!access) return fail('Linked account unavailable.',404);
      const id=String(input.lifecycle_id).split(':')[0];
      if(!/^\d+$/.test(id)) return fail('Invalid position identity.');
      const evidence=await q("SELECT event_key,evidence_kind,payload,sha256,recorded_at FROM mt5_raw_evidence WHERE link=? AND owner=? AND (json_extract(payload,'$.position_id')=? OR json_extract(payload,'$.identifier')=?) ORDER BY recorded_at,event_key LIMIT 101",input.link,owner,id,id).all<{event_key:string;evidence_kind:string;payload:string;sha256:string;recorded_at:string}>();
      return json({rows:evidence.results.slice(0,100).map(row=>({...row,payload:JSON.parse(row.payload)})),more:evidence.results.length>100});
    }
    if (['history-request','history-preview','history-import','history-decline'].includes(action)) {
      const link=await q("SELECT l.* FROM mt5_links l JOIN mt5_devices d ON d.id=l.device WHERE l.id=? AND d.owner=? AND d.revoked=0 AND l.status='connected'",input.link,owner).first<{id:string;account_id:string;currency:string;company:string;linked_at:string;history_id:string;history_status:string;history_since:number|null;history_authorized_since:number|null;history_mode:string;history_anchor_at:number|null;trade_mode:number|null;monitoring_paused:number}>();
      if(!link) return fail('Linked account unavailable.',404);
      if (action==='history-request' && link.monitoring_paused) return fail('Resume monitoring before requesting a scan.',409);
      if(['history-request','history-import'].includes(action) && await capturePaused())
        return fail('MT5 capture is paused by the administrator.',403);
      if(link.trade_mode===2 && !liveAccountCaptureAllowed && ['history-request','history-import'].includes(action))
        return fail('Real-account capture is paused by the release gate.',403);
      if(action==='history-request') {
        if(link.history_status==='requested' || link.history_status==='resolving')
          return fail('History scan already running.',409);
        if(!timestamp(link.linked_at)) return fail('The linked account has no valid start time.',409);
        const linkedAt=Date.parse(link.linked_at);
        const mode=String(input.mode ?? 'days');
        if(!['days','from_date','all','since_last_deposit','since_first_deposit'].includes(mode))
          return fail('Choose a supported history range.');
        let since:number|null=null;
        if(mode==='days') {
          const days=Number(input.days);
          if(!Number.isSafeInteger(days)||days<1||days>36525) return fail('Choose 1–36,525 days or another history mode.');
          since=Math.max(HISTORY_EPOCH,linkedAt-days*86400000);
        } else if(mode==='from_date') {
          if(typeof input.since!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input.since))
            return fail('Choose an exact history start date (YYYY-MM-DD).');
          since=Date.parse(input.since+'T00:00:00.000Z');
          if(!Number.isSafeInteger(since)||new Date(since).toISOString().slice(0,10)!==input.since)
            return fail('Choose a real history start date.');
        } else if(mode==='all') {
          since=HISTORY_EPOCH;
        }
        if(since!==null && (since<HISTORY_EPOCH||since>=linkedAt))
          return fail('History must begin before this account was linked.');
        const requestId=uuid(),status=since===null?'resolving':'requested';
        const created=await q(`UPDATE mt5_links SET history_id=?,history_status=?,history_since=?,history_authorized_since=?,history_mode=?,
          history_anchor_at=NULL,history_anchor_ticket=NULL,history_anchor_amount=NULL,history_scanned_until=NULL
          WHERE id=? AND COALESCE(history_status,'') NOT IN ('requested','resolving')`,
          requestId,status,since,since,mode,link.id).run();
        return created.meta.changes ? json({ok:true,request:requestId,status,mode}) : fail('History scan already running.',409);
      }
      // The owner explicitly chooses a range. Never silently extend an old
      // completed scan; its immutable request ID must still match on approval.
      if(action!=='history-decline' && (link.history_since===null ||
         !timestamp(link.linked_at) || !Number.isSafeInteger(link.history_since) ||
         link.history_since<HISTORY_EPOCH || link.history_since>=Date.parse(link.linked_at) ||
         (link.history_authorized_since!==null && link.history_since!==link.history_authorized_since) ||
         (link.history_authorized_since===null &&
          link.history_since<Date.parse(link.linked_at)-90*86400000)))
        return fail('History start has not been established by the broker. Wait for discovery or choose a new scan.',409);
      const prefix='history:'+link.history_id+':';
      if(action==='history-preview') {
        if (input.request !== undefined && input.request !== link.history_id) return fail('This scan changed. Reopen the account’s history preview.',409);
        if(!['ready','imported'].includes(link.history_status)) return fail('Wait for the scan to finish.',409);
        const offset=Number(input.offset ?? 0);
        if(!Number.isSafeInteger(offset)||offset<0||offset>1_000_000) return fail('Invalid preview page.');
        const rows=await q("SELECT event_key,payload FROM mt5_events WHERE link=? AND substr(event_key,1,?)=? ORDER BY event_key LIMIT 101 OFFSET ?",link.id,prefix.length,prefix,offset).all<{event_key:string;payload:string}>();
        const page=rows.results.slice(0,100);
        return json({link:link.id,request:link.history_id,status:link.history_status,rows:page.map(row=>JSON.parse(row.payload)),more:rows.results.length>100,nextOffset:offset+page.length});
      }
      if(input.request!==link.history_id) return fail('Preview changed. Reload before deciding.',409);
      if(action==='history-decline') {
        if(!['requested','resolving','ready','no_deposit'].includes(link.history_status)) return fail('This scan can no longer be cancelled.',409);
        const cancelled = await q("UPDATE mt5_links SET history_status='declined' WHERE id=? AND history_id=? AND history_status IN ('requested','resolving','ready','no_deposit')",link.id,link.history_id).run();
        return cancelled.meta.changes ? json({ok:true}) : fail('This scan changed. Reload before deciding.',409);
      }
      if(!['ready','imported'].includes(link.history_status)) return fail('Wait for the preview to complete.',409);
      const expected=Number(input.expected_count);
      if(!Number.isSafeInteger(expected)||expected<0) return fail('Review all history preview pages before importing.',400);
      const count=await q("SELECT count(*) AS total FROM mt5_events WHERE link=? AND substr(event_key,1,?)=?",link.id,prefix.length,prefix).first<{total:number}>();
      if(expected!==count?.total) return fail('History preview has changed. Review all pages again.',409);
      const items=await q("SELECT event_key,payload FROM mt5_events WHERE link=? AND substr(event_key,1,?)=? AND NOT EXISTS(SELECT 1 FROM workspace_records w WHERE w.id=mt5_events.link||'/'||substr(mt5_events.event_key,?)) ORDER BY event_key LIMIT 40",link.id,prefix.length,prefix,prefix.length+1).all<{event_key:string;payload:string}>();
      // Import in retryable batches. Broker deal IDs are immutable and deduplicate live fills.
      const statements=items.results.map(row=>{
        const key=row.event_key.slice(prefix.length),id=link.id+'/'+key;
        const data={...JSON.parse(row.payload),id,user_id:owner,account_id:link.account_id,trade_source:'mt5',capture_mode:'history',broker:link.company,settlement_currency:link.currency,historical_import:true,mistakes:[],pips:0};
        return q(`INSERT OR IGNORE INTO workspace_records(id,user_id,table_name,payload,created_at,updated_at)
          SELECT ?,?,'trades',?,?,? WHERE EXISTS (
            SELECT 1 FROM mt5_links WHERE id=? AND history_id=? AND history_status IN ('ready','imported')
          ) RETURNING id`,id,owner,JSON.stringify(data),now(),now(),link.id,link.history_id);
      });
      const finish = q("UPDATE mt5_links SET history_status='imported' WHERE id=? AND history_id=? AND history_status IN ('ready','imported')",link.id,link.history_id);
      const results = await db.batch([...statements,finish]);
      if (!results[results.length-1].meta.changes) return fail('This scan changed. Reload before importing.',409);
      const added=results.slice(0,-1).reduce((total,result)=>total+result.results.length,0);
      return json({added,more:items.results.length===40});
    }
    if (action === 'pair') {
      if(await capturePaused()) return fail('MT5 pairing is paused by the administrator.',403);
      const code = uuid().replaceAll('-', '');
      // An abandoned one-time code is never a real paired PC. Only delete
      // expired, unclaimed codes, never device rows carrying broker links.
      await q("DELETE FROM mt5_devices WHERE owner=? AND pair_hash IS NOT NULL AND public_key IS NULL AND expires<?",
        owner,unix).run();
      await q('INSERT INTO mt5_devices(id,owner,pair_hash,expires) VALUES(?,?,?,?)', uuid(), owner, await hash(code), unix + 300000).run();
      return json({ code });
    }
    if (action === 'revoke') {
      await db.batch([q('UPDATE mt5_devices SET revoked=1,token_hash=NULL WHERE id=? AND owner=?', input.device, owner),
        q('UPDATE mt5_links SET envelope=NULL,status=? WHERE device IN (SELECT id FROM mt5_devices WHERE id=? AND owner=?)','revoked',input.device,owner)]);
      return json({ ok: true });
    }
    if (action === 'connect') {
      if(await capturePaused()) return fail('MT5 capture is paused by the administrator.',403);
      const device = await q('SELECT id,setup_state FROM mt5_devices WHERE id=? AND owner=? AND revoked=0 AND last_seen>?', input.device, owner, unix - 90000).first<{id:string;setup_state:string|null}>();
      if (!device) return fail('Connector offline. Start it on your PC and retry.', 409);
      if (device.setup_state === 'install') return fail('Install MetaTrader 5 on the paired PC, then add your account.',409);
      if (input.server !== undefined && !limited(input.server,128)) return fail('Choose a valid broker server.');
      if (!isObject(input.envelope) || !['wrapped','iv','data'].every(k => limited((input.envelope as Fields)[k],4096))) return fail('Invalid encrypted request.');
      const id = uuid();
      if(input.account && (!limited(input.account,100) || !await q("SELECT id FROM workspace_records WHERE user_id=? AND table_name='trading_accounts' AND id=?",owner,input.account).first())) return fail('Unknown journal account.');
      const accountId=input.account || uuid();
      if(await q("SELECT id FROM mt5_links WHERE account_id=? AND (status='connected' OR (status IN ('pending','verifying') AND expires>?))",accountId,unix).first()) return fail('This journal account already has a connection.',409);
      // MT5 can spend several minutes copying a clean portable installation,
      // starting its IPC channel, and downloading a broker directory.
      // Pending credentials are encrypted to the paired PC's public key.
      const expires = unix + 10 * 60 * 1000;
      await q('INSERT INTO mt5_links(id,owner,device,account_id,envelope,expires,server) VALUES(?,?,?,?,?,?,?)',
        id,owner,input.device,accountId,JSON.stringify(input.envelope),expires,input.server || null).run();
      return json({ id });
    }
    if (action === 'match') {
      const rows = await q("SELECT id,payload FROM workspace_records WHERE user_id=? AND table_name='trades' AND id IN (?,?)",owner,input.imported,input.manual).all<{id:string;payload:string}>();
      const manual = rows.results.find(r=>r.id===input.manual), imported = rows.results.find(r=>r.id===input.imported);
      if (!manual || !imported) return fail('Trade unavailable.',404);
      const m=JSON.parse(manual.payload), i=JSON.parse(imported.payload);
      if (m.trade_source==='mt5' || i.trade_source!=='mt5' || m.account_id!==i.account_id || m.direction!==i.direction || m.pair!==i.pair) return fail('Choose trades in the same account, symbol and direction.');
      const notes = Object.fromEntries(Object.entries(m).filter(([key]) => /^(notes|lessons|mistakes|emotional_state|strategy|strategy_id|setup_id|plan_id|screenshot_url|voice_note_url|.*_screenshot_url|.*_voice_note_url|checklist_.*)$/.test(key)));
      // Insert via SELECT with the original payloads as concurrency preconditions.
      const matched = await db.batch([
        q("INSERT INTO mt5_matches SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM workspace_records WHERE id=? AND payload=?) AND EXISTS(SELECT 1 FROM workspace_records WHERE id=? AND payload=?)",imported.id,manual.id,owner,manual.payload,manual.id,manual.payload,imported.id,imported.payload),
        q('UPDATE workspace_records SET payload=json_patch(payload,?),updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM mt5_matches WHERE imported_id=? AND manual_id=?)',JSON.stringify(notes),now(),imported.id,imported.id,manual.id),
        q('DELETE FROM workspace_records WHERE id=? AND EXISTS(SELECT 1 FROM mt5_matches WHERE imported_id=? AND manual_id=?)',manual.id,imported.id,manual.id)]);
      return matched[0].meta.changes ? json({ok:true}) : fail('Trades changed. Reload before matching.',409);
    }
    return fail('Unknown action.',404);
  }
  if (action==='device/claim') {
    if(await capturePaused()) return fail('MT5 pairing is paused by the administrator.',403);
    if (!limited(input.code,64) || !limited(input.publicKey,1024) || !/^[a-zA-Z0-9+/=]+$/.test(input.publicKey)) return fail('Invalid pairing request.');
    // Old connectors are still accepted. Current connectors send a locally
    // persisted random UUID, which is a deduplication hint, NOT authentication.
    if (input.installationId !== undefined && !installationId(input.installationId))
      return fail('Invalid connector installation identity.');
    const claimedHash=installationId(input.installationId)?await hash(input.installationId.toLowerCase()):null;
    const codeHash=await hash(String(input.code));
    if (claimedHash) {
      const prior=await q(`SELECT existing.id FROM mt5_devices pending JOIN mt5_devices existing
        ON existing.owner=pending.owner AND existing.installation_hash=? AND existing.revoked=0
        AND existing.public_key IS NOT NULL AND existing.id<>pending.id
        WHERE pending.pair_hash=? AND pending.expires>? AND pending.revoked=0`,
        claimedHash,codeHash,unix).first();
      if(prior) return json({error:'This Windows connector is already paired. Reopen the saved pairing instead of making another PC.',code:'pc_already_paired'},409);
    }
    const token=uuid()+uuid();
    const result=await q(`UPDATE mt5_devices SET pair_hash=NULL,token_hash=?,public_key=?,last_seen=?,installation_hash=?
      WHERE pair_hash=? AND expires>? AND revoked=0
      AND (? IS NULL OR NOT EXISTS(
        SELECT 1 FROM mt5_devices old WHERE old.owner=mt5_devices.owner AND old.revoked=0
        AND old.public_key IS NOT NULL AND old.installation_hash=? AND old.id<>mt5_devices.id))
      RETURNING id`,await hash(token),input.publicKey,unix,claimedHash,codeHash,unix,claimedHash,claimedHash).first();
    return result ? json({token,device:result.id}) : fail('Pairing code expired, already used or this PC is already paired.',409);
  }
  const token=request.headers.get('authorization')?.match(/^Bearer (.{72})$/)?.[1];
  if (!token) return fail('Device authentication required.',401);
  const device=await q("SELECT d.id,d.owner,d.pc_name,d.installation_hash FROM mt5_devices d JOIN users u ON u.id=d.owner WHERE token_hash=? AND revoked=0 AND u.account_status='active'",await hash(token)).first<{id:string;owner:string;pc_name:string|null;installation_hash:string|null}>();
  if (!device) return json({error:'Device access revoked.',code:'device_revoked'},403);
  if (action.startsWith('device/copy-')) return copyFleetDevice(db,device,action,input,env.MT5_LIVE_COPY_EXECUTION==='true');
  if (action === 'device/set-monitoring') return setMonitoring(device.owner, device.id);

  // Account discovery is bound to the same enrolled Windows installation.
  // A valid bearer token alone is insufficient on a copied/cloned connector.
  if (action.startsWith('device/discovery-')) {
    if (!installationId(input.installationId)) return fail('Connector identity required.',403);
    const identity=await hash(input.installationId.toLowerCase());
    if(device.installation_hash && identity!==device.installation_hash)
      return json({error:'This installation does not own the paired PC.',code:'pc_identity_mismatch'},409);
    if(!device.installation_hash) {
      const other=await q('SELECT id FROM mt5_devices WHERE owner=? AND installation_hash=? AND revoked=0 AND public_key IS NOT NULL AND id<>?',device.owner,identity,device.id).first();
      if(other) return json({error:'An existing paired PC owns that installation.',code:'pc_already_paired'},409);
      await q('UPDATE mt5_devices SET installation_hash=? WHERE id=? AND installation_hash IS NULL',identity,device.id).run();
    }
  }
  if (action === 'device/discovery-poll') {
    await q('UPDATE mt5_devices SET last_seen=? WHERE id=?',unix,device.id).run();
    const scan=await q('SELECT request_id,requested_at,completed_at FROM mt5_device_scans WHERE device=? AND owner=?',device.id,device.owner)
      .first<{request_id:string;requested_at:number;completed_at:number|null}>();
    const ownerProfile=await q('SELECT display_name FROM users WHERE id=?',device.owner).first<{display_name:string}>();
    const approvals=await q(`SELECT a.link,a.slot,a.login,a.server FROM mt5_discovery_approvals a
      JOIN mt5_links l ON l.id=a.link AND l.device=a.device
      WHERE a.device=? AND a.owner=? AND a.verified_at IS NULL
      AND l.status='verifying' AND l.expires>? ORDER BY a.requested_at ASC LIMIT 20`,
      device.id,device.owner,unix).all();
    return json({owner:ownerProfile?.display_name||null,
      scan:scan && !scan.completed_at && scan.requested_at>unix-10*60*1000
        ?{request:scan.request_id}:null,approvals:approvals.results});
  }
  if (action === 'device/discovery-report') {
    if (!limited(input.request,64)||!Array.isArray(input.accounts)||input.accounts.length>64)
      return fail('Invalid local account scan.');
    const task=await q('SELECT request_id,requested_at,completed_at FROM mt5_device_scans WHERE device=? AND owner=?',device.id,device.owner)
      .first<{request_id:string;requested_at:number;completed_at:number|null}>();
    if(!task || task.request_id!==input.request||task.completed_at ||
        task.requested_at<unix-10*60*1000) return fail('Account scan has expired.',409);
    const seen=new Set<string>();
    const records: ReturnType<typeof q>[]=[];
    for(const item of input.accounts) {
      if(!isObject(item)||!limited(item.slot,64)||!/^\w{12}$/.test(item.slot)||
          !limited(item.login,24)||!/^\d+$/.test(item.login)||
          !limited(item.server,128)||typeof item.account_name!=='string'||item.account_name.length>96||
          typeof item.company!=='string'||item.company.length>128||
          typeof item.currency!=='string'||item.currency.length>12||
          ![0,1,2].includes(Number(item.mode))||seen.has(item.slot))
        return fail('Invalid verified account identity.');
      seen.add(item.slot);
      records.push(q(`INSERT INTO mt5_discovered_accounts
        (device,owner,slot,login,server,account_name,company,currency,trade_mode,last_seen)
        VALUES(?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(device,slot) DO UPDATE SET login=excluded.login,
        server=excluded.server,account_name=excluded.account_name,
        company=excluded.company,currency=excluded.currency,trade_mode=excluded.trade_mode,
        last_seen=excluded.last_seen`,
        device.id,device.owner,item.slot,item.login,item.server,item.account_name,item.company,
        item.currency,item.mode,unix));
    }
    records.push(q(`UPDATE mt5_device_scans SET completed_at=? WHERE device=? AND owner=? AND request_id=? AND completed_at IS NULL`,
      unix,device.id,device.owner,input.request));
    await db.batch(records);
    return json({ok:true,verified:seen.size});
  }
  if (action === 'device/rename') {
    const name=pcLabel(input.name);
    if(!name) return fail('Choose a PC name between 2 and 48 characters.');
    const change=await q('UPDATE mt5_devices SET pc_name=? WHERE id=? AND owner=? AND revoked=0',
      name,device.id,device.owner).run();
    return change.meta.changes ? json({ok:true,device:device.id,name}) : fail('Paired PC unavailable.',404);
  }
  if (action === 'device/presence') {
    if (!['ready','install'].includes(String(input.setup)) || !limited(input.version,32)) return fail('Invalid connector status.');
    if(input.installationId!==undefined && !installationId(input.installationId))
      return fail('Invalid installation identity.');
    const identity=installationId(input.installationId)?await hash(input.installationId.toLowerCase()):null;
    if(identity && device.installation_hash && identity!==device.installation_hash)
      return json({error:'This pairing belongs to a different connector installation.',code:'pc_identity_mismatch'},409);
    if(identity && !device.installation_hash) {
      const already=await q('SELECT id FROM mt5_devices WHERE owner=? AND installation_hash=? AND revoked=0 AND public_key IS NOT NULL AND id<>?',
        device.owner,identity,device.id).first();
      if(already) return json({error:'Another paired PC has this installation identity.',code:'pc_already_paired'},409);
    }
    const halted = await capturePaused();
    const [, , paused, retries, pending] = await db.batch<{id:string; server?:string|null; retry_requested_at?:string}>([
      q('UPDATE mt5_devices SET last_seen=?,setup_state=?,connector_version=?,installation_hash=COALESCE(installation_hash,?) WHERE id=?',
        unix,input.setup,input.version,identity,device.id),
      q("UPDATE mt5_links SET envelope=NULL,status='expired' WHERE device=? AND status IN ('pending','verifying') AND expires<=?",device.id,unix),
      q("SELECT id FROM mt5_links WHERE device=? AND status='connected' AND monitoring_paused=1",device.id),
      q("SELECT id,retry_requested_at FROM mt5_links WHERE device=? AND status='connected' AND monitoring_paused=0 AND retry_requested_at IS NOT NULL",device.id),
      q("SELECT id,server FROM mt5_links WHERE device=? AND status='pending' AND expires>? ORDER BY expires,id LIMIT 1",device.id,unix),
    ]);
    return json({device:device.id,name:device.pc_name||'PC '+device.id.slice(0,8),capturePaused:halted,paused:paused.results.map(r=>r.id),
      retries:halted?[]:retries.results,pending:halted?null:pending.results[0]??null});
  }
  if(action==='device/retries'){
    await q('UPDATE mt5_devices SET last_seen=? WHERE id=?',unix,device.id).run();
    const rows=await capturePaused()?[]:(await q("SELECT id,retry_requested_at FROM mt5_links WHERE device=? AND status='connected' AND retry_requested_at IS NOT NULL",device.id).all()).results;
    return json({rows});
  }
  if (action==='device/poll') {
    await q('UPDATE mt5_devices SET last_seen=? WHERE id=?',unix,device.id).run();
    if(await capturePaused()) return json({job:null,capturePaused:true});
    await q("UPDATE mt5_links SET envelope=NULL,status='expired' WHERE device=? AND status IN ('pending','verifying') AND expires<=?",device.id,unix).run();
    if (input.request !== undefined && !limited(input.request,64)) return fail('Invalid account request.');
    const job=await q("SELECT id,envelope FROM mt5_links WHERE device=? AND status='pending' AND expires>? AND (? IS NULL OR id=?) ORDER BY expires,id LIMIT 1",
      device.id,unix,input.request??null,input.request??null).first<{id:string;envelope:string}>();
    if (!job) return json({job:null});
    const claimed=await q("UPDATE mt5_links SET status='verifying',envelope=NULL,expires=? WHERE id=? AND status='pending'",unix+12*60*1000,job.id).run();
    return json({ job: claimed.meta.changes ? {id:job.id,envelope:JSON.parse(job.envelope)} : null });
  }
  if (!limited(input.link,64)) return fail('Missing link.');
  const link=await q('SELECT * FROM mt5_links WHERE id=? AND device=?',input.link,device.id).first<{id:string;account_id:string;status:string;currency:string;company:string;expires:number;trade_mode:number|null;monitoring_paused:number;linked_at:string}>();
  if (!link) return fail('Unknown link.',404);
  if (action === 'device/history-anchor') {
    if(!limited(input.request,64)) return fail('Missing history request.');
    const selected=await q("SELECT history_id,history_mode,history_status,linked_at FROM mt5_links WHERE id=? AND device=?",link.id,device.id)
      .first<{history_id:string;history_mode:string;history_status:string;linked_at:string}>();
    if(!selected || selected.history_id!==input.request ||
       !['since_last_deposit','since_first_deposit'].includes(selected.history_mode) ||
       selected.history_status!=='resolving') return fail('History discovery is no longer active.',409);
    if(input.found===false) {
      await q("UPDATE mt5_links SET history_status='no_deposit' WHERE id=? AND history_id=? AND history_status='resolving'",link.id,selected.history_id).run();
      return json({ok:true,status:'no_deposit'});
    }
    const since=Number(input.since);
    if(!Number.isSafeInteger(since)||since<HISTORY_EPOCH||since>=Date.parse(selected.linked_at) ||
       !limited(input.ticket,24)||!/^[0-9]+$/.test(input.ticket) ||
       typeof input.amount!=='number'||!Number.isFinite(input.amount)||input.amount<=0)
      return fail('Invalid broker deposit evidence.');
    const updated=await q(`UPDATE mt5_links SET history_since=?,history_authorized_since=?,history_anchor_at=?,history_anchor_ticket=?,
      history_anchor_amount=?,history_status='requested' WHERE id=? AND history_id=? AND history_status='resolving'`,
      since,since,since,input.ticket,input.amount,link.id,selected.history_id).run();
    return updated.meta.changes?json({ok:true,since}):fail('History request changed.',409);
  }
  if (action === 'device/history-progress') {
    if(!limited(input.request,64)) return fail('Missing history request.');
    const scanned=Number(input.scanned_until);
    const selected=await q("SELECT history_id,history_since,history_authorized_since,linked_at,history_status FROM mt5_links WHERE id=? AND device=?",link.id,device.id)
      .first<{history_id:string;history_since:number|null;history_authorized_since:number|null;linked_at:string;history_status:string}>();
    if(!selected||selected.history_id!==input.request||selected.history_status!=='requested' ||
       selected.history_since===null||selected.history_since!==selected.history_authorized_since||!Number.isSafeInteger(scanned) ||
       scanned<selected.history_since||scanned>Date.parse(selected.linked_at))
      return fail('Invalid history scan progress.',409);
    await q("UPDATE mt5_links SET history_scanned_until=MAX(COALESCE(history_scanned_until,?),?) WHERE id=? AND history_id=? AND history_status='requested'",
      scanned,scanned,link.id,selected.history_id).run();
    return json({ok:true});
  }
  if (action === 'device/setup-issue') {
    const setupMessages: Record<string,string> = {
      disk_full: 'Not enough free disk space to create the MT5 terminal on this PC.',
      source_busy: 'An installed MT5 program file is locked. Close the MetaTrader updater and retry Add account.',
      source_changed: 'The MT5 installation changed during setup. Finish installing or updating MetaTrader, then retry.',
      access_denied: 'Windows blocked terminal setup. Open the connector activity log and check Windows Security permissions.',
      path_too_long: 'An MT5 installation file path is too long for Windows.',
      copy_limit: 'The detected MT5 installation exceeded the safe 2 GB copy limit.',
      unexpected_setup_error: 'The connector hit an unexpected terminal setup error. Open its Activity panel for the error type.',
      no_installation: 'The connector could not find a usable installed MT5 program.',
      copy_failed: 'The connector could not copy an MT5 program file. Check the connector Activity panel.'
    };
    const message = Object.hasOwn(setupMessages,String(input.reason)) ? setupMessages[String(input.reason)] :
      'Your PC could not prepare MetaTrader. Check the connector Activity panel, then retry Add account.';
    const failed = await q("UPDATE mt5_links SET status='failed',envelope=NULL,last_error=? WHERE id=? AND device=? AND status='pending'",
      message,link.id,device.id).run();
    return failed.meta.changes ? json({ok:true}) : fail('This account request has already changed.',409);
  }
  if (link.monitoring_paused && ['device/sync','device/capture-issue'].includes(action)) return fail('Monitoring is paused for this account.',423);
  if(action==='device/capture-issue'){
    if(link.status!=='connected')return fail('Account unavailable.',409);
    await q("UPDATE mt5_links SET capture_health='needs_attention' WHERE id=?",link.id).run();
    return json({ok:true});
  }
  if (action==='device/verified') {
    if(await capturePaused()) return fail('MT5 capture is paused by the administrator.',403);
    if (link.status==='connected') return json({ok:true});
    if (link.status!=='verifying' || link.expires<=unix) return fail('Login expired.',409);
    const approval=await q('SELECT login,server FROM mt5_discovery_approvals WHERE link=? AND device=?',link.id,device.id)
      .first<{login:string;server:string}>();
    if(approval && (String(input.login)!==approval.login ||
        String(input.server).toLowerCase()!==approval.server.toLowerCase()))
      return fail('Local MT5 login does not match the dashboard selection.',409);
    // Require an actual numeric MT5 mode before testing the real-account release gate.
    if(input.ok && (typeof input.mode!=='number' || ![0,1,2].includes(input.mode))) return fail('Invalid MT5 account mode.');
    if (!input.ok || (!liveAccountCaptureAllowed && input.mode===2)) {
      const reasons: Record<string,string> = {
        terminal_start:'MetaTrader could not start. Open the connector on your PC, finish any MetaTrader update, then choose Add account again.',
        terminal_ipc_timeout:'MetaTrader did not respond to the connector in time. Close any stalled MT5 update or login dialogs on the paired PC, then retry.',
        wrong_terminal:'MetaTrader opened the wrong profile. Close the extra MetaTrader window and retry from Add account.',
        broker_rejected:'MT5 rejected authorization. Check the account number, investor or standard password, and exact assigned server.',
        broker_login:'MT5 could not log in to this server. In the dedicated terminal use File → Open an Account, find your broker and select its assigned server, then retry.',
        broker_login_timeout:'MetaTrader timed out while contacting your broker. Check the exact server and broker connectivity, then retry.',
        disconnected:'MetaTrader could not reach the broker. Check the connection on your PC and confirm the server name.',
        identity_mismatch:'The connected login or broker server differs from the requested account.',
        no_slot:'Account setup is busy. Try Add account again once the current request finishes.',
        invalid_job:'The PC could not read this login request. Reopen the login form and retry.'
      };
      const reason=Object.hasOwn(reasons,String(input.reason)) ? reasons[String(input.reason)] : 'Login failed. Check server, account credentials and dedicated terminal availability.';
      const detail=Number.isSafeInteger(input.api_code) ? ' (MT5 code '+input.api_code+')' : '';
      await q("UPDATE mt5_links SET status='failed',last_error=? WHERE id=?",input.ok?'Real accounts require an explicitly approved capture-only rollout. Demo and contest accounts can be linked.':reason+detail,link.id).run();
      return input.ok ? fail('Could not enable account.',409) : json({ok:true});
    }
    if (!limited(input.login,24)||!/^\d+$/.test(input.login)||!limited(input.server,128)||!limited(input.company,128)||!limited(input.currency,12)||typeof input.balance!=='number'||!Number.isFinite(input.balance)) return fail('Invalid account metadata.');
    const duplicate=await q("SELECT 1 FROM mt5_links l JOIN mt5_devices d ON d.id=l.device WHERE d.owner=? AND l.login=? AND l.server=? AND l.status='connected' AND d.revoked=0",device.owner,input.login,input.server).first();
    if(duplicate) {
      await q("UPDATE mt5_links SET status='failed',last_error='This broker login is already in your account list.' WHERE id=? AND status='verifying'",link.id).run();
      return fail('Account already linked.',409);
    }
    const prior=await q("SELECT payload FROM workspace_records WHERE id=? AND user_id=? AND table_name='trading_accounts'",link.account_id,device.owner).first<{payload:string}>();
    if(prior){
      const account=JSON.parse(prior.payload);
      if(account.base_currency!==input.currency || (account.account_number && String(account.account_number)!==input.login)) {
        await q("UPDATE mt5_links SET status='failed',last_error='Account currency or login differs from journal settings.' WHERE id=?",link.id).run();
        return fail('Journal account does not match verified account.',409);
      }
    }
    const time=now(), account={name:input.company+' · '+input.login,account_number:input.login,broker_name:input.company,base_currency:input.currency,balance:input.balance,balance_as_of:time,is_active:true,risk_per_trade_pct:1,user_id:device.owner};
    const accessLevel=typeof input.trade_access==='boolean' ? (input.trade_access?'trading-enabled':'trading-restricted') : 'unknown';
    await db.batch([q("UPDATE mt5_links SET status='connected',login=?,server=?,company=?,currency=?,linked_at=?,trade_mode=?,access_level=? WHERE id=?",input.login,input.server,input.company,input.currency,time,input.mode,accessLevel,link.id),
      q("INSERT INTO workspace_records(id,user_id,table_name,payload,created_at,updated_at) VALUES(?,?,'trading_accounts',?,?,?) ON CONFLICT(id) DO UPDATE SET payload=json_patch(workspace_records.payload,?),updated_at=excluded.updated_at WHERE workspace_records.user_id=excluded.user_id AND workspace_records.table_name='trading_accounts'",link.account_id,device.owner,JSON.stringify(account),time,time,JSON.stringify({broker_name:input.company,account_number:input.login}))]);
    if (approval) {
      await q('UPDATE mt5_discovery_approvals SET verified_at=? WHERE link=? AND device=? AND verified_at IS NULL',
        unix,link.id,device.id).run();
    }
    return json({ok:true});
  }
  if(action!=='device/sync'||link.status!=='connected') return fail('Link unavailable.',409);
  if(await capturePaused()) return fail('MT5 capture is paused by the administrator.',403);
  if(link.trade_mode===2 && !liveAccountCaptureAllowed) return fail('Real-account capture is paused by the release gate.',403);
  if (!Array.isArray(input.events)||input.events.length>40) return fail('Invalid capture batch.');
  const statements:D1PreparedStatement[]=[];
   const rawSeen = new Map<string,{sha256:string;payload:string}>();
   let quarantinedInBatch = 0;
  for(const event of input.events) {
    if(!isObject(event)||!limited(event.key,120)||!isObject(event.fields)) return fail('Invalid capture event.');
    const f=event.fields, time=now();
    // Append-only evidence, keyed by the immutable MT5 ticket or observation id.
    // Replays are idempotent. Changed broker evidence cannot silently overwrite.
    if(event.kind==='raw' && /^(?:deal-|order-|stops-|spec-|position-)/.test(String(event.key))) {
      const evidenceKind=String(event.key).startsWith('deal-')?'deal'
        :String(event.key).startsWith('order-')?'order'
        :String(event.key).startsWith('stops-')?'stop'
        :String(event.key).startsWith('spec-')?'specification':'position';
      const payload=JSON.stringify(f);
      const sha=await hash(payload);
      let evidenceSha=sha;
      const staged=rawSeen.get(String(event.key));
      const prior=staged ?? await q('SELECT sha256,payload FROM mt5_raw_evidence WHERE link=? AND event_key=?',
        link.id,event.key).first<{sha256:string;payload:string}>();
      if(prior && prior.sha256!==sha) {
        // JSON key reordering is semantically identical and not a broker revision.
        if(sortedEvidenceJson(JSON.parse(prior.payload))!==sortedEvidenceJson(f)) {
          const changed=changedEvidenceFields(JSON.parse(prior.payload),f);
          const alias=evidenceKind==='specification'
            && /^spec-[0-9a-f]{28}$/.test(String(event.key))
            && changed.length===1 && changed[0]==='position_id'
            && (() => {
              const base={...JSON.parse(prior.payload) as Fields},next={...f};
              delete base.position_id;delete next.position_id;
              return sortedEvidenceJson(base)===sortedEvidenceJson(next);
            })();
          // A genuine conflict is retained separately for review, not treated as a
          // broker-authorized correction. The existing immutable evidence stays.
          statements.push(q(`INSERT OR IGNORE INTO mt5_evidence_conflicts
            (link,owner,account_id,event_key,evidence_kind,original_sha256,candidate_sha256,candidate_payload,changed_fields,review_status,recorded_at)
            VALUES(?,?,?,?,?,?,?,?,?,'needs_review',?)`,
            link.id,device.owner,link.account_id,event.key,evidenceKind,prior.sha256,sha,payload,JSON.stringify(changed),time));
          if(alias) statements.push(q(`INSERT OR IGNORE INTO mt5_conflict_classifications
            (link,event_key,candidate_sha256,owner,classification,provenance,recorded_at)
            VALUES(?,?,?,?,'connector_spec_position_alias_v1',
              'old_spec_hash_omitted_position_id',?)`,
            link.id,event.key,sha,device.owner,time));
          else quarantinedInBatch++;
          continue;
        }
      }
      if(prior) evidenceSha=prior.sha256; // Preserve original fingerprint for cash ledger provenance.
      if(!prior) rawSeen.set(String(event.key),{sha256:sha,payload});
      statements.push(q('INSERT OR IGNORE INTO mt5_raw_evidence(link,owner,account_id,event_key,evidence_kind,payload,sha256,recorded_at) VALUES(?,?,?,?,?,?,?,?)',
        link.id,device.owner,link.account_id,event.key,evidenceKind,payload,sha,time));
      if(evidenceKind==='deal' && Number(f.type)===2 && /^deal-\d+$/.test(event.key)) {
        // MT5 DEAL_TYPE_BALANCE = 2, which also includes broker adjustments.
        // Save cash direction only. Never certify external deposit/withdrawal.
        const amount=Number(f.profit),at=Number(f.time_msc??Number(f.time)*1000);
        const ticket=String(f.ticket??'');
        if(!/^\d+$/.test(ticket) || event.key!=='deal-'+ticket ||
           !Number.isSafeInteger(at) || at<=0 || !Number.isFinite(amount) ||
           Math.abs(amount)>1e13) return fail('Invalid broker balance movement.');
        if(amount!==0) statements.push(q(`INSERT OR IGNORE INTO mt5_cash_movements
          (link,owner,account_id,ticket,amount,currency,direction,broker_time_msc,raw_evidence_key,raw_sha256,recorded_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
          link.id,device.owner,link.account_id,ticket,String(amount),link.currency,
          amount>0?'in':'out',at,event.key,evidenceSha,time));
      }
    }
    if(event.kind==='lifecycle') {
      if(!/^lifecycle:\d+:\d+$/.test(String(event.key)) || f.calculation_version!==1
        || !limited(f.lifecycle_id,80)||event.key!=='lifecycle:'+f.lifecycle_id
        || !/^\d+:\d+$/.test(String(f.lifecycle_id))
        || !limited(f.symbol,80)||!['long','short'].includes(String(f.direction))
        || !['open','closed'].includes(String(f.status))
        || !timestamp(f.first_entry_at) || !isObject(f.capture_completeness)
        || (f.status==='closed'&&!timestamp(f.final_exit_at))
        || !Array.isArray(f.entries)||!Array.isArray(f.exits))
        return fail('Invalid lifecycle projection.');
      const projection={...f,trade_source:'mt5',account_id:link.account_id,settlement_currency:link.currency,broker:link.company};
      const payload=JSON.stringify(projection);
      const sha=await hash(payload);
      const old=await q('SELECT sha256 FROM mt5_position_versions WHERE link=? AND lifecycle_id=? ORDER BY version DESC LIMIT 1',
        link.id,f.lifecycle_id).first<{sha256:string}>();
      if(!old || old.sha256!==sha) {
        statements.push(q(`INSERT OR IGNORE INTO mt5_position_versions(link,owner,account_id,lifecycle_id,version,calculation_version,payload,sha256,recorded_at)
          VALUES(?,?,?,?,(SELECT COALESCE(MAX(version),0)+1 FROM mt5_position_versions WHERE link=? AND lifecycle_id=?),1,?,?,?)`,
          link.id,device.owner,link.account_id,f.lifecycle_id,link.id,f.lifecycle_id,payload,sha,time));
      }
      continue;
    }
    statements.push(q('INSERT INTO mt5_events(link,event_key,payload) VALUES(?,?,?) ON CONFLICT(link,event_key) DO UPDATE SET payload=excluded.payload',link.id,event.key,JSON.stringify(f)));
    if(event.kind==='trade' || event.kind==='history') {
      if(event.kind==='trade' && !/^(?:open|close)-\d+$/.test(event.key)) return fail('Invalid broker event key.');
      if(!limited(f.pair,80)||!['long','short'].includes(String(f.direction))||!['open','closed'].includes(String(f.status))||!timestamp(f.entry_time)||typeof f.pnl!=='number'||!Number.isFinite(f.pnl)||(f.status==='closed'&&!timestamp(f.exit_time))) return fail('Invalid trade.');
      const positive = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0;
      const validLevel = (value: unknown) => value == null || positive(value);
      if(!positive(f.entry_price) || !positive(f.lot_size)
        || (f.status==='closed' && (!positive(f.exit_price) || Date.parse(String(f.exit_time))<Date.parse(String(f.entry_time))))
        || !validLevel(f.stop_loss) || !validLevel(f.take_profit)
        || (f.fees != null && (typeof f.fees!=='number'||!Number.isFinite(f.fees)))) return fail('Invalid broker fill price, size or costs.');
      const allowed=['pair','direction','entry_price','exit_price','stop_loss','take_profit','lot_size','status','pnl','entry_time','exit_time','fees','broker_details','initial_risk'];
      const data=Object.fromEntries(allowed.filter(k=>k in f).map(k=>[k,f[k]]));
      Object.assign(data,{trade_source:'mt5',capture_mode:'live',account_id:link.account_id,user_id:device.owner,settlement_currency:link.currency,broker:link.company,outcome:f.status==='open'?null:f.pnl>0?'win':f.pnl<0?'loss':'breakeven'});
      if(event.kind==='history'){
        const history=await q('SELECT history_id,history_status,linked_at,history_since,history_mode FROM mt5_links WHERE id=?',link.id).first<{history_id:string;history_status:string;linked_at:string;history_since:number;history_mode:string}>();
        if(!history || !event.key.startsWith('history:'+history.history_id+':close-')
          || history.history_status!=='requested' || f.status!=='closed'
          || Date.parse(String(f.exit_time))<history.history_since
          || Date.parse(String(f.exit_time))>=Date.parse(history.linked_at)
          || Date.parse(String(f.entry_time))>Date.parse(String(f.exit_time))
          || ((history.history_mode==='since_last_deposit'||history.history_mode==='since_first_deposit') &&
              Date.parse(String(f.entry_time))<history.history_since)) {
          statements.pop(); continue;
        }
        statements[statements.length-1]=q('INSERT OR REPLACE INTO mt5_events(link,event_key,payload) VALUES(?,?,?)',link.id,event.key,JSON.stringify({...data,historical_import:true,outcome:Number(f.pnl)>0?'win':Number(f.pnl)<0?'loss':'breakeven'}));
        continue;
      }
      const id=link.id+'/'+event.key;
      statements.push(q("INSERT INTO workspace_records(id,user_id,table_name,payload,created_at,updated_at) VALUES(?,?,'trades',?,?,?) ON CONFLICT(id) DO UPDATE SET payload=json_patch(workspace_records.payload,?),updated_at=excluded.updated_at WHERE workspace_records.user_id=excluded.user_id",id,device.owner,JSON.stringify({mistakes:[],pips:0,...data}),time,time,JSON.stringify(data)));
    } else if(event.kind==='retire' && /^open-\d+$/.test(event.key)) {
      statements.push(q("DELETE FROM workspace_records WHERE id=? AND user_id=? AND table_name='trades' AND json_extract(payload,'$.status')='open'",link.id+'/'+event.key,device.owner));
    } else if(event.kind!=='raw') return fail('Invalid capture kind.');
  }
  const balance = typeof input.balance === 'number' && Number.isFinite(input.balance) ? input.balance : null;
  const equity = typeof input.equity === 'number' && Number.isFinite(input.equity) ? input.equity : null;
  const syncedAt=now();
  statements.push(q('UPDATE mt5_devices SET last_seen=? WHERE id=?',unix,device.id));
  statements.push(q(`UPDATE mt5_links SET retry_requested_at=NULL,
     capture_health=CASE WHEN EXISTS(SELECT 1 FROM mt5_evidence_conflicts c
       WHERE c.link=? AND c.review_status='needs_review'
         AND NOT EXISTS(SELECT 1 FROM mt5_conflict_classifications k
           WHERE k.link=c.link AND k.event_key=c.event_key AND k.candidate_sha256=c.candidate_sha256))
       THEN 'needs_attention' ELSE 'synced' END
     WHERE id=?`,link.id,link.id));
  statements.push(q(`UPDATE mt5_links SET last_sync=?,gap=MAX(gap,?),
    broker_balance=COALESCE(?,broker_balance),broker_equity=COALESCE(?,broker_equity),
    performance_baseline_balance=CASE WHEN performance_baseline_at IS NULL THEN ? ELSE performance_baseline_balance END,
    performance_baseline_equity=CASE WHEN performance_baseline_at IS NULL THEN ? ELSE performance_baseline_equity END,
    performance_baseline_at=COALESCE(performance_baseline_at,CASE WHEN ? IS NOT NULL AND ? IS NOT NULL THEN ? END)
    WHERE id=?`,
    syncedAt,input.gap===true?1:0,balance,equity,balance,equity,balance,equity,syncedAt,link.id));
  if(balance!==null || equity!==null) {
    const snapshot: Fields = {};
    if(balance!==null) { snapshot.broker_balance=balance; snapshot.broker_balance_at=now(); }
    if(equity!==null) { snapshot.broker_equity=equity; snapshot.broker_equity_at=now(); }
    const patch=JSON.stringify(snapshot);
    statements.push(q("UPDATE workspace_records SET payload=json_patch(payload,?),updated_at=? WHERE id=? AND user_id=? AND table_name='trading_accounts'",patch,now(),link.account_id,device.owner));
  }
  if(input.cashScan!==undefined) {
    if(!isObject(input.cashScan) || (typeof input.cashScan.cursor!=='number' || !Number.isSafeInteger(input.cashScan.cursor)) ||
       Number(input.cashScan.cursor)<0 ||
       Number(input.cashScan.cursor)>Date.parse(String(link.linked_at)) ||
       typeof input.cashScan.complete!=='boolean' ||
       (input.cashScan.complete && input.cashScan.cursor!==0)) return fail('Invalid broker cash scan checkpoint.');
    statements.push(q(`UPDATE mt5_links SET cash_history_cursor=CASE
      WHEN cash_history_cursor IS NULL OR cash_history_cursor>? THEN ?
      ELSE cash_history_cursor END,
      cash_history_completed_at=CASE WHEN ?=1 THEN COALESCE(cash_history_completed_at,?) ELSE cash_history_completed_at END
      WHERE id=?`,input.cashScan.cursor,input.cashScan.cursor,
      Number(input.cashScan.complete),now(),link.id));
  }
  if(input.recovery!==undefined) {
    const r=input.recovery;
    if(!isObject(r)||!['catching_up','awaiting_broker_history','current'].includes(String(r.status))
      || !Number.isSafeInteger(r.scanned_through)||Number(r.scanned_through)<0
      || !Number.isSafeInteger(r.target_at)||Number(r.target_at)<Number(r.scanned_through)
      || Number(r.target_at)>Date.now()+86400000
      || !Number.isSafeInteger(r.unresolved_positions)||Number(r.unresolved_positions)<0
      || Number(r.unresolved_positions)>100000
      || typeof r.unobserved_stop_changes!=='boolean') return fail('Invalid broker recovery checkpoint.');
    statements.push(q(`INSERT INTO mt5_recovery_status
      (link,owner,state,scanned_through,target_at,unresolved_positions,unobserved_stop_changes,updated_at)
      VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(link) DO UPDATE SET
        state=CASE WHEN excluded.scanned_through>=mt5_recovery_status.scanned_through THEN excluded.state ELSE mt5_recovery_status.state END,
        scanned_through=MAX(mt5_recovery_status.scanned_through,excluded.scanned_through),
        target_at=MAX(mt5_recovery_status.target_at,excluded.target_at),
        unresolved_positions=CASE WHEN excluded.scanned_through>=mt5_recovery_status.scanned_through THEN excluded.unresolved_positions ELSE mt5_recovery_status.unresolved_positions END,
        unobserved_stop_changes=MAX(mt5_recovery_status.unobserved_stop_changes,excluded.unobserved_stop_changes),
        updated_at=excluded.updated_at WHERE mt5_recovery_status.owner=excluded.owner`,
      link.id,device.owner,r.status,r.scanned_through,r.target_at,r.unresolved_positions,
      r.unobserved_stop_changes?1:0,syncedAt));
  }
  if(input.history_done) statements.push(q("UPDATE mt5_links SET history_status='ready' WHERE id=? AND history_id=? AND history_status='requested'",link.id,input.history_done));
  await db.batch(statements);
  const history=await q('SELECT history_id AS id,history_since AS since,history_status AS status,history_mode AS mode,history_anchor_at AS anchor_at,history_anchor_ticket AS anchor_ticket,history_scanned_until AS scanned_until FROM mt5_links WHERE id=?',link.id).first();
  const preferences=await q('SELECT broker_timezone,timezone_confirmed_at,utc_conversion_status FROM mt5_links WHERE id=?',link.id).first();
  const unresolved=(await q(`SELECT COUNT(*) AS n FROM mt5_evidence_conflicts c WHERE c.link=? AND c.review_status='needs_review'
      AND NOT EXISTS(SELECT 1 FROM mt5_conflict_classifications k WHERE k.link=c.link
        AND k.event_key=c.event_key AND k.candidate_sha256=c.candidate_sha256)`,
      link.id).first<{n:number}>())?.n??0;
   return json({ok:true,history,preferences,synced_at:syncedAt,pending_reviews:(await remainingReviews(link.id))?.n??0,
     evidence_conflicts_pending:unresolved,evidence_quarantined_in_batch:quarantinedInBatch,
     evidence_integrity_status:unresolved?'needs_review':'verified_no_conflict'});
}
