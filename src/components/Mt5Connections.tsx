import { Monitor, Link2, Download, X } from 'lucide-react';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useTrades } from '@/hooks/useData';

type Device = { id: string; last_seen: number };
type Link = { id: string; account_id?:string; company?: string; login?: string; server?: string; trade_mode?: number; access_level?: string; status: string; last_sync?: string; broker_balance?:number;broker_equity?:number;currency?:string; gap?: number; last_error?: string; expires: number;history_id?:string;history_status?:string;broker_timezone?:string;timezone_confirmed_at?:string;timezone_source?:string;utc_conversion_status?:string };
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
async function action(name: string, payload: unknown = {}) {
  const result = await fetch('/api/mt5/' + name, {method:'POST', headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  const data = await result.json();
  if (!result.ok) throw new Error(data.error || 'MT5 connection unavailable.');
  return data;
}
export function Mt5Connections() {
  const { user } = useAuth();
  const { trades, fetchTrades } = useTrades(user?.id);
  const [devices,setDevices] = useState<Device[]>([]);
  const [links,setLinks] = useState<Link[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const [device,setDevice] = useState('');
  const [loaded,setLoaded] = useState(false);
  const [code,setCode] = useState('');
  const [error,setError] = useState('');
  const [demo,setDemo] = useState(true);
  const [imported,setImported] = useState('');
  const [historyLink,setHistoryLink]=useState('');
  const [historyDays,setHistoryDays]=useState('30');
  const [preview,setPreview]=useState<{rows:Record<string,unknown>[];more:boolean;status:string;nextOffset:number}|null>(null);
  const [historyBusy,setHistoryBusy]=useState(false);
  const [positions,setPositions]=useState<PositionRow[]>([]);
  const [positionsMore,setPositionsMore]=useState(false);
  const [timezoneDraft,setTimezoneDraft]=useState<Record<string,string>>({});
  const [timezoneProof,setTimezoneProof]=useState<Record<string,boolean>>({});
  const [manual,setManual] = useState('');
  const refresh = useCallback(async () => {
    const [data,rich]=await Promise.all([action('status'),action('positions').catch(()=>({rows:[],more:false}))]);
    setDevices(data.devices); setLinks(data.links); setDemo(data.demoOnly); setLoaded(true);
    setPositions(rich.rows || []);setPositionsMore(Boolean(rich.more));
  }, []);
  useEffect(() => {
    const read = () => { if (!document.hidden) void refresh().catch(e=>setError(e.message)); };
    read(); const timer = window.setInterval(read,15000); return () => clearInterval(timer);
  }, [refresh]);
  async function run(operation: () => Promise<void>) {
    try { setError(''); await operation(); await refresh(); } catch (e) {setError(e instanceof Error ? e.message : 'Request failed.');}
  }
  const source = (t: typeof trades[number]) => (t as {trade_source?:string}).trade_source;
  const selected = trades.find(t=>t.id===imported);
  const matches = trades.filter(t=>selected && source(t)!=='mt5' && selected.pair===t.pair && t.account_id===selected.account_id && t.direction===selected.direction);
  return <main className="space-y-5">
    <SectionHeader title="MT5 Connections" subtitle="Pair your Windows PC and sync broker trades to your journal." />
    <section className="card p-5 sm:p-6 space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 font-bold"><Monitor size={20} className="text-brand-500"/> Paired PCs</h2>
    <button className="btn-primary" onClick={()=>run(async()=>setCode((await action('pair')).code))}>Pair a PC</button></header>
    {loaded && !devices.length && <p className="text-sm text-secondary">Run the Windows connector, then enter your pairing code on that PC.</p>}
    <a className="btn-primary inline-flex" href="/connector-download.html"><Download size={15}/>Windows app (staging prerelease)</a>
    <a className="btn-secondary inline-flex" href="/mt5-connector.zip" download><Download size={15}/>Python source fallback</a>
    <p className="text-xs text-muted">The Windows .exe is unsigned; use the versioned prerelease and verify its SHA-256 checksum. Existing CLI pairings remain on this PC.</p>
    {code && <p>Enter this pairing code in the connector within five minutes: <code className="break-all select-all">{code}</code></p>}
    {devices.map(d=><div className="flex flex-wrap items-center gap-3 border-t border-themed pt-4" key={d.id}>PC {d.id.slice(0,8)} · {Date.now()-d.last_seen<90000?'Online':'Offline'}{' '}
      <button className="btn-primary" disabled={Date.now()-d.last_seen>=90000} onClick={()=>{setDevice(d.id);dialog.current?.showModal();}}>Connect MT5 account</button>{' '}
      <button className="btn-secondary" onClick={()=>{if(window.confirm('Revoke this PC and stop all of its account imports?')) void run(()=>action('revoke',{device:d.id}));}}>Revoke PC</button></div>)}
    </section>
    <section className="card p-5 sm:p-6 space-y-3">
      <h2 className="flex items-center gap-2 font-bold"><Link2 size={20} className="text-brand-500"/>Linked accounts</h2>
      <p className="text-sm text-secondary">{demo?'Demo and contest accounts are available. Real-account capture remains disabled until independently approved.':'Demo, contest and real accounts available.'} Connect multiple accounts using a dedicated portable MT5 terminal for each. YoungMoney3 captures trades and balances only; it cannot place, change, or close orders.</p>
      {loaded && !links.length && <p className="rounded-xl bg-secondary p-4 text-sm text-secondary">No accounts linked yet.</p>}
    <label className="block text-xs text-secondary">History lookback
      <select className="input-field mt-1 max-w-xs" value={historyDays} onChange={e=>setHistoryDays(e.target.value)}><option value="7">7 days before linking</option><option value="14">14 days before linking</option><option value="30">30 days before linking (default)</option><option value="60">60 days before linking</option><option value="90">90 days before linking (maximum)</option></select>
      <p className="mt-1 text-xs text-muted">Default: approximately one month. Historical imports are limited to the 90 days before linking. Review the broker fills before approving an import.</p>
    </label>
    {links.map(l=><div key={l.id} className="space-y-2"><p className="rounded-xl bg-secondary p-4 text-sm" key={l.id}>{l.company || 'Account'} {l.login} {l.server ? '· '+l.server : ''} {l.trade_mode === 2 ? '· REAL' : l.trade_mode === 1 ? '· CONTEST' : l.trade_mode === 0 ? '· DEMO' : ''} {l.access_level === 'trading-enabled' ? '· External trading permission (capture-only here)' : l.access_level === 'trading-restricted' ? '· Broker trading disabled externally' : ''} {demo && l.trade_mode===2 ? ' · Real-account capture paused' : ''} · {['pending','verifying'].includes(l.status) && l.expires<Date.now()?'expired':l.status} {l.broker_balance!=null && '· Last reported balance '+l.broker_balance+' '+l.currency+' · Equity '+l.broker_equity+' '+l.currency} {l.last_sync && Date.now()-Date.parse(l.last_sync)>120000 ? ' · Snapshot may be stale; verify the connector is running.' : ''} {l.last_error} {l.last_sync && '· Last sync '+new Date(l.last_sync).toLocaleString()} {l.gap ? '· Offline interval: intermediate stop changes may be missing.' : ''}</p>
      {l.status==='connected' && <div className="rounded-xl border border-themed p-3 space-y-2">
        <p className="text-xs font-semibold">Broker timezone and historical session provenance</p>
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
        <p className="text-xs text-muted">Timezone: {l.broker_timezone || 'Unconfirmed'} · UTC conversion: {l.utc_conversion_status || 'Unverified'} · Historical session labels remain unresolved until both are verified.</p>
      </div>}
      {l.status==='connected' && <div className="flex flex-wrap gap-2"><button className="btn-secondary" disabled={historyBusy || l.history_status==='requested'} onClick={()=>run(async()=>{await action('history-request',{link:l.id,days:Number(historyDays)});setPreview(null);})}>Find earlier trades</button>
      {l.history_status==='requested' && <><span role="status" className="text-sm">Scanning on your PC. Keep the connector running.</span>
        <button className="btn-secondary" onClick={()=>run(async()=>{await action('history-decline',{link:l.id,request:l.history_id});setPreview(null);})}>Cancel scan</button></>}
      {['ready','imported'].includes(l.history_status || '') && <button className="btn-secondary" onClick={()=>run(async()=>{setHistoryLink(l.id);setPreview(await action('history-preview',{link:l.id,offset:0}));})}>Review earlier trades</button>}</div>}
    </div>)}
    <datalist id="broker-timezones">
      <option value="Etc/UTC"/><option value="Europe/Athens"/><option value="Europe/Helsinki"/>
      <option value="Europe/London"/><option value="Africa/Johannesburg"/><option value="America/New_York"/>
      <option value="Europe/Berlin"/><option value="Asia/Dubai"/>
    </datalist>
    {preview && <section className="rounded-xl border border-themed p-4 space-y-3"><h3 className="font-semibold">Load these earlier trades for analysis?</h3><p className="text-sm text-secondary">Previewed {preview.rows.length} broker fills{preview.more?' (more pages remain)':''}. Open every page before importing; only the reviewed request will be imported. Review possible manual matches afterward. Your broker balance remains the latest reported balance.</p>
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
      <p className="text-xs text-muted">This preview shows broker fill-level history, not yet a consolidated lifecycle. Opening order SL, original risk and R remain unverified when the history source cannot prove them. Only reviewed fills can be approved for import.</p>
      {preview.more && <button disabled={historyBusy} className="btn-secondary" onClick={()=>{setHistoryBusy(true);void run(async()=>{
        const next=await action('history-preview',{link:historyLink,offset:preview.nextOffset});
        setPreview(previous=>previous?{...next,rows:[...previous.rows,...next.rows]}:next);
      }).finally(()=>setHistoryBusy(false));}}>Review next 100 fills</button>}
      <button disabled={historyBusy || preview.more} className="btn-primary" onClick={()=>{setHistoryBusy(true);void run(async()=>{const link=links.find(l=>l.id===historyLink);let more=true;while(more){more=(await action('history-import',{link:historyLink,request:link?.history_id,expected_count:preview.rows.length})).more;}setPreview(null);await fetchTrades();}).finally(()=>setHistoryBusy(false));}}>Import {preview.rows.length} reviewed fills</button>
      <button disabled={historyBusy} className="btn-secondary" onClick={()=>run(async()=>{await action('history-decline',{link:historyLink,request:links.find(l=>l.id===historyLink)?.history_id});setPreview(null);})}>Skip import</button>
    </section>}
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
      <label>Broker trade <select value={imported} onChange={e=>{setImported(e.target.value);setManual('');}}><option value="">Choose a trade</option>{trades.filter(t=>source(t)==='mt5' && t.status==='closed').map(t=><option key={t.id} value={t.id}>{t.pair} · {t.direction} · {t.entry_time} · {t.pnl}</option>)}</select></label>
      {selected && <label>Manual entry <select value={manual} onChange={e=>setManual(e.target.value)}><option value="">Choose a matching entry</option>{matches.map(t=><option key={t.id} value={t.id}>{t.pair} · {t.entry_time} · {t.pnl}</option>)}</select></label>}
      <button disabled={!manual} onClick={()=>run(async()=>{await action('match',{imported,manual});setManual('');setImported('');await fetchTrades();})}>Confirm match and retain journal notes</button></details>}
    {error && <p role="alert">{error}</p>}
  </main>;
}

