import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { reportDataError } from '@/lib/recovery';
import type { Goal, GoalInput, GoalTemplate, GoalTemplateInput } from '@/lib/types';

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
