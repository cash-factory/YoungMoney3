import { settleManualTrade } from '@/lib/settleManualTrade';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { reportDataError } from '@/lib/recovery';
import type { Trade, TradeInput } from '@/lib/types';

type Snapshot = { trades: Trade[]; loading: boolean; loadError: string | null; asOf: number | null };
const initial: Snapshot = { trades: [], loading: true, loadError: null, asOf: null };

function createTradeStore(owner: string) {
  let snapshot = initial;
  let pending: Promise<void> | null = null;
  let generation = 0;
  const listeners = new Set<() => void>();
  const publish = (next: Snapshot) => {
    snapshot = next;
    listeners.forEach(listener => listener());
  };
  const fetchTrades = () => {
    if (pending) return pending;
    const version = generation;
    pending = (async () => {
      const { data, error } = await supabase.from('trades').select('*')
        .eq('user_id', owner).order('entry_time', { ascending: false });
      if (version !== generation) return;
      if (error) {
        reportDataError('Failed to fetch trades:', error);
        publish({ ...snapshot, loading: false, loadError: error.message });
      } else {
        publish({ trades: data as Trade[], loading: false, loadError: null, asOf: Date.now() });
      }
    })().finally(() => { if (generation === version) pending = null; });
    return pending;
  };
  const refresh = () => {
    if (!document.hidden) void fetchTrades();
  };
  let timer: ReturnType<typeof setInterval>;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    if (listeners.size === 1) {
      timer = setInterval(refresh, 30_000);
      window.addEventListener('focus', refresh);
      document.addEventListener('visibilitychange', refresh);
      void fetchTrades();
    }
    return () => {
      listeners.delete(listener);
      if (!listeners.size) {
        clearInterval(timer);
        window.removeEventListener('focus', refresh);
        document.removeEventListener('visibilitychange', refresh);
      }
    };
  };
  const invalidate = () => {
    generation++;
    pending = null;
    return fetchTrades();
  };
  return { subscribe, fetchTrades, invalidate, getSnapshot: () => snapshot, active: () => listeners.size > 0 };
}
const stores = new Map<string, ReturnType<typeof createTradeStore>>();
function storeFor(owner: string) {
  let store = stores.get(owner);
  if (!store) {
    store = createTradeStore(owner);
    stores.set(owner, store);
  }
  return store;
}
const empty = { ...initial, loading: false };
const noSnapshot = () => empty;
const noSubscribe = () => () => {};

export function useTrades(userId?: string | null) {
  const { user } = useAuth();
  const owner = userId ?? user?.id;
  const store = useMemo(() => owner ? storeFor(owner) : null, [owner]);
  const snapshot = useSyncExternalStore(store?.subscribe ?? noSubscribe, store?.getSnapshot ?? noSnapshot);
  useEffect(() => () => {
    if (owner && store && !store.active() && stores.get(owner) === store) stores.delete(owner);
  }, [owner, store]);

  async function addTrade(input: TradeInput): Promise<Trade> {
    if (!store) throw new Error('Sign in to save a trade.');
    const { client_request_id, expected_revision, ...payload } = input;
    void expected_revision;
    const draft=settleManualTrade(payload);
    const snapshot=draft.calculation_snapshot;
    const signature=JSON.stringify({...draft,calculation_snapshot:snapshot?{...snapshot,calculated_at:null}:null});
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(signature));
    const key='trade-intent:'+owner+':'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    let intent={id:client_request_id || crypto.randomUUID(),calculatedAt:snapshot?.calculated_at};
    try {
      const saved=sessionStorage.getItem(key);
      if(saved) intent=JSON.parse(saved);
      else sessionStorage.setItem(key,JSON.stringify(intent));
    } catch { /* In-memory draft ID remains available if browser storage is disabled. */ }
    if(snapshot && intent.calculatedAt) draft.calculation_snapshot={...snapshot,calculated_at:intent.calculatedAt};
    const {data,error}=await supabase.from('trades').insert({...draft,id:intent.id}).select().single();
    if(error) throw new Error(error.message);
    try {sessionStorage.removeItem(key);} catch { /* Storage may be disabled. */ }
    await store.invalidate();
    return data as Trade;
  }
  async function updateTrade(id: string, input: Partial<TradeInput>) {
    if (!store) throw new Error('Sign in to edit a trade.');
    const { expected_revision, client_request_id, ...payload } = input;
    void client_request_id;
    const original = expected_revision ?? snapshot.trades.find(row => row.id === id)?.updated_at;
    if (!original) throw new Error('Refresh the trade before editing it.');
    const { error } = await supabase.from('trades').update(snapshot.trades.find(t => t.id === id)?.trade_source === 'mt5' ? { notes: payload.notes, lessons: payload.lessons } : payload).eq('id', id).eq('updated_at', original);
    if (error) throw new Error(error.message);
    await store.invalidate();
  }
  async function deleteTrade(id: string) {
    if (!store) throw new Error('Sign in to delete a trade.');
    const { error } = await supabase.from('trades').delete().eq('id', id);
    if (error) throw new Error(error.message);
    await store.invalidate();
  }
  return { ...snapshot, fetchTrades: store?.fetchTrades ?? (async () => {}), addTrade, updateTrade, deleteTrade };
}
