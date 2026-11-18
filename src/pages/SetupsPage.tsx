import { Select } from '@/components/Select';
import { StrategyEvidence } from '@/components/DecisionEvidence';
import { useState, useMemo } from 'react';
import { Layers, Plus, Trash2, Save, Search, TrendingUp, Eye } from 'lucide-react';
import { ScreenshotUpload } from '@/components/ScreenshotUpload';
import { useSetups, useTrades } from '@/hooks/useData';
import { useAuth } from '@/context/AuthContext';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { MediaImage } from '@/components/MediaPreview';
import { MediaAudioPlayer } from '@/components/MediaPreview';
import { VoiceRecorder } from '@/components/VoiceRecorder';
import { LoadingSpinner, EmptyState } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Modal';
import '@/page-results.css';
import type { TradingSetup, TradingSetupInput } from '@/lib/types';
import { format, parseISO } from 'date-fns';

const CATEGORIES: { value: string; label: string }[] = [
  { value: 'breakout', label: 'Breakout' },
  { value: 'reversal', label: 'Reversal' },
  { value: 'trend_following', label: 'Trend Following' },
  { value: 'range', label: 'Range' },
  { value: 'scalping', label: 'Scalping' },
  { value: 'swing', label: 'Swing' },
  { value: 'other', label: 'Other' },
];

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(CATEGORIES.map(c => [c.value, c.label]));

export function SetupsPage() {
  const { user } = useAuth();
  const { setups, loading, upsertSetup, deleteSetup } = useSetups(user?.id);
  const { trades } = useTrades(user?.id);
  const [showForm, setShowForm] = useState(false);
  const [editingSetup, setEditingSetup] = useState<TradingSetup | null>(null);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [selectedId, setSelectedId] = useState('');

  const winRateBySetup = useMemo(() => {
    const map: Record<string, { wins: number; total: number }> = {};
    for (const setup of setups) {
      const linked = trades.filter(trade => trade.status === 'closed' && trade.setup_id === setup.id);
      map[setup.id] = { wins: linked.filter(trade => trade.outcome === 'win').length, total: linked.length };
    }
    return map;
  }, [setups, trades]);

  const filtered = setups.filter(s => {
    if (filterCat && s.category !== filterCat) return false;
    if (search && !s.name.toLowerCase().includes(search.toLowerCase()) && !s.description?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleSave = async (data: TradingSetupInput, id?: string) => {
    await upsertSetup(data, id);
    setShowForm(false);
    setEditingSetup(null);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this setup?')) await deleteSetup(id);
  };

  if (loading) return <LoadingSpinner label="Loading setups..." />;

  return (
    <div>
      <SectionHeader
        title="Setups"
        subtitle="Document and track your trading setups with win rate from your trade journal"
        action={
          <button onClick={() => { setEditingSetup(null); setShowForm(true); }} className="btn-primary">
            <Plus size={18} /> New Setup
          </button>
        }
      />

      <div className="ym-setup-collection-meta" aria-label="Setup collection summary">
        <span><Layers size={16} /><strong>{setups.length}</strong> playbook setups</span>
        <span><TrendingUp size={16} /><strong>{setups.filter(setup => setup.is_active).length}</strong> active</span>
        <span><Eye size={16} /><strong>{new Set(setups.map(setup => setup.category)).size}</strong> market approaches</span>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input-field pl-10" placeholder="Search setups..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select className="input-field sm:w-48" value={filterCat} onChange={e => setFilterCat(e.target.value)}>
          <option value="">All Categories</option>
          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </Select>
      </div>

      {filtered.length === 0 ? (
        <div className="ym-setup-empty card p-8">
          <EmptyState icon={<Layers size={40} />} title={setups.length ? 'No matching setups' : 'Build your visual playbook'} message={setups.length ? 'Try another category or search term.' : 'Save a chart example alongside the conditions, entry trigger and exit plan you want to repeat.'} />
          {!!setups.length && <button type="button" className="btn-secondary" onClick={() => { setSearch(''); setFilterCat(''); }}>Clear filters</button>}
        </div>
      ) : <div className="ym-setup-workbench">
        <nav className="ym-setup-index" aria-label="Setup playbook">
          <p className="ym-output-eyebrow">YOUR SETUPS / {filtered.length}</p>
          {filtered.map((setup, index) => <button type="button" key={setup.id} aria-pressed={(filtered.find(item => item.id === selectedId) || filtered[0]).id === setup.id} onClick={() => setSelectedId(setup.id)}>
            <span className="ym-setup-index-number">{String(index + 1).padStart(2, '0')}</span>
            <span><strong>{setup.name}</strong><small>{CATEGORY_LABELS[setup.category] || setup.category}{setup.timeframes ? ` · ${setup.timeframes}` : ''}</small></span>
            <span className={`ym-setup-state ${setup.is_active ? 'is-active' : ''}`} aria-label={setup.is_active ? 'Active setup' : 'Inactive setup'} />
          </button>)}
        </nav>
        {(() => {
          const setup = filtered.find(item => item.id === selectedId) || filtered[0];
          const result = winRateBySetup[setup.id];
          return <div key={setup.id}><SetupCard setup={setup} winRate={result?.total ? Math.round(result.wins / result.total * 100) : null} tradeCount={result?.total || 0} onEdit={() => { setEditingSetup(setup); setShowForm(true); }} onDelete={() => handleDelete(setup.id)} /><StrategyEvidence setup={setup.id}/></div>;
        })()}
      </div>}

      <Modal open={showForm} onClose={() => { setShowForm(false); setEditingSetup(null); }} title={editingSetup ? 'Edit Setup' : 'New Setup'} size="lg">
        <SetupForm initial={editingSetup} onSave={handleSave} onCancel={() => { setShowForm(false); setEditingSetup(null); }} />
      </Modal>
    </div>
  );
}

function SetupCard({ setup, winRate, tradeCount, onEdit, onDelete }: { setup: TradingSetup; winRate: number | null; tradeCount: number; onEdit: () => void; onDelete: () => void }) {
  const rules = [{ number: '01', title: 'Read the conditions', value: setup.market_conditions }, { number: '02', title: 'Wait for the entry', value: setup.entry_criteria }, { number: '03', title: 'Manage the exit', value: setup.exit_criteria }];
  return <article className="ym-setup-playbook" aria-label={`${setup.name} playbook`}>
    <header className="ym-setup-detail-heading"><div><p className="ym-output-eyebrow">{CATEGORY_LABELS[setup.category] || setup.category} / {setup.is_active ? 'ACTIVE PLAYBOOK' : 'ARCHIVED APPROACH'}</p><h2>{setup.name}</h2>{setup.description && <p>{setup.description}</p>}</div><div className="ym-output-actions"><button type="button" onClick={onEdit} className="btn-secondary">Edit setup</button><button type="button" aria-label={`Delete ${setup.name}`} onClick={onDelete} className="btn-ghost text-error-500"><Trash2 size={16} /></button></div></header>
    <div className="ym-setup-chart">{setup.screenshot_url ? <MediaImage source={setup.screenshot_url} alt={`${setup.name} chart example`} className="ym-setup-chart-image" /> : <div className="ym-setup-chart-empty"><Layers size={35} /><strong>Your reference chart belongs here</strong><p>Add an annotated example when you edit this setup.</p></div>}<span className="ym-setup-chart-label">{setup.timeframes || 'Timeframe not set'} / CHART REFERENCE</span></div>
    <ol className="ym-setup-rules">{rules.map(rule => <li key={rule.number}><span>{rule.number}</span><div><h3>{rule.title}</h3><p>{rule.value || 'No rules recorded yet. Add the criteria you want to follow.'}</p></div></li>)}</ol>
    {setup.example_notes && <div className="ym-setup-example"><p className="ym-output-eyebrow">EXAMPLE NOTES</p><p>{setup.example_notes}</p></div>}
    {setup.voice_note_url && <div className="ym-setup-recording"><p className="ym-output-eyebrow">AUDIO WALKTHROUGH</p><MediaAudioPlayer source={setup.voice_note_url} /></div>}
    <footer className="ym-setup-evidence"><div><strong>{winRate == null ? '—' : `${winRate}%`}</strong><span>{tradeCount ? `win rate · ${tradeCount} closed journal trades` : 'No closed trades linked yet'}</span></div><small>Added {format(parseISO(setup.created_at), 'MMM d, yyyy')}</small></footer>
  </article>;
}

function SetupForm({ initial, onSave, onCancel }: { initial: TradingSetup | null; onSave: (data: TradingSetupInput, id?: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [category, setCategory] = useState(initial?.category || 'breakout');
  const [marketConditions, setMarketConditions] = useState(initial?.market_conditions || '');
  const [timeframes, setTimeframes] = useState(initial?.timeframes || '');
  const [entryCriteria, setEntryCriteria] = useState(initial?.entry_criteria || '');
  const [exitCriteria, setExitCriteria] = useState(initial?.exit_criteria || '');
  const [exampleNotes, setExampleNotes] = useState(initial?.example_notes || '');
  const [screenshotUrl, setScreenshotUrl] = useState(initial?.screenshot_url || null);
  const [voiceUrl, setVoiceUrl] = useState(initial?.voice_note_url || null);
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave({
      name,
      description: description || null,
      category,
      market_conditions: marketConditions || null,
      timeframes: timeframes || null,
      entry_criteria: entryCriteria || null,
      exit_criteria: exitCriteria || null,
      example_notes: exampleNotes || null,
      screenshot_url: screenshotUrl || null,
      voice_note_url: voiceUrl || null,
      is_active: isActive,
    }, initial?.id);
    setSaving(false);
  };

  const inputCls = 'input-field';
  const labelCls = 'block text-xs font-semibold text-secondary mb-1.5';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Setup Name</label>
          <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. London Open Breakout" />
        </div>
        <div>
          <label className={labelCls}>Category</label>
          <Select className={inputCls} value={category} onChange={e => setCategory(e.target.value)}>
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </div>
      </div>

      <div>
        <label className={labelCls}>Description</label>
        <textarea className={inputCls} rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief description of the setup..." />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Market Conditions</label>
          <input className={inputCls} value={marketConditions} onChange={e => setMarketConditions(e.target.value)} placeholder="e.g. Trending, high volume" />
        </div>
        <div>
          <label className={labelCls}>Timeframes</label>
          <input className={inputCls} value={timeframes} onChange={e => setTimeframes(e.target.value)} placeholder="e.g. 4H + 15m" />
        </div>
      </div>

      <div>
        <label className={labelCls}>Entry Criteria</label>
        <textarea className={inputCls} rows={3} value={entryCriteria} onChange={e => setEntryCriteria(e.target.value)} placeholder="Step-by-step entry rules..." />
      </div>

      <div>
        <label className={labelCls}>Exit Criteria</label>
        <textarea className={inputCls} rows={3} value={exitCriteria} onChange={e => setExitCriteria(e.target.value)} placeholder="Exit rules, TP/SL placement..." />
      </div>

      <div>
        <label className={labelCls}>Example Notes</label>
        <textarea className={inputCls} rows={2} value={exampleNotes} onChange={e => setExampleNotes(e.target.value)} placeholder="Example trades or notes..." />
      </div>

      <div>
        <label className={labelCls}>Example Chart Image</label>
        <ScreenshotUpload onUpload={setScreenshotUrl} existingUrl={screenshotUrl} label="Upload an example chart screenshot" />
      </div>
      <div><label className={labelCls}>Voice note</label><VoiceRecorder onUpload={setVoiceUrl} existingUrl={voiceUrl} /></div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="w-4 h-4 rounded border-themed" />
        <span className="text-sm">Active</span>
      </label>

      <div className="flex gap-3 pt-2">
        <button onClick={handleSave} disabled={saving || !name} className="btn-primary flex-1">
          <Save size={16} /> {saving ? 'Saving...' : 'Save Setup'}
        </button>
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
      </div>
    </div>
  );
}

