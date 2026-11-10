import { useState, useMemo } from 'react';
import { CalendarCheck, Plus, Trash2, Save, Star, TrendingUp, TrendingDown, Brain } from 'lucide-react';
import { ScreenshotUpload } from '@/components/ScreenshotUpload';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line } from 'recharts';
import { useWeeklyReviews, useTrades, useStrategies, useStrategyEntryModels, useTradingPlans, useTradingAccounts, useSetups, useMarketInstruments } from '@/hooks/useData';
import { useAuth } from '@/context/AuthContext';
import { useMt5Lifecycles } from '@/hooks/useMt5Lifecycles';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { MediaImage } from '@/components/MediaPreview';
import { MediaAudioPlayer } from '@/components/MediaPreview';
import { VoiceRecorder } from '@/components/VoiceRecorder';
import { LoadingSpinner, EmptyState } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Modal';
import { StatCard } from '@/components/ui/StatCard';
import type { WeeklyReview, WeeklyReviewInput } from '@/lib/types';
import { format, parseISO, startOfWeek, endOfWeek, isWithinInterval } from 'date-fns';

export function WeeklyReviewsPage() {
  const { user } = useAuth();
  const { reviews, loading, upsertReview, deleteReview } = useWeeklyReviews(user?.id);
  const { trades } = useTrades(user?.id);
  const { positions: brokerPositions, error: positionError } = useMt5Lifecycles(user?.id);
  const { accounts } = useTradingAccounts(user?.id);
  const [brokerAccount, setBrokerAccount] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<WeeklyReview | null>(null);

  const handleSave = async (data: WeeklyReviewInput, id?: string) => {
    await upsertReview(data, id);
    setShowForm(false);
    setEditing(null);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this weekly review?')) await deleteReview(id);
  };

  const avgRating = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;
  const totalPnl = reviews.reduce((s, r) => s + r.pnl, 0);

  const brokerWeek = useMemo(() => {
    const end = new Date();
    const endUtc = Date.UTC(end.getUTCFullYear(),end.getUTCMonth(),end.getUTCDate());
    const weekday = new Date(endUtc).getUTCDay();
    const weekStart = endUtc - ((weekday+6)%7)*86400000;
    const weekEnd = weekStart+7*86400000;
    const rows = brokerPositions.filter(row => {
      if(brokerAccount !== 'all' && row.account_id !== brokerAccount)return false;
      if(row.summary.status !== 'closed' || !row.summary.final_exit_at)return false;
      const at = Date.parse(row.summary.final_exit_at);
      return Number.isFinite(at) && at>=weekStart && at<weekEnd;
    });
    const currency = new Map<string,{count:number;pnl:number}>();
    for(const row of rows) {
      const code=row.summary.settlement_currency || 'Unknown currency';
      const amount=Number(row.summary.net_realized_profit);
      const prior=currency.get(code)||{count:0,pnl:0};
      prior.count++;
      if(row.summary.net_realized_profit!==null && Number.isFinite(amount))prior.pnl+=amount;
      currency.set(code,prior);
    }
    const eligible=rows.filter(row=>row.summary.final_realized_r!==null).length;
    return {rows,currency,eligible,weekStart:new Date(weekStart).toISOString().slice(0,10)};
  },[brokerPositions,brokerAccount]);

  const chartData = useMemo(() => [...reviews].reverse().map(r => ({
    week: format(parseISO(r.week_start), 'MMM d'),
    pnl: r.pnl,
    rating: r.rating,
  })), [reviews]);

  if (loading) return <LoadingSpinner label="Loading weekly reviews..." />;

  return (
    <div>
      <SectionHeader
        title="Weekly Reviews"
        subtitle="Reflect on each week — performance, lessons, and focus for next week"
        action={
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary">
            <Plus size={18} /> New Review
          </button>
        }
      />

      <section className="card p-4 sm:p-5 mb-6 space-y-3" aria-label="Current week broker lifecycle reconciliation">
        <div>
          <p className="text-[10px] text-muted uppercase tracking-wider font-bold">BROKER RECONCILIATION / CURRENT UTC WEEK</p>
          <h2 className="font-semibold text-base mt-1">Position-based weekly results</h2>
          <p className="text-xs text-muted mt-1">Each closed MT5 lifecycle counts once. Closing fills, legacy journal rows and user-entered reviews remain separate until exact matching is verified. Broker-local week boundaries require a confirmed timezone conversion.</p>
        </div>
        <label className="block max-w-sm text-xs text-secondary font-semibold">Trading account
          <select className="input-field mt-1" value={brokerAccount} onChange={event=>setBrokerAccount(event.target.value)}>
            <option value="all">All accounts</option>
            {accounts.map(item=><option key={item.id} value={item.id}>{item.name} · {item.base_currency}</option>)}
          </select>
        </label>
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="bg-secondary rounded-lg p-3"><p className="text-xs text-muted">Week beginning (UTC)</p><strong>{brokerWeek.weekStart}</strong></div>
          <div className="bg-secondary rounded-lg p-3"><p className="text-xs text-muted">Closed positions</p><strong className="font-mono">{brokerWeek.rows.length}</strong></div>
          <div className="bg-secondary rounded-lg p-3"><p className="text-xs text-muted">Known final R</p><strong className="font-mono">{brokerWeek.eligible} / {brokerWeek.rows.length}</strong></div>
        </div>
        {positionError && <p role="status" className="text-xs text-muted">Broker lifecycle summaries are temporarily unavailable. Saved weekly reviews remain accessible.</p>}
        <div className="flex flex-wrap gap-3 text-xs">
          {[...brokerWeek.currency].map(([code,group])=><span key={code} className="rounded-lg border border-themed px-3 py-2"><strong>{code}</strong> · {group.count} positions · {group.pnl.toFixed(2)} net</span>)}
          {!brokerWeek.currency.size && <p className="text-muted">No broker position lifecycles closed this UTC week.</p>}
        </div>
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Total Reviews" value={String(reviews.length)} icon={<CalendarCheck size={20} />} accent="blue" />
        <StatCard label="Avg Rating" value={avgRating.toFixed(1)} icon={<Star size={20} />} accent="amber" />
        <StatCard label="Total P&L" value={`$${totalPnl.toFixed(2)}`} icon={totalPnl >= 0 ? <TrendingUp size={20} /> : <TrendingDown size={20} />} accent={totalPnl >= 0 ? 'emerald' : 'rose'} />
      </div>

      {reviews.length === 0 ? (
        <div className="card p-8">
          <EmptyState icon={<CalendarCheck size={40} />} title="No weekly reviews yet" message="Create structured weekly reviews to track your performance, lessons learned, and areas for improvement." />
        </div>
      ) : (
        <>
          {reviews.length >= 2 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
              <div className="card p-4">
                <h3 className="text-xs font-bold text-secondary mb-3">Weekly P&L Trend</h3>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="week" stroke="var(--text-muted)" fontSize={10} tickLine={false} />
                      <YAxis stroke="var(--text-muted)" fontSize={10} tickLine={false} />
                      <Tooltip contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px' }} />
                      <Bar dataKey="pnl" fill="var(--brand)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="card p-4">
                <h3 className="text-xs font-bold text-secondary mb-3">Weekly Rating Trend</h3>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="week" stroke="var(--text-muted)" fontSize={10} tickLine={false} />
                      <YAxis domain={[0, 10]} stroke="var(--text-muted)" fontSize={10} tickLine={false} />
                      <Tooltip contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px' }} />
                      <Line type="monotone" dataKey="rating" stroke="var(--accent)" strokeWidth={2} dot={{ fill: 'var(--accent)', r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {reviews.map(review => (
              <ReviewCard key={review.id} review={review} onEdit={() => { setEditing(review); setShowForm(true); }} onDelete={() => handleDelete(review.id)} />
            ))}
          </div>
        </>
      )}

      <Modal open={showForm} onClose={() => { setShowForm(false); setEditing(null); }} title={editing ? 'Edit Weekly Review' : 'New Weekly Review'} size="lg">
        <ReviewForm initial={editing} trades={trades} onSave={handleSave} onCancel={() => { setShowForm(false); setEditing(null); }} />
      </Modal>
    </div>
  );
}

function ReviewCard({ review, onEdit, onDelete }: { review: WeeklyReview; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="card p-5 card-hover">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold">{format(parseISO(review.week_start), 'MMM d')} – {format(parseISO(review.week_end), 'MMM d, yyyy')}</h3>
          <div className="flex items-center gap-2 mt-1">
            <div className="flex items-center gap-0.5">
              {Array.from({ length: 10 }, (_, i) => (
                <Star key={i} size={10} className={i < review.rating ? 'text-amber-500 fill-current' : 'text-muted/30'} />
              ))}
            </div>
            <span className="text-xs text-muted">{review.rating}/10</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className={`text-sm font-bold ${review.pnl >= 0 ? 'text-success-500' : 'text-error-500'}`}>{review.pnl >= 0 ? '+' : ''}${review.pnl.toFixed(2)}</p>
            <p className="text-xs text-muted">{review.trades_taken} trades</p>
          </div>
          <div className="flex gap-1">
            <button onClick={onEdit} className="btn-ghost p-1.5 text-xs">Edit</button>
            <button onClick={onDelete} className="btn-ghost p-1.5 text-error-500 hover:bg-error-500/10"><Trash2 size={14} /></button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        {review.what_went_well && (
          <div><p className="font-semibold text-success-500 mb-0.5">What Went Well</p><p className="text-secondary whitespace-pre-wrap">{review.what_went_well}</p></div>
        )}
        {review.what_went_wrong && (
          <div><p className="font-semibold text-error-500 mb-0.5">What Went Wrong</p><p className="text-secondary whitespace-pre-wrap">{review.what_went_wrong}</p></div>
        )}
        {review.lessons_learned && (
          <div><p className="font-semibold text-brand-500 mb-0.5">Lessons Learned</p><p className="text-secondary whitespace-pre-wrap">{review.lessons_learned}</p></div>
        )}
        {review.focus_next_week && (
          <div><p className="font-semibold text-amber-500 mb-0.5">Focus Next Week</p><p className="text-secondary whitespace-pre-wrap">{review.focus_next_week}</p></div>
        )}
      </div>

      {review.psychological_notes && (
        <div className="mt-2 pt-2 border-t border-themed">
          <p className="text-xs"><span className="font-semibold text-muted flex items-center gap-1"><Brain size={11} /> Psychological Notes</span></p>
          <p className="text-xs text-secondary mt-0.5 whitespace-pre-wrap">{review.psychological_notes}</p>
        </div>
      )}
      {review.screenshot_url && (
        <div className="mt-3 rounded-lg overflow-hidden border border-themed">
          <MediaImage source={review.screenshot_url} alt="Weekly review chart" className="w-full max-h-64 object-contain bg-secondary" />
        </div>
      )}
      {review.voice_note_url && <div className="mt-3"><MediaAudioPlayer source={review.voice_note_url} /></div>}
    </div>
  );
}

function ReviewForm({ initial, trades, onSave, onCancel }: { initial: WeeklyReview | null; trades: ReturnType<typeof useTrades>['trades']; onSave: (data: WeeklyReviewInput, id?: string) => void; onCancel: () => void }) {
  const { user } = useAuth();
  const { strategies } = useStrategies(user?.id);
  const { plans } = useTradingPlans(user?.id);
  const { accounts } = useTradingAccounts(user?.id);
  const { setups } = useSetups(user?.id);
  const { instruments } = useMarketInstruments(user?.id);
  const [weekStart, setWeekStart] = useState(initial?.week_start || format(startOfWeek(new Date()), 'yyyy-MM-dd'));
  const [weekEnd, setWeekEnd] = useState(initial?.week_end || format(endOfWeek(new Date()), 'yyyy-MM-dd'));
  const [rating, setRating] = useState(initial?.rating ?? 5);
  const [tradesTaken, setTradesTaken] = useState(initial?.trades_taken?.toString() || '0');
  const [tradesPlanned, setTradesPlanned] = useState(initial?.trades_planned?.toString() || '0');
  const [pnl, setPnl] = useState(initial?.pnl?.toString() || '0');
  const [whatWentWell, setWhatWentWell] = useState(initial?.what_went_well || '');
  const [whatWentWrong, setWhatWentWrong] = useState(initial?.what_went_wrong || '');
  const [lessonsLearned, setLessonsLearned] = useState(initial?.lessons_learned || '');
  const [focusNextWeek, setFocusNextWeek] = useState(initial?.focus_next_week || '');
  const [psychNotes, setPsychNotes] = useState(initial?.psychological_notes || '');
  const [screenshotUrl, setScreenshotUrl] = useState(initial?.screenshot_url || null);
  const [voiceUrl, setVoiceUrl] = useState(initial?.voice_note_url || null);
  const [strategyId, setStrategyId] = useState(initial?.strategy_id || '');
  const [entryModelId, setEntryModelId] = useState(initial?.entry_model_id || '');
  const [planId, setPlanId] = useState(initial?.plan_id || '');
  const [accountId, setAccountId] = useState(initial?.account_id || '');
  const [setupId, setSetupId] = useState(initial?.setup_id || '');
  const [instrumentId, setInstrumentId] = useState(initial?.instrument_id || '');
  const [saving, setSaving] = useState(false);
  const { models: entryModels } = useStrategyEntryModels(strategyId || null);

  const autoPullStats = () => {
    if (!weekStart || !weekEnd) return;
    const start = parseISO(weekStart);
    const end = parseISO(weekEnd);
    const weekTrades = trades.filter(t => {
      if (!t.entry_time) return false;
      return isWithinInterval(parseISO(t.entry_time), { start, end });
    });
    setTradesTaken(String(weekTrades.length));
    setPnl(String(weekTrades.reduce((s, t) => s + (t.pnl || 0), 0).toFixed(2)));
  };

  const handleSave = async () => {
    setSaving(true);
    await onSave({
      week_start: weekStart,
      week_end: weekEnd,
      rating,
      trades_taken: parseInt(tradesTaken) || 0,
      trades_planned: parseInt(tradesPlanned) || 0,
      pnl: parseFloat(pnl) || 0,
      what_went_well: whatWentWell || null,
      what_went_wrong: whatWentWrong || null,
      lessons_learned: lessonsLearned || null,
      focus_next_week: focusNextWeek || null,
      psychological_notes: psychNotes || null,
      screenshot_url: screenshotUrl || null,
      voice_note_url: voiceUrl || null,
      strategy_id: strategyId || null,
      entry_model_id: entryModelId || null,
      plan_id: planId || null,
      account_id: accountId || null,
      setup_id: setupId || null,
      instrument_id: instrumentId || null,
    }, initial?.id);
    setSaving(false);
  };

  const inputCls = 'input-field';
  const labelCls = 'block text-xs font-semibold text-secondary mb-1.5';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div><label className={labelCls}>Week Start</label><input type="date" className={inputCls} value={weekStart} onChange={e => setWeekStart(e.target.value)} /></div>
        <div><label className={labelCls}>Week End</label><input type="date" className={inputCls} value={weekEnd} onChange={e => setWeekEnd(e.target.value)} /></div>
      </div>

      <button onClick={autoPullStats} className="btn-secondary text-xs py-1.5 px-3">
        <TrendingUp size={14} /> Auto-pull from Trade Journal
      </button>

      <div className="grid grid-cols-2 gap-4">
        <div><label className={labelCls}>Strategy</label><select className={inputCls} value={strategyId} onChange={e => { setStrategyId(e.target.value); setEntryModelId(''); }}><option value="">No strategy linked</option>{strategies.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div><label className={labelCls}>Account</label><select className={inputCls} value={accountId} onChange={e => setAccountId(e.target.value)}><option value="">All accounts</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.base_currency})</option>)}</select></div>
        <div><label className={labelCls}>Setup</label><select className={inputCls} value={setupId} onChange={e => setSetupId(e.target.value)}><option value="">None</option>{setups.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div><label className={labelCls}>Instrument</label><select className={inputCls} value={instrumentId} onChange={e => setInstrumentId(e.target.value)}><option value="">All instruments</option>{instruments.map(i => <option key={i.id} value={i.id}>{i.symbol}</option>)}</select></div>
      </div>
      <div className="grid grid-cols-2 gap-4"><div><label className={labelCls}>Entry model</label><select className={inputCls} value={entryModelId} onChange={e => setEntryModelId(e.target.value)}><option value="">General / unspecified</option>{entryModels.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></div><div><label className={labelCls}>Trading plan</label><select className={inputCls} value={planId} onChange={e => setPlanId(e.target.value)}><option value="">No plan linked</option>{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.title}</option>)}</select></div></div>

      <div>
        <label className={labelCls}>Performance Rating: {rating}/10</label>
        <input type="range" min={1} max={10} value={rating} onChange={e => setRating(parseInt(e.target.value))} className="w-full accent-orange-500" />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div><label className={labelCls}>Trades Taken</label><input type="number" className={inputCls} value={tradesTaken} onChange={e => setTradesTaken(e.target.value)} /></div>
        <div><label className={labelCls}>Trades Planned</label><input type="number" className={inputCls} value={tradesPlanned} onChange={e => setTradesPlanned(e.target.value)} /></div>
        <div><label className={labelCls}>P&L ($)</label><input type="number" className={inputCls} value={pnl} onChange={e => setPnl(e.target.value)} /></div>
      </div>

      <div><label className={labelCls}>What Went Well</label><textarea className={inputCls} rows={2} value={whatWentWell} onChange={e => setWhatWentWell(e.target.value)} placeholder="Wins, good discipline, followed plan..." /></div>
      <div><label className={labelCls}>What Went Wrong</label><textarea className={inputCls} rows={2} value={whatWentWrong} onChange={e => setWhatWentWrong(e.target.value)} placeholder="Losses, mistakes, broke rules..." /></div>
      <div><label className={labelCls}>Lessons Learned</label><textarea className={inputCls} rows={2} value={lessonsLearned} onChange={e => setLessonsLearned(e.target.value)} placeholder="Key takeaways from this week..." /></div>
      <div><label className={labelCls}>Focus Next Week</label><textarea className={inputCls} rows={2} value={focusNextWeek} onChange={e => setFocusNextWeek(e.target.value)} placeholder="What to focus on improving..." /></div>
      <div><label className={labelCls}>Psychological Notes</label><textarea className={inputCls} rows={2} value={psychNotes} onChange={e => setPsychNotes(e.target.value)} placeholder="Emotional state, psychology observations..." /></div>

      <div>
        <label className={labelCls}>Chart Screenshot</label>
        <ScreenshotUpload onUpload={setScreenshotUrl} existingUrl={screenshotUrl} label="Upload weekly recap chart" />
      </div>
      <div><label className={labelCls}>Voice note</label><VoiceRecorder onUpload={setVoiceUrl} existingUrl={voiceUrl} /></div>

      <div className="flex gap-3 pt-2">
        <button onClick={handleSave} disabled={saving || !weekStart || !weekEnd} className="btn-primary flex-1">
          <Save size={16} /> {saving ? 'Saving...' : 'Save Review'}
        </button>
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
      </div>
    </div>
  );
}

