import { ExecutionSummaryCards } from '@/components/ExecutionMetrics';
import { useEffect, useState } from 'react';
import { BookOpen, Plus, Trash2, Target, ListChecks, Save } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useStrategies, useStrategyChecklist, useStrategyEntryModels, useTradingPlans, useTrades } from '@/hooks/useData';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { EmptyState, LoadingSpinner } from '@/components/ui/Feedback';
import { DEFAULT_USER_ENTRY_MODEL, DEFAULT_USER_STRATEGY } from '@/data/workspaceDefaults';

export function StrategyLibraryPage() {
  const { user } = useAuth();
  const { strategies, loading, addStrategy, updateStrategy, deleteStrategy } = useStrategies(user?.id);
  const {trades}=useTrades(user?.id);
  const { plans } = useTradingPlans(user?.id);
  const [selectedStrategy, setSelectedStrategy] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [newPlanId, setNewPlanId] = useState('');
  const [modelName, setModelName] = useState('');
  const [modelDescription, setModelDescription] = useState('');
  const [editingModelId, setEditingModelId] = useState('');
  const [editingStrategyId, setEditingStrategyId] = useState('');
  const [editingItemId, setEditingItemId] = useState('');
  const [itemLabel, setItemLabel] = useState('');
  const [required, setRequired] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const activeStrategy = selectedStrategy || strategies[0]?.id || '';
  const activeStrategyRecord = strategies.find(s => s.id === activeStrategy);
  const { models, addModel, updateModel, deleteModel } = useStrategyEntryModels(activeStrategyRecord?.plan_id ? activeStrategy : null);
  const { items, addItem, updateItem, deleteItem } = useStrategyChecklist(activeStrategyRecord?.plan_id ? activeStrategy : null, selectedModel || null);

  useEffect(() => {
    if (strategies.length && !strategies.some(s => s.id === selectedStrategy)) setSelectedStrategy(strategies[0].id);
    if (!strategies.length) setSelectedStrategy('');
  }, [strategies, selectedStrategy]);
  useEffect(() => {
    if (selectedModel && !models.some(model => model.id === selectedModel)) setSelectedModel('');
  }, [models, selectedModel]);

  const createStrategy = async () => {
    if (!name.trim()) return;
    setError(''); setBusy(true);
    try {
      if (editingStrategyId) {
        await updateStrategy(editingStrategyId, { name: name.trim(), description: description.trim() || null });
        setSelectedStrategy(editingStrategyId);
        setEditingStrategyId('');
      } else {
        if (!newPlanId) throw new Error('Choose a trading plan before creating a strategy.');
        const strategy = await addStrategy({ name: name.trim(), description: description.trim() || null, plan_id: newPlanId, is_active: true });
        setSelectedStrategy(strategy.id);
        setNewPlanId('');
      }
      setName(''); setDescription('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save strategy.'); }
    finally { setBusy(false); }
  };
  const createModel = async () => {
    if (!modelName.trim() || !activeStrategy || !activeStrategyRecord?.plan_id) return;
    setError(''); setBusy(true);
    try {
      if (editingModelId) await updateModel(editingModelId, { name: modelName.trim(), description: modelDescription.trim() || null });
      else await addModel({ strategy_id: activeStrategy, name: modelName.trim(), description: modelDescription.trim() || null, is_active: true });
      setModelName(''); setModelDescription(''); setEditingModelId('');
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save entry model.'); }
    finally { setBusy(false); }
  };
  const createChecklistItem = async () => {
    if (!itemLabel.trim() || !activeStrategy || !activeStrategyRecord?.plan_id) return;
    setError(''); setBusy(true);
    try { await addItem(itemLabel.trim(), required, selectedModel || null); setItemLabel(''); setRequired(true); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save checklist item.'); }
    finally { setBusy(false); }
  };
  const saveChecklistItem = async () => {
    if (!editingItemId || !itemLabel.trim()) return;
    setError(''); setBusy(true);
    try { await updateItem(editingItemId, { label: itemLabel.trim(), is_required: required }); setEditingItemId(''); setItemLabel(''); setRequired(true); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not update checklist item.'); }
    finally { setBusy(false); }
  };

  if (loading) return <LoadingSpinner label="Loading strategy library…" />;
  return <div>
    <SectionHeader title="Strategy Library" subtitle="Create strategies, entry models, and quick checklists for every trade and test." />
    {selectedStrategy && <div className="mb-5"><ExecutionSummaryCards trades={trades.filter(trade=>trade.strategy_id===selectedStrategy)} /></div>}
    {error && <p role="alert" className="mb-4 rounded-lg bg-error-500/10 p-3 text-sm text-error-500">{error}</p>}
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <section className="card p-5 space-y-4">
        <div className="flex items-center gap-2"><BookOpen size={18} className="text-orange-500" /><h2 className="text-sm font-bold">Your strategies</h2></div>
        <div className="space-y-2">{strategies.map(strategy => <div key={strategy.id} className={`rounded-xl border p-3 ${activeStrategy === strategy.id ? 'border-orange-500/40 bg-orange-500/5' : 'border-themed'}`}><div className="flex items-center gap-2"><button className="flex-1 text-left min-w-0" onClick={() => { setSelectedStrategy(strategy.id); setSelectedModel(''); }}><span className="block text-sm font-semibold">{strategy.name}</span>{strategy.description && <span className="block text-xs text-muted mt-1">{strategy.description}</span>}</button><button className="btn-ghost p-1.5 text-xs" aria-label={`Edit ${strategy.name}`} onClick={() => { setSelectedStrategy(strategy.id); setEditingStrategyId(strategy.id); setName(strategy.name); setDescription(strategy.description || ''); setNewPlanId(strategy.plan_id || ''); }}>Edit</button><button aria-label={`Delete ${strategy.name}`} className="btn-ghost p-1.5 text-error-500" onClick={() => { if (confirm(`Delete ${strategy.name}? Existing trades remain, but the strategy link will be removed.`)) deleteStrategy(strategy.id); }}><Trash2 size={14} /></button></div><label className="block mt-2 text-[11px] text-muted">{strategy.plan_id ? 'Trading plan' : 'Needs a plan'}</label><select className="input-field mt-1 py-1.5 text-xs" value={strategy.plan_id || ''} onChange={e => { void (async () => { try { await updateStrategy(strategy.id, { plan_id: e.target.value || null }); } catch (err) { setError(err instanceof Error ? err.message : 'Could not link strategy to plan.'); } })(); }}><option value="">Needs a plan</option>{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.title}</option>)}</select></div>)}</div>
        {!strategies.length && <EmptyState icon={<Target size={28} />} title="No strategies yet" message="Add one here and it will be available when capturing trades and tests." />}
        <div className="border-t border-themed pt-4 space-y-2"><p className="text-[11px] text-muted">{editingStrategyId ? 'Edit strategy details' : 'Plan → Strategy → Entry model → Checklist'}</p>{!editingStrategyId && <select className="input-field" value={newPlanId} onChange={e => setNewPlanId(e.target.value)}><option value="">Choose parent trading plan first</option>{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.title}</option>)}</select>}<input className="input-field" value={name} onChange={e => setName(e.target.value)} placeholder="Strategy name" /><textarea className="input-field" rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="What makes this strategy valid? (optional)" /><button disabled={busy || !name.trim() || (!editingStrategyId && !newPlanId)} className="btn-primary w-full" onClick={createStrategy}>{editingStrategyId ? <Save size={15} /> : <Plus size={15} />} {editingStrategyId ? 'Save strategy' : 'Add strategy'}</button>{editingStrategyId && <><button type="button" className="btn-secondary w-full" onClick={() => { if (confirm('Replace this strategy’s name and description with generic defaults? Its plan link and existing trades remain unchanged.')) { setName(DEFAULT_USER_STRATEGY.name); setDescription(DEFAULT_USER_STRATEGY.description); } }}>Restore default strategy details</button><button type="button" className="btn-secondary w-full" onClick={() => { setEditingStrategyId(''); setName(''); setDescription(''); }}>Cancel edit</button></>}</div>
      </section>

      <section className="card p-5 space-y-4 lg:col-span-2">
        <div className="flex items-center gap-2"><Target size={18} className="text-orange-500" /><h2 className="text-sm font-bold">Entry models & checklist</h2></div>
        {activeStrategy && activeStrategyRecord?.plan_id ? <>
          <div><label className="block text-xs font-semibold text-secondary mb-1.5">Strategy</label><select className="input-field" value={activeStrategy} onChange={e => { setSelectedStrategy(e.target.value); setSelectedModel(''); }}>{strategies.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div className="flex flex-col gap-2"><select className="input-field" value={selectedModel} onChange={e => setSelectedModel(e.target.value)}><option value="">General checklist</option>{models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select><input className="input-field" value={modelName} onChange={e => setModelName(e.target.value)} placeholder={editingModelId ? 'Edit model name' : 'New entry model'} /><textarea className="input-field" rows={2} value={modelDescription} onChange={e => setModelDescription(e.target.value)} placeholder="Model description (optional)" /><div className="flex gap-2"><button disabled={busy || !modelName.trim()} className="btn-secondary" onClick={createModel}>{editingModelId ? <Save size={15} /> : <Plus size={15} />} {editingModelId ? 'Save model' : 'Add model'}</button>{editingModelId && <><button type="button" className="btn-secondary" onClick={() => { if (confirm('Replace this entry model’s name and description with generic defaults? Its checklist items remain unchanged.')) { setModelName(DEFAULT_USER_ENTRY_MODEL.name); setModelDescription(DEFAULT_USER_ENTRY_MODEL.description); } }}>Restore defaults</button><button type="button" className="btn-secondary" onClick={() => { setEditingModelId(''); setModelName(''); setModelDescription(''); }}>Cancel</button></>}</div></div>
          {models.length > 0 && <div className="flex flex-wrap gap-2">{models.map(model => <span key={model.id} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs">{model.name}<button aria-label={`Edit ${model.name}`} onClick={() => { setSelectedModel(model.id); setEditingModelId(model.id); setModelName(model.name); setModelDescription(model.description || ''); }} className="text-muted hover:text-orange-500">Edit</button><button aria-label={`Delete ${model.name}`} onClick={() => { if (confirm(`Delete entry model ${model.name}?`)) deleteModel(model.id); }} className="text-muted hover:text-error-500"><Trash2 size={12} /></button></span>)}</div>}
          <div className="rounded-xl border border-themed p-4 space-y-3"><div className="flex items-center gap-2 text-sm font-semibold"><ListChecks size={16} className="text-orange-500" />{selectedModel ? `${models.find(m => m.id === selectedModel)?.name} checklist` : 'General checklist'}</div>
            {items.length ? <div className="space-y-2">{items.map(item => <div key={item.id} className="flex items-center gap-2 text-sm">{editingItemId === item.id ? <input className="input-field flex-1" value={itemLabel} onChange={e => setItemLabel(e.target.value)} /> : <><span className="w-4 h-4 rounded border border-themed" /><span className="flex-1">{item.label}{item.is_required && <span className="ml-2 text-[10px] uppercase text-muted">Required</span>}</span></>}<button aria-label={`Edit ${item.label}`} onClick={() => { setEditingItemId(item.id); setItemLabel(item.label); setRequired(item.is_required); }} className="text-muted hover:text-orange-500">Edit</button><button aria-label={`Delete ${item.label}`} onClick={() => deleteItem(item.id)} className="text-muted hover:text-error-500"><Trash2 size={14} /></button></div>)}</div> : <p className="text-xs text-muted">No items yet. Keep it short so it is easy to complete during capture.</p>}
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2"><input className="input-field" value={itemLabel} onChange={e => setItemLabel(e.target.value)} placeholder="Checklist item" /><label className="flex items-center gap-2 text-xs text-secondary"><input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)} /> Required</label><button disabled={busy || !itemLabel.trim()} className="btn-primary" onClick={editingItemId ? saveChecklistItem : createChecklistItem}>{editingItemId ? <Save size={15} /> : <Plus size={15} />} {editingItemId ? 'Save item' : 'Add item'}</button></div>
          </div>
        </> : activeStrategy ? <p className="text-sm text-amber-600">Assign this legacy strategy to a trading plan before creating entry models or checklists.</p> : <p className="text-sm text-muted">Create a trading plan, then a strategy, before adding entry models and checklists.</p>}
      </section>
    </div>
  </div>;
}
