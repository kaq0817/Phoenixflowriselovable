
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useActiveStore } from "@/hooks/useActiveStore";
import { supabase } from "@/integrations/supabase/client";
import {
  Layers, Sparkles, RefreshCw, Check, AlertCircle,
  Flower2, ChevronDown, ChevronUp, ArrowRight,
  CheckCheck, XCircle, Copy
} from "lucide-react";
import { CopyButton, copyAllFields } from "@/components/CopyButton";

interface EtsyListing {
  listing_id: number;
  title: string;
  description: string;
  tags: string[];
  materials: string[];
  taxonomy_path?: string;
  state: string;
  images?: { url_170x135?: string; url_570xN?: string }[];
}

interface Suggestions {
  title: string;
  description: string;
  tags: string[];
  materials: string[];
  reasoning: string;
}

interface StoreConnectionOption {
  id: string;
  platform: "etsy";
  shop_domain: string | null;
  shop_name: string | null;
  scopes: string | null;
  created_at: string;
}

const BULK_ANALYZER_DRAFT_KEY = "bulk-analyzer-draft";

interface OptimizationResult {
  listing: EtsyListing;
  suggestions: Suggestions | null;
  score: number;
  status: "pending" | "optimizing" | "done" | "error" | "applied";
  error?: string;
}

interface BulkAnalyzerDraft {
  connectionId: string;
  listings: EtsyListing[];
  selected: number[];
  results: OptimizationResult[];
  expandedResult: number | null;
  savedAt: string;
}

function isUsableEtsyConnection(connection: {
  platform: string;
  shop_domain: string | null;
  scopes: string | null;
}): connection is StoreConnectionOption {
  return connection.platform === "etsy" && !!connection.shop_domain && !!connection.scopes?.includes("shops_r");
}

function getDraftKey(userId: string, connectionId: string) {
  return `${BULK_ANALYZER_DRAFT_KEY}:${userId}:${connectionId}`;
}

function getConnectionLabel(connection: StoreConnectionOption) {
  return connection.shop_name || connection.shop_domain || "Etsy shop";
}

function serializeResults(results: Map<number, OptimizationResult>) {
  return Array.from(results.values());
}

function deserializeResults(items: OptimizationResult[]) {
  return new Map(
    items.map((item) => {
      const normalizedStatus = item.status === "optimizing" ? "pending" : item.status;
      return [item.listing.listing_id, { ...item, status: normalizedStatus } as OptimizationResult];
    }),
  );
}

function scoreListing(listing: EtsyListing): number {
  let score = 0;
  const titleLen = listing.title?.length || 0;
  if (titleLen >= 100) score += 25;
  else if (titleLen >= 60) score += 15;
  else score += 5;

  const tagCount = listing.tags?.length || 0;
  score += Math.min(25, Math.round((tagCount / 13) * 25));

  const descLen = listing.description?.length || 0;
  if (descLen >= 500) score += 25;
  else if (descLen >= 200) score += 15;
  else if (descLen > 0) score += 5;

  const matCount = listing.materials?.length || 0;
  if (matCount >= 3) score += 25;
  else if (matCount >= 1) score += 15;

  return score;
}

function getScoreColor(score: number) {
  if (score >= 85) return "text-emerald-500";
  if (score >= 60) return "text-amber-500";
  return "text-destructive";
}

function getScoreLabel(score: number) {
  if (score >= 85) return "Elite";
  if (score >= 60) return "Good";
  if (score >= 40) return "Needs Work";
  return "Critical";
}

interface StoreSelectorProps {
  connections: StoreConnectionOption[];
  selectedConnectionId: string;
  onChange: (value: string) => void;
  activeStoreId: string | null;
}

function StoreSelector({ connections, selectedConnectionId, onChange, activeStoreId }: StoreSelectorProps) {
  return (
    <Card className="bg-card/50 border-border/30">
      <CardContent className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">Active Etsy shop</p>
          <p className="text-xs text-muted-foreground">
            Bulk Analyzer only reads and writes through the selected Etsy connection.
          </p>
          {activeStoreId ? (
            <p className="text-xs text-muted-foreground mt-1">
              Admin-store context is active, so this list is pre-filtered before any Etsy fetch runs.
            </p>
          ) : null}
        </div>
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm min-w-[220px]"
          value={selectedConnectionId}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Select an Etsy shop</option>
          {connections.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {getConnectionLabel(connection)}
            </option>
          ))}
        </select>
      </CardContent>
    </Card>
  );
}

export default function BulkAnalyzerPage() {
  const { toast } = useToast();
  const { activeStoreId } = useActiveStore();

  const [listings, setListings] = useState<EtsyListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [connectionsReady, setConnectionsReady] = useState(false);
  const [storeConnections, setStoreConnections] = useState<StoreConnectionOption[]>([]);
  const [selectedEtsyConnectionId, setSelectedEtsyConnectionId] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [results, setResults] = useState<Map<number, OptimizationResult>>(new Map());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [expandedResult, setExpandedResult] = useState<number | null>(null);
  const [applyingIds, setApplyingIds] = useState<Set<number>>(new Set());
  const [userId, setUserId] = useState<string | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);

  const scopedConnections = useMemo(() => {
    if (!activeStoreId) return storeConnections;

    return storeConnections.filter(
      (connection) => connection.id === activeStoreId || connection.shop_domain === activeStoreId,
    );
  }, [activeStoreId, storeConnections]);

  const hasAnyConnection = storeConnections.length > 0;
  const hasScopedConnections = scopedConnections.length > 0;

  const resetAnalyzerState = () => {
    setListings([]);
    setSelected(new Set());
    setResults(new Map());
    setExpandedResult(null);
  };

  useEffect(() => {
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setConnectionsReady(true);
        return;
      }

      setUserId(user.id);

      const { data } = await supabase
        .from("store_connections")
        .select("id, platform, shop_domain, shop_name, scopes, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      const rows = ((data || []) as Array<StoreConnectionOption | {
        id: string;
        platform: string;
        shop_domain: string | null;
        shop_name: string | null;
        scopes: string | null;
        created_at: string;
      }>).filter(isUsableEtsyConnection);

      setStoreConnections(rows);
      setConnectionsReady(true);
    })();
  }, []);

  useEffect(() => {
    if (scopedConnections.some((connection) => connection.id === selectedEtsyConnectionId)) {
      return;
    }

    const nextConnectionId = scopedConnections.length === 1 ? scopedConnections[0].id : "";
    setSelectedEtsyConnectionId(nextConnectionId);
    resetAnalyzerState();
  }, [scopedConnections, selectedEtsyConnectionId]);

  useEffect(() => {
    if (!userId || !selectedEtsyConnectionId) return;

    try {
      const rawDraft = window.localStorage.getItem(getDraftKey(userId, selectedEtsyConnectionId));
      if (!rawDraft) {
        setDraftSavedAt(null);
        return;
      }

      const draft = JSON.parse(rawDraft) as BulkAnalyzerDraft;
      if (draft.connectionId !== selectedEtsyConnectionId) return;

      setListings(draft.listings || []);
      setSelected(new Set(draft.selected || []));
      setResults(deserializeResults(draft.results || []));
      setExpandedResult(draft.expandedResult ?? null);
      setDraftSavedAt(draft.savedAt || null);

      if (draft.results?.length) {
        toast({ title: "Draft restored", description: "Unsaved bulk recommendations were restored for this Etsy shop on this device." });
      }
    } catch {
      window.localStorage.removeItem(getDraftKey(userId, selectedEtsyConnectionId));
      setDraftSavedAt(null);
    }
  }, [selectedEtsyConnectionId, toast, userId]);

  useEffect(() => {
    if (!userId || !selectedEtsyConnectionId) {
      setDraftSavedAt(null);
      return;
    }

    if (listings.length === 0 && selected.size === 0 && results.size === 0) {
      window.localStorage.removeItem(getDraftKey(userId, selectedEtsyConnectionId));
      setDraftSavedAt(null);
      return;
    }

    const savedAt = new Date().toISOString();
    const draft: BulkAnalyzerDraft = {
      connectionId: selectedEtsyConnectionId,
      listings,
      selected: Array.from(selected),
      results: serializeResults(results),
      expandedResult,
      savedAt,
    };

    window.localStorage.setItem(getDraftKey(userId, selectedEtsyConnectionId), JSON.stringify(draft));
    setDraftSavedAt(savedAt);
  }, [expandedResult, listings, results, selected, selectedEtsyConnectionId, userId]);

  const fetchListings = async () => {
    if (!selectedEtsyConnectionId) {
      toast({ title: "Select a shop", description: "Choose an Etsy shop before loading listings." });
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-etsy-listings", {
        body: {
          limit: 5,
          offset: 0,
          state: "active",
          connectionId: selectedEtsyConnectionId,
        },
      });

      if (error) throw error;

      setListings(data.results || []);
      setSelected(new Set());
      setResults(new Map());
      setExpandedResult(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to fetch listings";
      toast({ title: "Error", description: message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id: number) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 5) {
        next.add(id);
      } else {
        toast({ title: "Limit reached", description: "Max 5 listings per batch.", variant: "destructive" });
      }
      return next;
    });
  };

  const selectAll = () => {
    if (!selectedEtsyConnectionId) return;

    if (selected.size === Math.min(listings.length, 5)) {
      setSelected(new Set());
      return;
    }

    setSelected(new Set(listings.slice(0, 5).map((listing) => listing.listing_id)));
  };

  const runBulkOptimize = async () => {
    if (!selectedEtsyConnectionId) {
      toast({ title: "Select a shop", description: "Choose an Etsy shop before optimizing listings." });
      return;
    }

    const selectedListings = listings.filter((listing) => selected.has(listing.listing_id));
    if (selectedListings.length === 0) return;

    setBulkRunning(true);
    setProgress({ current: 0, total: selectedListings.length });

    const newResults = new Map<number, OptimizationResult>();
    for (const listing of selectedListings) {
      newResults.set(listing.listing_id, {
        listing,
        suggestions: null,
        score: scoreListing(listing),
        status: "pending",
      });
    }
    setResults(new Map(newResults));

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setBulkRunning(false);
      return;
    }

    for (let index = 0; index < selectedListings.length; index += 1) {
      const listing = selectedListings[index];
      const result = newResults.get(listing.listing_id);
      if (!result) continue;

      result.status = "optimizing";
      setResults(new Map(newResults));
      setProgress({ current: index, total: selectedListings.length });

      try {
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/optimize-etsy-listing`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ listing }),
          },
        );

        if (res.status === 429) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          const retry = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/optimize-etsy-listing`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${session.access_token}`,
              },
              body: JSON.stringify({ listing }),
            },
          );
          const retryData = await retry.json();
          if (!retry.ok) throw new Error(retryData.error || "Retry failed");
          result.suggestions = retryData.suggestions;
          result.status = "done";
        } else {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Optimization failed");
          result.suggestions = data.suggestions;
          result.status = "done";
        }
      } catch (err: unknown) {
        result.status = "error";
        result.error = err instanceof Error ? err.message : "Failed";
      }

      newResults.set(listing.listing_id, { ...result });
      setResults(new Map(newResults));

      if (index < selectedListings.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }

    setProgress({ current: selectedListings.length, total: selectedListings.length });
    setBulkRunning(false);
    toast({ title: "Bulk optimization complete", description: `${selectedListings.length} listings processed.` });
  };

  const applyOne = async (result: OptimizationResult) => {
    if (!result.suggestions) return;
    if (!selectedEtsyConnectionId) {
      toast({ title: "Select a shop", description: "Choose an Etsy shop before applying changes." });
      return;
    }

    const id = result.listing.listing_id;
    setApplyingIds((previous) => new Set(previous).add(id));

    try {
      const { error } = await supabase.functions.invoke("apply-etsy-changes", {
        body: {
          listingId: id,
          connectionId: selectedEtsyConnectionId,
          originalData: {
            title: result.listing.title,
            description: result.listing.description,
            tags: result.listing.tags,
            materials: result.listing.materials,
          },
          optimizedData: result.suggestions,
        },
      });

      if (error) throw error;

      setResults((previous) => {
        const next = new Map(previous);
        const nextResult = next.get(id);
        if (!nextResult) return next;
        next.set(id, { ...nextResult, status: "applied" });
        return next;
      });
      toast({ title: "Applied!", description: `"${result.listing.title.slice(0, 40)}..." updated on Etsy.` });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Apply failed";
      toast({ title: "Error", description: message, variant: "destructive" });
    } finally {
      setApplyingIds((previous) => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
    }
  };

  const clearDraft = () => {
    if (!userId || !selectedEtsyConnectionId) return;
    window.localStorage.removeItem(getDraftKey(userId, selectedEtsyConnectionId));
    setDraftSavedAt(null);
    toast({ title: "Draft cleared", description: "Saved bulk recommendations were removed from this device for this Etsy shop." });
  };

  const doneCount = Array.from(results.values()).filter((result) => result.status === "done").length;
  const appliedCount = Array.from(results.values()).filter((result) => result.status === "applied").length;
  const errorCount = Array.from(results.values()).filter((result) => result.status === "error").length;

  if (!connectionsReady) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!hasAnyConnection) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="bg-card/50 border-spring/30 max-w-md">
          <CardContent className="p-8 text-center space-y-4">
            <Flower2 className="h-12 w-12 text-spring mx-auto" />
            <h2 className="text-xl font-bold">Connect Your Shop</h2>
            <p className="text-muted-foreground text-sm">
              Connect your Etsy shop in Settings to start bulk optimizing listings.
            </p>
            <Button onClick={() => { window.location.href = "/settings"; }} className="bg-spring text-spring-foreground hover:bg-spring/90">
              Go to Settings
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Layers className="h-6 w-6 text-primary" /> Bulk Optimizer
        </h1>
        <p className="text-muted-foreground mt-1">
          Select up to 5 listings for AI-powered batch optimization. The Etsy shop must be chosen first.
        </p>
      </motion.div>

      <StoreSelector
        connections={scopedConnections}
        selectedConnectionId={selectedEtsyConnectionId}
        onChange={(value) => {
          setSelectedEtsyConnectionId(value);
          setDraftSavedAt(null);
          resetAnalyzerState();
        }}
        activeStoreId={activeStoreId}
      />

      {activeStoreId && !hasScopedConnections ? (
        <Card className="bg-card/50 border-amber-500/30">
          <CardContent className="p-4 text-sm text-muted-foreground">
            No Etsy shop is available inside the current admin-store context. Change the active store or connect the matching Etsy shop in Settings.
          </CardContent>
        </Card>
      ) : null}

      {draftSavedAt && (listings.length > 0 || results.size > 0) && selectedEtsyConnectionId ? (
        <Card className="bg-card/50 border-primary/20">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap text-sm">
              <span className="text-muted-foreground">
                Unsaved bulk recommendations are being remembered on this device for {scopedConnections.find((connection) => connection.id === selectedEtsyConnectionId)?.shop_name || "this Etsy shop"}. Last saved {new Date(draftSavedAt).toLocaleString()}.
              </span>
              <Button size="sm" variant="outline" onClick={clearDraft}>
                Clear Saved Draft
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {bulkRunning ? (
        <Card className="bg-card/50 border-primary/20">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium flex items-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                Optimizing {progress.current + 1} of {progress.total}...
              </span>
              <span className="text-muted-foreground">
                {Math.round((progress.current / progress.total) * 100)}%
              </span>
            </div>
            <Progress value={(progress.current / progress.total) * 100} className="h-2" />
          </CardContent>
        </Card>
      ) : null}

      {results.size > 0 && !bulkRunning ? (
        <Card className="bg-card/50 border-spring/20">
          <CardContent className="p-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-4 text-sm">
                <span className="flex items-center gap-1 text-emerald-500">
                  <Check className="h-4 w-4" /> {doneCount} ready
                </span>
                <span className="flex items-center gap-1 text-primary">
                  <CheckCheck className="h-4 w-4" /> {appliedCount} applied
                </span>
                {errorCount > 0 ? (
                  <span className="flex items-center gap-1 text-destructive">
                    <XCircle className="h-4 w-4" /> {errorCount} failed
                  </span>
                ) : null}
              </div>
              {doneCount > 0 ? (
                <Button
                  onClick={async () => {
                    const allText = Array.from(results.values())
                      .filter((result) => result.status === "done" && result.suggestions)
                      .map((result) => {
                        return `=== ${result.listing.title} ===\n${copyAllFields([
                          { label: "Title", value: result.suggestions!.title },
                          { label: "Tags", value: result.suggestions!.tags.join(", ") },
                          { label: "Description", value: result.suggestions!.description },
                          { label: "Materials", value: result.suggestions!.materials.join(", ") },
                        ])}`;
                      })
                      .join("\n\n========\n\n");
                    await navigator.clipboard.writeText(allText);
                    toast({ title: "All copied!", description: `${doneCount} listings' optimizations copied to clipboard.` });
                  }}
                  className="bg-spring text-spring-foreground hover:bg-spring/90"
                  size="sm"
                >
                  <Copy className="h-4 w-4 mr-1" />
                  Copy All ({doneCount})
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {results.size > 0 ? (
        <div className="space-y-3">
          {Array.from(results.values()).map((result) => {
            const isExpanded = expandedResult === result.listing.listing_id;
            const imgUrl = result.listing.images?.[0]?.url_170x135;
            return (
              <motion.div key={result.listing.listing_id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <Card className={`bg-card/50 border-border/30 ${result.status === "applied" ? "border-spring/40" : ""}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      {imgUrl ? <img src={imgUrl} alt="" className="h-12 w-12 rounded-md object-cover shrink-0" /> : null}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium text-sm truncate">{result.listing.title}</p>
                          <div className="flex items-center gap-2 shrink-0">
                            <Badge variant="outline" className={`text-xs ${getScoreColor(result.score)}`}>
                              {getScoreLabel(result.score)} {result.score}/100
                            </Badge>
                            {result.status === "optimizing" ? <RefreshCw className="h-4 w-4 animate-spin text-primary" /> : null}
                            {result.status === "done" ? <Check className="h-4 w-4 text-emerald-500" /> : null}
                            {result.status === "applied" ? <Badge className="bg-spring/10 text-spring text-xs">Applied</Badge> : null}
                            {result.status === "error" ? <Badge variant="destructive" className="text-xs">Error</Badge> : null}
                          </div>
                        </div>

                        {result.error ? <p className="text-xs text-destructive mt-1">{result.error}</p> : null}

                        {result.suggestions ? (
                          <>
                            <button
                              onClick={() => setExpandedResult(isExpanded ? null : result.listing.listing_id)}
                              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mt-2"
                            >
                              {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                              {isExpanded ? "Hide" : "View"} suggestions
                            </button>

                            <AnimatePresence>
                              {isExpanded ? (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: "auto", opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  className="overflow-hidden"
                                >
                                  <div className="mt-3 space-y-3">
                                    <p className="text-xs text-muted-foreground italic">
                                      {result.suggestions.reasoning}
                                    </p>

                                    <div className="grid gap-2 sm:grid-cols-2">
                                      <div className="p-2 rounded bg-muted/30 border border-border/20">
                                        <p className="text-[10px] text-muted-foreground mb-1">Current Title</p>
                                        <p className="text-xs">{result.listing.title}</p>
                                      </div>
                                      <div className="p-2 rounded bg-spring/5 border border-spring/20">
                                        <p className="text-[10px] text-spring mb-1">Optimized Title</p>
                                        <p className="text-xs">{result.suggestions.title}</p>
                                      </div>
                                    </div>

                                    <div className="grid gap-2 sm:grid-cols-2">
                                      <div className="p-2 rounded bg-muted/30 border border-border/20">
                                        <p className="text-[10px] text-muted-foreground mb-1">Current Tags ({result.listing.tags?.length || 0})</p>
                                        <div className="flex flex-wrap gap-1">
                                          {result.listing.tags?.map((tag) => <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>)}
                                        </div>
                                      </div>
                                      <div className="p-2 rounded bg-spring/5 border border-spring/20">
                                        <p className="text-[10px] text-spring mb-1">Optimized Tags ({result.suggestions.tags.length})</p>
                                        <div className="flex flex-wrap gap-1">
                                          {result.suggestions.tags.map((tag) => <Badge key={tag} className="text-[10px] bg-spring/10 text-spring border-spring/20">{tag}</Badge>)}
                                        </div>
                                      </div>
                                    </div>

                                    {result.status === "done" ? (
                                      <div className="flex gap-2 pt-1 flex-wrap">
                                        <Button
                                          size="sm"
                                          onClick={async () => {
                                            const text = copyAllFields([
                                              { label: "Title", value: result.suggestions!.title },
                                              { label: "Tags", value: result.suggestions!.tags.join(", ") },
                                              { label: "Description", value: result.suggestions!.description },
                                              { label: "Materials", value: result.suggestions!.materials.join(", ") },
                                            ]);
                                            await navigator.clipboard.writeText(text);
                                            toast({ title: "Copied!", description: `"${result.listing.title.slice(0, 40)}..." optimizations copied.` });
                                          }}
                                          className="bg-spring text-spring-foreground hover:bg-spring/90"
                                        >
                                          <Copy className="h-3 w-3 mr-1" /> Copy All Fields
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          disabled={!selectedEtsyConnectionId || applyingIds.has(result.listing.listing_id)}
                                          onClick={() => void applyOne(result)}
                                        >
                                          {applyingIds.has(result.listing.listing_id) ? (
                                            <><RefreshCw className="h-3 w-3 mr-1 animate-spin" /> Applying...</>
                                          ) : (
                                            <><Check className="h-3 w-3 mr-1" /> Apply to Etsy</>
                                          )}
                                        </Button>
                                        <CopyButton text={result.suggestions!.title} label="Title" />
                                        <CopyButton text={result.suggestions!.tags.join(", ")} label="Tags" />
                                      </div>
                                    ) : null}
                                  </div>
                                </motion.div>
                              ) : null}
                            </AnimatePresence>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      ) : null}

      <Card className="bg-card/50 border-border/30">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                Active Listings
                {!loading ? <Badge variant="outline" className="ml-1">{listings.length}</Badge> : null}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {selectedEtsyConnectionId
                  ? `Store locked to ${scopedConnections.find((connection) => connection.id === selectedEtsyConnectionId)?.shop_name || "the selected Etsy shop"}.`
                  : "Pick an Etsy shop before loading listings."}
              </p>
            </div>
            <div className="flex gap-2">
              {listings.length > 0 ? (
                <Button size="sm" variant="outline" onClick={selectAll} disabled={!selectedEtsyConnectionId}>
                  {selected.size === Math.min(listings.length, 5) ? "Deselect All" : "Select All (5)"}
                </Button>
              ) : null}
              <Button size="sm" variant="outline" onClick={() => void fetchListings()} disabled={!selectedEtsyConnectionId || loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-14 rounded-lg" />)}
            </div>
          ) : !selectedEtsyConnectionId ? (
            <div className="text-center py-8">
              <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-muted-foreground">Select an Etsy shop to load listings.</p>
            </div>
          ) : listings.length === 0 ? (
            <div className="text-center py-8">
              <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-muted-foreground">No active listings found for the selected Etsy shop.</p>
            </div>
          ) : (
            <>
              <div className="space-y-1 max-h-[400px] overflow-y-auto">
                {listings.map((listing) => {
                  const imgUrl = listing.images?.[0]?.url_170x135;
                  const isSelected = selected.has(listing.listing_id);
                  const score = scoreListing(listing);
                  return (
                    <div
                      key={listing.listing_id}
                      className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors hover:bg-accent/50 ${isSelected ? "bg-primary/5 border border-primary/20" : "border border-transparent"}`}
                      onClick={() => toggleSelect(listing.listing_id)}
                    >
                      <Checkbox checked={isSelected} className="shrink-0" />
                      {imgUrl ? <img src={imgUrl} alt="" className="h-10 w-10 rounded object-cover shrink-0" /> : null}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{listing.title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-xs font-medium ${getScoreColor(score)}`}>
                            {score}/100
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {listing.tags?.length || 0} tags · {listing.materials?.length || 0} materials
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {selected.size > 0 ? (
                <div className="flex items-center justify-between pt-4 border-t border-border/20 mt-4 gap-3 flex-wrap">
                  <p className="text-sm text-muted-foreground">
                    {selected.size} listing{selected.size !== 1 ? "s" : ""} selected
                  </p>
                  <Button
                    onClick={() => void runBulkOptimize()}
                    disabled={bulkRunning || !selectedEtsyConnectionId}
                    className="bg-spring text-spring-foreground hover:bg-spring/90"
                  >
                    {bulkRunning ? (
                      <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Optimizing...</>
                    ) : (
                      <><Sparkles className="h-4 w-4 mr-2" /> Optimize {selected.size} Listings</>
                    )}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <ArrowRight className="h-3 w-3" />
        Bulk Analyzer only runs against the selected Etsy connection. Drafts are remembered per shop on this device.
      </p>
    </div>
  );
}



