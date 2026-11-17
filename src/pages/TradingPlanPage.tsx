import { Select } from '@/components/Select';
import { useState } from 'react';
import { ClipboardList, Plus, Trash2, Save, FileText, Target, Shield, GitBranch, Map, Eye, Layers, ScrollText, ListChecks, ChevronDown } from 'lucide-react';
import { useChecklist, useTradingPlans, useTradingRules } from '@/hooks/useData';
import { ScreenshotUpload } from '@/components/ScreenshotUpload';
import { VoiceRecorder } from '@/components/VoiceRecorder';
import { MediaImage, MediaAudioPlayer } from '@/components/MediaPreview';
import { useAuth } from '@/context/AuthContext';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { LoadingSpinner, EmptyState } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Modal';
import type { PreTradeChecklistItem, TradingPlan, TradingPlanInput, TradingRule, TradingRuleInput, RuleCategory } from '@/lib/types';
import { format } from 'date-fns';
import { parseISO } from 'date-fns';
import { DEFAULT_USER_TRADING_PLAN } from '@/data/workspaceDefaults';

const PLAN_SECTIONS: { key: keyof TradingPlanInput; label: string; icon: typeof Target; placeholder: string }[] = [
  { key: 'philosophy', label: 'Trading Philosophy', icon: Target, placeholder: 'Your core trading beliefs and principles...' },
  { key: 'htf_selection', label: 'HTF POI Selection', icon: Eye, placeholder: 'How you select points of interest on higher timeframes...' },
  { key: 'ltf_execution', label: 'LTF Execution', icon: Layers, placeholder: 'How you execute entries on lower timeframes...' },
  { key: 'trade_management', label: 'Trade Management', icon: GitBranch, placeholder: 'How you manage open positions (partial closes, trailing stops, etc.)...' },
  { key: 'risk_management', label: 'Risk Management', icon: Shield, placeholder: 'Position sizing, max risk per trade, daily loss limits...' },
  { key: 'mapping_process', label: 'Mapping Process', icon: Map, placeholder: 'Your step-by-step process for mapping the markets...' },
  { key: 'entry_models', label: 'Legacy Entry Model Notes', icon: Layers, placeholder: 'Historical notes only. Create new entry models under a strategy in Strategy Library...' },
  { key: 'market_conditions', label: 'Market Conditions', icon: Eye, placeholder: 'Which market conditions you trade vs. avoid...' },
  { key: 'additional_notes', label: 'Additional Notes', icon: FileText, placeholder: 'Anything else worth noting...' },
];

export function TradingPlanPage() {
  const { user } = useAuth();
  const { plans, loading, upsertPlan, deletePlan } = useTradingPlans(user?.id);
  const { checklist, addChecklistItem, updateChecklistItem, deleteChecklistItem } = useChecklist(user?.id);
  const { rules, upsertRule, deleteRule } = useTradingRules(user?.id);
  const [showForm, setShowForm] = useState(false);
  const [editingPlan, setEditingPlan] = useState<TradingPlan | null>(null);

  const handleSave = async (data: TradingPlanInput, id?: string) => {
    await upsertPlan(data, id);
    setShowForm(false);
    setEditingPlan(null);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this trading plan?')) await deletePlan(id);
  };

  if (loading) return <LoadingSpinner label="Loading trading plans..." />;

  return (
    <div>
      <SectionHeader
        title="Trading Plan"
        subtitle="Define the operating rules that strategies follow"
        action={
          <button onClick={() => { setEditingPlan(null); setShowForm(true); }} className="btn-primary">
            <Plus size={18} /> New Plan
          </button>
        }
      />

      <div className="mb-5 rounded-xl border border-themed bg-secondary/40 p-4 text-xs text-secondary">
        <strong className="text-primary">Workflow:</strong> Plan rules → Strategy → Entry Model → entry checklist → Context → Trade. General risk and discipline rules live in the plan; entry-specific checklist items live with their strategy or model.
      </div>

      {plans.length === 0 ? (
        <div className="card p-8">
          <EmptyState icon={<ClipboardList size={40} />} title="No trading plan yet" message="Create your trading plan to document your philosophy, entry models, risk rules, and mapping process." />
        </div>
      ) : (
        <div className="space-y-4">
          {plans.map(plan => (
            <PlanCard key={plan.id} plan={plan} rules={rules.filter(rule => rule.plan_id === plan.id)} checklist={checklist.filter(item => item.plan_id === plan.id)} onAddRule={(data) => upsertRule(data)} onUpdateRule={(rule) => upsertRule(rule, rule.id)} onDeleteRule={deleteRule} onAddChecklist={(label, required) => addChecklistItem(label, required, plan.id)} onUpdateChecklist={updateChecklistItem} onDeleteChecklist={deleteChecklistItem} onEdit={() => { setEditingPlan(plan); setShowForm(true); }} onDelete={() => handleDelete(plan.id)} />
          ))}
        </div>
      )}

      {(rules.some(rule => !rule.plan_id) || checklist.some(item => !item.plan_id)) && <LegacyPlanItems plans={plans} rules={rules.filter(rule => !rule.plan_id)} checklist={checklist.filter(item => !item.plan_id)} onAssignRule={(rule, planId) => upsertRule({ ...rule, plan_id: planId }, rule.id)} onAssignChecklist={(item, planId) => updateChecklistItem(item.id, { plan_id: planId })} />}

      <Modal open={showForm} onClose={() => { setShowForm(false); setEditingPlan(null); }} title={editingPlan ? 'Edit Trading Plan' : 'New Trading Plan'} size="lg">
        <PlanForm initial={editingPlan} onSave={handleSave} onCancel={() => { setShowForm(false); setEditingPlan(null); }} />
      </Modal>
    </div>
  );
}

function PlanCard({ plan, rules, checklist, onAddRule, onUpdateRule, onDeleteRule, onAddChecklist, onUpdateChecklist, onDeleteChecklist, onEdit, onDelete }: {
  plan: TradingPlan; rules: TradingRule[]; checklist: PreTradeChecklistItem[];
  onAddRule: (rule: TradingRuleInput) => Promise<void>; onUpdateRule: (rule: TradingRule) => Promise<void>; onDeleteRule: (id: string) => Promise<void>;
  onAddChecklist: (label: string, required: boolean) => Promise<void>; onUpdateChecklist: (id: string, update: Partial<import('@/lib/types').PreTradeChecklistInput>) => Promise<void>; onDeleteChecklist: (id: string) => Promise<void>;
  onEdit: () => void; onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [newRule, setNewRule] = useState('');
  const [ruleCategory, setRuleCategory] = useState<RuleCategory>('discipline');
  const [newCheck, setNewCheck] = useState('');
  const [checkRequired, setCheckRequired] = useState(true);
  const [saving, setSaving] = useState(false);
  const sections = PLAN_SECTIONS.filter(s => plan[s.key]);
  const adherence = plan.adherence_score != null ? `${plan.adherence_score}%` : null;

  return (
    <div className="card p-5 card-hover">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-base font-bold">{plan.title}</h3>
            {adherence && <span className="badge badge-success">{adherence} adherence</span>}
          </div>
          <p className="text-xs text-muted">Created {format(parseISO(plan.created_at), 'MMM d, yyyy')}</p>
        </div>
        <div className="flex gap-1">
          <button onClick={onEdit} className="btn-ghost p-1.5"><FileText size={16} /></button>
          <button onClick={onDelete} className="btn-ghost p-1.5 text-error-500 hover:bg-error-500/10"><Trash2 size={16} /></button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sections.map(({ key, label, icon: Icon }) => (
          <div key={key}>
            <p className="text-xs font-semibold text-secondary mb-1 flex items-center gap-1.5"><Icon size={12} /> {label}</p>
            <p className="text-sm whitespace-pre-wrap">{plan[key] as string}</p>
          </div>
        ))}
      </div>
        <div className="mt-4 rounded-xl border border-themed bg-secondary/40 p-3">
          <p className="text-xs font-semibold text-secondary">Plan risk guardrails</p>
          <p className="mt-1 text-xs text-muted">
            Risk / trade: {plan.max_risk_per_trade_pct ?? 'Not set'}% · Daily loss: {plan.max_daily_loss_pct ?? 'Not set'}% · Max drawdown: {plan.max_drawdown_pct ?? 'Not set'}%
          </p>
        </div>
      <div className="mt-4 border-t border-themed pt-3">
        <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)} className="flex w-full items-center justify-between text-left text-sm font-semibold"><span className="flex items-center gap-2"><ScrollText size={15} className="text-orange-500" /> Plan rules & checks <span className="text-xs font-normal text-muted">{rules.length} rules · {checklist.length} checks</span></span><ChevronDown size={16} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} /></button>
        {expanded && <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-5">
          <section className="space-y-2"><h4 className="text-xs font-bold flex gap-2 items-center"><ScrollText size={14} /> Trading rules</h4>
            <div className="flex flex-col sm:flex-row gap-2"><input className="input-field flex-1" value={newRule} onChange={e => setNewRule(e.target.value)} placeholder="e.g. Risk no more than 1%" /><Select className="input-field sm:w-36" value={ruleCategory} onChange={e => setRuleCategory(e.target.value as RuleCategory)}>{(['risk','entry','exit','discipline','news','position_sizing'] as RuleCategory[]).map(category => <option key={category} value={category}>{category.replace('_',' ')}</option>)}</Select><button type="button" disabled={saving || !newRule.trim()} className="btn-secondary" onClick={async () => { setSaving(true); try { await onAddRule({ plan_id: plan.id, rule_text: newRule.trim(), category: ruleCategory, priority: rules.length + 1, is_active: true, times_broken: 0 }); setNewRule(''); } finally { setSaving(false); } }}><Plus size={14} /> Add</button></div>
            {rules.length === 0 ? <p className="text-xs text-muted">No plan rules added.</p> : <div className="space-y-1">{rules.map(rule => <div key={rule.id} className="flex items-center gap-2 rounded-lg border border-themed px-2.5 py-2 text-xs"><input type="checkbox" aria-label={`Rule active: ${rule.rule_text}`} checked={rule.is_active} onChange={e => onUpdateRule({ ...rule, is_active: e.target.checked })} /><span className={`flex-1 ${rule.is_active ? '' : 'text-muted line-through'}`}>{rule.rule_text}</span><span className="text-muted">{rule.category.replace('_',' ')}</span><button type="button" aria-label="Delete rule" onClick={() => onDeleteRule(rule.id)} className="text-muted hover:text-error-500"><Trash2 size={13} /></button></div>)}</div>}
          </section>
          <section className="space-y-2"><h4 className="text-xs font-bold flex gap-2 items-center"><ListChecks size={14} /> Plan-level checks</h4>
            <div className="flex flex-col sm:flex-row gap-2"><input className="input-field flex-1" value={newCheck} onChange={e => setNewCheck(e.target.value)} placeholder="e.g. Daily risk limit respected" /><label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={checkRequired} onChange={e => setCheckRequired(e.target.checked)} /> Required</label><button type="button" disabled={saving || !newCheck.trim()} className="btn-secondary" onClick={async () => { setSaving(true); try { await onAddChecklist(newCheck.trim(), checkRequired); setNewCheck(''); } finally { setSaving(false); } }}><Plus size={14} /> Add</button></div>
            {checklist.length === 0 ? <p className="text-xs text-muted">No plan-level checks added. Entry checks belong to strategies/models.</p> : <div className="space-y-1">{checklist.map(item => <div key={item.id} className="flex items-center gap-2 rounded-lg border border-themed px-2.5 py-2 text-xs"><input type="checkbox" aria-label={`Use check ${item.label}`} checked={item.is_active} onChange={e => onUpdateChecklist(item.id, { is_active: e.target.checked })} /><span className={`flex-1 ${item.is_active ? '' : 'text-muted line-through'}`}>{item.label}</span><button type="button" aria-label={`Toggle required for ${item.label}`} onClick={() => onUpdateChecklist(item.id, { is_required: !item.is_required })} className="badge badge-warning">{item.is_required ? 'Required' : 'Optional'}</button><button type="button" aria-label="Delete checklist item" onClick={() => onDeleteChecklist(item.id)} className="text-muted hover:text-error-500"><Trash2 size={13} /></button></div>)}</div>}
          </section>
        </div>}
      </div>
      {plan.screenshot_url && <div className="mt-4"><MediaImage source={plan.screenshot_url} alt={`${plan.title} attachment`} className="max-h-64 rounded-lg object-contain" /></div>}
      {plan.voice_note_url && <div className="mt-3"><MediaAudioPlayer source={plan.voice_note_url} /></div>}
    </div>
  );
}

function LegacyPlanItems({ plans, rules, checklist, onAssignRule, onAssignChecklist }: { plans: TradingPlan[]; rules: TradingRule[]; checklist: PreTradeChecklistItem[]; onAssignRule: (rule: TradingRule, planId: string) => Promise<void>; onAssignChecklist: (item: PreTradeChecklistItem, planId: string) => Promise<void> }) {
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  if (!plans.length) return <div className="mt-6 card p-4 text-xs text-secondary">Legacy global rules and checks are preserved here. Create a plan to assign them; they are not used in trade checklists while unassigned.</div>;
  if (!rules.length && !checklist.length) return null;
  return <details className="mt-6 card p-4"><summary className="cursor-pointer text-sm font-semibold">Unassigned legacy rules & checks <span className="text-xs font-normal text-muted">· preserved; select a plan to assign</span></summary><div className="mt-3 space-y-2">
    {[...rules.map(item => ({ kind: 'rule' as const, id: item.id, label: item.rule_text, item })), ...checklist.map(item => ({ kind: 'check' as const, id: item.id, label: item.label, item }))].map(row => <div key={`${row.kind}-${row.id}`} className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-lg border border-themed p-2.5"><span className="flex-1 text-xs"><strong className="text-muted">{row.kind === 'rule' ? 'Rule' : 'Check'} · </strong>{row.label}</span><Select className="input-field sm:w-52" value={assignments[row.id] || ''} onChange={e => setAssignments(state => ({ ...state, [row.id]: e.target.value }))}><option value="">Choose plan</option>{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.title}</option>)}</Select><button type="button" disabled={!assignments[row.id]} className="btn-secondary text-xs" onClick={() => row.kind === 'rule' ? onAssignRule(row.item as TradingRule, assignments[row.id]) : onAssignChecklist(row.item as PreTradeChecklistItem, assignments[row.id])}>Assign</button></div>)}
  </div></details>;
}

function PlanForm({ initial, onSave, onCancel }: { initial: TradingPlan | null; onSave: (data: TradingPlanInput, id?: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(initial?.title || '');
  const [sections, setSections] = useState<Record<string, string>>(
    Object.fromEntries(PLAN_SECTIONS.map(s => [s.key, (initial?.[s.key] as string) || '']))
  );
  const [adherence, setAdherence] = useState(initial?.adherence_score?.toString() || '');
  const [maxRisk, setMaxRisk] = useState(initial?.max_risk_per_trade_pct?.toString() || '');
  const [dailyLoss, setDailyLoss] = useState(initial?.max_daily_loss_pct?.toString() || '');
  const [maxDrawdown, setMaxDrawdown] = useState(initial?.max_drawdown_pct?.toString() || '');
  const [screenshotUrl, setScreenshotUrl] = useState(initial?.screenshot_url || null);
  const [voiceUrl, setVoiceUrl] = useState(initial?.voice_note_url || null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave({
      title,
      philosophy: sections.philosophy || null,
      htf_selection: sections.htf_selection || null,
      ltf_execution: sections.ltf_execution || null,
      trade_management: sections.trade_management || null,
      risk_management: sections.risk_management || null,
      max_risk_per_trade_pct: maxRisk ? Number(maxRisk) : null,
      max_daily_loss_pct: dailyLoss ? Number(dailyLoss) : null,
      max_drawdown_pct: maxDrawdown ? Number(maxDrawdown) : null,
      mapping_process: sections.mapping_process || null,
      entry_models: sections.entry_models || null,
      market_conditions: sections.market_conditions || null,
      additional_notes: sections.additional_notes || null,
      adherence_score: adherence ? parseFloat(adherence) : null,
      screenshot_url: screenshotUrl || null,
      voice_note_url: voiceUrl || null,
    }, initial?.id);
    setSaving(false);
  };

  const inputCls = 'input-field';
  const labelCls = 'block text-xs font-semibold text-secondary mb-1.5';

  return (
    <div className="space-y-5">
      <div>
        <label className={labelCls}>Plan Title</label>
        <input className={inputCls} value={title} onChange={e => setTitle(e.target.value)} placeholder="My Multi-Timeframe Trading Plan" />
      </div>

      {PLAN_SECTIONS.map(({ key, label, icon: Icon, placeholder }) => (
        <div key={key}>
          <label className={`${labelCls} flex items-center gap-1.5`}><Icon size={13} /> {label}</label>
          <textarea
            className={inputCls}
            rows={3}
            placeholder={placeholder}
            value={sections[key] || ''}
            onChange={e => setSections(s => ({ ...s, [key]: e.target.value }))}
          />
        </div>
      ))}

      <section className="rounded-xl border border-themed p-4 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Shield size={15} /> Numeric risk guardrails</h3>
        <p className="text-xs text-muted">These limits belong to this plan and inform sizing and warnings. Account and prop-firm rules remain separate monitoring references.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs font-medium">Max risk per trade (%)<input type="number" min="0" max="100" step="0.01" className="input-field mt-1" value={maxRisk} onChange={event => setMaxRisk(event.target.value)} placeholder="Optional" /></label>
          <label className="text-xs font-medium">Daily loss limit (%)<input type="number" min="0" max="100" step="0.01" className="input-field mt-1" value={dailyLoss} onChange={event => setDailyLoss(event.target.value)} placeholder="Optional" /></label>
          <label className="text-xs font-medium">Max drawdown (%)<input type="number" min="0" max="100" step="0.01" className="input-field mt-1" value={maxDrawdown} onChange={event => setMaxDrawdown(event.target.value)} placeholder="Optional" /></label>
        </div>
      </section>
      {initial && <button type="button" className="btn-secondary w-full" onClick={() => {
        if (!confirm('Restore the generic default plan text and clear its numeric risk limits? Your saved rules, checklist, attachments, and adherence score will be kept.')) return;
        setTitle(DEFAULT_USER_TRADING_PLAN.title);
        const restoredSections: Record<string, string> = {};
        PLAN_SECTIONS.forEach(section => {
          const value = DEFAULT_USER_TRADING_PLAN[section.key];
          restoredSections[section.key] = typeof value === 'string' ? value : '';
        });
        setSections(restoredSections);
        setMaxRisk(''); setDailyLoss(''); setMaxDrawdown('');
      }}>Restore default plan content</button>}

      <div>
        <label className={labelCls}>Adherence Score (%)</label>
        <input type="number" className={inputCls} value={adherence} onChange={e => setAdherence(e.target.value)} placeholder="e.g. 85" />
      </div>
      <div><label className={labelCls}>Plan attachment</label><ScreenshotUpload onUpload={setScreenshotUrl} existingUrl={screenshotUrl} label="Upload plan image" /></div>
      <div><label className={labelCls}>Voice note</label><VoiceRecorder onUpload={setVoiceUrl} existingUrl={voiceUrl} /></div>

      <div className="flex gap-3 pt-2">
        <button onClick={handleSave} disabled={saving || !title} className="btn-primary flex-1">
          <Save size={16} /> {saving ? 'Saving...' : 'Save Plan'}
        </button>
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
      </div>
    </div>
  );
}
