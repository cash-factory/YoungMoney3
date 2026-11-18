import { useMemo, useState } from 'react';
import { ArrowUpRight, BookOpen, Camera, CheckCircle2, Compass, Mic, Pin, PinOff } from 'lucide-react';
import { dateKeyInTimeZone } from '@/lib/riskMetrics';
import { useAuth } from '@/context/AuthContext';
import { useJournalEntries, useWeeklyReviews } from '@/hooks/useData';
import { useDecisionReviews } from '@/hooks/useDecisionReviews';
import type { Mt5PositionVersion } from '@/hooks/useMt5Lifecycles';
import type { Trade, TradingAccount } from '@/lib/types';
import {
  entryFacts,
  focusForDay,
  referenceFor,
  replayTargets,
  type ReplayTarget,
} from '@/lib/decisionReplay';
import { TradeReplay, SampleReplay } from './DecisionReplay';

export type FastCapture = 'manual' | 'photo' | 'voice' | 'pass';
interface DeskProps {
  trades: Trade[];
  positions: Mt5PositionVersion[];
  account: TradingAccount | null;
  onCapture: (mode: FastCapture) => void;
  openWeekly: () => void;
}
export function DecisionDesk({ trades, positions, account, onCapture, openWeekly }: DeskProps) {
  const { user } = useAuth(),
    { rows, error, loading, refresh } = useDecisionReviews(user?.id);
  const { reviews } = useWeeklyReviews(user?.id),
    { entries } = useJournalEntries(user?.id);
  const [target, setTarget] = useState<ReplayTarget | null>(null),
    [sample, setSample] = useState(false);
  const ordered = useMemo(() => replayTargets(trades, positions), [trades, positions]);
  const seen = new Set(rows.map((r) => r.reference));
  const queue = ordered.filter((t) => !seen.has(referenceFor(t)));
  const today =
    dateKeyInTimeZone(new Date(), account?.challenge_reset_timezone || 'UTC') ||
    new Date().toISOString().slice(0, 10);
  const focus = focusForDay(reviews, today, account?.id);
  const weekend = [0, 5, 6].includes(new Date(today + 'T12:00:00Z').getUTCDay());
  const passes = entries.filter(
    (e) =>
      e.decision_kind === 'pass' && e.entry_date === today && (!account || e.account_id === account.id)
  );
  const next = queue[0];
  return (
    <section className="ym-decision-desk" aria-label="Today’s decisions">
      <div className="ym-desk-main">
        <small>
          <Compass size={14} /> Today · {account?.name || 'All accounts'}
        </small>
        <h2>
          {next
            ? 'One decision to revisit'
            : focus
              ? 'Your focus for this session'
              : weekend
                ? 'Close the week'
                : 'Start your session'}
        </h2>
        {focus && <blockquote>{focus.focus_next_week}</blockquote>}
        {loading ? (
          <p role="status">Finding your latest decisions…</p>
        ) : error ? (
          <p role="alert">
            {error}{' '}
            <button className="btn-secondary" onClick={refresh}>
              Retry
            </button>
          </p>
        ) : next ? (
          <>
            <p>
              {entryFacts(next).symbol} · {entryFacts(next).source} ·{' '}
              {entryFacts(next).time.slice(0, 10)}
            </p>
            <button className="btn-primary" onClick={() => setTarget(next)}>
              Review this entry <ArrowUpRight size={16} />
            </button>
          </>
        ) : (
          <p>
            {weekend
              ? 'Choose a decision and carry one rule into next week.'
              : 'Record what you see, or explore a sample decision.'}
          </p>
        )}
        <div className="ym-desk-quick">
          <button onClick={() => onCapture('pass')}>
            <CheckCircle2 size={15} />I passed
          </button>
          <button onClick={() => onCapture('photo')}>
            <Camera size={15} />
            Screenshot
          </button>
          <button onClick={() => onCapture('voice')}>
            <Mic size={15} />
            Voice note
          </button>
        </div>
      </div>
      <aside>
        <h3>Session notebook</h3>
        <p>
          {queue.length} awaiting review · {passes.length} deliberate{' '}
          {passes.length === 1 ? 'pass' : 'passes'} today
        </p>
        <button className="btn-secondary" onClick={openWeekly}>
          <BookOpen size={15} />
          Weekly review
        </button>
        <button className="btn-ghost" onClick={() => setSample(true)}>
          Try a sample replay
        </button>
      </aside>
      {target && <TradeReplay target={target} onClose={() => setTarget(null)} />}{' '}
      {sample && <SampleReplay onClose={() => setSample(false)} />}
    </section>
  );
}
export function PerformancePin({ pinned, onChange }: { pinned: boolean; onChange: () => void }) {
  const Icon = pinned ? PinOff : Pin;
  return (
    <button aria-pressed={pinned} className="btn-ghost ym-default-view" onClick={onChange}>
      <Icon size={14} />
      {pinned ? 'Performance opens first' : 'Pin Performance as opening view'}
    </button>
  );
}
