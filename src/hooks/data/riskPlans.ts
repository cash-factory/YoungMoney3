import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { reportDataError } from '@/lib/recovery';
import type { RiskSettings, RiskSettingsInput, PreTradeChecklistItem, PreTradeChecklistInput, TradingPlan, TradingPlanInput, TradingRule, TradingRuleInput } from '@/lib/types';

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
