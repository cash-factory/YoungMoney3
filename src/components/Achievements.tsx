import { useMemo } from 'react';
import { Trophy, Flame, Target, TrendingUp, Star, Zap, Award, CheckCircle2, Lock } from 'lucide-react';
import type { Trade } from '@/lib/types';
import { computeDashboardStats, groupByPair } from '@/lib/utils';

interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: typeof Trophy;
  unlocked: boolean;
  progress?: number;
  max?: number;
  color: string;
}

export function Achievements({ trades }: { trades: Trade[] }) {
  const stats = useMemo(() => computeDashboardStats(trades), [trades]);
  const pairData = useMemo(() => groupByPair(trades), [trades]);

  const achievements = useMemo<Achievement[]>(() => {
    return [
      {
        id: 'first-trade',
        title: 'First Steps',
        description: 'Log your first trade',
        icon: CheckCircle2,
        unlocked: trades.length >= 1,
        color: 'text-brand-500',
      },
      {
        id: 'ten-trades',
        title: 'Getting Serious',
        description: 'Log 10 trades',
        icon: Zap,
        unlocked: trades.length >= 10,
        progress: Math.min(trades.length, 10),
        max: 10,
        color: 'text-accent-500',
      },
      {
        id: 'fifty-trades',
        title: 'Dedicated Journaler',
        description: 'Log 50 trades',
        icon: Award,
        unlocked: trades.length >= 50,
        progress: Math.min(trades.length, 50),
        max: 50,
        color: 'text-brand-500',
      },
      {
        id: 'win-streak-3',
        title: 'Hot Hand',
        description: 'Win 3 trades in a row',
        icon: Flame,
        unlocked: stats.maxConsecutiveWins >= 3,
        progress: Math.min(stats.maxConsecutiveWins, 3),
        max: 3,
        color: 'text-success-500',
      },
      {
        id: 'win-streak-5',
        title: 'On Fire',
        description: 'Win 5 trades in a row',
        icon: Flame,
        unlocked: stats.maxConsecutiveWins >= 5,
        progress: Math.min(stats.maxConsecutiveWins, 5),
        max: 5,
        color: 'text-error-500',
      },
      {
        id: 'profitable',
        title: 'In The Green',
        description: 'Achieve positive net P&L',
        icon: TrendingUp,
        unlocked: stats.totalPnl > 0,
        color: 'text-success-500',
      },
      {
        id: 'win-rate-60',
        title: 'Sharp Shooter',
        description: 'Reach 60% win rate (min 10 trades)',
        icon: Target,
        unlocked: stats.winRate >= 60 && trades.length >= 10,
        progress: Math.min(Math.round(stats.winRate), 60),
        max: 60,
        color: 'text-accent-500',
      },
      {
        id: 'profit-factor-2',
        title: 'Risk Manager',
        description: 'Achieve profit factor above 2.0',
        icon: Star,
        unlocked: stats.profitFactor >= 2 && stats.profitFactor !== Infinity,
        progress: Math.min(Math.round(stats.profitFactor * 10) / 10, 2),
        max: 2,
        color: 'text-brand-500',
      },
      {
        id: 'five-pairs',
        title: 'Diversified',
        description: 'Trade 5 different currency pairs',
        icon: Trophy,
        unlocked: pairData.length >= 5,
        progress: Math.min(pairData.length, 5),
        max: 5,
        color: 'text-accent-500',
      },
      {
        id: 'comeback',
        title: 'Comeback Kid',
        description: 'Win a trade after a 3+ losing streak',
        icon: TrendingUp,
        unlocked: checkComeback(trades),
        color: 'text-success-500',
      },
      {
        id: 'screenshot',
        title: 'Visual Journaler',
        description: 'Attach a screenshot to a trade',
        icon: Award,
        unlocked: trades.some(t => t.screenshot_url),
        color: 'text-brand-500',
      },
      {
        id: 'voice-note',
        title: 'Voice Memo',
        description: 'Record a voice note on a trade',
        icon: Zap,
        unlocked: trades.some(t => t.voice_note_url),
        color: 'text-accent-500',
      },
    ];
  }, [trades, stats, pairData]);

  const unlockedCount = achievements.filter(a => a.unlocked).length;

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Trophy size={16} className="text-accent-500" /> Achievements
        </h3>
        <span className="text-xs text-muted">{unlockedCount}/{achievements.length} unlocked</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {achievements.map(a => {
          const Icon = a.unlocked ? a.icon : Lock;
          return (
            <div
              key={a.id}
              className={`p-3 rounded-xl border text-center transition-all ${
                a.unlocked
                  ? 'bg-gradient-to-br from-accent-500/5 to-brand-500/5 border-accent-500/20 card-hover'
                  : 'bg-secondary border-themed opacity-60'
              }`}
            >
              <div className={`mx-auto w-fit p-2.5 rounded-full mb-2 ${a.unlocked ? 'bg-secondary' : 'bg-secondary'}`}>
                <Icon size={20} className={a.unlocked ? a.color : 'text-muted'} />
              </div>
              <p className="text-xs font-semibold">{a.title}</p>
              <p className="text-[10px] text-muted mt-0.5">{a.description}</p>
              {a.progress != null && a.max != null && !a.unlocked && (
                <div className="mt-2">
                  <div className="h-1 rounded-full bg-secondary overflow-hidden">
                    <div
                      className="h-full rounded-full bg-brand-500 transition-all"
                      style={{ width: `${(a.progress / a.max!) * 100}%` }}
                    />
                  </div>
                  <p className="text-[9px] text-muted mt-1">{a.progress}/{a.max}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function checkComeback(trades: Trade[]): boolean {
  const sorted = [...trades].sort((a, b) => new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime());
  let lossStreak = 0;
  for (const t of sorted) {
    if (t.outcome === 'loss') {
      lossStreak++;
    } else if (t.outcome === 'win') {
      if (lossStreak >= 3) return true;
      lossStreak = 0;
    } else {
      lossStreak = 0;
    }
  }
  return false;
}
