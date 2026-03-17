import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useIsAdmin(userId: string | undefined): boolean {
  const [isAdmin, setIsAdmin] = useState(false);

  const checkAdmin = useCallback(async () => {
    if (!userId) {
      setIsAdmin(false);
      return;
    }

    const { data, error } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });

    if (!error && data) {
      setIsAdmin(data);
    } else {
      setIsAdmin(false);
    }
  }, [userId]);

  useEffect(() => {
    checkAdmin();
  }, [checkAdmin]);

  return isAdmin;
}
