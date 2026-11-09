import { useState, useEffect } from 'react';
import { TrendingUp, Plus, Target, ArrowRight, Check, Sparkles, Brain, Zap, Wallet, ListChecks, Trash2, ChevronRight, Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { ColorPaletteControl } from '@/components/ColorPaletteControl';
import { useStrategies, useStrategyChecklist, useRiskSettings } from '@/hooks/useData';
import type { AccountType } from '@/lib/types';

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
  { icon: Sparkles, title: 'Welcome' },
  { icon: Wallet, title: 'Account' },
  { icon: Target, title: 'Strategies' },
  { icon: Check, title: 'Ready' },
];

export function OnboardingPage({ onComplete }: OnboardingPageProps) {
  const { user } = useAuth();
  const { strategies, addStrategy, deleteStrategy } = useStrategies(user?.id);
  const { saveSettings } = useRiskSettings(user?.id);

  const [step, setStep] = useState(0);
  const [accountBalance, setAccountBalance] = useState('10000');
  const [accountType, setAccountType] = useState<AccountType>('personal');
  const [savingAccount, setSavingAccount] = useState(false);

  const [strategyName, setStrategyName] = useState('');
  const [strategyDesc, setStrategyDesc] = useState('');
  const [addingStrategy, setAddingStrategy] = useState(false);
  const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { items: checklistItems, addBatch, addItem, deleteItem } = useStrategyChecklist(selectedStrategyId);

  const [newChecklistLabel, setNewChecklistLabel] = useState('');
  const [newChecklistRequired, setNewChecklistRequired] = useState(true);
  const [addingChecklist, setAddingChecklist] = useState(false);

  useEffect(() => {
    if (strategies.length > 0 && !selectedStrategyId) {
      setSelectedStrategyId(strategies[0].id);
    }
  }, [strategies, selectedStrategyId]);

  const handleSaveAccount = async (): Promise<boolean> => {
    const balance = parseFloat(accountBalance);
    if (!balance || balance <= 0) {
      setError('Please enter a valid account balance.');
      return false;
    }
    setSavingAccount(true);
    setError(null);
    try {
      await saveSettings({
        max_daily_loss_pct: 3.0,
        max_daily_trades: 5,
        max_risk_per_trade_pct: 1.0,
        account_balance: balance,
        max_drawdown_pct: 10.0,
        daily_loss_limit_amount: null,
      });
      setSavingAccount(false);
      return true;
    } catch (err: unknown) {
      setError(err && typeof err === 'object' && 'message' in err && typeof err.message === 'string' ? err.message : 'Failed to save account settings.');
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
      setSelectedStrategyId(created.id);
      await addBatch(DEFAULT_CHECKLIST_ITEMS);
      setStrategyName('');
      setStrategyDesc('');
    } catch (err: unknown) {
      setError(err && typeof err === 'object' && 'message' in err && typeof err.message === 'string' ? err.message : 'Failed to add strategy.');
    }
    setAddingStrategy(false);
  };

  const handleDeleteStrategy = async (id: string) => {
    try {
      await deleteStrategy(id);
      if (selectedStrategyId === id) {
        const remaining = strategies.filter(s => s.id !== id);
        setSelectedStrategyId(remaining.length > 0 ? remaining[0].id : null);
      }
    } catch (err: unknown) {
      setError(err && typeof err === 'object' && 'message' in err && typeof err.message === 'string' ? err.message : 'Failed to delete strategy.');
    }
  };

  const handleAddChecklistItem = async () => {
    if (!newChecklistLabel.trim() || !selectedStrategyId) return;
    setAddingChecklist(true);
    try {
      await addItem(newChecklistLabel.trim(), newChecklistRequired);
      setNewChecklistLabel('');
      setNewChecklistRequired(true);
    } catch (err: unknown) {
      setError(err && typeof err === 'object' && 'message' in err && typeof err.message === 'string' ? err.message : 'Failed to add checklist item.');
    }
    setAddingChecklist(false);
  };

  const handleDeleteChecklistItem = async (id: string) => {
    try {
      await deleteItem(id);
    } catch (err: unknown) {
      setError(err && typeof err === 'object' && 'message' in err && typeof err.message === 'string' ? err.message : 'Failed to delete checklist item.');
    }
  };


  const labelCls = 'block text-xs font-semibold text-secondary mb-1.5 uppercase tracking-wide';
  const inputCls = 'input-field';

  return (
    <div className="min-h-screen bg-primary flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[400px] h-[400px] rounded-full bg-orange-500/8 blur-[120px] animate-drift" />
        <div className="absolute bottom-1/4 right-1/4 w-[300px] h-[300px] rounded-full bg-amber-500/6 blur-[100px] animate-float-slow" />
      </div>

      <div className="relative w-full max-w-2xl">
        <div className="mb-5 flex justify-end"><ColorPaletteControl compact /></div>
        <div className="text-center mb-8">
          <div className="inline-flex p-3 rounded-2xl bg-gradient-to-br from-orange-500 to-orange-700 text-white mb-3 shadow-lg shadow-orange-500/20">
            <TrendingUp size={32} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Young-Money-Fx</h1>
          <p className="text-sm text-muted mt-1">Let's get you set up</p>
        </div>

        <div className="flex items-center justify-center gap-2 mb-8">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const done = i < step;
            const active = i === step;
            return (
              <div key={i} className="flex items-center">
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  active ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20' :
                  done ? 'text-success-500' : 'text-muted'
                }`}>
                  {done ? <Check size={14} /> : <Icon size={14} />}
                  <span className="hidden sm:inline">{s.title}</span>
                </div>
                {i < STEPS.length - 1 && <div className={`w-8 h-0.5 mx-1 rounded-full ${done ? 'bg-success-500/30' : 'bg-border'}`} />}
              </div>
            );
          })}
        </div>

        <div className="card card-glass p-5 sm:p-8 shadow-xl">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-error-500/10 border border-error-500/20 text-sm text-error-500">
              {error}
            </div>
          )}

          {step === 0 && (
            <div className="text-center animate-fade-in">
              <div className="inline-flex p-4 rounded-2xl bg-orange-500/10 mb-5">
                <Brain size={36} className="text-orange-500" />
              </div>
              <h2 className="text-xl font-bold mb-3">Welcome to your trading journal</h2>
              <p className="text-secondary text-sm leading-relaxed max-w-md mx-auto mb-6">
                This is your space for honest self-reflection. Before you start logging trades,
                let's set up your account size and strategies — each with its own checklist.
              </p>
              <div className="grid grid-cols-3 gap-3 mb-6">
                <div className="p-3 rounded-xl bg-secondary border border-themed">
                  <Wallet size={20} className="text-orange-500 mx-auto mb-1.5" />
                  <p className="text-xs font-semibold">Account</p>
                  <p className="text-[10px] text-muted">Risk-based calc</p>
                </div>
                <div className="p-3 rounded-xl bg-secondary border border-themed">
                  <Target size={20} className="text-amber-500 mx-auto mb-1.5" />
                  <p className="text-xs font-semibold">Strategies</p>
                  <p className="text-[10px] text-muted">Per-strategy rules</p>
                </div>
                <div className="p-3 rounded-xl bg-secondary border border-themed">
                  <ListChecks size={20} className="text-success-500 mx-auto mb-1.5" />
                  <p className="text-xs font-semibold">Checklists</p>
                  <p className="text-[10px] text-muted">Enforce discipline</p>
                </div>
              </div>
              <button onClick={() => setStep(1)} className="btn-primary mx-auto">
                Get Started <ArrowRight size={18} />
              </button>
            </div>
          )}

          {step === 1 && (
            <div className="animate-fade-in">
              <div className="text-center mb-6">
                <div className="inline-flex p-3 rounded-2xl bg-orange-500/10 mb-3">
                  <Wallet size={28} className="text-orange-500" />
                </div>
                <h2 className="text-lg font-bold mb-2">What's your account size?</h2>
                <p className="text-secondary text-sm max-w-md mx-auto">
                  This is your starting balance. All risk calculations — daily loss limits,
                  risk per trade, drawdown — are based on this number.
                </p>
              </div>

              <div className="space-y-4 mb-6">
                <div>
                  <label className={labelCls}>Account Type</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setAccountType('personal')}
                      className={`p-4 rounded-xl border-2 transition-all text-center ${
                        accountType === 'personal'
                          ? 'border-orange-500 bg-orange-500/10 text-orange-600 dark:text-orange-400'
                          : 'border-themed bg-secondary text-secondary hover:border-muted'
                      }`}
                    >
                      <Wallet size={24} className="mx-auto mb-2" />
                      <p className="text-sm font-semibold">Personal Funds</p>
                      <p className="text-[10px] text-muted">Your own capital</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setAccountType('propfirm')}
                      className={`p-4 rounded-xl border-2 transition-all text-center ${
                        accountType === 'propfirm'
                          ? 'border-orange-500 bg-orange-500/10 text-orange-600 dark:text-orange-400'
                          : 'border-themed bg-secondary text-secondary hover:border-muted'
                      }`}
                    >
                      <Target size={24} className="mx-auto mb-2" />
                      <p className="text-sm font-semibold">Prop Firm</p>
                      <p className="text-[10px] text-muted">Funded account</p>
                    </button>
                  </div>
                </div>

                <div>
                  <label className={labelCls}>Account Balance ($)</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-muted">$</span>
                    <input
                      type="number"
                      step="100"
                      min="0"
                      className={`${inputCls} text-2xl font-bold pl-8`}
                      placeholder="10000"
                      value={accountBalance}
                      onChange={e => setAccountBalance(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSaveAccount().then(ok => ok && setStep(2))}
                    />
                  </div>
                  <p className="text-[11px] text-muted mt-1.5">You can change this later in Risk Guardian settings</p>
                </div>

                <div className="p-4 rounded-xl bg-orange-500/5 border border-orange-500/15">
                  <p className="text-xs font-semibold text-secondary mb-2">Based on your balance, your defaults will be:</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <Zap size={12} className="text-amber-500" />
                      <span className="text-muted">Max risk/trade:</span>
                      <span className="font-mono font-bold">${((parseFloat(accountBalance) || 0) * 0.01).toFixed(0)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Brain size={12} className="text-orange-500" />
                      <span className="text-muted">Daily loss limit:</span>
                      <span className="font-mono font-bold">${((parseFloat(accountBalance) || 0) * 0.03).toFixed(0)}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-themed">
                <button onClick={() => setStep(0)} className="btn-ghost text-sm">Back</button>
                <button
                  onClick={async () => {
                    const ok = await handleSaveAccount();
                    if (ok) setStep(2);
                  }}
                  disabled={savingAccount}
                  className="btn-primary text-sm"
                >
                  {savingAccount ? <Loader2 size={16} className="animate-spin" /> : <ChevronRight size={16} />}
                  {savingAccount ? 'Saving...' : 'Continue'}
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="animate-fade-in">
              <div className="text-center mb-6">
                <div className="inline-flex p-3 rounded-2xl bg-orange-500/10 mb-3">
                  <Target size={28} className="text-orange-500" />
                </div>
                <h2 className="text-lg font-bold mb-2">Define your strategies & checklists</h2>
                <p className="text-secondary text-sm max-w-md mx-auto">
                  Each strategy gets its own checklist. When you log a trade, the checklist
                  for that strategy appears automatically.
                </p>
              </div>

              <div className="space-y-3 mb-4">
                <div>
                  <label className={labelCls}>Strategy Name</label>
                  <input
                    className={inputCls}
                    placeholder="e.g. London Breakout, Trend Following, Scalping"
                    value={strategyName}
                    onChange={e => setStrategyName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddStrategy()}
                  />
                </div>
                <div>
                  <label className={labelCls}>Description (optional)</label>
                  <input
                    className={inputCls}
                    placeholder="Brief description of when you use this strategy"
                    value={strategyDesc}
                    onChange={e => setStrategyDesc(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddStrategy()}
                  />
                </div>
                <button onClick={handleAddStrategy} disabled={addingStrategy} className="btn-secondary w-full justify-center">
                  <Plus size={16} /> {addingStrategy ? 'Adding...' : 'Add Strategy'}
                </button>
              </div>

              {strategies.length > 0 && (
                <div className="space-y-2 mb-4">
                  <p className="text-xs font-semibold text-muted uppercase tracking-wide">Your Strategies ({strategies.length})</p>
                  {strategies.map(s => (
                    <div key={s.id} className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all cursor-pointer group ${
                      selectedStrategyId === s.id ? 'border-orange-500 bg-orange-500/5' : 'border-themed bg-secondary hover:border-muted'
                    }`} onClick={() => setSelectedStrategyId(s.id)}>
                      <div className={`p-1.5 rounded-lg ${selectedStrategyId === s.id ? 'bg-orange-500/15' : 'bg-orange-500/10'}`}>
                        <Target size={16} className="text-orange-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{s.name}</p>
                        {s.description && <p className="text-xs text-muted truncate">{s.description}</p>}
                      </div>
                      {selectedStrategyId === s.id && <Check size={16} className="text-orange-500" />}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteStrategy(s.id); }}
                        className="text-muted hover:text-error-500 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {selectedStrategyId && checklistItems.length >= 0 && (
                <div className="p-4 rounded-xl bg-secondary border border-themed space-y-3">
                  <div className="flex items-center gap-2">
                    <ListChecks size={16} className="text-orange-500" />
                    <p className="text-xs font-semibold text-secondary uppercase tracking-wide">
                      Checklist: {strategies.find(s => s.id === selectedStrategyId)?.name}
                    </p>
                  </div>

                  {checklistItems.length > 0 ? (
                    <div className="space-y-2">
                      {checklistItems.map((item, idx) => (
                        <div key={item.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-card border border-themed group">
                          <span className="text-xs text-muted font-mono flex-shrink-0">{idx + 1}</span>
                          <span className="text-sm flex-1 truncate">{item.label}</span>
                          <span className={`badge ${item.is_required ? 'badge-error' : 'badge-neutral'} flex-shrink-0`}>
                            {item.is_required ? 'Required' : 'Optional'}
                          </span>
                          <button
                            onClick={() => handleDeleteChecklistItem(item.id)}
                            className="text-muted hover:text-error-500 transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted text-center py-2">No checklist items yet. Add some below.</p>
                  )}

                  <div className="pt-2 border-t border-themed">
                    <input
                      type="text"
                      className={inputCls}
                      placeholder="e.g. 'Confirmed market structure on 4H chart'"
                      value={newChecklistLabel}
                      onChange={e => setNewChecklistLabel(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAddChecklistItem()}
                    />
                    <div className="flex items-center gap-3 mt-2">
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newChecklistRequired}
                          onChange={e => setNewChecklistRequired(e.target.checked)}
                          className="w-4 h-4 rounded accent-orange-500"
                        />
                        <span className="text-secondary">Required</span>
                      </label>
                      <button
                        onClick={handleAddChecklistItem}
                        disabled={addingChecklist || !newChecklistLabel.trim()}
                        className="btn-primary ml-auto"
                      >
                        {addingChecklist ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                        Add Item
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {strategies.length === 0 && (
                <div className="text-center py-6 mb-4">
                  <p className="text-xs text-muted">Add at least one strategy to continue</p>
                </div>
              )}

              <div className="flex items-center justify-between pt-4 border-t border-themed">
                <button onClick={() => setStep(1)} className="btn-ghost text-sm">Back</button>
                <button
                  onClick={() => setStep(3)}
                  disabled={strategies.length === 0}
                  className="btn-primary text-sm"
                >
                  Continue <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="text-center animate-fade-in">
              <div className="inline-flex p-4 rounded-2xl bg-success-500/10 mb-5">
                <Check size={36} className="text-success-500" />
              </div>
              <h2 className="text-xl font-bold mb-3">You're all set!</h2>
              <p className="text-secondary text-sm leading-relaxed max-w-md mx-auto mb-6">
                You have {strategies.length} {strategies.length === 1 ? 'strategy' : 'strategies'} set up,
                each with its own checklist. When you log a trade, you'll pick a strategy and
                its checklist will guide your entry. Close the trade later to add your review.
              </p>

              {strategies.length > 0 && (
                <div className="flex flex-wrap justify-center gap-2 mb-6">
                  {strategies.map(s => (
                    <span key={s.id} className="badge badge-brand">
                      <Target size={12} /> {s.name}
                    </span>
                  ))}
                </div>
              )}

              <button onClick={onComplete} className="btn-primary mx-auto">
                Start Journaling <ArrowRight size={18} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
