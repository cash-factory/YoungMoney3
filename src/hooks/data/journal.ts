import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { reportDataError } from '@/lib/recovery';
import type { JournalEntry, JournalInput } from '@/lib/types';

export function useJournalEntries(userId?: string | null) {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    let query = supabase.from('journal_entries').select('*').order('entry_date', { ascending: false });
    if (userId) query = query.eq('user_id', userId);
    const { data, error } = await query;
    if (error) {
      reportDataError('Failed to fetch journal entries:', error);
    } else {
      setEntries(data as JournalEntry[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const upsertEntry = async (entry: JournalInput, id?: string): Promise<void> => {
    if (id) {
      const { error } = await supabase.from('journal_entries').update(entry).eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('journal_entries').insert(entry);
      if (error) throw error;
    }
    await fetchEntries();
  };

  const deleteEntry = async (id: string): Promise<void> => {
    const { error } = await supabase.from('journal_entries').delete().eq('id', id);
    if (error) throw error;
    await fetchEntries();
  };

  return { entries, loading, fetchEntries, upsertEntry, deleteEntry };
}
