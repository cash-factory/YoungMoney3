import { ReplayButton, TradeReplay } from '@/components/DecisionReplay';
import { visibleJournalTrades, reviewMoney, replayTargets, referenceFor } from '@/lib/decisionReplay';
import { tradeCurrency } from '@/lib/tradeFinance';
import { pnlTone, signedMoney } from '@/lib/tradingTone';
import { Select } from '@/components/Select';
import { useMemo, useState } from 'react';
import { Plus, Search, Edit2, Trash2, ChevronDown, ChevronUp, Star, Download, Filter, X, Clock, CheckCircle } from 'lucide-react';
import { useTrades, useTradingAccounts } from '@/hooks/useData';
import { useAuth } from '@/context/AuthContext';
import { useMt5Lifecycles } from '@/hooks/useMt5Lifecycles';
import { formatPips, formatDateTime, exportToCSV, downloadFile } from '@/lib/utils';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { LoadingSpinner, EmptyState } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Modal';
import { TradeForm } from '@/components/TradeForm';
import { TradeAttachments } from '@/components/TradeAttachments';
import type { Trade, TradeInput, TradeDirection, TradeStatus } from '@/lib/types';
import { format } from 'date-fns';

type SortField = 'entry_time' | 'pnl' | 'pair';
type SortDir = 'asc' | 'desc';

export function TradesPage() {
  const { user } = useAuth();
  const { trades: storedTrades, loading, addTrade, updateTrade, deleteTrade } = useTrades(user?.id);
  const { positions: positionVersions, loading: positionsLoading, error: positionError } = useMt5Lifecycles(user?.id);
  const trades=useMemo(()=>visibleJournalTrades(storedTrades,positionVersions),[storedTrades,positionVersions]);
  const { accounts } = useTradingAccounts(user?.id);
  const accountNames = useMemo(() => new Map(accounts.map(a => [a.id, a.name])), [accounts]);
  const [origin,setOrigin] = useState('all');
  const [showAdd, setShowAdd] = useState(false);
  const [editTrade, setEditTrade] = useState<Trade | null>(null);
  const [search, setSearch] = useState('');
  const [filterPair, setFilterPair] = useState('');
  const [filterOutcome, setFilterOutcome] = useState<'win' | 'loss' | 'breakeven' | ''>('');
  const [filterDirection, setFilterDirection] = useState<TradeDirection | ''>('');
  const [filterAccount, setFilterAccount] = useState('');
  const [sortField, setSortField] = useState<SortField>('entry_time');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState<TradeStatus | 'all'>('all');
  const [linkedTradeId, setLinkedTradeId] = useState(() => new URLSearchParams(window.location.search).get('trade'));
  const [decisionRef, setDecisionRef] = useState(() => new URLSearchParams(window.location.search).get('decision'));
  const linkedDecision = useMemo(() => decisionRef ? replayTargets(storedTrades, positionVersions).find(target => referenceFor(target) === decisionRef) : undefined, [decisionRef, storedTrades, positionVersions]);
  const closeDecision = () => {
    setDecisionRef(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('decision');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  };
  const linkedTrade = linkedTradeId ? storedTrades.find(trade => trade.id === linkedTradeId) : null;
  const closeLinkedTrade = () => {
    setLinkedTradeId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('trade');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  };

  const pairs = useMemo(() => [...new Set([...trades.map(t=>t.pair),...positionVersions.map(v=>v.summary.symbol)])].sort(), [trades,positionVersions]);
  const richTrades=useMemo(()=>positionVersions.filter(row=>{
    const t=row.summary;
    if(origin==='manual')return false;
    if(statusFilter!=='all'&&t.status!==statusFilter)return false;
    if(filterAccount && row.account_id!==filterAccount)return false;
    if(filterPair && t.symbol!==filterPair)return false;
    if(filterDirection && t.direction!==filterDirection)return false;
    if(search && ![t.symbol,t.broker,t.position_id,t.lifecycle_id].some(value=>value?.toLowerCase().includes(search.toLowerCase())))return false;
    if(filterOutcome){
      if(t.status==='open'||t.net_realized_profit==null)return false;
      const amount=Number(t.net_realized_profit);
      if((filterOutcome==='win'&&amount<=0)||(filterOutcome==='loss'&&amount>=0)||(filterOutcome==='breakeven'&&amount!==0))return false;
    }
    return true;
  }),[positionVersions,origin,statusFilter,filterAccount,filterPair,filterDirection,search,filterOutcome]);

  const filtered = useMemo(() => {
    let result = trades.filter(t => origin === 'all' || (t.trade_source || 'manual') === origin);
    if (statusFilter !== 'all') result = result.filter(t => t.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(t =>
        t.pair.toLowerCase().includes(q) ||
        t.strategy?.toLowerCase().includes(q) ||
        t.notes?.toLowerCase().includes(q) ||
        t.lessons?.toLowerCase().includes(q) ||
        t.broker?.toLowerCase().includes(q)
      );
    }
    if (filterPair) result = result.filter(t => t.pair === filterPair);
    if (filterOutcome) result = result.filter(t => t.outcome === filterOutcome);
    if (filterDirection) result = result.filter(t => t.direction === filterDirection);
    if (filterAccount) result = result.filter(t => t.account_id === filterAccount);

    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'entry_time') cmp = new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime();
      else if (sortField === 'pnl') cmp = a.pnl - b.pnl;
      else cmp = a.pair.localeCompare(b.pair);
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return result;
  }, [trades, origin, statusFilter, search, filterPair, filterOutcome, filterDirection, filterAccount, sortField, sortDir]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const handleAdd = async (data: TradeInput) => {
    await addTrade(data);
    setShowAdd(false);
  };

  const handleEdit = async (data: TradeInput) => {
    if (editTrade) {
      await updateTrade(editTrade.id, data);
      setEditTrade(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this trade? This cannot be undone.')) {
      await deleteTrade(id);
    }
  };

  const handleExport = () => {
    const csv = exportToCSV(filtered);
    downloadFile(csv, `trades-${format(new Date(), 'yyyy-MM-dd')}.csv`);
  };

  const clearFilters = () => {
    setOrigin('all'); setSearch(''); setFilterPair(''); setFilterOutcome(''); setFilterDirection(''); setFilterAccount('');
  };

  const hasFilters = origin !== 'all' || search || filterPair || filterOutcome || filterDirection || filterAccount;
  const openCount = trades.filter(t => t.status === 'open').length + positionVersions.filter(row=>row.summary.status==='open').length;
  const closedCount = trades.filter(t => t.status === 'closed').length + positionVersions.filter(row=>row.summary.status==='closed').length;
  // Counts follow the active filters. Broker position projections are separate
  // from journal fills; never combine account currencies into one money total.
  const visibleGains = filtered.filter(t => t.status==='closed' && t.pnl>0).length
    + richTrades.filter(row => row.summary.status==='closed' && pnlTone(row.summary.net_realized_profit)==='positive').length;
  const visibleLosses = filtered.filter(t => t.status==='closed' && t.pnl<0).length
    + richTrades.filter(row => row.summary.status==='closed' && pnlTone(row.summary.net_realized_profit)==='negative').length;
  const visibleOpen = filtered.filter(t=>t.status==='open').length
    + richTrades.filter(row=>row.summary.status==='open').length;

  if (loading) return <LoadingSpinner label="Loading trades..." />;

  return (
    <div className="ym-trades-page">
      <SectionHeader
        title="Trades"
        subtitle={String(filtered.length+richTrades.length)+' of '+String(trades.length+positionVersions.length)+' trades / broker lifecycles'}
        action={
          <div className="flex gap-2">
            <button onClick={handleExport} className="btn-secondary">
              <Download size={18} /> Export
            </button>
            <button onClick={() => setShowAdd(true)} className="btn-primary">
              <Plus size={18} /> Add Trade
            </button>
          </div>
        }
      />

      <div className="ym-trade-overview" aria-label="Results for the current filters">
        <article data-tone="positive"><small>Winning trades</small><strong>{visibleGains}</strong><p>Closed results above zero</p></article>
        <article data-tone="negative"><small>Losing trades</small><strong>{visibleLosses}</strong><p>Closed results below zero</p></article>
        <article data-tone="pending"><small>Still open</small><strong>{visibleOpen}</strong><p>Unrealized outcomes are not counted</p></article>
      </div>
      <div className="ym-market-legend mb-5" aria-label="Trade colour guide">
        <span data-kind="gain"><i aria-hidden="true"/>Profit / take profit</span>
        <span data-kind="loss"><i aria-hidden="true"/>Loss / stop loss</span>
        <span data-kind="risk"><i aria-hidden="true"/>Open / risk attention</span>
        <span data-kind="direction"><i aria-hidden="true"/>Direction is not an outcome</span>
      </div>
      {linkedDecision && <TradeReplay target={linkedDecision} onClose={closeDecision}/>}
      {decisionRef && !linkedDecision && !positionsLoading && <div role="status" className="card p-4 mb-4 text-sm">This decision is currently unavailable in this account. <button className="btn-secondary" onClick={closeDecision}>Dismiss</button></div>}
      {linkedTradeId && !linkedTrade && <div role="status" className="card p-4 mb-4 text-sm"><p>This linked trade is no longer available in your account.</p><button type="button" className="btn-secondary mt-2" onClick={closeLinkedTrade}>Dismiss</button></div>}

      {/* Status tabs */}
      <div className="flex items-center gap-2 mb-4">
        {([
          { key: 'all', label: 'All', count: trades.length+positionVersions.length },
          { key: 'open', label: 'Open', count: openCount },
          { key: 'closed', label: 'Closed', count: closedCount },
        ] as const).map(tab => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              statusFilter === tab.key
                ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20'
                : 'bg-secondary border border-themed text-secondary hover:border-muted'
            }`}
          >
            {tab.key === 'open' && <Clock size={14} />}
            {tab.key === 'closed' && <CheckCircle size={14} />}
            {tab.label}
            <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-secondary text-[10px]">{tab.count}</span>
          </button>
        ))}
      </div>

      {/* Search + filter toggle */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="input-field pl-10"
            placeholder="Search by pair, strategy, notes, broker..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <button onClick={() => setShowFilters(s => !s)} className="btn-secondary">
          <Filter size={18} /> Filters
          {hasFilters && <span className="w-2 h-2 rounded-full bg-brand-500" />}
        </button>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="card p-4 mb-4 animate-slide-up">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-semibold text-secondary mb-1.5">Pair</label>
              <Select className="input-field" value={filterPair} onChange={e => setFilterPair(e.target.value)}>
                <option value="">All pairs</option>
                {pairs.map(p => <option key={p} value={p}>{p}</option>)}
              </Select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-secondary mb-1.5">Outcome</label>
              <Select className="input-field" value={filterOutcome} onChange={e => setFilterOutcome(e.target.value as 'win' | 'loss' | 'breakeven' | '')}>
                <option value="">All outcomes</option>
                <option value="win">Win</option>
                <option value="loss">Loss</option>
                <option value="breakeven">Breakeven</option>
              </Select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-secondary mb-1.5">Direction</label>
              <Select className="input-field" value={filterDirection} onChange={e => setFilterDirection(e.target.value as TradeDirection | '')}>
                <option value="">Both</option>
                <option value="long">Long</option>
                <option value="short">Short</option>
              </Select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-secondary mb-1.5">Account</label>
              <Select className="input-field" value={filterAccount} onChange={e => setFilterAccount(e.target.value)}>
                <option value="">All accounts</option>
                {accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </div>
          </div>
          <label>Trade source <Select value={origin} onChange={e=>setOrigin(e.target.value)}><option value="all">All trades</option><option value="manual">Manual</option><option value="mt5">MT5</option></Select></label>
          {hasFilters && (
            <button onClick={clearFilters} className="mt-3 text-xs text-brand-500 hover:underline flex items-center gap-1">
              <X size={14} /> Clear all filters
            </button>
          )}
        </div>
      )}

      {/* Canonical broker lifecycle rows. Preserve raw legacy fills unless the
          same position identity is established by an MT5 projection. */}
      {origin!=='manual' && <section className="card p-4 sm:p-5 mb-4 space-y-3" aria-label="Broker position lifecycles">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-sm font-bold">MT5 position lifecycles</h2>
            <p className="text-xs text-muted mt-1">One row per position lifecycle, including partial closes and scale-ins. Unknown original risk is never estimated.</p>
          </div>
          <span className="badge badge-neutral">{richTrades.length} lifecycles in view</span>
        </div>
        {positionError && <p role="status" className="text-xs text-muted">Rich capture is not available on this environment yet. Previously imported trades remain visible.</p>}
        {richTrades.length===0 ? <p className="text-sm text-muted">No synced broker lifecycles match these filters yet.</p> :
          <div className="space-y-2">
            {richTrades.map(row=>{
              const t=row.summary;
              return <details key={row.link+'/'+t.lifecycle_id} className="ym-mt5-lifecycle rounded-xl border border-themed px-3 py-3" data-result={t.status==='open'?'open':pnlTone(t.net_realized_profit)==='positive'?'win':pnlTone(t.net_realized_profit)==='negative'?'loss':'neutral'}>
                <summary className="flex flex-wrap items-center justify-between gap-3 cursor-pointer">
                  <span className="flex flex-col">
                    <strong className="text-sm flex flex-wrap items-center gap-2">{t.symbol} <span className="ym-direction-tag" data-side={t.direction}>{t.direction==='long'?'Long':'Short'}</span> <span className="text-muted font-normal text-xs">{t.status==='open'?'Open position':'Closed position'}</span></strong>
                    <small className="text-muted">{[accountNames.get(row.account_id), t.broker, t.first_entry_at].filter(Boolean).join(' · ')} · Position {t.position_id}</small>
                  </span>
                  <span className="flex flex-col text-right">
                    <strong className={`ym-market-value text-sm ym-market-${pnlTone(t.net_realized_profit,t.status==='open')}`}>{t.status==='open'?'Unrealized / unavailable':t.net_realized_profit == null?'Unavailable':signedMoney(Number(t.net_realized_profit),String(t.net_realized_profit))} {t.settlement_currency}</strong>
                    <small className="text-muted">{t.movement ?? '—'} {t.movement_unit} · Net R {t.final_realized_r ?? t.realized_r ?? 'unavailable'}</small>
                  </span>
                </summary>
                <ReplayButton target={{kind:'position',position:row}}/>
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 mt-4">
                  {[
                    ['Original SL',t.initial_sl ?? 'Unavailable'],
                    ['Stop provenance',t.initial_sl_provenance || 'Unknown'],
                    ['First observed stop',t.initial_sl_observed_at || '—'],
                    ['Original TP',t.initial_tp ?? 'Unavailable'],
                    ['Current SL',t.current_sl ?? '—'],
                    ['Current TP',t.current_tp ?? '—'],
                    ['Initial account risk',t.initial_risk_account ?? 'Unavailable'],
                    ['Current stop exposure',t.current_stop_exposure_account ?? 'Unavailable'],
                    ['Remaining volume',t.remaining_volume ?? 'Unknown'],
                    ['Closed volume',t.closed_volume ?? '0'],
                    ['Duration',t.holding_seconds ? (Number(t.holding_seconds)/3600).toFixed(2)+' hours' : 'Open/unknown'],
                    ['VW duration',t.weighted_holding_seconds ? (Number(t.weighted_holding_seconds)/3600).toFixed(2)+' hours' : 'Unknown'],
                  ].map(([label,value])=><div key={label} className="ym-market-detail" data-level={label==='Original SL'||label==='Current SL'?'sl':label==='Original TP'||label==='Current TP'?'tp':label.toLowerCase().includes('risk')||label.toLowerCase().includes('exposure')?'risk':undefined}><span>{label}</span><strong>{value}</strong></div>)}
                </div>
                <p className="mt-3 text-xs text-secondary">Session: {t.sessions?.status==='confirmed'?t.sessions.sessions?.join(', ')||'Outside named windows':'Unresolved — broker timezone or UTC conversion needs verification'} · Risk: {t.capture_completeness?.original_risk || 'unknown'} · Calculation v{t.calculation_version}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <div><h3 className="text-xs font-bold mb-2">Entries / scale-ins ({t.entries.length})</h3>
                    {t.entries.map((entry,index)=><div key={index} className="border-t border-themed py-2 text-xs">
                      Ticket {entry.deal_ticket} · {entry.volume} @ {entry.price}
                      <p className="text-muted">{entry.time} · SL {entry.initial_sl ?? 'unknown'} · Original risk {entry.initial_risk ?? 'unavailable'}</p>
                    </div>)}
                  </div>
                  <div><h3 className="text-xs font-bold mb-2">Partial / full exits ({t.exits.length})</h3>
                    {t.exits.map((exit,index)=><div key={index} className="border-t border-themed py-2 text-xs">
                      Ticket {exit.deal_ticket} · {exit.volume} @ {exit.price}
                      <p className="text-muted">Net {exit.net_profit ?? 'unknown'} · Allocated risk {exit.allocated_initial_risk ?? 'unavailable'} · R {exit.realized_r ?? 'unavailable'}</p>
                    </div>)}
                  </div>
                </div>
              </details>;
            })}
          </div>}
      </section>}
      {/* Trade list */}
      {filtered.length === 0 ? (
        <div className="card p-8">
          <EmptyState
            icon={<Plus size={40} />}
            title={hasFilters ? "No trades match your filters" : "No trades yet"}
            message={hasFilters ? "Try adjusting your search or filters." : "Click 'Add Trade' to log your first trade."}
          />
        </div>
      ) : (
        <div className="card overflow-hidden">
          {/* Desktop table header */}
          <div className="hidden lg:grid grid-cols-12 gap-2 px-4 py-3 text-xs text-muted uppercase tracking-wide border-b border-themed bg-secondary">
            <button className="col-span-3 text-left font-medium hover:text-primary" onClick={() => handleSort('entry_time')}>
              Date {sortField === 'entry_time' && (sortDir === 'asc' ? <ChevronUp size={12} className="inline" /> : <ChevronDown size={12} className="inline" />)}
            </button>
            <button className="col-span-2 text-left font-medium hover:text-primary" onClick={() => handleSort('pair')}>
              Pair {sortField === 'pair' && (sortDir === 'asc' ? <ChevronUp size={12} className="inline" /> : <ChevronDown size={12} className="inline" />)}
            </button>
            <div className="col-span-1 font-medium">Dir</div>
            <div className="col-span-1 font-medium">Outcome</div>
            <div className="col-span-1 font-medium">Session</div>
            <button className="col-span-2 text-right font-medium hover:text-primary" onClick={() => handleSort('pnl')}>
              P&L {sortField === 'pnl' && (sortDir === 'asc' ? <ChevronUp size={12} className="inline" /> : <ChevronDown size={12} className="inline" />)}
            </button>
            <div className="col-span-2 text-right font-medium">Actions</div>
          </div>

          {filtered.map(t => (
            <div key={t.id} className="ym-ledger-row border-b border-themed/50 last:border-0" data-result={t.status==='open'?'open':t.pnl>0?'win':t.pnl<0?'loss':'neutral'}>
              {/* Row */}
              <div
                className="grid grid-cols-12 gap-2 px-4 py-3 hover:bg-secondary transition-colors cursor-pointer lg:items-center"
                onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
              >
                <div className="col-span-12 lg:col-span-3 ym-ledger-entry">
                  <span className="ym-ledger-date">{formatDateTime(t.entry_time)}</span>
                  <span className="ym-ledger-time">{accountNames.get(t.account_id || '') || 'Unassigned account'}</span>
                </div>
                <div className="col-span-6 lg:col-span-2 font-mono font-semibold text-sm">
                  {t.pair}
                  {t.account_type && (
                    <span className={`ml-2 badge ${t.account_type === 'propfirm' ? 'badge-accent' : 'badge-brand'} text-[10px]`}>
                      {t.account_type === 'propfirm' ? 'Prop' : 'Personal'}
                    </span>
                  )}
                </div>
                <div className="col-span-3 lg:col-span-1">
                  <span className="ym-direction-tag" data-side={t.direction}>
                    {t.direction === 'long' ? 'Long' : 'Short'}
                  </span>
                </div>
                <div className="col-span-3 lg:col-span-1">
                  {t.status === 'open' ? (
                    <span className="ym-market-chip" data-tone="pending">
                      <Clock size={10} /> Open
                    </span>
                  ) : (
                    <span className="ym-market-chip" data-tone={pnlTone(t.pnl)}>
                      {t.outcome === 'win' ? 'Win' : t.outcome === 'loss' ? 'Loss' : 'Break-even'}
                    </span>
                  )}
                </div>
                <div className="hidden lg:block col-span-1 text-xs text-muted capitalize">
                  {t.session ? t.session.replace('_', ' ') : '—'}
                </div>
                <div className="col-span-6 lg:col-span-2 text-right">
                  {t.status === 'open' ? (
                    <span className="ym-market-chip" data-tone="pending">Awaiting close</span>
                  ) : (
                    <>
                      <span className={`ym-ledger-pnl ym-market-${pnlTone(t.pnl)}`}>
                        {signedMoney(t.pnl,reviewMoney(t.pnl,tradeCurrency(t,accounts)))}
                      </span>
                      <span className="block ym-ledger-subline">{t.pips>0?'+':''}{formatPips(t.pips)}</span>
                    </>
                  )}
                </div>
                <div className="col-span-6 lg:col-span-2 flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                  <ReplayButton target={{kind:'trade',trade:t}}/>
                  <button onClick={() => setEditTrade(t)} className="btn-ghost p-1.5">
                    <Edit2 size={16} />
                  </button>
                  <button disabled={t.trade_source === 'mt5'} onClick={() => handleDelete(t.id)} className="btn-ghost p-1.5 text-error-500 hover:bg-error-500/10">
                    <Trash2 size={16} />
                  </button>
                  <button onClick={() => setExpandedId(expandedId === t.id ? null : t.id)} className="btn-ghost p-1.5">
                    {expandedId === t.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                </div>
              </div>

              {/* Expanded detail */}
              {expandedId === t.id && (
                <div className="ym-ledger-expand px-4 pb-4 pt-4 animate-slide-up">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <DetailItem label="Entry Price" value={t.entry_price?.toString() || '—'} />
                        <DetailItem label="Exit Price" value={t.exit_price?.toString() || '—'} />
                        <DetailItem label="Stop Loss · SL" value={t.stop_loss?.toString() || '—'} tone="sl" />
                        <DetailItem label="Fees" value={t.fees?.toString() || '—'} />
                        <DetailItem label="Deal Ticket" value={String(t.broker_details?.deal_ticket || '—')} />
                        <DetailItem label="Position ID" value={String(t.broker_details?.position_id || '—')} />
                        <DetailItem label="Swap" value={String(t.broker_details?.swap ?? '—')} />
                        <DetailItem label="Closed At" value={t.exit_time ? formatDateTime(t.exit_time) : '—'} />
                        <DetailItem label="Take Profit · TP" value={t.take_profit?.toString() || '—'} tone="tp" />
                        <DetailItem label="Lot Size" value={t.lot_size?.toString() || '—'} />
                        <DetailItem label="Risk %" value={t.risk_percent?.toString() || '—'} tone="risk" />
                        <DetailItem label="R:R Ratio" value={t.risk_reward_ratio ? `1:${t.risk_reward_ratio.toFixed(2)}` : '—'} />
                        <DetailItem label="Broker" value={t.broker || '—'} />
                        <DetailItem label="Strategy" value={t.strategy || '—'} />
                        <DetailItem label="Emotion" value={t.emotional_state || '—'} />
                        <DetailItem label="Status" value={t.status === 'open' ? 'Open' : 'Closed'} />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-secondary">Setup Quality:</span>
                        <div className="flex">
                          {[1,2,3,4,5].map(s => (
                            <Star key={s} size={14} className={s <= (t.setup_quality || 0) ? 'fill-accent-400 text-accent-400' : 'text-muted'} />
                          ))}
                        </div>
                      </div>
                      {t.mistakes.length > 0 && (
                        <div>
                          <span className="text-xs font-semibold text-secondary">Mistakes:</span>
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            {t.mistakes.map(m => <span key={m} className="badge badge-error text-[10px]">{m}</span>)}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="space-y-3">
                      {t.lessons && (
                        <div>
                          <span className="text-xs font-semibold text-secondary">What I Learned:</span>
                          <p className="mt-1 text-sm">{t.lessons}</p>
                        </div>
                      )}
                      {t.notes && (
                        <div>
                          <span className="text-xs font-semibold text-secondary">Notes:</span>
                          <p className="mt-1 text-sm whitespace-pre-wrap">{t.notes}</p>
                        </div>
                      )}
                      <TradeAttachments trade={t} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={!!linkedTrade} onClose={closeLinkedTrade} title="Trade capture · Media Library" size="lg">
        {linkedTrade && <div className="space-y-5">
          <div className="flex flex-wrap justify-between gap-3"><div><h3 className="text-xl font-bold">{linkedTrade.pair}</h3><p className="text-xs text-muted mt-1">{formatDateTime(linkedTrade.entry_time)} · {linkedTrade.direction === 'long' ? 'Long' : 'Short'} · {linkedTrade.status}</p></div><span className="badge badge-brand h-fit">{linkedTrade.trade_source === 'mt5' ? 'Broker capture' : 'Journal trade'}</span></div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3"><DetailItem label="Entry price" value={linkedTrade.entry_price?.toString() || '—'} /><DetailItem label="Exit price" value={linkedTrade.exit_price?.toString() || 'Open'} /><DetailItem label="Strategy" value={linkedTrade.strategy || '—'} /><DetailItem label="Closed at" value={linkedTrade.exit_time ? formatDateTime(linkedTrade.exit_time) : 'Open'} /></div>
          {linkedTrade.notes && <div><h4 className="text-xs font-semibold text-secondary mb-2">Trade notes</h4><p className="text-sm whitespace-pre-wrap">{linkedTrade.notes}</p></div>}
          <TradeAttachments trade={linkedTrade} />
          {linkedTrade.lessons && <div><h4 className="text-xs font-semibold text-secondary mb-2">What I learned</h4><p className="text-sm whitespace-pre-wrap">{linkedTrade.lessons}</p></div>}
          <button type="button" className="btn-secondary" onClick={closeLinkedTrade}>Back to trades</button>
        </div>}
      </Modal>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add New Trade" size="lg">
        <TradeForm onSubmit={handleAdd} onCancel={() => setShowAdd(false)} />
      </Modal>

      <Modal open={!!editTrade} onClose={() => setEditTrade(null)} title="Edit Trade" size="lg">
        {editTrade && <TradeForm initial={editTrade} onSubmit={handleEdit} onCancel={() => setEditTrade(null)} />}
      </Modal>
    </div>
  );
}

function DetailItem({ label, value, tone }: { label: string; value: string; tone?: 'sl' | 'tp' | 'risk' }) {
  return (
    <div className="ym-market-detail" data-level={tone}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
