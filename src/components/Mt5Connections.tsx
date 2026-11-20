import { Select } from '@/components/Select';
import { pnlTone, signedMoney } from '@/lib/tradingTone';
import { Monitor, Link2, Download, X } from 'lucide-react';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useTrades } from '@/hooks/useData';

import { mt5Action as action, monitoringStatus, pcOnline, pairedPcName, type Device, type Link } from '@/lib/mt5Monitor';

type PositionSummary = {
  lifecycle_id:string;position_id:string;symbol:string;direction:string;status:string;
  first_entry_at:string;final_exit_at?:string|null;initial_entry_price?:string|null;
  net_realized_profit?:string|null;realized_r?:string|null;final_realized_r?:string|null;
  initial_risk_account?:string|null;initial_sl?:string|null;initial_stop_provenance?:string;
  initial_sl_provenance?:string;initial_sl_observed_at?:string|null;initial_tp?:string|null;
  current_sl?:string|null;current_tp?:string|null;remaining_volume?:string|null;
  movement?:string|null;movement_unit?:string;holding_seconds?:string|null;
  weighted_holding_seconds?:string|null;entries?:Record<string,unknown>[];exits?:Record<string,unknown>[];
  sessions?:{status:string;sessions?:string[];overlaps?:string[];reason?:string};
  capture_completeness?:{original_risk?:string;risk_reason?:string;session_status?:string};
  capital_at_entry?:{value?:string|null;source?:string;observed_at?:string|null};
};
type PositionRow = {link:string;account_id:string;lifecycle_id:string;version:number;recorded_at:string;summary:PositionSummary};
type HistoryScan = { link: string; request: string };
type SelectedScan = HistoryScan & { name: string; brokerAccount: string };
type HistoryPage = HistoryScan & { rows: Record<string,unknown>[]; more: boolean; nextOffset: number };
export function Mt5Connections() {
  const { user } = useAuth();
  const { trades, fetchTrades } = useTrades(user?.id);
  const [devices,setDevices] = useState<Device[]>([]);
  const [editingPc,setEditingPc] = useState<string | null>(null);
  const [pcNameDraft,setPcNameDraft] = useState('');
  const [links,setLinks] = useState<Link[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const [device,setDevice] = useState('');
  const [requestedPc,setRequestedPc] = useState(()=>new URLSearchParams(window.location.search).get('addAccount'));
  const [capturePaused,setCapturePaused] = useState(false);
  const openLogin = useCallback((id:string) => {
    setDevice(id);
    setRequestedPc(null);
    const url = new URL(window.location.href);
    if (url.searchParams.has('addAccount')) {
      url.searchParams.delete('addAccount');
      window.history.replaceState(null,'',url);
    }
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);
  useEffect(()=>{
    if (!requestedPc || capturePaused) return;
    const target = requestedPc==='1' ? (devices.length===1?devices[0]:undefined) : devices.find(d=>d.id===requestedPc);
    if (target && pcOnline(target) && target.setup_state!=='install') openLogin(target.id);
  },[devices,requestedPc,openLogin,capturePaused]);
  const [accountNames,setAccountNames]=useState<Record<string,string>>({});
  const [loaded,setLoaded] = useState(false);
  const [code,setCode] = useState('');
  const [error,setError] = useState('');
  const [setupHint,setSetupHint] = useState('');
  const [demo,setDemo] = useState(true);
  const [imported,setImported] = useState('');
  const [historyScan, setHistoryScan] = useState<SelectedScan | null>(null);
  const latestRefresh = useRef(0);
  const [historyDays,setHistoryDays]=useState('30');
  const [historyCustomDays,setHistoryCustomDays]=useState('');
  const [historyMode,setHistoryMode]=useState('days');
  const [historyFromDate,setHistoryFromDate]=useState('');
  const [positions,setPositions]=useState<PositionRow[]>([]);
  const [positionsMore,setPositionsMore]=useState(false);
  const [timezoneDraft,setTimezoneDraft]=useState<Record<string,string>>({});
  const [timezoneProof,setTimezoneProof]=useState<Record<string,boolean>>({});
  const [manual,setManual] = useState('');
  const refresh = useCallback(async () => {
    const revision = ++latestRefresh.current;
    const [data,rich]=await Promise.all([action('status'),action('positions').catch(()=>({rows:[],more:false}))]);
    if (revision !== latestRefresh.current) return;
    setAccountNames(Object.fromEntries((data.accounts||[]).map((a:{id:string;name:string})=>[a.id,a.name])));
    setDevices(data.devices); setLinks(data.links); setDemo(data.demoOnly); setCapturePaused(Boolean(data.capturePaused)); setLoaded(true);
    setPositions(rich.rows || []);setPositionsMore(Boolean(rich.more));
  }, []);
  useEffect(() => {
    const read = () => { if (!document.hidden) void refresh().catch(e=>setError(e.message)); };
    read(); const timer = window.setInterval(read,15000); return () => clearInterval(timer);
  }, [refresh]);
  async function run(operation: () => Promise<void>) {
    try { setError(''); await operation(); await refresh(); } catch (e) {setError(e instanceof Error ? e.message : 'Request failed.');}
  }
  function startAccountSetup() {
    setSetupHint('');
    const ready = devices.filter(pc => pcOnline(pc) && pc.setup_state !== 'install');
    if (ready.length === 1) { openLogin(ready[0].id); return; }
    if (ready.length > 1) {
      setSetupHint('Choose the PC to monitor this account on using Add account beside that PC.');
    } else if (devices.some(pc => pcOnline(pc) && pc.setup_state === 'install')) {
      setSetupHint('MetaTrader 5 is not installed on your paired PC. Install it using the connector instructions; detection runs automatically.');
    } else if (devices.length) {
      setSetupHint('Open the YoungMoney3 Connector on your PC. Your pairing is saved, and the login form will become available when it is online.');
    } else {
      setSetupHint('First download and open the Windows Connector, then choose Pair a PC. You will not need to find any MT5 program folders.');
    }
  }
  const source = (t: typeof trades[number]) => (t as {trade_source?:string}).trade_source;
  const historyAccount = links.find(link => link.id === historyScan?.link);
  const failedLinks = links.filter(link => ['failed','expired'].includes(link.status));
  const activeLinks = links.filter(link => !['failed','expired'].includes(link.status));
  const selected = trades.find(t=>t.id===imported);
  const matches = trades.filter(t=>selected && source(t)!=='mt5' && selected.pair===t.pair && t.account_id===selected.account_id && t.direction===selected.direction);
  return <main className="space-y-5">
    <SectionHeader title="MT5 Connections" subtitle="Add a broker login, check its last sync, and manage account monitoring." />
    <section className="card p-5 sm:p-6 space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 font-bold"><Monitor size={20} className="text-brand-500"/> Paired PCs</h2>
    <div className="flex flex-wrap gap-2">
      <button className="btn-primary" disabled={capturePaused} onClick={startAccountSetup}>Add account</button>
      <button className="btn-secondary" disabled={capturePaused} onClick={()=>{
        if(devices.length && !window.confirm('Pair a different PC? Existing PCs stay paired. If this is the same PC, reopen its connector instead of creating another pairing.')) return;
        void run(async()=>setCode((await action('pair')).code));
      }}>Pair a different PC</button>
    </div></header>
    {setupHint && <p role="status" className="rounded-xl bg-secondary p-3 text-sm text-secondary">{setupHint}</p>}
    {capturePaused && <p role="status">Staging capture is paused by your administrator.</p>}
    {loaded && !devices.length && <p className="text-sm text-secondary">Run the Windows connector, then enter your pairing code on that PC.</p>}
    {devices.length>0 && <p className="text-xs text-secondary">Each connector installation should be paired once. Rename your PCs to identify them easily; adding more broker accounts does not require pairing again.</p>}
    <div className="flex flex-wrap items-center gap-2">
      <a className="btn-primary inline-flex items-center gap-2" href="https://github.com/cash-factory/YoungMoney3/releases/download/staging-connector-v0.5.0-rc1/YoungMoney3.Connector.exe" rel="noopener noreferrer" aria-label="Download YoungMoney3 Windows Connector version 0.5.0 release candidate 1"><Download size={15}/>Download Connector v0.5.0-rc1</a>
      <a className="btn-secondary inline-flex items-center gap-2" href="/connector-download.html">Release details &amp; SHA-256</a>
      <a className="btn-secondary inline-flex items-center gap-2" href="/mt5-connector.zip" download><Download size={15}/>Python source fallback</a>
    </div>
    <p className="text-xs text-muted">Official Windows x64 staging prerelease · unsigned · capture-only. Verify the executable checksum before running. Existing PC pairings remain available.</p>
    {code && <p>Enter this pairing code in the connector within five minutes: <code className="break-all select-all">{code}</code></p>}
    {devices.map(d=><div className="border-t border-themed pt-4 space-y-3" key={d.id} role="group" aria-label={'Paired PC '+pairedPcName(d)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap gap-2 items-center">
            <strong className="text-sm">{pairedPcName(d)}</strong>
            <span className={`ym-market-chip`} data-tone={pcOnline(d)?'positive':'neutral'}>{pcOnline(d)?'Online':'Offline'}</span>
          </div>
          <p className="text-xs text-secondary">PC ID {d.id.slice(0,8)} · {d.connector_version||'Connector version unknown'} · {links.filter(link=>link.device===d.id && link.status==='connected').length} linked accounts</p>
          <p className="text-xs text-secondary">{!pcOnline(d)?'Open the existing connector on this PC. Its pairing is saved.':
            d.setup_state === 'install'?'Install MetaTrader 5 on this PC. The connector will detect it automatically.':
            d.setup_state === 'ready'?'Ready to add an account.':'Use the latest connector for automatic account setup.'}</p>
          <p className="text-xs text-muted">{d.last_seen?'Last contacted '+new Date(d.last_seen).toLocaleString():'Not checked in yet'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" disabled={!pcOnline(d) || d.setup_state==='install' || capturePaused} onClick={()=>openLogin(d.id)}>Add account</button>
          <button type="button" className="btn-secondary" aria-label={'Rename '+pairedPcName(d)} onClick={()=>{setEditingPc(d.id);setPcNameDraft(pairedPcName(d));}}>Rename</button>
          <button type="button" className="btn-secondary" onClick={()=>{if(window.confirm('Unpair '+pairedPcName(d)+'? Monitoring on this PC stops and its broker connections are revoked. Historical evidence is preserved but may no longer appear under active connections. Keep your active PC and accounts.')) void run(()=>action('revoke',{device:d.id}));}}>Unpair PC</button>
        </div>
      </div>
      {editingPc===d.id && <div className="flex flex-wrap gap-2 items-end rounded-lg bg-secondary p-3" aria-label={'Rename PC '+d.id.slice(0,8)}>
        <label className="flex-1 min-w-[180px] text-xs text-secondary">Display name
          <input className="input-field mt-1" maxLength={48} value={pcNameDraft}
            placeholder="e.g. My Trading Laptop" onChange={event=>setPcNameDraft(event.target.value)}/>
        </label>
        <button type="button" className="btn-primary" disabled={pcNameDraft.trim().length<2} onClick={()=>void run(async()=>{
          await action('rename-pc',{device:d.id,name:pcNameDraft.trim()});
          setEditingPc(null);
        })}>Save name</button>
        <button type="button" className="btn-secondary" onClick={()=>setEditingPc(null)}>Cancel</button>
      </div>}
    </div>)}
    {requestedPc && loaded && <p role="status" className="text-sm text-secondary">{!devices.length?'Pair this PC once to continue.':
      requestedPc==='1' && devices.length>1?'Choose the PC where MetaTrader is installed.':
      !devices.some(d=>requestedPc==='1' || d.id===requestedPc)?'This PC is paired with a different workspace or has been removed.':
      'Leave the connector open on the paired PC. The login form opens when it is ready.'}</p>}
    </section>
    <section className="card p-5 sm:p-6 space-y-3">
      <h2 className="flex items-center gap-2 font-bold"><Link2 size={20} className="text-brand-500"/>Linked accounts</h2>
      <p className="text-sm text-secondary">{demo?'Staging supports demo and contest accounts.':'Demo, contest and real accounts are available.'} The connector prepares MetaTrader for each login and records trades and balances.</p>
      {loaded && !links.length && <p className="rounded-xl bg-secondary p-4 text-sm text-secondary">Choose Add account next to your paired PC to connect a broker login.</p>}
      {loaded && !activeLinks.length && failedLinks.length>0 && <p className="text-sm text-secondary">No active broker accounts yet. Previous failed attempts are grouped below.</p>}
    {links.some(l=>l.status==='connected') && <div className="grid gap-3 sm:grid-cols-2 rounded-xl border border-themed p-4">
      <label className="block text-xs text-secondary">Find earlier trades — choose history range
        <Select className="input-field mt-1" value={historyMode} onChange={e=>setHistoryMode(e.target.value)}>
          <option value="days">Duration before account linking</option>
          <option value="from_date">From a specific date</option>
          <option value="all">All history available from broker</option>
          <option value="since_last_deposit">After the latest recorded deposit</option>
          <option value="since_first_deposit">After the first recorded deposit</option>
        </Select>
      </label>
      {historyMode==='days' && <label className="block text-xs text-secondary">Lookback duration
        <Select className="input-field mt-1" value={historyDays} onChange={e=>setHistoryDays(e.target.value)}>
          <option value="7">7 days before linking</option>
          <option value="14">14 days before linking</option>
          <option value="30">30 days before linking (default)</option>
          <option value="60">60 days before linking</option>
          <option value="90">90 days before linking</option>
          <option value="180">180 days before linking</option>
          <option value="365">1 year before linking</option>
          <option value="730">2 years before linking</option>
          <option value="1825">5 years before linking</option>
          <option value="custom">Custom number of days</option>
        </Select>
      </label>}
      {historyMode==='days' && historyDays==='custom' && <label className="block text-xs text-secondary">Custom lookback (days)
        <input type="number" className="input-field mt-1" min="1" max="36525" step="1" placeholder="e.g. 240" value={historyCustomDays} onChange={e=>setHistoryCustomDays(e.target.value)}/>
      </label>}
      {historyMode==='from_date' && <label className="block text-xs text-secondary">Start date (UTC)
        <input type="date" className="input-field mt-1" min="1970-01-01" max={new Date().toISOString().slice(0,10)} value={historyFromDate} onChange={e=>setHistoryFromDate(e.target.value)}/>
      </label>}
      <p className="text-xs text-muted sm:col-span-2">Each scan belongs to its selected broker account. All-history and deposit-based scans may be lengthy. Deposit modes use positive MT5 balance transactions, not balance snapshots; credits and bonuses are not assumed to be deposits. Only history the broker exposes can be recovered. Review all fills before importing; unavailable historical SL/TP changes are never invented.</p>
    </div>}
    {activeLinks.map(l=><div key={l.id} role="group" aria-label={'MT5 account '+(accountNames[l.account_id || ''] || l.company || 'Pending')+(l.login?' · '+l.login:'')} className="rounded-xl border border-themed p-4 space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-3"><div>
        <h3 className="font-semibold">{accountNames[l.account_id || ''] || l.company || l.server || 'Broker account'}</h3>
        <p className="text-xs text-secondary">{[l.server,l.login,l.trade_mode===0?'Demo':l.trade_mode===1?'Contest':l.trade_mode===2?'Real':null].filter(Boolean).join(' · ')}</p>
        <p className="text-xs text-muted mt-1">Paired PC: {pairedPcName(devices.find(pc=>pc.id===l.device))}</p>
      </div><strong className="text-sm">{monitoringStatus(l,devices.find(d=>d.id===l.device),capturePaused)}</strong></header>
      {l.last_error && <p className="text-sm" role="status">{l.last_error}</p>}
      {l.status==='connected' && <div className="space-y-3">
        {(l.broker_balance!=null || l.broker_equity!=null) && <p className="text-sm">{[
          l.broker_balance!=null && 'Balance '+l.broker_balance.toLocaleString()+' '+l.currency,
          l.broker_equity!=null && 'Equity '+l.broker_equity.toLocaleString()+' '+l.currency].filter(Boolean).join(' · ')}</p>}
        <p className="text-sm">Last acknowledged {l.last_sync?new Date(l.last_sync).toLocaleString():'—'} · {l.pending_reviews??0} decisions awaiting review</p>
        {Boolean(l.gap) && <p className="text-xs text-secondary">An offline interval may have left gaps in stop changes.</p>}
        <div className="flex flex-wrap gap-2"><button className="btn-secondary" onClick={()=>run(()=>action('set-monitoring',{link:l.id,paused:!l.monitoring_paused}))}>{l.monitoring_paused?'Resume monitoring':'Pause monitoring'}</button>
        <button className="btn-secondary" disabled={!!l.retry_requested_at || !!l.monitoring_paused || capturePaused} onClick={()=>run(()=>action('retry-session',{link:l.id}))}>{l.retry_requested_at?'Retry queued for this account':'Retry this account'}</button></div>
        <details className="space-y-2"><summary className="cursor-pointer text-sm">Broker timezone and permissions</summary>
        <p className="text-xs text-secondary">{l.access_level==='trading-enabled'?'The login has broker trading permissions. YoungMoney3 uses it for capture only.':'YoungMoney3 uses this account for capture only.'}</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1 min-w-44 text-xs text-secondary">IANA timezone (broker statement)
            <input list="broker-timezones" className="input-field mt-1" placeholder="e.g. Europe/Athens" value={timezoneDraft[l.id] ?? l.broker_timezone ?? ''} onChange={event=>setTimezoneDraft(previous=>({...previous,[l.id]:event.target.value}))}/>
          </label>
          <button className="btn-secondary" onClick={()=>run(async()=>{await action('timezone-confirm',{link:l.id,timezone:(timezoneDraft[l.id] ?? l.broker_timezone ?? '').trim(),confirm:true,utcEvidence:timezoneProof[l.id]?'broker_statement_checked':undefined});})}>Confirm timezone</button>
        </div>
        <label className="flex items-start gap-2 text-xs text-secondary">
          <input type="checkbox" checked={Boolean(timezoneProof[l.id])} onChange={event=>setTimezoneProof(previous=>({...previous,[l.id]:event.target.checked}))}/>
          I checked a broker statement against the raw MT5 timestamps, including historical UTC conversion. Do not select this unless verified.
        </label>
        <p className="text-xs text-muted">Timezone: {l.broker_timezone || 'Unconfirmed'} · UTC conversion: {l.utc_conversion_status || 'Unverified'} · Historical session labels remain unresolved until both are verified.</p></details>
      </div>}
      {l.status==='connected' && <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" disabled={['requested','resolving'].includes(l.history_status||'') || !!l.monitoring_paused || capturePaused || (historyMode==='from_date'&&!historyFromDate) || (historyMode==='days'&&historyDays==='custom'&&!historyCustomDays)} onClick={()=>run(async()=>{
            const payload:Record<string,unknown>={link:l.id,mode:historyMode};
            if(historyMode==='days') payload.days=Number(historyDays==='custom'?historyCustomDays:historyDays);
            if(historyMode==='from_date') payload.since=historyFromDate;
            await action('history-request',payload);
          })}>Find earlier trades</button>
          {['requested','resolving'].includes(l.history_status||'') && <>
            <span role="status" className="text-sm">{l.history_status==='resolving'?'Locating the requested deposit in broker transactions.':'Scanning broker history on your PC.'} Keep the connector running.</span>
            <button className="btn-secondary" onClick={()=>run(async()=>{await action('history-decline',{link:l.id,request:l.history_id});})}>Cancel scan</button>
          </>}
          {l.history_id && ['ready','imported'].includes(l.history_status || '') && <button className="btn-secondary"
            onClick={()=>setHistoryScan({link:l.id, request:l.history_id!, brokerAccount:[l.server,l.login].filter(Boolean).join(' · '), name:accountNames[l.account_id || ''] || [l.company,l.login].filter(Boolean).join(' ') || 'Linked account'})}>Review earlier trades</button>}
        </div>
        {l.history_status==='no_deposit' && <p role="status" className="text-sm">No qualifying positive broker balance deposit was found in the available MT5 history. Select another range or check your broker statement.</p>}
        {l.history_anchor_at!=null && <p className="text-xs text-secondary">Deposit boundary: {new Date(l.history_anchor_at).toLocaleString()} · Broker deal {l.history_anchor_ticket||'Unknown'} · {l.history_anchor_amount??'Unknown'} {l.currency||''}. Confirm this matches your deposit statement.</p>}
        {l.history_scanned_until!=null && l.history_status==='requested' && <p className="text-xs text-muted">History scanned through {new Date(l.history_scanned_until).toLocaleDateString()} (broker records permitting).</p>}
      </div>}
    </div>)}
    {failedLinks.length>0 && <details className="rounded-xl border border-themed p-4 space-y-3">
      <summary className="cursor-pointer font-semibold">Failed or expired login attempts ({failedLinks.length})</summary>
      <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
        <p className="text-sm text-secondary">These are unsuccessful connection requests, not monitored trading accounts. Clearing them will not delete your connected accounts or journal.</p>
        <button className="btn-secondary" onClick={()=>{if(window.confirm('Remove all failed and expired MT5 login attempts without broker evidence? Connected accounts will stay.')) void run(async()=>{await action('clear-failed');});}}>Clear failed attempts</button>
      </div>
      {failedLinks.map(l=><div key={l.id} role="group" aria-label={'Failed MT5 attempt '+(l.server||l.company||'Unknown broker')} className="rounded-lg border border-themed p-3 space-y-2">
        <div className="flex flex-wrap justify-between gap-3">
          <div><strong className="text-sm">{l.company||l.server||'Broker login attempt'}</strong>
            <p className="text-xs text-secondary">{[l.server,l.login].filter(Boolean).join(' · ')||'Unverified broker login'}</p></div>
          <button className="btn-secondary" onClick={()=>{if(window.confirm('Remove this failed MT5 attempt? Any connected broker account and its trading history will remain.')) void run(async()=>{await action('remove-failed',{link:l.id});});}}>Remove attempt</button>
        </div>
        <p className="text-xs text-secondary">{l.last_error|| (l.status==='expired'?'The login request expired.':'Broker login failed.')}</p>
      </div>)}
    </details>}
    <datalist id="broker-timezones">
      <option value="Etc/UTC"/><option value="Europe/Athens"/><option value="Europe/Helsinki"/>
      <option value="Europe/London"/><option value="Africa/Johannesburg"/><option value="America/New_York"/>
      <option value="Europe/Berlin"/><option value="Asia/Dubai"/>
    </datalist>
    {historyScan && <HistoryReview key={historyScan.link+'/'+historyScan.request} scan={historyScan}
      status={historyAccount?.history_id === historyScan.request ? historyAccount.history_status : undefined}
      onClose={()=>setHistoryScan(current=>current===historyScan ? null : current)}
      onFinished={async imported=>{
        setHistoryScan(current=>current===historyScan ? null : current);
        await run(async()=>{if(imported) await fetchTrades();});
      }}/>}
    </section>
    <section className="card p-5 sm:p-6 space-y-4" aria-label="Rich position lifecycles">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-base font-bold">Position lifecycles</h2>
          <p className="text-xs text-muted mt-1">A position lifecycle contains its entries, scale-ins and partial closes. Raw broker records are kept separately for audit.</p>
        </div>
        <span className="badge badge-neutral">{positions.length} projected positions</span>
      </header>
      {loaded && positions.length===0 && <p className="rounded-xl bg-secondary p-4 text-sm text-secondary">No rich broker position summaries have synced yet. Start the staging Windows connector and leave it running with a demo account.</p>}
      <div className="space-y-2">
        {positions.map(item=>{
          const x=item.summary;
          const broker=links.find(link=>link.id===item.link);
          return <details key={item.link+'/'+item.lifecycle_id} className="ym-mt5-lifecycle rounded-xl border border-themed p-3 sm:p-4" data-result={x.status==='open'?'open':pnlTone(x.net_realized_profit)==='positive'?'win':pnlTone(x.net_realized_profit)==='negative'?'loss':'neutral'}>
            <summary className="cursor-pointer list-none flex flex-wrap gap-3 items-center justify-between">
              <span className="flex flex-col gap-1"><strong className="text-sm flex flex-wrap items-center gap-2">{x.symbol}
                  <span className="ym-direction-tag" data-side={x.direction}>{x.direction==='long'?'Long':'Short'}</span>
                  <span className="text-muted text-xs font-normal">{x.status==='open'?'Open':'Closed'}</span></strong>
                <small className="text-muted">{broker?.company || 'Broker'} · {broker?.login || item.account_id} · Version {item.version}</small></span>
              <span className="flex flex-col text-right"><strong className={`ym-market-value text-sm ym-market-${pnlTone(x.net_realized_profit,x.status==='open')}`}>{x.status==='open'?'Unrealized / unknown':x.net_realized_profit==null?'Unavailable':signedMoney(Number(x.net_realized_profit),String(x.net_realized_profit))} {broker?.currency || ''}</strong>
                <small className="text-muted">Net R: {x.realized_r ?? 'Unavailable'} · {x.movement ?? '—'} {x.movement_unit || 'units'}</small></span>
            </summary>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-xs">
              {[
                ['First entry',x.first_entry_at],['Final exit',x.final_exit_at || 'Open'],
                ['Original SL',x.initial_sl ?? 'Not captured'],['Original TP',x.initial_tp ?? 'Not captured'],
                ['Stop source',x.initial_sl_provenance || 'Unverified'],
                ['First observed',x.initial_sl_observed_at || '—'],['Current SL',x.current_sl ?? '—'],['Current TP',x.current_tp ?? '—'],
                ['Initial risk',x.initial_risk_account ?? 'Unavailable'],['Capital source',x.capital_at_entry?.source || 'Unavailable'],
                ['Final net R',x.final_realized_r ?? 'Unavailable'],['Remaining volume',x.remaining_volume ?? 'Unknown'],
                ['Total holding',x.holding_seconds ? (Number(x.holding_seconds)/3600).toFixed(2)+' hours' : 'Open/unknown'],
                ['VW holding',x.weighted_holding_seconds ? (Number(x.weighted_holding_seconds)/3600).toFixed(2)+' hours' : 'Unavailable'],
              ].map(([label,value])=><div key={String(label)} className="ym-market-detail" data-level={label==='Original SL'||label==='Current SL'?'sl':label==='Original TP'||label==='Current TP'?'tp':label.toLowerCase().includes('risk')?'risk':undefined}><span>{label}</span><strong>{value}</strong></div>)}
            </div>
            <p className="text-xs text-secondary mt-3">Sessions: {x.sessions?.status==='confirmed' ? x.sessions.sessions?.join(', ') || 'None' : 'Unresolved — '+(x.sessions?.reason || 'broker timezone not confirmed')} · Initial risk: {x.capture_completeness?.original_risk || 'unknown'}</p>
            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <div><h3 className="text-xs font-bold mb-2">Entry executions ({x.entries?.length || 0})</h3>
                {x.entries?.map((entry,index)=><div key={index} className="text-xs border-t border-themed py-2">
                  Deal {String(entry.deal_ticket || '—')} · {String(entry.volume || '?')} lots @ {String(entry.price || '?')}
                  <p className="text-muted">{String(entry.time || '')} · <span className="ym-market-sl">Opening SL {String(entry.initial_sl ?? 'unknown')}</span> · <span className="ym-market-warning">Risk {String(entry.initial_risk ?? 'unknown')}</span></p>
                </div>)}
              </div>
              <div><h3 className="text-xs font-bold mb-2">Closes ({x.exits?.length || 0})</h3>
                {x.exits?.map((exit,index)=><div key={index} className="text-xs border-t border-themed py-2">
                  Deal {String(exit.deal_ticket || '—')} · {String(exit.volume || '?')} lots @ {String(exit.price || '?')}
                  <p className="text-muted"><span className={`ym-market-${pnlTone(exit.net_profit as number | string | null)}`}>Net {String(exit.net_profit ?? 'unknown')}</span> · R {String(exit.realized_r ?? 'unavailable')} · {String(exit.holding_seconds ?? 'unknown')} seconds</p>
                </div>)}
              </div>
            </div>
          </details>;
        })}
      </div>
      {positionsMore && <button className="btn-secondary" onClick={async()=>{try {
        const page=await action('positions',{offset:positions.length});
        setPositions(previous=>[...previous,...page.rows]);setPositionsMore(Boolean(page.more));
      } catch(e){setError(e instanceof Error?e.message:'Could not load more lifecycles.');}}}>Load more lifecycles</button>}
    </section>
    <dialog ref={dialog} aria-labelledby="mt5-dialog-title" className="mt5-dialog" onClose={()=>{setDevice('');void refresh().catch(e=>setError(e.message));}}>
      <header className="flex items-center justify-between border-b border-themed px-5 py-4"><h2 id="mt5-dialog-title" className="font-bold">Connect MT5 account</h2><button className="btn-ghost p-2" aria-label="Close login" onClick={()=>dialog.current?.close()}><X size={18}/></button></header>
      {device && <iframe title="MT5 broker account login" className="w-full border-0" style={{height:'min(530px,70dvh)'}} src={'/mt5-login.html#'+encodeURIComponent(device)}/>}
    </dialog>
    {trades.some(t=>source(t)==='mt5') && <details className="card p-5 space-y-3"><summary>Review manual and imported trade matches</summary>
      <label>Broker trade <Select value={imported} onChange={e=>{setImported(e.target.value);setManual('');}}><option value="">Choose a trade</option>{trades.filter(t=>source(t)==='mt5' && t.status==='closed').map(t=><option key={t.id} value={t.id}>{t.pair} · {t.direction} · {t.entry_time} · {t.pnl}</option>)}</Select></label>
      {selected && <label>Manual entry <Select value={manual} onChange={e=>setManual(e.target.value)}><option value="">Choose a matching entry</option>{matches.map(t=><option key={t.id} value={t.id}>{t.pair} · {t.entry_time} · {t.pnl}</option>)}</Select></label>}
      <button disabled={!manual} onClick={()=>run(async()=>{await action('match',{imported,manual});setManual('');setImported('');await fetchTrades();})}>Confirm match and retain journal notes</button></details>}
    {error && <p role="alert">{error}</p>}
  </main>;
}

interface HistoryReviewProps {
  scan: SelectedScan;
  status?: string;
  onClose: () => void;
  onFinished: (imported: boolean) => Promise<void>;
}

async function loadHistoryPage(scan: HistoryScan, offset: number, signal?: AbortSignal): Promise<HistoryPage> {
  const page = await action('history-preview', {link:scan.link, request:scan.request, offset}, signal);
  if (page.link !== scan.link || page.request !== scan.request || !Array.isArray(page.rows) ||
      !Number.isSafeInteger(page.nextOffset) || page.nextOffset !== offset + page.rows.length ||
      (page.more && page.rows.length === 0)) {
    throw new Error('The preview changed. Reopen this account’s history.');
  }
  return page;
}

function HistoryReview({scan, status, onClose, onFinished}: HistoryReviewProps) {
  const [preview, setPreview] = useState<HistoryPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const current = status === 'ready' || status === 'imported';
  useEffect(() => {
    if (!current) return;
    const controller = new AbortController();
    setPreview(null);
    setError('');
    void loadHistoryPage(scan, 0, controller.signal).then(page => {
      if (!controller.signal.aborted) setPreview(page);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not open these fills.');
    });
    return () => controller.abort();
  }, [scan, current, attempt]);

  async function perform(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await operation(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not complete the request.'); }
    finally { setBusy(false); }
  }

  return <section className="rounded-xl border border-themed p-4 space-y-3" aria-label={'Earlier trades for '+scan.name}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="font-semibold">Earlier trades for {scan.name}</h3>
        {scan.brokerAccount && <p className="text-xs text-secondary">{scan.brokerAccount}</p>}</div>
      <button type="button" className="btn-ghost" onClick={onClose}>Close preview</button>
    </div>
    {!current ? <p role="status">This scan is no longer current. Open the latest preview for this account.</p> :
      !preview ? (error ? <p role="alert">{error} <button className="btn-secondary" onClick={()=>setAttempt(n=>n+1)}>Retry preview</button></p>
        : <p role="status">Loading broker fills…</p>) : <>
      <p className="text-sm text-secondary">{preview.rows.length} broker {preview.rows.length===1?'fill':'fills'} reviewed{preview.more?' so far. Review the next page before importing.':'.'} Your latest broker balance is shown on the account.</p>
      <div className="overflow-auto max-h-80"><table className="w-full min-w-[950px] text-xs text-left border-separate border-spacing-0">
        <thead><tr className="text-muted uppercase tracking-wide">
          {['Symbol','Position / deal','Entry / exit UTC','Direction','Volume','Entry / exit price','Opening SL / TP','Closing SL / TP','Initial risk','Costs / swap','Exit reason','Net P&L'].map(label=><th key={label} className="border-b border-themed px-2 py-3 font-semibold whitespace-nowrap">{label}</th>)}
        </tr></thead>
        <tbody>{preview.rows.map((r,i)=>{
          const broker=(r.broker_details && typeof r.broker_details==='object' ? r.broker_details : {}) as Record<string,unknown>;
          const value=(key:string)=>r[key]==null?'Unknown':String(r[key]);
          return <tr key={i} className="align-top hover:bg-secondary" data-result={pnlTone(r.pnl as number|string|null)}>
            <td className="px-2 py-3 font-semibold">{value('pair')}</td>
            <td className="px-2 py-3 font-mono">Position {broker.position_id == null?'Unknown':String(broker.position_id)}<div className="text-muted">Deal {broker.deal_ticket == null?'Unknown':String(broker.deal_ticket)}</div></td>
            <td className="px-2 py-3">{value('entry_time')}<div className="text-muted">{value('exit_time')}</div></td>
            <td className="px-2 py-3"><span className="ym-direction-tag" data-side={r.direction}>{value('direction')}</span></td>
            <td className="px-2 py-3 font-mono">{value('lot_size')}</td>
            <td className="px-2 py-3 font-mono">{value('entry_price')}<div className="text-muted">{value('exit_price')}</div></td>
            <td className="px-2 py-3 font-mono"><span className="ym-market-sl">SL {r.stop_loss == null?'Not recorded':String(r.stop_loss)}</span>
              <div className="ym-market-tp">TP {r.take_profit==null?'Not recorded':String(r.take_profit)}</div>
              <div className="text-muted font-sans">{broker.opening_protection_provenance==='executed_open_order'?'From opening order':'Opening protection unverified'}</div></td>
            <td className="px-2 py-3 font-mono"><span className="ym-market-sl">SL {broker.closing_order_sl==null?'Unavailable':String(broker.closing_order_sl)}</span>
              <div className="ym-market-tp">TP {broker.closing_order_tp==null?'Unavailable':String(broker.closing_order_tp)}</div>
              <div className="text-muted font-sans">Exit order {broker.exit_order_ticket==null?'Unknown':String(broker.exit_order_ticket)}</div></td>
            <td className="px-2 py-3">Historical initial risk cannot be proven without the opening order, instrument specification, and capital at entry</td>
            <td className="px-2 py-3 font-mono">Fees: {value('fees')}<div className="text-muted">Swap: {broker.swap==null?'Unknown':String(broker.swap)}</div></td>
            <td className="px-2 py-3">{broker.close_reason==null?'Not recorded':String(broker.close_reason)}
              <div className="text-muted">{broker.close_comment==null?'':String(broker.close_comment)}</div></td>
            <td className={`px-2 py-3 ym-market-value font-semibold ym-market-${pnlTone(r.pnl as number|string|null)}`}>{r.pnl==null?'Unknown':signedMoney(Number(r.pnl),String(r.pnl))}</td>
          </tr>;
        })}</tbody>
      </table></div>
      <p className="text-xs text-muted">These are individual closed broker fills, including partial exits. Original broker deals and orders (timestamps, fees, swap, reasons and known stop levels) are preserved as immutable evidence. A stop changed between observations may not be reconstructible from historical records. Initial risk and R remain unknown when broker evidence is insufficient.</p>
      {preview.more && <div className="flex flex-wrap gap-2">
        <button disabled={busy} className="btn-secondary" onClick={()=>perform(async()=>{
          const next = await loadHistoryPage(scan, preview.nextOffset);
          setPreview({...next, rows:[...preview.rows, ...next.rows]});
        })}>Review next 100 fills</button>
        <button disabled={busy} className="btn-secondary" onClick={()=>perform(async()=>{
          let current=preview, rows=[...preview.rows];
          // Reviewable batches; very large histories require another click
          // rather than blocking the browser or silently importing unseen data.
          for(let page=0;current.more && page<30;page++){
            current=await loadHistoryPage(scan,current.nextOffset);
            rows=rows.concat(current.rows);
            setPreview({...current,rows});
          }
        })}>Load remaining pages for review (up to 3,000)</button>
      </div>}
      <button disabled={busy || preview.more} className="btn-primary" onClick={()=>perform(async()=>{
        let more = true;
        while (more) {
          const batch = await action('history-import',{link:preview.link, request:preview.request, expected_count:preview.rows.length});
          more = batch.more;
        }
        await onFinished(true);
      })}>Import {preview.rows.length} reviewed {preview.rows.length===1?'fill':'fills'}</button>
      {status === 'ready' && <button disabled={busy} className="btn-secondary" onClick={()=>perform(async()=>{
        await action('history-decline',{link:preview.link,request:preview.request});
        await onFinished(false);
      })}>Skip import</button>}
      {error && <p role="alert">{error}</p>}
    </>}
  </section>;
}
