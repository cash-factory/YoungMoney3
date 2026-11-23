import { useEffect, useState } from 'react';
import { dateKeyInTimeZone } from '@/lib/riskMetrics';
import {
  BookOpenCheck,
  Check,
  CircleHelp,
  Clock3,
  Eye,
  Flag,
  Play,
  RotateCcw,
  Save,
  FlaskConical,
  ArrowRight,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  useStrategies,
  useStrategyEntryModels,
  useTradingAccounts,
  useWeeklyReviews,
} from '@/hooks/useData';
import { useDecisionReviews, saveDecision } from '@/hooks/useDecisionReviews';
import {
  EMPTY_RULES,
  entryFacts,
  evaluateEntry,
  focusForDay,
  outcomeFacts,
  referenceFor,
  reviewMoney,
  type DecisionReview,
  type Finding,
  type HistoricalRules,
  type ReplayTarget,
  type Verdict,
} from '@/lib/decisionReplay';
import { Modal } from './ui/Modal';
import { MediaAudioPlayer, MediaImage } from './MediaPreview';
import { VoiceRecorder } from './VoiceRecorder';
import { ScreenshotUpload } from './ScreenshotUpload';

export function ReplayButton({ target }: { target: ReplayTarget }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn-secondary ym-replay-button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Play size={14} />
        Decision replay
      </button>
      {open && <TradeReplay target={target} onClose={() => setOpen(false)} />}
    </>
  );
}
const choices: [Verdict, string][] = [
  ['followed', 'Followed my plan'],
  ['changed', 'Changed course'],
  ['unsure', 'Unsure'],
];
function Choices({
  value,
  onChange,
  label,
}: {
  value: Verdict | null;
  onChange: (v: Verdict) => void;
  label: string;
}) {
  return (
    <fieldset className="ym-decision-choices">
      <legend>{label}</legend>
      <div>
        {choices.map(([id, text]) => (
          <button type="button" key={id} aria-pressed={value === id} onClick={() => onChange(id)}>
            {text}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
function Findings({ rows }: { rows: Finding[] }) {
  return (
    <section className="ym-findings" aria-label="Automatic decision review">
      {(
        [
          ['met', 'What held up', Check],
          ['missed', 'What went off plan', Flag],
          ['unknown', 'Still unclear', CircleHelp],
        ] as const
      ).map(([state, label, Icon]) => {
        const findings = rows.filter((r) => r.state === state);
        return findings.length ? (
          <div key={state} data-state={state}>
            <h3>
              <Icon size={16} />
              {label}
            </h3>
            <ul>
              {findings.map((item, i) => (
                <li key={i}>
                  <strong>{item.label}</strong>
                  <span>{item.evidence}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null;
      })}
    </section>
  );
}
export function SampleReplay({ onClose }: { onClose: () => void }) {
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [show, setShow] = useState(false);
  return (
    <Modal open title="Decision replay" onClose={onClose}>
      <div className="ym-replay-body">
        <header>
          <small>Example trade · EUR/USD · ZAR account</small>
          <h3>Would you take this entry again?</h3>
        </header>
        <blockquote>“I’ll wait for the 09:15 candle to close before I enter.”</blockquote>
        <p className="ym-entry-fill">
          <Clock3 size={17} />
          09:12 UTC · Buy order filled
        </p>
        <Choices
          value={verdict}
          onChange={setVerdict}
          label="How did the entry compare with the rule?"
        />
        <button
          type="button"
          className="btn-primary"
          aria-expanded={show}
          disabled={!verdict && !show}
          onClick={() => setShow(!show)}
        >
          <Eye size={16} />
          {show ? 'Hide outcome' : 'Reveal outcome'}
        </button>
        {!verdict && !show && <p className="ym-replay-guidance">Choose your judgement before seeing the example outcome.</p>}
        {show && (
          <div aria-live="polite">
            <Findings
              rows={[
                {
                  state: 'met',
                  label: 'Protective stop',
                  evidence: 'The opening order included the planned protective stop.',
                },
                {
                  state: 'missed',
                  label: 'Entry time',
                  evidence: 'The fill came three minutes before the 09:15 UTC rule.',
                },
              ]}
            />
            <p className="ym-entry-fill">Net result +160.00 ZAR · +0.8R on 200.00 ZAR initial risk.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
export function TradeReplay({ target, onClose }: { target: ReplayTarget; onClose: () => void }) {
  const { user } = useAuth();
  const { rows, loading, error, refresh } = useDecisionReviews(user?.id);
  const previous = rows.find((r) => r.reference === referenceFor(target));
  return (
    <Modal open title="Decision replay" onClose={onClose}>
      {error ? (
        <p role="alert">
          {error}{' '}
          <button className="btn-secondary" onClick={refresh}>
            Retry
          </button>
        </p>
      ) : loading ? (
        <p role="status">Opening your decision…</p>
      ) : user ? (
        <ReplayForm
          key={referenceFor(target)}
          owner={user.id}
          target={target}
          previous={previous}
          onClose={onClose}
        />
      ) : null}
    </Modal>
  );
}
function ReplayForm({
  owner,
  target,
  previous,
  onClose,
}: {
  owner: string;
  target: ReplayTarget;
  previous?: DecisionReview;
  onClose: () => void;
}) {
  const facts = entryFacts(target),
    reference = referenceFor(target);
  const { strategies } = useStrategies(owner);
  const { accounts } = useTradingAccounts(owner);
  const { reviews } = useWeeklyReviews(owner);
  const draftKey = 'ymfx:replay-draft:' + owner + ':' + reference;
  const [draft] = useState(() => {
    try {
      const v = JSON.parse(sessionStorage.getItem(draftKey) || 'null');
      return v && v.revision === (previous?.updated_at || '') ? v : null;
    } catch {
      return null;
    }
  });
  const [strategy, setStrategy] = useState<string>(
    draft?.strategy ?? previous?.strategy_id ?? facts.strategyId ?? ''
  );
  const [model, setModel] = useState<string>(
    draft?.model ?? previous?.entry_model_id ?? facts.modelId ?? ''
  );
  const { models } = useStrategyEntryModels(strategy || null);
  const [verdict, setVerdict] = useState<Verdict | null>(draft?.verdict ?? previous?.verdict ?? null);
  const [trigger, setTrigger] = useState<string>(draft?.trigger ?? previous?.trigger ?? '');
  const [note, setNote] = useState<string>(draft?.note ?? previous?.note ?? '');
  const [voice, setVoice] = useState<string | null>(draft?.voice ?? previous?.voice_note_url ?? null);
  const [image, setImage] = useState<string | null>(draft?.image ?? previous?.screenshot_url ?? null);
  const [show, setShow] = useState(false),
    [savedReview, setSavedReview] = useState<DecisionReview | undefined>(previous),
    [postOutcomeNote, setPostOutcomeNote] = useState<string>(draft?.postOutcomeNote ?? previous?.post_outcome_note ?? ''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [rules, setRules] = useState<HistoricalRules>(EMPTY_RULES),
    [ruleState, setRuleState] = useState('loading'),
    [retry, setRetry] = useState(0);
  const account = accounts.find((a) => a.id === facts.account);
  const entryDay = facts.clock && dateKeyInTimeZone(facts.time, account?.challenge_reset_timezone || 'UTC');
  const focus = entryDay ? focusForDay(reviews, entryDay, facts.account) : undefined;
  const focusText = previous?.commitment_text || focus?.focus_next_week || '';
  const [commitment, setCommitment] = useState<Verdict | null>(
    draft?.commitment ?? previous?.commitment_result ?? null
  );
  useEffect(() => {
    try {
      sessionStorage.setItem(
        draftKey,
        JSON.stringify({
          revision: previous?.updated_at || '',
          strategy,
          model,
          verdict,
          trigger,
          note,
          voice,
          image,
          commitment,
          postOutcomeNote,
        })
      );
    } catch {
      /* storage may be disabled */
    }
  }, [
    draftKey,
    previous?.updated_at,
    strategy,
    model,
    verdict,
    trigger,
    note,
    voice,
    image,
    commitment,
    postOutcomeNote,
  ]);
  useEffect(() => {
    const controller = new AbortController();
    setRules(EMPTY_RULES);
    setRuleState('loading');
    void fetch('/api/decision/context', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reference, strategy_id: strategy, entry_model_id: model }),
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const v = await r.json();
        if (!controller.signal.aborted) {
          setRules(v);
          setRuleState('ready');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setRuleState('error');
      });
    return () => controller.abort();
  }, [reference, strategy, model, retry]);
  const result = outcomeFacts(target, accounts),
    selected = strategies.find((s) => s.id === strategy),
    selectedModel = models.find((m) => m.id === model && m.strategy_id === strategy);
  const reviewRecord = (lockBeforeReveal: boolean): Omit<DecisionReview, 'id' | 'updated_at'> => ({
    reference,
    symbol: facts.symbol,
    account_id: facts.account,
    entry_time: facts.time,
    strategy_id: strategy || null,
    entry_model_id: model || null,
    strategy_name: selected?.name || rules.strategy ||
      (previous?.strategy_id === strategy ? previous.strategy_name : '') || '',
    model_name: selectedModel?.name || rules.model ||
      (previous?.entry_model_id === model ? previous.model_name : '') || '',
    verdict,
    trigger,
    note: note.trim(),
    voice_note_url: voice,
    screenshot_url: image,
    commitment_id: savedReview?.commitment_id || focus?.id || null,
    commitment_text: focusText,
    commitment_result: focusText ? commitment : null,
    post_outcome_note: show ? postOutcomeNote.trim() : savedReview?.post_outcome_note ?? null,
    ...(lockBeforeReveal && !savedReview && verdict ? { pre_reveal_verdict: verdict } : {}),
  });
  const persist = async (lockBeforeReveal: boolean) => {
    const saved = await saveDecision(owner, reviewRecord(lockBeforeReveal), savedReview);
    setSavedReview(saved);
    return saved;
  };
  const reveal = async () => {
    if (show) { setShow(false); return; }
    if (savedReview) { setShow(true); return; }
    if (!verdict) { setError('Choose your judgement before revealing the result.'); return; }
    setBusy(true);
    setError('');
    try {
      // The first pre-reveal judgement is written before outcomes or broker history are shown.
      await persist(true);
      setShow(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not record the pre-reveal judgement.');
    } finally { setBusy(false); }
  };
  const continueInLab = async () => {
    if (!show) return;
    setBusy(true);
    setError('');
    try {
      await persist(false);
      sessionStorage.setItem('ymfx:lab-intent:v1:' + owner, JSON.stringify({
        strategy_id: strategy || null,
        account_id: facts.account,
        symbol: facts.symbol,
      }));
      onClose();
      window.location.hash = 'strategy-testing';
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this review before opening the laboratory.');
    } finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await persist(!savedReview && !show && Boolean(verdict));
      try { sessionStorage.removeItem(draftKey); } catch { /* optional storage */ }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save review.');
    } finally { setBusy(false); }
  };
  return (
    <div className="ym-replay-body ym-replay-v2" data-stage={show ? 'debrief' : 'assessment'}>
      <ol className="ym-replay-progress" aria-label="Decision review stages">
        <li data-current={!show}>01 / Examine entry</li>
        <li data-current={!show}>02 / Record judgement</li>
        <li data-current={show}>03 / Compare outcome</li>
      </ol>
      <div className="ym-replay-guidance" role="note">
        {show ? 'Outcome revealed · compare your original judgement with the evidence.' : 'Outcome hidden · examine the original information before judging your decision.'}
      </div>
      <header>
        <small>
          {facts.source} · {account?.name || 'Journal'} ·{' '}
          {facts.clock ? 'UTC' : 'Broker clock unconfirmed'}
        </small>
        <h3>
          {facts.symbol} <span>{facts.direction === 'long' ? 'Buy' : 'Sell'}</span>
        </h3>
        <p className="text-secondary">
          {facts.time?.replace('T', ' ').slice(0, 19)} · Entry {facts.price ?? 'unavailable'}
        </p>
      </header>
      {facts.note && <blockquote>{facts.note}</blockquote>}
      {facts.image && <MediaImage source={facts.image} alt="Original entry capture" />}
      {facts.voice && <MediaAudioPlayer source={facts.voice} />}
      <div className="ym-replay-fields">
        <label>
          Which strategy did you use?
          <select
            className="input-field"
            aria-label="Which strategy did you use?"
            value={strategy}
            onChange={(e) => {
              setStrategy(e.target.value);
              setModel('');
            }}
          >
            <option value="">Unspecified</option>
            {strategy && !selected && (
              <option value={strategy}>
                {previous?.strategy_name || rules.strategy || 'Recorded strategy'}
              </option>
            )}
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Entry model
          <select
            className="input-field"
            aria-label="Entry model"
            value={model}
            disabled={!strategy}
            onChange={(e) => setModel(e.target.value)}
          >
            <option value="">Unspecified</option>
            {model && !selectedModel && (
              <option value={model}>{previous?.model_name || rules.model || 'Recorded model'}</option>
            )}
            {models
              .filter((m) => m.strategy_id === strategy)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      {(strategy || model) && (
        <small>
          {facts.source === 'Manual entry capture' &&
          strategy === facts.strategyId &&
          (!model || model === facts.modelId)
            ? 'Strategy selection recorded at entry.'
            : 'Strategy selection identified during review.'}
        </small>
      )}
      {rules.criteria && <blockquote>{rules.criteria}</blockquote>}
      {rules.modelVersion && (
        <small>Playbook version from {rules.modelVersion.slice(0, 10)} · in effect at entry</small>
      )}
      <fieldset className="ym-decision-choices">
        <legend>What made you act?</legend>
        <div>
          {['My trigger fired', 'I felt rushed', 'The setup changed', 'Other'].map((reason) => (
            <button
              key={reason}
              type="button"
              aria-pressed={trigger === reason}
              onClick={() => setTrigger(trigger === reason ? '' : reason)}
            >
              {reason}
            </button>
          ))}
        </div>
      </fieldset>
      <Choices value={verdict} onChange={setVerdict} label="Your view of the entry" />
      <div className="ym-replay-reveal">
        {savedReview?.pre_reveal_verdict && savedReview.pre_reveal_at
          ? <p className="ym-replay-lock" role="status"><BookOpenCheck size={15} />
              Pre-reveal judgement recorded: <strong>{savedReview.pre_reveal_verdict === 'followed' ? 'Followed my plan' : savedReview.pre_reveal_verdict === 'changed' ? 'Changed course' : 'Unsure'}</strong>
              <span>· {new Date(savedReview.pre_reveal_at).toLocaleString()}</span>
            </p>
          : savedReview
            ? <p className="ym-replay-guidance">Earlier review: the original judgement was not recorded before the outcome was shown.</p>
            : <p className="ym-replay-guidance">Select a judgement to save it before the outcome becomes visible here. This does not prove you never saw the outcome elsewhere.</p>}
        <button type="button" className="btn-secondary" aria-expanded={show} disabled={busy || (!savedReview && !verdict)} onClick={() => { void reveal(); }}>
          {show ? <RotateCcw size={16} /> : <Eye size={16} />}{' '}
          {busy ? 'Recording…' : show ? 'Hide outcome' : savedReview ? 'Reveal outcome and evidence' : 'Record judgement & reveal outcome'}
        </button>
      </div>
      {show && (
        <div className="ym-replay-result">
          <div className="ym-replay-compare">
            <span>Judgement before outcome</span>
            <strong>{savedReview?.pre_reveal_verdict === 'followed' ? 'Followed the plan' : savedReview?.pre_reveal_verdict === 'changed' ? 'Changed course' : savedReview?.pre_reveal_verdict === 'unsure' ? 'Unsure' : 'Not independently captured'}</strong>
            <span>Your current assessment</span>
            <strong>{verdict === 'followed' ? 'Followed the plan' : verdict === 'changed' ? 'Changed course' : 'Unsure'}</strong>
          </div>
          <h4>
            <BookOpenCheck size={18} /> Decision debrief
          </h4>
          {ruleState === 'loading' ? (
            <p role="status">Reading the playbook in effect at entry…</p>
          ) : ruleState === 'error' ? (
            <p role="alert">
              Rule history is unavailable.{' '}
              <button className="btn-secondary" onClick={() => setRetry((n) => n + 1)}>
                Retry
              </button>
            </p>
          ) : (
            <Findings rows={evaluateEntry(facts, rules)} />
          )}
          <p className="ym-entry-fill">
            {result.closed
              ? 'Net result · ' + reviewMoney(result.amount, result.currency)
              : 'Position open · final result pending'}
            {result.closed && result.r !== null ? ' · ' + result.r.toFixed(2) + 'R' : ''}
          </p>
          {target.kind === 'position' ? (
            <PositionTimeline position={target.position} />
          ) : (
            <>
              {!facts.image && target.trade.entry_screenshot_url && (
                <MediaImage source={target.trade.entry_screenshot_url} alt="Journal entry chart" />
              )}
              {!facts.voice && target.trade.entry_voice_note_url && (
                <MediaAudioPlayer source={target.trade.entry_voice_note_url} />
              )}
              {target.trade.closure_screenshot_url && (
                <MediaImage source={target.trade.closure_screenshot_url} alt="Closure chart" />
              )}
              {target.trade.closure_voice_note_url && (
                <MediaAudioPlayer source={target.trade.closure_voice_note_url} />
              )}
              {target.trade.lessons && <p>{target.trade.lessons}</p>}
            </>
          )}
        </div>
      )}
      {show && (
        <label className="ym-replay-post-note">
          What do you understand differently after seeing the outcome?
          <textarea className="input-field" rows={3} maxLength={3000}
            placeholder="Separate your next action from the P&L result."
            value={postOutcomeNote} onChange={event => setPostOutcomeNote(event.target.value)} />
        </label>
      )}
      {show && focusText && (
        <div>
          <blockquote>{focusText}</blockquote>
          <Choices
            value={commitment}
            onChange={setCommitment}
            label="How did your weekly commitment go?"
          />
        </div>
      )}
      <details className="ym-decision-details">
        <summary>Add a note, screenshot or voice clip</summary>
        <label>
          My reflection
          <textarea
            className="input-field"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={4000}
          />
        </label>
        <ScreenshotUpload onUpload={setImage} existingUrl={image} label="Review screenshot" />
        <VoiceRecorder onUpload={setVoice} existingUrl={voice} />
      </details>
      {error && <p role="alert">{error}</p>}
      {show && <div className="ym-replay-lab-link">
        <div><strong>Turn this review into a testable improvement.</strong>
          <p>Carry the selected strategy and account into a new experiment. Define one behavior to test next.</p></div>
        <button type="button" className="btn-secondary" onClick={() => { void continueInLab(); }} disabled={busy}>
          <FlaskConical size={16}/> Take this into the Lab <ArrowRight size={15}/>
        </button>
      </div>}
      <button
        className="btn-primary"
        disabled={
          busy ||
          !(strategy || model || trigger || verdict || note.trim() || voice || image || commitment)
        }
        onClick={save}
      >
        <Save size={16} />
        {busy ? 'Saving…' : 'Save decision'}
      </button>
    </div>
  );
}
function PositionTimeline({
  position,
}: {
  position: Extract<ReplayTarget, { kind: 'position' }>['position'];
}) {
  const s = position.summary;
  const [stops, setStops] = useState<{ time: string; text: string }[]>([]),
    [notice, setNotice] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/mt5/position-evidence', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ link: position.link, lifecycle_id: position.lifecycle_id }),
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const data = await r.json();
        const first = Date.parse(s.first_entry_at),
          end = s.final_exit_at ? Date.parse(s.final_exit_at) : Infinity;
        const history = (data.rows || []) as {
          evidence_kind: string;
          payload: { time_msc?: number; sl?: number; tp?: number };
        }[];
        const records = history.filter(
          (e) =>
            e.evidence_kind === 'stop' &&
            Number(e.payload.time_msc) >= first &&
            Number(e.payload.time_msc) < end
        );
        if (!controller.signal.aborted) {
          setStops(
            records.map((e) => ({
              time: new Date(Number(e.payload.time_msc)).toISOString(),
              text: 'Observed stop ' + (e.payload.sl ?? '—') + ' · target ' + (e.payload.tp ?? '—'),
            }))
          );
          setNotice(data.more ? 'Showing the available evidence window.' : '');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setNotice('Stop observations are temporarily unavailable.');
      });
    return () => controller.abort();
  }, [position.link, position.lifecycle_id, s.first_entry_at, s.final_exit_at]);
  const events = [
    ...(s.entries || []).map((e) => ({
      time: e.time || '',
      text: 'Entry ' + e.volume + ' at ' + e.price,
    })),
    ...(s.exits || []).map((e) => ({ time: e.time || '', text: 'Exit ' + e.volume + ' at ' + e.price })),
    ...stops,
  ].sort((a, b) => a.time.localeCompare(b.time));
  return (
    <details className="ym-decision-details">
      <summary>Broker timeline · {events.length} events</summary>
      <ol>
        {events.map((e, i) => (
          <li key={i}>
            <time>{e.time.replace('T', ' ').slice(0, 19)}</time> {e.text}
          </li>
        ))}
      </ol>
      {notice && <p>{notice}</p>}
    </details>
  );
}
