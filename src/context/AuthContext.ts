import { createContext, useContext,  } from 'react';
import type { Session, User } from '@supabase/supabase-js';


export interface TraderProfile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  trading_style: string | null;
  is_public: boolean;
  username?: string | null;
  role?: 'member' | 'admin';
  account_status?: 'active' | 'suspended';
  suspended_at?: string | null;
  suspension_expires_at?: string | null;
  created_at: string;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: TraderProfile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, displayName: string, inviteCode: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<TraderProfile>) => Promise<{ error: string | null }>;
  refreshProfile: () => Promise<void>;
  updatePassword: (password: string, currentPassword: string) => Promise<{ error: string | null }>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
