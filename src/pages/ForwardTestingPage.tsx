import { ExecutionSummaryCards } from '@/components/ExecutionMetrics';
import { simulatedExecutionTrade } from '@/lib/executionPresentation';
import { useState } from 'react';
import { ArrowRightCircle, Plus, Trash2, Save, Activity, TrendingUp, TrendingDown, Minus, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { ScreenshotUpload } from '@/components/ScreenshotUpload';
import { useForwardTrades, useStrategies, useStrategyEntryModels, useTradingPlans, useSetups, useMarketInstruments, useTradingAccounts } from '@/hooks/useData';
import { useAuth } from '@/context/AuthContext';
import { EntitySelect } from '@/components/EntitySelect';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { MediaImage } from '@/components/MediaPreview';
import { MediaAudioPlayer } from '@/components/MediaPreview';
import { VoiceRecorder } from '@/components/VoiceRecorder';
import { examplePriceIsUnconfirmed } from '@/lib/instrumentMath';
import { LoadingSpinner, EmptyState } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Modal';
import { StatCard } from '@/components/ui/StatCard';
import type { ForwardTrade, ForwardTradeInput, ForwardTradeStatus, EmotionalState } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';

const EMOTIONAL_STATES: EmotionalState[] = ['calm', 'confident', 'rushed', 'frustrated', 'focused', 'anxious', 'greedy', 'fearful'];

export function ForwardTestingPage() {
  const { user } = useAuth();
  const { forwardTrades, loading, addForwardTrade, updateForwardTrade, deleteForwardTrade } = useForwardTrades(user?.id);
  const { instruments } = useMarketInstruments(user?.id);
  const [showForm, setShowForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState<ForwardTradeStatus | ''>('');

  const filtered = filterStatus ? forwardTrades.filter(t => t.status === filterStatus) : forwardTrades;

  const openCount = forwardTrades.filter(t => t.status === 'open').length;
  const closedTrades = forwardTrades.filter(t => t.status === 'closed');
  const totalPnl = closedTrades.reduce((s, t) => s + (parseFloat(String(t.pnl || '0'))), 0);
  const wins = closedTrades.filter(t => parseFloat(String(t.pnl || '0')) > 0).length;
  const winRate = closedTrades.length ? (wins / closedTrades.length) * 100 : 0;

  const handleDelete = async (id: string) => {
    if (confirm('Delete this forward test trade?')) await deleteForwardTrade(id);
  };

  const handleClose = async (ft: ForwardTrade) => {
    const exitPrice = prompt('Exit price:');
    if (!exitPrice) return;
    const exit = parseFloat(exitPrice);
    const direction = ft.direction === 'long' ? 1 : -1;
    const linkedInstrument = instruments.find(i => i.id === ft.instrument_id);
    const pnl = linkedInstrument
      ? (exit - ft.entry_price) * direction * ft.position_size * linkedInstrument.contract_multiplier * (ft.conversion_rate || 1)
      : (exit - ft.entry_price) * direction * ft.position_size * (ft.conversion_rate || 1);
    const pips = (exit - ft.entry_price) * direction;
    await updateForwardTrade(ft.id, {
      status: 'closed',
      exit_price: exit,
      pnl,
      pips,
      exit_time: new Date().toISOString(),
    });
  };

  if (loading) return <LoadingSpinner label="Loading forward tests..." />;

  return (
    <div>
      <SectionHeader
        title="Forward Testing"
        subtitle="Track paper-trading and forward-test trades before risking real capital"
        action={
          <button onClick={() => setShowForm(true)} className="btn-primary">
            <Plus size={18} /> New Forward Trade
          </button>
        }
      />

      <div className="mb-5"><ExecutionSummaryCards trades={filtered.filter(trade=>trade.status!=='cancelled').map(trade=>simulatedExecutionTrade({
        id:trade.id,pair:trade.instrument,direction:trade.direction,entry_time:trade.entry_time,exit_time:trade.exit_time,
        status:trade.status==='closed'?'closed':'open',pnl:trade.pnl ?? 0,entry_price:trade.entry_price,exit_price:trade.exit_price,
      }))} /></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Open Trades" value={String(openCount)} icon={<Activity size={20} />} accent="blue" />
        <StatCard label="Closed Trades" value={String(closedTrades.length)} icon={<CheckCircle2 size={20} />} accent="emerald" />
        <StatCard label="Total P&L" value={formatCurrency(totalPnl)} icon={<TrendingUp size={20} />} accent="amber" />
        <StatCard label="Win Rate" value={`${winRate.toFixed(1)}%`} icon={<TrendingDown size={20} />} accent="rose" />
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {(['', 'open', 'closed', 'cancelled'] as const).map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all capitalize ${filterStatus === s ? 'bg-brand-500/10 text-brand-600 dark:text-brand-400 border-brand-500/20' : 'bg-secondary border-themed text-secondary hover:border-muted'}`}
          >
            {s === '' ? 'All' : s}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card p-8">
          <EmptyState icon={<ArrowRightCircle size={40} />} title="No forward trades yet" message="Paper-trade your strategies in real-time to validate them before committing real capital." />
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(ft => (
            <ForwardTradeRow key={ft.id} ft={ft} onClose={() => handleClose(ft)} onDelete={() => handleDelete(ft.id)} />
          ))}
        </div>
      )}

      <Modal open={showForm} onClose={() => setShowForm(false)} title="New Forward Trade" size="lg">
        <ForwardTradeForm onSave={async (data) => { await addForwardTrade(data); setShowForm(false); }} onCancel={() => setShowForm(false)} />
      </Modal>
    </div>
  );
}

function ForwardTradeRow({ ft, onClose, onDelete }: { ft: ForwardTrade; onClose: () => void; onDelete: () => void }) {
  const pnl = parseFloat(String(ft.pnl || '0'));
  const isWin = pnl > 0;
  const isLoss = pnl < 0;
  const pnlIcon = isWin ? <TrendingUp size={14} className="text-success-500" /> : isLoss ? <TrendingDown size={14} className="text-error-500" /> : <Minus size={14} className="text-muted" />;

  const statusConfig: Record<ForwardTradeStatus, { label: string; color: string; icon: typeof Clock }> = {
    open: { label: 'Open', color: 'badge-brand', icon: Clock },
    closed: { label: 'Closed', color: 'badge-success', icon: CheckCircle2 },
    cancelled: { label: 'Cancelled', color: 'badge-neutral', icon: XCircle },
  };
  const sc = statusConfig[ft.status];

  return (
    <div className="card p-4 card-hover">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`p-2 rounded-lg ${ft.direction === 'long' ? 'bg-success-500/10 text-success-500' : 'bg-error-500/10 text-error-500'}`}>
            {ft.direction === 'long' ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm">{ft.instrument}</span>
              <span className="badge badge-neutral capitalize">{ft.direction}</span>
              <span className={`badge ${sc.color}`}>{sc.label}</span>
            </div>
            <p className="text-xs text-muted mt-0.5">
              Entry: {ft.entry_price} · SL: {ft.stop_loss} · TP: {ft.take_profit} · Size: {ft.position_size}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {ft.status === 'closed' && (
            <div className="text-right">
              <div className="flex items-center gap-1 justify-end">
                {pnlIcon}
                <span className={`font-bold font-mono text-sm ${isWin ? 'text-success-500' : isLoss ? 'text-error-500' : 'text-muted'}`}>
                  {formatCurrency(pnl)}
                </span>
              </div>
              {ft.exit_price != null && <p className="text-xs text-muted">Exit: {ft.exit_price}</p>}
            </div>
          )}
          <div className="flex gap-1">
            {ft.status === 'open' && (
              <button onClick={onClose} className="btn-ghost p-1.5 text-xs text-success-500 hover:bg-success-500/10" title="Close trade">
                <CheckCircle2 size={16} />
              </button>
            )}
            <button onClick={onDelete} className="btn-ghost p-1.5 text-error-500 hover:bg-error-500/10"><Trash2 size={16} /></button>
          </div>
        </div>
      </div>

      {ft.notes && <p className="mt-2 text-xs text-secondary">{ft.notes}</p>}
      {ft.screenshot_url && (
        <div className="mt-2 rounded-lg overflow-hidden border border-themed">
          <MediaImage source={ft.screenshot_url} alt="Trade screenshot" className="w-full max-h-48 object-cover" />
        </div>
      )}
      {ft.voice_note_url && <div className="mt-2"><MediaAudioPlayer source={ft.voice_note_url} /></div>}
      {ft.emotional_state && <span className="badge badge-neutral mt-2 capitalize">{ft.emotional_state}</span>}
    </div>
  );
}

function ForwardTradeForm({ onSave, onCancel }: { onSave: (data: ForwardTradeInput) => void; onCancel: () => void }) {
  const { user } = useAuth();
  const { strategies } = useStrategies(user?.id);
  const { plans } = useTradingPlans(user?.id);
  const { setups } = useSetups(user?.id);
  const { instruments } = useMarketInstruments(user?.id);
  const { accounts } = useTradingAccounts(user?.id);
  const [instrument, setInstrument] = useState('');
  const [direction, setDirection] = useState<'long' | 'short'>('long');
  const [entryPrice, setEntryPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [positionSize, setPositionSize] = useState('1');
  const [notes, setNotes] = useState('');
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null);
  const [instrumentId, setInstrumentId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [conversionRate, setConversionRate] = useState('1');
  const [confirmedExample, setConfirmedExample] = useState(false);
  const selectedInstrument = instruments.find(i => i.id === instrumentId) || null;
  const isExample = examplePriceIsUnconfirmed(Number(entryPrice) || null, selectedInstrument);
  const [emotionalState, setEmotionalState] = useState<EmotionalState | ''>('');
  const [strategyId, setStrategyId] = useState<string | null>(null);
  const [entryModelId, setEntryModelId] = useState('');
  const [planId, setPlanId] = useState('');
  const [setupId, setSetupId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { models: entryModels } = useStrategyEntryModels(strategyId);

  const handleSave = async () => {
    setSaving(true);
    await onSave({
      instrument,
      account_id: accountId || null,
      instrument_id: instrumentId || null,
      conversion_rate: Number(conversionRate) || 1,
      example_values_confirmed: isExample ? confirmedExample : true,
      voice_note_url: voiceUrl || null,
      direction,
      entry_price: parseFloat(entryPrice) || 0,
      stop_loss: parseFloat(stopLoss) || 0,
      take_profit: parseFloat(takeProfit) || 0,
      position_size: parseFloat(positionSize) || 1,
      status: 'open',
      exit_price: null,
      pnl: null,
      pips: null,
      notes: notes || null,
      journal_entry: null,
      emotional_state: emotionalState || null,
      entry_time: new Date().toISOString(),
      exit_time: null,
      screenshot_url: screenshotUrl || null,
      strategy_id: strategyId,
      entry_model_id: entryModelId || null,
      plan_id: planId || null,
      setup_id: setupId,
    });
    setSaving(false);
  };

  const inputCls = 'input-field';
  const labelCls = 'block text-xs font-semibold text-secondary mb-1.5';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <EntitySelect label="Strategy" options={strategies} value={strategyId} onChange={value => { setStrategyId(value); setEntryModelId(''); }} placeholder="Select strategy" />
        <EntitySelect label="Setup" options={setups} value={setupId} onChange={setSetupId} placeholder="Select setup" />
      </div>
      <div className="grid grid-cols-2 gap-4"><div><label className={labelCls}>Entry model</label><select className={inputCls} value={entryModelId} onChange={e => setEntryModelId(e.target.value)}><option value="">General / unspecified</option>{entryModels.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></div><div><label className={labelCls}>Trading plan</label><select className={inputCls} value={planId} onChange={e => setPlanId(e.target.value)}><option value="">No plan linked</option>{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.title}</option>)}</select></div></div>

      <div className="grid grid-cols-2 gap-4">
        <div><label className={labelCls}>Catalog instrument</label><select className={inputCls} value={instrumentId} onChange={e => { const id = e.target.value; setInstrumentId(id); setConfirmedExample(false); const item = instruments.find(i => i.id === id); if (item) { setInstrument(item.symbol); setEntryPrice(String(item.example_price ?? '')); setPositionSize(String(item.example_size)); } }}><option value="">Custom instrument</option>{instruments.map(i => <option key={i.id} value={i.id}>{i.symbol} — {i.display_name}</option>)}</select></div>
        <div><label className={labelCls}>Account</label><select className={inputCls} value={accountId} onChange={e => { const account = accounts.find(a => a.id === e.target.value); setAccountId(e.target.value); if (account?.default_strategy_id) setStrategyId(account.default_strategy_id); setPlanId(account?.default_plan_id || ''); if (account) setConversionRate('1'); }}><option value="">No account linked</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.base_currency})</option>)}</select></div>
      </div>
      {selectedInstrument && <div className="rounded-lg bg-secondary/50 p-3 text-xs"><span className="font-semibold">Static example only</span> — {selectedInstrument.symbol}: {selectedInstrument.example_price} entry, {selectedInstrument.example_size} {selectedInstrument.quantity_unit}. <button className="text-brand-500 underline" onClick={() => { setEntryPrice(String(selectedInstrument.example_price ?? '')); setPositionSize(String(selectedInstrument.example_size)); setConfirmedExample(false); }}>Use example</button></div>}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Instrument</label>
          <input className={inputCls} value={instrument} onChange={e => setInstrument(e.target.value)} placeholder="EUR/USD" />
        </div>
        <div>
          <label className={labelCls}>Direction</label>
          <select className={inputCls} value={direction} onChange={e => setDirection(e.target.value as 'long' | 'short')}>
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className={labelCls}>Entry Price</label>
          <input type="number" className={inputCls} value={entryPrice} onChange={e => setEntryPrice(e.target.value)} placeholder="1.0850" />
        </div>
        <div>
          <label className={labelCls}>Stop Loss</label>
          <input type="number" className={inputCls} value={stopLoss} onChange={e => setStopLoss(e.target.value)} placeholder="1.0820" />
        </div>
        <div>
          <label className={labelCls}>Take Profit</label>
          <input type="number" className={inputCls} value={takeProfit} onChange={e => setTakeProfit(e.target.value)} placeholder="1.0910" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div><label className={labelCls}>Conversion to account currency</label><input type="number" min="0" step="any" className={inputCls} value={conversionRate} onChange={e => setConversionRate(e.target.value)} /></div>
        <div><label className={labelCls}>Size presets ({selectedInstrument?.quantity_unit || 'units'})</label><div className="flex flex-wrap gap-1.5">{[0.01, 0.1, 1, 5, 10].map(n => <button key={n} type="button" className="btn-secondary py-1 px-2 text-xs" onClick={() => setPositionSize(String(n))}>{n}</button>)}</div></div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Position Size</label>
          <input type="number" className={inputCls} value={positionSize} onChange={e => setPositionSize(e.target.value)} placeholder="1.0" />
        </div>
        <div>
          <label className={labelCls}>Emotional State</label>
          <select className={inputCls} value={emotionalState} onChange={e => setEmotionalState(e.target.value as EmotionalState | '')}>
            <option value="">None</option>
            {EMOTIONAL_STATES.map(s => <option key={s} value={s} className="capitalize">{s}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className={labelCls}>Notes</label>
        <textarea className={inputCls} rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Why did you take this trade?" />
      </div>

      <div>
        <label className={labelCls}>Chart Screenshot</label>
        <ScreenshotUpload onUpload={setScreenshotUrl} existingUrl={screenshotUrl} label="Upload entry chart screenshot" />
      </div>
      <div><label className={labelCls}>Voice note</label><VoiceRecorder onUpload={setVoiceUrl} existingUrl={voiceUrl} /></div>

      {isExample && <label className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs"><input type="checkbox" checked={confirmedExample} onChange={e => setConfirmedExample(e.target.checked)} /> I understand these are static example prices, not current quotes.</label>}

      <div className="flex gap-3 pt-2">
        <button onClick={handleSave} disabled={saving || !instrument || !entryPrice || (isExample && !confirmedExample)} className="btn-primary flex-1">
          <Save size={16} /> {saving ? 'Saving...' : 'Open Forward Trade'}
        </button>
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
      </div>
    </div>
  );
}
