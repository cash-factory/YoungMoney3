import { Select } from '@/components/Select';
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
import { StatCard } from '@/components/ui/StatCard';
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

  const winRateBySetup = useMemo(() => {
    const map: Record<string, { wins: number; total: number }> = {};
    for (const t of trades) {
      if (!t.strategy) continue;
      if (!map[t.strategy]) map[t.strategy] = { wins: 0, total: 0 };
      map[t.strategy].total++;
      if (t.outcome === 'win') map[t.strategy].wins++;
    }
    return map;
  }, [trades]);

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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Total Setups" value={String(setups.length)} icon={<Layers size={20} />} accent="blue" />
        <StatCard label="Active Setups" value={String(setups.filter(s => s.is_active).length)} icon={<TrendingUp size={20} />} accent="emerald" />
        <StatCard label="Categories" value={String(new Set(setups.map(s => s.category)).size)} icon={<Eye size={20} />} accent="amber" />
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
        <div className="card p-8">
          <EmptyState icon={<Layers size={40} />} title="No setups yet" message="Document your trading setups with entry/exit criteria, market conditions, and track their win rates from your journal." />
        </div>
      ) : (
        <div className="ym-setup-gallery grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(setup => {
            const wr = winRateBySetup[setup.name];
            const winRate = wr && wr.total > 0 ? Math.round((wr.wins / wr.total) * 100) : null;
            return (
              <SetupCard key={setup.id} setup={setup} winRate={winRate} tradeCount={wr?.total || 0} onEdit={() => { setEditingSetup(setup); setShowForm(true); }} onDelete={() => handleDelete(setup.id)} />
            );
          })}
        </div>
      )}

      <Modal open={showForm} onClose={() => { setShowForm(false); setEditingSetup(null); }} title={editingSetup ? 'Edit Setup' : 'New Setup'} size="lg">
        <SetupForm initial={editingSetup} onSave={handleSave} onCancel={() => { setShowForm(false); setEditingSetup(null); }} />
      </Modal>
    </div>
  );
}

function SetupCard({ setup, winRate, tradeCount, onEdit, onDelete }: { setup: TradingSetup; winRate: number | null; tradeCount: number; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="card p-5 card-hover">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-bold">{setup.name}</h3>
            <span className="badge badge-brand">{CATEGORY_LABELS[setup.category] || setup.category}</span>
            {!setup.is_active && <span className="badge badge-neutral">Inactive</span>}
          </div>
          {setup.description && <p className="text-xs text-secondary">{setup.description}</p>}
        </div>
        <div className="flex gap-1 ml-2">
          <button onClick={onEdit} className="btn-ghost p-1.5 text-xs">Edit</button>
          <button onClick={onDelete} className="btn-ghost p-1.5 text-error-500 hover:bg-error-500/10"><Trash2 size={14} /></button>
        </div>
      </div>

      {setup.screenshot_url && (
        <div className="mt-3 rounded-lg overflow-hidden border border-themed">
          <MediaImage source={setup.screenshot_url} alt={setup.name} className="w-full max-h-48 object-cover" />
        </div>
      )}
      {setup.voice_note_url && <div className="mt-3"><MediaAudioPlayer source={setup.voice_note_url} /></div>}

      <div className="grid grid-cols-2 gap-3 text-xs">
        {setup.market_conditions && (
          <div>
            <p className="font-semibold text-muted mb-0.5">Market Conditions</p>
            <p className="text-secondary">{setup.market_conditions}</p>
          </div>
        )}
        {setup.timeframes && (
          <div>
            <p className="font-semibold text-muted mb-0.5">Timeframes</p>
            <p className="text-secondary">{setup.timeframes}</p>
          </div>
        )}
        {setup.entry_criteria && (
          <div>
            <p className="font-semibold text-muted mb-0.5">Entry Criteria</p>
            <p className="text-secondary whitespace-pre-wrap">{setup.entry_criteria}</p>
          </div>
        )}
        {setup.exit_criteria && (
          <div>
            <p className="font-semibold text-muted mb-0.5">Exit Criteria</p>
            <p className="text-secondary whitespace-pre-wrap">{setup.exit_criteria}</p>
          </div>
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-themed flex items-center gap-4">
        {winRate != null ? (
          <div className="flex items-center gap-2">
            <span className={`text-sm font-bold ${winRate >= 50 ? 'text-success-500' : 'text-error-500'}`}>{winRate}%</span>
            <span className="text-xs text-muted">win rate ({tradeCount} trades)</span>
          </div>
        ) : (
          <span className="text-xs text-muted">No trades linked yet</span>
        )}
        <span className="text-xs text-muted ml-auto">{format(parseISO(setup.created_at), 'MMM d, yyyy')}</span>
      </div>
    </div>
  );
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

