interface Bindings { DB: D1Database; MT5_ALLOW_LIVE?: string }
type Fields = Record<string, unknown>;
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (message: string, status = 400) => json({ error: message }, status);
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const hash = async (value: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(x => x.toString(16).padStart(2, '0')).join('');
const limited = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const isObject = (v: unknown): v is Fields => v !== null && typeof v === 'object' && !Array.isArray(v);
const timestamp = (v: unknown): v is string => limited(v, 40) && Number.isFinite(Date.parse(v));
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
  const input = await body(request);
  if (!input) return fail('Invalid connector request.');
  const unix = Date.now();
  if (owner) {
    if (action === 'status') {
      const devices = await q('SELECT id,public_key,last_seen FROM mt5_devices WHERE owner=? AND revoked=0 AND public_key IS NOT NULL', owner).all();
      const links = await q('SELECT l.id,l.account_id,l.status,l.company,l.server,l.login,l.history_id,l.history_status,l.history_since,l.last_sync,l.broker_balance,l.broker_equity,l.currency,l.gap,l.last_error,l.expires FROM mt5_links l JOIN mt5_devices d ON d.id=l.device WHERE d.owner=? AND d.revoked=0', owner).all();
      const accounts=await q("SELECT id,json_extract(payload,'$.name') AS name FROM workspace_records WHERE user_id=? AND table_name='trading_accounts' ORDER BY created_at",owner).all();
      return json({ accounts:accounts.results, devices: devices.results, links: links.results, demoOnly: env.MT5_ALLOW_LIVE !== 'true' });
    }
    if (['history-request','history-preview','history-import','history-decline'].includes(action)) {
      const link=await q("SELECT l.* FROM mt5_links l JOIN mt5_devices d ON d.id=l.device WHERE l.id=? AND d.owner=? AND d.revoked=0 AND l.status='connected'",input.link,owner).first<{id:string;account_id:string;currency:string;company:string;linked_at:string;history_id:string;history_status:string}>();
      if(!link) return fail('Linked account unavailable.',404);
      if(action==='history-request') {
        const days=Number(input.days);
        if(!Number.isSafeInteger(days)||days<1||days>3650) return fail('Choose 1–3650 days.');
        if(link.history_status==='requested') return fail('History scan already running.',409);
        const requestId=uuid();
        await q("UPDATE mt5_links SET history_id=?,history_status='requested',history_since=? WHERE id=?",requestId,Date.parse(link.linked_at)-days*86400000,link.id).run();
        return json({ok:true});
      }
      const prefix='history:'+link.history_id+':';
      const rows=await q("SELECT event_key,payload FROM mt5_events WHERE link=? AND substr(event_key,1,?)=? ORDER BY event_key LIMIT 101",link.id,prefix.length,prefix).all<{event_key:string;payload:string}>();
      if(action==='history-preview') return json({status:link.history_status,rows:rows.results.slice(0,100).map(r=>JSON.parse(r.payload)),more:rows.results.length>100});
      if(input.request!==link.history_id) return fail('Preview changed. Reload before deciding.',409);
      if(action==='history-decline') {
        await q("UPDATE mt5_links SET history_status='declined' WHERE id=?",link.id).run();
        return json({ok:true});
      }
      if(!['ready','imported'].includes(link.history_status)) return fail('Wait for the preview to complete.',409);
      const items=await q("SELECT event_key,payload FROM mt5_events WHERE link=? AND substr(event_key,1,?)=? AND NOT EXISTS(SELECT 1 FROM workspace_records w WHERE w.id=mt5_events.link||'/'||substr(mt5_events.event_key,?)) LIMIT 40",link.id,prefix.length,prefix,prefix.length+1).all<{event_key:string;payload:string}>();
      // Import in retryable batches. Matched or previously imported ticket IDs are skipped.
      const statements=items.results.map(row=>{
        const key=row.event_key.slice(prefix.length),id=link.id+'/'+key;
        const data={...JSON.parse(row.payload),id,user_id:owner,account_id:link.account_id,trade_source:'mt5',broker:link.company,settlement_currency:link.currency,historical_import:true,mistakes:[],pips:0};
        return q("INSERT OR IGNORE INTO workspace_records(id,user_id,table_name,payload,created_at,updated_at) VALUES(?,?,'trades',?,?,?)",id,owner,JSON.stringify(data),now(),now());
      });
      let added=0;
      for(let i=0;i<statements.length;i+=40) for(const result of await db.batch(statements.slice(i,i+40))) added+=result.meta.changes;
      await q("UPDATE mt5_links SET history_status='imported' WHERE id=?",link.id).run();
      return json({added,more:items.results.length===40});
    }
    if (action === 'pair') {
      const code = uuid().replaceAll('-', '');
      await q('INSERT INTO mt5_devices(id,owner,pair_hash,expires) VALUES(?,?,?,?)', uuid(), owner, await hash(code), unix + 300000).run();
      return json({ code });
    }
    if (action === 'revoke') {
      await db.batch([q('UPDATE mt5_devices SET revoked=1,token_hash=NULL WHERE id=? AND owner=?', input.device, owner),
        q('UPDATE mt5_links SET envelope=NULL,status=? WHERE device IN (SELECT id FROM mt5_devices WHERE id=? AND owner=?)','revoked',input.device,owner)]);
      return json({ ok: true });
    }
    if (action === 'connect') {
      const device = await q('SELECT id FROM mt5_devices WHERE id=? AND owner=? AND revoked=0 AND last_seen>?', input.device, owner, unix - 90000).first();
      if (!device) return fail('Connector offline. Start it on your PC and retry.', 409);
      if (!isObject(input.envelope) || !['wrapped','iv','data'].every(k => limited((input.envelope as Fields)[k],4096))) return fail('Invalid encrypted request.');
      const id = uuid();
      if(input.account && (!limited(input.account,100) || !await q("SELECT id FROM workspace_records WHERE user_id=? AND table_name='trading_accounts' AND id=?",owner,input.account).first())) return fail('Unknown journal account.');
      const accountId=input.account || uuid();
      if(await q("SELECT id FROM mt5_links WHERE account_id=? AND (status='connected' OR (status IN ('pending','verifying') AND expires>?))",accountId,unix).first()) return fail('This journal account already has a connection.',409);
      await q('INSERT INTO mt5_links(id,owner,device,account_id,envelope,expires) VALUES(?,?,?,?,?,?)', id,owner,input.device,accountId,JSON.stringify(input.envelope),unix+90000).run();
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
    if (!limited(input.code,64) || !limited(input.publicKey,1024) || !/^[a-zA-Z0-9+/=]+$/.test(input.publicKey)) return fail('Invalid pairing request.');
    const token=uuid()+uuid();
    const result=await q('UPDATE mt5_devices SET pair_hash=NULL,token_hash=?,public_key=?,last_seen=? WHERE pair_hash=? AND expires>? AND revoked=0 RETURNING id',await hash(token),input.publicKey,unix,await hash(input.code),unix).first();
    return result ? json({token}) : fail('Pairing code expired or already used.',403);
  }
  const token=request.headers.get('authorization')?.match(/^Bearer (.{72})$/)?.[1];
  if (!token) return fail('Device authentication required.',401);
  const device=await q("SELECT d.id,d.owner FROM mt5_devices d JOIN users u ON u.id=d.owner WHERE token_hash=? AND revoked=0 AND u.account_status='active'",await hash(token)).first<{id:string;owner:string}>();
  if (!device) return fail('Device access revoked.',403);
  if (action==='device/poll') {
    await q('UPDATE mt5_devices SET last_seen=? WHERE id=?',unix,device.id).run();
    await q("UPDATE mt5_links SET envelope=NULL,status='expired' WHERE device=? AND status IN ('pending','verifying') AND expires<=?",device.id,unix).run();
    const job=await q("SELECT id,envelope FROM mt5_links WHERE device=? AND status='pending' AND expires>? ORDER BY expires LIMIT 1",device.id,unix).first<{id:string;envelope:string}>();
    if (!job) return json({job:null});
    const claimed=await q("UPDATE mt5_links SET status='verifying',envelope=NULL,expires=? WHERE id=? AND status='pending'",unix+90000,job.id).run();
    return json({ job: claimed.meta.changes ? {id:job.id,envelope:JSON.parse(job.envelope)} : null });
  }
  if (!limited(input.link,64)) return fail('Missing link.');
  const link=await q('SELECT * FROM mt5_links WHERE id=? AND device=?',input.link,device.id).first<{id:string;account_id:string;status:string;currency:string;company:string;expires:number}>();
  if (!link) return fail('Unknown link.',404);
  if (action==='device/verified') {
    if (link.status==='connected') return json({ok:true});
    if (link.status!=='verifying' || link.expires<=unix) return fail('Login expired.',409);
    if (!input.ok || (env.MT5_ALLOW_LIVE!=='true' && input.mode!==0)) {
      const reasons: Record<string,string> = {
        terminal_start:'Could not attach to the dedicated terminal. Open its terminal64.exe with /portable, finish startup, then retry.',
        wrong_terminal:'MT5 opened a different data folder. Close the dedicated copy and open it with /portable.',
        broker_rejected:'MT5 rejected authorization. Check the login ID, investor password and exact assigned server.',
        broker_login:'MT5 could not log in to this server. In the dedicated terminal use File → Open an Account, find your broker and select its assigned server, then retry.',
        trading_access:'MT5 authenticated with trading permissions. Use the read-only investor password for this account.',
        disconnected:'MT5 did not establish a broker connection. Check the dedicated terminal’s Journal.',
        identity_mismatch:'The connected login or broker server differs from the requested account.',
        no_slot:'All configured terminals are in use. Add a separate portable installation for this account.',
        invalid_job:'The PC could not read this login request. Reopen the login form and retry.'
      };
      const reason=Object.hasOwn(reasons,String(input.reason)) ? reasons[String(input.reason)] : 'Login failed. Check server, investor access and dedicated terminal availability.';
      const detail=Number.isSafeInteger(input.api_code) ? ' (MT5 code '+input.api_code+')' : '';
      await q("UPDATE mt5_links SET status='failed',last_error=? WHERE id=?",input.ok?'Demo accounts only during verification.':reason+detail,link.id).run();
      return input.ok ? fail('Could not enable account.',409) : json({ok:true});
    }
    if (!limited(input.login,24)||!/^\d+$/.test(input.login)||!limited(input.server,128)||!limited(input.company,128)||!limited(input.currency,12)||typeof input.balance!=='number'||!Number.isFinite(input.balance)) return fail('Invalid account metadata.');
    const duplicate=await q("SELECT 1 FROM mt5_links l JOIN mt5_devices d ON d.id=l.device WHERE d.owner=? AND l.login=? AND l.server=? AND l.status='connected' AND d.revoked=0",device.owner,input.login,input.server).first();
    if(duplicate) return fail('Account already linked.',409);
    const prior=await q("SELECT payload FROM workspace_records WHERE id=? AND user_id=? AND table_name='trading_accounts'",link.account_id,device.owner).first<{payload:string}>();
    if(prior){
      const account=JSON.parse(prior.payload);
      if(account.base_currency!==input.currency || (account.account_number && String(account.account_number)!==input.login)) {
        await q("UPDATE mt5_links SET status='failed',last_error='Account currency or login differs from journal settings.' WHERE id=?",link.id).run();
        return fail('Journal account does not match verified account.',409);
      }
    }
    const time=now(), account={name:input.company+' · '+input.login,account_number:input.login,broker_name:input.company,base_currency:input.currency,balance:input.balance,balance_as_of:time,is_active:true,risk_per_trade_pct:1,user_id:device.owner};
    await db.batch([q("UPDATE mt5_links SET status='connected',login=?,server=?,company=?,currency=?,linked_at=? WHERE id=?",input.login,input.server,input.company,input.currency,time,link.id),
      q("INSERT INTO workspace_records(id,user_id,table_name,payload,created_at,updated_at) VALUES(?,?,'trading_accounts',?,?,?) ON CONFLICT(id) DO UPDATE SET payload=json_patch(workspace_records.payload,?),updated_at=excluded.updated_at WHERE workspace_records.user_id=excluded.user_id AND workspace_records.table_name='trading_accounts'",link.account_id,device.owner,JSON.stringify(account),time,time,JSON.stringify({broker_name:input.company,account_number:input.login}))]);
    return json({ok:true});
  }
  if(action!=='device/sync'||link.status!=='connected') return fail('Link unavailable.',409);
  if (!Array.isArray(input.events)||input.events.length>40) return fail('Invalid capture batch.');
  const statements:D1PreparedStatement[]=[];
  for(const event of input.events) {
    if(!isObject(event)||!limited(event.key,120)||!isObject(event.fields)) return fail('Invalid capture event.');
    const f=event.fields, time=now();
    statements.push(q('INSERT INTO mt5_events(link,event_key,payload) VALUES(?,?,?) ON CONFLICT(link,event_key) DO UPDATE SET payload=excluded.payload',link.id,event.key,JSON.stringify(f)));
    if(event.kind==='trade' || event.kind==='history') {
      if(!limited(f.pair,80)||!['long','short'].includes(String(f.direction))||!['open','closed'].includes(String(f.status))||!timestamp(f.entry_time)||typeof f.pnl!=='number'||!Number.isFinite(f.pnl)||(f.status==='closed'&&!timestamp(f.exit_time))) return fail('Invalid trade.');
      const allowed=['pair','direction','entry_price','exit_price','stop_loss','take_profit','lot_size','status','pnl','entry_time','exit_time','fees','broker_details','initial_risk'];
      const data=Object.fromEntries(allowed.filter(k=>k in f).map(k=>[k,f[k]]));
      Object.assign(data,{trade_source:'mt5',capture_mode:'live',account_id:link.account_id,user_id:device.owner,settlement_currency:link.currency,broker:link.company,outcome:f.status==='open'?null:f.pnl>0?'win':f.pnl<0?'loss':'breakeven'});
      if(event.kind==='history'){
        const history=await q('SELECT history_id,history_status,linked_at FROM mt5_links WHERE id=?',link.id).first<{history_id:string;history_status:string;linked_at:string}>();
        if(!history || !event.key.startsWith('history:'+history.history_id+':close-') || history.history_status!=='requested' || f.status!=='closed' || Date.parse(String(f.exit_time))>=Date.parse(history.linked_at)) { statements.pop(); continue; }
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
  statements.push(q('UPDATE mt5_links SET last_sync=?,gap=MAX(gap,?),broker_balance=COALESCE(?,broker_balance),broker_equity=COALESCE(?,broker_equity) WHERE id=?',now(),input.gap===true?1:0,balance,equity,link.id));
  if(balance!==null) statements.push(q("UPDATE workspace_records SET payload=json_set(payload,'$.broker_balance',?,'$.broker_balance_at',?),updated_at=? WHERE id=? AND user_id=? AND table_name='trading_accounts'",balance,now(),now(),link.account_id,device.owner));
  if(input.history_done) statements.push(q("UPDATE mt5_links SET history_status='ready' WHERE id=? AND history_id=? AND history_status='requested'",link.id,input.history_done));
  await db.batch(statements);
  const history=await q('SELECT history_id AS id,history_since AS since,history_status AS status FROM mt5_links WHERE id=?',link.id).first();
  return json({ok:true,history});
}
