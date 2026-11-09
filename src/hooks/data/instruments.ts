import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { reportDataError } from '@/lib/recovery';
import { DEFAULT_INSTRUMENTS } from '@/data/defaultInstruments';
import type { MarketInstrument, MarketInstrumentInput } from '@/lib/types';

function loadLocalCustomInstruments(ownerId: string): MarketInstrument[] {
  return JSON.parse(localStorage.getItem(`custom-instruments:${ownerId}`) || '[]') as MarketInstrument[];
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
