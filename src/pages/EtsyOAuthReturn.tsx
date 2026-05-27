import { useEffect, useMemo } from "react";
import { Loader2 } from "lucide-react";

const ALLOWED_PARAMS = ["code", "state", "error", "error_description"] as const;

export default function EtsyOAuthReturn() {
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || "").trim();

  const forwardedQuery = useMemo(() => {
    const current = new URL(window.location.href);
    const next = new URLSearchParams();
    for (const key of ALLOWED_PARAMS) {
      const value = current.searchParams.get(key);
      if (value) next.set(key, value);
    }
    return next.toString();
  }, []);

  useEffect(() => {
    if (!supabaseUrl) return;
    if (!forwardedQuery) return;

    const target = new URL("/functions/v1/etsy-callback", supabaseUrl);
    target.search = forwardedQuery;
    window.location.replace(target.toString());
  }, [forwardedQuery, supabaseUrl]);

  if (!supabaseUrl) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2">
        <p className="text-sm text-muted-foreground">Missing `VITE_SUPABASE_URL` configuration.</p>
      </div>
    );
  }

  if (!forwardedQuery) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2">
        <p className="text-sm text-muted-foreground">Missing Etsy OAuth return parameters.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">Finishing Etsy connection…</p>
    </div>
  );
}

