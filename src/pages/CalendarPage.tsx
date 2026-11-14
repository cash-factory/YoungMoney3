import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useTrades, useTradingAccounts } from '@/hooks/useData';
import { useMt5Lifecycles } from '@/hooks/useMt5Lifecycles';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatPips } from '@/lib/utils';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { LoadingSpinner, EmptyState } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Modal';
import { TradeForm } from '@/components/TradeForm';
import type { TradeInput } from '@/lib/types';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  isSameMonth, isSameDay, parseISO, format, addMonths, subMonths,
} from 'date-fns';

export function CalendarPage() {
  const { user } = useAuth();
  const { trades, loading, addTrade } = useTrades(user?.id);
  const { accounts } = useTradingAccounts(user?.id);
  const { positions: brokerPositions, error: positionError } = useMt5Lifecycles(user?.id);
  const [accountFilter, setAccountFilter] = useState('all');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addDate, setAddDate] = useState<Date | null>(null);

  // Derived broker lifecycles are deliberately kept distinct from legacy fill
  // rows until exact-identity migration is approved. UTC closes are explicit;
  // never imply an unconfirmed broker-local calendar conversion.
  const lifecycleRows = useMemo(() => brokerPositions.filter(row =>
    accountFilter === 'all' || row.account_id === accountFilter
  ), [brokerPositions, accountFilter]);
  const lifecycleByCloseDate = useMemo(() => {
    const grouped = new Map<string, typeof lifecycleRows>();
    for (const row of lifecycleRows) {
      if (row.summary.status !== 'closed' || !row.summary.final_exit_at) continue;
      const day = row.summary.final_exit_at.slice(0,10);
      grouped.set(day,[...(grouped.get(day)||[]),row]);
    }
    return grouped;
  }, [lifecycleRows]);

  const days = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const calStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
    return eachDayOfInterval({ start: calStart, end: calEnd });
  }, [currentMonth]);

  const tradesByDay = useMemo(() => {
    const map = new Map<string, { trades: typeof trades; pnl: number }>();
    trades.filter(t => accountFilter === 'all' || t.account_id === accountFilter).forEach(t => {
      const key = format(parseISO(t.entry_time), 'yyyy-MM-dd');
      const ex = map.get(key) || { trades: [], pnl: 0 };
      ex.trades.push(t);
      ex.pnl += t.pnl;
      map.set(key, ex);
    });
    return map;
  }, [trades, accountFilter]);

  const selectedTrades = useMemo(() => {
    if (!selectedDate) return [];
    const key = format(selectedDate, 'yyyy-MM-dd');
    return tradesByDay.get(key)?.trades || [];
  }, [selectedDate, tradesByDay]);

  const monthStats = useMemo(() => {
    const monthTrades = trades.filter(t => (accountFilter === 'all' || t.account_id === accountFilter) && isSameMonth(parseISO(t.entry_time), currentMonth));
    const pnl = monthTrades.reduce((s, t) => s + t.pnl, 0);
    const wins = monthTrades.filter(t => t.outcome === 'win').length;
    return { pnl, count: monthTrades.length, wins, winRate: monthTrades.length ? (wins / monthTrades.length) * 100 : 0 };
  }, [trades, currentMonth, accountFilter]);

  const handleAddOnDate = (date: Date) => {
    setAddDate(date);
    setShowAdd(true);
  };

  const handleSubmit = async (data: TradeInput) => {
    await addTrade(data);
    setShowAdd(false);
    setAddDate(null);
  };

  if (loading) return <LoadingSpinner label="Loading calendar..." />;

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div>
      <SectionHeader
        title="Calendar"
        subtitle={`${format(currentMonth, 'MMMM yyyy')} — legacy journal: ${monthStats.count} rows (separate from broker lifecycles)`}
      />

      <label className="block text-xs text-secondary font-semibold max-w-sm mb-4">Account
        <select className="input-field mt-1" value={accountFilter} onChange={event=>setAccountFilter(event.target.value)}>
          <option value="all">All accounts</option>
          {accounts.map(item=><option key={item.id} value={item.id}>{item.name} · {item.base_currency}</option>)}
        </select>
      </label>
      <section className="card p-4 sm:p-5 mb-5" aria-label="MT5 position lifecycle calendar summary">
        <p className="text-xs font-bold uppercase tracking-wider text-muted">BROKER POSITION CALENDAR · UTC CLOSE DATES</p>
        <h2 className="font-semibold text-base mt-1">Verified lifecycle counts</h2>
        <p className="text-xs text-muted mt-1 mb-3">Each broker position lifecycle counts once, even after partial closes. These close dates use recorded UTC; broker-local dates are not inferred until the account's historical timezone conversion is verified. Existing manual/legacy calendar results below remain separate.</p>
        {positionError && <p role="status" className="text-xs text-muted">Broker position summaries are temporarily unavailable.</p>}
        {(()=> {
          const prefix = format(currentMonth,'yyyy-MM');
          const matching = [...lifecycleByCloseDate].filter(([day])=>day.startsWith(prefix));
          const count = matching.reduce((total,[,rows])=>total+rows.length,0);
          const knownR = matching.flatMap(([,rows])=>rows.map(row=>row.summary.final_realized_r).filter((value):value is string=>value!=null));
          return <div className="flex flex-wrap gap-3 text-sm">
            <div className="rounded-lg bg-secondary p-3"><p className="text-xs text-muted">Closed lifecycles</p><strong className="font-mono text-lg">{count}</strong></div>
            <div className="rounded-lg bg-secondary p-3"><p className="text-xs text-muted">Known final R</p><strong className="font-mono text-lg">{knownR.length} / {count}</strong></div>
            <div className="rounded-lg bg-secondary p-3"><p className="text-xs text-muted">Close-date coverage</p><strong className="font-mono text-lg">{matching.length} UTC days</strong></div>
          </div>;
        })()}
      </section>

      {/* Month navigation */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="btn-secondary p-2">
            <ChevronLeft size={18} />
          </button>
          <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="btn-secondary p-2">
            <ChevronRight size={18} />
          </button>
          <button onClick={() => setCurrentMonth(new Date())} className="btn-secondary text-xs">
            Today
          </button>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-success-500/20 border border-success-500/40" /> Win</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-error-500/20 border border-error-500/40" /> Loss</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-secondary border border-themed" /> No trades</span>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="card p-3 sm:p-4">
        <div className="grid grid-cols-7 gap-1 mb-2">
          {weekDays.map(d => (
            <div key={d} className="text-center text-xs font-semibold text-muted py-2">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {days.map(day => {
            const key = format(day, 'yyyy-MM-dd');
            const dayData = tradesByDay.get(key);
            const brokerClosed = lifecycleByCloseDate.get(key)?.length || 0;
            const inMonth = isSameMonth(day, currentMonth);
            const isToday = isSameDay(day, new Date());
            const isSelected = selectedDate && isSameDay(day, selectedDate);

            return (
              <button
                key={key}
                onClick={() => setSelectedDate(day)}
                className={`relative min-h-[72px] sm:min-h-[96px] p-1.5 rounded-lg border text-left transition-all ${
                  isSelected ? 'border-brand-500 ring-1 ring-brand-500/20' : 'border-themed'
                } ${inMonth ? 'bg-card' : 'bg-secondary/30'} ${isToday ? 'ring-1 ring-brand-500/30' : ''} hover:border-muted`}
              >
                <div className={`text-xs font-medium ${inMonth ? 'text-secondary' : 'text-muted'} ${isToday ? 'text-brand-500 font-bold' : ''}`}>
                  {format(day, 'd')}
                </div>
                {dayData && (
                  <div className="mt-1">
                    <div className={`text-xs font-mono font-bold ${dayData.pnl >= 0 ? 'text-success-500' : 'text-error-500'}`}>
                      {formatCurrency(dayData.pnl)}
                    </div>
                    <div className="text-[10px] text-muted">{dayData.trades.length} trade{dayData.trades.length !== 1 ? 's' : ''}</div>
                  </div>
                )}
                {brokerClosed>0 && <div className="mt-1 text-[10px] font-semibold text-brand-500">{brokerClosed} broker position{brokerClosed===1?'':'s'} closed (UTC)</div>}
                {dayData && (
                  <div className={`absolute bottom-1 right-1 w-2 h-2 rounded-full ${dayData.pnl >= 0 ? 'bg-success-500' : 'bg-error-500'}`} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected day detail */}
      {selectedDate && (
        <div className="card p-5 mt-4 animate-slide-up">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold">{format(selectedDate, 'EEEE, MMMM d yyyy')}</h3>
              {selectedTrades.length > 0 && (
                <p className="text-xs text-muted mt-0.5">
                  {selectedTrades.length} trade{selectedTrades.length !== 1 ? 's' : ''} · {formatCurrency(selectedTrades.reduce((s, t) => s + t.pnl, 0))}
                </p>
              )}
            </div>
            <button onClick={() => handleAddOnDate(selectedDate)} className="btn-primary text-xs">
              <Plus size={16} /> Add Trade
            </button>
          </div>

          {selectedDate && (lifecycleByCloseDate.get(format(selectedDate,'yyyy-MM-dd'))?.length || 0)>0 && <div className="rounded-lg border border-themed p-3 mb-3 text-xs">
            <strong>Broker positions closed on this UTC date</strong>
            <div className="mt-2 space-y-2">
              {(lifecycleByCloseDate.get(format(selectedDate,'yyyy-MM-dd')) || []).map(row=><div key={row.link+'/'+row.lifecycle_id} className="flex flex-wrap justify-between gap-2">
                <span>{row.summary.symbol} · {row.summary.direction} · #{row.summary.position_id}</span>
                <span className="font-mono">Final R: {row.summary.final_realized_r==null?'Unavailable':row.summary.final_realized_r+'R'}</span>
              </div>)}
            </div>
          </div>}

          {selectedTrades.length > 0 ? (
            <div className="space-y-2">
              {selectedTrades.map(t => (
                <div key={t.id} className="flex items-center justify-between p-3 rounded-xl bg-secondary border border-themed">
                  <div className="flex items-center gap-3">
                    <span className={`badge ${t.status === 'open' ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20' : t.outcome === 'win' ? 'badge-success' : t.outcome === 'loss' ? 'badge-error' : 'badge-neutral'}`}>
                      {t.status === 'open' ? 'Open' : t.outcome === 'win' ? <TrendingUp size={12} /> : t.outcome === 'loss' ? <TrendingDown size={12} /> : <Minus size={12} />}
                    </span>
                    <div>
                      <span className="font-mono font-semibold text-sm">{t.pair}</span>
                      <span className={`ml-2 text-xs ${t.direction === 'long' ? 'text-success-500' : 'text-error-500'}`}>
                        {t.direction === 'long' ? 'Long' : 'Short'}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`font-mono font-semibold text-sm ${t.pnl >= 0 ? 'text-success-500' : 'text-error-500'}`}>
                      {formatCurrency(t.pnl)}
                    </span>
                    <span className="block text-xs text-muted">{formatPips(t.pips)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={<Plus size={32} />} title="No trades on this day" message="Click 'Add Trade' to log a trade for this date." />
          )}
        </div>
      )}

      <Modal open={showAdd} onClose={() => { setShowAdd(false); setAddDate(null); }} title="Add New Trade" size="lg">
        <TradeForm
          key={addDate?.toISOString() || 'new'}
          onSubmit={handleSubmit}
          onCancel={() => { setShowAdd(false); setAddDate(null); }}
        />
      </Modal>
    </div>
  );
}
