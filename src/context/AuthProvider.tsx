import {useEffect, useState, type ReactNode} from 'react';
import {AuthContext,type TraderProfile} from './AuthContext';
import type {Session} from '@supabase/supabase-js';
import {supabase} from '@/lib/supabase';
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<TraderProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [unavailable,setUnavailable]=useState(false);
  const fetchProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (!error && data) {
      setProfile(data as TraderProfile);
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session }, error }: { data: { session: Session | null };error?:unknown }) => {
      if(error){setUnavailable(true);setLoading(false);return;}
      setSession(session);
      if (session?.user) {
        fetchProfile(session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event: string, session: Session | null) => {
      setSession(session);
      if (session?.user) {
        (async () => {
          await fetchProfile(session.user.id);
        })();
      } else {
        setProfile(null);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message || null };
  };

  const signUp = async (email: string, password: string, displayName: string, inviteCode: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName, pilot_invite_code: inviteCode } },
    });
    if (error) return { error: error.message };
    if (data.user) {
      // Profile is auto-created by trigger, but update display_name
      await supabase
        .from('profiles')
        .upsert({ id: data.user.id, display_name: displayName })
        .eq('id', data.user.id);
    }
    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setSession(null);
  };

  const updateProfile = async (updates: Partial<TraderProfile>) => {
    if (!session?.user) return { error: 'Not authenticated' };
    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', session.user.id);
    if (!error) {
      setProfile(prev => prev ? { ...prev, ...updates } : null);
    }
    return { error: error?.message || null };
  };

  const updatePassword = async (password: string, currentPassword: string) => {
    if (!session?.user) return { error: 'Not authenticated' };
    const { error } = await supabase.auth.updateUser({ password, current_password: currentPassword });
    return { error: error?.message || null };
  };

  const refreshProfile = async () => {
    if (session?.user) await fetchProfile(session.user.id);
  };

  if (unavailable) return <main role="alert" className="card p-5">Session verification unavailable. <button onClick={()=>window.location.reload()}>Retry</button></main>;
  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, profile, loading, signIn, signUp, signOut, updateProfile, refreshProfile, updatePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

