import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { supabase, startSupabaseSessionRefresh } from '@/lib/supabase';

const AuthContext = createContext<{ session: Session | null; loading: boolean; error: string | null }>({ session: null, loading: true, error: null });

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(startSupabaseSessionRefresh, []);
  useEffect(() => {
    let active = true;
    let receivedEvent = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      receivedEvent = true;
      setSession(next);
      setError(null);
      setLoading(false);
    });
    void supabase.auth.getSession().then(({ data, error: failure }) => {
      if (!active || receivedEvent) return;
      setSession(data.session);
      setError(failure ? 'Your saved session could not be restored. Please sign in again.' : null);
      setLoading(false);
    }).catch(() => {
      if (!active || receivedEvent) return;
      setError('Your saved session could not be restored. Please sign in again.');
      setLoading(false);
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);
  return <AuthContext.Provider value={{ session, loading, error }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
