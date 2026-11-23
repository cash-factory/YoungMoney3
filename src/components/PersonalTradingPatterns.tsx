import { useMemo, useState, type ReactNode } from 'react';
import { Activity, ArrowUpRight, BookOpenCheck, Brain, CalendarRange, CircleHelp, Compass,
  LockKeyhole, RefreshCw, ShieldCheck, TrendingUp } from 'lucide-react';
import type { Trade } from '@/lib/types';
import { useDecisionReviews } from '@/hooks/useDecisionReviews';
import { buildTradingPatterns, type PatternCategory, type PatternMetric, type PatternWindow } from '@/lib/tradingPatterns';
import '@/personal-patterns.css';

interface Props {
  owner: string | null | undefined;
  trades: Trade[];
  accountId: string;
  accountName?: string;
  onReview: () => void;
  onOpenLab: () => void;
}
function EvidenceNumber({ measure, suffix = '%' }: { measure: PatternMetric; suffix?: string }) {
  return <strong className="ym-pattern-number" aria-label={measure.sufficient
    ? measure.rate?.toFixed(1) + ' percent'
    : 'Insufficient observations'}>
    {measure.sufficient && measure.rate !== null ? measure.rate.toFixed(1) + suffix : '—'}
  </strong>;
}
function MetricCard({ icon, label, measure, note }: {
  icon: ReactNode; label: string; measure: PatternMetric; note: string;
}) {
  return <article className="ym-pattern-metric">
    <div className="ym-pattern-metric-header"><span className="ym-pattern-metric-icon" aria-hidden="true">{icon}</span>
      <small>{label}</small></div>
    <EvidenceNumber measure={measure}/>
    <p className="ym-pattern-count">{measure.numerator} of {measure.denominator} eligible observations</p>
    <p className="ym-pattern-proof" data-ready={measure.sufficient}>
      {measure.sufficient ? 'Descriptive sample · not causal proof' : 'Insufficient sample · fewer than 12 observations'}
    </p>
    <p className="ym-pattern-subnote">{note}</p>
  </article>;
}
function RankedEvidence({ title, description, rows, empty }: {
  title: string; description: string; rows: PatternCategory[]; empty: string;
}) {
  return <section className="ym-pattern-ranked" aria-label={title}>
    <div className="ym-pattern-ranked-heading"><h3>{title}</h3><p>{description}</p></div>
    {rows.length === 0
      ? <p className="ym-pattern-ranked-empty">{empty}</p>
      : <ol>{rows.slice(0, 5).map(item => <li key={item.label}>
        <div className="ym-pattern-rank-label"><strong>{item.label}</strong><span>{item.count} {item.count === 1 ? 'record' : 'records'}</span></div>
        <div className="ym-pattern-rank-track" role="img" aria-label={item.label + ', ' + item.count + ' records'}>
          <span style={{ width: item.share + '%' }}/>
        </div>
      </li>)}</ol>
    }
  </section>;
}

export function PersonalTradingPatterns({ owner, trades, accountId, accountName, onReview, onOpenLab }: Props) {
  const [window, setWindow] = useState<PatternWindow>('90d');
  const { rows, loading, error, refresh } = useDecisionReviews(owner);
  const report = useMemo(() => buildTradingPatterns(trades, rows, {
    accountId, window, minimum: 12,
  }), [trades, rows, accountId, window]);

  return <section className="ym-personal-patterns" id="ym-personal-patterns" aria-label="Personal trading patterns" tabIndex={-1}>
    <header className="ym-pattern-heading">
      <div className="ym-pattern-heading-copy">
        <p className="ym-pattern-kicker"><Brain size={15}/> YOUR PRACTICE / REFLECTIVE PATTERNS</p>
        <h2>Understand the process behind your decisions.</h2>
        <p>Evidence from your own trade reviews and opening-time records. No personality scoring, emotional diagnosis or predictive promises.</p>
        <div className="ym-pattern-context"><LockKeyhole size={13}/>
          {accountId === 'all' ? 'All accounts' : accountName || 'Selected account'}
          <span aria-hidden="true">·</span> Personal evidence
        </div>
      </div>
      <div className="ym-pattern-heading-actions">
        <label htmlFor="ym-pattern-window"><CalendarRange size={14}/> Time window</label>
        <select id="ym-pattern-window" className="input-field" value={window}
          onChange={e => setWindow(e.target.value as PatternWindow)}>
          <option value="90d">Last 90 days</option>
          <option value="all">All available history</option>
        </select>
        <button type="button" className="ym-pattern-refresh" aria-label="Refresh personal trading patterns"
          onClick={refresh}><RefreshCw size={17}/></button>
      </div>
    </header>
    {error && <div className="ym-pattern-error" role="alert">Decision review evidence is temporarily unavailable. <span>{error}</span>
      <button type="button" className="btn-secondary" onClick={refresh}>Retry</button></div>}
    {loading ? <div className="ym-pattern-loading" role="status">Reading your documented decision history…</div> : (
      <>
        <div className="ym-pattern-summary">
          <div><small>Reviewed decisions</small><strong>{report.reviewed}</strong></div>
          <div><small>Pre-reveal judgements</small><strong>{report.preReveal}</strong></div>
          <div><small>Retrospective reviews</small><strong>{report.retrospective}</strong></div>
          <div><small>Uncertain assessments</small><strong>{report.unknown}</strong></div>
        </div>
        {report.reviewed === 0 && <div className="ym-pattern-onboarding" role="status">
          <Compass size={25} aria-hidden="true"/>
          <div><h3>No review evidence for this selection</h3>
            <p>Complete a Decision Replay to begin seeing documented patterns. The dashboard won't invent a profile from account P&amp;L alone.</p></div>
          <button type="button" className="btn-secondary" onClick={onReview}>Review a decision <ArrowUpRight size={15}/></button>
        </div>}
        <div className="ym-pattern-metrics" aria-label="Documented behavioral measures">
          <MetricCard label="Reported plan adherence" icon={<BookOpenCheck size={18}/>}
            measure={report.plan} note="From recorded replay judgements, not automated strategy verification."/>
          <MetricCard label="Opening checklist completion" icon={<ShieldCheck size={18}/>}
            measure={report.checklist} note="Only immutable checklists captured at a live manual entry."/>
          <MetricCard label="After a documented loss" icon={<Activity size={18}/>}
            measure={report.afterLoss} note="Same-account, reviewed manual entries within 24 hours of a recorded loss."/>
        </div>
        <div className="ym-pattern-panels">
          <section className="ym-pattern-timeline">
            <div className="ym-pattern-ranked-heading"><h3>Consistency over time</h3>
              <p>Weekly recorded judgements. A bar only appears when at least three decisions in the week have a usable verdict.</p>
            </div>
            <div className="ym-pattern-week-list" role="list" aria-label="Weekly plan adherence observations">
              {report.weeks.length ? report.weeks.map(week => {
                const amount = week.followed + week.changed;
                return <div role="listitem" className="ym-pattern-week" key={week.start}>
                  <time dateTime={week.start}>{week.start}</time>
                  <div className="ym-pattern-week-track" role="img" aria-label={week.rate === null
                    ? 'Not enough weekly decisions' : week.rate.toFixed(1) + ' percent reported adherence'}>
                    {week.rate !== null && <span style={{ width: week.rate + '%' }}/>}
                  </div>
                  <strong>{week.rate === null ? '—' : week.rate.toFixed(0) + '%'}</strong>
                  <small>{amount} assessed</small>
                </div>;
              }) : <p className="ym-pattern-ranked-empty">There are no dated reviews in this time window.</p>}
            </div>
          </section>
          <div className="ym-pattern-ranked-stack">
            <RankedEvidence title="Most documented setups"
              description="How often a strategy or entry model was named during reviews, not a ranking of profitability."
              rows={report.setups} empty="Add a strategy or entry model when reviewing your trades."/>
            <RankedEvidence title="Documented action triggers"
              description="Your stated reasons for acting, recorded in Decision Replay."
              rows={report.triggers} empty="Reasons will appear as decisions are reviewed."/>
          </div>
        </div>
        <div className="ym-pattern-footer-panels">
          <RankedEvidence title="Self-reported emotional states"
            description="Only emotional labels voluntarily entered in manual trade records; their timing is not inferred."
            rows={report.emotions} empty="No voluntary emotion labels were recorded in this selection."/>
          <div className="ym-pattern-next">
            <p className="ym-pattern-kicker"><TrendingUp size={14}/> A NEXT STEP, NOT A DIAGNOSIS</p>
            <h3>Turn one observation into an experiment.</h3>
            <p>Choose a behavior you can define and observe. The Improvement Laboratory registers the hypothesis before you compare results.</p>
            <div><button type="button" className="btn-primary" onClick={onOpenLab}>Open Improvement Laboratory <ArrowUpRight size={16}/></button>
              <button type="button" className="btn-ghost" onClick={onReview}>Review decisions</button></div>
          </div>
        </div>
        <details className="ym-pattern-method">
          <summary><CircleHelp size={16}/> Evidence quality &amp; methodology</summary>
          <ul>{report.limitations.map(line => <li key={line}>{line}</li>)}</ul>
          <p>Reports are calculated within your authenticated workspace. Denominators and missing data are displayed. A minimum of 12 usable observations is required to display aggregate percentage cards; even then, these remain descriptive estimates. Dates and weekly groupings use UTC. Broker fill rows are not merged into manual opening-time checklist evidence.</p>
        </details>
      </>
    )}
  </section>;
}
