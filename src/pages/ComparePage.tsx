import { Select } from '@/components/Select';
import { useMemo, useState, useEffect } from 'react';
import { Swords, ArrowUpRight, ArrowDownRight, Minus, User, User2 } from 'lucide-react';
import { useTrades, useProfiles } from '@/hooks/useData';
import { computeDashboardStats, formatCurrency, formatPercent, groupByPair } from '@/lib/utils';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { LoadingSpinner, EmptyState } from '@/components/ui/Feedback';

export function ComparePage() {
  const { trades, loading } = useTrades();
  const { profiles, loading: profilesLoading } = useProfiles();
  const [traderAId, setTraderAId] = useState<string>('');
  const [traderBId, setTraderBId] = useState<string>('');

  const activeProfiles = useMemo(() => {
    return profiles.filter(p => trades.some(t => t.user_id === p.id));
  }, [profiles, trades]);

  // Auto-select first two traders if not selected
  useEffect(() => {
    if (activeProfiles.length >= 1 && !traderAId) setTraderAId(activeProfiles[0].id);
    if (activeProfiles.length >= 2 && !traderBId) setTraderBId(activeProfiles[1].id);
  }, [activeProfiles, traderAId, traderBId]);

  const traderA = activeProfiles.find(p => p.id === traderAId);
  const traderB = activeProfiles.find(p => p.id === traderBId);

  const statsA = useMemo(() => {
    if (!traderA) return null;
    return computeDashboardStats(trades.filter(t => t.user_id === traderA.id));
  }, [trades, traderA]);

  const statsB = useMemo(() => {
    if (!traderB) return null;
    return computeDashboardStats(trades.filter(t => t.user_id === traderB.id));
  }, [trades, traderB]);

  const pairsA = useMemo(() => traderA ? groupByPair(trades.filter(t => t.user_id === traderA.id)) : [], [trades, traderA]);
  const pairsB = useMemo(() => traderB ? groupByPair(trades.filter(t => t.user_id === traderB.id)) : [], [trades, traderB]);

  if (loading || profilesLoading) return <LoadingSpinner label="Loading comparison..." />;

  if (activeProfiles.length < 2) {
    return (
      <div>
        <SectionHeader title="Side-by-Side" subtitle="Learn from each other — not compete against each other" />
        <div className="card p-8">
          <EmptyState
            icon={<Swords size={40} />}
            title="Need at least 2 traders"
            message="Once two or more traders have logged trades, you can see each other's stats side by side here."
          />
        </div>
      </div>
    );
  }

  const metrics: { label: string; valueA: string; valueB: string; rawA: number; rawB: number; higherBetter: boolean; isCurrency?: boolean; isPercent?: boolean }[] = [
    { label: 'Net P&L', valueA: formatCurrency(statsA?.totalPnl || 0), valueB: formatCurrency(statsB?.totalPnl || 0), rawA: statsA?.totalPnl || 0, rawB: statsB?.totalPnl || 0, higherBetter: true, isCurrency: true },
    { label: 'Win Rate', valueA: formatPercent(statsA?.winRate || 0), valueB: formatPercent(statsB?.winRate || 0), rawA: statsA?.winRate || 0, rawB: statsB?.winRate || 0, higherBetter: true, isPercent: true },
    { label: 'Total Trades', valueA: String(statsA?.totalTrades || 0), valueB: String(statsB?.totalTrades || 0), rawA: statsA?.totalTrades || 0, rawB: statsB?.totalTrades || 0, higherBetter: false },
    { label: 'Profit Factor', valueA: statsA?.profitFactor === Infinity ? '∞' : (statsA?.profitFactor || 0).toFixed(2), valueB: statsB?.profitFactor === Infinity ? '∞' : (statsB?.profitFactor || 0).toFixed(2), rawA: statsA?.profitFactor === Infinity ? 999 : statsA?.profitFactor || 0, rawB: statsB?.profitFactor === Infinity ? 999 : statsB?.profitFactor || 0, higherBetter: true },
    { label: 'Expectancy', valueA: formatCurrency(statsA?.expectancy || 0), valueB: formatCurrency(statsB?.expectancy || 0), rawA: statsA?.expectancy || 0, rawB: statsB?.expectancy || 0, higherBetter: true, isCurrency: true },
    { label: 'Avg Win', valueA: formatCurrency(statsA?.avgWin || 0), valueB: formatCurrency(statsB?.avgWin || 0), rawA: statsA?.avgWin || 0, rawB: statsB?.avgWin || 0, higherBetter: true, isCurrency: true },
    { label: 'Avg Loss', valueA: formatCurrency(statsA?.avgLoss || 0), valueB: formatCurrency(statsB?.avgLoss || 0), rawA: statsA?.avgLoss || 0, rawB: statsB?.avgLoss || 0, higherBetter: false, isCurrency: true },
    { label: 'Max Win Streak', valueA: String(statsA?.maxConsecutiveWins || 0), valueB: String(statsB?.maxConsecutiveWins || 0), rawA: statsA?.maxConsecutiveWins || 0, rawB: statsB?.maxConsecutiveWins || 0, higherBetter: true },
    { label: 'Avg R:R', valueA: statsA && statsA.avgRiskReward > 0 ? `1:${statsA.avgRiskReward.toFixed(2)}` : '—', valueB: statsB && statsB.avgRiskReward > 0 ? `1:${statsB.avgRiskReward.toFixed(2)}` : '—', rawA: statsA?.avgRiskReward || 0, rawB: statsB?.avgRiskReward || 0, higherBetter: true },
  ];

  const getDelta = (m: typeof metrics[0]) => {
    const diff = m.rawA - m.rawB;
    if (Math.abs(diff) < 0.01) return { icon: <Minus size={14} className="text-muted" />, label: 'Tie', color: 'text-muted' };
    const aWins = m.higherBetter ? diff > 0 : diff < 0;
    return {
      icon: aWins ? <ArrowUpRight size={14} className="text-success-500" /> : <ArrowDownRight size={14} className="text-error-500" />,
      label: aWins ? 'A leads' : 'B leads',
      color: aWins ? 'text-success-500' : 'text-error-500',
    };
  };

  return (
    <div>
      <SectionHeader title="Side-by-Side" subtitle="Learn from each other — not compete against each other" />

      {/* Trader selectors */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-xs font-semibold text-secondary mb-1.5 uppercase tracking-wide">Trader A</label>
          <Select className="input-field" value={traderAId} onChange={e => setTraderAId(e.target.value)}>
            {activeProfiles.map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}
          </Select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-secondary mb-1.5 uppercase tracking-wide">Trader B</label>
          <Select className="input-field" value={traderBId} onChange={e => setTraderBId(e.target.value)}>
            {activeProfiles.map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}
          </Select>
        </div>
      </div>

      {/* Trader headers */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        {[traderA, traderB].map((t, i) => (
          <div key={i} className="card p-4 flex items-center gap-3">
            {t?.avatar_url ? (
              <img src={t.avatar_url} alt={t.display_name} className="w-10 h-10 rounded-full object-cover" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center text-white font-bold">
                {t?.display_name.charAt(0).toUpperCase() || '?'}
              </div>
            )}
            <div>
              <h3 className="font-semibold text-sm">{t?.display_name || 'Select trader'}</h3>
              {t?.trading_style && <p className="text-xs text-muted">{t.trading_style}</p>}
            </div>
            {i === 0 ? <User size={16} className="text-orange-500 ml-auto" /> : <User2 size={16} className="text-amber-500 ml-auto" />}
          </div>
        ))}
      </div>

      {/* Comparison table */}
      <div className="card overflow-hidden mb-6">
        <div className="grid grid-cols-3 px-4 py-3 text-xs text-muted uppercase tracking-wide border-b border-themed bg-secondary">
          <div className="font-medium">Metric</div>
          <div className="text-right font-medium">Trader A</div>
          <div className="text-right font-medium">Trader B</div>
        </div>
        {metrics.map((m, i) => {
          const delta = getDelta(m);
          return (
            <div key={i} className="grid grid-cols-3 px-4 py-3 border-b border-themed/50 last:border-0 hover:bg-secondary/50 transition-colors">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">{m.label}</span>
                <span className={`inline-flex items-center gap-0.5 text-[10px] ${delta.color}`}>{delta.icon} {delta.label}</span>
              </div>
              <div className={`text-right font-mono font-semibold text-sm ${m.rawA >= m.rawB ? (m.higherBetter ? 'text-success-500' : 'text-error-500') : ''}`}>
                {m.valueA}
              </div>
              <div className={`text-right font-mono font-semibold text-sm ${m.rawB >= m.rawA ? (m.higherBetter ? 'text-success-500' : 'text-error-500') : ''}`}>
                {m.valueB}
              </div>
            </div>
          );
        })}
      </div>

      {/* Top pairs comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[{ trader: traderA, pairs: pairsA, label: 'A' }, { trader: traderB, pairs: pairsB, label: 'B' }].map(({ trader, pairs, label }) => (
          <div key={label} className="card p-5">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              {label === 'A' ? <User size={16} className="text-orange-500" /> : <User2 size={16} className="text-amber-500" />}
              {trader?.display_name}'s Top Pairs
            </h3>
            {pairs.length > 0 ? (
              <div className="space-y-2">
                {pairs.slice(0, 5).map(p => (
                  <div key={p.pair} className="flex items-center justify-between p-2.5 rounded-lg bg-secondary">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono font-semibold">{p.pair}</span>
                      <span className="text-xs text-muted">{p.trades} trades</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted">{formatPercent(p.winRate)} WR</span>
                      <span className={`text-sm font-mono font-semibold ${p.pnl >= 0 ? 'text-success-500' : 'text-error-500'}`}>
                        {formatCurrency(p.pnl)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">No pairs data.</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
