import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { reportDataError } from '@/lib/recovery';
import type { TradingAccount, TradingAccountInput, TradingAccountAdjustment, TradingAccountAdjustmentInput } from '@/lib/types';

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
