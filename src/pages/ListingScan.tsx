import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  Scan, AlertTriangle, CheckCircle2, Info, ChevronDown, ChevronUp,
  Loader2, Zap, TrendingUp, SpellCheck, Tag, FileText, Clock,
  Download, ShoppingBag, Store,
} from "lucide-react";
import { exportListingScanPdf, exportListingScanCsv } from "@/lib/reportExports";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";


interface KeywordResearchItem {
  keyword: string;
  searchVolume: number | string;
  trending?: boolean;
  tiktokTrend?: boolean;
  source?: "tiktok_api" | "serpapi";
}

interface Finding {
  type: string;
  severity: "critical" | "warning" | "info";
  field: string;
  message: string;
  data?: KeywordResearchItem[];
}

interface ListingResult {
  listing_id: number;
  title: string;
  image: string | null;
  findings: Finding[];
}

interface ScanSummary {
  total_listings_scanned?: number;
  listings_with_issues?: number;
  warning_count?: number;
  critical_count?: number;
}

type Platform = "etsy" | "shopify";

interface ScanJob {
  id: string;
  status: string;
  total_items: number;
  processed_items: number;
  findings: ListingResult[] | null;
  summary: ScanSummary | null;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
  platform: string;
  store_connection_id: string | null;
}

interface StoreConnectionOption {
  id: string;
  platform: Platform;
  shop_domain: string | null;
  shop_name: string | null;
  scopes: string | null;
  created_at: string;
}

const SEVERITY_CONFIG = {
  critical: { icon: AlertTriangle, color: "text-destructive", bg: "bg-destructive/10", border: "border-destructive/30", label: "Critical" },
  warning: { icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30", label: "Warning" },
  info: { icon: Info, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/30", label: "Info" },
};

const FINDING_ICONS: Record<string, typeof SpellCheck> = {
  spelling: SpellCheck,
  duplicate_keywords: Tag,
  missing_tags: Tag,
  low_volume_keywords: TrendingUp,
  tiktok_trending: TrendingUp,
  keyword_research: Zap,
  short_description: FileText,
};

function getKeywordResearchItems(listing: ListingResult): KeywordResearchItem[] {
  return listing.findings
    .filter((finding) => finding.type === "keyword_research" && finding.data)
    .flatMap((finding) => finding.data ?? []);
}

function getTikTokSummary(findings: ListingResult[]) {
  const listingsWithTikTokSignals = findings.filter((listing) =>
    getKeywordResearchItems(listing).some((item) => item.tiktokTrend)
  ).length;

  const keywordItems = findings.flatMap((listing) => getKeywordResearchItems(listing));
  const uniqueTikTokKeywords = new Set(
    keywordItems
      .filter((item) => item.tiktokTrend)
      .map((item) => item.keyword.toLowerCase())
  ).size;

  const apiBackedKeywords = new Set(
    keywordItems
      .filter((item) => item.source === "tiktok_api")
      .map((item) => item.keyword.toLowerCase())
  ).size;

  return {
    listingsWithTikTokSignals,
    uniqueTikTokKeywords,
    apiBackedKeywords,
  };
}

function sortKeywordResearchItems(items: KeywordResearchItem[]): KeywordResearchItem[] {
  return [...items].sort((left, right) => {
    const leftScore = (left.source === "tiktok_api" ? 4 : 0) + (left.tiktokTrend ? 2 : 0) + (left.trending ? 1 : 0);
    const rightScore = (right.source === "tiktok_api" ? 4 : 0) + (right.tiktokTrend ? 2 : 0) + (right.trending ? 1 : 0);
    return rightScore - leftScore || String(left.keyword).localeCompare(String(right.keyword));
  });
}

function getKeywordSourceLabel(source?: KeywordResearchItem["source"]): string | null {
  if (source === "tiktok_api") return "TikTok API";
  if (source === "serpapi") return "Web Signal";
  return null;
}

export default function ListingScanPage() {
  const { toast } = useToast();
  const [scanning, setScanning] = useState(false);
  const [currentJob, setCurrentJob] = useState<ScanJob | null>(null);
  const [pastJobs, setPastJobs] = useState<ScanJob[]>([]);
  const [expandedListing, setExpandedListing] = useState<number | null>(null);
  const [storeConnections, setStoreConnections] = useState<StoreConnectionOption[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [platform, setPlatform] = useState<Platform>("etsy");
  const [loading, setLoading] = useState(true);

  const fetchPastJobs = useCallback(async () => {
    const { data } = await supabase
      .from("scan_jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);
    if (data) setPastJobs(data as unknown as ScanJob[]);
  }, []);

  const fetchConnections = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("store_connections")
      .select("id, platform, shop_domain, shop_name, scopes, created_at")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false });

    const allRows = (data || []) as StoreConnectionOption[];
    const rows = allRows.filter((c) => c.platform === "shopify" || isUsableEtsyConnection(c));
    setStoreConnections(rows);

    const hasShopify = rows.some((c) => c.platform === "shopify");
    const hasEtsy = rows.some((c) => c.platform === "etsy");

    const firstShopify = rows.find((c) => c.platform === "shopify");
    const firstEtsy = rows.find((c) => c.platform === "etsy");

    if (!hasShopify && hasEtsy) {
      setPlatform("etsy");
      setSelectedConnectionId(firstEtsy?.id || "");
    } else {
      setSelectedConnectionId(firstShopify?.id || "");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchConnections();
    fetchPastJobs();
  }, [fetchConnections, fetchPastJobs]);

  // Realtime subscription for live progress
  useEffect(() => {
    if (!currentJob || currentJob.status === "completed" || currentJob.status === "failed") return;

    const channel = supabase
      .channel(`scan-${currentJob.id}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "scan_jobs",
        filter: `id=eq.${currentJob.id}`,
      }, (payload) => {
        const updated = payload.new as Partial<ScanJob>;
        setCurrentJob(prev => prev ? { ...prev, ...updated } : null);
        if (updated.status === "completed") {
          setScanning(false);
          toast({ title: "Scan Complete", description: `Found issues in ${updated.summary?.listings_with_issues || 0} listings.` });
          fetchPastJobs();
        } else if (updated.status === "failed") {
          setScanning(false);
          toast({ title: "Scan Failed", description: updated.error_message || "An error occurred.", variant: "destructive" });
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [currentJob, toast, fetchPastJobs]);

  function isUsableEtsyConnection(connection: StoreConnectionOption): boolean {
    return connection.platform === "etsy" && !!connection.shop_domain && !!connection.scopes?.includes("shops_r");
  }

  async function startScan() {
    setScanning(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      if (!selectedConnectionId) throw new Error("No store selected");

      // Create the job record
      const { data: job, error } = await supabase
        .from("scan_jobs")
        .insert({ user_id: session.user.id, status: "pending", platform: platform, store_connection_id: selectedConnectionId })
        .select()
        .single();

      if (error || !job) throw new Error("Failed to create scan job");
      setCurrentJob(job as unknown as ScanJob);

      // Fire and forget â€” the edge function runs autonomously
      const res = await fetch(
        `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/run-listing-scan`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ scanJobId: job.id, connectionId: selectedConnectionId }),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Scan failed to start");
      }
    } catch (error: unknown) {
      setScanning(false);
      const message = error instanceof Error ? error.message : "Scan failed to start";
      toast({ title: "Error", description: message, variant: "destructive" });
    }
  }

  function loadPastJob(job: ScanJob) {
    setCurrentJob(job);
  }

  const progressPercent = currentJob && currentJob.total_items > 0
    ? Math.round((currentJob.processed_items / currentJob.total_items) * 100)
    : 0;

  const currentFindings = currentJob?.findings as ListingResult[] | null;
  const tiktokSummary = currentFindings ? getTikTokSummary(currentFindings) : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const shopifyStoreOptions = storeConnections.filter((c) => c.platform === "shopify");
  const etsyStoreOptions = storeConnections.filter((c) => c.platform === "etsy");
  const noConnections = storeConnections.length === 0;

  const handlePlatformChange = (newPlatform: string) => {
    const p = newPlatform as Platform;
    setPlatform(p);
    setCurrentJob(null); // Reset job view when switching platforms
    if (p === "shopify") {
      setSelectedConnectionId(shopifyStoreOptions[0]?.id || "");
    } else {
      setSelectedConnectionId(etsyStoreOptions[0]?.id || "");
    }
  };


  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10"><Scan className="h-6 w-6 text-primary" /></div>
          Product Scanner
        </h1>
        <p className="text-muted-foreground mt-1">
          Product opportunity scan for keyword quality, seasonality, and search/trend signals. Separate from Google Merchant Center compliance.
        </p>
      </motion.div>

      {noConnections ? (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
            <span className="text-sm">Connect your Etsy or Shopify store in <strong>Settings</strong> to scan listings.</span>
          </CardContent>
        </Card>
      ) : (
        <Tabs value={platform} onValueChange={handlePlatformChange}>
          <TabsList>
            {shopifyStoreOptions.length > 0 && <TabsTrigger value="shopify" className="flex items-center gap-2"><ShoppingBag className="h-4 w-4" /> Shopify</TabsTrigger>}
            {etsyStoreOptions.length > 0 && <TabsTrigger value="etsy" className="flex items-center gap-2"><Store className="h-4 w-4" /> Etsy</TabsTrigger>}
          </TabsList>
          <AnimatePresence mode="wait">
            <motion.div key={platform} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <TabsContent value={platform} className="mt-4 space-y-4">
                <Card>
                  <CardContent className="p-6 flex items-center justify-between flex-wrap gap-4">
                    <div className="flex-1 min-w-[250px]">
                      <h3 className="font-semibold text-lg">Run Background Scan</h3>
                      <p className="text-sm text-muted-foreground">
                        Scan active listings for SEO, keywords, and trend signals. We'll email you a link to the results.
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <select
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm min-w-[150px]"
                        value={selectedConnectionId}
                        onChange={(e) => setSelectedConnectionId(e.target.value)}
                      >
                        {(platform === 'shopify' ? shopifyStoreOptions : etsyStoreOptions).map((connection) => (
                          <option key={connection.id} value={connection.id}>
                            {connection.shop_name || connection.shop_domain || `${platform} store`}
                          </option>
                        ))}
                      </select>
                      <Button
                        onClick={startScan}
                        disabled={scanning || !selectedConnectionId}
                        size="lg"
                        className="gap-2"
                      >
                        {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scan className="h-4 w-4" />}
                        {scanning ? "Scanning..." : "Start Scan"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Live Progress */}
                <AnimatePresence>
                  {currentJob && currentJob.store_connection_id === selectedConnectionId && (currentJob.status === "pending" || currentJob.status === "processing") && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                      <Card className="border-primary/30">
                        <CardContent className="p-6 space-y-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Loader2 className="h-4 w-4 animate-spin text-primary" />
                              <span className="font-medium">Scanning in progress...</span>
                            </div>
                            <span className="text-sm text-muted-foreground">
                              {currentJob.processed_items} / {currentJob.total_items || "?"} listings
                            </span>
                          </div>
                          <Progress value={progressPercent} className="h-2" />
                          <p className="text-xs text-muted-foreground">
                            You can leave this page. We'll email you when it's done.
                          </p>
                        </CardContent>
                      </Card>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Results */}
                {currentJob && currentJob.store_connection_id === selectedConnectionId && currentJob.status === "completed" && currentJob.findings && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                    {/* Summary cards + download */}
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <h3 className="font-semibold">Product Opportunity Results</h3>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => exportListingScanPdf(currentJob.findings as ListingResult[], currentJob.summary)}>
                          <Download className="h-3.5 w-3.5 mr-1.5" /> PDF
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => exportListingScanCsv(currentJob.findings as ListingResult[], currentJob.summary)}>
                          <Download className="h-3.5 w-3.5 mr-1.5" /> CSV
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                      <Card>
                        <CardContent className="p-4 text-center">
                          <div className="text-2xl font-bold">{currentJob.summary?.total_listings_scanned || 0}</div>
                          <div className="text-xs text-muted-foreground">Scanned</div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4 text-center">
                          <div className="text-2xl font-bold text-destructive">{currentJob.summary?.listings_with_issues || 0}</div>
                          <div className="text-xs text-muted-foreground">With Issues</div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4 text-center">
                          <div className="text-2xl font-bold text-amber-400">{currentJob.summary?.warning_count || 0}</div>
                          <div className="text-xs text-muted-foreground">Warnings</div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4 text-center">
                          <div className="text-2xl font-bold text-destructive">{currentJob.summary?.critical_count || 0}</div>
                          <div className="text-xs text-muted-foreground">Critical</div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4 text-center">
                          <div className="text-2xl font-bold text-pink-400">{tiktokSummary?.listingsWithTikTokSignals || 0}</div>
                          <div className="text-xs text-muted-foreground">TikTok Signals</div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4 text-center">
                          <div className="text-2xl font-bold text-primary">{tiktokSummary?.apiBackedKeywords || 0}</div>
                          <div className="text-xs text-muted-foreground">TikTok API Keywords</div>
                        </CardContent>
                      </Card>
                    </div>

                    {tiktokSummary && tiktokSummary.uniqueTikTokKeywords > 0 && (
                      <Card className="border-primary/20 bg-primary/5">
                        <CardContent className="p-4 sm:p-5">
                          <div className="flex items-start gap-3">
                            <div className="rounded-xl bg-primary/10 p-2">
                              <TrendingUp className="h-5 w-5 text-primary" />
                            </div>
                            <div className="space-y-1">
                              <h4 className="font-semibold">TikTok Trend Findings Ready To Demo</h4>
                              <p className="text-sm text-muted-foreground">
                                This scan found {tiktokSummary.uniqueTikTokKeywords} TikTok-backed keyword signals across {tiktokSummary.listingsWithTikTokSignals} listings. Reviewers can see the exact phrases inside each expanded listing row below.
                              </p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {/* Listing findings */}
                    <div className="space-y-3">
                      {(currentJob.findings as ListingResult[]).map((listing) => (
                        <Card key={listing.listing_id} className="overflow-hidden">
                          <button
                            className="w-full p-4 flex items-center gap-3 text-left hover:bg-muted/30 transition-colors"
                            onClick={() => setExpandedListing(expandedListing === listing.listing_id ? null : listing.listing_id)}
                          >
                            {listing.image && (
                              <img src={listing.image} alt="" className="h-10 w-10 rounded object-cover" />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate">{listing.title}</div>
                              <div className="flex gap-1 mt-1">
                                {listing.findings.some(f => f.severity === "critical") && (
                                  <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Critical</Badge>
                                )}
                                {listing.findings.some(f => f.severity === "warning") && (
                                  <Badge className="bg-amber-500/20 text-amber-400 text-[10px] px-1.5 py-0">Warning</Badge>
                                )}
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                  {listing.findings.length} issues
                                </Badge>
                              </div>
                            </div>
                            {expandedListing === listing.listing_id ? (
                              <ChevronUp className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            )}
                          </button>

                          <AnimatePresence>
                            {expandedListing === listing.listing_id && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="border-t border-border/50"
                              >
                                <div className="p-4 space-y-2">
                                  {listing.findings
                                    .filter(f => f.type !== "keyword_research")
                                    .map((finding, i) => {
                                      const config = SEVERITY_CONFIG[finding.severity];
                                      const Icon = FINDING_ICONS[finding.type] || config.icon;
                                      return (
                                        <div key={i} className={`flex items-start gap-2 p-3 rounded-lg ${config.bg} border ${config.border}`}>
                                          <Icon className={`h-4 w-4 mt-0.5 ${config.color}`} />
                                          <span className="text-sm">{finding.message}</span>
                                        </div>
                                      );
                                    })}

                                  {/* Keyword research data */}
                                  {listing.findings
                                    .filter(f => f.type === "keyword_research" && f.data)
                                    .map((finding, i) => {
                                      const sortedKeywords = sortKeywordResearchItems(finding.data ?? []);
                                      const tiktokKeywords = sortedKeywords.filter((kw) => kw.tiktokTrend);

                                      return (
                                        <div key={`kw-${i}`} className="mt-3 space-y-3">
                                          {tiktokKeywords.length > 0 && (
                                            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
                                              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary">TikTok Findings</h4>
                                              <div className="flex flex-wrap gap-2">
                                                {tiktokKeywords.map((kw, j) => (
                                                  <div key={`tt-${j}`} className="rounded-full border border-pink-500/30 bg-pink-500/10 px-3 py-1 text-xs text-pink-300">
                                                    {kw.keyword}
                                                  </div>
                                                ))}
                                              </div>
                                            </div>
                                          )}

                                          <div>
                                            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Keyword Research</h4>
                                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                              {sortedKeywords.map((kw: KeywordResearchItem, j: number) => {
                                                const sourceLabel = getKeywordSourceLabel(kw.source);
                                                return (
                                                  <div key={j} className="rounded-lg border border-border/50 bg-muted/30 p-3 text-sm">
                                                    <div className="mb-2 font-medium truncate">{kw.keyword}</div>
                                                    <div className="flex flex-wrap gap-1.5 items-center">
                                                      <Badge variant="outline" className="text-[10px] px-1.5">
                                                        {kw.searchVolume}
                                                      </Badge>
                                                      {kw.trending && (
                                                        <Badge className="bg-primary/15 text-primary text-[10px] px-1.5">Trending</Badge>
                                                      )}
                                                      {kw.tiktokTrend && (
                                                        <Badge className="bg-pink-500/20 text-pink-400 text-[10px] px-1.5">TikTok</Badge>
                                                      )}
                                                      {sourceLabel && (
                                                        <Badge variant="secondary" className="text-[10px] px-1.5">
                                                          {sourceLabel}
                                                        </Badge>
                                                      )}
                                                    </div>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </Card>
                      ))}
                    </div>
                  </motion.div>
                )}

                {/* Error state */}
                {currentJob && currentJob.store_connection_id === selectedConnectionId && currentJob.status === "failed" && (
                  <Card className="border-destructive/30 bg-destructive/5">
                    <CardContent className="p-6 text-center space-y-2">
                      <AlertTriangle className="h-8 w-8 text-destructive mx-auto" />
                      <p className="font-medium">Scan Failed</p>
                      <p className="text-sm text-muted-foreground">{currentJob.error_message || "An unknown error occurred."}</p>
                      <Button variant="outline" onClick={startScan} className="mt-2">Retry</Button>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
            </motion.div>
          </AnimatePresence>
        </Tabs>
      )}


      {/* Past Scans */}
      {pastJobs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock className="h-4 w-4" /> Scan History
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pastJobs.map((job) => (
              <button
                key={job.id}
                onClick={() => loadPastJob(job)}
                className={`w-full flex items-center justify-between p-3 rounded-lg hover:bg-muted/30 transition-colors text-left ${
                  currentJob?.id === job.id ? "bg-primary/5 border border-primary/20" : ""
                }`}
              >
                <div>
                  <span className="text-sm font-medium">
                    {new Date(job.created_at).toLocaleDateString()} â€” {new Date(job.created_at).toLocaleTimeString()}
                  </span>
                  <div className="flex gap-1.5 mt-1">
                    <Badge variant={job.status === "completed" ? "default" : job.status === "failed" ? "destructive" : "secondary"} className="text-[10px]">
                      {job.status}
                    </Badge>
                    {job.summary?.listings_with_issues !== undefined && (
                      <span className="text-xs text-muted-foreground">
                        {job.summary.listings_with_issues} issues in {job.summary.total_listings_scanned} listings
                      </span>
                    )}
                  </div>
                </div>
                <CheckCircle2 className={`h-4 w-4 ${job.status === "completed" ? "text-green-400" : "text-muted-foreground/30"}`} />
              </button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}









