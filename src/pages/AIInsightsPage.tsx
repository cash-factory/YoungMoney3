import { useMemo, useState } from 'react';
import { Sparkles, TrendingUp, Lightbulb, AlertTriangle, CheckCircle, BarChart2, RefreshCw, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { useTrades } from '@/hooks/useData';
import { useAuth } from '@/context/AuthContext';
import { generateAISummary, getPeriodTrades } from '@/lib/ai';
import { formatCurrency, formatPercent } from '@/lib/utils';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { LoadingSpinner, EmptyState } from '@/components/ui/Feedback';
import type { JournalType } from '@/lib/types';
import { format, subDays, subWeeks, startOfWeek, endOfWeek } from 'date-fns';

export function AIInsightsPage() {
  const { user } = useAuth();
  const { trades, loading } = useTrades(user?.id);
  const [period, setPeriod] = useState<JournalType>('weekly');
  const [refDate, setRefDate] = useState(new Date());
  const [generating, setGenerating] = useState(false);

  const { currentTrades, previousTrades, periodLabel, prevLabel } = useMemo(() => {
    const { current, previous } = getPeriodTrades(trades, refDate, period);
    let label = '', prev = '';
    if (period === 'daily') {
      label = format(refDate, 'MMM d, yyyy');
      prev = format(subDays(refDate, 1), 'MMM d, yyyy');
    } else if (period === 'weekly') {
      label = `${format(startOfWeek(refDate, { weekStartsOn: 1 }), 'MMM d')} – ${format(endOfWeek(refDate, { weekStartsOn: 1 }), 'MMM d')}`;
      prev = `${format(startOfWeek(subWeeks(refDate, 1), { weekStartsOn: 1 }), 'MMM d')} – ${format(endOfWeek(subWeeks(refDate, 1), { weekStartsOn: 1 }), 'MMM d')}`;
    } else {
      label = format(refDate, 'MMMM yyyy');
      const prevDate = new Date(refDate);
      prevDate.setMonth(prevDate.getMonth() - 1);
      prev = format(prevDate, 'MMMM yyyy');
    }
    return { currentTrades: current, previousTrades: previous, periodLabel: label, prevLabel: prev };
  }, [trades, refDate, period]);

  const aiResult = useMemo(() => {
    if (currentTrades.length === 0 && previousTrades.length === 0) return null;
    return generateAISummary(currentTrades, previousTrades, period);
  }, [currentTrades, previousTrades, period]);

  const handleGenerate = () => {
    setGenerating(true);
    setTimeout(() => setGenerating(false), 600);
  };

  const shiftPeriod = (dir: number) => {
    const d = new Date(refDate);
    if (period === 'daily') d.setDate(d.getDate() + dir);
    else if (period === 'weekly') d.setDate(d.getDate() + dir * 7);
    else d.setMonth(d.getMonth() + dir);
    setRefDate(d);
  };

  if (loading) return <LoadingSpinner label="Loading insights..." />;

  return (
    <div>
      <SectionHeader
        title="Trading Insights"
        subtitle="Rule-based analysis of your recorded trading patterns and performance"
        action={
          <button onClick={handleGenerate} disabled={generating} className="btn-primary">
            <RefreshCw size={18} className={generating ? 'animate-spin' : ''} /> {generating ? 'Analyzing...' : 'Refresh Analysis'}
          </button>
        }
      />

      {/* Period selector */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-6">
        <div className="flex gap-2">
          {(['daily', 'weekly', 'monthly'] as JournalType[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                period === p ? 'bg-brand-500/10 text-brand-600 dark:text-brand-400 border-brand-500/20' : 'bg-secondary border-themed text-secondary hover:border-muted'
              }`}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={() => shiftPeriod(-1)} className="btn-secondary p-2 text-xs">←</button>
          <span className="text-sm font-semibold min-w-[120px] text-center">{periodLabel}</span>
          <button onClick={() => shiftPeriod(1)} className="btn-secondary p-2 text-xs">→</button>
        </div>
      </div>

      {generating ? (
        <LoadingSpinner label="Analyzing your trading data..." />
      ) : !aiResult ? (
        <div className="card p-8">
          <EmptyState icon={<Sparkles size={40} />} title="No data for this period" message="Add trades for this period to receive rule-based insights and suggestions." />
        </div>
      ) : (
        <div className="space-y-6 animate-fade-in">
          {/* Summary */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Sparkles size={16} className="text-brand-500" /> Period Summary
            </h3>
            <p className="text-sm leading-relaxed">{aiResult.summary}</p>
            <div className="mt-3 text-xs text-muted">
              {currentTrades.length} trades this {period} · {previousTrades.length} trades previous {period}
            </div>
          </div>

          {/* Comparison table */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <BarChart2 size={16} className="text-brand-500" /> {periodLabel} vs {prevLabel}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted uppercase tracking-wide border-b border-themed">
                    <th className="text-left py-2 font-medium">Metric</th>
                    <th className="text-right py-2 font-medium">{prevLabel}</th>
                    <th className="text-right py-2 font-medium">{periodLabel}</th>
                    <th className="text-right py-2 font-medium">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(aiResult.comparison.current).map(([key, curVal]) => {
                    const prevVal = aiResult.comparison.previous[key];
                    let actualDelta: number | null = null;
                    const metricMap: Record<string, string> = {
                      'NetPL': 'totalPnl', 'Trades': 'totalTrades', 'WinRate': 'winRate',
                      'AvgWin': 'avgWin', 'AvgLoss': 'avgLoss', 'ProfitFactor': 'profitFactor',
                      'Expectancy': 'expectancy',
                    };
                    const mappedKey = metricMap[key.replace(/\s/g, '')];
                    if (mappedKey) actualDelta = aiResult.comparison.deltas[mappedKey];

                    return (
                      <tr key={key} className="border-b border-themed/30 last:border-0">
                        <td className="py-2.5 font-medium">{key}</td>
                        <td className="py-2.5 text-right text-muted font-mono">{prevVal}</td>
                        <td className="py-2.5 text-right font-mono font-semibold">{curVal}</td>
                        <td className="py-2.5 text-right">
                          {actualDelta != null && !isNaN(actualDelta) ? (
                            <span className={`inline-flex items-center gap-1 text-xs font-semibold ${
                              actualDelta > 0 ? 'text-success-500' : actualDelta < 0 ? 'text-error-500' : 'text-muted'
                            }`}>
                              {actualDelta > 0 ? <ArrowUp size={12} /> : actualDelta < 0 ? <ArrowDown size={12} /> : <Minus size={12} />}
                              {key === 'Win Rate' ? formatPercent(Math.abs(actualDelta)) : key === 'Trades' ? Math.abs(actualDelta) : formatCurrency(Math.abs(actualDelta))}
                            </span>
                          ) : (
                            <span className="text-muted text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Suggestions */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Lightbulb size={16} className="text-accent-500" /> Suggestions for Improvement
            </h3>
            <div className="space-y-2">
              {aiResult.suggestions.map((s, i) => (
                <div key={i} className="flex items-start gap-2.5 p-3 rounded-xl bg-secondary border border-themed">
                  <Lightbulb size={16} className="text-accent-500 mt-0.5 flex-shrink-0" />
                  <p className="text-sm">{s}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Patterns */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Sparkles size={16} className="text-brand-500" /> Detected Patterns
            </h3>
            {aiResult.patterns.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {aiResult.patterns.map((p, i) => {
                  const Icon = p.type === 'positive' ? CheckCircle : p.type === 'negative' ? AlertTriangle : TrendingUp;
                  const color = p.type === 'positive' ? 'text-success-500' : p.type === 'negative' ? 'text-error-500' : 'text-brand-500';
                  const bg = p.type === 'positive' ? 'bg-success-500/5 border-success-500/15' : p.type === 'negative' ? 'bg-error-500/5 border-error-500/15' : 'bg-brand-500/5 border-brand-500/15';
                  return (
                    <div key={i} className={`p-3.5 rounded-xl border ${bg}`}>
                      <div className="flex items-start gap-2.5">
                        <Icon size={18} className={`${color} mt-0.5 flex-shrink-0`} />
                        <div>
                          <p className="text-sm font-semibold">{p.title}</p>
                          <p className="text-xs text-secondary mt-1">{p.detail}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted">Not enough data to detect patterns yet. Keep journaling your trades consistently.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
