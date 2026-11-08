import { useCallback, useEffect, useState } from 'react';
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
  const [code,setCode] = useState('');
  const [error,setError] = useState('');
  const [demo,setDemo] = useState(true);
  const [imported,setImported] = useState('');
  const [manual,setManual] = useState('');
  const refresh = useCallback(async () => {
    const data = await action('status');
    setDevices(data.devices); setLinks(data.links); setDemo(data.demoOnly);
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
  return <section className="card p-5 space-y-3">
    <h2 className="font-bold">MT5 connections</h2>
    <p>{demo ? 'Demo accounts enabled for reconciliation.' : 'Demo and live accounts enabled.'} Capture starts when you link each account.</p>
    <a className="btn-secondary" href="/mt5-connector.zip" download>Download Windows connector</a>{' '}
    <button className="btn-secondary" onClick={()=>run(async()=>setCode((await action('pair')).code))}>Pair a PC</button>
    {code && <p>Enter this pairing code in the connector within five minutes: <code>{code}</code></p>}
    {devices.map(d=><div key={d.id}>PC {d.id.slice(0,8)} · {Date.now()-d.last_seen<90000?'Online':'Offline'}{' '}
      <a className="btn-secondary" href={'/mt5-login.html#'+d.id}>Connect MT5 account</a>{' '}
      <button className="btn-secondary" onClick={()=>{if(window.confirm('Revoke this PC and stop all of its account imports?')) void run(()=>action('revoke',{device:d.id}));}}>Revoke PC</button></div>)}
    {links.map(l=><p key={l.id}>{l.company || 'Account'} {l.login} · {['pending','verifying'].includes(l.status) && l.expires<Date.now()?'expired':l.status} {l.broker_balance!=null && '� Broker balance '+l.broker_balance+' '+l.currency+' � Equity '+l.broker_equity+' '+l.currency} {l.last_error} {l.last_sync && '· Last sync '+new Date(l.last_sync).toLocaleString()} {l.gap ? '· Offline interval: intermediate stop changes may be missing.' : ''}</p>)}
    {trades.some(t=>source(t)==='mt5') && <details><summary>Review manual and imported trade matches</summary>
      <label>Broker trade <select value={imported} onChange={e=>{setImported(e.target.value);setManual('');}}><option value="">Choose a trade</option>{trades.filter(t=>source(t)==='mt5' && t.status==='closed').map(t=><option key={t.id} value={t.id}>{t.pair} · {t.direction} · {t.entry_time} · {t.pnl}</option>)}</select></label>
      {selected && <label>Manual entry <select value={manual} onChange={e=>setManual(e.target.value)}><option value="">Choose a matching entry</option>{matches.map(t=><option key={t.id} value={t.id}>{t.pair} · {t.entry_time} · {t.pnl}</option>)}</select></label>}
      <button disabled={!manual} onClick={()=>run(async()=>{await action('match',{imported,manual});setManual('');setImported('');await fetchTrades();})}>Confirm match and retain journal notes</button></details>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

