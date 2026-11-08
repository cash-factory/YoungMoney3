import { useMemo } from 'react';
import { Brain, Smile, Frown, Meh, Zap, AlertCircle } from 'lucide-react';
import type { Trade } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';

const EMOTION_META: Record<string, { label: string; color: string; bg: string; icon: typeof Smile }> = {
  calm: { label: 'Calm', color: 'text-brand-500', bg: 'bg-brand-500/10', icon: Smile },
  confident: { label: 'Confident', color: 'text-success-500', bg: 'bg-success-500/10', icon: Smile },
  focused: { label: 'Focused', color: 'text-brand-500', bg: 'bg-brand-500/10', icon: Smile },
  rushed: { label: 'Rushed', color: 'text-warning-500', bg: 'bg-warning-500/10', icon: Zap },
  frustrated: { label: 'Frustrated', color: 'text-error-500', bg: 'bg-error-500/10', icon: Frown },
  anxious: { label: 'Anxious', color: 'text-warning-500', bg: 'bg-warning-500/10', icon: Meh },
  greedy: { label: 'Greedy', color: 'text-accent-500', bg: 'bg-accent-500/10', icon: AlertCircle },
  fearful: { label: 'Fearful', color: 'text-error-500', bg: 'bg-error-500/10', icon: Frown },
};

export function MoodTracker({ trades }: { trades: Trade[] }) {
  const moodData = useMemo(() => {
    const map = new Map<string, { count: number; pnl: number; wins: number }>();
    trades.forEach(t => {
      if (!t.emotional_state) return;
      const ex = map.get(t.emotional_state) || { count: 0, pnl: 0, wins: 0 };
      ex.count++;
      ex.pnl += t.pnl;
      if (t.outcome === 'win') ex.wins++;
      map.set(t.emotional_state, ex);
    });
    return Array.from(map.entries())
      .map(([emotion, v]) => ({
        emotion,
        ...v,
        winRate: v.count ? (v.wins / v.count) * 100 : 0,
        avgPnl: v.count ? v.pnl / v.count : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }, [trades]);

  const maxCount = Math.max(...moodData.map(m => m.count), 1);

  if (moodData.length === 0) {
    return (
      <div className="card p-5">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Brain size={16} className="text-brand-500" /> Emotional State Tracker
        </h3>
        <p className="text-sm text-muted text-center py-8">Tag your trades with an emotional state to see how your mood affects your performance.</p>
      </div>
    );
  }

  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
        <Brain size={16} className="text-brand-500" /> Emotional State Tracker
      </h3>
      <p className="text-xs text-muted mb-4">How your emotions correlate with your trading results</p>
      <div className="space-y-3">
        {moodData.map(m => {
          const meta = EMOTION_META[m.emotion] || EMOTION_META.calm;
          const Icon = meta.icon;
          const barWidth = (m.count / maxCount) * 100;
          const isPositive = m.pnl >= 0;

          return (
            <div key={m.emotion} className="group">
              <div className="flex items-center gap-3 mb-1">
                <div className={`p-1.5 rounded-lg ${meta.bg}`}>
                  <Icon size={14} className={meta.color} />
                </div>
                <span className="text-sm font-medium">{meta.label}</span>
                <span className="text-xs text-muted">{m.count} trades</span>
                <span className="text-xs text-muted ml-auto">{m.winRate.toFixed(0)}% WR</span>
                <span className={`text-sm font-mono font-semibold ${isPositive ? 'text-success-500' : 'text-error-500'}`}>
                  {formatCurrency(m.pnl)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${isPositive ? 'bg-success-500' : 'bg-error-500'}`}
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
                <span className="text-[10px] text-muted w-16 text-right">
                  {isPositive ? '+' : ''}{formatCurrency(m.avgPnl)}/trade
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
