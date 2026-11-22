import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, Copy, Download, History, Link2, Monitor, Plus, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { useAuth } from '@/context/AuthContext';
import { useTrades } from '@/hooks/useData';

type Device = { id: string; last_seen: number };
type LinkedAccount = {
  id: string;
  device?: string;
  account_id?: string;
  company?: string;
  login?: string;
  server?: string;
  trade_mode?: number;
  access_level?: string;
  status: string;
  last_sync?: string;
  broker_balance?: number;
  broker_equity?: number;
  currency?: string;
  gap?: number;
  last_error?: string;
  expires: number;
  history_id?: string;
  history_status?: string;
};
type HistoryPreview = { rows: Record<string, unknown>[]; more: boolean; status: string; nextOffset: number };
type Notice = { kind: 'success' | 'info'; message: string };

async function action(name: string, payload: unknown = {}) {
  const response = await fetch('/api/mt5/' + name, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'MT5 connection unavailable.');
  return data;
}

const deviceOnline = (device: Device) => Date.now() - device.last_seen < 90_000;
const when = (value?: string | number) => {
  if (value === undefined || value === null) return 'Not yet recorded';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Unavailable';
};
const money = (value: number | undefined, currency?: string) =>
  value === undefined || value === null
    ? 'Not reported'
    : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(value) + ' ' + (currency || '');
const accountStatus = (link: LinkedAccount) => {
  if (['pending', 'verifying'].includes(link.status) && link.expires < Date.now()) return 'Expired';
  if (link.status !== 'connected') return link.status.replace(/-/g, ' ');
  if (!link.last_sync || !Number.isFinite(Date.parse(link.last_sync)) || Date.now() - Date.parse(link.last_sync) > 120_000) return 'Sync delayed';
  return 'Connected';
};
const accountMode = (mode?: number) => mode === 2 ? 'Real' : mode === 1 ? 'Contest' : mode === 0 ? 'Demo' : 'Unspecified';

export function Mt5Connections() {
  const { user } = useAuth();
  const { trades, fetchTrades } = useTrades(user?.id);
  const [devices, setDevices] = useState<Device[]>([]);
  const [links, setLinks] = useState<LinkedAccount[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [capturePaused, setCapturePaused] = useState(false);
  const [demoOnly, setDemoOnly] = useState(true);
  const [expandedDevice, setExpandedDevice] = useState<string | null>(null);
  const [expandedLink, setExpandedLink] = useState<string | null>(null);
  const [loginDevice, setLoginDevice] = useState('');
  const loginDialog = useRef<HTMLDialogElement>(null);
  const [pairingCode, setPairingCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [historyDays, setHistoryDays] = useState('30');
  const [historyLink, setHistoryLink] = useState('');
  const [preview, setPreview] = useState<HistoryPreview | null>(null);
  const [imported, setImported] = useState('');
  const [manual, setManual] = useState('');

  const refresh = useCallback(async () => {
    const data = await action('status');
    setDevices(data.devices || []);
    setLinks(data.links || []);
    setDemoOnly(data.demoOnly);
    setCapturePaused(Boolean(data.capturePaused));
    setLoaded(true);
  }, []);

  useEffect(() => {
    const read = () => {
      if (!document.hidden) void refresh().catch((cause) => {
        setLoaded(true);
        setError(cause instanceof Error ? cause.message : 'Could not refresh MT5 connections.');
      });
    };
    read();
    const interval = window.setInterval(read, 15_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  async function run(key: string, operation: () => Promise<void>, successMessage: string) {
    if (busy) return false;
    setBusy(key);
    setError('');
    setNotice(null);
    try {
      await operation();
      setNotice({ kind: 'success', message: successMessage });
      try { await refresh(); }
      catch { setError('The action completed, but the latest connection status could not be refreshed. Please retry refresh.'); }
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Request failed.');
      return false;
    } finally {
      setBusy(null);
    }
  }

  function openLogin(id: string) {
    setLoginDevice(id);
    loginDialog.current?.showModal();
  }

  async function copyPairingCode() {
    try {
      await navigator.clipboard.writeText(pairingCode);
      setNotice({ kind: 'success', message: 'Pairing code copied.' });
      setError('');
    } catch {
      setError('Could not copy automatically. Select the pairing code and copy it manually.');
    }
  }

  const source = (trade: typeof trades[number]) => (trade as { trade_source?: string }).trade_source;
  const selected = trades.find(trade => trade.id === imported);
  const matches = trades.filter(trade => selected && source(trade) !== 'mt5' && selected.pair === trade.pair && trade.account_id === selected.account_id && trade.direction === selected.direction);
  const linkedCount = links.filter(link => link.status === 'connected').length;

  return (
    <main className="space-y-6">
      <SectionHeader title="MT5 Connections" subtitle="Manage connected computers, broker accounts and trade capture from one workspace." />

      <div className="flex flex-wrap items-center gap-3 text-xs text-secondary" aria-label="Connection overview">
        <span className="rounded-full border border-themed bg-secondary px-3 py-1.5">{devices.length} paired {devices.length === 1 ? 'PC' : 'PCs'}</span>
        <span className="rounded-full border border-themed bg-secondary px-3 py-1.5">{linkedCount} connected {linkedCount === 1 ? 'account' : 'accounts'}</span>
        <button className="btn-ghost inline-flex items-center gap-2" type="button" disabled={busy !== null} onClick={() => { void run('refresh', async () => { await refresh(); }, 'Connection status refreshed.'); }}>
          <RefreshCw size={15} className={busy === 'refresh' ? 'animate-spin' : ''} />
          {busy === 'refresh' ? 'Refreshing' : 'Refresh status'}
        </button>
      </div>

      {notice && (
        <div role="status" aria-live="polite" className="flex items-start gap-2 rounded-xl border border-themed bg-secondary px-4 py-3 text-sm">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success-500" aria-hidden="true" />
          <span>{notice.message}</span>
          <button type="button" className="ml-auto text-secondary hover:text-primary" aria-label="Dismiss confirmation" onClick={() => setNotice(null)}><X size={16} /></button>
        </div>
      )}
      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-error-500/30 bg-error-500/10 px-4 py-3 text-sm text-error-500">
          <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="flex-1">{error}</span>
          <button type="button" className="text-secondary hover:text-primary" aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button>
        </div>
      )}
      {capturePaused && (
        <div role="status" className="rounded-xl border border-themed bg-secondary px-4 py-3 text-sm">
          Broker trade capture is paused by your workspace administrator. Existing records remain available.
        </div>
      )}

      <section className="card space-y-5 p-5 sm:p-6" aria-labelledby="paired-pcs-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="paired-pcs-title" className="flex items-center gap-2 font-semibold"><Monitor size={19} className="text-brand-500" /> Paired computers</h2>
            <p className="mt-1 text-sm text-secondary">Select a computer to see its accounts, activity and connection controls.</p>
          </div>
          <button type="button" className="btn-primary inline-flex items-center gap-2" disabled={busy !== null} onClick={() => { void run('pair', async () => { const result = await action('pair'); setPairingCode(result.code); }, 'New pairing code generated.'); }}>
            <Plus size={16} />{busy === 'pair' ? 'Creating code…' : 'Pair a PC'}
          </button>
        </div>
        <a className="btn-secondary inline-flex items-center gap-2 self-start" href="/downloads/YoungMoney3-Connector.zip" download>
          <Download size={16} /> Download Windows app
        </a>
        {pairingCode && (
          <div className="rounded-xl border border-themed bg-secondary p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-secondary">One-time pairing code · valid for five minutes after creation</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <code className="min-w-0 flex-1 select-all break-all rounded-lg border border-themed bg-card px-3 py-3 font-mono text-base font-semibold tracking-wider">{pairingCode}</code>
              <button className="btn-secondary inline-flex items-center gap-2" type="button" onClick={() => { void copyPairingCode(); }}><Copy size={15} /> Copy code</button>
            </div>
            <p className="mt-2 text-xs text-secondary">Open the Windows connector and enter this code to pair the computer. Pairing alone does not confirm a broker account is syncing.</p>
          </div>
        )}
        {!loaded && <p role="status" className="text-sm text-secondary">Loading paired computers…</p>}
        {loaded && devices.length === 0 && (
          <div className="rounded-2xl border border-dashed border-themed p-6">
            <p className="font-medium">No computers paired yet</p>
            <p className="mt-1 text-sm text-secondary">Download the Windows app and choose “Pair a PC” to connect your first computer.</p>
          </div>
        )}
        <div className="space-y-3">
          {devices.map(device => {
            const open = expandedDevice === device.id;
            const online = deviceOnline(device);
            const accounts = links.filter(link => link.device === device.id);
            return (
              <article key={device.id} className="overflow-hidden rounded-2xl border border-themed bg-secondary">
                <button type="button" aria-expanded={open} aria-controls={'device-detail-' + device.id} onClick={() => setExpandedDevice(open ? null : device.id)}
                  className="flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-card sm:px-5">
                  <span className="rounded-xl border border-themed bg-card p-3"><Monitor size={20} aria-hidden="true" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">PC {device.id.slice(0, 8)}</span>
                    <span className="mt-1 block text-xs text-secondary">{accounts.length} linked {accounts.length === 1 ? 'account' : 'accounts'} · Seen {when(device.last_seen)}</span>
                  </span>
                  <span className={online ? 'rounded-full bg-success-500/10 px-2.5 py-1 text-xs font-medium text-success-500' : 'rounded-full border border-themed px-2.5 py-1 text-xs font-medium text-secondary'}>{online ? 'Online' : 'Offline'}</span>
                  <ChevronDown size={18} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} aria-hidden="true" />
                </button>
                {open && (
                  <div id={'device-detail-' + device.id} className="space-y-4 border-t border-themed bg-card px-4 py-4 sm:px-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-secondary">Device activity</p>
                        <p className="mt-1 text-sm">Last heartbeat: {when(device.last_seen)}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="btn-primary" disabled={!online || busy !== null} onClick={() => openLogin(device.id)}>Connect MT5 account</button>
                        <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => {
                          if (window.confirm('Revoke this computer? All of its linked accounts will stop syncing.')) {
                            void run('revoke-' + device.id, async () => {
                              await action('revoke', { device: device.id });
                              setExpandedDevice(null);
                            }, 'Computer revoked. Its accounts will no longer sync.');
                          }
                        }}>{busy === 'revoke-' + device.id ? 'Revoking…' : 'Revoke PC'}</button>
                      </div>
                    </div>
                    {!online && <p className="rounded-lg bg-secondary px-3 py-2 text-xs text-secondary">This PC is offline. Start its Windows connector before linking another account.</p>}
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-secondary">Accounts on this computer</p>
                      {accounts.length === 0 ? <p className="text-sm text-secondary">No broker accounts linked to this PC yet.</p> : (
                        <div className="flex flex-wrap gap-2">
                          {accounts.map(link => (
                            <button type="button" key={link.id} className="btn-secondary" onClick={() => {
                              setExpandedLink(link.id);
                              document.getElementById('mt5-linked-accounts')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }}>{link.company || 'Account'} {link.login || ''} · {accountStatus(link)}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section id="mt5-linked-accounts" className="card scroll-mt-6 space-y-4 p-5 sm:p-6" aria-labelledby="linked-accounts-title">
        <div>
          <h2 id="linked-accounts-title" className="flex items-center gap-2 font-semibold"><Link2 size={19} className="text-brand-500" /> Linked broker accounts</h2>
          <p className="mt-1 text-sm text-secondary">Select an account for balances, synchronization health and import controls.</p>
        </div>
        {loaded && links.length === 0 && <div className="rounded-xl border border-dashed border-themed p-5 text-sm text-secondary">No accounts linked. Open an online paired computer above to add an MT5 account.</div>}
        <div className="space-y-3">
          {links.map(link => {
            const open = expandedLink === link.id;
            const status = accountStatus(link);
            const healthGood = status === 'Connected';
            const hasGap = Boolean(link.gap);
            const canScan = link.status === 'connected' && !capturePaused && !(demoOnly && link.trade_mode === 2);
            const computer = devices.find(device => device.id === link.device);
            return (
              <article key={link.id} className="overflow-hidden rounded-2xl border border-themed bg-secondary">
                <button type="button" aria-expanded={open} aria-controls={'link-detail-' + link.id} onClick={() => setExpandedLink(open ? null : link.id)}
                  className="flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-card sm:px-5">
                  <span className="rounded-xl border border-themed bg-card p-3"><Link2 size={18} aria-hidden="true" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{link.company || 'Broker account'} {link.login || ''}</span>
                    <span className="mt-1 block truncate text-xs text-secondary">{accountMode(link.trade_mode)} · {link.server || 'Server not reported'}</span>
                  </span>
                  <span className={healthGood ? 'rounded-full bg-success-500/10 px-2.5 py-1 text-xs font-medium text-success-500' : 'rounded-full border border-themed px-2.5 py-1 text-xs font-medium text-secondary'}>{status}</span>
                  <ChevronDown size={18} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} aria-hidden="true" />
                </button>
                {open && (
                  <div id={'link-detail-' + link.id} className="space-y-4 border-t border-themed bg-card px-4 py-5 sm:px-5">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-xl border border-themed bg-secondary p-3"><p className="text-xs text-secondary">Reported balance</p><p className="mt-1 text-base font-semibold tabular-nums">{money(link.broker_balance, link.currency)}</p></div>
                      <div className="rounded-xl border border-themed bg-secondary p-3"><p className="text-xs text-secondary">Reported equity</p><p className="mt-1 text-base font-semibold tabular-nums">{money(link.broker_equity, link.currency)}</p></div>
                      <div className="rounded-xl border border-themed bg-secondary p-3"><p className="text-xs text-secondary">Last sync</p><p className="mt-1 text-sm font-medium">{when(link.last_sync)}</p></div>
                      <div className="rounded-xl border border-themed bg-secondary p-3"><p className="text-xs text-secondary">Paired computer</p><p className="mt-1 text-sm font-medium">{computer ? 'PC ' + computer.id.slice(0, 8) : 'Not reported'}</p></div>
                    </div>
                    <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-secondary">
                      <span>Broker server: {link.server || 'Not available'}</span>
                      <span>Account type: {accountMode(link.trade_mode)}</span>
                      <span>Access: {link.access_level === 'trading-enabled' ? 'External trading permission; journal remains capture-only' : link.access_level === 'trading-restricted' ? 'Externally restricted' : 'Not reported'}</span>
                    </div>
                    {status === 'Sync delayed' && <div className="flex gap-2 rounded-lg border border-themed bg-secondary p-3 text-sm"><AlertCircle size={17} className="shrink-0 text-secondary" />This connection is registered, but its latest broker snapshot is stale. Check the Windows connector before relying on these balances.</div>}
                    {demoOnly && link.trade_mode === 2 && <div className="rounded-lg border border-themed bg-secondary p-3 text-sm">Real-account capture is disabled in this environment.</div>}
                    {hasGap && <div className="rounded-lg border border-themed bg-secondary p-3 text-sm">A disconnected interval was recorded. Intermediate stop-loss changes may be missing.</div>}
                    {link.last_error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-error-500/30 bg-error-500/10 p-3 text-sm text-error-500"><AlertCircle size={17} className="shrink-0" />{link.last_error}</div>}
                    <div className="border-t border-themed pt-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="flex items-center gap-2 text-sm font-semibold"><History size={16} /> Historical trade import</h3>
                          <p className="mt-1 text-xs text-secondary">Review broker fills before importing. The default is the previous 30 days.</p>
                        </div>
                        <div className="flex flex-wrap items-end gap-2">
                          <label className="text-xs text-secondary">Lookback
                            <select className="input-field mt-1 block max-w-full" value={historyDays} onChange={event => setHistoryDays(event.target.value)}>
                              <option value="30">30 days</option>
                              <option value="365">1 year</option>
                              <option value="3650">Up to 10 years</option>
                            </select>
                          </label>
                          {canScan && (
                            <button type="button" className="btn-secondary" disabled={busy !== null || link.history_status === 'requested'} onClick={() => {
                              void run('history-request-' + link.id, async () => {
                                await action('history-request', { link: link.id, days: Number(historyDays) });
                                setHistoryLink(link.id);
                                setPreview(null);
                              }, 'Historical scan requested. Keep the Windows connector running.');
                            }}>{busy === 'history-request-' + link.id ? 'Requesting…' : 'Find earlier trades'}</button>
                          )}
                        </div>
                      </div>
                      {link.history_status === 'requested' && (
                        <div role="status" className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-secondary p-3 text-sm">
                          <span className="flex-1">Scanning on your PC. Keep the connector running.</span>
                          <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => {
                            void run('history-cancel-' + link.id, async () => {
                              await action('history-decline', { link: link.id, request: link.history_id });
                              setPreview(null);
                            }, 'Historical scan cancelled.');
                          }}>Cancel scan</button>
                        </div>
                      )}
                      {['ready', 'imported'].includes(link.history_status || '') && (
                        <button type="button" className="btn-secondary mt-3" disabled={busy !== null} onClick={() => {
                          void run('history-preview-' + link.id, async () => {
                            const result = await action('history-preview', { link: link.id, offset: 0 });
                            setHistoryLink(link.id);
                            setPreview(result);
                          }, 'Historical fills loaded for review.');
                        }}>{busy === 'history-preview-' + link.id ? 'Loading…' : 'Review earlier trades'}</button>
                      )}
                      {historyLink === link.id && preview && (
                        <section className="mt-4 space-y-3 rounded-xl border border-themed bg-secondary p-4" aria-label="Historical fills preview">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h4 className="font-semibold">Review historical fills</h4>
                            <span className="text-xs text-secondary">{preview.rows.length} reviewed · {preview.more ? 'More pages remain' : 'All pages loaded'}</span>
                          </div>
                          <p className="text-xs text-secondary">Review each page before importing. Imported and manually recorded trades can be matched separately while retaining journal notes.</p>
                          <div className="max-h-64 overflow-auto rounded-lg border border-themed">
                            <table className="w-full min-w-[460px] text-left text-xs">
                              <thead className="bg-card"><tr><th className="p-3">Asset</th><th className="p-3">Closed</th><th className="p-3">Lots</th><th className="p-3">Net P&amp;L</th></tr></thead>
                              <tbody>{preview.rows.map((row, index) => <tr key={index} className="border-t border-themed"><td className="p-3">{String(row.pair)}</td><td className="p-3">{String(row.exit_time)}</td><td className="p-3">{String(row.lot_size)}</td><td className="p-3">{String(row.pnl)}</td></tr>)}</tbody>
                            </table>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {preview.more && <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => {
                              void run('history-more', async () => {
                                const next = await action('history-preview', { link: historyLink, offset: preview.nextOffset });
                                setPreview(previous => previous ? { ...next, rows: [...previous.rows, ...next.rows] } : next);
                              }, 'More historical fills loaded.');
                            }}>{busy === 'history-more' ? 'Loading…' : 'Review next 100 fills'}</button>}
                            <button type="button" className="btn-primary" disabled={busy !== null || preview.more} onClick={() => {
                              void run('history-import', async () => {
                                let more = true;
                                while (more) {
                                  const result = await action('history-import', { link: historyLink, request: link.history_id, expected_count: preview.rows.length });
                                  more = Boolean(result.more);
                                }
                                setPreview(null);
                                await fetchTrades();
                              }, 'Reviewed historical fills imported.');
                            }}>{busy === 'history-import' ? 'Importing…' : 'Import ' + preview.rows.length + ' reviewed fills'}</button>
                            <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => {
                              void run('history-skip', async () => {
                                await action('history-decline', { link: historyLink, request: link.history_id });
                                setPreview(null);
                              }, 'Historical import skipped.');
                            }}>Skip import</button>
                          </div>
                        </section>
                      )}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
        <details className="rounded-xl border border-themed p-4 text-sm">
          <summary className="cursor-pointer font-medium">How does MT5 capture work?</summary>
          <p className="mt-3 text-secondary">YoungMoney3 reads trading activity and account snapshots without placing, changing or closing orders. A dedicated portable MT5 terminal is required for each simultaneously monitored account. Supported account types depend on the environment.</p>
        </details>
      </section>

      <dialog ref={loginDialog} aria-labelledby="mt5-login-title" className="mt5-dialog" onClose={() => { setLoginDevice(''); void refresh().catch(() => setError('Could not refresh connection status after closing the account login.')); }}>
        <header className="flex items-center justify-between border-b border-themed px-5 py-4">
          <h2 id="mt5-login-title" className="font-semibold">Connect MT5 account</h2>
          <button className="btn-ghost p-2" type="button" aria-label="Close account login" onClick={() => loginDialog.current?.close()}><X size={18} /></button>
        </header>
        {loginDevice && <iframe title="MT5 broker account login" className="w-full border-0" style={{ height: 'min(530px,70dvh)' }} src={'/mt5-login.html#' + encodeURIComponent(loginDevice)} />}
      </dialog>

      {trades.some(trade => source(trade) === 'mt5') && (
        <details className="card space-y-3 p-5">
          <summary className="flex cursor-pointer items-center gap-2 font-medium"><ShieldCheck size={17} /> Review imported and manual trade matches</summary>
          <p className="mt-3 text-sm text-secondary">Confirm only genuine matches. Journal notes will be retained.</p>
          <label className="block text-sm">Broker trade
            <select className="input-field mt-1 block w-full" value={imported} onChange={event => { setImported(event.target.value); setManual(''); }}>
              <option value="">Choose a broker trade</option>
              {trades.filter(trade => source(trade) === 'mt5' && trade.status === 'closed').map(trade => <option key={trade.id} value={trade.id}>{trade.pair} · {trade.direction} · {trade.entry_time} · {trade.pnl}</option>)}
            </select>
          </label>
          {selected && <label className="block text-sm">Manual entry
            <select className="input-field mt-1 block w-full" value={manual} onChange={event => setManual(event.target.value)}>
              <option value="">Choose the matching entry</option>
              {matches.map(trade => <option key={trade.id} value={trade.id}>{trade.pair} · {trade.entry_time} · {trade.pnl}</option>)}
            </select>
          </label>}
          <button className="btn-primary" type="button" disabled={!manual || busy !== null} onClick={() => {
            void run('match', async () => {
              await action('match', { imported, manual });
              setManual('');
              setImported('');
              await fetchTrades();
            }, 'Trade records matched. Existing journal notes retained.');
          }}>{busy === 'match' ? 'Matching…' : 'Confirm trade match'}</button>
        </details>
      )}
    </main>
  );
}
