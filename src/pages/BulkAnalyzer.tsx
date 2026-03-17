import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  Layers, Sparkles, RefreshCw, Check, AlertCircle,
  Flower2, ChevronDown, ChevronUp, Undo2, ArrowRight,
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

interface OptimizationResult {
  listing: EtsyListing;
  suggestions: Suggestions | null;
  score: number;
  status: "pending" | "optimizing" | "done" | "error" | "applied";
  error?: string;
}

function scoreListing(listing: EtsyListing): number {
  let score = 0;
  // Title length (ideal 100-140 chars)
  const titleLen = listing.title?.length || 0;
  if (titleLen >= 100) score += 25;
  else if (titleLen >= 60) score += 15;
  else score += 5;
  // Tags count (ideal 13)
  const tagCount = listing.tags?.length || 0;
  score += Math.min(25, Math.round((tagCount / 13) * 25));
  // Description length
  const descLen = listing.description?.length || 0;
  if (descLen >= 500) score += 25;
  else if (descLen >= 200) score += 15;
  else if (descLen > 0) score += 5;
  // Materials
  const matCount = listing.materials?.length || 0;
  if (matCount >= 3) score += 25;
  else if (matCount >= 1) score += 15;
  else score += 0;
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

export default function BulkAnalyzerPage() {
  const { toast } = useToast();
  const [listings, setListings] = useState<EtsyListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasConnection, setHasConnection] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [results, setResults] = useState<Map<number, OptimizationResult>>(new Map());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [expandedResult, setExpandedResult] = useState<number | null>(null);
  const [applyingIds, setApplyingIds] = useState<Set<number>>(new Set());

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
    if (hasEtsy) fetchListings();
  };

  const fetchListings = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fetch-etsy-listings`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ limit: 100, offset: 0, state: "active" }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch listings");
      setListings(data.results || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to fetch";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 10) next.add(id);
      else toast({ title: "Limit reached", description: "Max 10 listings per batch.", variant: "destructive" });
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === Math.min(listings.length, 10)) {
      setSelected(new Set());
    } else {
      setSelected(new Set(listings.slice(0, 10).map(l => l.listing_id)));
    }
  };

  const runBulkOptimize = async () => {
    const selectedListings = listings.filter(l => selected.has(l.listing_id));
    if (selectedListings.length === 0) return;

    setBulkRunning(true);
    setProgress({ current: 0, total: selectedListings.length });

    const newResults = new Map<number, OptimizationResult>();

    // Initialize all as pending
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
    if (!session) { setBulkRunning(false); return; }

    // Process sequentially to avoid rate limits
    for (let i = 0; i < selectedListings.length; i++) {
      const listing = selectedListings[i];
      const result = newResults.get(listing.listing_id)!;
      result.status = "optimizing";
      setResults(new Map(newResults));
      setProgress({ current: i, total: selectedListings.length });

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
          }
        );

        if (res.status === 429) {
          // Rate limited — wait and retry once
          await new Promise(r => setTimeout(r, 5000));
          const retry = await fetch(
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

      // Small delay between requests
      if (i < selectedListings.length - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    setProgress({ current: selectedListings.length, total: selectedListings.length });
    setBulkRunning(false);
    toast({ title: "Bulk optimization complete", description: `${selectedListings.length} listings processed.` });
  };

  const applyOne = async (result: OptimizationResult) => {
    if (!result.suggestions) return;
    const id = result.listing.listing_id;
    setApplyingIds(prev => new Set(prev).add(id));

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/apply-etsy-changes`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            listingId: id,
            originalData: {
              title: result.listing.title,
              description: result.listing.description,
              tags: result.listing.tags,
              materials: result.listing.materials,
            },
            optimizedData: result.suggestions,
          }),
        }
      );

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to apply");

      setResults(prev => {
        const next = new Map(prev);
        const r = next.get(id)!;
        next.set(id, { ...r, status: "applied" });
        return next;
      });
      toast({ title: "Applied!", description: `"${result.listing.title.slice(0, 40)}…" updated on Etsy.` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Apply failed";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setApplyingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const applyAll = async () => {
    const doneResults = Array.from(results.values()).filter(r => r.status === "done" && r.suggestions);
    for (const result of doneResults) {
      await applyOne(result);
      await new Promise(r => setTimeout(r, 1000));
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
              Connect your Etsy shop in Settings to start bulk optimizing listings.
            </p>
            <Button onClick={() => window.location.href = "/settings"} className="bg-spring text-spring-foreground hover:bg-spring/90">
              Go to Settings
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const doneCount = Array.from(results.values()).filter(r => r.status === "done").length;
  const appliedCount = Array.from(results.values()).filter(r => r.status === "applied").length;
  const errorCount = Array.from(results.values()).filter(r => r.status === "error").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Layers className="h-6 w-6 text-primary" /> Bulk Optimizer
        </h1>
        <p className="text-muted-foreground mt-1">
          Select up to 10 listings for AI-powered batch optimization. Score, optimize, and apply in one go.
        </p>
      </motion.div>

      {/* Progress Bar (while running) */}
      {bulkRunning && (
        <Card className="bg-card/50 border-primary/20">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium flex items-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                Optimizing {progress.current + 1} of {progress.total}…
              </span>
              <span className="text-muted-foreground">
                {Math.round(((progress.current) / progress.total) * 100)}%
              </span>
            </div>
            <Progress value={(progress.current / progress.total) * 100} className="h-2" />
          </CardContent>
        </Card>
      )}

      {/* Results Summary */}
      {results.size > 0 && !bulkRunning && (
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
                {errorCount > 0 && (
                  <span className="flex items-center gap-1 text-destructive">
                    <XCircle className="h-4 w-4" /> {errorCount} failed
                  </span>
                )}
              </div>
              {doneCount > 0 && (
                <Button
                  onClick={async () => {
                    const allText = Array.from(results.values())
                      .filter(r => r.status === "done" && r.suggestions)
                      .map(r => {
                        return `=== ${r.listing.title} ===\n${copyAllFields([
                          { label: "Title", value: r.suggestions!.title },
                          { label: "Tags", value: r.suggestions!.tags.join(", ") },
                          { label: "Description", value: r.suggestions!.description },
                          { label: "Materials", value: r.suggestions!.materials.join(", ") },
                        ])}`;
                      }).join("\n\n========\n\n");
                    await navigator.clipboard.writeText(allText);
                    toast({ title: "All copied!", description: `${doneCount} listings' optimizations copied to clipboard.` });
                  }}
                  className="bg-spring text-spring-foreground hover:bg-spring/90"
                  size="sm"
                >
                  <Copy className="h-4 w-4 mr-1" />
                  Copy All ({doneCount})
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Optimization Results */}
      {results.size > 0 && (
        <div className="space-y-3">
          {Array.from(results.values()).map((result) => {
            const isExpanded = expandedResult === result.listing.listing_id;
            const imgUrl = result.listing.images?.[0]?.url_170x135;
            return (
              <motion.div key={result.listing.listing_id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <Card className={`bg-card/50 border-border/30 ${result.status === "applied" ? "border-spring/40" : ""}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      {imgUrl && <img src={imgUrl} alt="" className="h-12 w-12 rounded-md object-cover shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium text-sm truncate">{result.listing.title}</p>
                          <div className="flex items-center gap-2 shrink-0">
                            <Badge variant="outline" className={`text-xs ${getScoreColor(result.score)}`}>
                              {getScoreLabel(result.score)} {result.score}/100
                            </Badge>
                            {result.status === "optimizing" && (
                              <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                            )}
                            {result.status === "done" && (
                              <Check className="h-4 w-4 text-emerald-500" />
                            )}
                            {result.status === "applied" && (
                              <Badge className="bg-spring/10 text-spring text-xs">Applied</Badge>
                            )}
                            {result.status === "error" && (
                              <Badge variant="destructive" className="text-xs">Error</Badge>
                            )}
                          </div>
                        </div>

                        {result.error && (
                          <p className="text-xs text-destructive mt-1">{result.error}</p>
                        )}

                        {result.suggestions && (
                          <>
                            <button
                              onClick={() => setExpandedResult(isExpanded ? null : result.listing.listing_id)}
                              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mt-2"
                            >
                              {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                              {isExpanded ? "Hide" : "View"} suggestions
                            </button>

                            <AnimatePresence>
                              {isExpanded && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: "auto", opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  className="overflow-hidden"
                                >
                                  <div className="mt-3 space-y-3">
                                    {/* Reasoning */}
                                    <p className="text-xs text-muted-foreground italic">
                                      {result.suggestions.reasoning}
                                    </p>

                                    {/* Title */}
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

                                    {/* Tags */}
                                    <div className="grid gap-2 sm:grid-cols-2">
                                      <div className="p-2 rounded bg-muted/30 border border-border/20">
                                        <p className="text-[10px] text-muted-foreground mb-1">Current Tags ({result.listing.tags?.length || 0})</p>
                                        <div className="flex flex-wrap gap-1">
                                          {result.listing.tags?.map(t => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
                                        </div>
                                      </div>
                                      <div className="p-2 rounded bg-spring/5 border border-spring/20">
                                        <p className="text-[10px] text-spring mb-1">Optimized Tags ({result.suggestions.tags.length})</p>
                                        <div className="flex flex-wrap gap-1">
                                          {result.suggestions.tags.map(t => <Badge key={t} className="text-[10px] bg-spring/10 text-spring border-spring/20">{t}</Badge>)}
                                        </div>
                                      </div>
                                    </div>

                                    {/* Copy button */}
                                    {result.status === "done" && result.suggestions && (
                                      <div className="flex gap-2 pt-1">
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
                                            toast({ title: "Copied!", description: `"${result.listing.title.slice(0, 40)}…" optimizations copied.` });
                                            setResults(prev => {
                                              const next = new Map(prev);
                                              const r = next.get(result.listing.listing_id)!;
                                              next.set(result.listing.listing_id, { ...r, status: "applied" });
                                              return next;
                                            });
                                          }}
                                          className="bg-spring text-spring-foreground hover:bg-spring/90"
                                        >
                                          <Copy className="h-3 w-3 mr-1" /> Copy All Fields
                                        </Button>
                                        <CopyButton text={result.suggestions!.title} label="Title" />
                                        <CopyButton text={result.suggestions!.tags.join(", ")} label="Tags" />
                                      </div>
                                    )}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Listing Selection */}
      <Card className="bg-card/50 border-border/30">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              Active Listings
              {!loading && <Badge variant="outline" className="ml-1">{listings.length}</Badge>}
            </CardTitle>
            <div className="flex gap-2">
              {listings.length > 0 && (
                <Button size="sm" variant="outline" onClick={selectAll}>
                  {selected.size === Math.min(listings.length, 10) ? "Deselect All" : "Select All (10)"}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={fetchListings} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-14 rounded-lg" />)}
            </div>
          ) : listings.length === 0 ? (
            <div className="text-center py-8">
              <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-muted-foreground">No active listings found.</p>
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
                      {imgUrl && <img src={imgUrl} alt="" className="h-10 w-10 rounded object-cover shrink-0" />}
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

              {selected.size > 0 && (
                <div className="flex items-center justify-between pt-4 border-t border-border/20 mt-4">
                  <p className="text-sm text-muted-foreground">
                    {selected.size} listing{selected.size !== 1 ? "s" : ""} selected
                  </p>
                  <Button
                    onClick={runBulkOptimize}
                    disabled={bulkRunning}
                    className="bg-spring text-spring-foreground hover:bg-spring/90"
                  >
                    {bulkRunning ? (
                      <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Optimizing…</>
                    ) : (
                      <><Sparkles className="h-4 w-4 mr-2" /> Optimize {selected.size} Listings</>
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <ArrowRight className="h-3 w-3" />
        Applied changes are saved with snapshots. Undo anytime from the Listing Optimizer.
      </p>
    </div>
  );
}
