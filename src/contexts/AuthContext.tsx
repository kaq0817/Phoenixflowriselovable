import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
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

const CHECK_SUBSCRIPTION_TTL_MS = 60_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const profileFetchInFlight = useRef<Promise<void> | null>(null);
  const profileFetchUserId = useRef<string | null>(null);
  const lastServerSubscriptionCheck = useRef<{ userId: string; at: number; subscribed: boolean } | null>(null);

  const fetchProfile = (userId: string) => {
    if (profileFetchInFlight.current && profileFetchUserId.current === userId) {
      return profileFetchInFlight.current;
    }

    profileFetchUserId.current = userId;
    setProfileLoading(true);

    const promise = (async () => {
      try {
        const [profileRes, roleRes] = await Promise.all([
          supabase.from("profiles").select("subscription_status").eq("id", userId).single(),
          supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
        ]);

        const row = profileRes.data as { subscription_status?: string | null } | null;
        const nextStatus = row?.subscription_status ?? null;
        setSubscriptionStatus(nextStatus);
        const admin = Boolean(roleRes.data);
        setIsAdmin(admin);

        // Stripe webhooks can lag; do a lightweight server-side check to avoid "I just paid" lockouts.
        const isActive = nextStatus === "active" || nextStatus === "trialing";
       
        if (!isActive && !admin) {
          const cached = lastServerSubscriptionCheck.current;
          const now = Date.now();

          const canReuseCache = cached
            && cached.userId === userId
            && (now - cached.at) < CHECK_SUBSCRIPTION_TTL_MS;

          if (!canReuseCache) {
            try {
              const { data } = await supabase.functions.invoke("check-subscription");
              const subscribed = Boolean(data?.subscribed);
              lastServerSubscriptionCheck.current = { userId, at: now, subscribed };
              if (subscribed) {
                setSubscriptionStatus("active");
              }
            } catch {
              // ignore
            }
          }
        }
      } catch {
        // on error leave isAdmin false but don't block profileLoading
      } finally {
        setProfileLoading(false);
      }
    })();

    profileFetchInFlight.current = promise.finally(() => {
      if (profileFetchInFlight.current === promise) {
        profileFetchInFlight.current = null;
      }
    });

    return profileFetchInFlight.current;
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, session: Session | null) => {
        // `getSession()` below already handles initial state; avoid duplicate fetches.
        if (event === "INITIAL_SESSION") return;

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
