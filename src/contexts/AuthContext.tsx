import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  profileLoading: boolean;
  subscriptionStatus: string | null;
  isAdmin: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  profileLoading: true,
  subscriptionStatus: null,
  isAdmin: false,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const fetchProfile = async (userId: string) => {
    setProfileLoading(true);
    try {
      const [profileRes, roleRes] = await Promise.all([
        supabase.from("profiles").select("subscription_status").eq("id", userId).single(),
        supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      ]);
      const row = profileRes.data as { subscription_status?: string | null } | null;
      setSubscriptionStatus(row?.subscription_status ?? null);
      setIsAdmin(Boolean(roleRes.data));
    } finally {
      setProfileLoading(false);
    }
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => {
        setSession(session);
        setLoading(false);
        if (session?.user) {
          void fetchProfile(session.user.id);
        } else {
          setSubscriptionStatus(null);
          setIsAdmin(false);
          setProfileLoading(false);
        }
      }
    );

    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      setSession(data.session);
      setLoading(false);
      if (data.session?.user) {
        void fetchProfile(data.session.user.id);
      } else {
        setProfileLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, profileLoading, subscriptionStatus, isAdmin, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
