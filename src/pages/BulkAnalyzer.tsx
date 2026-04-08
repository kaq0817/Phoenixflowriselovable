import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
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
  Layers, RefreshCw,
} from "lucide-react";

interface ShopifyProduct {
  id: number;
  title: string;
  body_html: string;
  product_type: string;
  vendor: string;
  tags: string;
  status?: string;
  variants: { id: number; title: string; price: string; inventory_quantity: number }[];
  images: { id: number; src: string; alt: string | null; position: number }[];
  handle: string;
}

interface Suggestions {
  title?: string;
  body_html?: string;
  seo_title?: string;
  seo_description?: string;
  product_type?: string;
  tags?: string;
  variant_suggestions?: string;
  url_handle?: string;
  faq_json?: string;
  collections_suggestion?: string;
  image_alts?: string;
  reasoning?: string;
}

interface StoreConnectionOption {
  id: string;
  platform: "shopify";
  shop_domain: string | null;
  shop_name: string | null;
  scopes: string | null;
  created_at: string;
}

interface OptimizationResult {
  listing: ShopifyProduct;
  suggestions: Suggestions | null;
  score: number;
  status: "pending" | "optimizing" | "done" | "error" | "applied";
  error?: string;
}

function isUsableShopifyConnection(connection: {
  platform: string;
  shop_domain: string | null;
  scopes: string | null;
}): connection is StoreConnectionOption {
  return connection.platform === "shopify" && !!connection.shop_domain;
}

function getConnectionLabel(connection: StoreConnectionOption) {
  return connection.shop_name || connection.shop_domain || "Shopify store";
}

/**
 * ABSOLUTE BINARY SCORING ENGINE
 * 100/0 Binary Logic applied to Shopify Products.
 */
function scoreListing(product: ShopifyProduct): number {
  const title = (product.title || "").trim();
  const body = (product.body_html || "").replace(/<[^>]*>/g, "").trim();
  const tagList = product.tags ? product.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];

  const failures: string[] = [];

  // 1. Title Length Compliance
  if (title.length < 20) failures.push("Short Title");

  // 2. Tag Density Compliance (aim for at least 5 tags for Shopify)
  if (tagList.length < 5) failures.push("Missing Tags");

  // 3. Content Depth
  if (body.length < 100) failures.push("Thin Content");

  // 4. Product Type
  if (!product.product_type) failures.push("Missing Product Type");

  // 5. Accessibility (Images)
  if (!product.images || product.images.length === 0) failures.push("No Images");

  return failures.length === 0 ? 100 : 0;
}

function getScoreColor(score: number) {
  return score === 100 ? "text-emerald-500" : "text-destructive";
}

function getScoreLabel(score: number) {
  return score === 100 ? "Compliant" : "Needs Work (0%)";
}

interface StoreSelectorProps {
  connections: StoreConnectionOption[];
  selectedConnectionId: string;
  onChange: (value: string) => void;
  activeStoreId: string | null;
}

function StoreSelector({ connections, selectedConnectionId, onChange }: StoreSelectorProps) {
  return (
    <Card className="bg-card/50 border-border/30">
      <CardContent className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">Active Shopify store</p>
          <p className="text-xs text-muted-foreground">
            Bulk Optimizer locked to binary compliance mode.
          </p>
        </div>
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm min-w-[220px]"
          value={selectedConnectionId}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Select a Shopify store</option>
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

  const [listings, setListings] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [connectionsReady, setConnectionsReady] = useState(false);
  const [storeConnections, setStoreConnections] = useState<StoreConnectionOption[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [results, setResults] = useState<Map<number, OptimizationResult>>(new Map());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [applyingIds, setApplyingIds] = useState<Set<number>>(new Set());
  const [nextPageInfoCursor, setNextPageInfoCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [doneIds, setDoneIds] = useState<Set<number>>(new Set());

  const scopedConnections = useMemo(() => {
    if (!activeStoreId) return storeConnections;
    return storeConnections.filter(
      (connection) => connection.id === activeStoreId || connection.shop_domain === activeStoreId,
    );
  }, [activeStoreId, storeConnections]);

  const resetAnalyzerState = () => {
    setListings([]);
    setSelected(new Set());
    setResults(new Map());
    setNextPageInfoCursor(null);
    setHasMore(false);
  };

  useEffect(() => {
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setConnectionsReady(true);
        return;
      }
      const { data } = await supabase
        .from("store_connections")
        .select("id, platform, shop_domain, shop_name, scopes, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      const rows = ((data || []) as StoreConnectionOption[]).filter(isUsableShopifyConnection);
      setStoreConnections(rows);
      setConnectionsReady(true);
    })();
  }, []);

  useEffect(() => {
    if (scopedConnections.some((connection) => connection.id === selectedConnectionId)) return;
    const nextConnectionId = scopedConnections.length === 1 ? scopedConnections[0].id : "";
    setSelectedConnectionId(nextConnectionId);
    resetAnalyzerState();
  }, [scopedConnections, selectedConnectionId]);

  // Load persisted done IDs whenever the selected connection changes
  useEffect(() => {
    if (!selectedConnectionId) { setDoneIds(new Set()); return; }
    try {
      const raw = localStorage.getItem(`bulk-done-ids:${selectedConnectionId}`);
      setDoneIds(raw ? new Set<number>(JSON.parse(raw)) : new Set());
    } catch {
      setDoneIds(new Set());
    }
  }, [selectedConnectionId]);

  const fetchListings = async (cursor: string | null, append = false) => {
    if (!selectedConnectionId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-shopify-products", {
        body: { limit: 50, connectionId: selectedConnectionId, pageInfoCursor: cursor },
      });
      if (error) throw error;
      const incoming: ShopifyProduct[] = (data.products || []).filter(
        (p: ShopifyProduct) => !doneIds.has(p.id),
      );
      setListings((prev) => {
        if (!append) return incoming;
        const existingIds = new Set(prev.map((p) => p.id));
        return [...prev, ...incoming.filter((p) => !existingIds.has(p.id))];
      });
      if (!append) {
        setSelected(new Set());
        setResults(new Map());
      }
      const nextCursor: string | null = data.nextPageInfo ?? null;
      setNextPageInfoCursor(nextCursor);
      setHasMore(!!nextCursor);
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
    if (!selectedConnectionId) return;
    const selectedListings = listings.filter((listing) => selected.has(listing.id));
    if (selectedListings.length === 0) return;

    setBulkRunning(true);
    setProgress({ current: 0, total: selectedListings.length });

    const newResults = new Map<number, OptimizationResult>();
    for (const listing of selectedListings) {
      newResults.set(listing.id, {
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
      const result = newResults.get(listing.id);
      if (!result) continue;

      result.status = "optimizing";
      setResults(new Map(newResults));
      setProgress({ current: index, total: selectedListings.length });

      try {
        const { data, error } = await supabase.functions.invoke("optimize-shopify-listing", {
          body: { product: listing, connectionId: selectedConnectionId },
        });
        if (error) throw error;
        result.suggestions = data.suggestions;
        result.status = "done";
      } catch (err) {
        const error = err as Error;
        result.status = "error";
        result.error = error.message;
      }
      newResults.set(listing.id, { ...result });
      setResults(new Map(newResults));
    }
    setProgress({ current: selectedListings.length, total: selectedListings.length });
    setBulkRunning(false);
  };

  const applyOne = async (result: OptimizationResult) => {
    if (!result.suggestions || !selectedConnectionId) return;
    const id = result.listing.id;
    setApplyingIds((prev) => new Set(prev).add(id));
    try {
      const { error } = await supabase.functions.invoke("apply-shopify-changes", {
        body: {
          productId: id,
          connectionId: selectedConnectionId,
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
      // Persist so this product is never shown again in future sessions
      setDoneIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        try {
          localStorage.setItem(`bulk-done-ids:${selectedConnectionId}`, JSON.stringify(Array.from(next)));
        } catch { /* ignore quota errors */ }
        return next;
      });
      // Remove from listings immediately
      setListings((prev) => prev.filter((p) => p.id !== id));
      toast({ title: "Applied!", description: "Product updated on Shopify." });
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
          <Layers className="h-6 w-6 text-primary" /> Shopify Bulk Optimizer
        </h1>
        <p className="text-muted-foreground mt-1">Binary compliance mode. Select up to 5 products to optimize in batch.</p>
      </motion.div>

      <StoreSelector
        connections={scopedConnections}
        selectedConnectionId={selectedConnectionId}
        onChange={(value) => {
          setSelectedConnectionId(value);
          resetAnalyzerState();
        }}
        activeStoreId={activeStoreId}
      />

      {bulkRunning && (
        <Card className="bg-card/50 border-primary/20">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium flex items-center gap-2"><RefreshCw className="h-4 w-4 animate-spin" /> Batch Processing...</span>
              <span>{progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0}%</span>
            </div>
            <Progress value={progress.total > 0 ? (progress.current / progress.total) * 100 : 0} />
          </CardContent>
        </Card>
      )}

      {results.size > 0 && (
        <div className="space-y-3">
          {Array.from(results.values()).map((result) => (
            <Card key={result.listing.id} className={`bg-card/50 ${result.score === 100 ? 'border-emerald-500/30' : 'border-destructive/30'}`}>
              <CardContent className="p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-sm truncate max-w-[70%]">{result.listing.title}</p>
                  <Badge className={getScoreBadgeClass(result.score)}>{result.score}%</Badge>
                </div>
                {result.status === "optimizing" && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <RefreshCw className="h-3 w-3 animate-spin" /> Optimizing...
                  </p>
                )}
                {result.status === "error" && (
                  <p className="text-xs text-destructive">{result.error}</p>
                )}
                {result.status === "applied" && (
                  <p className="text-xs text-emerald-500">Applied to Shopify</p>
                )}
                {result.status === "done" && result.suggestions && (
                  <Button
                    size="sm"
                    className="gradient-phoenix w-full"
                    onClick={() => applyOne(result)}
                    disabled={applyingIds.has(result.listing.id)}
                  >
                    {applyingIds.has(result.listing.id) ? "Pushing..." : "Apply to Shopify"}
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card className="bg-card/50 border-border/30">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Product Inventory</CardTitle>
            <Button size="sm" variant="outline" onClick={() => void fetchListings(null, false)} disabled={!selectedConnectionId || loading}>
              <RefreshCw className={loading ? "animate-spin" : ""} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : listings.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              {selectedConnectionId ? "Click refresh to load products." : "Select a store to get started."}
            </p>
          ) : (
            <div className="space-y-1">
              {listings.map((listing) => {
                const score = scoreListing(listing);
                const isSelected = selected.has(listing.id);
                return (
                  <div
                    key={listing.id}
                    className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer ${isSelected ? 'bg-primary/10 border border-primary/20' : ''}`}
                    onClick={() => toggleSelect(listing.id)}
                  >
                    <Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(listing.id)} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{listing.title}</p>
                      <span className={`text-[10px] font-bold ${getScoreColor(score)}`}>{getScoreLabel(score)} {score}/100</span>
                    </div>
                  </div>
                );
              })}
              {hasMore && (
                <Button variant="outline" className="w-full mt-2" onClick={() => void fetchListings(nextPageInfoCursor, true)} disabled={loading}>
                  {loading ? "Loading..." : "Load More Products"}
                </Button>
              )}
              {selected.size > 0 && (
                <Button onClick={() => void runBulkOptimize()} className="w-full mt-4 gradient-phoenix" disabled={bulkRunning}>
                  {bulkRunning ? "Processing..." : `Optimize Batch (${selected.size})`}
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
