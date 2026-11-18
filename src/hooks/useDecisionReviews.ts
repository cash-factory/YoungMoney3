import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { DecisionReview } from '@/lib/decisionReplay';

export function useDecisionReviews(owner?: string | null) {
  const [rows, setRows] = useState<DecisionReview[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [generation, setGeneration] = useState(0);
  const refresh = useCallback(() => setGeneration((n) => n + 1), []);
  useEffect(() => {
    window.addEventListener('ymfx:decision-saved', refresh);
    return () => window.removeEventListener('ymfx:decision-saved', refresh);
  }, [refresh]);
  useEffect(() => {
    let active = true;
    if (!owner) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    void (async () => {
      const result = await supabase
        .from('decision_reviews')
        .select('*')
        .eq('user_id', owner)
        .order('updated_at', { ascending: false });
      if (!active) return;
      setLoading(false);
      setError(result.error?.message || '');
      if (!result.error) setRows((result.data || []) as DecisionReview[]);
    })();
    return () => {
      active = false;
    };
  }, [owner, generation]);
  return { rows, loading, error, refresh };
}
export async function saveDecision(
  owner: string,
  record: Omit<DecisionReview, 'id' | 'updated_at'>,
  previous?: DecisionReview
) {
  const id = 'review/' + owner + '/' + record.reference;
  const query = supabase.from('decision_reviews');
  const result = previous
    ? await query
        .update({ ...record })
        .eq('id', id)
        .eq('updated_at', previous.updated_at)
    : await query.insert({ ...record, id });
  if (result.error) throw new Error(result.error.message);
  window.dispatchEvent(new Event('ymfx:decision-saved'));
}
