import { useCallback, useEffect, useRef, useState } from 'react';
import { Radio, ArrowUpRight } from 'lucide-react';
import { mt5Action, monitoringStatus, pairedPcName, type MonitorStatus } from '@/lib/mt5Monitor';

export function AccountMonitor({accountId}: {accountId: string}) {
  const [data, setData] = useState<MonitorStatus | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState('');
  const revision = useRef(0);
  const read = useCallback(async (signal?: AbortSignal) => {
    const id = ++revision.current;
    try {
      const result = await mt5Action('status', {}, signal) as MonitorStatus;
      if (!signal?.aborted && id === revision.current) { setData(result); setError(''); }
    } catch {
      if (!signal?.aborted && id === revision.current) setError('Account status is unavailable. Checking again shortly.');
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const check = () => { if (!document.hidden) void read(controller.signal); };
    check();
    const timer = window.setInterval(check, 15000);
    document.addEventListener('visibilitychange', check);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange',check); };
  }, [read]);
  const links = (data?.links || []).filter(link => ['connected','pending','verifying'].includes(link.status) &&
      (accountId === 'all' || link.account_id === accountId));
  const names = new Map(data?.accounts?.map(a => [a.id, a.name]));
  async function toggle(id: string, paused: boolean) {
    setSaving(id);
    try { await mt5Action('set-monitoring', {link:id,paused}); await read(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not change monitoring.'); }
    finally { setSaving(''); }
  }
  return <section className="card p-4 sm:p-5 mb-5" aria-label="Broker account monitor">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 font-semibold"><Radio size={18} aria-hidden="true"/>Broker accounts</h2>
      <div className="flex flex-wrap items-center gap-3"><a href="#mt5" className="text-sm underline">Manage accounts</a>
        <a className="btn-secondary" href="?addAccount=1#mt5">Add account <ArrowUpRight size={14} aria-hidden="true"/></a></div>
    </header>
    {!data && !error && <p role="status" className="text-sm text-muted mt-3">Checking connections…</p>}
    {data && !links.length && <p className="text-sm text-secondary mt-3">{accountId === 'all' ? 'Add a broker account to see its sync status here.' : 'This journal account has no active MT5 connection.'}</p>}
    {links.map(link => <div key={link.id} className="mt-3 pt-3 border-t border-themed flex flex-wrap items-center justify-between gap-3">
      <div><strong className="text-sm">{names.get(link.account_id || '') || link.company || link.server || 'Account setup'}</strong>
        <p className="text-xs text-secondary">{[link.server, link.login].filter(Boolean).join(' · ')}{link.last_sync && ' · Last sync '+new Date(link.last_sync).toLocaleString()}</p>
        <p className="text-xs text-muted mt-1">Paired PC: {pairedPcName(data?.devices?.find(d=>d.id===link.device))}</p></div>
      <div className="flex flex-wrap items-center gap-3"><span className="text-sm">{monitoringStatus(link,data?.devices?.find(d=>d.id===link.device),data?.capturePaused)}</span>
        {link.status === 'connected' && <button className="btn-secondary" disabled={Boolean(saving)} onClick={()=>void toggle(link.id,!link.monitoring_paused)}>
          {link.monitoring_paused ? 'Resume monitoring' : 'Pause monitoring'}</button>}</div>
    </div>)}
    {error && <p role="alert" className="text-sm mt-2">{error}</p>}
  </section>;
}
