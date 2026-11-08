import { accountLedger, settlement, validateTradeTimes } from '@/lib/tradeFinance';
import { useState, useEffect } from 'react';
import { Save, X, Calculator, TrendingUp, TrendingDown, Zap, ChevronRight, ChevronLeft, CheckCircle2, Target, Brain, AlertTriangle, Clock, CheckCircle, ListChecks, Camera, Lock, Star } from 'lucide-react';
import type { Trade, TradeInput, TradeDirection, TradeSession, AccountType, EmotionalState, TradeStatus, TradeChecklistSnapshot, TradeCalculationSnapshot } from '@/lib/types';
import { calcPips, calcPnl, formatPips, getInstrumentType } from '@/lib/utils';
import { BROKER_SUGGESTIONS, LESSON_SUGGESTIONS } from '@/lib/suggestions';
import { useChecklist, useStrategies, useStrategyChecklist, useStrategyEntryModels, useTradingPlans, useSetups, useMarketInstruments, useTradingAccounts, useInstrumentFavorites, useTrades, useTradingAccountAdjustments, useRiskSettings } from '@/hooks/useData';
import { useAuth } from '@/context/AuthContext';
import { VoiceRecorder } from './VoiceRecorder';
import { ScreenshotUpload } from './ScreenshotUpload';
import { SuggestInput } from './ui/SuggestInput';
import { PreTradeChecklist } from './PreTradeChecklist';
import { EntitySelect } from './EntitySelect';
import { InstrumentPicker } from './InstrumentPicker';
import { TradingViewChart } from './TradingViewChart';
import { calculatePositionSize, createTradeCalculationSnapshot, defaultTradeLevels, distancePresets, examplePriceIsUnconfirmed, instrumentDistanceLabel, instrumentPnl, instrumentPnlFromSnapshot, priceAtDistance, quantityStep, validQuantity, SIZE_PRESETS } from '@/lib/instrumentMath';
import { setupQualityFromChecklist } from '@/lib/setupQuality';

interface TradeFormProps {
  initial?: Trade | null;
  onSubmit: (data: TradeInput) => Promise<void>;
  onCancel: () => void;
}

const MISTAKE_OPTIONS = [
  'Overtraded', 'Broke my rules', 'Chased the market', 'Moved my stop loss', 'No clear setup',
  'Revenge trade', 'FOMO entry', 'Ignored higher timeframe', 'Sized too large', 'Exited too early',
  'Held too long', 'Traded against trend', 'No stop loss', 'Traded the news',
];

const STEPS = [
  { id: 0, label: 'Strategy', icon: Target },
  { id: 1, label: 'Context', icon: Brain },
  { id: 2, label: 'Trade', icon: TrendingUp },
  { id: 3, label: 'Attachments', icon: Camera },
  { id: 4, label: 'Closure', icon: CheckCircle },
];

function localDateTimeInputValue(date = new Date()): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function TradeForm({ initial, onSubmit, onCancel }: TradeFormProps) {
  const { user } = useAuth();
  const { strategies } = useStrategies(user?.id);
  const { plans } = useTradingPlans(user?.id);
  const { checklist: planChecklist } = useChecklist(user?.id);
  const { setups } = useSetups(user?.id);
  const { instruments, loading: instrumentsLoading, loadError: instrumentsError, fetchInstruments } = useMarketInstruments(user?.id);
  const { favoriteIds, loading: favoritesLoading, toggleFavorite } = useInstrumentFavorites(user?.id);
  const { accounts } = useTradingAccounts(user?.id);
  const { trades: accountTrades } = useTrades(user?.id);
  const { adjustments } = useTradingAccountAdjustments(user?.id);
  const { settings: userRiskSettings } = useRiskSettings(user?.id);

  const [calculatedAt] = useState(() => new Date().toISOString());
  const [draftId] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState<TradeInput>(() => initial ? { ...initial } : {
    pair: '', direction: 'long', entry_price: null, exit_price: null, take_profit: null,
    lot_size: null, outcome: null, status: 'open', pnl: 0, pips: 0,
    strategy: '', strategy_id: null, entry_model_id: null, setup_id: null, plan_id: null, account_id: null, instrument_id: null,
    stop_loss: null, conversion_rate: null, fees: 0, calculation_snapshot: null, example_values_confirmed: true,
    capture_mode: 'live',
    session: null, broker: '', account_type: null,
    entry_time: localDateTimeInputValue(), exit_time: null,
    risk_percent: null, risk_reward_ratio: null, emotional_state: null,
    setup_quality: null, mistakes: [], lessons: '', notes: '',
    screenshot_url: null, voice_note_url: null,
    entry_screenshot_url: null, entry_voice_note_url: null,
    closure_screenshot_url: null, closure_voice_note_url: null,
    what_went_wrong: null, observations: null,
    checklist_items: null, checklist_override_reason: null, checklist_completed: false,
  });
  const [stopLoss, setStopLoss] = useState<string>(initial?.stop_loss?.toString() || '');
  const [stopManuallyEdited, setStopManuallyEdited] = useState(!!initial);
  const [targetManuallyEdited, setTargetManuallyEdited] = useState(!!initial);
  const [actualFillConfirmed, setActualFillConfirmed] = useState(initial?.entry_price_confirmed_actual ?? false);
  const [exampleConfirmed, setExampleConfirmed] = useState(initial?.example_values_confirmed ?? true);
  const [checklistSnapshot, setChecklistSnapshot] = useState<TradeChecklistSnapshot[]>([]);
  const [checklistOverrideReason, setChecklistOverrideReason] = useState<string | null>(null);
  const [riskOverrideReason, setRiskOverrideReason] = useState(initial?.risk_override_reason || '');
  const [saving, setSaving] = useState(false);
  const [mediaUploads, setMediaUploads] = useState({ screenshot: false, voice: false });
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const mediaUploading = mediaUploads.screenshot || mediaUploads.voice;

  const { models: entryModels } = useStrategyEntryModels(form.strategy_id);
  const { items: strategyChecklistItems } = useStrategyChecklist(form.strategy_id, form.entry_model_id);

  useEffect(() => {
    if (initial) {
      setForm({
        ...initial,
        entry_time: localDateTimeInputValue(new Date(initial.entry_time)),
        exit_time: initial.exit_time ? localDateTimeInputValue(new Date(initial.exit_time)) : null,
        capture_mode: initial.capture_mode === 'live' ? 'live' : 'historical',
      });
      setStopLoss(initial.stop_loss?.toString() || '');
      setStopManuallyEdited(true);
      setTargetManuallyEdited(true);
      setActualFillConfirmed(initial.entry_price_confirmed_actual ?? false);
      setExampleConfirmed(initial.example_values_confirmed ?? true);
      setChecklistSnapshot(initial.checklist_items ?? []);
      setChecklistOverrideReason(initial.checklist_override_reason ?? null);
    }
  }, [initial]);

  useEffect(() => {
    if (initial || !accounts.length) return;
    const defaultAccount = accounts.find(a => a.id === form.account_id) || accounts.find(a => a.is_active) || accounts[0];
    if (!form.account_id) {
      update('account_id', defaultAccount.id);
      if (defaultAccount.broker_name) update('broker', defaultAccount.broker_name);
      if (defaultAccount.account_type === 'personal' || defaultAccount.account_type === 'propfirm') update('account_type', defaultAccount.account_type);
    }
    const resolvedPlanId = form.plan_id || defaultAccount.default_plan_id || null;
    if (!form.plan_id && defaultAccount.default_plan_id && plans.some(p => p.id === defaultAccount.default_plan_id)) update('plan_id', defaultAccount.default_plan_id);
    if (!form.strategy_id && defaultAccount.default_strategy_id && strategies.some(s => s.id === defaultAccount.default_strategy_id && s.plan_id === resolvedPlanId)) {
      update('strategy_id', defaultAccount.default_strategy_id);
      update('strategy', strategies.find(s => s.id === defaultAccount.default_strategy_id)?.name || '');
    }
  }, [initial, accounts, strategies, plans, form.account_id, form.strategy_id, form.plan_id, form.direction]);

  const update = <Field extends keyof TradeInput>(field: Field, value: TradeInput[Field]) => {
    setForm(f => ({ ...f, [field]: value }));
  };

  const updateTradeMedia = (kind: 'screenshot' | 'voice', value: string) => {
    setForm(current => kind === 'screenshot'
      ? { ...current, screenshot_url: value || null, entry_screenshot_url: value || null }
      : { ...current, voice_note_url: value || null, entry_voice_note_url: value || null });
  };

  const selectInstrument = (instrument: (typeof instruments)[number] | null, symbol: string) => {
    update('pair', symbol);
    update('instrument_id', instrument?.id || null);
    if (!instrument) {
      update('entry_price', null); update('lot_size', null); update('stop_loss', null); update('take_profit', null);
      setStopLoss(''); setStopManuallyEdited(false); setTargetManuallyEdited(false); setActualFillConfirmed(false); setExampleConfirmed(false);
      return;
    }
    try { localStorage.setItem(`trade-journal:last-instrument:${user?.id || 'guest'}`, instrument.id); } catch { /* storage may be unavailable */ }
    update('entry_price', instrument.example_price);
    update('lot_size', instrument.example_size);
    setStopManuallyEdited(false); setTargetManuallyEdited(false); setActualFillConfirmed(false); setExampleConfirmed(false);
    if (instrument.example_price != null) {
      const levels = defaultTradeLevels(instrument, instrument.example_price, form.direction);
      setStopLoss(String(levels.stop)); update('stop_loss', levels.stop); update('take_profit', levels.target);
    } else { setStopLoss(''); update('stop_loss', null); update('take_profit', null); }
  };

  const changeEntry = (value: number | null, instrument = selectedInstrument, direction = form.direction) => {
    update('entry_price', value);
    if (form.capture_mode === 'live') setActualFillConfirmed(false);
    if (instrument && value != null) {
      const levels = defaultTradeLevels(instrument, value, direction);
      if (!stopManuallyEdited) { setStopLoss(String(levels.stop)); update('stop_loss', levels.stop); }
      if (!targetManuallyEdited) update('take_profit', levels.target);
    }
  };

  const changeDirection = (direction: TradeDirection) => {
    update('direction', direction);
    if (selectedInstrument && form.entry_price != null) {
      const levels = defaultTradeLevels(selectedInstrument, form.entry_price, direction);
      if (!stopManuallyEdited) { setStopLoss(String(levels.stop)); update('stop_loss', levels.stop); }
      if (!targetManuallyEdited) update('take_profit', levels.target);
    }
  };

  const selectedInstrument = instruments.find(i => i.id === form.instrument_id)
    || instruments.find(i => i.symbol.toUpperCase() === form.pair.toUpperCase()) || null;
  const strategiesForPlan = strategies.filter(s => s.plan_id === form.plan_id || s.id === initial?.strategy_id);
  const applicableChecklistItems = [
    ...planChecklist.filter(item => item.plan_id === form.plan_id && item.is_active).map(item => ({ ...item, source_scope: 'plan' as const })),
    ...strategyChecklistItems.map(item => ({ ...item, source_scope: form.entry_model_id ? 'entry_model' as const : 'strategy' as const })),
  ];
  const selectedAccount = accounts.find(a => a.id === form.account_id) || null;
  const selectedPlan = plans.find(plan => plan.id === form.plan_id) || null;
  const needsConversion = !!selectedInstrument && !!selectedAccount && selectedInstrument.quote_currency !== selectedAccount.base_currency;
  const conversionRate = needsConversion ? Number(form.conversion_rate) : 1;
  const reusableCalculationSnapshot: TradeCalculationSnapshot | null = initial?.calculation_snapshot
    && selectedInstrument?.id === initial.calculation_snapshot.instrument_id
    && selectedInstrument.symbol === form.pair
    && selectedAccount?.base_currency === initial.calculation_snapshot.account_currency
    && conversionRate === initial.calculation_snapshot.conversion_rate
      ? initial.calculation_snapshot
      : null;
  const calculateSelectedInstrumentPnl = (direction: TradeDirection, entry: number, exit: number, quantity: number) =>
    reusableCalculationSnapshot
      ? instrumentPnlFromSnapshot(reusableCalculationSnapshot, direction, entry, exit, quantity)
      : selectedInstrument
        ? instrumentPnl(selectedInstrument, direction, entry, exit, quantity, conversionRate || 1)
        : Number.NaN;
  const formatAccountCurrency = (value: number) => new Intl.NumberFormat(undefined, {
    style: 'currency', currency: selectedAccount?.base_currency || 'USD', maximumFractionDigits: 2,
  }).format(value);
  const configuredRiskLimits = [
    selectedPlan?.max_risk_per_trade_pct,
    selectedAccount?.risk_per_trade_pct,
    userRiskSettings?.max_risk_per_trade_pct,
  ].filter((value): value is number => value != null && Number.isFinite(value) && value > 0);
  const effectiveRiskPercent = configuredRiskLimits.length ? Math.min(...configuredRiskLimits) : null;
  const isExamplePrice = examplePriceIsUnconfirmed(form.entry_price, selectedInstrument);
  const sizePresets = selectedInstrument ? SIZE_PRESETS[selectedInstrument.asset_class] || SIZE_PRESETS.custom : SIZE_PRESETS.fx;
  const currentBalance = selectedAccount ? accountLedger(selectedAccount, accountTrades, adjustments).balance : 0;
  // Legacy edits retain their recorded risk when the entry capital is unknown.
  const entryCapital = initial && form.account_id === initial.account_id ? initial.risk_capital_at_entry ?? null : currentBalance;
  const effectiveBalance = entryCapital ?? 0;
  const suggestedSize = selectedInstrument && selectedAccount && effectiveRiskPercent != null && form.entry_price && stopLoss && Number(stopLoss) && conversionRate > 0
    ? calculatePositionSize(selectedInstrument, effectiveBalance, effectiveRiskPercent, form.entry_price, Number(stopLoss), conversionRate, Math.max(0, Number(form.fees) || 0))
    : null;
  const estimatedRiskAmount = selectedInstrument && selectedAccount && form.entry_price && Number(stopLoss) && form.lot_size
    ? Math.abs(calculateSelectedInstrumentPnl(form.direction, form.entry_price, Number(stopLoss), form.lot_size)) + Math.max(0, Number(form.fees) || 0)
    : null;
  const estimatedRiskPercent = estimatedRiskAmount != null && effectiveBalance > 0 ? estimatedRiskAmount / effectiveBalance * 100 : null;
  const riskLimitExceeded = effectiveRiskPercent != null && estimatedRiskPercent != null && estimatedRiskPercent > effectiveRiskPercent;

  useEffect(() => {
    if (initial || form.pair || !instruments.length || favoritesLoading) return;
    let recentId = '';
    try { recentId = localStorage.getItem(`trade-journal:last-instrument:${user?.id || 'guest'}`) || ''; } catch { /* storage may be unavailable */ }
    const preferred = instruments.find(i => i.id === recentId)
      || instruments.find(i => favoriteIds.includes(i.id))
      || instruments.find(i => i.symbol.toUpperCase() === 'EUR/USD')
      || instruments[0];
    update('pair', preferred.symbol);
    update('instrument_id', preferred.id);
    update('entry_price', preferred.example_price);
    update('lot_size', preferred.example_size);
    setExampleConfirmed(false);
    setActualFillConfirmed(false);
    if (preferred.example_price != null) {
      const levels = defaultTradeLevels(preferred, preferred.example_price, form.direction);
      setStopLoss(String(levels.stop)); update('stop_loss', levels.stop); update('take_profit', levels.target);
    }
  }, [initial, form.pair, form.direction, instruments, favoriteIds, favoritesLoading, user?.id]);

  const toggleMistake = (mistake: string) => {
    setForm(f => ({
      ...f,
      mistakes: f.mistakes.includes(mistake)
        ? f.mistakes.filter(m => m !== mistake)
        : [...f.mistakes, mistake],
    }));
  };

  const liveCalc = (() => {
    const entry = form.entry_price;
    const exit = form.exit_price;
    const tp = form.take_profit;
    const sl = stopLoss ? parseFloat(stopLoss) : null;
    const lot = form.lot_size;
    const pair = form.pair;
    const direction = form.direction;
    const fees = Math.max(0, Number(form.fees) || 0);

    let pips = 0;
    let pnl = 0;
    let rr: number | null = null;
    let outcome: 'win' | 'loss' | 'breakeven' | null = null;
    let potentialPips = 0;
    let potentialPnl = 0;
    let potentialRr: number | null = null;

    if (entry != null && exit != null && pair) {
      pips = selectedInstrument
        ? (direction === 'long' ? exit - entry : entry - exit) / ((reusableCalculationSnapshot?.asset_class || selectedInstrument.asset_class) === 'fx' && (reusableCalculationSnapshot?.pip_size || selectedInstrument.pip_size) ? reusableCalculationSnapshot?.pip_size || selectedInstrument.pip_size! : reusableCalculationSnapshot?.price_increment || selectedInstrument.price_increment)
        : calcPips(pair, direction, entry, exit);
      if (lot) pnl = (selectedInstrument
        ? calculateSelectedInstrumentPnl(direction, entry, exit, lot)
        : calcPnl(pips, lot, pair)) - fees;
      outcome = pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven';
    }

    if (entry != null && tp != null && pair && lot) {
      potentialPips = selectedInstrument
        ? (direction === 'long' ? tp - entry : entry - tp) / ((reusableCalculationSnapshot?.asset_class || selectedInstrument.asset_class) === 'fx' && (reusableCalculationSnapshot?.pip_size || selectedInstrument.pip_size) ? reusableCalculationSnapshot?.pip_size || selectedInstrument.pip_size! : reusableCalculationSnapshot?.price_increment || selectedInstrument.price_increment)
        : calcPips(pair, direction, entry, tp);
      potentialPnl = (selectedInstrument
        ? calculateSelectedInstrumentPnl(direction, entry, tp, lot)
        : calcPnl(potentialPips, lot, pair)) - fees;
      const risk = sl != null ? Math.abs(entry - sl) : null;
      if (risk && risk > 0) {
        const stopRisk = selectedInstrument
          ? Math.abs(calculateSelectedInstrumentPnl(direction, entry, sl!, lot)) + fees
          : Math.abs(calcPnl(Math.abs(calcPips(pair, direction, entry, sl!)), lot, pair)) + fees;
        potentialRr = stopRisk > 0 ? potentialPnl / stopRisk : null;
      }
    }

    if (entry != null && exit != null && sl != null && lot) {
      const stopRisk = selectedInstrument
        ? Math.abs(calculateSelectedInstrumentPnl(direction, entry, sl, lot)) + fees
        : Math.abs(calcPnl(Math.abs(calcPips(pair, direction, entry, sl)), lot, pair)) + fees;
      rr = stopRisk > 0 ? pnl / stopRisk : null;
    }

    const hasData = entry != null && pair.length > 0;
    const isClosed = exit != null;
    const instType = pair ? getInstrumentType(pair) : 'fx';

    return { pips, pnl, rr, outcome, potentialPips, potentialPnl, potentialRr, hasData, isClosed, instType };
  })();

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);
    if (mediaUploading) {
      setError('Wait for the attachment upload to finish before saving this trade.');
      setSaving(false);
      return;
    }
    if (!form.pair.trim()) {
      setError('Please enter a currency pair (e.g. EUR/USD).');
      setSaving(false);
      return;
    }
    if (form.entry_price == null) {
      setError('Please enter an entry price.');
      setSaving(false);
      return;
    }
    if (!form.lot_size || !Number.isFinite(form.lot_size) || form.lot_size <= 0) {
      setError('Please enter a lot size.');
      setSaving(false);
      return;
    }
    const timeError = validateTradeTimes(form.entry_time, form.exit_time, form.exit_price != null);
    const invalidSize = selectedInstrument && !validQuantity(selectedInstrument, form.lot_size);
    if (timeError || invalidSize || !Number.isFinite(liveCalc.pnl) || !Number.isFinite(form.entry_price) || form.entry_price <= 0 || (form.exit_price != null && (!Number.isFinite(form.exit_price) || form.exit_price <= 0))) {
      setError(timeError || (invalidSize ? `Use a supported size in increments of ${quantityStep(selectedInstrument!)}.` : 'Enter valid prices and calculation inputs.'));
      setSaving(false);
      return;
    }
    const missedRequiredChecks = applicableChecklistItems.filter(item => item.is_required && !checklistSnapshot.some(snapshot => (snapshot.id === item.id || snapshot.label === item.label) && snapshot.checked));
    if (missedRequiredChecks.length > 0 && !checklistOverrideReason?.trim()) {
      setError('Complete required plan and entry checks, or record an override reason in the checklist.');
      setSaving(false);
      return;
    }
    if (form.capture_mode === 'live' && !actualFillConfirmed) {
      setError('Enter the actual broker fill and confirm it before saving a live trade.');
      setSaving(false);
      return;
    }
    if (form.capture_mode === 'historical' && isExamplePrice && !exampleConfirmed) {
      setError('Confirm that the historical entry price is not an illustrative example.');
      setSaving(false);
      return;
    }
    if (needsConversion && !(conversionRate > 0)) {
      setError(`Enter the conversion rate from ${selectedInstrument?.quote_currency} to ${selectedAccount?.base_currency}.`);
      setSaving(false);
      return;
    }

    const autoStatus: TradeStatus = form.exit_price != null ? 'closed' : 'open';
    const autoPips = liveCalc.pips;
    const currency = selectedAccount?.base_currency || selectedInstrument?.quote_currency || 'USD';
    const posted = settlement(liveCalc.pnl, currency);
    const autoRr = liveCalc.rr;

    const allRequiredChecked = applicableChecklistItems.length > 0 && applicableChecklistItems.filter(i => i.is_required).every(item =>
      checklistSnapshot.some(s => (s.id === item.id || s.label === item.label) && s.checked)
    );

    const finalData: TradeInput = {
      ...form,
      ...posted,
      trade_source: 'manual',
      settlement_currency: currency,
      planned_r: liveCalc.potentialRr,
      risk_capital_at_entry: entryCapital,
      client_request_id: initial ? undefined : draftId,
      expected_revision: initial?.updated_at,
      instrument_id: selectedInstrument && !selectedInstrument.id.startsWith('seed:') && !selectedInstrument.id.startsWith('custom-local:') ? selectedInstrument.id : null,
      stop_loss: stopLoss ? Number(stopLoss) : null,
      conversion_rate: needsConversion ? conversionRate : 1,
      fees: Math.max(0, Number(form.fees) || 0),
        risk_override_reason: riskLimitExceeded ? riskOverrideReason.trim() || null : null,
      calculation_snapshot: reusableCalculationSnapshot || (selectedInstrument && selectedAccount
        ? createTradeCalculationSnapshot(selectedInstrument, selectedAccount.base_currency, conversionRate || 1, calculatedAt)
        : null),
      example_values_confirmed: true,
      capture_mode: form.capture_mode || 'live',
      entry_price_confirmed_actual: form.capture_mode === 'live' ? actualFillConfirmed : false,
      risk_percent: selectedAccount && stopLoss && selectedInstrument && form.lot_size && effectiveBalance > 0
        ? (Math.abs(calculateSelectedInstrumentPnl('long', form.entry_price!, Number(stopLoss), form.lot_size)) + Math.max(0, Number(form.fees) || 0)) / effectiveBalance * 100
        : form.risk_percent,
      status: autoStatus,
      pips: parseFloat(autoPips.toFixed(1)),
      outcome: autoStatus === 'open' ? null : posted.outcome,
      risk_reward_ratio: autoRr != null ? parseFloat(autoRr.toFixed(2)) : form.risk_reward_ratio,
      entry_time: new Date(form.entry_time).toISOString(),
      exit_time: autoStatus === 'closed' && form.exit_time ? new Date(form.exit_time).toISOString() : null,
      screenshot_url: form.screenshot_url || form.entry_screenshot_url,
      voice_note_url: form.voice_note_url || form.entry_voice_note_url,
      checklist_items: checklistSnapshot.length > 0 ? checklistSnapshot : null,
      setup_quality: setupQualityFromChecklist(checklistSnapshot),
      checklist_override_reason: checklistOverrideReason,
      checklist_completed: allRequiredChecked,
    };

    try {
      await onSubmit(finalData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save trade.');
      setSaving(false);
    }
  };

  const inputCls = 'input-field';
  const labelCls = 'block text-xs font-semibold text-secondary mb-1.5 uppercase tracking-wide';

  const isEditMode = !!initial;
  const isClosedTrade = form.exit_price != null;

  const validateStep = (currentStep: number): string | null => {
    if (currentStep === 2) {
      if (!form.pair.trim()) return 'Choose an instrument before continuing.';
      if (form.entry_price == null || form.entry_price <= 0) return 'Enter a valid entry price before continuing.';
      if (form.lot_size == null || form.lot_size <= 0) return 'Enter a valid position size before continuing.';
      if (form.capture_mode === 'live' && !actualFillConfirmed) return 'Confirm the actual broker fill before continuing to Entry Media.';
      if (form.capture_mode === 'historical' && isExamplePrice && !exampleConfirmed) return 'Confirm the historical entry price before continuing to Entry Media.';
      if (needsConversion && !(conversionRate > 0)) return `Enter the conversion rate from ${selectedInstrument?.quote_currency} to ${selectedAccount?.base_currency} before continuing.`;
      return null;
    }
    if (currentStep === 4 && !isClosedTrade) return 'Add an exit price before opening the Closure step.';
    return null;
  };
  const navigateToStep = (targetStep: number) => {
    if (mediaUploading) {
      setError('Wait for the attachment upload to finish before changing steps.');
      return;
    }
    if (targetStep > step) {
      for (let currentStep = step; currentStep < targetStep; currentStep += 1) {
        const validationError = validateStep(currentStep);
        if (validationError) {
          setError(validationError);
          return;
        }
      }
    }
    setError(null);
    setStep(targetStep);
  };

  const closureStepUnlocked = isClosedTrade;
  const lastStep = STEPS.length - 1;

  if (initial?.trade_source === 'mt5') {
    const saveAnnotations = async () => {
      setSaving(true);
      try {
        await onSubmit({ ...initial, notes: form.notes, lessons: form.lessons, expected_revision: initial.updated_at });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not save the notes.');
      } finally {
        setSaving(false);
      }
    };
    return <div className="space-y-4">
      <p className="text-sm text-secondary">MT5 supplies the fills and realized P&amp;L. You can edit your journal notes here.</p>
      <label className={labelCls}>Notes<textarea className={inputCls} value={form.notes || ''} onChange={event => update('notes', event.target.value)} /></label>
      <label className={labelCls}>Lessons<textarea className={inputCls} value={form.lessons || ''} onChange={event => update('lessons', event.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      <button type="button" className="btn-primary" disabled={saving} onClick={saveAnnotations}>Save notes</button>
    </div>;
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-error-500/10 border border-error-500/20 text-sm text-error-500 animate-slide-up">
          <AlertTriangle size={16} className="flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 p-3 rounded-xl bg-secondary border border-themed">
        {isClosedTrade ? (
          <>
            <CheckCircle size={16} className="text-success-500" />
            <span className="text-xs font-semibold text-secondary">Closed Trade — exit price is set, outcome auto-calculated. Closure review available.</span>
          </>
        ) : (
          <>
            <Clock size={16} className="text-orange-500" />
            <span className="text-xs font-semibold text-secondary">Open Trade — no exit price yet. Fill in closure details when you close it.</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-1 sm:gap-2">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const done = i < step;
          const active = i === step;
          const locked = s.id === 4 && !closureStepUnlocked;
          return (
            <div key={s.id} className="flex items-center flex-1">
              <button
                type="button"
                onClick={() => !locked && navigateToStep(i)}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  locked ? 'text-muted/50 cursor-not-allowed' :
                  active ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400' :
                  done ? 'text-success-500' : 'text-muted'
                }`}
              >
                {locked ? <Lock size={16} /> : done ? <CheckCircle2 size={16} /> : <Icon size={16} />}
                <span className="hidden sm:inline">{s.label}</span>
              </button>
              {i < lastStep && (
                <div className={`flex-1 h-0.5 mx-1 rounded-full transition-colors ${done ? 'bg-success-500/30' : 'bg-border'}`} />
              )}
            </div>
          );
        })}
      </div>

      {liveCalc.hasData && step === 2 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-xl bg-gradient-to-br from-orange-500/5 to-amber-500/10 border border-orange-500/20 animate-slide-up">
          {liveCalc.isClosed ? (
            <>
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-orange-500/10">
                  <Calculator size={16} className="text-orange-500" />
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-muted uppercase">Pips</p>
                  <p className="text-sm font-mono font-bold">{formatPips(liveCalc.pips)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className={`p-2 rounded-lg ${liveCalc.pnl >= 0 ? 'bg-success-500/10' : 'bg-error-500/10'}`}>
                  {liveCalc.pnl >= 0 ? <TrendingUp size={16} className="text-success-500" /> : <TrendingDown size={16} className="text-error-500" />}
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-muted uppercase">P&L (auto)</p>
                  <p className={`text-sm font-mono font-bold ${liveCalc.pnl >= 0 ? 'text-success-500' : 'text-error-500'}`}>
                    {formatAccountCurrency(liveCalc.pnl)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-amber-500/10">
                  <Zap size={16} className="text-amber-500" />
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-muted uppercase">R:R</p>
                  <p className="text-sm font-mono font-bold">
                    {liveCalc.rr != null ? `1:${liveCalc.rr.toFixed(2)}` : '—'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className={`p-2 rounded-lg ${liveCalc.outcome === 'win' ? 'bg-success-500/10' : liveCalc.outcome === 'loss' ? 'bg-error-500/10' : 'bg-secondary'}`}>
                  <span className={`text-xs font-bold ${liveCalc.outcome === 'win' ? 'text-success-500' : liveCalc.outcome === 'loss' ? 'text-error-500' : 'text-muted'}`}>
                    {liveCalc.outcome ? liveCalc.outcome.toUpperCase() : '—'}
                  </span>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-muted uppercase">Outcome (auto)</p>
                  <p className="text-sm font-semibold capitalize">{liveCalc.outcome || '—'}</p>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-orange-500/10">
                  <Clock size={16} className="text-orange-500" />
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-muted uppercase">Status</p>
                  <p className="text-sm font-bold text-orange-500">OPEN</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-amber-500/10">
                  <Zap size={16} className="text-amber-500" />
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-muted uppercase">Potential Pips</p>
                  <p className="text-sm font-mono font-bold">{form.take_profit ? formatPips(liveCalc.potentialPips) : '—'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-success-500/10">
                  <TrendingUp size={16} className="text-success-500" />
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-muted uppercase">Potential P&L</p>
                  <p className="text-sm font-mono font-bold text-success-500">
                    {form.take_profit && form.lot_size ? formatAccountCurrency(liveCalc.potentialPnl) : '—'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-amber-500/10">
                  <Zap size={16} className="text-amber-500" />
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-muted uppercase">Potential R:R</p>
                  <p className="text-sm font-mono font-bold">
                    {liveCalc.potentialRr != null ? `1:${liveCalc.potentialRr.toFixed(2)}` : '—'}
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {step === 0 && (
        <div className="space-y-4 animate-fade-in">
          <div className="rounded-xl border border-themed bg-secondary/40 p-3">
            <p className="text-xs font-semibold">Trading workflow</p>
            <p className="text-[11px] text-muted mt-1">A plan contains strategies; each strategy owns its entry models and checklist.</p>
          </div>
          {plans.length > 0 && <div>
            <label className={labelCls}>Trading plan (optional)</label>
            <select className={inputCls} value={form.plan_id || ''} onChange={e => {
              const planId = e.target.value || null;
              update('plan_id', planId);
              const currentStrategy = strategies.find(s => s.id === form.strategy_id);
              if (currentStrategy && currentStrategy.plan_id !== planId) {
                update('strategy_id', null); update('strategy', ''); update('entry_model_id', null); setChecklistSnapshot([]);
              }
            }}><option value="">No plan linked</option>{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.title}</option>)}</select>
          </div>}
          <div>
            <label className={labelCls}>Strategy (optional)</label>
            {strategiesForPlan.length > 0 ? (
              <select
                className={inputCls}
                value={form.strategy_id || ''}
                onChange={e => {
                  const id = e.target.value || null;
                  const strat = strategiesForPlan.find(s => s.id === id);
                  update('strategy_id', id);
                  update('strategy', strat?.name || '');
                  update('entry_model_id', null);
                  setChecklistSnapshot([]);
                }}
              >
                <option value="">Select strategy</option>
                {strategiesForPlan.map(s => <option key={s.id} value={s.id}>{s.name}{!s.plan_id ? ' · needs plan' : ''}</option>)}
              </select>
            ) : (
              <p className="text-xs text-muted py-2">Choose a plan first, then add strategies to it in Strategy Library. You can still save this trade and link it later.</p>
            )}
          </div>

          {form.strategy_id && entryModels.length > 0 && <div>
            <label className={labelCls}>Entry model (optional)</label>
            <select className={inputCls} value={form.entry_model_id || ''} onChange={e => { update('entry_model_id', e.target.value || null); setChecklistSnapshot([]); }}>
              <option value="">General strategy checklist</option>
              {entryModels.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
          </div>}

          {applicableChecklistItems.length > 0 && (
            <PreTradeChecklist
              items={applicableChecklistItems}
              snapshot={checklistSnapshot}
              overrideReason={checklistOverrideReason}
              onSnapshotChange={setChecklistSnapshot}
              onOverrideReasonChange={setChecklistOverrideReason}
            />
          )}

          {form.strategy_id && applicableChecklistItems.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <ListChecks size={36} className="text-muted mb-3" />
              <p className="text-sm font-semibold">No checklist for this strategy</p>
              <p className="text-xs text-muted mt-1">You can add checklist items to this strategy in the strategies settings.</p>
            </div>
          )}

          {!form.strategy_id && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Target size={36} className="text-muted mb-3" />
              <p className="text-sm font-semibold">Capture the trade first</p>
              <p className="text-xs text-muted mt-1">Strategy and checklist details can be completed later.</p>
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4 animate-fade-in">
          {!initial && <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-xl border border-themed bg-secondary/40 p-3">
            <div><p className="text-xs font-semibold">Capture type</p><p className="text-[11px] text-muted">Live trades require the actual broker fill. Historical records allow past dates.</p></div>
            <select className={`${inputCls} sm:max-w-48`} value={form.capture_mode || 'live'} onChange={e => {
              const mode = e.target.value as 'live' | 'historical';
              update('capture_mode', mode);
              setActualFillConfirmed(false);
              if (mode === 'live') update('entry_time', localDateTimeInputValue());
            }}><option value="live">Live capture</option><option value="historical">Historical / past trade</option></select>
          </div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Instrument *</label>
              <InstrumentPicker value={form.pair} instruments={instruments} favoriteIds={favoriteIds} loading={instrumentsLoading} error={instrumentsError} onRetry={fetchInstruments} onSelect={selectInstrument} placeholder="Choose a preloaded instrument or type a custom symbol" />
              {selectedInstrument && <p className="mt-1 text-[11px] text-muted">{selectedInstrument.display_name} · editable example price · {selectedInstrument.quantity_unit}</p>}
              {selectedInstrument && <button type="button" onClick={() => toggleFavorite(selectedInstrument.id)} className="mt-1 text-[11px] text-amber-600"><Star size={12} className="inline mr-1" />{favoriteIds.includes(selectedInstrument.id) ? 'Remove favorite' : 'Add to favorites'}</button>}
            </div>
            <div>
              <label className={labelCls}>Direction *</label>
              <select className={inputCls} value={form.direction}
                onChange={e => changeDirection(e.target.value as TradeDirection)}>
                <option value="long">Long (Buy)</option>
                <option value="short">Short (Sell)</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Size {selectedInstrument ? `(${selectedInstrument.quantity_unit})` : ''} *</label>
              <input type="number" step="0.001" className={inputCls} placeholder="0.10"
                value={form.lot_size ?? ''} onChange={e => update('lot_size', e.target.value ? parseFloat(e.target.value) : null)} />
              <div className="flex flex-wrap gap-1 mt-1.5">{sizePresets.map(size => <button key={size} type="button" onClick={() => update('lot_size', size)} className="px-2 py-1 rounded bg-secondary text-[10px]">{size}</button>)}{suggestedSize != null && <button type="button" onClick={() => update('lot_size', suggestedSize)} className="px-2 py-1 rounded bg-orange-500/10 text-orange-600 text-[10px]">Risk size {suggestedSize}</button>}</div>
            </div>
            <div>
              <label className={labelCls}>Entry Price *</label>
              <input type="number" step={selectedInstrument?.price_increment || 0.00001} className={inputCls} placeholder={selectedInstrument?.example_price?.toString() || 'Enter price'}
                value={form.entry_price ?? ''} onChange={e => changeEntry(e.target.value ? parseFloat(e.target.value) : null)} />
              {selectedInstrument && <p className="mt-1 text-[10px] text-muted">Example only · format {selectedInstrument.price_precision} decimals · arrows change by {selectedInstrument.price_increment}</p>}
              {form.capture_mode === 'live' ? <label className="mt-2 flex items-start gap-2 rounded-lg bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300"><input className="mt-0.5" type="checkbox" checked={actualFillConfirmed} onChange={e => setActualFillConfirmed(e.target.checked)} /> I replaced the example with the actual fill from my broker.</label> : isExamplePrice && <label className="mt-2 flex items-start gap-2 rounded-lg bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300"><input className="mt-0.5" type="checkbox" checked={exampleConfirmed} onChange={e => setExampleConfirmed(e.target.checked)} /> I checked this historical price against my source data.</label>}
            </div>
            <div>
              <label className={labelCls}>Stop Loss {selectedInstrument && <span className="normal-case text-muted">· default {selectedInstrument.default_stop_ticks ?? 20} {instrumentDistanceLabel(selectedInstrument)}</span>}</label>
              <input type="number" step={selectedInstrument?.price_increment || 0.00001} className={inputCls} placeholder="Enter stop price"
                value={stopLoss} onChange={e => { setStopManuallyEdited(true); setStopLoss(e.target.value); update('stop_loss', e.target.value ? Number(e.target.value) : null); }} />
              {selectedInstrument && form.entry_price != null && <div className="mt-1.5"><p className="mb-1 text-[10px] text-muted">Quick distances · {instrumentDistanceLabel(selectedInstrument)}</p><div className="flex flex-wrap gap-1">{distancePresets(selectedInstrument).map(distance => <button key={distance} type="button" aria-label={`Stop loss ${distance} ${instrumentDistanceLabel(selectedInstrument)}`} onClick={() => { const price = priceAtDistance(selectedInstrument, form.entry_price!, form.direction, distance, 'stop'); setStopManuallyEdited(true); setStopLoss(String(price)); update('stop_loss', price); if (!targetManuallyEdited) { const targetPrice = priceAtDistance(selectedInstrument, form.entry_price!, form.direction, distance * (selectedInstrument.default_target_r ?? 2), 'target'); update('take_profit', targetPrice); } }} className="px-2 py-1 rounded bg-secondary text-[10px]">{distance}</button>)}</div></div>}
            </div>
            <div>
              <label className={labelCls}>Take Profit {selectedInstrument && <span className="normal-case text-muted">· default {selectedInstrument.default_target_r ?? 2}R</span>}</label>
              <input type="number" step={selectedInstrument?.price_increment || 0.00001} className={inputCls} placeholder="Enter target price"
                value={form.take_profit ?? ''} onChange={e => { setTargetManuallyEdited(true); update('take_profit', e.target.value ? parseFloat(e.target.value) : null); }} />
              {selectedInstrument && form.entry_price != null && <div className="mt-1.5"><p className="mb-1 text-[10px] text-muted">Quick distances · {instrumentDistanceLabel(selectedInstrument)}</p><div className="flex flex-wrap gap-1">{distancePresets(selectedInstrument).map(distance => <button key={distance} type="button" aria-label={`Take profit ${distance} ${instrumentDistanceLabel(selectedInstrument)}`} onClick={() => { const price = priceAtDistance(selectedInstrument, form.entry_price!, form.direction, distance, 'target'); setTargetManuallyEdited(true); update('take_profit', price); }} className="px-2 py-1 rounded bg-secondary text-[10px]">{distance}</button>)}</div></div>}
            </div>
            <div>
              <label className={labelCls}>Exit Price {isEditMode ? '' : '(leave empty for open trade)'}</label>
              <input type="number" step={selectedInstrument?.price_increment || 0.00001} className={inputCls} placeholder="Leave empty for an open trade"
                value={form.exit_price ?? ''} onChange={e => {
                  const exit = e.target.value ? parseFloat(e.target.value) : null;
                  update('exit_price', exit);
                  if (form.capture_mode === 'live') update('exit_time', exit == null ? null : localDateTimeInputValue());
                }} />
            </div>
            <div>
              <label className={labelCls}>Estimated fees ({selectedAccount?.base_currency || 'account currency'})</label>
              <input type="number" min="0" step="0.01" className={inputCls} value={form.fees ?? 0} onChange={event => update('fees', event.target.value ? Number(event.target.value) : 0)} />
              <p className="mt-1 text-[10px] text-muted">Commission and financing costs are subtracted from estimated net P&amp;L.</p>
            </div>
            <div>
              <label className={labelCls}>Entry Date & Time *</label>
              <input type="datetime-local" className={inputCls}
                value={form.entry_time ? form.entry_time.slice(0, 16) : ''} readOnly={form.capture_mode === 'live'} onChange={e => update('entry_time', e.target.value)} />
            </div>
            {(form.capture_mode !== 'live' && form.capture_mode !== 'legacy' || isClosedTrade) && <div>
              <label className={labelCls}>Exit Date & Time {form.capture_mode === 'live' && <span className="normal-case text-muted">· prompted on close</span>}</label>
              <input type="datetime-local" className={inputCls}
                value={form.exit_time ? form.exit_time.slice(0, 16) : ''} onChange={e => update('exit_time', e.target.value || null)} />
            </div>}
          </div>
          <div><label className={labelCls}>Manual conversion {needsConversion ? `(${selectedInstrument?.quote_currency} → ${selectedAccount?.base_currency})` : ''}</label><input type="number" min="0" step="0.000001" className={inputCls} disabled={!needsConversion} placeholder={needsConversion ? 'Account currency per quote currency' : '1'} value={form.conversion_rate ?? (needsConversion ? '' : 1)} onChange={e => update('conversion_rate', e.target.value ? Number(e.target.value) : null)} /></div>
          {suggestedSize != null && <p className="text-xs text-secondary">Estimated size: <strong>{suggestedSize} {selectedInstrument?.quantity_unit}</strong> at {selectedAccount?.risk_per_trade_pct}% risk of current {selectedAccount?.base_currency} balance.</p>}
          {selectedInstrument?.chart_symbol && <details><summary className="cursor-pointer text-xs text-orange-600">View TradingView chart</summary><div className="mt-2"><TradingViewChart symbol={selectedInstrument.chart_symbol} /></div></details>}
          <p className="text-xs text-muted">
            P&amp;L and position size are estimates based on the instrument catalog and your conversion rate; verify broker contract values and actual costs. Fees are subtracted from net P&amp;L.
            Leave exit price empty to record an open trade — come back and fill it when you close the position.
          </p>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4 animate-fade-in">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Session</label>
              <select className={inputCls} value={form.session || ''}
                onChange={e => update('session', (e.target.value || null) as TradeSession)}>
                <option value="">—</option>
                <option value="sydney">Sydney</option>
                <option value="asian">Asian</option>
                <option value="london">London</option>
                <option value="new_york">New York</option>
                <option value="overlap">London/NY Overlap</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Broker / Prop Firm</label>
              <SuggestInput value={form.broker || ''} onChange={v => update('broker', v)} placeholder="FTMO, IC Markets..." suggestions={BROKER_SUGGESTIONS} />
            </div>
            <div>
              <label className={labelCls}>Account Type</label>
              <select className={inputCls} value={form.account_type || ''}
                onChange={e => update('account_type', (e.target.value || null) as AccountType)}>
                <option value="">—</option>
                <option value="personal">Personal Funds</option>
                <option value="propfirm">Prop Firm</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Risk %</label>
              <input type="number" step="0.1" className={inputCls} placeholder="1.0"
                value={form.risk_percent ?? ''} onChange={e => update('risk_percent', e.target.value ? parseFloat(e.target.value) : null)} />
              {selectedAccount && effectiveRiskPercent != null && <p className="mt-1 text-[11px] text-muted">Strictest configured account, plan, and workspace limit: {effectiveRiskPercent}%.</p>}
                      {riskLimitExceeded && <div role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                        <p className="font-semibold">Estimated stop risk is {estimatedRiskPercent?.toFixed(2)}%, above the {effectiveRiskPercent}% advisory limit.</p>
                        <p className="mt-1">This does not block recording an executed trade. Add a note if you intentionally accepted this risk.</p>
                        <input className="input-field mt-2" value={riskOverrideReason} onChange={event => setRiskOverrideReason(event.target.value)} placeholder="Optional override reason" aria-label="Risk limit override reason" />
                      </div>}
            </div>
            <div>
              <label className={labelCls}>Trading account</label>
              <select className={inputCls} value={form.account_id || ''} onChange={e => {
                const id = e.target.value || null;
                const account = accounts.find(a => a.id === id);
                update('account_id', id);
                if (account?.broker_name) update('broker', account.broker_name);
                if (account?.account_type === 'personal' || account?.account_type === 'propfirm') update('account_type', account.account_type);
                update('conversion_rate', selectedInstrument?.quote_currency === account?.base_currency ? 1 : null);
                let effectivePlanId = form.plan_id;
                if (!effectivePlanId && account?.default_plan_id && plans.some(plan => plan.id === account.default_plan_id)) {
                  effectivePlanId = account.default_plan_id;
                  update('plan_id', effectivePlanId);
                }
                if (!form.strategy_id && account?.default_strategy_id && strategies.some(strategy => strategy.id === account.default_strategy_id && strategy.plan_id === effectivePlanId)) {
                  update('strategy_id', account.default_strategy_id);
                  update('strategy', strategies.find(strategy => strategy.id === account.default_strategy_id)?.name || '');
                  update('entry_model_id', null); setChecklistSnapshot([]);
                }
              }}><option value="">No account selected</option>{accounts.filter(account => account.is_active).map(account => <option key={account.id} value={account.id}>{account.name} · {account.base_currency}</option>)}</select>
            </div>
            <EntitySelect label="Setup (optional)" options={setups} value={form.setup_id} onChange={v => update('setup_id', v)} placeholder="Select a trading setup" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Emotional State</label>
              <select className={inputCls} value={form.emotional_state || ''}
                onChange={e => update('emotional_state', (e.target.value || null) as EmotionalState)}>
                <option value="">—</option>
                <option value="calm">Calm</option>
                <option value="confident">Confident</option>
                <option value="focused">Focused</option>
                <option value="rushed">Rushed</option>
                <option value="frustrated">Frustrated</option>
                <option value="anxious">Anxious</option>
                <option value="greedy">Greedy</option>
                <option value="fearful">Fearful</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Setup Quality · checklist score</label>
              <div className="flex items-center gap-1 h-[42px]" aria-label={checklistSnapshot.length ? `Setup grade ${setupQualityFromChecklist(checklistSnapshot)} out of 5` : 'No checklist grade'}>
                {setupQualityFromChecklist(checklistSnapshot) == null ? <span className="text-xs text-muted">No checklist selected</span> : <>{[1, 2, 3, 4, 5].map(star => <Zap key={star} size={22} className={star <= (setupQualityFromChecklist(checklistSnapshot) || 0) ? 'fill-amber-400 text-amber-400' : 'text-muted'} />)}<span className="ml-1 text-xs text-secondary">{setupQualityFromChecklist(checklistSnapshot)}/5</span></>}
              </div>
              {checklistSnapshot.some(item => item.is_required && !item.checked) && <p className="text-[11px] text-amber-600">Required checklist items missed: {checklistSnapshot.filter(item => item.is_required && !item.checked).map(item => item.label).join(', ')}</p>}
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4 animate-fade-in">
          <p className="text-sm text-secondary">
            Add one chart image and one voice note for this trade. They are saved with the trade and available from its details.
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Trade Screenshot (optional)</label>
              <ScreenshotUpload
                onUpload={url => updateTradeMedia('screenshot', url)}
                existingUrl={form.screenshot_url || form.entry_screenshot_url}
                onUploadingChange={uploading => setMediaUploads(current => ({ ...current, screenshot: uploading }))}
              />
            </div>
            <div>
              <label className={labelCls}>Trade Voice Note (optional)</label>
              <VoiceRecorder
                onUpload={url => updateTradeMedia('voice', url)}
                existingUrl={form.voice_note_url || form.entry_voice_note_url}
                onUploadingChange={uploading => setMediaUploads(current => ({ ...current, voice: uploading }))}
              />
            </div>
          </div>
          {mediaUploading && <p role="status" className="text-xs text-secondary">Uploading attachment… You can continue when it finishes.</p>}
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4 animate-fade-in">
          {!isClosedTrade ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="p-4 rounded-2xl bg-orange-500/10 mb-4">
                <Clock size={36} className="text-orange-500" />
              </div>
              <p className="text-sm font-semibold mb-1">This trade is still open</p>
              <p className="text-xs text-muted max-w-sm">
                You can add your closure review — what went wrong, observations, lessons, and closure screenshots —
                once you close the trade by entering an exit price in the Trade step.
              </p>
            </div>
          ) : (
            <>
              <div className="p-3 rounded-xl bg-success-500/5 border border-success-500/15">
                <p className="text-xs font-semibold text-success-500 flex items-center gap-2">
                  <CheckCircle size={14} /> Trade is closed — fill in your review below
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Exit Date & Time</label>
                  <input type="datetime-local" className={inputCls}
                    value={form.exit_time ? form.exit_time.slice(0, 16) : ''} onChange={e => update('exit_time', e.target.value || null)} />
                </div>
              </div>

              <div>
                <label className={labelCls}>What Went Wrong</label>
                <textarea
                  className={inputCls}
                  rows={2}
                  placeholder="If this was a loss, what was the mistake? If a win, what could have been better?"
                  value={form.what_went_wrong || ''}
                  onChange={e => update('what_went_wrong', e.target.value || null)}
                />
              </div>

              <div>
                <label className={labelCls}>Observations</label>
                <textarea
                  className={inputCls}
                  rows={2}
                  placeholder="What did you notice about the market, your execution, or your psychology?"
                  value={form.observations || ''}
                  onChange={e => update('observations', e.target.value || null)}
                />
              </div>

              <div>
                <label className={labelCls}>What I Learned</label>
                <SuggestInput multiline rows={2} value={form.lessons || ''} onChange={v => update('lessons', v)} placeholder="Key takeaway from this trade..." suggestions={LESSON_SUGGESTIONS} />
              </div>

              <div>
                <label className={labelCls}>Mistake Checklist</label>
                <p className="text-xs text-muted mb-2.5 -mt-1">Be honest. This is between you and your accountability partner.</p>
                <div className="flex flex-wrap gap-2">
                  {MISTAKE_OPTIONS.map(m => (
                    <button key={m} type="button" onClick={() => toggleMistake(m)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                        form.mistakes.includes(m)
                          ? 'bg-error-500/15 border-error-500/30 text-error-500'
                          : 'bg-secondary border-themed text-secondary hover:border-muted'
                      }`}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>

            </>
          )}
        </div>
      )}

      <div className="flex items-center justify-between pt-3 border-t border-themed">
        <div className="flex items-center gap-2">
          {step > 0 && (
            <button type="button" onClick={() => navigateToStep(step - 1)} className="btn-secondary">
              <ChevronLeft size={18} /> Back
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={onCancel} disabled={saving || mediaUploading} className="btn-secondary">
            <X size={18} /> Cancel
          </button>
          {step < lastStep ? (
            <button type="button" onClick={() => navigateToStep(step + 1)} disabled={mediaUploading} className="btn-primary">
              Next <ChevronRight size={18} />
            </button>
          ) : (
            <button type="button" onClick={handleSubmit} disabled={saving || mediaUploading} className="btn-primary">
              <Save size={18} /> {saving ? 'Saving...' : isEditMode ? 'Update Trade' : 'Save Trade'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
