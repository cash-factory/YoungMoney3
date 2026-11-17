import { useMemo, useState } from 'react';
import '@/dashboard-studio.css';
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
  const [showAll, setShowAll] = useState(false);
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
        unlocked: trades.some(t => t.screenshot_url || t.entry_screenshot_url || t.closure_screenshot_url),
        color: 'text-brand-500',
      },
      {
        id: 'voice-note',
        title: 'Voice Memo',
        description: 'Record a voice note on a trade',
        icon: Zap,
        unlocked: trades.some(t => t.voice_note_url || t.entry_voice_note_url || t.closure_voice_note_url),
        color: 'text-accent-500',
      },
    ];
  }, [trades, stats, pairData]);

  const unlockedCount = achievements.filter(a => a.unlocked).length;

  const ordered = [...achievements].sort((a, b) => Number(b.unlocked) - Number(a.unlocked));
  const visible = showAll ? ordered : ordered.slice(0, 4);

  return (
    <section className="card p-5 ym-achievements" aria-labelledby="achievements-title">
      <div className="ym-achievements-heading">
        <div><p className="ym-dash-kicker">YOUR MILESTONES</p><h3 id="achievements-title"><Trophy size={18} /> Achievements</h3></div>
        <span className="ym-achievements-count"><strong>{unlockedCount}</strong> / {achievements.length}</span>
      </div>
      <div className="ym-achievements-overall" role="progressbar" aria-label="Achievements unlocked"
        aria-valuenow={unlockedCount} aria-valuemin={0} aria-valuemax={achievements.length}>
        <span style={{ width: `${unlockedCount / achievements.length * 100}%` }} />
      </div>
      <p className="ym-achievements-caption">A record of your practice, progress and consistency.</p>
      <ul className="ym-achievement-list" id="achievement-list">
        {visible.map(a => {
          const Icon = a.unlocked ? a.icon : Lock;
          return (
            <li key={a.id} className="ym-achievement" data-unlocked={a.unlocked}>
              <span className="ym-achievement-icon"><Icon size={20} className={a.unlocked ? a.color : 'text-muted'} /></span>
              <div className="ym-achievement-copy">
                <div className="ym-achievement-title"><strong>{a.title}</strong>{a.unlocked && <CheckCircle2 size={14} aria-label="Unlocked" />}</div>
                <p>{a.description}</p>
                {a.progress != null && a.max != null && !a.unlocked && (
                  <div className="ym-achievement-progress">
                    <div role="progressbar" aria-label={a.title} aria-valuenow={a.progress} aria-valuemin={0} aria-valuemax={a.max}>
                      <span style={{ width: `${Math.min(100, a.progress / a.max * 100)}%` }} />
                    </div>
                    <span>{a.progress} / {a.max}</span>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <button type="button" className="ym-achievements-toggle" aria-expanded={showAll} aria-controls="achievement-list"
        onClick={() => setShowAll(value => !value)}>{showAll ? 'Show fewer milestones' : `View all ${achievements.length} milestones`} <span aria-hidden="true">{showAll ? '−' : '+'}</span></button>
    </section>
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
