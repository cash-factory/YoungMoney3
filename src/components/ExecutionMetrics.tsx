import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { ChevronDown, Clock, ShieldCheck, Target } from 'lucide-react';
import { getExecutionMetrics } from '@/lib/executionMetrics';
import { executionMovement, executionStats, formatHoldDuration } from '@/lib/executionPresentation';
import type { Trade } from '@/lib/types';

const number = (value: number | null | undefined) =>
  value == null ? 'Unknown' : value.toLocaleString(undefined, { maximumFractionDigits: 4 });
const label = (value: string) => value.replace(/_/g, ' ');

export function ExecutionSummaryCards({ trades }: { trades: Trade[] }) {
  const summary = executionStats(trades);
  const metrics = [
    {
      name: 'Average net R',
      value: summary.meanR == null ? '—' : summary.meanR.toFixed(2) + 'R',
      note: summary.count ? summary.rCount + ' of ' + summary.count + ' positions have known R' : 'No closed positions yet',
      icon: Target,
    },
    {
      name: 'Average hold',
      value: summary.meanDuration == null ? '—' : formatHoldDuration(summary.meanDuration),
      note: summary.count ? summary.durationCount + ' of ' + summary.count + ' positions have known duration' : 'Appears after your first close',
      icon: Clock,
    },
    {
      name: 'Initial risk captured',
      value: summary.initialRiskCount + ' / ' + summary.count,
      note: 'Closed positions with their original risk recorded',
      icon: ShieldCheck,
    },
  ];
  return <section className="ym-execution-summary card grid grid-cols-1 divide-y divide-themed sm:grid-cols-3 sm:divide-y-0 sm:divide-x" aria-label="Execution quality">
    {metrics.map(metric => <div className="min-w-0 p-4 sm:p-5" key={metric.name}>
      <p className="flex items-center gap-2 text-xs font-medium text-secondary"><metric.icon size={15} className="text-muted" />{metric.name}</p>
      <p className="mt-3 text-xl font-semibold tracking-tight tabular-nums">{metric.value}</p>
      <p className="mt-2 text-[11px] leading-relaxed text-muted">{metric.note}</p>
    </div>)}
  </section>;
}

export function ExecutionMetricsPanel({ trade }: { trade: Trade }) {
  const metrics = getExecutionMetrics(trade);
  const fields = [
    ['First protective SL', number(metrics.first_sl)],
    ['SL evidence', metrics.first_sl_source ? label(metrics.first_sl_source) : 'Unknown'],
    ['First SL observed', metrics.first_sl_at ? new Date(metrics.first_sl_at).toLocaleString() : 'Unknown'],
    ['Initial risk', number(metrics.initial_risk) + (metrics.initial_risk != null ? ' ' + (trade.settlement_currency || trade.calculation_snapshot?.account_currency || '') : '')],
    ['Planned reward / risk', metrics.planned_r == null ? 'Unknown' : metrics.planned_r.toFixed(2) + 'R'],
    ['Net realized R', metrics.realized_r == null ? 'Unknown' : metrics.realized_r.toFixed(2) + 'R'],
    ['Movement', executionMovement(trade)],
    [trade.status === 'open' ? 'Held so far' : 'Holding duration', formatHoldDuration(metrics.duration_seconds)],
    ['Volume-weighted hold', formatHoldDuration(metrics.weighted_duration_seconds)],
    ['Session at entry', metrics.sessions_at_entry?.map(label).join(' · ') || 'Unknown'],
    ['Sessions crossed', metrics.sessions_crossed?.map(label).join(' · ') || 'Unknown'],
    ['Time evidence', metrics.timezone_status ? label(metrics.timezone_status) : 'Unknown'],
  ];
  return <section className="ym-execution-panel space-y-5 rounded-xl border border-themed p-4 sm:p-5">
    <h3 className="text-sm font-semibold">Execution analysis</h3>
    <dl className="grid grid-cols-2 gap-x-5 gap-y-4 text-sm sm:grid-cols-3">
      {fields.map(([name, value]) => <div className="min-w-0" key={name}>
        <dt className="text-[11px] text-muted">{name}</dt>
        <dd className="mt-1.5 break-words font-medium tabular-nums">{value}</dd>
      </div>)}
    </dl>
    {metrics.delayed_sl && <p className="rounded-lg bg-secondary p-3 text-xs text-secondary">The first captured protective stop was added after entry.</p>}
    {!!metrics.completeness?.length && <p className="border-l-2 border-warning-500 pl-3 text-xs leading-relaxed text-secondary">Needs review · {metrics.completeness.map(label).join(' · ')}</p>}
    {!!metrics.fills?.length && <details className="border-t border-themed pt-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium">
        <span>Entries and exits <span className="ml-1 text-muted">{metrics.fills.length}</span></span><ChevronDown size={16} className="shrink-0 text-muted" />
      </summary>
      <div className="mt-3 overflow-x-auto"><table className="ym-table w-full text-left text-xs">
        <thead><tr><th>Fill</th><th>Time</th><th>Volume</th><th>Price</th><th>Net P&amp;L</th><th>Commission / fee</th><th>Swap</th><th>Reason</th></tr></thead>
        <tbody>{metrics.fills.map((fill, index) => <tr key={String(fill.ticket ?? index)}>
          <td><span className="capitalize">{String(fill.kind ?? fill.entry ?? 'Fill')}</span><span className="mt-1 block font-mono text-[10px] text-muted">{String(fill.ticket ?? index + 1)}</span></td>
          <td>{String(fill.time ?? fill.time_utc ?? '')}</td>
          <td className="font-mono">{String(fill.volume ?? fill.quantity ?? '')}</td>
          <td className="font-mono">{String(fill.price ?? '')}</td>
          <td className="font-mono">{String(fill.net ?? fill.net_pnl ?? fill.pnl ?? '')}</td>
          <td className="font-mono">{String(fill.commission ?? '—')} / {String(fill.fee ?? '—')}</td>
          <td className="font-mono">{String(fill.swap ?? '—')}</td>
          <td>{String(fill.reason ?? '—')}</td>
        </tr>)}</tbody>
      </table></div>
    </details>}
    {!!metrics.stops?.length && <details className="border-t border-themed pt-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium">
        <span>Stop and target observations <span className="ml-1 text-muted">{metrics.stops.length}</span></span><ChevronDown size={16} className="shrink-0 text-muted" />
      </summary>
      <ol className="mt-4 space-y-0 text-xs">
        {metrics.stops.map((stop, index) => <li key={index} className="grid grid-cols-[1fr_auto] gap-3 border-l border-themed py-2 pl-4">
          <time className="text-muted">{String(stop.time ?? stop.observed_at ?? '')}</time>
          <span className="font-mono text-secondary">SL {String(stop.sl ?? stop.stop_loss ?? '—')} <span className="mx-1 text-muted">/</span> TP {String(stop.tp ?? stop.take_profit ?? '—')}</span>
        </li>)}
      </ol>
    </details>}
  </section>;
}

export function ExecutionSessionSummary({ trades }: { trades: Trade[] }) {
  const summary = executionStats(trades);
  const largest = Math.max(1, ...summary.sessions.map(([, count]) => count));
  return <section className="card p-4 sm:p-5">
    <h3 className="text-sm font-semibold">Sessions at entry</h3>
    {summary.sessions.length ? <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {summary.sessions.map(([session, count]) => <div key={session}>
        <div className="flex items-center justify-between gap-3 text-xs"><span className="text-secondary">{label(session)}</span><span className="font-mono">{count}</span></div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full ym-execution-session-bar" style={{ backgroundColor:'var(--brand)', width: count / largest * 100 + '%' }} /></div>
      </div>)}
    </div> : <p className="mt-2 text-xs text-muted">Session analysis appears when entry timestamps have verified timezone information.</p>}
  </section>;
}

export function ExecutionAnalytics({ trades }: { trades: Trade[] }) {
  const closed = trades.filter(trade => trade.status === 'closed').sort((a, b) => Date.parse(a.exit_time || a.entry_time) - Date.parse(b.exit_time || b.entry_time));
  const bins = [{ name: 'Below −1R', count: 0 }, { name: '−1R to 0R', count: 0 }, { name: '0R to 1R', count: 0 }, { name: '1R to 2R', count: 0 }, { name: '2R and above', count: 0 }];
  const holds = [{ name: 'Under 5 minutes', count: 0 }, { name: '5–60 minutes', count: 0 }, { name: '1–24 hours', count: 0 }, { name: '1 day or longer', count: 0 }];
  const sessions = new Map<string, { count: number; rCount: number; r: number }>();
  const cumulative: { trade: number; r: number }[] = [];
  let running = 0;
  for (const trade of closed) {
    const metrics = getExecutionMetrics(trade);
    if (metrics.realized_r != null) {
      const r = metrics.realized_r;
      bins[r < -1 ? 0 : r < 0 ? 1 : r < 1 ? 2 : r < 2 ? 3 : 4].count++;
      running += r;
      cumulative.push({ trade: cumulative.length + 1, r: running });
    }
    if (metrics.duration_seconds != null) {
      const duration = metrics.duration_seconds;
      holds[duration < 300 ? 0 : duration < 3600 ? 1 : duration < 86400 ? 2 : 3].count++;
    }
    const session = metrics.sessions_at_entry?.join(' / ');
    if (session) {
      const item = sessions.get(session) || { count: 0, rCount: 0, r: 0 };
      item.count++;
      if (metrics.realized_r != null) { item.rCount++; item.r += metrics.realized_r; }
      sessions.set(session, item);
    }
  }
  return <div className="space-y-4">
    <section className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-sm font-semibold">Cumulative net R</h3><p className="text-xs text-muted">{cumulative.length} / {closed.length} positions have known risk</p></div>
      {cumulative.length ? <div className="mt-5"><ResponsiveContainer width="100%" height={230}>
        <LineChart data={cumulative} margin={{ top: 8, left: -16, bottom: 0, right: 12 }}>
          <XAxis dataKey="trade" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} tickFormatter={v => v + 'R'} />
          <ReferenceLine y={0} stroke="var(--border)" />
          <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} formatter={v => [Number(v).toFixed(2) + 'R', 'Cumulative R']} />
          <Line type="monotone" dataKey="r" stroke="var(--brand)" strokeWidth={2} dot={cumulative.length < 20} activeDot={{ r: 4, strokeWidth: 3, stroke: 'var(--bg-card)' }} animationDuration={450} isAnimationActive={typeof window !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches} />
        </LineChart>
      </ResponsiveContainer></div> : <p className="py-8 text-center text-sm text-muted">Capture an initial protective stop to enable R analysis.</p>}
    </section>
    <div className="grid gap-4 md:grid-cols-2">
      {[{ title: 'Net R distribution', items: bins }, { title: 'Holding time', items: holds }].map(section => {
        const largest = Math.max(1, ...section.items.map(item => item.count));
        return <section className="card p-4 sm:p-5" key={section.title}>
          <h3 className="mb-5 text-sm font-semibold">{section.title}</h3>
          <dl className="space-y-3 text-sm">{section.items.map(item => <div key={item.name}>
            <div className="flex justify-between gap-4"><dt className="text-xs text-secondary">{item.name}</dt><dd className="font-mono text-xs">{item.count}</dd></div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full ym-execution-session-bar" style={{ backgroundColor:'var(--brand)', width: item.count / largest * 100 + '%' }} /></div>
          </div>)}</dl>
        </section>;
      })}
    </div>
    <section className="card p-4 sm:p-5">
      <h3 className="mb-4 text-sm font-semibold">Session performance</h3>
      <div className="overflow-x-auto"><table className="ym-table w-full text-left text-sm">
        <thead><tr><th>Entry session / overlap</th><th>Positions</th><th>Average net R</th><th>R coverage</th></tr></thead>
        <tbody>{[...sessions].map(([session, item]) => <tr key={session}>
          <td>{session}</td><td className="font-mono">{item.count}</td><td className="font-mono">{item.rCount ? (item.r / item.rCount).toFixed(2) + 'R' : 'Unknown'}</td><td className="font-mono text-muted">{item.rCount}/{item.count}</td>
        </tr>)}</tbody>
      </table></div>
      {!sessions.size && <p className="py-4 text-sm text-muted">Session performance requires verified entry times.</p>}
    </section>
  </div>;
}
