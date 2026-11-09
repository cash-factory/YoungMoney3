import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { reportDataError } from '@/lib/recovery';
import type { MarketEvent, MarketEventInput, Resource, ResourceInput, Note, NoteInput, StudyMaterial, StudyMaterialInput, Broker, BrokerInput, ChartingTool, ChartingToolInput, WeeklyReview, WeeklyReviewInput } from '@/lib/types';

export function useMarketEvents(userId?: string | null) {
  const [events, setEvents] = useState<MarketEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEvents = useCallback(async () => {
    if (!userId) { setEvents([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('market_sessions')
      .select('*')
      .eq('user_id', userId)
      .order('event_date', { ascending: true });
    if (error) {
      reportDataError('Failed to fetch market events:', error);
    } else {
      setEvents(data as MarketEvent[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const addEvent = async (event: MarketEventInput): Promise<void> => {
    const { error } = await supabase.from('market_sessions').insert({ ...event, user_id: userId });
    if (error) throw error;
    await fetchEvents();
  };

  const updateEvent = async (id: string, updates: Partial<MarketEventInput>): Promise<void> => {
    const { error } = await supabase.from('market_sessions').update(updates).eq('id', id);
    if (error) throw error;
    await fetchEvents();
  };

  const deleteEvent = async (id: string): Promise<void> => {
    const { error } = await supabase.from('market_sessions').delete().eq('id', id);
    if (error) throw error;
    await fetchEvents();
  };

  return { events, loading, fetchEvents, addEvent, updateEvent, deleteEvent };
}

// ── Trading Setups ──

export function useResources(userId?: string | null) {
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchResources = useCallback(async () => {
    if (!userId) { setResources([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('resources')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) {
      reportDataError('Failed to fetch resources:', error);
    } else {
      setResources(data as Resource[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchResources(); }, [fetchResources]);

  const upsertResource = async (resource: ResourceInput, id?: string): Promise<void> => {
    if (id) {
      const { error } = await supabase.from('resources').update(resource).eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('resources').insert({ ...resource, user_id: userId });
      if (error) throw error;
    }
    await fetchResources();
  };

  const deleteResource = async (id: string): Promise<void> => {
    const { error } = await supabase.from('resources').delete().eq('id', id);
    if (error) throw error;
    await fetchResources();
  };

  return { resources, loading, fetchResources, upsertResource, deleteResource };
}

// ── Notes ──

export function useNotes(userId?: string | null) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotes = useCallback(async () => {
    if (!userId) { setNotes([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .eq('user_id', userId)
      .order('is_pinned', { ascending: false })
      .order('updated_at', { ascending: false });
    if (error) {
      reportDataError('Failed to fetch notes:', error);
    } else {
      setNotes(data as Note[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchNotes(); }, [fetchNotes]);

  const upsertNote = async (note: NoteInput, id?: string): Promise<void> => {
    if (id) {
      const { error } = await supabase.from('notes').update(note).eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('notes').insert({ ...note, user_id: userId });
      if (error) throw error;
    }
    await fetchNotes();
  };

  const deleteNote = async (id: string): Promise<void> => {
    const { error } = await supabase.from('notes').delete().eq('id', id);
    if (error) throw error;
    await fetchNotes();
  };

  const togglePin = async (note: Note): Promise<void> => {
    const { error } = await supabase.from('notes').update({ is_pinned: !note.is_pinned }).eq('id', note.id);
    if (error) throw error;
    await fetchNotes();
  };

  return { notes, loading, fetchNotes, upsertNote, deleteNote, togglePin };
}

// ── Study Materials ──

export function useStudyMaterials(userId?: string | null) {
  const [materials, setMaterials] = useState<StudyMaterial[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMaterials = useCallback(async () => {
    if (!userId) { setMaterials([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('study_materials')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) {
      reportDataError('Failed to fetch study materials:', error);
    } else {
      setMaterials(data as StudyMaterial[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchMaterials(); }, [fetchMaterials]);

  const upsertMaterial = async (material: StudyMaterialInput, id?: string): Promise<void> => {
    if (id) {
      const { error } = await supabase.from('study_materials').update(material).eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('study_materials').insert({ ...material, user_id: userId });
      if (error) throw error;
    }
    await fetchMaterials();
  };

  const deleteMaterial = async (id: string): Promise<void> => {
    const { error } = await supabase.from('study_materials').delete().eq('id', id);
    if (error) throw error;
    await fetchMaterials();
  };

  return { materials, loading, fetchMaterials, upsertMaterial, deleteMaterial };
}

// ── Brokers ──

export function useBrokers(userId?: string | null) {
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBrokers = useCallback(async () => {
    if (!userId) { setBrokers([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('brokers')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) {
      reportDataError('Failed to fetch brokers:', error);
    } else {
      setBrokers(data as Broker[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchBrokers(); }, [fetchBrokers]);

  const upsertBroker = async (broker: BrokerInput, id?: string): Promise<void> => {
    if (id) {
      const { error } = await supabase.from('brokers').update(broker).eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('brokers').insert({ ...broker, user_id: userId });
      if (error) throw error;
    }
    await fetchBrokers();
  };

  const deleteBroker = async (id: string): Promise<void> => {
    const { error } = await supabase.from('brokers').delete().eq('id', id);
    if (error) throw error;
    await fetchBrokers();
  };

  return { brokers, loading, fetchBrokers, upsertBroker, deleteBroker };
}

// ── Charting Tools ──

export function useChartingTools(userId?: string | null) {
  const [tools, setTools] = useState<ChartingTool[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTools = useCallback(async () => {
    if (!userId) { setTools([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('charting_tools')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) {
      reportDataError('Failed to fetch charting tools:', error);
    } else {
      setTools(data as ChartingTool[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchTools(); }, [fetchTools]);

  const upsertTool = async (tool: ChartingToolInput, id?: string): Promise<void> => {
    if (id) {
      const { error } = await supabase.from('charting_tools').update(tool).eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('charting_tools').insert({ ...tool, user_id: userId });
      if (error) throw error;
    }
    await fetchTools();
  };

  const deleteTool = async (id: string): Promise<void> => {
    const { error } = await supabase.from('charting_tools').delete().eq('id', id);
    if (error) throw error;
    await fetchTools();
  };

  return { tools, loading, fetchTools, upsertTool, deleteTool };
}

// ── Weekly Reviews ──

export function useWeeklyReviews(userId?: string | null) {
  const [reviews, setReviews] = useState<WeeklyReview[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchReviews = useCallback(async () => {
    if (!userId) { setReviews([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('weekly_reviews')
      .select('*')
      .eq('user_id', userId)
      .order('week_start', { ascending: false });
    if (error) {
      reportDataError('Failed to fetch weekly reviews:', error);
    } else {
      setReviews(data as WeeklyReview[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchReviews(); }, [fetchReviews]);

  const upsertReview = async (review: WeeklyReviewInput, id?: string): Promise<void> => {
    if (id) {
      const { error } = await supabase.from('weekly_reviews').update(review).eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('weekly_reviews').insert({ ...review, user_id: userId });
      if (error) throw error;
    }
    await fetchReviews();
  };

  const deleteReview = async (id: string): Promise<void> => {
    const { error } = await supabase.from('weekly_reviews').delete().eq('id', id);
    if (error) throw error;
    await fetchReviews();
  };

  return { reviews, loading, fetchReviews, upsertReview, deleteReview };
}

// ── Goal Templates ──
