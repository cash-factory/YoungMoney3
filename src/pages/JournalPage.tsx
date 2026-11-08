import { useMemo, useState } from 'react';
import { BookOpen, Plus, Trash2, Save, Target, Eye, CheckSquare, FileText, Calendar } from 'lucide-react';
import { ScreenshotUpload } from '@/components/ScreenshotUpload';
import { useJournalEntries, useTrades, useStrategies, useSetups, useMarketInstruments, useTradingAccounts } from '@/hooks/useData';
import { useAuth } from '@/context/AuthContext';
import { formatPercent } from '@/lib/utils';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { LoadingSpinner, EmptyState } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Modal';
import type { JournalEntry, JournalInput, JournalType, ChecklistItem, ReviewPrompt, Trade } from '@/lib/types';
import { format, parseISO } from 'date-fns';
import { SuggestInput } from '@/components/ui/SuggestInput';
import { GOAL_SUGGESTIONS, FOCUS_SUGGESTIONS, NOTE_SUGGESTIONS } from '@/lib/suggestions';
import { MediaAudioPlayer, MediaImage } from '@/components/MediaPreview';
import { VoiceRecorder } from '@/components/VoiceRecorder';

const DEFAULT_CHECKLIST: ChecklistItem[] = [
  { label: 'Reviewed higher timeframe trend', checked: false },
  { label: 'Identified key support/resistance levels', checked: false },
  { label: 'Checked economic calendar for news', checked: false },
  { label: 'Defined entry and exit criteria', checked: false },
  { label: 'Set proper position size for risk', checked: false },
  { label: 'No emotional bias or FOMO', checked: false },
];

const DEFAULT_PROMPTS: ReviewPrompt[] = [
  { question: 'Did I follow my trading plan today?', answer: '' },
  { question: 'What was my best decision?', answer: '' },
  { question: 'What was my worst decision?', answer: '' },
  { question: 'How did I manage risk?', answer: '' },
  { question: 'What will I improve tomorrow?', answer: '' },
];

export function JournalPage() {
  const { user } = useAuth();
  const [source, setSource] = useState('all');
  const sourceFilter = <label className="mb-4 block max-w-sm text-xs font-semibold text-secondary">Trade source
    <select className="input-field mt-1.5" value={source} onChange={event => setSource(event.target.value)}>
      <option value="all">All sources</option><option value="manual">Manual</option><option value="mt5">MT5</option>
    </select>
  </label>;
  const { entries, loading, upsertEntry, deleteEntry } = useJournalEntries(user?.id);
  const { trades } = useTrades(user?.id);
  const { strategies } = useStrategies(user?.id);
  const { setups } = useSetups(user?.id);
  const { instruments } = useMarketInstruments(user?.id);
  const { accounts } = useTradingAccounts(user?.id);
  const [showForm, setShowForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);
  const [filterType, setFilterType] = useState<JournalType | ''>('');

  const [accountFilter, setAccountFilter] = useState('all');
  const visibleTrades = useMemo(() => trades.filter(t => (source === 'all' || (t.trade_source ?? 'manual') === source) && (accountFilter === 'all' || (t.account_id || 'unassigned') === accountFilter)), [trades, source, accountFilter]);
  const filtered = useMemo(() => {
    return entries.filter(entry => (!filterType || entry.entry_type === filterType) && (accountFilter === 'all' || (entry.account_id || 'unassigned') === accountFilter));
  }, [entries, filterType, accountFilter]);

  const handleSave = async (data: JournalInput, id?: string) => {
    await upsertEntry(data, id);
    setShowForm(false);
    setEditingEntry(null);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this journal entry?')) await deleteEntry(id);
  };

  if (loading) return <LoadingSpinner label="Loading journal..." />;

  return (
    <div>
      <SectionHeader
        title="Journal"
        subtitle="Plan your sessions, track goals, and review your performance"
        action={
          <button onClick={() => { setEditingEntry(null); setShowForm(true); }} className="btn-primary">
            <Plus size={18} /> New Entry
          </button>
        }
      />

      {sourceFilter}
      <label className="mb-4 block max-w-sm text-xs font-semibold text-secondary">Journal account
        <select className="input-field mt-1.5" value={accountFilter} onChange={event => setAccountFilter(event.target.value)}>
          <option value="all">All accounts</option><option value="unassigned">Unassigned</option>
          {accounts.map(account => <option key={account.id} value={account.id}>{account.name} · {account.base_currency}</option>)}
        </select>
      </label>
      <div className="flex gap-2 mb-4">
        {(['', 'daily', 'weekly', 'monthly'] as const).map(t => (
          <button
            key={t}
            onClick={() => setFilterType(t)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              filterType === t ? 'bg-brand-500/10 text-brand-600 dark:text-brand-400 border-brand-500/20' : 'bg-secondary border-themed text-secondary hover:border-muted'
            }`}
          >
            {t === '' ? 'All Entries' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card p-8">
          <EmptyState icon={<BookOpen size={40} />} title="No journal entries yet" message="Create a daily, weekly, or monthly journal entry to plan your sessions and reflect on your trading." />
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(entry => (
            <JournalCard key={entry.id} entry={entry} trades={visibleTrades} accounts={accounts} onEdit={() => { setEditingEntry(entry); setShowForm(true); }} onDelete={() => handleDelete(entry.id)} />
          ))}
        </div>
      )}

      <Modal open={showForm} onClose={() => { setShowForm(false); setEditingEntry(null); }} title={editingEntry ? 'Edit Journal Entry' : 'New Journal Entry'} size="lg">
        <JournalForm initial={editingEntry} trades={visibleTrades} strategies={strategies} setups={setups} instruments={instruments} accounts={accounts} onSave={handleSave} onCancel={() => { setShowForm(false); setEditingEntry(null); }} />
      </Modal>
    </div>
  );
}

function JournalCard({ entry, trades, accounts, onEdit, onDelete }: { entry: JournalEntry; trades: Trade[]; accounts: {id: string; base_currency: string}[]; onEdit: () => void; onDelete: () => void }) {
  const entryTrades = useMemo(() => {
    const d = parseISO(entry.entry_date);
    return trades.filter(t => {
      if (t.status !== 'closed' || (entry.account_id && t.account_id !== entry.account_id)) return false;
      if (entry.linked_trade_ids?.length) return entry.linked_trade_ids.includes(t.id);
      const td = parseISO(t.exit_time || t.entry_time);
      if (entry.entry_type === 'daily') return format(td, 'yyyy-MM-dd') === format(d, 'yyyy-MM-dd');
      if (entry.entry_type === 'weekly') return format(td, 'yyyy-ww') === format(d, 'yyyy-ww');
      return format(td, 'yyyy-MM') === format(d, 'yyyy-MM');
    });
  }, [entry, trades]);

  const totals = new Map<string, number>();
  for (const trade of entryTrades) {
    const currency = accounts.find(account => account.id === trade.account_id)?.base_currency ?? 'Unassigned';
    totals.set(currency, (totals.get(currency) ?? 0) + trade.pnl);
  }
  const pnl = [...totals].map(([currency, value]) => currency === 'Unassigned' ? value.toFixed(2) + ' (currency unknown)' : new Intl.NumberFormat(undefined, {style: 'currency', currency}).format(value)).join(' · ');
  const wins = entryTrades.filter(t => t.outcome === 'win').length;
  const winRate = entryTrades.length ? (wins / entryTrades.length) * 100 : 0;
  const checkedCount = (entry.trading_plan_checklist || []).filter(c => c.checked).length;
  const checklistTotal = (entry.trading_plan_checklist || []).length;

  const typeColors: Record<string, string> = {
    daily: 'badge-brand', weekly: 'badge-accent', monthly: 'badge-warning',
  };

  return (
    <div className="card p-5 card-hover">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className={`badge ${typeColors[entry.entry_type]}`}>{entry.entry_type}</span>
            <span className="text-sm font-semibold">{format(parseISO(entry.entry_date), 'MMM d, yyyy')}</span>
          </div>
          {entryTrades.length > 0 && (
            <p className="text-xs text-muted">{entryTrades.length} trades · {pnl} · {formatPercent(winRate)} WR</p>
          )}
        </div>
        <div className="flex gap-1">
          <button onClick={onEdit} className="btn-ghost p-1.5"><FileText size={16} /></button>
          <button onClick={onDelete} className="btn-ghost p-1.5 text-error-500 hover:bg-error-500/10"><Trash2 size={16} /></button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {entry.daily_goals && (
          <div>
            <p className="text-xs font-semibold text-secondary mb-1 flex items-center gap-1"><Target size={12} /> Goals</p>
            <p className="text-sm">{entry.daily_goals}</p>
          </div>
        )}
        {entry.weekly_focus && (
          <div>
            <p className="text-xs font-semibold text-secondary mb-1 flex items-center gap-1"><Eye size={12} /> Focus Area</p>
            <p className="text-sm">{entry.weekly_focus}</p>
          </div>
        )}
        {entry.pre_market_notes && (
          <div>
            <p className="text-xs font-semibold text-secondary mb-1 flex items-center gap-1"><Calendar size={12} /> Pre-Market Notes</p>
            <p className="text-sm">{entry.pre_market_notes}</p>
          </div>
        )}
        {entry.post_session_review && (
          <div>
            <p className="text-xs font-semibold text-secondary mb-1 flex items-center gap-1"><Eye size={12} /> Post-Session Review</p>
            <p className="text-sm">{entry.post_session_review}</p>
          </div>
        )}
      </div>

      {entry.trading_plan_checklist && entry.trading_plan_checklist.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-secondary mb-1.5 flex items-center gap-1"><CheckSquare size={12} /> Trading Plan Checklist ({checkedCount}/{checklistTotal})</p>
          <div className="flex flex-wrap gap-1.5">
            {entry.trading_plan_checklist.map((c, i) => (
              <span key={i} className={`badge text-[10px] ${c.checked ? 'badge-success' : 'badge-neutral'}`}>
                {c.checked ? '✓' : '○'} {c.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {entry.review_prompts && entry.review_prompts.some(p => p.answer) && (
        <div className="mt-3 space-y-1.5">
          {entry.review_prompts.filter(p => p.answer).map((p, i) => (
            <div key={i} className="text-sm">
              <span className="text-xs font-semibold text-secondary">Q: {p.question}</span>
              <p className="mt-0.5">{p.answer}</p>
            </div>
          ))}
        </div>
      )}

      {entry.notes && <p className="mt-3 text-sm text-secondary">{entry.notes}</p>}
      {entry.screenshot_url && (
        <div className="mt-3 rounded-lg overflow-hidden border border-themed">
          <MediaImage source={entry.screenshot_url} alt="Journal screenshot" className="w-full max-h-64 object-contain bg-secondary" />
        </div>
      )}
      {entry.voice_note_url && <div className="mt-3"><MediaAudioPlayer source={entry.voice_note_url} /></div>}
    </div>
  );
}

function JournalForm({ initial, trades, strategies, setups, instruments, accounts, onSave, onCancel }: { initial: JournalEntry | null; trades: Trade[]; strategies: { id: string; name: string }[]; setups: { id: string; name: string }[]; instruments: { id: string; symbol: string }[]; accounts: { id: string; name: string; base_currency: string }[]; onSave: (data: JournalInput, id?: string) => void; onCancel: () => void }) {
  const [date, setDate] = useState(initial?.entry_date || format(new Date(), 'yyyy-MM-dd'));
  const [type, setType] = useState<JournalType>(initial?.entry_type || 'daily');
  const [dailyGoals, setDailyGoals] = useState(initial?.daily_goals || '');
  const [weeklyFocus, setWeeklyFocus] = useState(initial?.weekly_focus || '');
  const [preMarket, setPreMarket] = useState(initial?.pre_market_notes || '');
  const [postSession, setPostSession] = useState(initial?.post_session_review || '');
  const [checklist, setChecklist] = useState<ChecklistItem[]>(initial?.trading_plan_checklist || DEFAULT_CHECKLIST);
  const [prompts, setPrompts] = useState<ReviewPrompt[]>(initial?.review_prompts || DEFAULT_PROMPTS);
  const [mood, setMood] = useState(initial?.mood || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [screenshotUrl, setScreenshotUrl] = useState(initial?.screenshot_url || null);
  const [voiceUrl, setVoiceUrl] = useState(initial?.voice_note_url || null);
  const [strategyId, setStrategyId] = useState(initial?.strategy_id || '');
  const [setupId, setSetupId] = useState(initial?.setup_id || '');
  const [instrumentId, setInstrumentId] = useState(initial?.instrument_id || '');
  const [accountId, setAccountId] = useState(initial?.account_id || '');
  const [linkedTradeIds, setLinkedTradeIds] = useState<string[]>(initial?.linked_trade_ids || []);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const toggleChecklist = (i: number) => {
    setChecklist(c => c.map((item, idx) => idx === i ? { ...item, checked: !item.checked } : item));
  };

  const updatePrompt = (i: number, answer: string) => {
    setPrompts(p => p.map((item, idx) => idx === i ? { ...item, answer } : item));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try { await onSave({
      entry_date: date,
      entry_type: type,
      daily_goals: dailyGoals || null,
      weekly_focus: weeklyFocus || null,
      pre_market_notes: preMarket || null,
      post_session_review: postSession || null,
      trading_plan_checklist: checklist,
      review_prompts: prompts,
      mood: mood || null,
      notes: notes || null,
      screenshot_url: screenshotUrl || null,
      voice_note_url: voiceUrl || null,
      strategy_id: strategyId || null,
      setup_id: setupId || null,
      instrument_id: instrumentId || null,
      account_id: accountId || null,
      linked_trade_ids: linkedTradeIds,
    }, initial?.id);
    } catch (error) { setSaveError(error instanceof Error ? error.message : 'Could not save journal entry.'); }
    finally { setSaving(false); }
  };

  const inputCls = 'input-field';
  const labelCls = 'block text-xs font-semibold text-secondary mb-1.5';

  return (
    <div className="space-y-5">
      {saveError && <p role="alert">{saveError}</p>}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Date</label>
          <input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Entry Type</label>
          <select className={inputCls} value={type} onChange={e => setType(e.target.value as JournalType)}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div><label className={labelCls}>Strategy practiced</label><select className={inputCls} value={strategyId} onChange={e => setStrategyId(e.target.value)}><option value="">None</option>{strategies.map(strategy => <option key={strategy.id} value={strategy.id}>{strategy.name}</option>)}</select></div>
        <div><label className={labelCls}>Setup</label><select className={inputCls} value={setupId} onChange={e => setSetupId(e.target.value)}><option value="">None</option>{setups.map(setup => <option key={setup.id} value={setup.id}>{setup.name}</option>)}</select></div>
        <div><label className={labelCls}>Instrument</label><select className={inputCls} value={instrumentId} onChange={e => setInstrumentId(e.target.value)}><option value="">None</option>{instruments.map(item => <option key={item.id} value={item.id}>{item.symbol}</option>)}</select></div>
        <div><label className={labelCls}>Account</label><select className={inputCls} value={accountId} onChange={e => setAccountId(e.target.value)}><option value="">None</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name} · {account.base_currency}</option>)}</select></div>
        <div><label className={labelCls}>Trades linked ({linkedTradeIds.length})</label><div className="max-h-36 overflow-y-auto rounded-lg border border-themed p-2 space-y-1">{trades.slice(0, 30).map(trade => <label key={trade.id} className="flex gap-2 items-center text-xs"><input type="checkbox" checked={linkedTradeIds.includes(trade.id)} onChange={e => setLinkedTradeIds(ids => e.target.checked ? [...ids, trade.id] : ids.filter(id => id !== trade.id))} />{trade.pair} · {format(parseISO(trade.entry_time), 'MMM d')} · {trade.outcome || trade.status}</label>)}</div></div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Daily Goals</label>
          <SuggestInput multiline rows={2} value={dailyGoals} onChange={setDailyGoals} placeholder="What do you want to achieve today?" suggestions={GOAL_SUGGESTIONS} />
        </div>
        <div>
          <label className={labelCls}>Weekly / Monthly Focus</label>
          <SuggestInput multiline rows={2} value={weeklyFocus} onChange={setWeeklyFocus} placeholder="Patience, discipline, risk management..." suggestions={FOCUS_SUGGESTIONS} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Pre-Market Preparation</label>
          <SuggestInput multiline rows={3} value={preMarket} onChange={setPreMarket} placeholder="Market overview, key levels, news events..." suggestions={NOTE_SUGGESTIONS} />
        </div>
        <div>
          <label className={labelCls}>Post-Session Review</label>
          <SuggestInput multiline rows={3} value={postSession} onChange={setPostSession} placeholder="How did the session go? What went well or poorly?" suggestions={NOTE_SUGGESTIONS} />
        </div>
      </div>

      <div>
        <label className={labelCls}>Trading Plan Checklist</label>
        <div className="space-y-1.5">
          {checklist.map((c, i) => (
            <button key={i} onClick={() => toggleChecklist(i)} className="flex items-center gap-2 w-full p-2 rounded-lg hover:bg-secondary transition-colors text-left">
              <span className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${c.checked ? 'bg-success-500 border-success-500 text-white' : 'border-themed'}`}>
                {c.checked && '✓'}
              </span>
              <span className="text-sm">{c.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className={labelCls}>Review Prompts</label>
        <div className="space-y-2">
          {prompts.map((p, i) => (
            <div key={i}>
              <p className="text-sm font-medium mb-1">{p.question}</p>
              <textarea className={inputCls} rows={1} placeholder="Your answer..." value={p.answer} onChange={e => updatePrompt(i, e.target.value)} />
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Mood</label>
          <input className={inputCls} placeholder="Calm, motivated, stressed..." value={mood} onChange={e => setMood(e.target.value)} />
        </div>
      </div>

      <div>
        <label className={labelCls}>Additional Notes</label>
        <SuggestInput multiline rows={2} value={notes} onChange={setNotes} placeholder="Any other thoughts..." suggestions={NOTE_SUGGESTIONS} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div><label className={labelCls}>Chart Screenshot</label><ScreenshotUpload onUpload={setScreenshotUrl} existingUrl={screenshotUrl} label="Upload session chart screenshot" /></div>
        <div><label className={labelCls}>Voice Note</label><VoiceRecorder onUpload={setVoiceUrl} existingUrl={voiceUrl} /></div>
      </div>

      <div className="flex justify-end gap-3 pt-2 border-t border-themed">
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
        <button onClick={handleSave} disabled={saving} className="btn-primary">
          <Save size={18} /> {saving ? 'Saving...' : 'Save Entry'}
        </button>
      </div>
    </div>
  );
}
