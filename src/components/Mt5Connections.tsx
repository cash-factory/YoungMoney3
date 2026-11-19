import { Select } from '@/components/Select';
import { Monitor, Link2, Download, X } from 'lucide-react';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useTrades } from '@/hooks/useData';

import { mt5Action as action, monitoringStatus, pcOnline, type Device, type Link } from '@/lib/mt5Monitor';

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
  const selected = trades.find(t=>t.id===imported);
  const matches = trades.filter(t=>selected && source(t)!=='mt5' && selected.pair===t.pair && t.account_id===selected.account_id && t.direction===selected.direction);
  return <main className="space-y-5">
    <SectionHeader title="MT5 Connections" subtitle="Add a broker login, check its last sync, and manage account monitoring." />
    <section className="card p-5 sm:p-6 space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 font-bold"><Monitor size={20} className="text-brand-500"/> Paired PCs</h2>
    <div className="flex flex-wrap gap-2">
      <button className="btn-primary" disabled={capturePaused} onClick={startAccountSetup}>Add account</button>
      <button className="btn-secondary" disabled={capturePaused} onClick={()=>run(async()=>setCode((await action('pair')).code))}>Pair a PC</button>
    </div></header>
    {setupHint && <p role="status" className="rounded-xl bg-secondary p-3 text-sm text-secondary">{setupHint}</p>}
    {capturePaused && <p role="status">Staging capture is paused by your administrator.</p>}
    {loaded && !devices.length && <p className="text-sm text-secondary">Run the Windows connector, then enter your pairing code on that PC.</p>}
    <div className="flex flex-wrap items-center gap-2">
      <a className="btn-primary inline-flex items-center gap-2" href="https://github.com/cash-factory/YoungMoney3/releases/download/staging-connector-v0.4.1-rc1/YoungMoney3.Connector.exe" rel="noopener noreferrer" aria-label="Download YoungMoney3 Windows Connector version 0.4.1 release candidate 1"><Download size={15}/>Download Connector v0.4.1-rc1</a>
      <a className="btn-secondary inline-flex items-center gap-2" href="/connector-download.html">Release details &amp; SHA-256</a>
      <a className="btn-secondary inline-flex items-center gap-2" href="/mt5-connector.zip" download><Download size={15}/>Python source fallback</a>
    </div>
    <p className="text-xs text-muted">Official Windows x64 staging prerelease · unsigned · capture-only. Verify the executable checksum before running. Existing PC pairings remain available.</p>
    {code && <p>Enter this pairing code in the connector within five minutes: <code className="break-all select-all">{code}</code></p>}
    {devices.map(d=><div className="flex flex-wrap items-center justify-between gap-3 border-t border-themed pt-4" key={d.id}>
      <div><strong className="text-sm">PC {d.id.slice(0,8)} · {pcOnline(d)?'Online':'Paired · offline'}</strong>
        <p className="text-xs text-secondary">{!pcOnline(d)?'Open the connector on this PC. Its pairing is saved.':
          d.setup_state === 'install'?'Install MetaTrader 5 on this PC. The connector will detect it automatically.':
          d.setup_state === 'ready'?'Ready to add an account.':'Use the latest connector for automatic account setup.'}</p></div>
      <div className="flex flex-wrap gap-2"><button className="btn-primary" disabled={!pcOnline(d) || d.setup_state==='install' || capturePaused} onClick={()=>openLogin(d.id)}>Add account</button>
      <button className="btn-secondary" onClick={()=>{if(window.confirm('Revoke this PC and stop all of its account imports?')) void run(()=>action('revoke',{device:d.id}));}}>Revoke PC</button></div></div>)}
    {requestedPc && loaded && <p role="status" className="text-sm text-secondary">{!devices.length?'Pair this PC once to continue.':
      requestedPc==='1' && devices.length>1?'Choose the PC where MetaTrader is installed.':
      !devices.some(d=>requestedPc==='1' || d.id===requestedPc)?'This PC is paired with a different workspace or has been removed.':
      'Leave the connector open on the paired PC. The login form opens when it is ready.'}</p>}
    </section>
    <section className="card p-5 sm:p-6 space-y-3">
      <h2 className="flex items-center gap-2 font-bold"><Link2 size={20} className="text-brand-500"/>Linked accounts</h2>
      <p className="text-sm text-secondary">{demo?'Staging supports demo and contest accounts.':'Demo, contest and real accounts are available.'} The connector prepares MetaTrader for each login and records trades and balances.</p>
      {loaded && !links.length && <p className="rounded-xl bg-secondary p-4 text-sm text-secondary">Choose Add account next to your paired PC to connect a broker login.</p>}
    {links.some(l=>l.status==='connected') && <label className="block text-xs text-secondary">History lookback
      <Select className="input-field mt-1 max-w-xs" value={historyDays} onChange={e=>setHistoryDays(e.target.value)}><option value="7">7 days before linking</option><option value="14">14 days before linking</option><option value="30">30 days before linking (default)</option><option value="60">60 days before linking</option><option value="90">90 days before linking (maximum)</option></Select>
      <span className="mt-1 block text-xs text-muted">Default: approximately one month. Historical imports are limited to the 90 days before linking. Review the broker fills before approving an import.</span>
    </label>}
    {links.map(l=><div key={l.id} role="group" aria-label={'MT5 account '+(accountNames[l.account_id || ''] || l.company || 'Pending')+(l.login?' · '+l.login:'')} className="rounded-xl border border-themed p-4 space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-3"><div>
        <h3 className="font-semibold">{accountNames[l.account_id || ''] || l.company || l.server || 'Broker account'}</h3>
        <p className="text-xs text-secondary">{[l.server,l.login,l.trade_mode===0?'Demo':l.trade_mode===1?'Contest':l.trade_mode===2?'Real':null].filter(Boolean).join(' · ')}</p>
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
      {l.status==='connected' && <div className="flex flex-wrap gap-2"><button className="btn-secondary" disabled={l.history_status==='requested' || !!l.monitoring_paused || capturePaused} onClick={()=>run(async()=>{await action('history-request',{link:l.id,days:Number(historyDays)});})}>Find earlier trades</button>
      {l.history_status==='requested' && <><span role="status" className="text-sm">Scanning on your PC. Keep the connector running.</span>
        <button className="btn-secondary" onClick={()=>run(async()=>{await action('history-decline',{link:l.id,request:l.history_id});})}>Cancel scan</button></>}
      {l.history_id && ['ready','imported'].includes(l.history_status || '') && <button className="btn-secondary"
        onClick={()=>setHistoryScan({link:l.id, request:l.history_id!, brokerAccount:[l.server,l.login].filter(Boolean).join(' · '), name:accountNames[l.account_id || ''] || [l.company,l.login].filter(Boolean).join(' ') || 'Linked account'})}>Review earlier trades</button>}</div>}
    </div>)}
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
          return <details key={item.link+'/'+item.lifecycle_id} className="rounded-xl border border-themed p-3 sm:p-4">
            <summary className="cursor-pointer list-none flex flex-wrap gap-3 items-center justify-between">
              <span className="flex flex-col"><strong className="text-sm">{x.symbol} · {x.direction==='long'?'Long':'Short'}</strong>
                <small className="text-muted">{broker?.company || 'Broker'} · {broker?.login || item.account_id} · {x.status.toUpperCase()} · Version {item.version}</small></span>
              <span className="flex flex-col text-right"><strong className="font-mono text-sm">{x.net_realized_profit ?? 'Unrealized'} {broker?.currency || ''}</strong>
                <small className="text-muted">Net R: {x.realized_r ?? 'Unavailable'} · {x.movement ?? '—'} {x.movement_unit || 'units'}</small></span>
            </summary>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-xs">
              {[
                ['First entry',x.first_entry_at],['Final exit',x.final_exit_at || 'Open'],
                ['Original stop',x.initial_sl ?? 'Not captured'],['Stop source',x.initial_sl_provenance || 'Unverified'],
                ['First observed',x.initial_sl_observed_at || '—'],['Current SL / TP',(x.current_sl ?? '—')+' / '+(x.current_tp ?? '—')],
                ['Initial risk',x.initial_risk_account ?? 'Unavailable'],['Capital source',x.capital_at_entry?.source || 'Unavailable'],
                ['Final net R',x.final_realized_r ?? 'Unavailable'],['Remaining volume',x.remaining_volume ?? 'Unknown'],
                ['Total holding',x.holding_seconds ? (Number(x.holding_seconds)/3600).toFixed(2)+' hours' : 'Open/unknown'],
                ['VW holding',x.weighted_holding_seconds ? (Number(x.weighted_holding_seconds)/3600).toFixed(2)+' hours' : 'Unavailable'],
              ].map(([label,value])=><div key={String(label)} className="rounded-lg bg-secondary p-3"><p className="text-muted">{label}</p><strong className="block mt-1 break-words font-mono">{value}</strong></div>)}
            </div>
            <p className="text-xs text-secondary mt-3">Sessions: {x.sessions?.status==='confirmed' ? x.sessions.sessions?.join(', ') || 'None' : 'Unresolved — '+(x.sessions?.reason || 'broker timezone not confirmed')} · Initial risk: {x.capture_completeness?.original_risk || 'unknown'}</p>
            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <div><h3 className="text-xs font-bold mb-2">Entry executions ({x.entries?.length || 0})</h3>
                {x.entries?.map((entry,index)=><div key={index} className="text-xs border-t border-themed py-2">
                  Deal {String(entry.deal_ticket || '—')} · {String(entry.volume || '?')} lots @ {String(entry.price || '?')}
                  <p className="text-muted">{String(entry.time || '')} · Opening SL {String(entry.initial_sl || 'unknown')} · Risk {String(entry.initial_risk || 'unknown')}</p>
                </div>)}
              </div>
              <div><h3 className="text-xs font-bold mb-2">Closes ({x.exits?.length || 0})</h3>
                {x.exits?.map((exit,index)=><div key={index} className="text-xs border-t border-themed py-2">
                  Deal {String(exit.deal_ticket || '—')} · {String(exit.volume || '?')} lots @ {String(exit.price || '?')}
                  <p className="text-muted">Net {String(exit.net_profit ?? 'unknown')} · R {String(exit.realized_r ?? 'unavailable')} · {String(exit.holding_seconds ?? 'unknown')} seconds</p>
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
          {['Symbol','Position / deal','Entry / exit UTC','Direction','Volume','Entry / exit price','Original / close SL','Initial risk','Costs / swap','Net P&L'].map(label=><th key={label} className="border-b border-themed px-2 py-3 font-semibold whitespace-nowrap">{label}</th>)}
        </tr></thead>
        <tbody>{preview.rows.map((r,i)=>{
          const broker=(r.broker_details && typeof r.broker_details==='object' ? r.broker_details : {}) as Record<string,unknown>;
          const value=(key:string)=>r[key]==null?'Unknown':String(r[key]);
          return <tr key={i} className="align-top hover:bg-secondary">
            <td className="px-2 py-3 font-semibold">{value('pair')}</td>
            <td className="px-2 py-3 font-mono">Position {broker.position_id == null?'Unknown':String(broker.position_id)}<div className="text-muted">Deal {broker.deal_ticket == null?'Unknown':String(broker.deal_ticket)}</div></td>
            <td className="px-2 py-3">{value('entry_time')}<div className="text-muted">{value('exit_time')}</div></td>
            <td className="px-2 py-3">{value('direction')}</td>
            <td className="px-2 py-3 font-mono">{value('lot_size')}</td>
            <td className="px-2 py-3 font-mono">{value('entry_price')}<div className="text-muted">{value('exit_price')}</div></td>
            <td className="px-2 py-3 font-mono">{r.stop_loss == null?'Not recorded':String(r.stop_loss)}<div className="text-muted">Original SL not proven by legacy fill scan</div></td>
            <td className="px-2 py-3">Unavailable unless order evidence establishes original risk</td>
            <td className="px-2 py-3 font-mono">Fees: {value('fees')}<div className="text-muted">Swap: {broker.swap==null?'Unknown':String(broker.swap)}</div></td>
            <td className="px-2 py-3 font-mono font-semibold">{value('pnl')}</td>
          </tr>;
        })}</tbody>
      </table></div>
      <p className="text-xs text-muted">These are individual broker fills. Opening stop, initial risk and R require supporting order evidence.</p>
      {preview.more && <button disabled={busy} className="btn-secondary" onClick={()=>perform(async()=>{
        const next = await loadHistoryPage(scan, preview.nextOffset);
        setPreview({...next, rows:[...preview.rows, ...next.rows]});
      })}>Review next 100 fills</button>}
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
