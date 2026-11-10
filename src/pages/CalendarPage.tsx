import { ExecutionSummaryCards } from '@/components/ExecutionMetrics';
import { executionMovement } from '@/lib/executionPresentation';
import { realizedExecutionEvents } from '@/lib/executionMetrics';
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useTrades } from '@/hooks/useData';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency } from '@/lib/utils';
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
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addDate, setAddDate] = useState<Date | null>(null);

  const days = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const calStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
    return eachDayOfInterval({ start: calStart, end: calEnd });
  }, [currentMonth]);

  const tradesByDay = useMemo(() => {
    const map = new Map<string, { trades: typeof trades; pnl: number }>();
    for (const event of realizedExecutionEvents(trades)) {
      const key = format(parseISO(event.at), 'yyyy-MM-dd');
      const day = map.get(key) || { trades: [], pnl: 0 };
      if (!day.trades.some(trade => trade.id === event.trade.id)) day.trades.push(event.trade);
      day.pnl += event.pnl;
      map.set(key, day);
    }
    for (const trade of trades.filter(t=>t.status==='open')) {
      const key=format(parseISO(trade.entry_time),'yyyy-MM-dd');
      const day=map.get(key) || {trades:[],pnl:0};
      if(!day.trades.some(t=>t.id===trade.id)) day.trades.push(trade);
      map.set(key,day);
    }
    return map;
  }, [trades]);

  const selectedTrades = useMemo(() => {
    if (!selectedDate) return [];
    const key = format(selectedDate, 'yyyy-MM-dd');
    return tradesByDay.get(key)?.trades || [];
  }, [selectedDate, tradesByDay]);

  const monthStats = useMemo(() => {
    const events = realizedExecutionEvents(trades).filter(event => isSameMonth(parseISO(event.at),currentMonth));
    const monthTrades = [...new Map(events.map(event=>[event.trade.id,event.trade])).values()];
    const pnl = events.reduce((sum,event)=>sum+event.pnl,0);
    const completed = monthTrades.filter(trade=>trade.status==='closed');
    const wins = completed.filter(trade=>trade.outcome==='win').length;
    return {pnl,count:monthTrades.length,wins,winRate:completed.length ? wins/completed.length*100 : 0};
  }, [trades, currentMonth]);

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
        subtitle={`${format(currentMonth, 'MMMM yyyy')} — ${monthStats.count} trades, ${formatCurrency(monthStats.pnl)}`}
      />

      <div className="mb-5"><ExecutionSummaryCards trades={trades.filter(t => isSameMonth(parseISO(t.exit_time || t.entry_time), currentMonth))} /></div>
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

          {selectedTrades.length > 0 ? (
            <div className="space-y-2">
              <ExecutionSummaryCards trades={selectedTrades} />
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
                      {formatCurrency(selectedDate ? realizedExecutionEvents([t]).filter(event=>format(parseISO(event.at),'yyyy-MM-dd')===format(selectedDate,'yyyy-MM-dd')).reduce((sum,event)=>sum+event.pnl,0) : 0)}
                    </span>
                    <span className="block text-xs text-muted">{executionMovement(t)}</span>
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
