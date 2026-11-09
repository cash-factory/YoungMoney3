import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { reportDataError } from '@/lib/recovery';
import type { BacktestResult, BacktestInput, ForwardTrade, ForwardTradeInput, StrategyTestSession, StrategyTestSessionInput, StrategyTestTrade, StrategyTestTradeInput } from '@/lib/types';

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
