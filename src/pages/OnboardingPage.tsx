import { useState, useEffect, useRef } from 'react';
import { Plus, Target, ArrowRight, Check, Sparkles, Wallet, ListChecks, Trash2, ChevronRight, Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { BrandLogo } from '@/components/BrandLogo';
import { announceAction } from '@/lib/actionFeedback';
import { supabase } from '@/lib/supabase';
import '@/onboarding-studio.css';
import { useStrategies, useStrategyChecklist, useRiskSettings } from '@/hooks/useData';

interface OnboardingPageProps {
  onComplete: () => void;
}

const DEFAULT_CHECKLIST_ITEMS: { label: string; is_required: boolean }[] = [
  { label: 'Higher timeframe trend confirmed', is_required: true },
  { label: 'Key support/resistance level identified', is_required: true },
  { label: 'Entry plan is clear (entry, SL, TP)', is_required: true },
  { label: 'Risk is within my per-trade limit', is_required: true },
  { label: 'No major news within 30 minutes', is_required: false },
];

const STEPS = [
  { icon: Sparkles, title: 'Welcome', detail: 'Your starting point' },
  { icon: Wallet, title: 'Risk', detail: 'Set a planning balance' },
  { icon: Target, title: 'Strategies', detail: 'Define your approach' },
  { icon: Check, title: 'Ready', detail: 'Start your journal' },
];

export function OnboardingPage({ onComplete }: OnboardingPageProps) {
  const { user } = useAuth();
  const { strategies, addStrategy, deleteStrategy } = useStrategies(user?.id);
  const { settings, loading: loadingSettings, saveSettings } = useRiskSettings(user?.id);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const [balanceEdited, setBalanceEdited] = useState(false);

  const [step, setStep] = useState(0);
  const [accountBalance, setAccountBalance] = useState('10000');
  const [savingAccount, setSavingAccount] = useState(false);

  const [strategyName, setStrategyName] = useState('');
  const [strategyDesc, setStrategyDesc] = useState('');
  const [addingStrategy, setAddingStrategy] = useState(false);
  const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { items: checklistItems, addItem, deleteItem } = useStrategyChecklist(selectedStrategyId);

  const [newChecklistLabel, setNewChecklistLabel] = useState('');
  const [newChecklistRequired, setNewChecklistRequired] = useState(true);
  const [addingChecklist, setAddingChecklist] = useState(false);

  useEffect(() => {
    if (strategies.length > 0 && !selectedStrategyId && !addingStrategy) {
      setSelectedStrategyId(strategies[0].id);
    }
  }, [strategies, selectedStrategyId, addingStrategy]);

  useEffect(() => {
    if (settings && !balanceEdited) setAccountBalance(String(settings.account_balance));
  }, [settings, balanceEdited]);
  useEffect(() => { stepHeading.current?.focus({ preventScroll: true }); }, [step]);

  const handleSaveAccount = async (): Promise<boolean> => {
    if (loadingSettings) return false;
    const balance = parseFloat(accountBalance);
    if (!Number.isFinite(balance) || balance <= 0) {
      setError('Please enter a valid account balance.');
      return false;
    }
    setSavingAccount(true);
    setError(null);
    try {
      await saveSettings({
        max_daily_loss_pct: settings?.max_daily_loss_pct ?? 3.0,
        max_daily_trades: settings?.max_daily_trades ?? 5,
        max_risk_per_trade_pct: settings?.max_risk_per_trade_pct ?? 1.0,
        account_balance: balance,
        max_drawdown_pct: settings?.max_drawdown_pct ?? 10.0,
        daily_loss_limit_amount: settings?.daily_loss_limit_amount ?? null,
      });
      setSavingAccount(false);
      announceAction('success','Planning balance and risk defaults saved.');
      return true;
    } catch (err: unknown) {
      const message=err && typeof err === 'object' && 'message' in err && typeof err.message === 'string' ? err.message : 'Failed to save account settings.';
      setError(message);
      announceAction('error',message);
      setSavingAccount(false);
      return false;
    }
  };

  const handleAddStrategy = async () => {
    if (!strategyName.trim()) {
      setError('Please enter a strategy name.');
      return;
    }
    setAddingStrategy(true);
    setError(null);
    try {
      const created = await addStrategy({ name: strategyName.trim(), description: strategyDesc.trim() || null, is_active: true });
      const { error: checklistError } = await supabase.from('strategy_checklist_items').insert(DEFAULT_CHECKLIST_ITEMS.map((item, index) => ({ ...item, strategy_id: created.id, entry_model_id: null, sort_order: index, is_active: true })));
      setSelectedStrategyId(created.id);
      if (checklistError) throw checklistError;
      setStrategyName('');
      setStrategyDesc('');
      announceAction('success','Strategy created with its starter checklist.');
    } catch (err: unknown) {
      const message=err && typeof err === 'object' && 'message' in err && typeof err.message === 'string' ? err.message : 'Failed to add strategy.';
      setError(message);announceAction('error',message);
    }
    setAddingStrategy(false);
  };

  const handleDeleteStrategy = async (id: string) => {
    try {
      await deleteStrategy(id);
      announceAction('success','Strategy removed.');
      if (selectedStrategyId === id) {
        const remaining = strategies.filter(s => s.id !== id);
        setSelectedStrategyId(remaining.length > 0 ? remaining[0].id : null);
      }
    } catch (err: unknown) {
      const message=err && typeof err === 'object' && 'message' in err && typeof err.message === 'string' ? err.message : 'Failed to delete strategy.';
      setError(message);announceAction('error',message);
    }
  };

  const handleAddChecklistItem = async () => {
    if (!newChecklistLabel.trim() || !selectedStrategyId) return;
    setAddingChecklist(true);
    try {
      await addItem(newChecklistLabel.trim(), newChecklistRequired);
      setNewChecklistLabel('');
      setNewChecklistRequired(true);
      announceAction('success','Checklist item saved.');
    } catch (err: unknown) {
      const message=err && typeof err === 'object' && 'message' in err && typeof err.message === 'string' ? err.message : 'Failed to add checklist item.';
      setError(message);announceAction('error',message);
    }
    setAddingChecklist(false);
  };

  const handleDeleteChecklistItem = async (id: string) => {
    try {
      await deleteItem(id);
      announceAction('success','Checklist item removed.');
    } catch (err: unknown) {
      const message=err && typeof err === 'object' && 'message' in err && typeof err.message === 'string' ? err.message : 'Failed to delete checklist item.';
      setError(message);announceAction('error',message);
    }
  };


  const labelCls = 'block text-xs font-semibold text-secondary mb-1.5';
  const inputCls = 'input-field';
  const riskPerTrade = settings?.max_risk_per_trade_pct ?? 1;
  const dailyLoss = settings?.max_daily_loss_pct ?? 3;

  const goToStep = (next: number) => { setError(null); setStep(next); };

  return (
    <div className="ym-workspace-setup">
      <header className="ym-setup-heading">
        <div><p className="ym-setup-kicker">WORKSPACE / GETTING STARTED</p><h1>Workspace setup</h1><p>A few useful defaults. A clearer start to your next session.</p></div>
        <BrandLogo />
      </header>
      <div className="ym-setup-layout">
        <aside className="ym-setup-guide" aria-label="Setup guide">
          <div className="ym-setup-progress-heading"><span>YOUR FOUNDATION</span><strong>0{step + 1} <small>/ 04</small></strong></div>
          <ol className="ym-setup-steps" aria-label="Setup progress">
            {STEPS.map((item, index) => {
              const Icon = item.icon;
              const done = index < step;
              return <li key={item.title} data-active={index === step} data-done={done}>
                <button type="button" disabled={index > step || savingAccount || addingStrategy} onClick={() => goToStep(index)} aria-current={index === step ? 'step' : undefined}>
                  <span className="ym-setup-step-icon">{done ? <Check size={17} /> : <Icon size={17} />}</span>
                  <span><strong>{item.title}</strong><small>{item.detail}</small></span>
                </button>
              </li>;
            })}
          </ol>
          <details className="ym-setup-guide-help"><summary>Why these steps?</summary><p>Each step establishes a practical default. You can change your risk, strategies and checklists later.</p></details>
        </aside>

        <section className="ym-setup-panel card" aria-label={`${STEPS[step].title} setup`}>
          {error && <p className="ym-setup-error" role="alert">{error}</p>}
          {step === 0 && <div className="ym-setup-stage">
            <p className="ym-setup-step-label">STEP 01 / WELCOME</p>
            <h2 ref={stepHeading} tabIndex={-1}>Build your trading foundation.</h2>
            <p className="ym-setup-lead">Four short steps. Your trading process stays yours.</p>
            <div className="ym-setup-welcome-grid">
              <div className="ym-setup-welcome-list">
                <div><span><Wallet size={20} /></span><div><h3>Start with your capital</h3><p>Anchor your workspace risk defaults.</p></div></div>
                <div><span><Target size={20} /></span><div><h3>Name your approach</h3><p>Keep the strategies you trade close at hand.</p></div></div>
                <div><span><ListChecks size={20} /></span><div><h3>Make the process repeatable</h3><p>Turn entry rules into a practical checklist.</p></div></div>
              </div>
              <figure className="ym-setup-feature-media" aria-label="Illustration of a structured trading workspace">
                <img src="/assets/page-art/workspace-setup.svg" alt="Decorative trading workstation composition" width="960" height="540" loading="eager"/>
                <figcaption><strong>YOUR WORKSPACE</strong><span>Risk · Strategy · Review</span></figcaption>
              </figure>
            </div>
            <div className="ym-setup-footer"><p>One step at a time.</p><button type="button" onClick={() => goToStep(1)} className="btn-primary">Get started <ArrowRight size={17} /></button></div>
          </div>}

          {step === 1 && <div className="ym-setup-stage">
            <p className="ym-setup-step-label">STEP 02 / RISK BASELINE</p>
            <h2 ref={stepHeading} tabIndex={-1}>Set your planning balance.</h2>
            <p className="ym-setup-lead">Used for planning risk—not a live broker balance.</p><div className="ym-setup-helper-trigger"><details><summary>How does this work?</summary><p>Connected account equity and broker balances are tracked separately. Update your planning balance here when your risk baseline changes.</p></details></div>
            <div className="ym-setup-fields">
              <div><label htmlFor="setup-account-balance" className={labelCls}>Planning balance (USD)</label><div className="ym-setup-balance-input"><span aria-hidden="true">$</span><input id="setup-account-balance" type="number" step="100" min="0.01" className={inputCls} value={accountBalance} onChange={event => { setBalanceEdited(true); setAccountBalance(event.target.value); }} onKeyDown={event => { if (event.key === 'Enter' && !savingAccount && !loadingSettings) void handleSaveAccount().then(ok => ok && goToStep(2)); }} /></div></div>
              <div className="ym-setup-risk-preview"><div><ShieldCheck size={17} /><strong>{settings ? 'Your current risk settings' : 'Starting risk defaults'}</strong></div><dl><div><dt>Risk per trade · {riskPerTrade}%</dt><dd>${((parseFloat(accountBalance) || 0) * riskPerTrade / 100).toFixed(0)}</dd></div><div><dt>Daily loss limit · {dailyLoss}%</dt><dd>${((parseFloat(accountBalance) || 0) * dailyLoss / 100).toFixed(0)}</dd></div></dl><p>You can adjust these limits in Risk Management.</p></div>
            </div>
            <div className="ym-setup-footer"><button type="button" className="btn-ghost" onClick={() => goToStep(0)}>Back</button><button type="button" className="btn-primary" disabled={savingAccount || loadingSettings} onClick={async () => { if (await handleSaveAccount()) goToStep(2); }}>{savingAccount ? <Loader2 size={16} className="animate-spin" /> : <ChevronRight size={16} />}{savingAccount ? 'Saving…' : 'Continue'}</button></div>
          </div>}

          {step === 2 && <div className="ym-setup-stage">
            <p className="ym-setup-step-label">STEP 03 / STRATEGIES</p>
            <h2 ref={stepHeading} tabIndex={-1}>Give your approach a name.</h2>
            <p className="ym-setup-lead">Choose a strategy to review its checklist, or add the next approach you want to track.</p>
            <div className="ym-setup-strategy-form"><div><label htmlFor="setup-strategy-name" className={labelCls}>Strategy name</label><input id="setup-strategy-name" className={inputCls} placeholder="e.g. London continuation" value={strategyName} onChange={event => setStrategyName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !addingStrategy) void handleAddStrategy(); }} /></div><div><label htmlFor="setup-strategy-description" className={labelCls}>Description <span className="text-muted">(optional)</span></label><input id="setup-strategy-description" className={inputCls} placeholder="When do you use this strategy?" value={strategyDesc} onChange={event => setStrategyDesc(event.target.value)} /></div><button type="button" className="btn-secondary" onClick={handleAddStrategy} disabled={addingStrategy}>{addingStrategy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}{addingStrategy ? 'Adding…' : 'Add strategy'}</button></div>
            {strategies.length > 0 && <div className="ym-setup-strategy-list" aria-label="Your strategies">{strategies.map(strategy => <div key={strategy.id} data-selected={selectedStrategyId === strategy.id}><button type="button" onClick={() => setSelectedStrategyId(strategy.id)} aria-pressed={selectedStrategyId === strategy.id}><Target size={17} /><span><strong>{strategy.name}</strong>{strategy.description && <small>{strategy.description}</small>}</span>{selectedStrategyId === strategy.id && <Check size={17} />}</button><button type="button" className="ym-setup-delete" onClick={() => handleDeleteStrategy(strategy.id)} aria-label={`Delete ${strategy.name}`}><Trash2 size={15} /></button></div>)}</div>}
            {selectedStrategyId && <section className="ym-setup-checklist" aria-label="Strategy checklist"><div className="ym-setup-checklist-title"><ListChecks size={18} /><h3>{strategies.find(strategy => strategy.id === selectedStrategyId)?.name} checklist</h3></div>
              {checklistItems.length ? <ol>{checklistItems.map((item, index) => <li key={item.id}><span className="ym-setup-check-index">{String(index + 1).padStart(2, '0')}</span><span>{item.label}</span><small>{item.is_required ? 'Required' : 'Optional'}</small><button type="button" className="ym-setup-delete" aria-label={`Delete checklist item ${item.label}`} onClick={() => handleDeleteChecklistItem(item.id)}><Trash2 size={14} /></button></li>)}</ol> : <p className="text-sm text-muted">Add the conditions you want to check before entry.</p>}
              <label htmlFor="setup-checklist-item" className="sr-only">New checklist item</label><input id="setup-checklist-item" className={inputCls} placeholder="Add an entry condition…" value={newChecklistLabel} onChange={event => setNewChecklistLabel(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !addingChecklist) void handleAddChecklistItem(); }} /><div className="ym-setup-checklist-actions"><label><input type="checkbox" checked={newChecklistRequired} onChange={event => setNewChecklistRequired(event.target.checked)} />Required before entry</label><button type="button" className="btn-secondary" onClick={handleAddChecklistItem} disabled={addingChecklist || !newChecklistLabel.trim()}>{addingChecklist ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}Add item</button></div>
            </section>}
            {!strategies.length && <p className="ym-setup-hint">Add at least one strategy to continue.</p>}
            <div className="ym-setup-footer"><button type="button" className="btn-ghost" onClick={() => goToStep(1)}>Back</button><button type="button" className="btn-primary" disabled={!strategies.length || addingStrategy} onClick={() => goToStep(3)}>Continue <ArrowRight size={16} /></button></div>
          </div>}

          {step === 3 && <div className="ym-setup-stage ym-setup-ready">
            <p className="ym-setup-step-label">STEP 04 / READY</p><span className="ym-setup-ready-icon"><Check size={30} /></span>
            <h2 ref={stepHeading} tabIndex={-1}>Your workspace is ready.</h2>
            <p className="ym-setup-lead">You have a planning balance and {strategies.length} {strategies.length === 1 ? 'strategy' : 'strategies'} to build on. Choose a strategy when you capture a trade, then return to review the decision.</p>
            <div className="ym-setup-ready-summary"><div><span>Planning balance</span><strong>${Number(accountBalance).toLocaleString()}</strong></div><div><span>Strategies</span><strong>{strategies.length}</strong></div></div>
            <div className="ym-setup-ready-strategies">{strategies.map(strategy => <span key={strategy.id}><Target size={13} />{strategy.name}</span>)}</div>
            <div className="ym-setup-footer"><button type="button" className="btn-ghost" onClick={() => goToStep(2)}>Back</button><button type="button" className="btn-primary" onClick={onComplete}>Open my dashboard <ArrowRight size={17} /></button></div>
          </div>}
        </section>
      </div>
    </div>
  );
}
