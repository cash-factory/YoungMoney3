import { useState } from 'react';
import { ScrollText, Plus, Trash2, Save, AlertTriangle, Shield, Zap, Newspaper, Scale, XCircle } from 'lucide-react';
import { useTradingRules, useChecklist } from '@/hooks/useData';
import { useAuth } from '@/context/AuthContext';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { LoadingSpinner, EmptyState } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Modal';
import { StatCard } from '@/components/ui/StatCard';
import type { TradingRule, TradingRuleInput, RuleCategory, PreTradeChecklistItem, PreTradeChecklistInput } from '@/lib/types';

const CATEGORIES: RuleCategory[] = ['risk', 'entry', 'exit', 'discipline', 'news', 'position_sizing'];

const CATEGORY_CONFIG: Record<RuleCategory, { label: string; icon: typeof Shield; color: string }> = {
  risk: { label: 'Risk', icon: Shield, color: 'text-error-500' },
  entry: { label: 'Entry', icon: Zap, color: 'text-brand-500' },
  exit: { label: 'Exit', icon: XCircle, color: 'text-warning-500' },
  discipline: { label: 'Discipline', icon: ScrollText, color: 'text-accent-500' },
  news: { label: 'News', icon: Newspaper, color: 'text-blue-500' },
  position_sizing: { label: 'Position Sizing', icon: Scale, color: 'text-success-500' },
};

export function RulesChecklistPage() {
  const { user } = useAuth();
  const { rules, loading: rulesLoading, upsertRule, deleteRule, incrementBroken } = useTradingRules(user?.id);
  const { checklist, loading: checklistLoading, addChecklistItem, updateChecklistItem, deleteChecklistItem } = useChecklist(user?.id);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [editingRule, setEditingRule] = useState<TradingRule | null>(null);
  const [showChecklistForm, setShowChecklistForm] = useState(false);
  const [newChecklistLabel, setNewChecklistLabel] = useState('');
  const [newChecklistRequired, setNewChecklistRequired] = useState(true);

  const loading = rulesLoading || checklistLoading;

  const activeRules = rules.filter(r => r.is_active);
  const totalBroken = rules.reduce((s, r) => s + r.times_broken, 0);
  const requiredChecklist = checklist.filter(c => c.is_required).length;

  const handleSaveRule = async (data: TradingRuleInput, id?: string) => {
    await upsertRule(data, id);
    setShowRuleForm(false);
    setEditingRule(null);
  };

  const handleDeleteRule = async (id: string) => {
    if (confirm('Delete this rule?')) await deleteRule(id);
  };

  const handleAddChecklist = async () => {
    if (!newChecklistLabel.trim()) return;
    await addChecklistItem(newChecklistLabel.trim(), newChecklistRequired);
    setNewChecklistLabel('');
    setNewChecklistRequired(true);
    setShowChecklistForm(false);
  };

  if (loading) return <LoadingSpinner label="Loading rules..." />;

  return (
    <div>
      <SectionHeader
        title="Rules & Checklist"
        subtitle="Define your trading rules and pre-trade checklist to stay disciplined"
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Active Rules" value={String(activeRules.length)} icon={<ScrollText size={20} />} accent="blue" />
        <StatCard label="Rules Broken" value={String(totalBroken)} icon={<AlertTriangle size={20} />} accent="rose" />
        <StatCard label="Checklist Items" value={String(checklist.length)} icon={<Shield size={20} />} accent="emerald" sublabel={`${requiredChecklist} required`} />
      </div>

      {/* Trading Rules */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2"><ScrollText size={18} className="text-brand-500" /> Trading Rules</h2>
          <button onClick={() => { setEditingRule(null); setShowRuleForm(true); }} className="btn-primary text-sm">
            <Plus size={16} /> Add Rule
          </button>
        </div>

        {rules.length === 0 ? (
          <div className="card p-8">
            <EmptyState icon={<ScrollText size={40} />} title="No rules yet" message="Create trading rules for risk, entry, exit, and discipline to hold yourself accountable." />
          </div>
        ) : (
          <div className="space-y-2">
            {rules.map(rule => (
              <RuleRow key={rule.id} rule={rule} onEdit={() => { setEditingRule(rule); setShowRuleForm(true); }} onDelete={() => handleDeleteRule(rule.id)} onBroken={() => incrementBroken(rule.id)} />
            ))}
          </div>
        )}
      </div>

      {/* Pre-Trade Checklist */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2"><Shield size={18} className="text-brand-500" /> Pre-Trade Checklist</h2>
          <button onClick={() => setShowChecklistForm(true)} className="btn-primary text-sm">
            <Plus size={16} /> Add Item
          </button>
        </div>

        {checklist.length === 0 ? (
          <div className="card p-8">
            <EmptyState icon={<Shield size={40} />} title="No checklist items" message="Create a pre-trade checklist to run through before every trade." />
          </div>
        ) : (
          <div className="card p-4 space-y-2">
            {checklist.map(item => (
              <ChecklistRow key={item.id} item={item} onUpdate={(updates) => updateChecklistItem(item.id, updates)} onDelete={() => deleteChecklistItem(item.id)} />
            ))}
          </div>
        )}
      </div>

      <Modal open={showRuleForm} onClose={() => { setShowRuleForm(false); setEditingRule(null); }} title={editingRule ? 'Edit Rule' : 'New Rule'} size="md">
        <RuleForm initial={editingRule} onSave={handleSaveRule} onCancel={() => { setShowRuleForm(false); setEditingRule(null); }} />
      </Modal>

      <Modal open={showChecklistForm} onClose={() => setShowChecklistForm(false)} title="Add Checklist Item" size="sm">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-secondary mb-1.5">Checklist Item</label>
            <input className="input-field" value={newChecklistLabel} onChange={e => setNewChecklistLabel(e.target.value)} placeholder="e.g. Higher timeframe trend confirmed" autoFocus />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={newChecklistRequired} onChange={e => setNewChecklistRequired(e.target.checked)} className="w-4 h-4 rounded" />
            <span className="text-sm">Required item</span>
          </label>
          <div className="flex gap-3 pt-2">
            <button onClick={handleAddChecklist} disabled={!newChecklistLabel.trim()} className="btn-primary flex-1"><Save size={16} /> Add</button>
            <button onClick={() => setShowChecklistForm(false)} className="btn-secondary">Cancel</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function RuleRow({ rule, onEdit, onDelete, onBroken }: { rule: TradingRule; onEdit: () => void; onDelete: () => void; onBroken: () => void }) {
  const config = CATEGORY_CONFIG[rule.category];
  const Icon = config.icon;

  return (
    <div className="card p-3 flex items-center gap-3 card-hover">
      <div className={`p-2 rounded-lg bg-secondary ${config.color}`}>
        <Icon size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{rule.rule_text}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="badge badge-neutral text-[10px]">{config.label}</span>
          <span className="text-[10px] text-muted">Priority {rule.priority}</span>
          {rule.times_broken > 0 && (
            <span className="badge badge-error text-[10px]">Broken {rule.times_broken}x</span>
          )}
          {!rule.is_active && <span className="badge badge-neutral text-[10px]">Inactive</span>}
        </div>
      </div>
      <div className="flex gap-1">
        <button onClick={onBroken} className="btn-ghost p-1.5 text-warning-500 hover:bg-warning-500/10" title="Mark as broken">
          <AlertTriangle size={14} />
        </button>
        <button onClick={onEdit} className="btn-ghost p-1.5 text-xs">Edit</button>
        <button onClick={onDelete} className="btn-ghost p-1.5 text-error-500 hover:bg-error-500/10"><Trash2 size={14} /></button>
      </div>
    </div>
  );
}

function ChecklistRow({ item, onUpdate, onDelete }: { item: PreTradeChecklistItem; onUpdate: (updates: Partial<PreTradeChecklistInput>) => void; onDelete: () => void }) {
  return (
    <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-secondary transition-colors group">
      <button
        onClick={() => onUpdate({ is_active: !item.is_active })}
        className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${item.is_active ? 'bg-success-500 border-success-500 text-white' : 'border-themed'}`}
      >
        {item.is_active && '✓'}
      </button>
      <span className="text-sm flex-1">{item.label}</span>
      {item.is_required && <span className="badge badge-error text-[10px]">Required</span>}
      <button onClick={() => onUpdate({ is_required: !item.is_required })} className="btn-ghost p-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity">
        {item.is_required ? 'Make optional' : 'Make required'}
      </button>
      <button onClick={onDelete} className="btn-ghost p-1 text-error-500 hover:bg-error-500/10 opacity-0 group-hover:opacity-100 transition-opacity">
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function RuleForm({ initial, onSave, onCancel }: { initial: TradingRule | null; onSave: (data: TradingRuleInput, id?: string) => void; onCancel: () => void }) {
  const [ruleText, setRuleText] = useState(initial?.rule_text || '');
  const [category, setCategory] = useState<RuleCategory>(initial?.category || 'risk');
  const [priority, setPriority] = useState(initial?.priority ?? 1);
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave({
      rule_text: ruleText,
      category,
      priority,
      is_active: isActive,
      times_broken: initial?.times_broken ?? 0,
    }, initial?.id);
    setSaving(false);
  };

  const inputCls = 'input-field';
  const labelCls = 'block text-xs font-semibold text-secondary mb-1.5';

  return (
    <div className="space-y-4">
      <div>
        <label className={labelCls}>Rule</label>
        <textarea className={inputCls} rows={3} value={ruleText} onChange={e => setRuleText(e.target.value)} placeholder="e.g. Never risk more than 2% of account on a single trade" autoFocus />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Category</label>
          <select className={inputCls} value={category} onChange={e => setCategory(e.target.value as RuleCategory)}>
            {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_CONFIG[c].label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Priority</label>
          <input type="number" className={inputCls} value={priority} onChange={e => setPriority(parseInt(e.target.value) || 1)} min={1} max={10} />
        </div>
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="w-4 h-4 rounded" />
        <span className="text-sm">Active</span>
      </label>
      <div className="flex gap-3 pt-2">
        <button onClick={handleSave} disabled={saving || !ruleText} className="btn-primary flex-1">
          <Save size={16} /> {saving ? 'Saving...' : 'Save Rule'}
        </button>
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
      </div>
    </div>
  );
}
