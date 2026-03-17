import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface StorageUsage {
  totalBytes: number;
  fileCount: number;
  loading: boolean;
  refresh: () => void;
}

export function useStorageUsage(userId: string | undefined, bucket: string): StorageUsage {
  const [totalBytes, setTotalBytes] = useState(0);
  const [fileCount, setFileCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) return;
    setLoading(true);

    const { data, error } = await supabase.storage
      .from(bucket)
      .list(userId, { limit: 1000 });

    if (!error && data) {
      const bytes = data.reduce((sum, file) => sum + (file.metadata?.size || 0), 0);
      setTotalBytes(bytes);
      setFileCount(data.filter((f) => f.name !== ".emptyFolderPlaceholder").length);
    }
    setLoading(false);
  }, [userId, bucket]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { totalBytes, fileCount, loading, refresh };
}
