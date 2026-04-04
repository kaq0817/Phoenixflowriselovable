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
import { copyAllFields } from "@/components/CopyButton";

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

/**
 * ABSOLUTE BINARY SCORING ENGINE
 * 100/0 Binary Logic applied to Etsy Listings.
 */
function scoreListing(listing: EtsyListing): number {
  const title = (listing.title || "").trim();
  const desc = (listing.description || "").trim();
  const tags = listing.tags || [];
  const materials = listing.materials || [];
  
  const failures: string[] = [];

  // 1. Title Length Compliance
  if (title.length < 20) failures.push("Short Title");
  
  // 2. Tag Density Compliance (Max 13 for Etsy)
  if (tags.length < 13) failures.push("Missing Tags");

  // 3. Content Depth
  if (desc.length < 100) failures.push("Thin Content");

  // 4. Logistics / Materials
  if (materials.length < 1) failures.push("Missing Materials");

  // 5. Accessibility (Images)
  if (!listing.images || listing.images.length === 0) failures.push("No Images");

  return failures.length === 0 ? 100 : 0;
}

function getScoreColor(score: number) {
  return score === 100 ? "text-emerald-500" : "text-destructive";
}

function getScoreLabel(score: number) {
  return score === 100 ? "Compliant" : "Trash (0%)";
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
            Bulk Analyzer locked to binary compliance mode.
          </p>
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
      const rows = ((data || []) as StoreConnectionOption[]).filter(isUsableEtsyConnection);
      setStoreConnections(rows);
      setConnectionsReady(true);
    })();
  }, []);

  useEffect(() => {
    if (scopedConnections.some((connection) => connection.id === selectedEtsyConnectionId)) return;
    const nextConnectionId = scopedConnections.length === 1 ? scopedConnections[0].id : "";
    setSelectedEtsyConnectionId(nextConnectionId);
    resetAnalyzerState();
  }, [scopedConnections, selectedEtsyConnectionId]);

  const fetchListings = async () => {
    if (!selectedEtsyConnectionId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-etsy-listings", {
        body: { limit: 10, offset: 0, state: "active", connectionId: selectedEtsyConnectionId },
      });
      if (error) throw error;
      setListings(data.results || []);
      setSelected(new Set());
      setResults(new Map());
      setExpandedResult(null);
    } catch (err) {
      const error = err as Error;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id: number) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else if (next.size < 5) next.add(id);
      return next;
    });
  };

  const runBulkOptimize = async () => {
    if (!selectedEtsyConnectionId) return;
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
    if (!session) return;

    for (let index = 0; index < selectedListings.length; index += 1) {
      const listing = selectedListings[index];
      const result = newResults.get(listing.listing_id);
      if (!result) continue;

      result.status = "optimizing";
      setResults(new Map(newResults));
      setProgress({ current: index, total: selectedListings.length });

      try {
        const { data, error } = await supabase.functions.invoke("optimize-etsy-listing", { body: { listing } });
        if (error) throw error;
        result.suggestions = data.suggestions;
        result.status = "done";
      } catch (err) {
        const error = err as Error;
        result.status = "error";
        result.error = error.message;
      }
      newResults.set(listing.listing_id, { ...result });
      setResults(new Map(newResults));
    }
    setBulkRunning(false);
  };

  const applyOne = async (result: OptimizationResult) => {
    if (!result.suggestions || !selectedEtsyConnectionId) return;
    const id = result.listing.listing_id;
    setApplyingIds((prev) => new Set(prev).add(id));
    try {
      const { error } = await supabase.functions.invoke("apply-etsy-changes", {
        body: {
          listingId: id,
          connectionId: selectedEtsyConnectionId,
          optimizedData: result.suggestions,
        },
      });
      if (error) throw error;
      setResults((prev) => {
        const next = new Map(prev);
        const item = next.get(id);
        if (item) next.set(id, { ...item, status: "applied" });
        return next;
      });
      toast({ title: "Applied!", description: "Binary alignment forced." });
    } catch (err) {
      const error = err as Error;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setApplyingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  if (!connectionsReady) return <div className="p-6"><Skeleton className="h-48 w-full" /></div>;

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Layers className="h-6 w-6 text-primary" /> ETSY BULK v4.0
        </h1>
        <p className="text-muted-foreground mt-1">Binary compliance mode. Surfacing 0% trash listings for forced alignment.</p>
      </motion.div>

      <StoreSelector
        connections={scopedConnections}
        selectedConnectionId={selectedEtsyConnectionId}
        onChange={(value) => {
          setSelectedEtsyConnectionId(value);
          resetAnalyzerState();
        }}
        activeStoreId={activeStoreId}
      />

      {bulkRunning && (
        <Card className="bg-card/50 border-primary/20">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium flex items-center gap-2"><RefreshCw className="h-4 w-4 animate-spin" /> Batch Processing...</span>
              <span>{Math.round((progress.current / progress.total) * 100)}%</span>
            </div>
            <Progress value={(progress.current / progress.total) * 100} />
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {Array.from(results.values()).map((result) => {
          const isExpanded = expandedResult === result.listing.listing_id;
          return (
            <Card key={result.listing.listing_id} className={`bg-card/50 ${result.score === 100 ? 'border-emerald-500/30' : 'border-destructive/30'}`}>
              <CardContent className="p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-sm truncate max-w-[70%]">{result.listing.title}</p>
                  <Badge className={`${getScoreBadgeClass(result.score)}`}>{result.score}%</Badge>
                </div>
                {result.status === "done" && (
                  <Button size="sm" className="gradient-phoenix w-full" onClick={() => applyOne(result)} disabled={applyingIds.has(result.listing.listing_id)}>
                    {applyingIds.has(result.listing.listing_id) ? "Pushing..." : "Force Binary Alignment"}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="bg-card/50 border-border/30">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Inventory Audit</CardTitle>
            <Button size="sm" variant="outline" onClick={() => void fetchListings()} disabled={!selectedEtsyConnectionId || loading}>
              <RefreshCw className={loading ? "animate-spin" : ""} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-32 w-full" /> : (
            <div className="space-y-1">
              {listings.map((listing) => {
                const score = scoreListing(listing);
                const isSelected = selected.has(listing.listing_id);
                return (
                  <div key={listing.listing_id} className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer ${isSelected ? 'bg-primary/10 border border-primary/20' : ''}`} onClick={() => toggleSelect(listing.listing_id)}>
                    <Checkbox checked={isSelected} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{listing.title}</p>
                      <span className={`text-[10px] font-bold ${getScoreColor(score)}`}>{getScoreLabel(score)} {score}/100</span>
                    </div>
                  </div>
                );
              })}
              {selected.size > 0 && (
                <Button onClick={() => runBulkOptimize()} className="w-full mt-4 gradient-phoenix" disabled={bulkRunning}>
                  Process Batch ({selected.size})
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function getScoreBadgeClass(score: number) {
  return score === 100 
    ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30" 
    : "bg-destructive/10 text-destructive border-destructive/30";
}