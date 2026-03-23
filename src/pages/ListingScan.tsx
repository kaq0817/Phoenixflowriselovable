import { useState, useEffect } from "react";
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
  Download,
} from "lucide-react";
import { exportListingScanPdf, exportListingScanCsv } from "@/lib/reportExports";

interface KeywordResearchItem {
  keyword: string;
  searchVolume: number | string;
  tiktokTrend?: boolean;
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
}

const SEVERITY_CONFIG = {
  critical: { icon: AlertTriangle, color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30", label: "Critical" },
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

export default function ListingScanPage() {
  const { toast } = useToast();
  const [scanning, setScanning] = useState(false);
  const [currentJob, setCurrentJob] = useState<ScanJob | null>(null);
  const [pastJobs, setPastJobs] = useState<ScanJob[]>([]);
  const [expandedListing, setExpandedListing] = useState<number | null>(null);
  const [hasConnection, setHasConnection] = useState<boolean | null>(null);

  useEffect(() => {
    checkConnection();
    fetchPastJobs();
  }, []);

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
  }, [currentJob, toast]);

  async function checkConnection() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { data } = await supabase.from("store_connections").select("id").eq("user_id", session.user.id).limit(1);
    setHasConnection(data && data.length > 0);
  }

  async function fetchPastJobs() {
    const { data } = await supabase
      .from("scan_jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);
    if (data) setPastJobs(data as unknown as ScanJob[]);
  }

  async function startScan() {
    setScanning(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      // Create the job record
      const { data: job, error } = await supabase
        .from("scan_jobs")
        .insert({ user_id: session.user.id, status: "pending", platform: "etsy" })
        .select()
        .single();

      if (error || !job) throw new Error("Failed to create scan job");
      setCurrentJob(job as unknown as ScanJob);

      // Fire and forget — the edge function runs autonomously
      const res = await fetch(
        `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/run-listing-scan`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ scanJobId: job.id }),
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

      {/* Connection check */}
      {hasConnection === false && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
            <span className="text-sm">Connect your Etsy or Shopify store in <strong>Settings</strong> to scan listings.</span>
          </CardContent>
        </Card>
      )}

      {/* Start Scan */}
      {hasConnection !== false && (
        <Card>
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-lg">Run Background Scan</h3>
              <p className="text-sm text-muted-foreground">
                Scans active listings for opportunity, weak keywords, and trend signals. You'll get an email when it's done.
              </p>
            </div>
            <Button
              onClick={startScan}
              disabled={scanning || hasConnection === null}
              size="lg"
              className="gap-2"
            >
              {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scan className="h-4 w-4" />}
              {scanning ? "Scanning..." : "Start Scan"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Live Progress */}
      <AnimatePresence>
        {currentJob && (currentJob.status === "pending" || currentJob.status === "processing") && (
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
      {currentJob && currentJob.status === "completed" && currentJob.findings && (
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold">{currentJob.summary?.total_listings_scanned || 0}</div>
                <div className="text-xs text-muted-foreground">Scanned</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-red-400">{currentJob.summary?.listings_with_issues || 0}</div>
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
                <div className="text-2xl font-bold text-red-500">{currentJob.summary?.critical_count || 0}</div>
                <div className="text-xs text-muted-foreground">Critical</div>
              </CardContent>
            </Card>
          </div>

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
                          .map((finding, i) => (
                            <div key={`kw-${i}`} className="mt-3">
                              <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Keyword Research</h4>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {finding.data?.map((kw: KeywordResearchItem, j: number) => (
                                  <div key={j} className="flex items-center justify-between p-2 rounded bg-muted/30 text-sm">
                                    <span className="truncate">{kw.keyword}</span>
                                    <div className="flex gap-1.5 items-center">
                                      <Badge variant="outline" className="text-[10px] px-1.5">
                                        {kw.searchVolume}
                                      </Badge>
                                      {kw.tiktokTrend && (
                                        <Badge className="bg-pink-500/20 text-pink-400 text-[10px] px-1.5">TikTok</Badge>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
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
      {currentJob && currentJob.status === "failed" && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="p-6 text-center space-y-2">
            <AlertTriangle className="h-8 w-8 text-red-400 mx-auto" />
            <p className="font-medium">Scan Failed</p>
            <p className="text-sm text-muted-foreground">{currentJob.error_message || "An unknown error occurred."}</p>
            <Button variant="outline" onClick={startScan} className="mt-2">Retry</Button>
          </CardContent>
        </Card>
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
                    {new Date(job.created_at).toLocaleDateString()} — {new Date(job.created_at).toLocaleTimeString()}
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







