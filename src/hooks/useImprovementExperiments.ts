import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { ImprovementExperiment, ImprovementExperimentInput } from '@/lib/improvementLab';

export function useImprovementExperiments(owner?: string | null) {
  const [studies, setStudies] = useState<ImprovementExperiment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(v => v + 1), []);
  useEffect(() => {
    let mounted = true;
    if (!owner) { setStudies([]); setLoading(false); return; }
    setLoading(true);
    void (async () => {
      const result = await supabase.from('improvement_experiments')
        .select('*').eq('user_id', owner).order('created_at', { ascending: false });
      if (!mounted) return;
      setLoading(false);
      setError(result.error?.message || '');
      if (!result.error) setStudies((result.data || []) as ImprovementExperiment[]);
    })();
    return () => { mounted = false; };
  }, [owner, revision]);

  async function save(input: ImprovementExperimentInput, existing?: ImprovementExperiment) {
    if (!owner) throw new Error('Sign in to save an improvement study.');
    const result = existing
      ? await supabase.from('improvement_experiments').update(input)
        .eq('id', existing.id).eq('updated_at', existing.updated_at)
      : await supabase.from('improvement_experiments').insert({ ...input, user_id: owner });
    if (result.error) throw new Error(result.error.message);
    refresh();
  }
  async function remove(study: ImprovementExperiment) {
    if (study.status !== 'draft') throw new Error('Only draft studies can be deleted from the laboratory.');
    const result = await supabase.from('improvement_experiments').delete()
      .eq('id', study.id).eq('updated_at', study.updated_at);
    if (result.error) throw new Error(result.error.message);
    refresh();
  }
  return { studies, loading, error, refresh, save, remove };
}
