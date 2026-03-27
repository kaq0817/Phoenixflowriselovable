import { useState, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

export function useActiveStore() {
  const [activeStoreId, setActiveStoreId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Call this when the user selects a new store
  const selectStore = useCallback((storeId: string) => {
    setActiveStoreId(storeId);
    // Clear all cached queries related to the previous store
    queryClient.clear();
  }, [queryClient]);

  // Optionally, persist the selected store in localStorage/sessionStorage
  useEffect(() => {
    if (activeStoreId) {
      window.localStorage.setItem("activeStoreId", activeStoreId);
    }
  }, [activeStoreId]);

  useEffect(() => {
    const stored = window.localStorage.getItem("activeStoreId");
    if (stored) setActiveStoreId(stored);
  }, []);

  return { activeStoreId, selectStore };
}
