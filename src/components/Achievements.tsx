import { useState } from 'react';
import '@/dashboard-studio.css';
import { Trophy, BookOpen, Compass, Flag, Mic, Award, CheckCircle2, Lock } from 'lucide-react';
import type { Trade } from '@/lib/types';
import { useDecisionReviews } from '@/hooks/useDecisionReviews';
import { useAuth } from '@/context/AuthContext';
import { useJournalEntries } from '@/hooks/useData';

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
  const { user } = useAuth();
  const { rows } = useDecisionReviews(user?.id);
  const { entries } = useJournalEntries(user?.id);
  const achievements: Achievement[] = [
    {
      id: 'review',
      title: 'Second look',
      description: 'Review the reasoning behind a decision.',
      icon: BookOpen,
      unlocked: rows.length > 0,
      color: 'text-brand-500',
    },
    {
      id: 'pass',
      title: 'A deliberate pass',
      description: 'Record why you chose to wait.',
      icon: CheckCircle2,
      unlocked: entries.some((e) => e.decision_kind === 'pass'),
      color: 'text-brand-500',
    },
    {
      id: 'change',
      title: 'Changed my mind',
      description: 'Reflect on a change of plan.',
      icon: Compass,
      unlocked: rows.some((r) => r.verdict === 'changed'),
      color: 'text-accent-500',
    },
    {
      id: 'commitment',
      title: 'Follow-through',
      description: 'Revisit the rule you carried into this week.',
      icon: Flag,
      unlocked: rows.some((r) => r.commitment_result),
      color: 'text-brand-500',
    },
    {
      id: 'chart',
      title: 'Chart notes',
      description: 'Attach a chart to a decision.',
      icon: Award,
      unlocked:
        rows.some((r) => r.screenshot_url) ||
        trades.some((t) => t.entry_screenshot_url || t.screenshot_url),
      color: 'text-brand-500',
    },
    {
      id: 'voice',
      title: 'In your own words',
      description: 'Record a voice reflection.',
      icon: Mic,
      unlocked:
        rows.some((r) => r.voice_note_url) ||
        trades.some((t) => t.voice_note_url || t.entry_voice_note_url),
      color: 'text-accent-500',
    },
  ];

  const unlockedCount = achievements.filter((a) => a.unlocked).length;

  const ordered = [...achievements].sort((a, b) => Number(b.unlocked) - Number(a.unlocked));
  const visible = showAll ? ordered : ordered.slice(0, 4);

  return (
    <section className="card p-5 ym-achievements" aria-labelledby="achievements-title">
      <div className="ym-achievements-heading">
        <div>
          <p className="ym-dash-kicker">YOUR MILESTONES</p>
          <h3 id="achievements-title">
            <Trophy size={18} /> Achievements
          </h3>
        </div>
        <span className="ym-achievements-count">
          <strong>{unlockedCount}</strong> / {achievements.length}
        </span>
      </div>
      <div
        className="ym-achievements-overall"
        role="progressbar"
        aria-label="Achievements unlocked"
        aria-valuenow={unlockedCount}
        aria-valuemin={0}
        aria-valuemax={achievements.length}
      >
        <span style={{ width: `${(unlockedCount / achievements.length) * 100}%` }} />
      </div>
      <p className="ym-achievements-caption">A record of your practice, progress and consistency.</p>
      <ul className="ym-achievement-list" id="achievement-list">
        {visible.map((a) => {
          const Icon = a.unlocked ? a.icon : Lock;
          return (
            <li key={a.id} className="ym-achievement" data-unlocked={a.unlocked}>
              <span className="ym-achievement-icon">
                <Icon size={20} className={a.unlocked ? a.color : 'text-muted'} />
              </span>
              <div className="ym-achievement-copy">
                <div className="ym-achievement-title">
                  <strong>{a.title}</strong>
                  {a.unlocked && <CheckCircle2 size={14} aria-label="Unlocked" />}
                </div>
                <p>{a.description}</p>
                {a.progress != null && a.max != null && !a.unlocked && (
                  <div className="ym-achievement-progress">
                    <div
                      role="progressbar"
                      aria-label={a.title}
                      aria-valuenow={a.progress}
                      aria-valuemin={0}
                      aria-valuemax={a.max}
                    >
                      <span style={{ width: `${Math.min(100, (a.progress / a.max) * 100)}%` }} />
                    </div>
                    <span>
                      {a.progress} / {a.max}
                    </span>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        className="ym-achievements-toggle"
        aria-expanded={showAll}
        aria-controls="achievement-list"
        onClick={() => setShowAll((value) => !value)}
      >
        {showAll ? 'Show fewer milestones' : `View all ${achievements.length} milestones`}{' '}
        <span aria-hidden="true">{showAll ? '−' : '+'}</span>
      </button>
    </section>
  );
}
