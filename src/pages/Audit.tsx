import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Shield, AlertTriangle, CheckCircle, XCircle, Globe, Loader2,
  ExternalLink, ChevronDown, ChevronUp, Clock, FileSearch, BarChart3,
  Download, CreditCard,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { toast } from "sonner";
import { exportCompliancePdf, exportComplianceCsv } from "@/lib/reportExports";
import { useNavigate } from "react-router-dom";

interface Finding {
  category: "gmc_misrepresentation" | "etsy_compliance" | "general_ecommerce";
  severity: "critical" | "warning" | "info" | "pass";
  title: string;
  description: string;
  recommendation: string;
  reference?: string;
}

interface ComplianceReport {
  score: number;
  summary: string;
  findings: Finding[];
  pages_analyzed: number;
}

interface ScanRecord {
  id: string;
  store_url: string;
  status: string;
  score: number | null;
  critical_count: number;
  warning_count: number;
  passed_count: number;
  results: ComplianceReport | null;
  created_at: string;
  completed_at: string | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  gmc_misrepresentation: "Google Merchant Center",
  etsy_compliance: "Etsy Compliance",
  general_ecommerce: "General E-commerce",
};

const SEVERITY_CONFIG = {
  critical: { icon: XCircle, color: "text-destructive", bg: "bg-destructive/10", border: "border-destructive/20", label: "Critical" },
  warning: { icon: AlertTriangle, color: "text-phoenix-warning", bg: "bg-phoenix-warning/10", border: "border-phoenix-warning/20", label: "Warning" },
  info: { icon: FileSearch, color: "text-primary", bg: "bg-primary/10", border: "border-primary/20", label: "Info" },
  pass: { icon: CheckCircle, color: "text-phoenix-success", bg: "bg-phoenix-success/10", border: "border-phoenix-success/20", label: "Passed" },
};

function ScoreRing({ score }: { score: number }) {
  const circumference = 2 * Math.PI * 54;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? "hsl(var(--phoenix-success))" : score >= 50 ? "hsl(var(--phoenix-warning))" : "hsl(var(--destructive))";

  return (
    <div className="relative w-36 h-36">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="54" fill="none" stroke="hsl(var(--border))" strokeWidth="8" />
        <circle
          cx="60" cy="60" r="54" fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold">{score}</span>
        <span className="text-xs text-muted-foreground">/ 100</span>
      </div>
    </div>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  const [expanded, setExpanded] = useState(false);
  const config = SEVERITY_CONFIG[finding.severity];
  const Icon = config.icon;

  return (
    <motion.div layout className={`p-4 rounded-lg ${config.bg} border ${config.border}`}>
      <div className="flex items-start gap-3 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${config.color}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{finding.title}</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {CATEGORY_LABELS[finding.category]}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{finding.description}</p>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </div>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} className="overflow-hidden"
          >
            <div className="mt-3 pt-3 border-t border-border/30 space-y-2">
              <p className="text-sm text-foreground">{finding.description}</p>
              <div className="bg-background/50 p-3 rounded-md">
                <p className="text-xs font-medium text-phoenix-success mb-1">💡 Recommendation</p>
                <p className="text-xs text-muted-foreground">{finding.recommendation}</p>
              </div>
              {finding.reference && (
                <a href={finding.reference} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                  View policy reference <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function AuditPage() {
  const { user } = useAuth();
  const isAdmin = useIsAdmin(user?.id);
  const navigate = useNavigate();
  const [storeUrl, setStoreUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [pastScans, setPastScans] = useState<ScanRecord[]>([]);
  const [activeTab, setActiveTab] = useState("scan");

  useEffect(() => {
    if (user) fetchPastScans();
  }, [user]);

  const fetchPastScans = async () => {
    const { data } = await supabase
      .from("compliance_scans")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    if (data) setPastScans(data as unknown as ScanRecord[]);
  };

  const handleScan = async () => {
    if (!isAdmin) {
      toast.error("Compliance scans are free for admin only. Purchase a scan package to run this tool.");
      navigate("/pricing");
      return;
    }

    if (!storeUrl.trim()) {
      toast.error("Please enter a store URL");
      return;
    }

    setScanning(true);
    setProgress(0);
    setReport(null);

    // Simulate progress while waiting for response
    const progressInterval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 90) return prev;
        return prev + Math.random() * 8;
      });
    }, 800);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Please sign in first");
        return;
      }

      const res = await supabase.functions.invoke("compliance-scan", {
        body: { url: storeUrl },
      });

      if (res.error) throw new Error(res.error.message);
      if (res.data?.error) throw new Error(res.data.error);

      setProgress(100);
      setReport(res.data.report);
      toast.success("Compliance scan complete!");
      fetchPastScans();
    } catch (error: unknown) {
     console.error("Scan failed:", error);
      const message = error instanceof Error ? error.message : "Scan failed. Please try again.";
      toast.error(message);
    } finally {
      clearInterval(progressInterval);
      setScanning(false);
    }
  };

  const loadPastScan = (scan: ScanRecord) => {
    if (scan.results) {
      setReport(scan.results);
      setStoreUrl(scan.store_url);
      setActiveTab("scan");
    }
  };

  const criticals = report?.findings.filter(f => f.severity === "critical") || [];
  const warnings = report?.findings.filter(f => f.severity === "warning") || [];
  const infos = report?.findings.filter(f => f.severity === "info") || [];
  const passed = report?.findings.filter(f => f.severity === "pass") || [];

  return (
    <div className="space-y-6 max-w-5xl">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Shield className="h-6 w-6 text-primary" /> Misrepresentation Risk Scanner
        </h1>
        <p className="text-muted-foreground mt-1">
          AI-powered misrepresentation risk audit for admin review
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant={isAdmin ? "secondary" : "outline"}>
            {isAdmin ? "Admin free access" : "Paid scan required"}
          </Badge>
          {!isAdmin ? (
            <Badge variant="outline">Non-admin users must purchase compliance scans</Badge>
          ) : null}
        </div>
      </motion.div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-secondary/50">
          <TabsTrigger value="scan" className="gap-1.5">
            <FileSearch className="h-4 w-4" /> New Scan
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <Clock className="h-4 w-4" /> Scan History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="scan" className="space-y-6 mt-4">
          {/* URL Input */}
          <Card className="bg-card/50 border-border/30">
            <CardContent className="p-6">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={storeUrl}
                    onChange={e => setStoreUrl(e.target.value)}
                    placeholder="Enter store URL (e.g. mystore.com)"
                    className="pl-9 bg-background/50"
                    onKeyDown={e => e.key === "Enter" && !scanning && handleScan()}
                    disabled={scanning}
                  />
                </div>
                <Button
                  onClick={handleScan}
                  disabled={scanning || !storeUrl.trim()}
                  className="gradient-phoenix text-primary-foreground shrink-0 gap-2"
                  size="lg"
                >
                  {scanning ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Scanning...</>
                  ) : !isAdmin ? (
                    <><CreditCard className="h-4 w-4" /> Buy Compliance Scan</>
                  ) : (
                    <><Shield className="h-4 w-4" /> Run Risk Audit</>
                  )}
                </Button>
              </div>
              {!isAdmin ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Admin accounts can run this scanner free. Other users should purchase a compliance package in Pricing.
                </p>
              ) : null}

              {scanning && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 space-y-2">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>
                      {progress < 20 ? "Scraping website..." :
                       progress < 50 ? "Analyzing policy pages..." :
                       progress < 80 ? "Running AI compliance check..." :
                       "Generating report..."}
                    </span>
                    <span>{Math.round(progress)}%</span>
                  </div>
                  <Progress value={progress} className="h-2" />
                </motion.div>
              )}
            </CardContent>
          </Card>

          {/* Report */}
          {report && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
              {/* Score + Summary */}
              <Card className="bg-card/50 border-border/30">
                <CardContent className="p-6">
                  <div className="flex flex-col sm:flex-row items-center gap-6">
                    <ScoreRing score={report.score} />
                    <div className="flex-1 text-center sm:text-left">
                      <h2 className="text-lg font-bold mb-2">Risk Score</h2>
                      <p className="text-sm text-muted-foreground mb-4">{report.summary}</p>
                      <div className="flex flex-wrap gap-3 justify-center sm:justify-start">
                        <div className="flex items-center gap-1.5">
                          <XCircle className="h-4 w-4 text-destructive" />
                          <span className="text-sm font-medium">{criticals.length} Critical</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <AlertTriangle className="h-4 w-4 text-phoenix-warning" />
                          <span className="text-sm font-medium">{warnings.length} Warnings</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <FileSearch className="h-4 w-4 text-primary" />
                          <span className="text-sm font-medium">{infos.length} Info</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <CheckCircle className="h-4 w-4 text-phoenix-success" />
                          <span className="text-sm font-medium">{passed.length} Passed</span>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mt-3">
                        {report.pages_analyzed} pages analyzed
                      </p>
                      <div className="flex gap-2 mt-3">
                        <Button size="sm" variant="outline" onClick={() => exportCompliancePdf(report, storeUrl)}>
                          <Download className="h-3.5 w-3.5 mr-1.5" /> PDF
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => exportComplianceCsv(report, storeUrl)}>
                          <Download className="h-3.5 w-3.5 mr-1.5" /> CSV
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Stat Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Critical", count: criticals.length, Icon: XCircle, color: "text-destructive", bg: "bg-destructive/5 border-destructive/20" },
                  { label: "Warnings", count: warnings.length, Icon: AlertTriangle, color: "text-phoenix-warning", bg: "bg-phoenix-warning/5 border-phoenix-warning/20" },
                  { label: "Info", count: infos.length, Icon: FileSearch, color: "text-primary", bg: "bg-primary/5 border-primary/20" },
                  { label: "Passed", count: passed.length, Icon: CheckCircle, color: "text-phoenix-success", bg: "bg-phoenix-success/5 border-phoenix-success/20" },
                ].map(({ label, count, Icon, color, bg }) => (
                  <Card key={label} className={`${bg} border`}>
                    <CardContent className="p-4 text-center">
                      <Icon className={`h-5 w-5 ${color} mx-auto mb-1`} />
                      <p className={`text-2xl font-bold ${color}`}>{count}</p>
                      <p className="text-xs text-muted-foreground">{label}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Findings */}
              {criticals.length > 0 && (
                <Card className="bg-card/50 border-border/30">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-destructive flex items-center gap-2 text-base">
                      <XCircle className="h-5 w-5" /> Critical Issues
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {criticals.map((f, i) => <FindingCard key={i} finding={f} />)}
                  </CardContent>
                </Card>
              )}

              {warnings.length > 0 && (
                <Card className="bg-card/50 border-border/30">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-phoenix-warning flex items-center gap-2 text-base">
                      <AlertTriangle className="h-5 w-5" /> Warnings
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {warnings.map((f, i) => <FindingCard key={i} finding={f} />)}
                  </CardContent>
                </Card>
              )}

              {infos.length > 0 && (
                <Card className="bg-card/50 border-border/30">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-primary flex items-center gap-2 text-base">
                      <FileSearch className="h-5 w-5" /> Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {infos.map((f, i) => <FindingCard key={i} finding={f} />)}
                  </CardContent>
                </Card>
              )}

              {passed.length > 0 && (
                <Card className="bg-card/50 border-border/30">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-phoenix-success flex items-center gap-2 text-base">
                      <CheckCircle className="h-5 w-5" /> Passed Checks
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {passed.map((f, i) => <FindingCard key={i} finding={f} />)}
                  </CardContent>
                </Card>
              )}
            </motion.div>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <Card className="bg-card/50 border-border/30">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" /> Past Scans
              </CardTitle>
            </CardHeader>
            <CardContent>
              {pastScans.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No scans yet. Run your first compliance audit above.
                </p>
              ) : (
                <div className="space-y-2">
                  {pastScans.map(scan => (
                    <div
                      key={scan.id}
                      className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30 hover:bg-secondary/50 cursor-pointer transition-colors"
                      onClick={() => loadPastScan(scan)}
                    >
                      <div className="shrink-0">
                        {scan.status === "completed" ? (
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
                            (scan.score ?? 0) >= 80 ? "bg-phoenix-success/20 text-phoenix-success" :
                            (scan.score ?? 0) >= 50 ? "bg-phoenix-warning/20 text-phoenix-warning" :
                            "bg-destructive/20 text-destructive"
                          }`}>
                            {scan.score}
                          </div>
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{scan.store_url}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(scan.created_at).toLocaleDateString()} • {scan.critical_count} critical, {scan.warning_count} warnings
                        </p>
                      </div>
                      <Badge variant={scan.status === "completed" ? "secondary" : "outline"} className="text-xs">
                        {scan.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
