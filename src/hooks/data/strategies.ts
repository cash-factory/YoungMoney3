import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { reportDataError } from '@/lib/recovery';
import type { TraderStrategy, TraderStrategyInput, StrategyEntryModel, StrategyEntryModelInput, StrategyChecklistItem, StrategyChecklistInput, TradingSetup, TradingSetupInput } from '@/lib/types';

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
