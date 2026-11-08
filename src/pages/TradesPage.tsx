import { useMemo, useState } from 'react';
import { Plus, Search, Edit2, Trash2, ChevronDown, ChevronUp, Star, Download, Filter, X, Clock, CheckCircle } from 'lucide-react';
import { useTrades, useTradingAccounts } from '@/hooks/useData';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatPips, formatDateTime, exportToCSV, downloadFile } from '@/lib/utils';
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
  const { trades, loading, addTrade, updateTrade, deleteTrade } = useTrades(user?.id);
  const { accounts } = useTradingAccounts(user?.id);
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

  const pairs = useMemo(() => [...new Set(trades.map(t => t.pair))].sort(), [trades]);

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
  const openCount = trades.filter(t => t.status === 'open').length;
  const closedCount = trades.filter(t => t.status === 'closed').length;

  if (loading) return <LoadingSpinner label="Loading trades..." />;

  return (
    <div>
      <SectionHeader
        title="Trades"
        subtitle={`${filtered.length} of ${trades.length} trades`}
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

      {/* Status tabs */}
      <div className="flex items-center gap-2 mb-4">
        {([
          { key: 'all', label: 'All', count: trades.length },
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
              <select className="input-field" value={filterPair} onChange={e => setFilterPair(e.target.value)}>
                <option value="">All pairs</option>
                {pairs.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-secondary mb-1.5">Outcome</label>
              <select className="input-field" value={filterOutcome} onChange={e => setFilterOutcome(e.target.value as 'win' | 'loss' | 'breakeven' | '')}>
                <option value="">All outcomes</option>
                <option value="win">Win</option>
                <option value="loss">Loss</option>
                <option value="breakeven">Breakeven</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-secondary mb-1.5">Direction</label>
              <select className="input-field" value={filterDirection} onChange={e => setFilterDirection(e.target.value as TradeDirection | '')}>
                <option value="">Both</option>
                <option value="long">Long</option>
                <option value="short">Short</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-secondary mb-1.5">Account</label>
              <select className="input-field" value={filterAccount} onChange={e => setFilterAccount(e.target.value)}>
                <option value="">All accounts</option>
                {accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>
          <label>Trade source <select value={origin} onChange={e=>setOrigin(e.target.value)}><option value="all">All trades</option><option value="manual">Manual</option><option value="mt5">MT5</option></select></label>
          {hasFilters && (
            <button onClick={clearFilters} className="mt-3 text-xs text-brand-500 hover:underline flex items-center gap-1">
              <X size={14} /> Clear all filters
            </button>
          )}
        </div>
      )}

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
            <div key={t.id} className="border-b border-themed/50 last:border-0">
              {/* Row */}
              <div
                className="grid grid-cols-12 gap-2 px-4 py-3 hover:bg-secondary transition-colors cursor-pointer lg:items-center"
                onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
              >
                <div className="col-span-12 lg:col-span-3 text-xs text-muted">
                  {formatDateTime(t.entry_time)}
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
                  <span className={`badge ${t.direction === 'long' ? 'badge-success' : 'badge-error'}`}>
                    {t.direction === 'long' ? 'Long' : 'Short'}
                  </span>
                </div>
                <div className="col-span-3 lg:col-span-1">
                  {t.status === 'open' ? (
                    <span className="badge bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20">
                      <Clock size={10} /> Open
                    </span>
                  ) : (
                    <span className={`badge ${t.outcome === 'win' ? 'badge-success' : t.outcome === 'loss' ? 'badge-error' : 'badge-neutral'}`}>
                      {t.outcome || '—'}
                    </span>
                  )}
                </div>
                <div className="hidden lg:block col-span-1 text-xs text-muted capitalize">
                  {t.session ? t.session.replace('_', ' ') : '—'}
                </div>
                <div className="col-span-6 lg:col-span-2 text-right font-mono font-semibold text-sm">
                  {t.status === 'open' ? (
                    <span className="text-orange-500 text-xs">Pending</span>
                  ) : (
                    <>
                      <span className={t.pnl >= 0 ? 'text-success-500' : 'text-error-500'}>
                        {formatCurrency(t.pnl)}
                      </span>
                      <span className="block text-xs text-muted">{formatPips(t.pips)}</span>
                    </>
                  )}
                </div>
                <div className="col-span-6 lg:col-span-2 flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
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
                <div className="px-4 pb-4 pt-2 bg-secondary/50 animate-slide-up">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <DetailItem label="Entry Price" value={t.entry_price?.toString() || '—'} />
                        <DetailItem label="Exit Price" value={t.exit_price?.toString() || '—'} />
                        <DetailItem label="Take Profit" value={t.take_profit?.toString() || '—'} />
                        <DetailItem label="Lot Size" value={t.lot_size?.toString() || '—'} />
                        <DetailItem label="Risk %" value={t.risk_percent?.toString() || '—'} />
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

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add New Trade" size="lg">
        <TradeForm onSubmit={handleAdd} onCancel={() => setShowAdd(false)} />
      </Modal>

      <Modal open={!!editTrade} onClose={() => setEditTrade(null)} title="Edit Trade" size="lg">
        {editTrade && <TradeForm initial={editTrade} onSubmit={handleEdit} onCancel={() => setEditTrade(null)} />}
      </Modal>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs text-muted block">{label}</span>
      <span className="font-mono text-sm">{value}</span>
    </div>
  );
}
