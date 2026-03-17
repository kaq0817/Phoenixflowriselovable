import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  Sparkles, Undo2, Check, RefreshCw, Tag, FileText,
  ChevronDown, ChevronUp, Flower2, ArrowRight, AlertCircle, Copy
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

interface SnapshotRecord {
  id: string;
  etsy_listing_id: number;
  snapshot_data: Record<string, unknown>;
  created_at: string;
}

export default function EtsyOptimizer() {
  const { toast } = useToast();
  const [listings, setListings] = useState<EtsyListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasConnection, setHasConnection] = useState<boolean | null>(null);
  const [selectedListing, setSelectedListing] = useState<EtsyListing | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([]);
  const [expandedListing, setExpandedListing] = useState<number | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);

  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("store_connections")
      .select("id")
      .eq("user_id", user.id)
      .eq("platform", "etsy")
      .order("created_at", { ascending: false })
      .limit(1);

    const hasEtsy = !!data && data.length > 0;
    setHasConnection(hasEtsy);
    if (hasEtsy) {
      fetchListings();
      fetchSnapshots();
    }
  };

  const fetchListings = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // Get the latest connected Etsy shop (supports multi-store accounts)
      const { data: connRows } = await supabase
        .from("store_connections")
        .select("shop_domain, shop_name")
        .eq("user_id", session.user.id)
        .eq("platform", "etsy")
        .order("created_at", { ascending: false })
        .limit(1);

      const conn = connRows?.[0];
      if (!conn?.shop_domain && !conn?.shop_name) {
        toast({ title: "Error", description: "No Etsy shop connected", variant: "destructive" });
        return;
      }

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fetch-etsy-public-listings`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ shopName: conn.shop_name || conn.shop_domain, limit: 25, offset: 0 }),
        }
      );

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch listings");
      setListings(data.results || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to fetch listings";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const fetchSnapshots = async () => {
    const { data } = await supabase
      .from("listing_snapshots")
      .select("id, etsy_listing_id, snapshot_data, created_at")
      .order("created_at", { ascending: false });
    if (data) setSnapshots(data as SnapshotRecord[]);
  };

  const handleOptimize = async (listing: EtsyListing) => {
    setSelectedListing(listing);
    setSuggestions(null);
    setOptimizing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/optimize-etsy-listing`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ listing }),
        }
      );

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Optimization failed");
      setSuggestions(data.suggestions);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Optimization failed";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setOptimizing(false);
    }
  };

  const handleApply = async () => {
    if (!selectedListing || !suggestions) return;
    setApplying(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const originalData = {
        title: selectedListing.title,
        description: selectedListing.description,
        tags: selectedListing.tags,
        materials: selectedListing.materials,
      };

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/apply-etsy-changes`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            listingId: selectedListing.listing_id,
            originalData,
            optimizedData: suggestions,
          }),
        }
      );

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to apply");

      toast({ title: "Applied!", description: "Listing updated on Etsy. Snapshot saved for undo." });
      setSuggestions(null);
      setSelectedListing(null);
      fetchListings();
      fetchSnapshots();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Apply failed";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setApplying(false);
    }
  };

  const handleUndo = async (snapshotId: string) => {
    setUndoing(snapshotId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/undo-etsy-changes`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ snapshotId }),
        }
      );

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Undo failed");

      toast({ title: "Reverted!", description: "Listing restored to original state." });
      fetchListings();
      fetchSnapshots();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Undo failed";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setUndoing(null);
    }
  };

  if (hasConnection === null) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!hasConnection) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="bg-card/50 border-spring/30 max-w-md">
          <CardContent className="p-8 text-center space-y-4">
            <Flower2 className="h-12 w-12 text-spring mx-auto" />
            <h2 className="text-xl font-bold">Connect Your Shop</h2>
            <p className="text-muted-foreground text-sm">
              Connect your shop in Settings to start optimizing your listings with AI.
            </p>
            <Button
              onClick={() => window.location.href = "/settings"}
              className="bg-spring text-spring-foreground hover:bg-spring/90"
            >
              Go to Settings
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Flower2 className="h-6 w-6 text-spring" /> Listing Optimizer
        </h1>
        <p className="text-muted-foreground mt-1">
          AI-powered optimization for your shop listings. Read → Suggest → Apply → Undo.
        </p>
      </motion.div>

      {/* Snapshots / Undo History */}
      {snapshots.length > 0 && (
        <Card className="border-spring/20 bg-card/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-spring">
              <Undo2 className="h-4 w-4" /> Recent Changes (Undo Available)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {snapshots.slice(0, 5).map((snap) => (
              <div key={snap.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/20 border border-border/20">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {(snap.snapshot_data as Record<string, unknown>).title as string || `Listing #${snap.etsy_listing_id}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(snap.created_at).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-spring/30 text-spring hover:bg-spring/10 ml-2"
                  disabled={undoing === snap.id}
                  onClick={() => handleUndo(snap.id)}
                >
                  {undoing === snap.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
                  <span className="ml-1">Undo</span>
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Listings Grid */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Active Listings</h2>
        <Button size="sm" variant="outline" onClick={fetchListings} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-48 rounded-lg" />
          ))}
        </div>
      ) : listings.length === 0 ? (
        <Card className="bg-card/50 border-border/30">
          <CardContent className="p-8 text-center">
            <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground">No active listings found.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {listings.map((listing) => {
            const imgUrl = listing.images?.[0]?.url_170x135;
            const isExpanded = expandedListing === listing.listing_id;
            return (
              <motion.div key={listing.listing_id} layout>
                <Card className="bg-card/50 border-border/30 hover:border-spring/30 transition-colors overflow-hidden">
                  <CardContent className="p-4">
                    <div className="flex gap-3">
                      {imgUrl && (
                        <img src={imgUrl} alt="" className="h-16 w-16 rounded-md object-cover flex-shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate">{listing.title}</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {listing.tags?.slice(0, 3).map((t) => (
                            <Badge key={t} variant="secondary" className="text-[10px] px-1.5 py-0">
                              {t}
                            </Badge>
                          ))}
                          {(listing.tags?.length || 0) > 3 && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                              +{listing.tags.length - 3}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => setExpandedListing(isExpanded ? null : listing.listing_id)}
                      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mt-2"
                    >
                      {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      {isExpanded ? "Less" : "Details"}
                    </button>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <p className="text-xs text-muted-foreground mt-2 line-clamp-4">
                            {listing.description}
                          </p>
                          {listing.materials?.length > 0 && (
                            <p className="text-xs text-muted-foreground mt-1">
                              <span className="font-medium">Materials:</span> {listing.materials.join(", ")}
                            </p>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <Button
                      size="sm"
                      className="w-full mt-3 bg-spring text-spring-foreground hover:bg-spring/90"
                      onClick={() => handleOptimize(listing)}
                      disabled={optimizing && selectedListing?.listing_id === listing.listing_id}
                    >
                      {optimizing && selectedListing?.listing_id === listing.listing_id ? (
                        <>
                          <RefreshCw className="h-3 w-3 mr-1 animate-spin" /> Optimizing…
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-3 w-3 mr-1" /> Optimize
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Suggestions Panel */}
      <AnimatePresence>
        {selectedListing && suggestions && (
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 30 }}
          >
            <Card className="border-spring/40 bg-card/60">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-spring" />
                  AI Suggestions
                </CardTitle>
                <p className="text-xs text-muted-foreground">{suggestions.reasoning}</p>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Title comparison */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-1">
                    <FileText className="h-3 w-3" /> Title
                  </h4>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="p-3 rounded-lg bg-muted/30 border border-border/20">
                      <p className="text-[10px] text-muted-foreground mb-1">Current</p>
                      <p className="text-sm">{selectedListing.title}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-spring/5 border border-spring/20">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[10px] text-spring">Optimized</p>
                        <CopyButton text={suggestions.title} label="Title" size="sm" variant="ghost" className="h-6 px-2 text-[10px]" />
                      </div>
                      <p className="text-sm">{suggestions.title}</p>
                    </div>
                  </div>
                </div>

                {/* Tags comparison */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-1">
                    <Tag className="h-3 w-3" /> Tags
                  </h4>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="p-3 rounded-lg bg-muted/30 border border-border/20">
                      <p className="text-[10px] text-muted-foreground mb-1">Current ({selectedListing.tags?.length || 0})</p>
                      <div className="flex flex-wrap gap-1">
                        {selectedListing.tags?.map((t) => (
                          <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
                        ))}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-spring/5 border border-spring/20">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[10px] text-spring">Optimized ({suggestions.tags.length})</p>
                        <CopyButton text={suggestions.tags.join(", ")} label="Tags" size="sm" variant="ghost" className="h-6 px-2 text-[10px]" />
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {suggestions.tags.map((t) => (
                          <Badge key={t} className="text-[10px] bg-spring/10 text-spring border-spring/20">{t}</Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Description comparison */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-1">
                    <FileText className="h-3 w-3" /> Description
                  </h4>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="p-3 rounded-lg bg-muted/30 border border-border/20 max-h-40 overflow-y-auto">
                      <p className="text-[10px] text-muted-foreground mb-1">Current</p>
                      <p className="text-xs whitespace-pre-wrap">{selectedListing.description?.slice(0, 500)}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-spring/5 border border-spring/20 max-h-40 overflow-y-auto">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[10px] text-spring">Optimized</p>
                        <CopyButton text={suggestions.description || ""} label="Description" size="sm" variant="ghost" className="h-6 px-2 text-[10px]" />
                      </div>
                      <p className="text-xs whitespace-pre-wrap">{suggestions.description?.slice(0, 500)}</p>
                    </div>
                  </div>
                </div>

                {/* Materials */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground">Materials</h4>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="p-3 rounded-lg bg-muted/30 border border-border/20">
                      <p className="text-[10px] text-muted-foreground mb-1">Current</p>
                      <p className="text-xs">{selectedListing.materials?.join(", ") || "None"}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-spring/5 border border-spring/20">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[10px] text-spring">Optimized</p>
                        <CopyButton text={suggestions.materials.join(", ")} label="Materials" size="sm" variant="ghost" className="h-6 px-2 text-[10px]" />
                      </div>
                      <p className="text-xs">{suggestions.materials.join(", ")}</p>
                    </div>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex gap-3 pt-2">
                  <Button
                    onClick={async () => {
                      const text = copyAllFields([
                        { label: "Title", value: suggestions.title },
                        { label: "Tags", value: suggestions.tags.join(", ") },
                        { label: "Description", value: suggestions.description },
                        { label: "Materials", value: suggestions.materials.join(", ") },
                      ]);
                      await navigator.clipboard.writeText(text);
                      toast({ title: "All copied!", description: "Paste the optimized content into your Etsy listing." });
                    }}
                    className="flex-1 bg-spring text-spring-foreground hover:bg-spring/90"
                  >
                    <Copy className="h-4 w-4 mr-2" /> Copy All Changes
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => { setSelectedListing(null); setSuggestions(null); }}
                    className="border-border/30"
                  >
                    Dismiss
                  </Button>
                </div>

                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <ArrowRight className="h-3 w-3" />
                  Copy the optimized content and paste it into your Etsy listing editor.
                </p>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
