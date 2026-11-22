import { Select } from '@/components/Select';
import { useState } from 'react';
import { FlaskConical, Plus, Trash2, Save, BarChart3, TrendingUp, Percent, Activity, Calendar } from 'lucide-react';
import { ScreenshotUpload } from '@/components/ScreenshotUpload';
import { useBacktests } from '@/hooks/useData';
import { useStrategies, useStrategyEntryModels, useTradingPlans, useMarketInstruments, useTradingAccounts, useSetups } from '@/hooks/useData';
import { useAuth } from '@/context/AuthContext';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { MediaImage } from '@/components/MediaPreview';
import { MediaAudioPlayer } from '@/components/MediaPreview';
import { VoiceRecorder } from '@/components/VoiceRecorder';
import { LoadingSpinner, EmptyState } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Modal';
import { StatCard } from '@/components/ui/StatCard';
import type { BacktestResult, BacktestInput } from '@/lib/types';
import { format, parseISO } from 'date-fns';
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, BarChart, Bar, Cell } from 'recharts';

export function BacktestingPage() {
  const { user } = useAuth();
  const { backtests, loading, addBacktest, deleteBacktest } = useBacktests(user?.id);
  const [showForm, setShowForm] = useState(false);

  const totalTests = backtests.length;
  const avgWinRate = backtests.length ? backtests.reduce((s, b) => s + parseFloat(String(b.win_rate)), 0) / backtests.length : 0;
  const avgPF = backtests.length ? backtests.reduce((s, b) => s + parseFloat(String(b.profit_factor)), 0) / backtests.length : 0;
  const bestTest = backtests.length ? backtests.reduce((best, b) => parseFloat(String(b.profit_factor)) > parseFloat(String(best.profit_factor)) ? b : best) : null;

  const handleDelete = async (id: string) => {
    if (confirm('Delete this backtest result?')) await deleteBacktest(id);
  };

  if (loading) return <LoadingSpinner label="Loading backtests..." />;

  return (
    <div>
      <SectionHeader
        title="Backtesting"
        subtitle="Record and analyze your strategy backtests with full performance metrics"
        action={
          <button onClick={() => setShowForm(true)} className="btn-primary">
            <Plus size={18} /> New Backtest
          </button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Tests" value={String(totalTests)} icon={<FlaskConical size={20} />} accent="blue" />
        <StatCard label="Avg Win Rate" value={`${avgWinRate.toFixed(1)}%`} icon={<Percent size={20} />} accent="emerald" />
        <StatCard label="Avg Profit Factor" value={avgPF.toFixed(2)} icon={<TrendingUp size={20} />} accent="amber" />
        <StatCard label="Best PF" value={bestTest ? parseFloat(String(bestTest.profit_factor)).toFixed(2) : '—'} icon={<Activity size={20} />} accent="rose" sublabel={bestTest?.name} />
      </div>

      {backtests.length === 0 ? (
        <div className="card p-8">
          <EmptyState icon={<FlaskConical size={40} />} title="No backtests yet" message="Record your strategy backtests to track win rate, profit factor, max drawdown, and Sharpe ratio over time." />
        </div>
      ) : (
        <div className="space-y-4">
          {backtests.map(bt => (
            <BacktestCard key={bt.id} bt={bt} onDelete={() => handleDelete(bt.id)} />
          ))}
        </div>
      )}

      <Modal open={showForm} onClose={() => setShowForm(false)} title="New Backtest Result" size="lg">
        <BacktestForm onSave={async (data) => { await addBacktest(data); setShowForm(false); }} onCancel={() => setShowForm(false)} />
      </Modal>
    </div>
  );
}

function BacktestCard({ bt, onDelete }: { bt: BacktestResult; onDelete: () => void }) {
  const equityCurve = (bt.equity_curve || []).map((p: { date: string; equity: number }) => ({ date: p.date, equity: parseFloat(String(p.equity)) }));
  const monthlyPerf = (bt.monthly_performance || []).map((m: { month: string; pnl: number }) => ({ month: m.month, pnl: parseFloat(String(m.pnl)) }));
  const totalReturn = parseFloat(String(bt.initial_balance)) > 0
    ? ((parseFloat(String(bt.final_balance)) - parseFloat(String(bt.initial_balance))) / parseFloat(String(bt.initial_balance))) * 100
    : 0;

  return (
    <div className="card p-5 card-hover">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-base font-bold">{bt.name}</h3>
            <span className="badge badge-neutral">{bt.instrument}</span>
          </div>
          <p className="text-xs text-muted">Created {format(parseISO(bt.created_at), 'MMM d, yyyy')}</p>
        </div>
        <button onClick={onDelete} className="btn-ghost p-1.5 text-error-500 hover:bg-error-500/10"><Trash2 size={16} /></button>
      </div>

      {bt.screenshot_url && (
        <div className="mb-4 rounded-lg overflow-hidden border border-themed">
          <MediaImage source={bt.screenshot_url} alt={bt.name} className="w-full max-h-64 object-contain bg-secondary" />
        </div>
      )}
      {bt.voice_note_url && <div className="mb-4"><MediaAudioPlayer source={bt.voice_note_url} /></div>}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-4">
        <Metric label="Trades" value={String(bt.total_trades)} />
        <Metric label="Win Rate" value={`${parseFloat(String(bt.win_rate)).toFixed(1)}%`} />
        <Metric label="Profit Factor" value={parseFloat(String(bt.profit_factor)).toFixed(2)} />
        <Metric label="Max DD" value={`${parseFloat(String(bt.max_drawdown)).toFixed(1)}%`} />
        <Metric label="Sharpe" value={parseFloat(String(bt.sharpe_ratio)).toFixed(2)} />
        <Metric label="Avg R:R" value={parseFloat(String(bt.avg_rr)).toFixed(2)} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-semibold text-secondary mb-2 flex items-center gap-1"><TrendingUp size={12} /> Equity Curve</p>
          {equityCurve.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={equityCurve}>
                <XAxis dataKey="date" hide />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-themed)', borderRadius: 8, fontSize: 12 }} />
                <Line type="monotone" dataKey="equity" stroke="var(--brand)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-xs text-muted">No equity curve data</p>
          )}
        </div>
        <div>
          <p className="text-xs font-semibold text-secondary mb-2 flex items-center gap-1"><BarChart3 size={12} /> Monthly Performance</p>
          {monthlyPerf.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={monthlyPerf}>
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-themed)', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                  {monthlyPerf.map((entry, i) => (
                    <Cell key={i} fill={entry.pnl >= 0 ? '#10b981' : '#f54030'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-xs text-muted">No monthly data</p>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-4 text-xs">
        <span className="text-muted">Initial: ${parseFloat(String(bt.initial_balance)).toLocaleString()}</span>
        <span className="text-muted">Final: ${parseFloat(String(bt.final_balance)).toLocaleString()}</span>
        <span className={totalReturn >= 0 ? 'text-success-500 font-semibold' : 'text-error-500 font-semibold'}>
          {totalReturn >= 0 ? '+' : ''}{totalReturn.toFixed(1)}%
        </span>
        {bt.start_date && bt.end_date && (
          <span className="text-muted flex items-center gap-1"><Calendar size={11} /> {bt.start_date} → {bt.end_date}</span>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center p-2 rounded-lg bg-secondary/50">
      <p className="text-[10px] text-muted uppercase tracking-wider">{label}</p>
      <p className="text-sm font-bold font-mono">{value}</p>
    </div>
  );
}

function BacktestForm({ onSave, onCancel }: { onSave: (data: BacktestInput) => void; onCancel: () => void }) {
  const { user } = useAuth();
  const { strategies } = useStrategies(user?.id);
  const { plans } = useTradingPlans(user?.id);
  const { instruments } = useMarketInstruments(user?.id);
  const { accounts } = useTradingAccounts(user?.id);
  const { setups } = useSetups(user?.id);
  const [name, setName] = useState('');
  const [instrument, setInstrument] = useState('');
  const [initialBalance, setInitialBalance] = useState('10000');
  const [finalBalance, setFinalBalance] = useState('10000');
  const [totalTrades, setTotalTrades] = useState('0');
  const [winRate, setWinRate] = useState('0');
  const [profitFactor, setProfitFactor] = useState('0');
  const [maxDrawdown, setMaxDrawdown] = useState('0');
  const [sharpeRatio, setSharpeRatio] = useState('0');
  const [avgRr, setAvgRr] = useState('0');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null);
  const [strategyId, setStrategyId] = useState('');
  const [entryModelId, setEntryModelId] = useState('');
  const [planId, setPlanId] = useState('');
  const [instrumentId, setInstrumentId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [setupId, setSetupId] = useState('');
  const selectedInstrument = instruments.find(item => item.id === instrumentId);
  const [saving, setSaving] = useState(false);
  const { models: entryModels } = useStrategyEntryModels(strategyId || null);

  const handleSave = async () => {
    setSaving(true);
    await onSave({
      name,
      instrument,
      strategy_rules: {},
      equity_curve: [],
      trades: [],
      start_date: startDate || null,
      end_date: endDate || null,
      initial_balance: parseFloat(initialBalance) || 0,
      final_balance: parseFloat(finalBalance) || 0,
      total_trades: parseInt(totalTrades) || 0,
      win_rate: parseFloat(winRate) || 0,
      profit_factor: parseFloat(profitFactor) || 0,
      max_drawdown: parseFloat(maxDrawdown) || 0,
      sharpe_ratio: parseFloat(sharpeRatio) || 0,
      avg_rr: parseFloat(avgRr) || 0,
      monthly_performance: [],
      screenshot_url: screenshotUrl || null,
      strategy_id: strategyId || null,
      entry_model_id: entryModelId || null,
      plan_id: planId || null,
      instrument_id: instrumentId || null,
      account_id: accountId || null,
      setup_id: setupId || null,
      voice_note_url: voiceUrl || null,
    });
    setSaving(false);
  };

  const inputCls = 'input-field';
  const labelCls = 'block text-xs font-semibold text-secondary mb-1.5';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Backtest Name</label>
          <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="ICT Model - EUR/USD 2024" />
        </div>
        <div>
          <label className={labelCls}>Instrument</label>
          <input className={inputCls} value={instrument} onChange={e => setInstrument(e.target.value)} placeholder="EUR/USD" />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div><label className={labelCls}>Strategy</label><Select className={inputCls} value={strategyId} onChange={e => { setStrategyId(e.target.value); setEntryModelId(''); }}><option value="">No strategy linked</option>{strategies.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
        <div><label className={labelCls}>Setup</label><Select className={inputCls} value={setupId} onChange={e => setSetupId(e.target.value)}><option value="">No setup linked</option>{setups.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
        <div><label className={labelCls}>Instrument catalog</label><Select className={inputCls} value={instrumentId} onChange={e => { setInstrumentId(e.target.value); const item = instruments.find(i => i.id === e.target.value); if (item) setInstrument(item.symbol); }}><option value="">Custom / legacy</option>{instruments.map(i => <option key={i.id} value={i.id}>{i.symbol}</option>)}</Select></div>
        <div><label className={labelCls}>Account</label><Select className={inputCls} value={accountId} onChange={e => setAccountId(e.target.value)}><option value="">No account linked</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.base_currency})</option>)}</Select></div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><div><label className={labelCls}>Entry model</label><Select className={inputCls} value={entryModelId} onChange={e => setEntryModelId(e.target.value)}><option value="">General / unspecified</option>{entryModels.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</Select></div><div><label className={labelCls}>Trading plan</label><Select className={inputCls} value={planId} onChange={e => setPlanId(e.target.value)}><option value="">No plan linked</option>{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.title}</option>)}</Select></div></div>
      {selectedInstrument?.example_price != null && <p className="text-xs text-amber-600">Starter value for {selectedInstrument.symbol}: {selectedInstrument.example_price} (static example only).</p>}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Start Date</label>
          <input type="date" className={inputCls} value={startDate} onChange={e => setStartDate(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>End Date</label>
          <input type="date" className={inputCls} value={endDate} onChange={e => setEndDate(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Initial Balance</label>
          <input type="number" className={inputCls} value={initialBalance} onChange={e => setInitialBalance(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Final Balance</label>
          <input type="number" className={inputCls} value={finalBalance} onChange={e => setFinalBalance(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className={labelCls}>Total Trades</label>
          <input type="number" className={inputCls} value={totalTrades} onChange={e => setTotalTrades(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Win Rate (%)</label>
          <input type="number" className={inputCls} value={winRate} onChange={e => setWinRate(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Profit Factor</label>
          <input type="number" className={inputCls} value={profitFactor} onChange={e => setProfitFactor(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className={labelCls}>Max Drawdown (%)</label>
          <input type="number" className={inputCls} value={maxDrawdown} onChange={e => setMaxDrawdown(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Sharpe Ratio</label>
          <input type="number" className={inputCls} value={sharpeRatio} onChange={e => setSharpeRatio(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Avg R:R</label>
          <input type="number" className={inputCls} value={avgRr} onChange={e => setAvgRr(e.target.value)} />
        </div>
      </div>

      <div>
        <label className={labelCls}>Result Chart Image</label>
        <ScreenshotUpload onUpload={setScreenshotUrl} existingUrl={screenshotUrl} label="Upload equity curve or result chart" />
      </div>
      <div><label className={labelCls}>Voice note</label><VoiceRecorder onUpload={setVoiceUrl} existingUrl={voiceUrl} /></div>

      <div className="flex gap-3 pt-2">
        <button onClick={handleSave} disabled={saving || !name || !instrument} className="btn-primary flex-1">
          <Save size={16} /> {saving ? 'Saving...' : 'Save Backtest'}
        </button>
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
      </div>
    </div>
  );
}
