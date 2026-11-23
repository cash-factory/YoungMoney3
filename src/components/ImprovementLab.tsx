import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowRight, ArrowUpRight, BookOpenCheck, Check, ChevronDown, CircleAlert,
  ClipboardCheck, FlaskConical, LockKeyhole, Plus, RefreshCw, ShieldCheck, Target, X,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useTradingAccounts, useStrategies, useTestSessions } from '@/hooks/useData';
import { useDecisionReviews } from '@/hooks/useDecisionReviews';
import { useImprovementExperiments } from '@/hooks/useImprovementExperiments';
import {
  evaluateExperiment, validateExperiment, type ImprovementExperiment,
  type ImprovementExperimentInput, type ExperimentPeriod,
} from '@/lib/improvementLab';
import { SectionHeader } from './ui/SectionHeader';
import { Modal } from './ui/Modal';
import '@/improvement-lab.css';

const todayUTC = () => new Date().toISOString().slice(0, 10);
const toInput = (item: ImprovementExperiment): ImprovementExperimentInput => ({
  title: item.title, hypothesis: item.hypothesis, single_change: item.single_change,
  strategy_id: item.strategy_id, account_id: item.account_id, metric: item.metric,
  start_date: item.start_date, end_date: item.end_date, baseline_days: item.baseline_days,
  minimum_samples: item.minimum_samples, status: item.status, conclusion: item.conclusion,
});
const draftExperiment = (): ImprovementExperimentInput => ({
  title: '',
  hypothesis: '',
  single_change: '',
  strategy_id: null,
  account_id: null,
  metric: 'plan_adherence',
  start_date: todayUTC(),
  end_date: null,
  baseline_days: 30,
  minimum_samples: 20,
  status: 'draft',
  conclusion: '',
});
const percent = (value: number | null) => value === null ? '—' : value.toFixed(1) + '%';

function EvidenceMeter({ label, period, required }: { label: string; period: ExperimentPeriod; required: number }) {
  const progress = Math.min(100, 100 * period.eligible / required);
  return (
    <div className="ym-lab-measure">
      <div className="ym-lab-measure-top">
        <div><small>{label}</small><strong>{percent(period.adherence)}</strong></div>
        <span>{period.eligible} / {required} decisions</span>
      </div>
      <div className="ym-lab-meter" role="progressbar" aria-label={label + ' evidence coverage'}
        aria-valuemin={0} aria-valuemax={required} aria-valuenow={Math.min(required, period.eligible)}>
        <span style={{ width: progress + '%' }} />
      </div>
      <p>{period.followed} followed · {period.changed} changed · {period.uncertain} uncertain</p>
      <p>{period.pre_reveal} recorded pre-reveal · {period.retrospective} retrospective</p>
    </div>
  );
}

function StudyForm({
  initial, owner, onCancel, onSubmit, busy, error,
}: {
  initial: ImprovementExperimentInput;
  owner: string;
  onCancel: () => void;
  onSubmit: (record: ImprovementExperimentInput) => Promise<void>;
  busy: boolean;
  error: string;
}) {
  const [form, setForm] = useState<ImprovementExperimentInput>(initial);
  const [validation, setValidation] = useState('');
  const { strategies } = useStrategies(owner);
  const { accounts } = useTradingAccounts(owner);

  const update = <K extends keyof ImprovementExperimentInput>(key: K, value: ImprovementExperimentInput[K]) =>
    setForm(previous => ({ ...previous, [key]: value }));

  async function submit(status: 'draft' | 'active') {
    const record = { ...form, title: form.title.trim(), hypothesis: form.hypothesis.trim(),
      single_change: form.single_change.trim(), status };
    const message = validateExperiment(record);
    setValidation(message || '');
    if (!message) await onSubmit(record);
  }

  return (
    <form className="ym-lab-form" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void submit('draft'); }}>
      <div className="ym-lab-form-intro">
        <span className="ym-lab-kicker">PREREGISTRATION / STEP 01</span>
        <h3>Change one thing. Observe what follows.</h3>
        <p>Define the rule before collecting the next set of reviews. Starting a new prospective study requires today or a future start date; the server records when it was activated. Old trades cannot count as new observations.</p>
      </div>
      <div className="ym-lab-form-fields">
        <label>Experiment name
          <input className="input-field" value={form.title} maxLength={100} required
            placeholder="Wait for the candle close" onChange={e => update('title', e.target.value)} />
        </label>
        <label>What is your hypothesis?
          <textarea className="input-field" value={form.hypothesis} maxLength={600} rows={3} required
            placeholder="Waiting for confirmation will help me follow my entry rules more consistently."
            onChange={e => update('hypothesis', e.target.value)} />
        </label>
        <label>The one rule or behavior you will change
          <textarea className="input-field" value={form.single_change} maxLength={500} rows={2} required
            placeholder="No entry until the agreed confirmation candle has closed."
            onChange={e => update('single_change', e.target.value)} />
        </label>
        <div className="ym-lab-form-grid">
          <label>Strategy
            <select className="input-field" value={form.strategy_id || ''} onChange={e => update('strategy_id', e.target.value || null)}>
              <option value="">All reviewed strategies</option>
              {strategies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>Account
            <select className="input-field" value={form.account_id || ''} onChange={e => update('account_id', e.target.value || null)}>
              <option value="">All trading accounts</option>
              {accounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>Intervention begins (UTC)
            <input className="input-field" type="date" required value={form.start_date}
              onChange={e => update('start_date', e.target.value)} />
          </label>
          <label>End date (UTC, optional)
            <input className="input-field" type="date" min={form.start_date} value={form.end_date || ''}
              onChange={e => update('end_date', e.target.value || null)} />
          </label>
          <label>Baseline window
            <select className="input-field" value={form.baseline_days} onChange={e => update('baseline_days', Number(e.target.value))}>
              {[14, 30, 60, 90, 180, 365].map(days => <option key={days} value={days}>{days} days before intervention</option>)}
            </select>
          </label>
          <label>Minimum decisions per period
            <input className="input-field" type="number" min={5} max={500} step={1}
              value={form.minimum_samples} onChange={e => update('minimum_samples', Number(e.target.value))} />
          </label>
        </div>
      </div>
      <div className="ym-lab-method">
        <ShieldCheck size={19} aria-hidden="true" />
        <p><strong>Primary measure: self-reported plan adherence.</strong> After activation, intervention evidence requires a new trade and a server-sealed pre-reveal review. Earlier or retrospective interventions are excluded. This is not a randomized causal study.</p>
      </div>
      {(validation || error) && <p className="ym-lab-form-error" role="alert">{validation || error}</p>}
      <div className="ym-lab-form-actions">
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn-secondary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save draft'}</button>
        <button className="btn-primary" type="button" disabled={busy}
          onClick={() => { void submit('active'); }}>
          <LockKeyhole size={16} /> Start & lock design
        </button>
      </div>
    </form>
  );
}

export function ImprovementLab({ onShowSessions }: { onShowSessions: () => void }) {
  const { user } = useAuth();
  const { studies, loading, error, refresh, save, remove } = useImprovementExperiments(user?.id);
  const { rows: decisions, error: decisionsError, loading: reviewsLoading, refresh: refreshReviews } = useDecisionReviews(user?.id);
  const { sessions } = useTestSessions(user?.id);
  const { strategies } = useStrategies(user?.id);
  const { accounts } = useTradingAccounts(user?.id);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<ImprovementExperiment | null>(null);
  const [seed, setSeed] = useState<ImprovementExperimentInput | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [operationError, setOperationError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [reflections, setReflections] = useState<Record<string,string>>({});
  const demo = user?.id === '00000000-0000-4000-8000-00000000d3a0';
  useEffect(() => {
    if (!user?.id || demo) return;
    try {
      const key='ymfx:lab-intent:v1:' + user.id;
      const item=sessionStorage.getItem(key);
      if (!item) return;
      const value: unknown = JSON.parse(item);
      sessionStorage.removeItem(key);
      if (!value || typeof value !== 'object') return;
      const source=value as Record<string, unknown>;
      setSeed({
        ...draftExperiment(),
        title: typeof source.symbol === 'string' ? (source.symbol + ' decision experiment').slice(0,100) : '',
        strategy_id: typeof source.strategy_id === 'string' ? source.strategy_id : null,
        account_id: typeof source.account_id === 'string' ? source.account_id : null,
      });
      setEdit(null);
      setOpen(true);
    } catch { /* Session storage can be unavailable or contain invalid values. */ }
  }, [user?.id, demo]);

  const filtered = useMemo(() => studies.filter(study =>
    statusFilter === 'all' || study.status === statusFilter), [studies, statusFilter]);
  const reviewed = decisions.filter(review => review.verdict === 'changed' || review.verdict === 'followed').length;
  const saveStudy = async (input: ImprovementExperimentInput) => {
    setBusy(true); setOperationError('');
    try {
      await save(input, edit || undefined);
      setOpen(false); setEdit(null); setExpanded(null);
    } catch (cause) { setOperationError(cause instanceof Error ? cause.message : 'Could not save experiment.'); }
    finally { setBusy(false); }
  };
  const mutate = async (operation: () => Promise<void>) => {
    setBusy(true); setOperationError('');
    try { await operation(); }
    catch (cause) { setOperationError(cause instanceof Error ? cause.message : 'Could not update study.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="ym-improvement-lab">
      <SectionHeader title="Improvement Laboratory"
        subtitle="Test one trading behavior at a time. Compare documented decisions, not imagined outcomes."
        action={<button className="btn-primary" type="button" disabled={demo} onClick={() => { setEdit(null); setSeed(null); setOperationError(''); setOpen(true); }}>
          <Plus size={16} /> New experiment
        </button>} />
      <div className="ym-lab-hero">
        <div className="ym-lab-hero-copy">
          <span className="ym-lab-kicker"><FlaskConical size={14} /> YOUR PRACTICE / EVIDENCE LAB</span>
          <h2>Improve the process.<br /><em>Measure the difference.</em></h2>
          <p>An experiment starts with a clear hypothesis and one change in behavior. Compare the decision reviews that followed with an earlier baseline—and report uncertainty openly.</p>
          {demo && <p role="status">This is a read-only sample workspace. Sign in to save your own experiments.</p>}
        </div>
        <div className="ym-lab-hero-number" aria-hidden="true">04<span>/ IMPROVEMENT</span></div>
      </div>
      <div className="ym-lab-summary" aria-label="Improvement laboratory overview">
        <div><small>Registered studies</small><strong>{studies.length}</strong></div>
        <div><small>Active studies</small><strong>{studies.filter(s => s.status === 'active').length}</strong></div>
        <div><small>Reviewed decisions</small><strong>{reviewed}</strong></div>
      </div>
      <div className="ym-lab-toolbar">
        <div>
          <h3>Experiments</h3>
          <span>Each study has its own locked measure and observation period.</span>
        </div>
        <div className="ym-lab-toolbar-actions">
          <label>Show
            <select className="input-field" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="all">All studies</option>
              <option value="active">Active</option>
              <option value="draft">Drafts</option>
              <option value="completed">Completed</option>
            </select>
          </label>
          <button type="button" className="btn-ghost" aria-label="Refresh laboratory evidence" disabled={busy}
            onClick={() => { refresh(); refreshReviews(); }}><RefreshCw size={18} /></button>
        </div>
      </div>
      {error && <div className="ym-lab-error" role="alert">{error} <button type="button" className="btn-secondary" onClick={refresh}>Retry</button></div>}
      {decisionsError && <div className="ym-lab-error" role="alert">Decision evidence unavailable: {decisionsError} <button type="button" className="btn-secondary" onClick={refreshReviews}>Retry</button></div>}
      {operationError && !open && <div className="ym-lab-error" role="alert">{operationError}<button className="btn-ghost" type="button" onClick={() => setOperationError('')} aria-label="Dismiss error"><X size={16}/></button></div>}
      {loading || reviewsLoading ? <div className="card p-6" role="status">Loading your experiments and decision reviews…</div> : (
        <div className="ym-lab-studies">
          {filtered.length === 0 && <div className="ym-lab-empty">
            <FlaskConical size={30} aria-hidden="true" />
            <h3>{statusFilter === 'all' ? 'Your first hypothesis starts here' : 'No studies in this category'}</h3>
            <p>Start with one behavior worth investigating—for example, waiting for a confirmed entry. You can save a draft before committing to the test.</p>
            {!demo && <button className="btn-secondary" type="button" onClick={() => { setEdit(null); setSeed(null); setOpen(true); }}>Design an experiment <ArrowRight size={16}/></button>}
          </div>}
          {filtered.map(study => {
            const evidence = evaluateExperiment(study, decisions);
            const isOpen = expanded === study.id;
            const strategy = strategies.find(s=>s.id===study.strategy_id)?.name;
            const account = accounts.find(a=>a.id===study.account_id)?.name;
            const linkedSessions = study.strategy_id ? sessions.filter(s=>s.strategy_id===study.strategy_id && (!study.account_id || s.account_id===study.account_id)) : [];
            return <article key={study.id} className="ym-lab-study" data-lab-study={study.id} data-study-status={study.status}>
              <button type="button" className="ym-lab-study-trigger" aria-expanded={isOpen}
                aria-controls={'ym-lab-detail-'+study.id} onClick={() => setExpanded(isOpen ? null : study.id)}>
                <span className="ym-lab-study-mark"><Target size={19}/></span>
                <span className="ym-lab-study-main">
                  <span className="ym-lab-study-kicker">{study.status.toUpperCase()} · {study.start_date} UTC</span>
                  <strong>{study.title}</strong>
                  <small>{strategy || 'All strategies'} · {account || 'All accounts'}</small>
                </span>
                <span className="ym-lab-study-progress">{evidence.intervention.eligible} reviewed</span>
                <ChevronDown className={isOpen?'rotate-180':''} size={18}/>
              </button>
              {isOpen && <div className="ym-lab-study-details" id={'ym-lab-detail-'+study.id}>
                <div className="ym-lab-thesis">
                  <div><span>Hypothesis</span><p>{study.hypothesis}</p></div>
                  <div><span>One intentional change</span><p>{study.single_change}</p></div>
                </div>
                <div className="ym-lab-study-method">
                  <span><LockKeyhole size={15}/> {study.status==='draft'?'Design editable until activated':'Study design locked'}</span>
                  <span>{evidence.prospective ? 'Server-sealed at '+new Date(study.activated_at!).toLocaleString() : 'Legacy/draft · no verified activation timestamp'}</span>
                  <span>Baseline: {study.baseline_days} days</span>
                  <span>Trial: {study.start_date} through {study.end_date || 'present'}</span>
                  <span>Measure: plan adherence</span>
                </div>
                {study.status==='draft' && <p className="ym-lab-caution"><CircleAlert size={16} /> Draft measurements are exploratory. Start the experiment to lock the plan.</p>}
                {!evidence.prospective && study.status!=='draft' && <p className="ym-lab-caution"><CircleAlert size={16} /> This earlier study lacks a verified activation timestamp. Its comparisons are historical, not independently prospectively registered.</p>}
                {evidence.excluded_intervention>0 && <p className="ym-lab-caution" role="status"><CircleAlert size={16} /> {evidence.excluded_intervention} retrospective or pre-activation {evidence.excluded_intervention===1?'review was':'reviews were'} excluded from the intervention percentage.</p>
                <div className="ym-lab-measures">
                  <EvidenceMeter label="Earlier baseline" period={evidence.baseline} required={study.minimum_samples}/>
                  <EvidenceMeter label={evidence.prospective?'Prospective observations':'After the change (exploratory)'} period={evidence.intervention} required={study.minimum_samples}/>
                </div>
                <div className="ym-lab-finding" data-evidence-ready={evidence.enough_evidence}>
                  <div><small>Observed change in plan adherence</small>
                    <strong>{evidence.percentage_point_change === null ? 'Not yet comparable'
                      : (evidence.percentage_point_change>0?'+':'')+evidence.percentage_point_change.toFixed(1)+' percentage points'}</strong></div>
                  <span>{evidence.enough_evidence ? (evidence.prospective?'Minimum samples reached · still descriptive':'Historical comparison · not prospective') : 'Insufficient evidence for the study’s sample target'}</span>
                </div>
                <details className="ym-lab-limitations"><summary><CircleAlert size={16}/> Evidence limitations & methodology</summary>
                  <ul>{evidence.limitations.map(item=><li key={item}>{item}</li>)}</ul>
                  <p>Entry and server-sealed assessment times determine eligible prospective observations (UTC). Broker timezone uncertainty can weaken trade classification. Existing strategy-testing sessions are separate evidence and are never silently combined with real decision reviews.</p>
                </details>
                <div className="ym-lab-linked">
                  <span><ClipboardCheck size={17}/> {linkedSessions.length} related testing {linkedSessions.length===1?'session':'sessions'} (separate evidence)</span>
                  <div className="ym-lab-linked-actions"><button type="button" onClick={onShowSessions}>Open test sessions <ArrowUpRight size={15}/></button><a href="/#dashboard">Review more decisions <ArrowUpRight size={15}/></a></div>
                </div>
                {study.status==='completed' && <blockquote className="ym-lab-conclusion">{study.conclusion || 'Completed without a written conclusion.'}</blockquote>}
                {study.status==='active' && !demo && <label className="ym-lab-conclude">Your conclusion, including limitations
                  <textarea className="input-field" rows={3} maxLength={3000} value={reflections[study.id] ?? study.conclusion}
                    placeholder="What was observed? What remains uncertain? What will you test next?"
                    onChange={e=>setReflections(old=>({...old,[study.id]:e.target.value}))}/>
                </label>}
                <div className="ym-lab-study-actions">
                  {study.status==='draft' && !demo && <>
                    <button className="btn-secondary" type="button" disabled={busy} onClick={()=>{setEdit(study);setOpen(true);}}>Edit design</button>
                    <button className="btn-primary" type="button" disabled={busy} onClick={()=>{void mutate(()=>save({...toInput(study),status:'active'},study));}}>
                      <LockKeyhole size={15}/> Start & lock study
                    </button>
                    <button className="btn-ghost" type="button" disabled={busy} onClick={()=>{
                      if (window.confirm('Delete this draft experiment?')) void mutate(()=>remove(study));
                    }}>Delete draft</button>
                  </>}
                  {study.status==='active' && !demo && <button className="btn-primary" type="button" disabled={busy ||
                      (reflections[study.id] ?? study.conclusion).trim().length<20}
                    onClick={()=>{void mutate(()=>save({...toInput(study),status:'completed',conclusion:(reflections[study.id]??study.conclusion).trim()},study));}}>
                    <Check size={16}/> Complete with conclusion
                  </button>}
                  {study.status==='completed' && <span className="ym-lab-complete"><BookOpenCheck size={16}/> Study recorded</span>}
                </div>
              </div>}
            </article>;
          })}
        </div>
      )}
      <div className="ym-lab-footnote"><ShieldCheck size={17} />
        <p>This laboratory measures observable journal-review behavior. It does not diagnose psychology, establish causation, or predict profitable trades. Stronger conclusions require appropriate study design and independently verified data.</p>
      </div>
      <Modal open={open} title={edit ? 'Edit experiment draft' : 'Register an improvement experiment'}
        onClose={()=>{ if(!busy){setOpen(false);setEdit(null);} }} size="lg">
        <StudyForm key={edit?.id || 'new-study'} initial={edit ? toInput(edit) : seed || draftExperiment()} owner={user?.id || ''}
          busy={busy} error={operationError} onSubmit={saveStudy}
          onCancel={()=>{setOpen(false);setEdit(null);}}/>
      </Modal>
    </div>
  );
}
