import { accountLedger, settlement, validateTradeTimes } from '@/lib/tradeFinance';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, CandlestickChart, FlaskConical, Save, Plus, Star } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { ScreenshotUpload } from '@/components/ScreenshotUpload';
import { VoiceRecorder } from '@/components/VoiceRecorder';
import { TradingViewChart } from '@/components/TradingViewChart';
import { InstrumentPicker } from '@/components/InstrumentPicker';
import { useAuth } from '@/context/AuthContext';
import { useChecklist, useInstrumentFavorites, useJournalEntries, useMarketInstruments, useSetups, useStrategies, useStrategyChecklist, useStrategyEntryModels, useTradingPlans, useTestSessions, useTestTrades, useTradingAccounts, useTrades, useTradingAccountAdjustments } from '@/hooks/useData';
import { calculatePositionSize, createTradeCalculationSnapshot, quantityStep, validQuantity, defaultTradeLevels, distancePresets, examplePriceIsUnconfirmed, instrumentDistanceLabel, instrumentPnl, priceAtDistance, SIZE_PRESETS } from '@/lib/instrumentMath';
import type { InstrumentAssetClass, MarketInstrumentInput, TestTradeOutcome } from '@/lib/types';
import { PreTradeChecklist } from '@/components/PreTradeChecklist';
import { setupQualityFromChecklist } from '@/lib/setupQuality';

type CaptureType = 'trade' | 'test' | 'journal';

function localDateTime() {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function localDate() {
  return localDateTime().slice(0, 10);
}

export function QuickCaptureModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const userId = user?.id;
  const { instruments, loading: instrumentsLoading, loadError: instrumentsError, fetchInstruments, saveInstrument } = useMarketInstruments(userId);
  const { favoriteIds, loading: favoritesLoading, toggleFavorite } = useInstrumentFavorites(userId);
  const { accounts } = useTradingAccounts(userId);
  const { strategies } = useStrategies(userId);
  const { plans } = useTradingPlans(userId);
  const { checklist: planChecklist } = useChecklist(userId);
  const { setups } = useSetups(userId);
  const { sessions } = useTestSessions(userId);
  const { addTrade, trades: accountTrades } = useTrades(userId);
  const { adjustments } = useTradingAccountAdjustments(userId);
  const { upsertEntry } = useJournalEntries(userId);
  const [captureType, setCaptureType] = useState<CaptureType>('trade');
  const [symbol, setSymbol] = useState('EUR/USD');
  const [direction, setDirection] = useState<'long' | 'short'>('long');
  const [entry, setEntry] = useState('');
  const [exit, setExit] = useState('');
  const [stop, setStop] = useState('');
  const [target, setTarget] = useState('');
  const [quantity, setQuantity] = useState('');
  const [accountId, setAccountId] = useState('');
  const [conversionRate, setConversionRate] = useState('');
  const [strategyId, setStrategyId] = useState('');
  const [entryModelId, setEntryModelId] = useState('');
  const [checklistSnapshot, setChecklistSnapshot] = useState<import('@/lib/types').TradeChecklistSnapshot[]>([]);
  const [checklistOverrideReason, setChecklistOverrideReason] = useState<string | null>(null);
  const [planId, setPlanId] = useState('');
  const [setupId, setSetupId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [enteredAt, setEnteredAt] = useState(localDateTime());
  const [exitedAt, setExitedAt] = useState('');
  const [tradeCaptureMode, setTradeCaptureMode] = useState<'live' | 'historical'>('live');
  const [notes, setNotes] = useState('');
  const [image, setImage] = useState('');
  const [voice, setVoice] = useState('');
  const [exampleConfirmed, setExampleConfirmed] = useState(false);
  const [actualFillConfirmed, setActualFillConfirmed] = useState(false);
  const [stopManual, setStopManual] = useState(false);
  const [targetManual, setTargetManual] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [journalText, setJournalText] = useState('');
  const [journalType, setJournalType] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [customOpen, setCustomOpen] = useState(false);
  const [customClass, setCustomClass] = useState<InstrumentAssetClass>('custom');
  const [customQuote, setCustomQuote] = useState('USD');
  const [customTick, setCustomTick] = useState('0.01');
  const [customPip, setCustomPip] = useState('0.0001');
  const [customPrecision, setCustomPrecision] = useState('2');
  const [customMultiplier, setCustomMultiplier] = useState('1');
  const [customUnit, setCustomUnit] = useState('units');
  const [customExample, setCustomExample] = useState('');
  const [customSize, setCustomSize] = useState('1');
  const initialized = useRef(false);
  const appliedSymbol = useRef('');
  const calculatedAt = useRef(new Date().toISOString());
  const draftId = useRef('');
  const instrumentPreferenceApplied = useRef(false);
  const { models: entryModels } = useStrategyEntryModels(strategyId || null);
  const { items: strategyChecklistItems } = useStrategyChecklist(strategyId || null, entryModelId || null);
  const applicableChecklistItems = [
    ...planChecklist.filter(item => item.plan_id === planId && item.is_active).map(item => ({ ...item, source_scope: 'plan' as const })),
    ...strategyChecklistItems.map(item => ({ ...item, source_scope: entryModelId ? 'entry_model' as const : 'strategy' as const })),
  ];
  const { addTrade: addTestTrade } = useTestTrades(sessionId || null);

  const selectedInstrument = useMemo(() => instruments.find(i => i.symbol.toUpperCase() === symbol.trim().toUpperCase()) || null, [instruments, symbol]);
  const strategiesForPlan = strategies.filter(s => s.plan_id === planId);
  const selectedAccount = accounts.find(a => a.id === accountId) || null;
  const selectedSession = sessions.find(s => s.id === sessionId) || null;
  const needsConversion = !!selectedInstrument && !!selectedAccount && selectedInstrument.quote_currency !== selectedAccount.base_currency;
  const rate = needsConversion ? Number(conversionRate) : 1;
  const entryValue = Number(entry);
  const stopValue = Number(stop);
  const exitValue = Number(exit);
  const quantityValue = Number(quantity);
  const isExample = examplePriceIsUnconfirmed(entryValue || null, selectedInstrument);
  const effectiveBalance = selectedAccount ? accountLedger(selectedAccount, accountTrades, adjustments).balance : 0;
  const suggestedSize = selectedInstrument && selectedAccount && entryValue > 0 && stopValue > 0 && rate > 0
    ? calculatePositionSize(selectedInstrument, effectiveBalance, selectedAccount.risk_per_trade_pct, entryValue, stopValue, rate)
    : null;
  const pnl = selectedInstrument && entryValue > 0 && exitValue > 0 && quantityValue > 0
    ? instrumentPnl(selectedInstrument, direction, entryValue, exitValue, quantityValue, rate || 1)
    : 0;
  const sizePresets = selectedInstrument ? SIZE_PRESETS[selectedInstrument.asset_class] || SIZE_PRESETS.custom : SIZE_PRESETS.fx;

  const selectInstrument = (instrument: (typeof instruments)[number] | null, nextSymbol: string) => {
    setSymbol(nextSymbol);
    if (instrument) {
      try { localStorage.setItem(`trade-journal:last-instrument:${userId || 'guest'}`, instrument.id); } catch { /* storage may be unavailable */ }
    }
    if (!instrument) { setEntry(''); setStop(''); setTarget(''); setQuantity(''); setStopManual(false); setTargetManual(false); return; }
    setEntry(instrument.example_price?.toString() || '');
    setQuantity(instrument.example_size.toString());
    if (instrument.example_price != null) {
      const levels = defaultTradeLevels(instrument, instrument.example_price, direction);
      setStop(String(levels.stop)); setTarget(String(levels.target));
    }
    setStopManual(false); setTargetManual(false);
  };

  useEffect(() => {
    if (!open) { initialized.current=false; appliedSymbol.current=''; return; }
    if (initialized.current) return;
    initialized.current=true;
    draftId.current = crypto.randomUUID();
    instrumentPreferenceApplied.current = false;
    setCaptureType('trade'); setSymbol('');
    setDirection('long'); setExit(''); setStop(''); setTarget(''); setStrategyId(''); setSetupId('');
    setChecklistSnapshot([]); setChecklistOverrideReason(null);
    setSessionId(''); setNotes(''); setImage(''); setVoice(''); setError(''); setExampleConfirmed(false); setActualFillConfirmed(false);
    setTradeCaptureMode('live'); setExitedAt(''); setStopManual(false); setTargetManual(false);
    const defaultAccount = accounts.find(a => a.is_active) || accounts[0];
    setAccountId(defaultAccount?.id || '');
    setStrategyId('');
    setEntryModelId('');
    setPlanId(defaultAccount?.default_plan_id || '');
    if (defaultAccount?.default_strategy_id && strategies.some(s => s.id === defaultAccount.default_strategy_id && s.plan_id === defaultAccount.default_plan_id)) setStrategyId(defaultAccount.default_strategy_id);
    setEnteredAt(localDateTime()); setJournalText(''); setCustomOpen(false);
  }, [open, accounts, strategies]);

  useEffect(() => {
    if (!open || instrumentPreferenceApplied.current || !instruments.length || favoritesLoading) return;
    let recentId = '';
    try { recentId = localStorage.getItem(`trade-journal:last-instrument:${userId || 'guest'}`) || ''; } catch { /* storage may be unavailable */ }
    const preferred = instruments.find(i => i.id === recentId)
      || instruments.find(i => favoriteIds.includes(i.id))
      || instruments.find(i => i.symbol.toUpperCase() === 'EUR/USD')
      || instruments[0];
    setSymbol(preferred.symbol);
    instrumentPreferenceApplied.current = true;
  }, [open, instruments, favoriteIds, favoritesLoading, userId]);

  useEffect(() => {
    if (!selectedInstrument || appliedSymbol.current===selectedInstrument.id) return;
    appliedSymbol.current=selectedInstrument.id;
    setEntry(selectedInstrument.example_price?.toString() || '');
    setQuantity(selectedInstrument.example_size?.toString() || '');
    const initialPrice = selectedInstrument.example_price;
    if (initialPrice != null) {
      const levels = defaultTradeLevels(selectedInstrument, initialPrice, direction);
      setStop(String(levels.stop)); setTarget(String(levels.target));
      setStopManual(false); setTargetManual(false);
    }
    setConversionRate(selectedInstrument.quote_currency === selectedAccount?.base_currency ? '1' : '');
    setExampleConfirmed(false); setActualFillConfirmed(false);
  }, [selectedInstrument, direction, selectedAccount?.base_currency]);

  useEffect(() => {
    if (selectedSession) {
      setStrategyId(selectedSession.strategy_id || '');
      setEntryModelId(selectedSession.entry_model_id || '');
      setPlanId(selectedSession.plan_id || '');
      setChecklistSnapshot([]); setChecklistOverrideReason(null);
      if (selectedSession.instrument) setSymbol(selectedSession.instrument);
    }
  }, [selectedSession]);

  const handleSave = async () => {
    setError('');
    if (captureType === 'journal') {
      if (!journalText.trim()) { setError('Add a note before saving.'); return; }
      setSaving(true);
      try {
        await upsertEntry({
          entry_date: localDate(), entry_type: journalType, daily_goals: null, weekly_focus: null,
          pre_market_notes: null, post_session_review: null, trading_plan_checklist: [], review_prompts: [],
          mood: null, notes: journalText.trim(), screenshot_url: image || null, voice_note_url: voice || null,
          strategy_id: strategyId || null, entry_model_id: entryModelId || null, plan_id: planId || null, linked_trade_ids: [],
          setup_id: setupId || null, instrument_id: selectedInstrument && !selectedInstrument.id.startsWith('seed:') && !selectedInstrument.id.startsWith('custom-local:') ? selectedInstrument.id : null, account_id: accountId || null,
        });
        onClose();
      } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Could not save journal entry.'); }
      finally { setSaving(false); }
      return;
    }

    if (!symbol.trim() || !entryValue || !quantityValue) { setError('Enter an instrument, entry price, and size.'); return; }
    if (!selectedInstrument || !validQuantity(selectedInstrument, quantityValue) || !Number.isFinite(entryValue) || entryValue <= 0 || (exit && (!Number.isFinite(exitValue) || exitValue <= 0))) {
      setError(selectedInstrument ? `Enter positive prices and a supported quantity in increments of ${quantityStep(selectedInstrument)}.` : 'Select an instrument before saving.');
      return;
    }
    const closedAt = captureType === 'test' ? exitedAt || localDateTime() : exitedAt;
    const timeError = validateTradeTimes(enteredAt, closedAt, !!exit);
    if (timeError) { setError(timeError); return; }
    if (captureType === 'trade' && tradeCaptureMode === 'live' && !actualFillConfirmed) { setError('Confirm that this is the actual broker fill before saving it to your live account.'); return; }
    if ((captureType === 'test' || tradeCaptureMode === 'historical') && isExample && !exampleConfirmed) { setError('Confirm that you checked this example price against the actual trade data.'); return; }
    if (needsConversion && !(rate > 0)) { setError(`Enter a conversion rate from ${selectedInstrument?.quote_currency} to ${selectedAccount?.base_currency}.`); return; }
    if (captureType === 'test' && (!sessionId || !exitValue)) { setError('Choose a test session and enter an exit price to save a completed test trade.'); return; }
    const missedRequiredChecks = applicableChecklistItems.filter(item => item.is_required && !checklistSnapshot.some(snapshot => (snapshot.id === item.id || snapshot.label === item.label) && snapshot.checked));
    if (missedRequiredChecks.length > 0 && !checklistOverrideReason?.trim()) { setError('Complete required plan and entry checks, or record an override reason in the checklist.'); return; }
    setSaving(true);
    try {
      const matchedSession = sessions.find(s => s.id === sessionId);
      if (captureType === 'trade') {
        const calculatedPnl = exitValue && selectedInstrument ? instrumentPnl(selectedInstrument, direction, entryValue, exitValue, quantityValue, rate || 1) : 0;
        const calculatedPips = exitValue && selectedInstrument ? (direction === 'long' ? exitValue - entryValue : entryValue - exitValue) / (selectedInstrument.asset_class === 'fx' && selectedInstrument.pip_size ? selectedInstrument.pip_size : selectedInstrument.price_increment) : 0;
        const riskAmount = stopValue && selectedInstrument ? Math.abs(instrumentPnl(selectedInstrument, direction, entryValue, stopValue, quantityValue, rate || 1)) : 0;
        const currency = selectedAccount?.base_currency || selectedInstrument.quote_currency;
        const posted = settlement(calculatedPnl, currency);
        await addTrade({
          ...posted,
          client_request_id: draftId.current, trade_source: 'manual', settlement_currency: currency,
          calculation_snapshot: createTradeCalculationSnapshot(selectedInstrument, currency, rate, calculatedAt.current),
          risk_capital_at_entry: selectedAccount ? effectiveBalance : null,
          planned_r: riskAmount && target ? instrumentPnl(selectedInstrument, direction, entryValue, Number(target), quantityValue, rate) / riskAmount : null,
          pair: symbol.trim().toUpperCase(), direction, entry_price: entryValue, exit_price: exitValue || null,
          stop_loss: stopValue || null, take_profit: Number(target) || null, lot_size: quantityValue,
          outcome: exitValue ? posted.outcome : null,
          status: exitValue ? 'closed' : 'open', pips: calculatedPips,
          strategy: strategies.find(s => s.id === strategyId)?.name || null, strategy_id: strategyId || null, entry_model_id: entryModelId || null,
          setup_id: setupId || null, account_id: accountId || null, instrument_id: selectedInstrument && !selectedInstrument.id.startsWith('seed:') && !selectedInstrument.id.startsWith('custom-local:') ? selectedInstrument.id : null, plan_id: planId || null,
          conversion_rate: needsConversion ? rate : 1, example_values_confirmed: true,
          capture_mode: tradeCaptureMode, entry_price_confirmed_actual: tradeCaptureMode === 'live' ? actualFillConfirmed : false,
          session: null, broker: null, account_type: null,
          entry_time: new Date(enteredAt).toISOString(), exit_time: exitValue ? new Date(closedAt).toISOString() : null,
          risk_percent: selectedAccount && riskAmount && effectiveBalance > 0 ? riskAmount / effectiveBalance * 100 : null,
          risk_reward_ratio: exitValue && riskAmount ? posted.pnl / riskAmount : null,
          emotional_state: null, setup_quality: setupQualityFromChecklist(checklistSnapshot), mistakes: [], lessons: '', notes: notes || '',
          screenshot_url: image || null, voice_note_url: voice || null, entry_screenshot_url: image || null,
          entry_voice_note_url: voice || null, closure_screenshot_url: null, closure_voice_note_url: null,
          what_went_wrong: null, observations: null, checklist_items: checklistSnapshot.length ? checklistSnapshot : null, checklist_override_reason: checklistOverrideReason, checklist_completed: applicableChecklistItems.length > 0 && applicableChecklistItems.filter(item => item.is_required).every(item => checklistSnapshot.some(snapshot => (snapshot.id === item.id || snapshot.label === item.label) && snapshot.checked)),
        });
      } else {
        if (!matchedSession) throw new Error('Select a valid test session.');
        const calculatedPnl = selectedInstrument ? instrumentPnl(selectedInstrument, direction, entryValue, exitValue, quantityValue, rate || 1) : (direction === 'long' ? exitValue - entryValue : entryValue - exitValue) * quantityValue;
        const riskAmount = stopValue && selectedInstrument ? Math.abs(instrumentPnl(selectedInstrument, direction, entryValue, stopValue, quantityValue, rate || 1)) : 0;
        const rMultiple = riskAmount ? calculatedPnl / riskAmount : null;
        const outcome: TestTradeOutcome = calculatedPnl > 0 ? 'win' : calculatedPnl < 0 ? 'loss' : 'breakeven';
        await addTestTrade({
          session_id: sessionId, direction, entry_price: entryValue, exit_price: exitValue,
          stop_loss: stopValue || null, take_profit: Number(target) || null, position_size: quantityValue,
          pnl: calculatedPnl, r_multiple: rMultiple, outcome,
          entry_time: new Date(enteredAt).toISOString(), exit_time: new Date(closedAt).toISOString(), notes: notes || null,
          screenshot_url: image || null, account_id: accountId || null, instrument_id: selectedInstrument && !selectedInstrument.id.startsWith('seed:') && !selectedInstrument.id.startsWith('custom-local:') ? selectedInstrument.id : null,
          conversion_rate: needsConversion ? rate : 1, voice_note_url: voice || null, entry_model_id: entryModelId || null, plan_id: planId || null,
          checklist_items: checklistSnapshot.length ? checklistSnapshot : null,
        });
      }
      onClose();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Could not save entry.'); }
    finally { setSaving(false); }
  };

  const createInstrument = async () => {
    if (!symbol.trim() || !customQuote || Number(customTick) <= 0 || Number(customMultiplier) <= 0) { setError('Complete the custom instrument fields.'); return; }
    try {
      const normalized = symbol.trim().toUpperCase();
      const input: MarketInstrumentInput = {
        symbol: normalized, display_name: normalized, asset_class: customClass, chart_symbol: null,
        base_currency: null, quote_currency: customQuote.toUpperCase(), price_increment: Number(customTick),
        price_precision: Number(customPrecision), contract_multiplier: Number(customMultiplier), quantity_unit: customUnit,
        pip_size: customClass === 'fx' ? Number(customPip) : null,
        example_price: Number(customExample) || null, example_size: Number(customSize) || 1,
        tick_value: Number(customTick) * Number(customMultiplier), default_stop_ticks: 20, default_target_r: 2,
      };
      await saveInstrument(input);
      setCustomOpen(false);
      setError('');
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Could not add this instrument.'); }
  };

  const inputClass = 'input-field';
  const labelClass = 'block text-xs font-semibold text-secondary mb-1.5';
  const showTradeFields = captureType !== 'journal';

  return (
    <Modal open={open} onClose={onClose} title="Quick Capture" size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {([['trade', CandlestickChart, 'Live trade'], ['test', FlaskConical, 'Test trade'], ['journal', BookOpen, 'Journal note']] as const).map(([type, Icon, label]) => (
            <button key={type} type="button" onClick={() => { setCaptureType(type); setError(''); }} className={`btn-secondary justify-center ${captureType === type ? 'border-orange-500 text-orange-600' : ''}`}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>

        {showTradeFields ? (
          <>
            {captureType === 'trade' && <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-xl border border-themed bg-secondary/40 p-3"><div><p className="text-xs font-semibold">Trade record type</p><p className="text-[11px] text-muted">Live records require a confirmed broker fill. Past records can use historical timestamps.</p></div><select className={`${inputClass} sm:max-w-48`} value={tradeCaptureMode} onChange={e => { const mode = e.target.value as 'live'|'historical'; setTradeCaptureMode(mode); setActualFillConfirmed(false); if (mode === 'live') setEnteredAt(localDateTime()); }}><option value="live">Live trade</option><option value="historical">Historical trade</option></select></div>}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className={labelClass}>Instrument</label>
                <InstrumentPicker value={symbol} instruments={instruments} favoriteIds={favoriteIds} loading={instrumentsLoading} error={instrumentsError} onRetry={fetchInstruments} onSelect={selectInstrument} placeholder="Choose a preloaded instrument or type a custom symbol" />
                {selectedInstrument && <p className="mt-1 text-[11px] text-muted">{selectedInstrument.display_name} · prices are examples · size in {selectedInstrument.quantity_unit}</p>}
                {selectedInstrument && <button type="button" className="mt-1 text-[11px] text-amber-600" onClick={() => toggleFavorite(selectedInstrument.id)}><Star size={12} className="inline mr-1" />{favoriteIds.includes(selectedInstrument.id) ? 'Remove favorite' : 'Add to favorites'}</button>}
                {!selectedInstrument && symbol && <button type="button" className="text-xs text-orange-600 mt-1" onClick={() => setCustomOpen(v => !v)}><Plus size={12} className="inline" /> Add this as a custom instrument</button>}
                {selectedInstrument?.chart_symbol && <details className="mt-2"><summary className="cursor-pointer text-[11px] text-orange-600">View chart</summary><div className="mt-2 sm:w-[640px] max-w-[calc(100vw-3rem)]"><TradingViewChart symbol={selectedInstrument.chart_symbol} height={320} /></div></details>}
              </div>
              <div><label className={labelClass}>Direction</label><select className={inputClass} value={direction} onChange={e => { const next = e.target.value as 'long'|'short'; setDirection(next); if (selectedInstrument && entryValue > 0) { const levels = defaultTradeLevels(selectedInstrument, entryValue, next); if (!stopManual) setStop(String(levels.stop)); if (!targetManual) setTarget(String(levels.target)); } }}><option value="long">Long / Buy</option><option value="short">Short / Sell</option></select></div>
            </div>

            {customOpen && (
              <div className="card p-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div><label className={labelClass}>Asset class</label><select className={inputClass} value={customClass} onChange={e => setCustomClass(e.target.value as InstrumentAssetClass)}>{['custom','fx','metal','index','crypto','stock','future','energy','agriculture'].map(x => <option key={x} value={x}>{x}</option>)}</select></div>
                <div><label className={labelClass}>Quote currency</label><input className={inputClass} value={customQuote} onChange={e => setCustomQuote(e.target.value)} /></div>
                <div><label className={labelClass}>Price increment</label><input type="number" min="0.00000001" className={inputClass} value={customTick} onChange={e => setCustomTick(e.target.value)} /></div>
                {customClass === 'fx' && <div><label className={labelClass}>Pip size</label><input type="number" min="0.00000001" className={inputClass} value={customPip} onChange={e => setCustomPip(e.target.value)} /></div>}
                <div><label className={labelClass}>Precision</label><input type="number" min="0" max="10" className={inputClass} value={customPrecision} onChange={e => setCustomPrecision(e.target.value)} /></div>
                <div><label className={labelClass}>Contract multiplier</label><input type="number" min="0.00000001" className={inputClass} value={customMultiplier} onChange={e => setCustomMultiplier(e.target.value)} /></div>
                <div><label className={labelClass}>Size unit</label><input className={inputClass} value={customUnit} onChange={e => setCustomUnit(e.target.value)} placeholder="lots, shares, contracts" /></div>
                <div><label className={labelClass}>Example price</label><input type="number" className={inputClass} value={customExample} onChange={e => setCustomExample(e.target.value)} /></div>
                <div><label className={labelClass}>Example size</label><input type="number" className={inputClass} value={customSize} onChange={e => setCustomSize(e.target.value)} /></div>
                <button type="button" onClick={createInstrument} className="btn-primary col-span-2 sm:col-span-4">Save custom instrument</button>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div><label className={labelClass}>Entry price</label><input type="number" step={selectedInstrument?.price_increment || 'any'} className={inputClass} value={entry} onChange={e => { const value = e.target.value; setEntry(value); setExampleConfirmed(false); setActualFillConfirmed(false); if (selectedInstrument && Number(value) > 0) { const levels = defaultTradeLevels(selectedInstrument, Number(value), direction); if (!stopManual) setStop(String(levels.stop)); if (!targetManual) setTarget(String(levels.target)); } }} />{selectedInstrument && <p className="mt-1 text-[10px] text-muted">Example · {selectedInstrument.price_precision} decimals · {selectedInstrument.price_increment} tick</p>}</div>
              <div><label className={labelClass}>Stop loss · {selectedInstrument?.default_stop_ticks ?? 20} {selectedInstrument ? instrumentDistanceLabel(selectedInstrument) : 'ticks'}</label><input type="number" step={selectedInstrument?.price_increment || 'any'} className={inputClass} value={stop} onChange={e => { setStopManual(true); setStop(e.target.value); }} />{selectedInstrument && entryValue > 0 && <div className="mt-1.5"><p className="mb-1 text-[10px] text-muted">Quick distances · {instrumentDistanceLabel(selectedInstrument)}</p><div className="flex flex-wrap gap-1">{distancePresets(selectedInstrument).map(distance => <button key={distance} type="button" aria-label={`Stop loss ${distance} ${instrumentDistanceLabel(selectedInstrument)}`} className="rounded bg-secondary px-1.5 py-1 text-[10px]" onClick={() => { setStop(String(priceAtDistance(selectedInstrument, entryValue, direction, distance, 'stop'))); setStopManual(true); if (!targetManual) setTarget(String(priceAtDistance(selectedInstrument, entryValue, direction, distance * (selectedInstrument.default_target_r ?? 2), 'target'))); }}>{distance}</button>)}</div></div>}</div>
              <div><label className={labelClass}>Take profit · {selectedInstrument?.default_target_r ?? 2}R</label><input type="number" step={selectedInstrument?.price_increment || 'any'} className={inputClass} value={target} onChange={e => { setTargetManual(true); setTarget(e.target.value); }} />{selectedInstrument && entryValue > 0 && <div className="mt-1.5"><p className="mb-1 text-[10px] text-muted">Quick distances · {instrumentDistanceLabel(selectedInstrument)}</p><div className="flex flex-wrap gap-1">{distancePresets(selectedInstrument).map(distance => <button key={distance} type="button" aria-label={`Take profit ${distance} ${instrumentDistanceLabel(selectedInstrument)}`} className="rounded bg-secondary px-1.5 py-1 text-[10px]" onClick={() => { setTarget(String(priceAtDistance(selectedInstrument, entryValue, direction, distance, 'target'))); setTargetManual(true); }}>{distance}</button>)}</div></div>}</div>
              {captureType === 'test' ? <div><label className={labelClass}>Exit price *</label><input type="number" step={selectedInstrument?.price_increment || 'any'} className={inputClass} value={exit} onChange={e => setExit(e.target.value)} /></div> : <div><label className={labelClass}>Exit price (optional)</label><input type="number" step={selectedInstrument?.price_increment || 'any'} className={inputClass} value={exit} onChange={e => { setExit(e.target.value); setExitedAt(e.target.value ? localDateTime() : ''); }} /></div>}
            </div>

            {captureType === 'trade' && tradeCaptureMode === 'live' ? <label className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/10 text-xs text-amber-700 dark:text-amber-300"><input className="mt-0.5" type="checkbox" checked={actualFillConfirmed} onChange={e => setActualFillConfirmed(e.target.checked)} /> I replaced the sample with the actual broker fill.</label> : isExample && <label className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/10 text-xs text-amber-700 dark:text-amber-300"><input className="mt-0.5" type="checkbox" checked={exampleConfirmed} onChange={e => setExampleConfirmed(e.target.checked)} /> I checked this price against the historical/test source data.</label>}
            {captureType === 'trade' && exitValue > 0 && <div><label className={labelClass}>Exit date and time · prompted on close</label><input type="datetime-local" className={inputClass} value={exitedAt} onChange={e => setExitedAt(e.target.value)} /></div>}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div><label className={labelClass}>Account</label><select className={inputClass} value={accountId} onChange={e => { const acc = accounts.find(a => a.id === e.target.value); setAccountId(e.target.value); setConversionRate(selectedInstrument?.quote_currency === acc?.base_currency ? '1' : ''); setPlanId(acc?.default_plan_id || ''); const validDefault = acc?.default_strategy_id && strategies.some(s => s.id === acc.default_strategy_id && s.plan_id === acc.default_plan_id); setStrategyId(validDefault ? acc!.default_strategy_id! : ''); setEntryModelId(''); }}><option value="">No account</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name} · {a.base_currency}</option>)}</select></div>
              <div><label className={labelClass}>Size ({selectedInstrument?.quantity_unit || 'units'})</label><input type="number" step="0.001" className={inputClass} value={quantity} onChange={e => setQuantity(e.target.value)} />
                <div className="flex flex-wrap gap-1 mt-1.5">{sizePresets.map(p => <button type="button" key={p} className="px-2 py-1 rounded bg-secondary text-[10px]" onClick={() => setQuantity(String(p))}>{p}</button>)}{suggestedSize != null && <button type="button" className="px-2 py-1 rounded bg-orange-500/10 text-orange-600 text-[10px]" onClick={() => setQuantity(String(suggestedSize))}>Risk size {suggestedSize}</button>}</div>
              </div>
              <div><label className={labelClass}>Conversion rate {needsConversion ? `(${selectedInstrument?.quote_currency} → ${selectedAccount?.base_currency})` : ''}</label><input type="number" min="0" step="0.000001" className={inputClass} value={conversionRate} onChange={e => setConversionRate(e.target.value)} placeholder={needsConversion ? 'Enter manual conversion' : '1'} disabled={!needsConversion} /></div>
            </div>
            {suggestedSize != null && <p className="text-xs text-secondary">Estimated size from {selectedAccount?.risk_per_trade_pct}% account risk: <strong>{suggestedSize} {selectedInstrument?.quantity_unit}</strong></p>}

            {captureType !== 'test' && plans.length > 0 && <div><label className={labelClass}>Trading plan (optional)</label><select className={inputClass} value={planId} onChange={e => { const nextPlan = e.target.value; setPlanId(nextPlan); if (strategies.find(s => s.id === strategyId)?.plan_id !== nextPlan) { setStrategyId(''); setEntryModelId(''); } }}><option value="">No plan linked</option>{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.title}</option>)}</select></div>}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {captureType === 'trade' ? (
                <div><label className={labelClass}>Strategy</label><select className={inputClass} value={strategyId} onChange={e => { setStrategyId(e.target.value); setEntryModelId(''); setChecklistSnapshot([]); setChecklistOverrideReason(null); }}><option value="">Add later (optional)</option>{strategiesForPlan.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              ) : (
                <div><label className={labelClass}>Test session</label><select className={inputClass} value={sessionId} onChange={e => setSessionId(e.target.value)}><option value="">Choose session</option>{sessions.map(s => <option key={s.id} value={s.id}>{s.name} · {s.test_type}</option>)}</select></div>
              )}
              <div><label className={labelClass}>Setup</label><select className={inputClass} value={setupId} onChange={e => setSetupId(e.target.value)}><option value="">Add later (optional)</option>{setups.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div><label className={labelClass}>Entry time</label><input type="datetime-local" className={inputClass} value={enteredAt} readOnly={captureType === 'trade' && tradeCaptureMode === 'live'} onChange={e => setEnteredAt(e.target.value)} /></div>
            </div>
            {strategyId && entryModels.length > 0 && <div><label className={labelClass}>Entry model (optional)</label><select className={inputClass} value={entryModelId} onChange={e => { setEntryModelId(e.target.value); setChecklistSnapshot([]); setChecklistOverrideReason(null); }}><option value="">General strategy checklist</option>{entryModels.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></div>}
            {applicableChecklistItems.length > 0 && <><PreTradeChecklist items={applicableChecklistItems} snapshot={checklistSnapshot} overrideReason={checklistOverrideReason} onSnapshotChange={setChecklistSnapshot} onOverrideReasonChange={setChecklistOverrideReason} /><p className="text-[11px] text-secondary">Setup quality · checklist score: {setupQualityFromChecklist(checklistSnapshot) ?? '—'}/5</p></>}
            <div><label className={labelClass}>Notes (optional)</label><textarea rows={2} className={inputClass} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add context now or complete the review later" /></div>
            {(exitValue > 0 && selectedInstrument) && <p className="text-xs text-secondary">Estimated P&amp;L: {pnl.toFixed(2)} {selectedAccount?.base_currency || selectedInstrument.quote_currency}</p>}
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><div><label className={labelClass}>Entry type</label><select className={inputClass} value={journalType} onChange={e => setJournalType(e.target.value as 'daily'|'weekly'|'monthly')}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></div><div><label className={labelClass}>Trading plan (optional)</label><select className={inputClass} value={planId} onChange={e => { const nextPlan = e.target.value; setPlanId(nextPlan); if (strategies.find(s => s.id === strategyId)?.plan_id !== nextPlan) { setStrategyId(''); setEntryModelId(''); } }}><option value="">None</option>{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.title}</option>)}</select></div><div><label className={labelClass}>Strategy (optional)</label><select className={inputClass} value={strategyId} onChange={e => { setStrategyId(e.target.value); setEntryModelId(''); }}><option value="">None</option>{strategiesForPlan.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div><label className={labelClass}>Setup (optional)</label><select className={inputClass} value={setupId} onChange={e => setSetupId(e.target.value)}><option value="">None</option>{setups.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div><label className={labelClass}>Instrument (optional)</label><select className={inputClass} value={selectedInstrument?.id || ''} onChange={e => setSymbol(instruments.find(i => i.id === e.target.value)?.symbol || '')}><option value="">None</option>{instruments.map(i => <option key={i.id} value={i.id}>{i.symbol}</option>)}</select></div>
              <div><label className={labelClass}>Account (optional)</label><select className={inputClass} value={accountId} onChange={e => { const acc = accounts.find(a => a.id === e.target.value); setAccountId(e.target.value); setPlanId(acc?.default_plan_id || ''); const validDefault = acc?.default_strategy_id && strategies.some(s => s.id === acc.default_strategy_id && s.plan_id === acc.default_plan_id); setStrategyId(validDefault ? acc!.default_strategy_id! : ''); setEntryModelId(''); }}><option value="">None</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name} · {a.base_currency}</option>)}</select></div>
              <div><label className={labelClass}>Trading plan (optional)</label><select className={inputClass} value={planId} onChange={e => setPlanId(e.target.value)}><option value="">None</option>{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.title}</option>)}</select></div>
            </div>
            <div><label className={labelClass}>Journal note</label><textarea rows={5} className={inputClass} value={journalText} onChange={e => setJournalText(e.target.value)} placeholder="What did you see, feel, learn, or plan?" /></div>
          </>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className={labelClass}>Chart image (optional)</label><ScreenshotUpload onUpload={url => setImage(url)} existingUrl={image || null} /></div>
          <div><label className={labelClass}>Voice note (optional)</label><VoiceRecorder onUpload={url => setVoice(url)} existingUrl={voice || null} /></div>
        </div>

        {error && <p role="alert" className="text-sm text-error-500">{error}</p>}
        <div className="flex gap-3 pt-1"><button type="button" onClick={handleSave} disabled={saving} className="btn-primary flex-1"><Save size={16} />{saving ? 'Saving…' : 'Save capture'}</button><button type="button" onClick={onClose} className="btn-secondary">Cancel</button></div>
      </div>
    </Modal>
  );
}
