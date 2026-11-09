import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { reportDataError } from '@/lib/recovery';
import type { TraderProfile } from '@/lib/types';

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
