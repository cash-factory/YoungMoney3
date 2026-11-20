import { ExecutionSummaryCards } from '@/components/ExecutionMetrics';
import { simulatedExecutionTrade } from '@/lib/executionPresentation';
import { useState, useMemo, useEffect } from 'react';
import { FlaskConical, Plus, Trash2, Save, ChevronDown, ChevronRight, TrendingUp, BarChart3 } from 'lucide-react';
import { ScreenshotUpload } from '@/components/ScreenshotUpload';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import { useChecklist, useTestSessions, useTestTrades, useStrategies, useStrategyChecklist, useStrategyEntryModels, useTradingPlans, useTradingAccounts, useMarketInstruments, useSetups } from '@/hooks/useData';
import { useAuth } from '@/context/AuthContext';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { MediaAudioPlayer, MediaImage } from '@/components/MediaPreview';
import { VoiceRecorder } from '@/components/VoiceRecorder';
import { BacktestingPage } from '@/pages/BacktestingPage';
import { ForwardTestingPage } from '@/pages/ForwardTestingPage';
import { LoadingSpinner, EmptyState } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Modal';
import { StatCard } from '@/components/ui/StatCard';
import type { StrategyTestSession, StrategyTestSessionInput, StrategyTestTrade, StrategyTestTradeInput, TestTradeOutcome } from '@/lib/types';
import { defaultTradeLevels, distancePresets, examplePriceIsUnconfirmed, instrumentDistanceLabel, instrumentPnl, priceAtDistance } from '@/lib/instrumentMath';
import { format, parseISO } from 'date-fns';
import { setupQualityFromChecklist } from '@/lib/setupQuality';

export function StrategyTestingPage({ initialMode = 'sessions' }: { initialMode?: 'sessions' | 'legacy' | 'forward' }) {
  const { user } = useAuth();
  const { sessions, loading, upsertSession, deleteSession } = useTestSessions(user?.id);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<StrategyTestSession | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [mode, setMode] = useState(initialMode);

  useEffect(() => setMode(initialMode), [initialMode]);

  const handleSave = async (data: StrategyTestSessionInput, id?: string) => {
    await upsertSession(data, id);
    setShowForm(false);
    setEditing(null);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this test session and all its trades?')) {
      await deleteSession(id);
      if (expandedId === id) setExpandedId(null);
    }
  };

  const tabs = <div className="flex flex-wrap gap-2 mb-5">{([['sessions', 'Test Sessions'], ['legacy', 'Backtest Summaries'], ['forward', 'Forward Trades']] as const).map(([id, label]) => <button key={id} onClick={() => setMode(id)} className={`px-3 py-2 rounded-lg text-xs font-semibold border ${mode === id ? 'bg-orange-500/10 text-orange-600 border-orange-500/30' : 'bg-secondary border-themed text-secondary'}`}>{label}</button>)}</div>;
  if (mode === 'legacy') return <div>{tabs}<BacktestingPage /></div>;
  if (mode === 'forward') return <div>{tabs}<ForwardTestingPage /></div>;
  if (loading) return <div>{tabs}<LoadingSpinner label="Loading test sessions..." /></div>;

  return (
    <div>
      {tabs}
      <SectionHeader
        title="Testing Workspace"
        subtitle="Run backtests, forward tests, and structured strategy sessions in one place"
        action={
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary">
            <Plus size={18} /> New Session
          </button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Total Sessions" value={String(sessions.length)} icon={<FlaskConical size={20} />} accent="blue" />
        <StatCard label="Backtests" value={String(sessions.filter(s => s.test_type === 'backtest').length)} icon={<BarChart3 size={20} />} accent="emerald" />
        <StatCard label="Forward Tests" value={String(sessions.filter(s => s.test_type === 'forward_test').length)} icon={<TrendingUp size={20} />} accent="amber" />
      </div>

      {sessions.length === 0 ? (
        <div className="card p-8">
          <EmptyState icon={<FlaskConical size={40} />} title="No test sessions yet" message="Create a backtest or forward-test session to log trades, track stats, and visualize your equity curve." />
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map(session => (
            <SessionCard
              key={session.id}
              session={session}
              expanded={expandedId === session.id}
              onToggle={() => setExpandedId(expandedId === session.id ? null : session.id)}
              onEdit={() => { setEditing(session); setShowForm(true); }}
              onDelete={() => handleDelete(session.id)}
              userId={user?.id || null}
            />
          ))}
        </div>
      )}

      <Modal open={showForm} onClose={() => { setShowForm(false); setEditing(null); }} title={editing ? 'Edit Test Session' : 'New Test Session'} size="lg">
        <SessionForm initial={editing} onSave={handleSave} onCancel={() => { setShowForm(false); setEditing(null); }} />
      </Modal>
    </div>
  );
}

function calcStats(trades: StrategyTestTrade[], initialBalance: number) {
  const total = trades.length;
  const wins = trades.filter(t => t.outcome === 'win').length;
  const losses = trades.filter(t => t.outcome === 'loss').length;
  const winRate = total ? (wins / total) * 100 : 0;
  const grossProfit = trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(trades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const avgR = trades.filter(t => t.r_multiple != null).length
    ? trades.filter(t => t.r_multiple != null).reduce((s, t) => s + (t.r_multiple || 0), 0) / trades.filter(t => t.r_multiple != null).length
    : 0;
  const expectancy = total ? trades.reduce((s, t) => s + t.pnl, 0) / total : 0;

  let equity = initialBalance;
  let peak = initialBalance;
  let maxDD = 0;
  const equityCurve: { idx: number; equity: number }[] = [{ idx: 0, equity: initialBalance }];
  for (let i = 0; i < trades.length; i++) {
    equity += trades[i].pnl;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, peak - equity);
    equityCurve.push({ idx: i + 1, equity });
  }

  return { total, wins, losses, winRate, profitFactor, avgR, expectancy, maxDD, equityCurve, finalBalance: equity };
}

function SessionCard({ session, expanded, onToggle, onEdit, onDelete, userId }: {
  session: StrategyTestSession; expanded: boolean; onToggle: () => void; onEdit: () => void; onDelete: () => void; userId: string | null;
}) {
  const { trades, loading: tradesLoading, addTrade, deleteTrade } = useTestTrades(expanded ? session.id : null);
  const { instruments } = useMarketInstruments(userId);
  const { accounts } = useTradingAccounts(userId);
  const { items: checklistItems } = useStrategyChecklist(session.strategy_id, session.entry_model_id);
  const { checklist: allPlanChecks } = useChecklist(userId);
  const applicableChecklistItems = [
    ...allPlanChecks.filter(item => item.plan_id === session.plan_id && item.is_active).map(item => ({ ...item, source_scope: 'plan' as const })),
    ...checklistItems.map(item => ({ ...item, source_scope: session.entry_model_id ? 'entry_model' as const : 'strategy' as const })),
  ];
  const selectedInstrument = instruments.find(i => i.id === session.instrument_id) || null;
  const selectedAccount = accounts.find(a => a.id === session.account_id) || null;
  const [showTradeForm, setShowTradeForm] = useState(false);

  const stats = useMemo(() => calcStats(trades, session.initial_balance), [trades, session.initial_balance]);

  return (
    <div className="card overflow-hidden">
      <div className="p-4 flex items-center justify-between cursor-pointer" onClick={onToggle}>
        <div className="flex items-center gap-3">
          {expanded ? <ChevronDown size={18} className="text-muted" /> : <ChevronRight size={18} className="text-muted" />}
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold">{session.name}</h3>
              <span className="badge badge-brand">{session.test_type === 'backtest' ? 'Backtest' : 'Forward Test'}</span>
            </div>
            <p className="text-xs text-muted">
              {session.instrument || 'N/A'} · {session.timeframe || 'N/A'}
              {session.start_date && ` · ${format(parseISO(session.start_date), 'MMM d')}`}
              {session.end_date && ` → ${format(parseISO(session.end_date), 'MMM d, yyyy')}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className={`text-sm font-bold ${stats.finalBalance >= session.initial_balance ? 'text-success-500' : 'text-error-500'}`}>
              ${stats.finalBalance.toFixed(2)}
            </p>
            <p className="text-xs text-muted">{stats.total} trades · {stats.winRate.toFixed(0)}% WR</p>
          </div>
          <div className="flex gap-1">
            <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className="btn-ghost p-1.5 text-xs">Edit</button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="btn-ghost p-1.5 text-error-500 hover:bg-error-500/10"><Trash2 size={14} /></button>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-themed p-4 space-y-4">
          {!tradesLoading && <ExecutionSummaryCards trades={trades.map(trade=>simulatedExecutionTrade({
            id:trade.id,pair:session.instrument || '',direction:trade.direction,
            entry_time:trade.entry_time,exit_time:trade.exit_time,status:'closed',
            pnl:trade.pnl,entry_price:trade.entry_price,exit_price:trade.exit_price,r:trade.r_multiple,
          }))} />}
          {trades.length > 0 && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                <StatBox label="Win Rate" value={`${stats.winRate.toFixed(1)}%`} positive={stats.winRate >= 50} />
                <StatBox label="Profit Factor" value={isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : '∞'} positive={stats.profitFactor >= 1} />
                <StatBox label="Avg R" value={`${stats.avgR.toFixed(2)}R`} positive={stats.avgR > 0} />
                <StatBox label="Expectancy" value={`$${stats.expectancy.toFixed(2)}`} positive={stats.expectancy > 0} />
                <StatBox label="Max DD" value={`$${stats.maxDD.toFixed(2)}`} positive={false} />
                <StatBox label="Total" value={String(stats.total)} positive={true} />
              </div>

              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={stats.equityCurve}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="idx" stroke="var(--text-muted)" fontSize={11} tickLine={false} />
                    <YAxis stroke="var(--text-muted)" fontSize={11} tickLine={false} domain={['auto', 'auto']} />
                    <Tooltip contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px' }} />
                    <ReferenceLine y={session.initial_balance} stroke="var(--text-muted)" strokeDasharray="4 4" />
                    <Line type="monotone" dataKey="equity" stroke="var(--brand)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-secondary">Trade Log ({trades.length})</h4>
            <button onClick={() => setShowTradeForm(true)} className="btn-secondary text-xs py-1.5 px-3">
              <Plus size={14} /> Add Trade
            </button>
          </div>

          {tradesLoading ? (
            <LoadingSpinner label="Loading trades..." />
          ) : trades.length === 0 ? (
            <p className="text-xs text-muted text-center py-4">No trades logged yet. Add your first trade to start building the equity curve.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted border-b border-themed">
                    <th className="text-left py-2 px-2">#</th>
                    <th className="text-left py-2 px-2">Dir</th>
                    <th className="text-right py-2 px-2">Entry</th>
                    <th className="text-right py-2 px-2">Exit</th>
                    <th className="text-right py-2 px-2">P&L</th>
                    <th className="text-right py-2 px-2">R</th>
                    <th className="text-center py-2 px-2">Result</th>
                    <th className="py-2 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t, i) => (
                    <tr key={t.id} className="border-b border-themed/50 hover:bg-secondary/50">
                      <td className="py-2 px-2 text-muted">{i + 1}</td>
                      <td className="py-2 px-2"><span className={t.direction === 'long' ? 'text-success-500 font-semibold' : 'text-error-500 font-semibold'}>{t.direction === 'long' ? 'L' : 'S'}</span></td>
                      <td className="py-2 px-2 text-right font-mono">{t.entry_price}</td>
                      <td className="py-2 px-2 text-right font-mono">{t.exit_price ?? '—'}</td>
                      <td className={`py-2 px-2 text-right font-mono font-semibold ${t.pnl >= 0 ? 'text-success-500' : 'text-error-500'}`}>${t.pnl.toFixed(2)}</td>
                      <td className="py-2 px-2 text-right font-mono">{t.r_multiple != null ? `${t.r_multiple}R` : '—'}</td>
                      <td className="py-2 px-2 text-center">
                        <span className={`badge ${t.outcome === 'win' ? 'badge-success' : t.outcome === 'loss' ? 'badge-error' : 'badge-neutral'} text-[10px]`}>{t.outcome}</span>
                      </td>
                      <td className="py-2 px-2"><button onClick={() => deleteTrade(t.id)} className="btn-ghost p-1 text-error-500"><Trash2 size={12} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {session.notes && <p className="text-xs text-secondary whitespace-pre-wrap pt-2 border-t border-themed">{session.notes}</p>}
          {session.screenshot_url && (
            <div className="rounded-lg overflow-hidden border border-themed pt-2">
              <MediaImage source={session.screenshot_url} alt={session.name} className="w-full max-h-64 object-contain bg-secondary" />
            </div>
          )}
          {session.voice_note_url && <MediaAudioPlayer source={session.voice_note_url} />}
        </div>
      )}

      {showTradeForm && (
        <Modal open={showTradeForm} onClose={() => setShowTradeForm(false)} title="Add Test Trade" size="md">
          <TradeForm sessionId={session.id} accountId={session.account_id || null} instrumentId={session.instrument_id || null} setupId={session.setup_id || null} strategyId={session.strategy_id || null} entryModelId={session.entry_model_id || null} entryModelMode={session.entry_model_mode || (session.entry_model_id ? 'one' : 'unspecified')} planId={session.plan_id || null} checklistItems={applicableChecklistItems} instrument={selectedInstrument} account={selectedAccount} onAdd={addTrade} onClose={() => setShowTradeForm(false)} />
        </Modal>
      )}
    </div>
  );
}

function StatBox({ label, value, positive }: { label: string; value: string; positive: boolean }) {
  return (
    <div className="card p-3">
      <p className="text-[10px] font-semibold text-muted uppercase tracking-wider">{label}</p>
      <p className={`text-sm font-bold font-mono mt-1 ${positive ? 'text-success-500' : 'text-error-500'}`}>{value}</p>
    </div>
  );
}

function SessionForm({ initial, onSave, onCancel }: { initial: StrategyTestSession | null; onSave: (data: StrategyTestSessionInput, id?: string) => void; onCancel: () => void }) {
  const { user } = useAuth();
  const { strategies } = useStrategies(user?.id);
  const { plans } = useTradingPlans(user?.id);
  const { accounts } = useTradingAccounts(user?.id);
  const { instruments } = useMarketInstruments(user?.id);
  const { setups } = useSetups(user?.id);
  const [name, setName] = useState(initial?.name || '');
  const [strategyName, setStrategyName] = useState(initial?.strategy_name || '');
  const [instrument, setInstrument] = useState(initial?.instrument || '');
  const [timeframe, setTimeframe] = useState(initial?.timeframe || '');
  const [testType, setTestType] = useState<'backtest' | 'forward_test'>(initial?.test_type || 'backtest');
  const [strategyId, setStrategyId] = useState(initial?.strategy_id || '');
  const [entryModelId, setEntryModelId] = useState(initial?.entry_model_id || '');
  const [entryModelMode, setEntryModelMode] = useState<'one' | 'all' | 'unspecified'>(initial?.entry_model_mode || (initial?.entry_model_id ? 'one' : 'unspecified'));
  const [planId, setPlanId] = useState(initial?.plan_id || '');
  const [accountId, setAccountId] = useState(initial?.account_id || '');
  const [instrumentId, setInstrumentId] = useState(initial?.instrument_id || '');
  const [setupId, setSetupId] = useState(initial?.setup_id || '');
  const [startDate, setStartDate] = useState(initial?.start_date || '');
  const [endDate, setEndDate] = useState(initial?.end_date || '');
  const [initialBalance, setInitialBalance] = useState(initial?.initial_balance?.toString() || '10000');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [screenshotUrl, setScreenshotUrl] = useState(initial?.screenshot_url || null);
  const [voiceUrl, setVoiceUrl] = useState(initial?.voice_note_url || null);
  const [saving, setSaving] = useState(false);
  const { models: entryModels } = useStrategyEntryModels(strategyId || null);

  const handleSave = async () => {
    setSaving(true);
    await onSave({
      name,
      strategy_name: strategyName || null,
      strategy_id: strategyId || null,
      entry_model_id: entryModelMode === 'one' ? entryModelId || null : null,
      entry_model_mode: entryModelMode,
      plan_id: planId || null,
      account_id: accountId || null,
      instrument_id: instrumentId || null,
      setup_id: setupId || null,
      instrument: instrument || null,
      timeframe: timeframe || null,
      test_type: testType,
      start_date: startDate || null,
      end_date: endDate || null,
      initial_balance: parseFloat(initialBalance) || 10000,
      notes: notes || null,
      screenshot_url: screenshotUrl || null,
      voice_note_url: voiceUrl || null,
    }, initial?.id);
    setSaving(false);
  };

  const inputCls = 'input-field';
  const labelCls = 'block text-xs font-semibold text-secondary mb-1.5';

  return (
    <div className="space-y-4">
      <div>
        <label className={labelCls}>Session Name</label>
        <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. EU Breakout Backtest Q1" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Test Type</label>
          <select className={inputCls} value={testType} onChange={e => setTestType(e.target.value as 'backtest' | 'forward_test')}>
            <option value="backtest">Backtest</option>
            <option value="forward_test">Forward Test</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Strategy Name</label>
          <select className={inputCls} value={strategyId} onChange={e => { setStrategyId(e.target.value); setEntryModelId(''); setStrategyName(strategies.find(s => s.id === e.target.value)?.name || ''); }}><option value="">Select strategy</option>{strategies.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-secondary">Entry model scope
          <select className={`${inputCls} mt-1.5`} value={entryModelMode} onChange={e => { const next = e.target.value as 'one' | 'all' | 'unspecified'; setEntryModelMode(next); if (next !== 'one') setEntryModelId(''); }}>
            <option value="one">Use one model for this session</option>
            <option value="all">Use all models; choose per trade</option>
            <option value="unspecified">Not specified; choose during capture</option>
          </select>
        </label>
        {entryModelMode === 'one' && <label className="text-xs font-semibold text-secondary">Session entry model
          <select className={`${inputCls} mt-1.5`} value={entryModelId} onChange={e => setEntryModelId(e.target.value)}><option value="">Choose later during trade capture</option>{entryModels.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select>
        </label>}
      </div>
      <details className="rounded-xl border border-themed p-3">
        <summary className="cursor-pointer text-sm font-semibold">Optional session context <span className="text-xs font-normal text-muted">· instrument, account, setup, timeframe, dates, and balance</span></summary>
        <div className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Instrument</label>
          <input list="test-instruments" className={inputCls} value={instrument} onChange={e => { setInstrument(e.target.value); setInstrumentId(instruments.find(i => i.symbol.toUpperCase() === e.target.value.toUpperCase())?.id || ''); }} placeholder="Search or type symbol" />
          <datalist id="test-instruments">{instruments.map(i => <option key={i.id} value={i.symbol}>{i.display_name}</option>)}</datalist>
        </div>
        <div>
          <label className={labelCls}>Timeframe</label>
          <input className={inputCls} value={timeframe} onChange={e => setTimeframe(e.target.value)} placeholder="e.g. 15m" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4"><div><label className={labelCls}>Account</label><select className={inputCls} value={accountId} onChange={e => { const a = accounts.find(x => x.id === e.target.value); setAccountId(e.target.value); if (a?.default_strategy_id) { setStrategyId(a.default_strategy_id); setStrategyName(strategies.find(s => s.id === a.default_strategy_id)?.name || ''); } setPlanId(a?.default_plan_id || ''); }}><option value="">No account</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name} · {a.base_currency}</option>)}</select></div><div><label className={labelCls}>Setup</label><select className={inputCls} value={setupId} onChange={e => setSetupId(e.target.value)}><option value="">No setup linked</option>{setups.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div><label className={labelCls}>Trading plan</label><select className={inputCls} value={planId} onChange={e => setPlanId(e.target.value)}><option value="">No plan linked</option>{plans.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className={labelCls}>Start Date</label>
          <input type="date" className={inputCls} value={startDate} onChange={e => setStartDate(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>End Date</label>
          <input type="date" className={inputCls} value={endDate} onChange={e => setEndDate(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Initial Balance</label>
          <input type="number" className={inputCls} value={initialBalance} onChange={e => setInitialBalance(e.target.value)} />
        </div>
      </div>
      <div>
        <label className={labelCls}>Notes</label>
        <textarea className={inputCls} rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Session notes..." />
      </div>
        </div>
      </details>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><div><label className={labelCls}>Session Chart Image</label><ScreenshotUpload onUpload={setScreenshotUrl} existingUrl={screenshotUrl} label="Upload session summary chart" /></div><div><label className={labelCls}>Voice Note</label><VoiceRecorder onUpload={setVoiceUrl} existingUrl={voiceUrl} /></div></div>
      <div className="flex gap-3 pt-2">
        <button onClick={handleSave} disabled={saving || !name} className="btn-primary flex-1">
          <Save size={16} /> {saving ? 'Saving...' : 'Save Session'}
        </button>
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
      </div>
    </div>
  );
}

function TradeForm({ sessionId, accountId, instrumentId, setupId, strategyId, entryModelId, entryModelMode, planId, checklistItems, instrument, account, onAdd, onClose }: { sessionId: string; accountId: string | null; instrumentId: string | null; setupId: string | null; strategyId: string | null; entryModelId: string | null; entryModelMode: 'one' | 'all' | 'unspecified'; planId: string | null; checklistItems: { id: string; label: string; is_required: boolean; source_scope: 'plan' | 'strategy' | 'entry_model' }[]; instrument: import('@/lib/types').MarketInstrument | null; account: import('@/lib/types').TradingAccount | null; onAdd: (t: StrategyTestTradeInput) => Promise<void>; onClose: () => void }) {
  const { models: entryModels } = useStrategyEntryModels(strategyId);
  const [selectedEntryModelId, setSelectedEntryModelId] = useState(entryModelId || '');
  const { items: selectedModelChecks } = useStrategyChecklist(strategyId, selectedEntryModelId || null);
  const [direction, setDirection] = useState<'long' | 'short'>('long');
  const [entryPrice, setEntryPrice] = useState('');
  const [exitPrice, setExitPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [positionSize, setPositionSize] = useState('1');
  const [pnl, setPnl] = useState('');
  const [rMultiple, setRMultiple] = useState('');
  const [outcome, setOutcome] = useState<TestTradeOutcome>('win');
  const [notes, setNotes] = useState('');
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null);
  const [conversionRate, setConversionRate] = useState('1');
  const [exampleConfirmed, setExampleConfirmed] = useState(false);
  const [checkedItems, setCheckedItems] = useState<string[]>([]);
  const [stopManual, setStopManual] = useState(false);
  const [targetManual, setTargetManual] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!instrument) return;
    if (!entryPrice && instrument.example_price != null) {
      setEntryPrice(String(instrument.example_price));
      const levels = defaultTradeLevels(instrument, instrument.example_price, direction);
      setStopLoss(String(levels.stop)); setTakeProfit(String(levels.target)); setStopManual(false); setTargetManual(false);
    }
    if (!positionSize || positionSize === '1') setPositionSize(String(instrument.example_size));
    if (instrument.quote_currency !== account?.base_currency) setConversionRate('');
  }, [instrument, entryPrice, direction, positionSize, account?.base_currency]);

  const rate = instrument?.quote_currency === account?.base_currency ? 1 : Number(conversionRate);
  const calculatedPnl = instrument && entryPrice && exitPrice && positionSize && rate > 0
    ? instrumentPnl(instrument, direction, Number(entryPrice), Number(exitPrice), Number(positionSize), rate)
    : Number(pnl) || 0;
  const riskAmount = instrument && entryPrice && stopLoss && positionSize && rate > 0
    ? Math.abs(instrumentPnl(instrument, direction, Number(entryPrice), Number(stopLoss), Number(positionSize), rate))
    : 0;
  const calculatedR = riskAmount ? calculatedPnl / riskAmount : (rMultiple.trim() && Number.isFinite(Number(rMultiple)) ? Number(rMultiple) : null);
  const autoOutcome: TestTradeOutcome = calculatedPnl > 0 ? 'win' : calculatedPnl < 0 ? 'loss' : 'breakeven';
  const usesExample = examplePriceIsUnconfirmed(Number(entryPrice) || null, instrument);
  const tradeChecklist = [
    ...checklistItems.filter(item => item.source_scope !== 'entry_model'),
    ...selectedModelChecks.map(item => ({ ...item, source_scope: 'entry_model' as const })),
  ];
  const checklistSnapshot = tradeChecklist.map(item => ({ id: item.id, label: item.label, checked: checkedItems.includes(item.id), is_required: item.is_required, source_scope: item.source_scope }));
  const setupQuality = setupQualityFromChecklist(checklistSnapshot);

  const handleSave = async () => {
    if (usesExample && !exampleConfirmed) return;
    if (instrument && instrument.quote_currency !== account?.base_currency && !(rate > 0)) return;
    setSaving(true);
    await onAdd({
      session_id: sessionId,
      direction,
      entry_price: parseFloat(entryPrice) || 0,
      exit_price: exitPrice ? parseFloat(exitPrice) : null,
      stop_loss: stopLoss ? parseFloat(stopLoss) : null,
      take_profit: takeProfit ? parseFloat(takeProfit) : null,
      position_size: positionSize ? parseFloat(positionSize) : null,
      pnl: calculatedPnl,
      r_multiple: calculatedR,
      outcome: instrument && exitPrice ? autoOutcome : outcome,
      entry_time: null,
      exit_time: null,
      notes: notes || null,
      screenshot_url: screenshotUrl || null,
      account_id: accountId,
      instrument_id: instrumentId,
      setup_id: setupId,
      entry_model_id: entryModelMode === 'one' && entryModelId ? entryModelId : selectedEntryModelId || null,
      plan_id: planId,
      checklist_items: checklistSnapshot,
      setup_quality: setupQuality,
      conversion_rate: rate || null,
      voice_note_url: voiceUrl || null,
    });
    setSaving(false);
    onClose();
  };

  const inputCls = 'input-field';
  const labelCls = 'block text-xs font-semibold text-secondary mb-1.5';

  return (
    <div className="space-y-4">
      {(entryModelMode !== 'one' || !entryModelId) && <label className={labelCls}>Entry model for this trade {entryModelMode === 'unspecified' ? '(optional)' : ''}<select className={`${inputCls} mt-1.5`} value={selectedEntryModelId} onChange={e => setSelectedEntryModelId(e.target.value)}><option value="">No model selected</option>{entryModels.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Direction</label>
          <select className={inputCls} value={direction} onChange={e => { const next = e.target.value as 'long' | 'short'; setDirection(next); if (instrument && entryPrice) { const levels = defaultTradeLevels(instrument, Number(entryPrice), next); if (!stopManual) setStopLoss(String(levels.stop)); if (!targetManual) setTakeProfit(String(levels.target)); } }}>
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Outcome</label>
          <select className={inputCls} value={outcome} onChange={e => setOutcome(e.target.value as TestTradeOutcome)}>
            <option value="win">Win</option>
            <option value="loss">Loss</option>
            <option value="breakeven">Breakeven</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Entry Price</label>
          <input type="number" step={instrument?.price_increment || 'any'} className={inputCls} value={entryPrice} onChange={e => { setEntryPrice(e.target.value); if (instrument && Number(e.target.value) > 0) { const levels = defaultTradeLevels(instrument, Number(e.target.value), direction); if (!stopManual) setStopLoss(String(levels.stop)); if (!targetManual) setTakeProfit(String(levels.target)); } }} placeholder={instrument?.example_price?.toString() || 'Entry'} />
        </div>
        <div>
          <label className={labelCls}>Exit Price</label>
          <input type="number" step={instrument?.price_increment || 'any'} className={inputCls} value={exitPrice} onChange={e => setExitPrice(e.target.value)} placeholder="Exit" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Stop Loss</label>
          <input type="number" step={instrument?.price_increment || 'any'} className={inputCls} value={stopLoss} onChange={e => { setStopManual(true); setStopLoss(e.target.value); }} placeholder="Stop price" />
          {instrument && entryPrice && <div className="mt-1.5"><p className="mb-1 text-[10px] text-muted">Distances · {instrumentDistanceLabel(instrument)}</p><div className="flex flex-wrap gap-1">{distancePresets(instrument).map(distance => <button key={distance} type="button" className="rounded bg-secondary px-1.5 py-1 text-[10px]" onClick={() => { setStopLoss(String(priceAtDistance(instrument, Number(entryPrice), direction, distance, 'stop'))); setStopManual(true); if (!targetManual) setTakeProfit(String(priceAtDistance(instrument, Number(entryPrice), direction, distance * (instrument.default_target_r ?? 2), 'target'))); }}>{distance}</button>)}</div></div>}
        </div>
        <div>
          <label className={labelCls}>Take Profit</label>
          <input type="number" step={instrument?.price_increment || 'any'} className={inputCls} value={takeProfit} onChange={e => { setTargetManual(true); setTakeProfit(e.target.value); }} placeholder="Target price" />
          {instrument && entryPrice && <div className="mt-1.5"><p className="mb-1 text-[10px] text-muted">Distances · {instrumentDistanceLabel(instrument)}</p><div className="flex flex-wrap gap-1">{distancePresets(instrument).map(distance => <button key={distance} type="button" className="rounded bg-secondary px-1.5 py-1 text-[10px]" onClick={() => { setTakeProfit(String(priceAtDistance(instrument, Number(entryPrice), direction, distance, 'target'))); setTargetManual(true); }}>{distance}</button>)}</div></div>}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className={labelCls}>Position Size</label>
          <input type="number" className={inputCls} value={positionSize} onChange={e => setPositionSize(e.target.value)} placeholder="1" />
        </div>
        <div>
          <label className={labelCls}>{instrument ? 'Calculated P&L' : 'P&L (manual)'}</label>
          <input type="number" className={inputCls} value={instrument && entryPrice && exitPrice ? calculatedPnl.toFixed(2) : pnl} onChange={e => setPnl(e.target.value)} placeholder="0.00" readOnly={!!instrument && !!entryPrice && !!exitPrice} />
        </div>
        <div>
          <label className={labelCls}>R Multiple</label>
          <input type="number" step="0.1" className={inputCls} value={rMultiple} onChange={e => setRMultiple(e.target.value)} placeholder="2.0" />
        </div>
      </div>
      {instrument && <>
        <p className="text-[11px] text-muted">{instrument.display_name} · size in {instrument.quantity_unit}{usesExample ? ' · example entry price' : ''}</p>
        {usesExample && <label className="flex items-center gap-2 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300"><input type="checkbox" checked={exampleConfirmed} onChange={e => setExampleConfirmed(e.target.checked)} /> I reviewed this example price and it is my actual entry.</label>}
        {instrument.quote_currency !== account?.base_currency && <div><label className={labelCls}>Conversion {instrument.quote_currency} → {account?.base_currency || 'account currency'}</label><input type="number" min="0" step="0.000001" className={inputCls} value={conversionRate} onChange={e => setConversionRate(e.target.value)} placeholder="Enter manual rate" /></div>}
      </>}
      {tradeChecklist.length > 0 && <div className="rounded-lg border border-themed p-3"><p className="text-xs font-semibold mb-2">Plan & entry checklist · {tradeChecklist.length} items</p><div className="space-y-2">{tradeChecklist.map(item => <label key={item.id} className="flex items-start gap-2 text-xs text-secondary"><input type="checkbox" checked={checkedItems.includes(item.id)} onChange={e => setCheckedItems(current => e.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} /><span>{item.label}{item.is_required && <span className="ml-1 text-muted">· required</span>}</span></label>)}</div><p className="mt-2 text-xs text-secondary">Checklist score: {setupQuality == null ? '—' : `${setupQuality}/5`}</p>{checklistSnapshot.some(item => item.is_required && !item.checked) && <p className="mt-1 text-[11px] text-amber-600">Required checks remain incomplete.</p>}</div>}
      <div>
        <label className={labelCls}>Notes</label>
        <textarea className={inputCls} rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Trade notes..." />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><div><label className={labelCls}>Chart Screenshot</label><ScreenshotUpload onUpload={setScreenshotUrl} existingUrl={screenshotUrl} label="Upload chart screenshot" /></div><div><label className={labelCls}>Voice Note</label><VoiceRecorder onUpload={setVoiceUrl} existingUrl={voiceUrl} /></div></div>
      <div className="flex gap-3 pt-2">
        <button onClick={handleSave} disabled={saving || !entryPrice || (usesExample && !exampleConfirmed) || (!!instrument && instrument.quote_currency !== account?.base_currency && !(rate > 0))} className="btn-primary flex-1">
          <Save size={16} /> {saving ? 'Saving...' : 'Add Trade'}
        </button>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
      </div>
    </div>
  );
}
