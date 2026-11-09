import { Monitor, Link2, Download, X } from 'lucide-react';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useTrades } from '@/hooks/useData';

type Device = { id: string; last_seen: number };
type Link = { id: string; company?: string; login?: string; status: string; last_sync?: string; broker_balance?:number;broker_equity?:number;currency?:string; gap?: number; last_error?: string; expires: number };
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
  const [manual,setManual] = useState('');
  const refresh = useCallback(async () => {
    const data = await action('status');
    setDevices(data.devices); setLinks(data.links); setDemo(data.demoOnly); setLoaded(true);
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
    <a className="btn-secondary inline-flex" href="/mt5-connector.zip" download><Download size={15}/>Download Windows connector</a>
    {code && <p>Enter this pairing code in the connector within five minutes: <code className="break-all select-all">{code}</code></p>}
    {devices.map(d=><div className="flex flex-wrap items-center gap-3 border-t border-themed pt-4" key={d.id}>PC {d.id.slice(0,8)} · {Date.now()-d.last_seen<90000?'Online':'Offline'}{' '}
      <button className="btn-primary" disabled={Date.now()-d.last_seen>=90000} onClick={()=>{setDevice(d.id);dialog.current?.showModal();}}>Connect MT5 account</button>{' '}
      <button className="btn-secondary" onClick={()=>{if(window.confirm('Revoke this PC and stop all of its account imports?')) void run(()=>action('revoke',{device:d.id}));}}>Revoke PC</button></div>)}
    </section>
    <section className="card p-5 sm:p-6 space-y-3">
      <h2 className="flex items-center gap-2 font-bold"><Link2 size={20} className="text-brand-500"/>Linked accounts</h2>
      <p className="text-sm text-secondary">{demo?'Demo accounts only during reconciliation.':'Demo and live accounts supported.'} Capture starts when you link each account.</p>
      {loaded && !links.length && <p className="rounded-xl bg-secondary p-4 text-sm text-secondary">No accounts linked yet.</p>}
    {links.map(l=><p className="rounded-xl bg-secondary p-4 text-sm" key={l.id}>{l.company || 'Account'} {l.login} · {['pending','verifying'].includes(l.status) && l.expires<Date.now()?'expired':l.status} {l.broker_balance!=null && '· Broker balance '+l.broker_balance+' '+l.currency+' · Equity '+l.broker_equity+' '+l.currency} {l.last_error} {l.last_sync && '· Last sync '+new Date(l.last_sync).toLocaleString()} {l.gap ? '· Offline interval: intermediate stop changes may be missing.' : ''}</p>)}
    </section>
    <dialog ref={dialog} aria-labelledby="mt5-dialog-title" className="mt5-dialog" onClose={()=>{setDevice('');void refresh().catch(e=>setError(e.message));}}>
      <header className="flex items-center justify-between border-b border-themed px-5 py-4"><h2 id="mt5-dialog-title" className="font-bold">Connect MT5 account</h2><button className="btn-ghost p-2" aria-label="Close login" onClick={()=>dialog.current?.close()}><X size={18}/></button></header>
      {device && <iframe title="MT5 investor login" className="w-full border-0" style={{height:'min(530px,70dvh)'}} src={'/mt5-login.html#'+encodeURIComponent(device)}/>}
    </dialog>
    {trades.some(t=>source(t)==='mt5') && <details className="card p-5 space-y-3"><summary>Review manual and imported trade matches</summary>
      <label>Broker trade <select value={imported} onChange={e=>{setImported(e.target.value);setManual('');}}><option value="">Choose a trade</option>{trades.filter(t=>source(t)==='mt5' && t.status==='closed').map(t=><option key={t.id} value={t.id}>{t.pair} · {t.direction} · {t.entry_time} · {t.pnl}</option>)}</select></label>
      {selected && <label>Manual entry <select value={manual} onChange={e=>setManual(e.target.value)}><option value="">Choose a matching entry</option>{matches.map(t=><option key={t.id} value={t.id}>{t.pair} · {t.entry_time} · {t.pnl}</option>)}</select></label>}
      <button disabled={!manual} onClick={()=>run(async()=>{await action('match',{imported,manual});setManual('');setImported('');await fetchTrades();})}>Confirm match and retain journal notes</button></details>}
    {error && <p role="alert">{error}</p>}
  </main>;
}

