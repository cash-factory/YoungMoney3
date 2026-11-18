import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useAllTestTrades, useTestSessions, useTrades, useTradingAccounts } from '@/hooks/useData';
import { useMt5Lifecycles } from '@/hooks/useMt5Lifecycles';
import { useDecisionReviews } from '@/hooks/useDecisionReviews';
import type { TradingAccount } from '@/lib/types';
import {
  entryFacts,
  outcomeFacts,
  referenceFor,
  replayTargets,
  reviewMoney,
  type ReplayTarget,
} from '@/lib/decisionReplay';
import { ReplayButton } from './DecisionReplay';

export function EvidenceList({
  targets,
  accounts,
  title,
}: {
  targets: ReplayTarget[];
  accounts: TradingAccount[];
  title: string;
}) {
  const [limit, setLimit] = useState(8);
  return (
    <details className="ym-review-ledger">
      <summary>
        {title} · {targets.length}
      </summary>
      {targets.length ? (
        <ul>
          {targets.slice(0, limit).map((t) => {
            const f = entryFacts(t),
              o = outcomeFacts(t, accounts),
              name = accounts.find((a) => a.id === f.account)?.name;
            return (
              <li key={referenceFor(t)}>
                <div>
                  <strong>{f.symbol}</strong> · {name || 'Unassigned account'}
                  <small className="block text-secondary">
                    {f.time?.slice(0, 10)} · {f.source} ·{' '}
                    {o.closed ? reviewMoney(o.amount, o.currency) : 'Open'}
                  </small>
                </div>
                <ReplayButton target={t} />
              </li>
            );
          })}
        </ul>
      ) : (
        <p>No matching decisions in this selection.</p>
      )}
      {targets.length > limit && (
        <button className="btn-secondary" onClick={() => setLimit((n) => n + 20)}>
          Show more decisions
        </button>
      )}
    </details>
  );
}
export function StrategyEvidence({ id, model, setup }: { id?: string; model?: string; setup?: string }) {
  const { user } = useAuth(),
    { trades } = useTrades(user?.id),
    { positions } = useMt5Lifecycles(user?.id),
    { accounts } = useTradingAccounts(user?.id);
  const { rows } = useDecisionReviews(user?.id),
    { sessions } = useTestSessions(user?.id),
    { trades: examples } = useAllTestTrades(user?.id);
  const annotations = new Map(rows.map((r) => [r.reference, r]));
  const chosen = replayTargets(trades, positions).filter((t) => {
    const r = annotations.get(referenceFor(t)),
      f = entryFacts(t);
    if (setup) return t.kind === 'trade' && t.trade.setup_id === setup;
    return (
      !!id &&
      (r?.strategy_id || f.strategyId) === id &&
      (!model || (r?.entry_model_id || f.modelId) === model)
    );
  });
  const relevant = examples.flatMap((t) => {
    const s = sessions.find((s) => s.id === t.session_id);
    if (!s) return [];
    if (
      setup
        ? (t.setup_id || s.setup_id) !== setup
        : !id || s.strategy_id !== id || (model && (t.entry_model_id || s.entry_model_id) !== model)
    )
      return [];
    return [{ t, s }];
  });
  return (
    <section className="card p-4 my-4">
      <h3 className="font-semibold">Decisions and practice</h3>
      <EvidenceList title="Recorded trades" targets={chosen} accounts={accounts} />
      {(['backtest', 'forward_test'] as const).map((mode) => {
        const group = relevant.filter((x) => x.s.test_type === mode);
        return (
          <details className="ym-decision-details" key={mode}>
            <summary>
              {mode === 'backtest' ? 'Backtest' : 'Forward test'} examples · {group.length}
            </summary>
            {group.length ? (
              group.map(({ t, s }) => (
                <p key={t.id}>
                  {s.name} · {s.instrument || 'Instrument unrecorded'} ·{' '}
                  {(t.entry_time || t.created_at).slice(0, 10)} · {t.outcome}
                </p>
              ))
            ) : (
              <p>No linked examples.</p>
            )}
          </details>
        );
      })}
    </section>
  );
}
