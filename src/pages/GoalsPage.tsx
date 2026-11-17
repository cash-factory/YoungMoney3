import { Select } from '@/components/Select';
import { useState } from 'react';
import { Target, Plus, Trash2, Save, CheckCircle2, Circle, Pause, Play, XCircle, TrendingUp, Calendar } from 'lucide-react';
import { useGoals } from '@/hooks/useData';
import { useAuth } from '@/context/AuthContext';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { LoadingSpinner, EmptyState } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Modal';
import { StatCard } from '@/components/ui/StatCard';
import type { Goal, GoalInput, GoalCategory, GoalStatus } from '@/lib/types';
import { format, parseISO, differenceInDays } from 'date-fns';

const CATEGORIES: GoalCategory[] = ['profit', 'win_rate', 'discipline', 'risk', 'growth', 'process', 'personal', 'general'];
const STATUSES: GoalStatus[] = ['active', 'completed', 'paused', 'failed'];

const CATEGORY_LABELS: Record<GoalCategory, string> = {
  profit: 'Profit', win_rate: 'Win Rate', discipline: 'Discipline', risk: 'Risk', growth: 'Growth', process: 'Process', personal: 'Personal', general: 'General',
};

const STATUS_CONFIG: Record<GoalStatus, { label: string; icon: typeof Circle; color: string }> = {
  active: { label: 'Active', icon: Play, color: 'badge-brand' },
  completed: { label: 'Completed', icon: CheckCircle2, color: 'badge-success' },
  paused: { label: 'Paused', icon: Pause, color: 'badge-neutral' },
  failed: { label: 'Failed', icon: XCircle, color: 'badge-error' },
};

export function GoalsPage() {
  const { user } = useAuth();
  const { goals, loading, upsertGoal, deleteGoal } = useGoals(user?.id);
  const [showForm, setShowForm] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [filterStatus, setFilterStatus] = useState<GoalStatus | ''>('');

  const filtered = filterStatus ? goals.filter(g => g.status === filterStatus) : goals;

  const activeCount = goals.filter(g => g.status === 'active').length;
  const completedCount = goals.filter(g => g.status === 'completed').length;
  const avgProgress = goals.length
    ? Math.round(goals.reduce((sum, g) => {
        if (g.target_value && g.current_value != null) {
          return sum + Math.min(100, (g.current_value / g.target_value) * 100);
        }
        return sum;
      }, 0) / goals.length)
    : 0;

  const handleSave = async (data: GoalInput, id?: string) => {
    await upsertGoal(data, id);
    setShowForm(false);
    setEditingGoal(null);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this goal?')) await deleteGoal(id);
  };

  const toggleStatus = async (goal: Goal) => {
    const newStatus: GoalStatus = goal.status === 'active' ? 'completed' : 'active';
    await upsertGoal({ ...goal, status: newStatus } as GoalInput, goal.id);
  };

  if (loading) return <LoadingSpinner label="Loading goals..." />;

  return (
    <div>
      <SectionHeader
        title="Goals"
        subtitle="Set and track your trading goals across annual, quarterly, and monthly horizons"
        action={
          <button onClick={() => { setEditingGoal(null); setShowForm(true); }} className="btn-primary">
            <Plus size={18} /> New Goal
          </button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Active Goals" value={String(activeCount)} icon={<Target size={20} />} accent="blue" />
        <StatCard label="Completed" value={String(completedCount)} icon={<CheckCircle2 size={20} />} accent="emerald" />
        <StatCard label="Avg Progress" value={`${avgProgress}%`} icon={<TrendingUp size={20} />} accent="amber" />
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        <button
          onClick={() => setFilterStatus('')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${filterStatus === '' ? 'bg-brand-500/10 text-brand-600 dark:text-brand-400 border-brand-500/20' : 'bg-secondary border-themed text-secondary hover:border-muted'}`}
        >
          All
        </button>
        {STATUSES.map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all capitalize ${filterStatus === s ? 'bg-brand-500/10 text-brand-600 dark:text-brand-400 border-brand-500/20' : 'bg-secondary border-themed text-secondary hover:border-muted'}`}
          >
            {STATUS_CONFIG[s].label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card p-8">
          <EmptyState icon={<Target size={40} />} title="No goals yet" message="Set profit targets, win rate goals, discipline metrics, or process goals to keep yourself accountable." />
        </div>
      ) : (
        <div className="ym-goal-board grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(goal => (
            <GoalCard key={goal.id} goal={goal} onEdit={() => { setEditingGoal(goal); setShowForm(true); }} onDelete={() => handleDelete(goal.id)} onToggle={() => toggleStatus(goal)} />
          ))}
        </div>
      )}

      <Modal open={showForm} onClose={() => { setShowForm(false); setEditingGoal(null); }} title={editingGoal ? 'Edit Goal' : 'New Goal'} size="lg">
        <GoalForm initial={editingGoal} onSave={handleSave} onCancel={() => { setShowForm(false); setEditingGoal(null); }} />
      </Modal>
    </div>
  );
}

function GoalCard({ goal, onEdit, onDelete, onToggle }: { goal: Goal; onEdit: () => void; onDelete: () => void; onToggle: () => void }) {
  const config = STATUS_CONFIG[goal.status];
  const progress = goal.target_value && goal.current_value != null
    ? Math.min(100, (goal.current_value / goal.target_value) * 100)
    : null;

  const daysLeft = goal.deadline ? differenceInDays(parseISO(goal.deadline), new Date()) : null;

  return (
    <div className="card p-5 card-hover">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <button onClick={onToggle} className="text-secondary hover:text-brand-500 transition-colors">
              {goal.status === 'completed' ? <CheckCircle2 size={18} className="text-success-500" /> : <Circle size={18} />}
            </button>
            <h3 className={`text-sm font-bold ${goal.status === 'completed' ? 'line-through text-muted' : ''}`}>{goal.title}</h3>
          </div>
          {goal.description && <p className="text-xs text-secondary ml-7">{goal.description}</p>}
        </div>
        <div className="flex gap-1 ml-2">
          <button onClick={onEdit} className="btn-ghost p-1.5 text-xs">Edit</button>
          <button onClick={onDelete} className="btn-ghost p-1.5 text-error-500 hover:bg-error-500/10"><Trash2 size={14} /></button>
        </div>
      </div>

      <div className="flex items-center gap-2 ml-7 mb-3">
        <span className={`badge ${config.color}`}>{config.label}</span>
        <span className="badge badge-neutral">{CATEGORY_LABELS[goal.category]}</span>
        {daysLeft != null && daysLeft >= 0 && (
          <span className="badge badge-warning">{daysLeft}d left</span>
        )}
        {daysLeft != null && daysLeft < 0 && goal.status === 'active' && (
          <span className="badge badge-error">Overdue</span>
        )}
      </div>

      {progress != null && (
        <div className="ml-7">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted">Progress</span>
            <span className="text-xs font-semibold">{goal.current_value} / {goal.target_value} ({progress.toFixed(0)}%)</span>
          </div>
          <div className="h-2 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-orange-400 to-orange-600 transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {goal.deadline && (
        <p className="mt-2 ml-7 text-xs text-muted flex items-center gap-1">
          <Calendar size={11} /> Due {format(parseISO(goal.deadline), 'MMM d, yyyy')}
        </p>
      )}
    </div>
  );
}

function GoalForm({ initial, onSave, onCancel }: { initial: Goal | null; onSave: (data: GoalInput, id?: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(initial?.title || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [category, setCategory] = useState<GoalCategory>(initial?.category || 'profit');
  const [targetMetric, setTargetMetric] = useState(initial?.target_metric || '');
  const [targetValue, setTargetValue] = useState(initial?.target_value?.toString() || '');
  const [currentValue, setCurrentValue] = useState(initial?.current_value?.toString() || '');
  const [deadline, setDeadline] = useState(initial?.deadline || '');
  const [status, setStatus] = useState<GoalStatus>(initial?.status || 'active');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave({
      title,
      description: description || null,
      category,
      target_metric: targetMetric || null,
      target_value: targetValue ? parseFloat(targetValue) : null,
      current_value: currentValue ? parseFloat(currentValue) : null,
      deadline: deadline || null,
      status,
      goal_type: category === 'personal' ? 'personal' : category === 'general' ? 'general' : 'trading',
      priority: initial?.priority || 'medium',
      progress_notes: initial?.progress_notes || null,
      year: initial?.year || new Date().getFullYear(),
      is_template: initial?.is_template || false,
    }, initial?.id);
    setSaving(false);
  };

  const inputCls = 'input-field';
  const labelCls = 'block text-xs font-semibold text-secondary mb-1.5';

  return (
    <div className="space-y-4">
      <div>
        <label className={labelCls}>Goal Title</label>
        <input className={inputCls} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Achieve 60% win rate this quarter" />
      </div>

      <div>
        <label className={labelCls}>Description</label>
        <textarea className={inputCls} rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="Why this goal matters..." />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Category</label>
          <Select className={inputCls} value={category} onChange={e => setCategory(e.target.value as GoalCategory)}>
            {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </Select>
        </div>
        <div>
          <label className={labelCls}>Status</label>
          <Select className={inputCls} value={status} onChange={e => setStatus(e.target.value as GoalStatus)}>
            {STATUSES.map(s => <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>)}
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Target Metric</label>
          <input className={inputCls} value={targetMetric} onChange={e => setTargetMetric(e.target.value)} placeholder="e.g. win_rate, total_pnl" />
        </div>
        <div>
          <label className={labelCls}>Deadline</label>
          <input type="date" className={inputCls} value={deadline} onChange={e => setDeadline(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Target Value</label>
          <input type="number" className={inputCls} value={targetValue} onChange={e => setTargetValue(e.target.value)} placeholder="e.g. 60" />
        </div>
        <div>
          <label className={labelCls}>Current Value</label>
          <input type="number" className={inputCls} value={currentValue} onChange={e => setCurrentValue(e.target.value)} placeholder="e.g. 52" />
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <button onClick={handleSave} disabled={saving || !title} className="btn-primary flex-1">
          <Save size={16} /> {saving ? 'Saving...' : 'Save Goal'}
        </button>
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
      </div>
    </div>
  );
}
