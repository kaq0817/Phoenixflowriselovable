import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  subscriptionStatus: string | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  subscriptionStatus: null,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);

  const fetchSubscription = async (userId: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("subscription_status")
      .eq("id", userId)
      .single();
    const row = data as { subscription_status?: string | null } | null;
    setSubscriptionStatus(row?.subscription_status ?? null);
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => {
        setSession(session);
        setLoading(false);
        if (session?.user) void fetchSubscription(session.user.id);
        else setSubscriptionStatus(null);
      }
    );

    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      setSession(data.session);
      setLoading(false);
      if (data.session?.user) void fetchSubscription(data.session.user.id);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, subscriptionStatus, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
