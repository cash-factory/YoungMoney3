import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { DEFAULT_INSTRUMENTS } from '@/data/defaultInstruments';
import { DEFAULT_PROP_FIRM_RULE_VERSIONS, DEFAULT_PROVIDER_CATALOG, DEFAULT_PROVIDER_OFFERINGS } from '@/data/providerCatalog';
import { reportDataError } from '@/lib/recovery';
import type { JournalEntry, JournalInput, TraderProfile, TraderStrategy, TraderStrategyInput, StrategyEntryModel, StrategyEntryModelInput, StrategyChecklistItem, StrategyChecklistInput, RiskSettings, RiskSettingsInput, PreTradeChecklistItem, PreTradeChecklistInput, TradingPlan, TradingPlanInput, Goal, GoalInput, BacktestResult, BacktestInput, ForwardTrade, ForwardTradeInput, TradingRule, TradingRuleInput, MarketEvent, MarketEventInput, TradingSetup, TradingSetupInput, StrategyTestSession, StrategyTestSessionInput, StrategyTestTrade, StrategyTestTradeInput, Resource, ResourceInput, Note, NoteInput, StudyMaterial, StudyMaterialInput, Broker, BrokerInput, ChartingTool, ChartingToolInput, WeeklyReview, WeeklyReviewInput, GoalTemplate, GoalTemplateInput, MarketInstrument, MarketInstrumentInput, TradingAccount, TradingAccountInput, TradingAccountAdjustment, TradingAccountAdjustmentInput, ProviderCatalogEntry, ProviderOffering, PropFirmRuleVersion, ProviderChangeReview } from '@/lib/types';

function loadLocalCustomInstruments(ownerId: string): MarketInstrument[] {
  return JSON.parse(localStorage.getItem(`custom-instruments:${ownerId}`) || '[]') as MarketInstrument[];
}

export function useProviderCatalog() {
  const [providers, setProviders] = useState<ProviderCatalogEntry[]>([]);
  const [offerings, setOfferings] = useState<ProviderOffering[]>([]);
  const [ruleVersions, setRuleVersions] = useState<PropFirmRuleVersion[]>([]);
  const [changeReviews, setChangeReviews] = useState<ProviderChangeReview[]>([]);
  const [loading, setLoading] = useState(true);
  const fetchCatalog = useCallback(async () => {
    setLoading(true);
    const [providerResult, offeringResult, rulesResult, reviewResult] = await Promise.all([
      supabase.from('provider_catalog').select('*').eq('is_active', true).order('name'),
      supabase.from('provider_offerings').select('*').eq('is_active', true).order('name'),
      supabase.from('prop_firm_rule_versions').select('*').order('verified_at', { ascending: false }),
      supabase.from('provider_change_reviews').select('*,provider_catalog(name),provider_source_watches(source_url)').eq('status', 'pending').order('detected_at', { ascending: false }).limit(50),
    ]);
    if (providerResult.error) { reportDataError('Failed to load provider directory:', providerResult.error); setProviders(DEFAULT_PROVIDER_CATALOG); }
    else setProviders(mergeCatalog(DEFAULT_PROVIDER_CATALOG, (providerResult.data || []) as ProviderCatalogEntry[]));
    if (offeringResult.error) { reportDataError('Failed to load provider offerings:', offeringResult.error); setOfferings(DEFAULT_PROVIDER_OFFERINGS); }
    else setOfferings(mergeCatalog(DEFAULT_PROVIDER_OFFERINGS, (offeringResult.data || []) as ProviderOffering[]));
    if (rulesResult.error) { reportDataError('Failed to load prop firm rules:', rulesResult.error); setRuleVersions(DEFAULT_PROP_FIRM_RULE_VERSIONS); }
    else setRuleVersions(mergeCatalog(DEFAULT_PROP_FIRM_RULE_VERSIONS, (rulesResult.data || []) as PropFirmRuleVersion[]));
    if (reviewResult.error) reportDataError('Failed to load provider review queue:', reviewResult.error);
    else setChangeReviews((reviewResult.data || []) as unknown as ProviderChangeReview[]);
    setLoading(false);
  }, []);
  useEffect(() => { fetchCatalog(); }, [fetchCatalog]);
  return { providers, offerings, ruleVersions, changeReviews, loading, fetchCatalog };
}

function mergeCatalog<T extends { id: string }>(defaults: T[], live: T[]): T[] {
  const merged = new Map(defaults.map(item => [item.id, item]));
  live.forEach(item => merged.set(item.id, { ...merged.get(item.id), ...item }));
  return [...merged.values()];
}

export function useMarketInstruments(userId?: string | null) {
  const [instruments, setInstruments] = useState<MarketInstrument[]>(DEFAULT_INSTRUMENTS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const fetchInstruments = useCallback(async () => {
    if (!userId) { setInstruments(DEFAULT_INSTRUMENTS); setLoading(false); return; }
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase.from('market_instruments').select('*')
      .or(`user_id.is.null,user_id.eq.${userId}`).order('symbol');
    if (error) {
      reportDataError('Failed to fetch instruments; using built-in example catalog:', error);
      const catalog = new Map(DEFAULT_INSTRUMENTS.map(instrument => [instrument.symbol, instrument]));
      loadLocalCustomInstruments(userId).forEach(instrument => catalog.set(instrument.symbol, instrument));
      setInstruments([...catalog.values()].sort((a, b) => a.symbol.localeCompare(b.symbol)));
      setLoadError(`Built-in example instruments are shown. Apply the database migrations to enable saved custom instruments and sync.`);
    } else {
      const catalog = new Map(DEFAULT_INSTRUMENTS.map(instrument => [instrument.symbol, instrument]));
      loadLocalCustomInstruments(userId).forEach(instrument => catalog.set(instrument.symbol, instrument));
      (data || []).forEach((instrument: MarketInstrument) => catalog.set(instrument.symbol, instrument));
      setInstruments([...catalog.values()].sort((a, b) => a.symbol.localeCompare(b.symbol)));
      setLoadError(null);
    }
    setLoading(false);
  }, [userId]);
  useEffect(() => { fetchInstruments(); }, [fetchInstruments]);
  const saveInstrument = async (input: MarketInstrumentInput, id?: string) => {
    if (!userId) throw new Error('Not authenticated');
    if (loadError || (id && id.startsWith('seed:'))) {
      const local: MarketInstrument = { ...input, id: `custom-local:${input.symbol}`, user_id: userId, created_at: new Date().toISOString() };
      const saved = loadLocalCustomInstruments(userId).filter(instrument => instrument.symbol !== local.symbol);
      localStorage.setItem(`custom-instruments:${userId}`, JSON.stringify([...saved, local]));
      await fetchInstruments();
      return;
    }
    const query = id
      ? supabase.from('market_instruments').update(input).eq('id', id).eq('user_id', userId)
      : supabase.from('market_instruments').insert({ ...input, user_id: userId });
    const { error } = await query;
    if (error) throw error;
    await fetchInstruments();
  };
  return { instruments, loading, loadError, fetchInstruments, saveInstrument };
}

export function useInstrumentFavorites(userId?: string | null) {
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [favoriteRows, setFavoriteRows] = useState<{ id: string; instrument_id: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const fetchFavorites = useCallback(async () => {
    if (!userId) { setFavoriteIds([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.from('instrument_favorites').select('id,instrument_id').eq('user_id', userId);
    if (error) {
      reportDataError('Failed to load favorite instruments:', error);
      const ids = JSON.parse(localStorage.getItem(`instrument-favorites:${userId}`) || '[]') as string[];
      setFavoriteIds(ids);
    }
    else {
      setFavoriteRows(data || []);
      const localIds = JSON.parse(localStorage.getItem(`instrument-favorites:${userId}`) || '[]') as string[];
      setFavoriteIds([...new Set([...(data || []).map((row: { instrument_id: string }) => row.instrument_id), ...localIds])]);
    }
    setLoading(false);
  }, [userId]);
  useEffect(() => { fetchFavorites(); }, [fetchFavorites]);
  const toggleFavorite = async (instrumentId: string) => {
    if (!userId) throw new Error('Not authenticated');
    if (instrumentId.startsWith('seed:') || instrumentId.startsWith('custom-local:')) {
      const stored = JSON.parse(localStorage.getItem(`instrument-favorites:${userId}`) || '[]') as string[];
      const next = stored.includes(instrumentId) ? stored.filter(item => item !== instrumentId) : [...stored, instrumentId];
      localStorage.setItem(`instrument-favorites:${userId}`, JSON.stringify(next));
      setFavoriteIds(current => [...new Set([...current.filter(id => !id.startsWith('seed:') && !id.startsWith('custom-local:')), ...next])]);
      return;
    }
    if (favoriteIds.includes(instrumentId)) {
      const rows = favoriteRows.filter(row => row.instrument_id === instrumentId);
      for (const row of rows) {
        const { error } = await supabase.from('instrument_favorites').delete().eq('id', row.id).eq('user_id', userId);
        if (error) throw error;
      }
    } else {
      const { error } = await supabase.from('instrument_favorites').insert({ instrument_id: instrumentId, user_id: userId });
      if (error) throw error;
    }
    await fetchFavorites();
  };
  return { favoriteIds, loading, toggleFavorite, fetchFavorites };
}

export function useTradingAccounts(userId?: string | null) {
  const [accounts, setAccounts] = useState<TradingAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const fetchAccounts = useCallback(async () => {
    if (!userId) { setAccounts([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.from('trading_accounts').select('*').eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (error) reportDataError('Failed to fetch trading accounts:', error);
    else setAccounts((data || []) as TradingAccount[]);
    setLoading(false);
  }, [userId]);
  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);
  const upsertAccount = async (input: TradingAccountInput, id?: string) => {
    if (!userId) throw new Error('Not authenticated');
    const query = id
      ? supabase.from('trading_accounts').update(input).eq('id', id).eq('user_id', userId)
      : supabase.from('trading_accounts').insert({ ...input, user_id: userId });
    const { error } = await query;
    if (error) throw error;
    await fetchAccounts();
  };
  const deleteAccount = async (id: string) => {
    const { error } = await supabase.from('trading_accounts').delete().eq('id', id).eq('user_id', userId);
    if (error) throw error;
    await fetchAccounts();
  };
  return { accounts, loading, fetchAccounts, upsertAccount, deleteAccount };
}

export function useTradingAccountAdjustments(userId?: string | null) {
  const [adjustments, setAdjustments] = useState<TradingAccountAdjustment[]>([]);
  const fetchAdjustments = useCallback(async () => {
    if (!userId) { setAdjustments([]); return; }
    const { data, error } = await supabase.from('trading_account_adjustments').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) reportDataError('Failed to load account balance adjustments:', error);
    else setAdjustments((data || []) as TradingAccountAdjustment[]);
  }, [userId]);
  useEffect(() => { fetchAdjustments(); }, [fetchAdjustments]);
  const addAdjustment = async (input: TradingAccountAdjustmentInput) => {
    if (!userId) throw new Error('Not authenticated');
    const { error } = await supabase.from('trading_account_adjustments').insert({ ...input, user_id: userId });
    if (error) throw error;
    await fetchAdjustments();
  };
  return { adjustments, fetchAdjustments, addAdjustment };
}

export { useTrades } from './useTrades';

export function useJournalEntries(userId?: string | null) {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    let query = supabase.from('journal_entries').select('*').order('entry_date', { ascending: false });
    if (userId) query = query.eq('user_id', userId);
    const { data, error } = await query;
    if (error) {
      reportDataError('Failed to fetch journal entries:', error);
    } else {
      setEntries(data as JournalEntry[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const upsertEntry = async (entry: JournalInput, id?: string): Promise<void> => {
    if (id) {
      const { error } = await supabase.from('journal_entries').update(entry).eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('journal_entries').insert(entry);
      if (error) throw error;
    }
    await fetchEntries();
  };

  const deleteEntry = async (id: string): Promise<void> => {
    const { error } = await supabase.from('journal_entries').delete().eq('id', id);
    if (error) throw error;
    await fetchEntries();
  };

  return { entries, loading, fetchEntries, upsertEntry, deleteEntry };
}

export function useProfiles() {
  const [profiles, setProfiles] = useState<TraderProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProfiles = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('display_name', { ascending: true });
    if (error) {
      reportDataError('Failed to fetch profiles:', error);
    } else {
      setProfiles(data as TraderProfile[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  return { profiles, loading, fetchProfiles };
}

export function useStrategies(userId?: string | null) {
  const [strategies, setStrategies] = useState<TraderStrategy[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchStrategies = useCallback(async () => {
    if (!userId) { setStrategies([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('trader_strategies')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (error) {
      reportDataError('Failed to fetch strategies:', error);
    } else {
      setStrategies(data as TraderStrategy[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    fetchStrategies();
  }, [fetchStrategies]);

  const addStrategy = async (strategy: TraderStrategyInput): Promise<TraderStrategy> => {
    const { data, error } = await supabase
      .from('trader_strategies')
      .insert(strategy)
      .select()
      .single();
    if (error) throw error;
    await fetchStrategies();
    return data as TraderStrategy;
  };

  const updateStrategy = async (id: string, updates: Partial<TraderStrategyInput>): Promise<void> => {
    const { error } = await supabase
      .from('trader_strategies')
      .update(updates)
      .eq('id', id);
    if (error) throw error;
    await fetchStrategies();
  };

  const deleteStrategy = async (id: string): Promise<void> => {
    const { error } = await supabase
      .from('trader_strategies')
      .delete()
      .eq('id', id);
    if (error) throw error;
    await fetchStrategies();
  };

  return { strategies, loading, fetchStrategies, addStrategy, updateStrategy, deleteStrategy };
}

export function useStrategyEntryModels(strategyId?: string | null) {
  const [models, setModels] = useState<StrategyEntryModel[]>([]);
  const [loading, setLoading] = useState(true);
  const fetchModels = useCallback(async () => {
    if (!strategyId) { setModels([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.from('strategy_entry_models').select('*').eq('strategy_id', strategyId).order('created_at');
    if (error) reportDataError('Failed to load entry models:', error);
    else setModels((data || []) as StrategyEntryModel[]);
    setLoading(false);
  }, [strategyId]);
  useEffect(() => { fetchModels(); }, [fetchModels]);
  const addModel = async (input: StrategyEntryModelInput) => {
    const { error } = await supabase.from('strategy_entry_models').insert(input);
    if (error) throw error;
    await fetchModels();
  };
  const updateModel = async (id: string, updates: Partial<StrategyEntryModelInput>) => {
    const { error } = await supabase.from('strategy_entry_models').update(updates).eq('id', id);
    if (error) throw error;
    await fetchModels();
  };
  const deleteModel = async (id: string) => {
    const { error } = await supabase.from('strategy_entry_models').delete().eq('id', id);
    if (error) throw error;
    await fetchModels();
  };
  return { models, loading, fetchModels, addModel, updateModel, deleteModel };
}

export function useStrategyChecklist(strategyId?: string | null, entryModelId?: string | null) {
  const [items, setItems] = useState<StrategyChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchItems = useCallback(async () => {
    if (!strategyId) { setItems([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('strategy_checklist_items')
      .select('*')
      .eq('strategy_id', strategyId)
      .is('entry_model_id', entryModelId || null)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error) {
      reportDataError('Failed to fetch strategy checklist:', error);
    } else {
      setItems(data as StrategyChecklistItem[]);
    }
    setLoading(false);
  }, [strategyId, entryModelId]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const addItem = async (label: string, isRequired: boolean, modelId = entryModelId || null): Promise<void> => {
    if (!strategyId) return;
    const maxOrder = items.reduce((max, item) => Math.max(max, item.sort_order), -1);
    const { data, error } = await supabase
      .from('strategy_checklist_items')
      .insert({ strategy_id: strategyId, entry_model_id: modelId, label, is_required: isRequired, sort_order: maxOrder + 1, is_active: true })
      .select()
      .single();
    if (error) throw error;
    setItems(prev => [...prev, data as StrategyChecklistItem]);
  };

  const updateItem = async (id: string, updates: Partial<StrategyChecklistInput>): Promise<void> => {
    const { error } = await supabase
      .from('strategy_checklist_items')
      .update(updates)
      .eq('id', id);
    if (error) throw error;
    await fetchItems();
  };

  const deleteItem = async (id: string): Promise<void> => {
    const { error } = await supabase
      .from('strategy_checklist_items')
      .delete()
      .eq('id', id);
    if (error) throw error;
    setItems(prev => prev.filter(item => item.id !== id));
  };

  const addBatch = async (newItems: { label: string; is_required: boolean }[], modelId = entryModelId || null): Promise<void> => {
    if (!strategyId || newItems.length === 0) return;
    const maxOrder = items.reduce((max, item) => Math.max(max, item.sort_order), -1);
    const inserts = newItems.map((item, i) => ({
      strategy_id: strategyId,
      entry_model_id: modelId,
      label: item.label,
      is_required: item.is_required,
      sort_order: maxOrder + 1 + i,
      is_active: true,
    }));
    const { data, error } = await supabase
      .from('strategy_checklist_items')
      .insert(inserts)
      .select()
      .order('sort_order', { ascending: true });
    if (error) throw error;
    if (data) setItems(data as StrategyChecklistItem[]);
  };

  return { items, loading, fetchItems, addItem, updateItem, deleteItem, addBatch };
}

export function useRiskSettings(userId?: string | null) {
  const [settings, setSettings] = useState<RiskSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSettings = useCallback(async () => {
    if (!userId) { setSettings(null); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('risk_settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      reportDataError('Failed to fetch risk settings:', error);
    } else {
      setSettings(data as RiskSettings | null);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const saveSettings = async (input: RiskSettingsInput): Promise<RiskSettings> => {
    if (!userId) throw new Error('Not authenticated');
    const { data: existing } = await supabase
      .from('risk_settings')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();
    if (existing) {
      const { data, error } = await supabase
        .from('risk_settings')
        .update(input)
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      setSettings(data as RiskSettings);
      return data as RiskSettings;
    } else {
      const { data, error } = await supabase
        .from('risk_settings')
        .insert({ ...input, user_id: userId })
        .select()
        .single();
      if (error) throw error;
      setSettings(data as RiskSettings);
      return data as RiskSettings;
    }
  };

  return { settings, loading, fetchSettings, saveSettings };
}

export function useChecklist(userId?: string | null) {
  const [checklist, setChecklist] = useState<PreTradeChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchChecklist = useCallback(async () => {
    if (!userId) { setChecklist([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('pre_trade_checklist')
      .select('*')
      .eq('user_id', userId)
      .order('sort_order', { ascending: true });
    if (error) {
      reportDataError('Failed to fetch checklist:', error);
    } else {
      setChecklist(data as PreTradeChecklistItem[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    fetchChecklist();
  }, [fetchChecklist]);

  const addChecklistItem = async (label: string, isRequired: boolean, planId: string | null = null): Promise<void> => {
    if (!userId) return;
    const maxOrder = checklist.reduce((max, item) => Math.max(max, item.sort_order), -1);
    const { data, error } = await supabase
      .from('pre_trade_checklist')
      .insert({ user_id: userId, plan_id: planId, label, is_required: isRequired, sort_order: maxOrder + 1, is_active: true })
      .select()
      .single();
    if (error) throw error;
    setChecklist(prev => [...prev, data as PreTradeChecklistItem]);
  };

  const updateChecklistItem = async (id: string, updates: Partial<PreTradeChecklistInput>): Promise<void> => {
    const { error } = await supabase
      .from('pre_trade_checklist')
      .update(updates)
      .eq('id', id);
    if (error) throw error;
    await fetchChecklist();
  };

  const deleteChecklistItem = async (id: string): Promise<void> => {
    const { error } = await supabase
      .from('pre_trade_checklist')
      .delete()
      .eq('id', id);
    if (error) throw error;
    setChecklist(prev => prev.filter(item => item.id !== id));
  };

  return { checklist, loading, fetchChecklist, addChecklistItem, updateChecklistItem, deleteChecklistItem };
}

// ── Trading Plans ──
export function useTradingPlans(userId?: string | null) {
  const [plans, setPlans] = useState<TradingPlan[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPlans = useCallback(async () => {
    if (!userId) { setPlans([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('trading_plans')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) {
      reportDataError('Failed to fetch trading plans:', error);
    } else {
      setPlans(data as TradingPlan[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchPlans(); }, [fetchPlans]);

  const upsertPlan = async (plan: TradingPlanInput, id?: string): Promise<void> => {
    if (id) {
      const { error } = await supabase.from('trading_plans').update(plan).eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('trading_plans').insert({ ...plan, user_id: userId });
      if (error) throw error;
    }
    await fetchPlans();
  };

  const deletePlan = async (id: string): Promise<void> => {
    const { error } = await supabase.from('trading_plans').delete().eq('id', id);
    if (error) throw error;
    await fetchPlans();
  };

  return { plans, loading, fetchPlans, upsertPlan, deletePlan };
}

// ── Goals ──
export function useGoals(userId?: string | null) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchGoals = useCallback(async () => {
    if (!userId) { setGoals([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('goals')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) {
      reportDataError('Failed to fetch goals:', error);
    } else {
      setGoals(data as Goal[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchGoals(); }, [fetchGoals]);

  const upsertGoal = async (goal: GoalInput, id?: string): Promise<void> => {
    if (id) {
      const { error } = await supabase.from('goals').update(goal).eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('goals').insert({ ...goal, user_id: userId });
      if (error) throw error;
    }
    await fetchGoals();
  };

  const deleteGoal = async (id: string): Promise<void> => {
    const { error } = await supabase.from('goals').delete().eq('id', id);
    if (error) throw error;
    await fetchGoals();
  };

  return { goals, loading, fetchGoals, upsertGoal, deleteGoal };
}

// ── Backtest Results ──
export function useBacktests(userId?: string | null) {
  const [backtests, setBacktests] = useState<BacktestResult[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBacktests = useCallback(async () => {
    if (!userId) { setBacktests([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('backtest_results')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) {
      reportDataError('Failed to fetch backtests:', error);
    } else {
      setBacktests(data as BacktestResult[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchBacktests(); }, [fetchBacktests]);

  const addBacktest = async (bt: BacktestInput): Promise<void> => {
    const { error } = await supabase.from('backtest_results').insert({ ...bt, user_id: userId });
    if (error) throw error;
    await fetchBacktests();
  };

  const updateBacktest = async (id: string, updates: Partial<BacktestInput>): Promise<void> => {
    const { error } = await supabase.from('backtest_results').update(updates).eq('id', id);
    if (error) throw error;
    await fetchBacktests();
  };

  const deleteBacktest = async (id: string): Promise<void> => {
    const { error } = await supabase.from('backtest_results').delete().eq('id', id);
    if (error) throw error;
    await fetchBacktests();
  };

  return { backtests, loading, fetchBacktests, addBacktest, updateBacktest, deleteBacktest };
}

// ── Forward Trades ──
export function useForwardTrades(userId?: string | null) {
  const [forwardTrades, setForwardTrades] = useState<ForwardTrade[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchForwardTrades = useCallback(async () => {
    if (!userId) { setForwardTrades([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('forward_trades')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) {
      reportDataError('Failed to fetch forward trades:', error);
    } else {
      setForwardTrades(data as ForwardTrade[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchForwardTrades(); }, [fetchForwardTrades]);

  const addForwardTrade = async (ft: ForwardTradeInput): Promise<void> => {
    const { error } = await supabase.from('forward_trades').insert({ ...ft, user_id: userId });
    if (error) throw error;
    await fetchForwardTrades();
  };

  const updateForwardTrade = async (id: string, updates: Partial<ForwardTradeInput>): Promise<void> => {
    const { error } = await supabase.from('forward_trades').update(updates).eq('id', id);
    if (error) throw error;
    await fetchForwardTrades();
  };

  const deleteForwardTrade = async (id: string): Promise<void> => {
    const { error } = await supabase.from('forward_trades').delete().eq('id', id);
    if (error) throw error;
    await fetchForwardTrades();
  };

  return { forwardTrades, loading, fetchForwardTrades, addForwardTrade, updateForwardTrade, deleteForwardTrade };
}

// ── Trading Rules ──
export function useTradingRules(userId?: string | null) {
  const [rules, setRules] = useState<TradingRule[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRules = useCallback(async () => {
    if (!userId) { setRules([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('trading_rules')
      .select('*')
      .eq('user_id', userId)
      .order('priority', { ascending: true });
    if (error) {
      reportDataError('Failed to fetch trading rules:', error);
    } else {
      setRules(data as TradingRule[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const upsertRule = async (rule: TradingRuleInput, id?: string): Promise<void> => {
    if (id) {
      const { error } = await supabase.from('trading_rules').update(rule).eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('trading_rules').insert({ ...rule, user_id: userId });
      if (error) throw error;
    }
    await fetchRules();
  };

  const deleteRule = async (id: string): Promise<void> => {
    const { error } = await supabase.from('trading_rules').delete().eq('id', id);
    if (error) throw error;
    await fetchRules();
  };

  const incrementBroken = async (id: string): Promise<void> => {
    const rule = rules.find(r => r.id === id);
    if (!rule) return;
    const { error } = await supabase
      .from('trading_rules')
      .update({ times_broken: rule.times_broken + 1 })
      .eq('id', id);
    if (error) throw error;
    await fetchRules();
  };

  return { rules, loading, fetchRules, upsertRule, deleteRule, incrementBroken };
}

// ── Market Sessions / Events ──
export function useMarketEvents(userId?: string | null) {
  const [events, setEvents] = useState<MarketEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEvents = useCallback(async () => {
    if (!userId) { setEvents([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('market_sessions')
      .select('*')
      .eq('user_id', userId)
      .order('event_date', { ascending: true });
    if (error) {
      reportDataError('Failed to fetch market events:', error);
    } else {
      setEvents(data as MarketEvent[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const addEvent = async (event: MarketEventInput): Promise<void> => {
    const { error } = await supabase.from('market_sessions').insert({ ...event, user_id: userId });
    if (error) throw error;
    await fetchEvents();
  };

  const updateEvent = async (id: string, updates: Partial<MarketEventInput>): Promise<void> => {
    const { error } = await supabase.from('market_sessions').update(updates).eq('id', id);
    if (error) throw error;
    await fetchEvents();
  };

  const deleteEvent = async (id: string): Promise<void> => {
    const { error } = await supabase.from('market_sessions').delete().eq('id', id);
    if (error) throw error;
    await fetchEvents();
  };

  return { events, loading, fetchEvents, addEvent, updateEvent, deleteEvent };
}

// ── Trading Setups ──
export function useSetups(userId?: string | null) {
  const [setups, setSetups] = useState<TradingSetup[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSetups = useCallback(async () => {
    if (!userId) { setSetups([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('trading_setups')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) {
      reportDataError('Failed to fetch setups:', error);
    } else {
      setSetups(data as TradingSetup[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchSetups(); }, [fetchSetups]);

  const upsertSetup = async (setup: TradingSetupInput, id?: string): Promise<void> => {
    if (id) {
      const { error } = await supabase.from('trading_setups').update(setup).eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('trading_setups').insert({ ...setup, user_id: userId });
      if (error) throw error;
    }
    await fetchSetups();
  };

  const deleteSetup = async (id: string): Promise<void> => {
    const { error } = await supabase.from('trading_setups').delete().eq('id', id);
    if (error) throw error;
    await fetchSetups();
  };

  return { setups, loading, fetchSetups, upsertSetup, deleteSetup };
}

// ── Strategy Test Sessions ──
export function useTestSessions(userId?: string | null) {
  const [sessions, setSessions] = useState<StrategyTestSession[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSessions = useCallback(async () => {
    if (!userId) { setSessions([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('strategy_test_sessions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) {
      reportDataError('Failed to fetch test sessions:', error);
    } else {
      setSessions(data as StrategyTestSession[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const upsertSession = async (session: StrategyTestSessionInput, id?: string): Promise<void> => {
    if (id) {
      const { error } = await supabase.from('strategy_test_sessions').update(session).eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('strategy_test_sessions').insert({ ...session, user_id: userId });
      if (error) throw error;
    }
    await fetchSessions();
  };

  const deleteSession = async (id: string): Promise<void> => {
    const { error } = await supabase.from('strategy_test_sessions').delete().eq('id', id);
    if (error) throw error;
    await fetchSessions();
  };

  return { sessions, loading, fetchSessions, upsertSession, deleteSession };
}

// ── Strategy Test Trades ──
export function useTestTrades(sessionId?: string | null) {
  const [trades, setTrades] = useState<StrategyTestTrade[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTrades = useCallback(async () => {
    if (!sessionId) { setTrades([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('strategy_test_trades')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });
    if (error) {
      reportDataError('Failed to fetch test trades:', error);
    } else {
      setTrades(data as StrategyTestTrade[]);
    }
    setLoading(false);
  }, [sessionId]);

  useEffect(() => { fetchTrades(); }, [fetchTrades]);

  const addTrade = async (trade: StrategyTestTradeInput): Promise<void> => {
    const { error } = await supabase.from('strategy_test_trades').insert(trade);
    if (error) throw error;
    await fetchTrades();
  };

  const updateTrade = async (id: string, updates: Partial<StrategyTestTradeInput>): Promise<void> => {
    const { error } = await supabase.from('strategy_test_trades').update(updates).eq('id', id);
    if (error) throw error;
    await fetchTrades();
  };

  const deleteTrade = async (id: string): Promise<void> => {
    const { error } = await supabase.from('strategy_test_trades').delete().eq('id', id);
    if (error) throw error;
    await fetchTrades();
  };

  return { trades, loading, fetchTrades, addTrade, updateTrade, deleteTrade };
}

export function useAllTestTrades(userId?: string | null) {
  const [trades, setTrades] = useState<StrategyTestTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const fetchTrades = useCallback(async () => {
    if (!userId) { setTrades([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.from('strategy_test_trades').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) reportDataError('Failed to fetch test trades:', error);
    else setTrades((data || []) as StrategyTestTrade[]);
    setLoading(false);
  }, [userId]);
  useEffect(() => { fetchTrades(); }, [fetchTrades]);
  return { trades, loading, fetchTrades };
}

// ── Resources ──
export function useResources(userId?: string | null) {
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchResources = useCallback(async () => {
    if (!userId) { setResources([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('resources')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) {
      reportDataError('Failed to fetch resources:', error);
    } else {
      setResources(data as Resource[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchResources(); }, [fetchResources]);

  const upsertResource = async (resource: ResourceInput, id?: string): Promise<void> => {
    if (id) {
      const { error } = await supabase.from('resources').update(resource).eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('resources').insert({ ...resource, user_id: userId });
      if (error) throw error;
    }
    await fetchResources();
  };

  const deleteResource = async (id: string): Promise<void> => {
    const { error } = await supabase.from('resources').delete().eq('id', id);
    if (error) throw error;
    await fetchResources();
  };

  return { resources, loading, fetchResources, upsertResource, deleteResource };
}

// ── Notes ──
export function useNotes(userId?: string | null) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotes = useCallback(async () => {
    if (!userId) { setNotes([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .eq('user_id', userId)
      .order('is_pinned', { ascending: false })
      .order('updated_at', { ascending: false });
    if (error) {
      reportDataError('Failed to fetch notes:', error);
    } else {
      setNotes(data as Note[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchNotes(); }, [fetchNotes]);

  const upsertNote = async (note: NoteInput, id?: string): Promise<void> => {
    if (id) {
      const { error } = await supabase.from('notes').update(note).eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('notes').insert({ ...note, user_id: userId });
      if (error) throw error;
    }
    await fetchNotes();
  };

  const deleteNote = async (id: string): Promise<void> => {
    const { error } = await supabase.from('notes').delete().eq('id', id);
    if (error) throw error;
    await fetchNotes();
  };

  const togglePin = async (note: Note): Promise<void> => {
    const { error } = await supabase.from('notes').update({ is_pinned: !note.is_pinned }).eq('id', note.id);
    if (error) throw error;
    await fetchNotes();
  };

  return { notes, loading, fetchNotes, upsertNote, deleteNote, togglePin };
}

// ── Study Materials ──
export function useStudyMaterials(userId?: string | null) {
  const [materials, setMaterials] = useState<StudyMaterial[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMaterials = useCallback(async () => {
    if (!userId) { setMaterials([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('study_materials')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) {
      reportDataError('Failed to fetch study materials:', error);
    } else {
      setMaterials(data as StudyMaterial[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchMaterials(); }, [fetchMaterials]);

  const upsertMaterial = async (material: StudyMaterialInput, id?: string): Promise<void> => {
    if (id) {
      const { error } = await supabase.from('study_materials').update(material).eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('study_materials').insert({ ...material, user_id: userId });
      if (error) throw error;
    }
    await fetchMaterials();
  };

  const deleteMaterial = async (id: string): Promise<void> => {
    const { error } = await supabase.from('study_materials').delete().eq('id', id);
    if (error) throw error;
    await fetchMaterials();
  };

  return { materials, loading, fetchMaterials, upsertMaterial, deleteMaterial };
}

// ── Brokers ──
export function useBrokers(userId?: string | null) {
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBrokers = useCallback(async () => {
    if (!userId) { setBrokers([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('brokers')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) {
      reportDataError('Failed to fetch brokers:', error);
    } else {
      setBrokers(data as Broker[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchBrokers(); }, [fetchBrokers]);

  const upsertBroker = async (broker: BrokerInput, id?: string): Promise<void> => {
    if (id) {
      const { error } = await supabase.from('brokers').update(broker).eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('brokers').insert({ ...broker, user_id: userId });
      if (error) throw error;
    }
    await fetchBrokers();
  };

  const deleteBroker = async (id: string): Promise<void> => {
    const { error } = await supabase.from('brokers').delete().eq('id', id);
    if (error) throw error;
    await fetchBrokers();
  };

  return { brokers, loading, fetchBrokers, upsertBroker, deleteBroker };
}

// ── Charting Tools ──
export function useChartingTools(userId?: string | null) {
  const [tools, setTools] = useState<ChartingTool[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTools = useCallback(async () => {
    if (!userId) { setTools([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('charting_tools')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) {
      reportDataError('Failed to fetch charting tools:', error);
    } else {
      setTools(data as ChartingTool[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchTools(); }, [fetchTools]);

  const upsertTool = async (tool: ChartingToolInput, id?: string): Promise<void> => {
    if (id) {
      const { error } = await supabase.from('charting_tools').update(tool).eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('charting_tools').insert({ ...tool, user_id: userId });
      if (error) throw error;
    }
    await fetchTools();
  };

  const deleteTool = async (id: string): Promise<void> => {
    const { error } = await supabase.from('charting_tools').delete().eq('id', id);
    if (error) throw error;
    await fetchTools();
  };

  return { tools, loading, fetchTools, upsertTool, deleteTool };
}

// ── Weekly Reviews ──
export function useWeeklyReviews(userId?: string | null) {
  const [reviews, setReviews] = useState<WeeklyReview[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchReviews = useCallback(async () => {
    if (!userId) { setReviews([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('weekly_reviews')
      .select('*')
      .eq('user_id', userId)
      .order('week_start', { ascending: false });
    if (error) {
      reportDataError('Failed to fetch weekly reviews:', error);
    } else {
      setReviews(data as WeeklyReview[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchReviews(); }, [fetchReviews]);

  const upsertReview = async (review: WeeklyReviewInput, id?: string): Promise<void> => {
    if (id) {
      const { error } = await supabase.from('weekly_reviews').update(review).eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('weekly_reviews').insert({ ...review, user_id: userId });
      if (error) throw error;
    }
    await fetchReviews();
  };

  const deleteReview = async (id: string): Promise<void> => {
    const { error } = await supabase.from('weekly_reviews').delete().eq('id', id);
    if (error) throw error;
    await fetchReviews();
  };

  return { reviews, loading, fetchReviews, upsertReview, deleteReview };
}

// ── Goal Templates ──
export function useGoalTemplates(userId?: string | null) {
  const [templates, setTemplates] = useState<GoalTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTemplates = useCallback(async () => {
    if (!userId) { setTemplates([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('goal_templates')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) {
      reportDataError('Failed to fetch goal templates:', error);
    } else {
      setTemplates(data as GoalTemplate[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const upsertTemplate = async (template: GoalTemplateInput, id?: string): Promise<void> => {
    if (id) {
      const { error } = await supabase.from('goal_templates').update(template).eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('goal_templates').insert({ ...template, user_id: userId });
      if (error) throw error;
    }
    await fetchTemplates();
  };

  const deleteTemplate = async (id: string): Promise<void> => {
    const { error } = await supabase.from('goal_templates').delete().eq('id', id);
    if (error) throw error;
    await fetchTemplates();
  };

  return { templates, loading, fetchTemplates, upsertTemplate, deleteTemplate };
}

