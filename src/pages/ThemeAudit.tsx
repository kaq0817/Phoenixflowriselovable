import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Palette, Globe, Loader2, CheckCircle, XCircle, AlertTriangle,
  Zap, Search, Type, LayoutGrid, ChevronDown, ChevronUp, Eye,
  Download,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { exportThemePdf, exportThemeCsv } from "@/lib/reportExports";

interface ContrastCheck {
  pair: string;
  foreground: string;
  background_color: string;
  ratio: number;
  wcag_aa: "pass" | "fail";
  wcag_aaa: "pass" | "fail";
}

interface Finding {
  category: "color_contrast" | "speed" | "seo" | "layout" | "typography";
  severity: "critical" | "warning" | "info"; // Removed 'pass' as AI will no longer report it
  title: string;
  description: string;
  recommendation: string;
}

interface ThemeReport {
  overall_score: number;
  summary: string;
  color_palette: {
    primary: string;
    secondary?: string;
    accent?: string;
    background: string;
    text: string;
  };
  contrast_checks: ContrastCheck[];
  findings: Finding[];
  category_scores: {
    color_contrast: number;
    speed: number;
    seo: number;
    layout: number;
    typography: number;
  };
}

const CATEGORY_META: Record<string, { label: string; icon: typeof Palette; color: string }> = {
  color_contrast: { label: "Color & Contrast", icon: Palette, color: "text-primary" },
  speed: { label: "Speed", icon: Zap, color: "text-phoenix-warning" },
  seo: { label: "SEO", icon: Search, color: "text-phoenix-success" },
  layout: { label: "Layout & GMC", icon: LayoutGrid, color: "text-accent" },
  typography: { label: "Typography", icon: Type, color: "text-foreground" },
};

const SEVERITY_CONFIG = {
  critical: { icon: XCircle, color: "text-destructive", bg: "bg-destructive/10", border: "border-destructive/20" },
  warning: { icon: AlertTriangle, color: "text-phoenix-warning", bg: "bg-phoenix-warning/10", border: "border-phoenix-warning/20" },
  info: { icon: Eye, color: "text-primary", bg: "bg-primary/10", border: "border-primary/20" },
  pass: { icon: CheckCircle, color: "text-phoenix-success", bg: "bg-phoenix-success/10", border: "border-phoenix-success/20" },
};

function ColorSwatch({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className="w-12 h-12 rounded-lg border border-border/30 shadow-md"
        style={{ backgroundColor: color }}
        title={color}
      />
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="text-[10px] font-mono text-foreground">{color}</span>
    </div>
  );
}

function ContrastRow({ check }: { check: ContrastCheck }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30">
      <div className="flex items-center gap-2 shrink-0">
        <div className="w-6 h-6 rounded border border-border/30" style={{ backgroundColor: check.foreground }} />
        <span className="text-muted-foreground text-xs">on</span>
        <div className="w-6 h-6 rounded border border-border/30" style={{ backgroundColor: check.background_color }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{check.pair}</p>
        <p className="text-xs text-muted-foreground">Ratio: {check.ratio}:1</p>
      </div>
      <div className="flex gap-2 shrink-0">
        <Badge variant="outline" className={check.wcag_aa === "pass" ? "border-phoenix-success/30 text-phoenix-success" : "border-destructive/30 text-destructive"}>
          AA {check.wcag_aa === "pass" ? "✓" : "✗"}
        </Badge>
        <Badge variant="outline" className={check.wcag_aaa === "pass" ? "border-phoenix-success/30 text-phoenix-success" : "border-phoenix-warning/30 text-phoenix-warning"}>
          AAA {check.wcag_aaa === "pass" ? "✓" : "✗"}
        </Badge>
      </div>
    </div>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  const [expanded, setExpanded] = useState(false);
  const config = SEVERITY_CONFIG[finding.severity];
  const Icon = config.icon;
  const catMeta = CATEGORY_META[finding.category];

  return (
    <div className={`p-4 rounded-lg ${config.bg} border ${config.border}`}>
      <div className="flex items-start gap-3 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${config.color}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{finding.title}</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{catMeta.label}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{finding.description}</p>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </div>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-3 pt-3 border-t border-border/30 space-y-2">
              <p className="text-sm">{finding.description}</p>
              <div className="bg-background/50 p-3 rounded-md">
                <p className="text-xs font-medium text-phoenix-success mb-1">💡 Recommendation</p>
                <p className="text-xs text-muted-foreground">{finding.recommendation}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CategoryScoreBar({ label, score, icon: Icon, color }: { label: string; score: number; icon: typeof Palette; color: string }) {
  const barColor = score >= 80 ? "bg-phoenix-success" : score >= 50 ? "bg-phoenix-warning" : "bg-destructive";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Icon className={`h-3.5 w-3.5 ${color}`} />
          <span className="text-xs font-medium">{label}</span>
        </div>
        <span className="text-xs font-bold">{score}</span>
      </div>
      <div className="h-2 rounded-full bg-secondary/50 overflow-hidden">
        <motion.div
          initial={{ width: 0 }} animate={{ width: `${score}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className={`h-full rounded-full ${barColor}`}
        />
      </div>
    </div>
  );
}

export default function ThemeAuditPage() {
  const { user } = useAuth();
  const [storeUrl, setStoreUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [report, setReport] = useState<ThemeReport | null>(null);

  const handleScan = async () => {
    if (!storeUrl.trim()) {
      toast.error("Please enter a store URL");
      return;
    }

    setScanning(true);
    setProgress(0);
    setReport(null);

    const progressInterval = setInterval(() => {
      setProgress(prev => prev >= 90 ? prev : prev + Math.random() * 10);
    }, 600);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Please sign in first");
        return;
      }

      const res = await supabase.functions.invoke("theme-audit", {
        body: { url: storeUrl },
      });

      if (res.error) throw new Error(res.error.message);
      if (res.data?.error) throw new Error(res.data.error);

      setProgress(100);
      setReport(res.data.report);
      toast.success("Theme audit complete!");
    } catch (err: unknown) {
      console.error("Theme audit failed:", err);
      const message = (err instanceof Error && err.message) ? err.message : "Audit failed. Please try again.";
      toast.error(message);
    } finally {
      clearInterval(progressInterval);
      setScanning(false);
    }
  };

  const criticals = report?.findings.filter(f => f.severity === "critical") || [];
  const warnings = report?.findings.filter(f => f.severity === "warning") || [];
  const infos = report?.findings.filter(f => f.severity === "info") || [];

  return (
    <div className="space-y-6 max-w-5xl">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Palette className="h-6 w-6 text-primary" /> Theme Compliance
        </h1>
        <p className="text-muted-foreground mt-1">
          WCAG color contrast, speed, SEO & layout audit
        </p>
      </motion.div>

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
              ) : (
                <><Palette className="h-4 w-4" /> Run Theme Audit</>
              )}
            </Button>
          </div>

          {scanning && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  {progress < 25 ? "Extracting branding & colors..." :
                   progress < 50 ? "Analyzing HTML structure..." :
                   progress < 75 ? "Running WCAG contrast checks..." :
                   "Generating theme report..."}
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
          {/* Score + Palette Overview */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Score */}
            <Card className="bg-card/50 border-border/30">
              <CardContent className="p-6">
                <h2 className="text-lg font-bold mb-1">Theme Score</h2>
                <p className="text-xs text-muted-foreground mb-4">{report.summary}</p>
                <div className="space-y-3">
                  {Object.entries(CATEGORY_META).map(([key, meta]) => (
                    <CategoryScoreBar
                      key={key}
                      label={meta.label}
                      score={report.category_scores[key as keyof typeof report.category_scores]}
                      icon={meta.icon}
                      color={meta.color}
                    />
                  ))}
                </div>
                <div className="mt-4 pt-4 border-t border-border/30 flex items-center justify-between">
                  <span className="text-sm font-medium">Overall Score</span>
                  <span className={`text-2xl font-bold ${
                    report.overall_score >= 80 ? "text-phoenix-success" :
                    report.overall_score >= 50 ? "text-phoenix-warning" : "text-destructive"
                  }`}>{report.overall_score}/100</span>
                </div>
                <div className="flex gap-2 mt-3">
                  <Button size="sm" variant="outline" onClick={() => exportThemePdf(report, storeUrl)}>
                    <Download className="h-3.5 w-3.5 mr-1.5" /> PDF
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => exportThemeCsv(report, storeUrl)}>
                    <Download className="h-3.5 w-3.5 mr-1.5" /> CSV
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Color Palette */}
            <Card className="bg-card/50 border-border/30">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Palette className="h-5 w-5 text-primary" /> Detected Palette
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-4 justify-center mb-6">
                  <ColorSwatch color={report.color_palette.primary} label="Primary" />
                  {report.color_palette.secondary && <ColorSwatch color={report.color_palette.secondary} label="Secondary" />}
                  {report.color_palette.accent && <ColorSwatch color={report.color_palette.accent} label="Accent" />}
                  <ColorSwatch color={report.color_palette.background} label="Background" />
                  <ColorSwatch color={report.color_palette.text} label="Text" />
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="p-2 rounded-lg bg-secondary/30">
                    <p className="text-lg font-bold">{criticals.length + warnings.length}</p>
                    <p className="text-[10px] text-muted-foreground">Issues Found</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Contrast Checks */}
          {report.contrast_checks.length > 0 && (
            <Card className="bg-card/50 border-border/30">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Eye className="h-5 w-5 text-primary" /> WCAG Contrast Checks
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {report.contrast_checks.map((check, i) => (
                  <ContrastRow key={i} check={check} />
                ))}
              </CardContent>
            </Card>
          )}

          {/* Findings by severity */}
          {criticals.length > 0 && (
            <Card className="bg-card/50 border-border/30">
              <CardHeader className="pb-3">
                <CardTitle className="text-destructive flex items-center gap-2 text-base">
                  <XCircle className="h-5 w-5" /> Critical Issues ({criticals.length})
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
                  <AlertTriangle className="h-5 w-5" /> Warnings ({warnings.length})
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
                  <Eye className="h-5 w-5" /> Recommendations ({infos.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {infos.map((f, i) => <FindingCard key={i} finding={f} />)}
              </CardContent>
            </Card>
          )}
        </motion.div>
      )}
    </div>
  );
}
