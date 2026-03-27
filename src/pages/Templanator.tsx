import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  Flame, Loader2, CheckCircle2, AlertTriangle, ArrowRight,
  ArrowLeft, Zap, Shield, Palette, Upload, Play, FileCode,
  Store, Eye, Send, X, ChevronDown, ChevronUp, Gauge,
  Rocket, Workflow, Clock3, Sparkles, ArrowUpRight,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface StoreConnection {
  id: string;
  platform: string;
  shop_domain: string | null;
  shop_name: string | null;
}

interface ScanResult {
  themeId: number;
  themeName: string;
  assets: Record<string, string | null>;
  scanIssues: string[];
  stats: {
    totalImages: number;
    unlazyImages: number;
    hardcodedColors: number;
    inlineStyles: number;
    formsWithoutTracking: number;
    hasPrivacyLink: boolean;
    hasTermsLink: boolean;
    hasRefundLink: boolean;
  };
  blogs: string[];
  detectedBusinessInfo?: {
    legalEntityName?: string;
    stateOfIncorporation?: string;
    supportLocation?: string;
    supportNumber?: string;
  };
}

interface DepartmentMapping {
  name: string;
  department: string;
}

interface FileApproval {
  key: string;
  original: string | null;
  rewritten: string;
  approved: boolean;
  expanded: boolean;
}

interface PushResult {
  totalModified: number;
  appliedFiles?: string[];
  errors?: string[];
}

const NICHE_PALETTES = [
  { label: "Nature / Family", value: "nature", desc: "Earthy greens, warm browns, soft golds" },
  { label: "Gaming / Neon", value: "neon", desc: "Electric blue, neon green, deep purple" },
  { label: "Luxury / Elegant", value: "luxury", desc: "Gold, black, ivory, deep burgundy" },
  { label: "Minimal / Clean", value: "minimal", desc: "White, light gray, subtle blue accents" },
  { label: "Bold / Street", value: "bold", desc: "Red, black, white, yellow accents" },
  { label: "Keep Current", value: "default", desc: "Preserve existing color scheme" },
];

const STEPS = [
  { num: 1, label: "Theme Handshake" },
  { num: 2, label: "Data Partition" },
  { num: 3, label: "Preview Changes" },
  { num: 4, label: "Push to Store" },
];

// Subdomain Mapper Logic (The Brain)
interface NichePillar {
  name: string;
  count: number;
  isSubdomain: boolean;
  parentPillar?: string;
}

interface ScanData {
  collections?: string[];
  navigation?: string[];
}

function mapNicheArchitecture(scanData: ScanData): NichePillar[] {
  const collections: string[] = scanData.collections || [];
  const navigation: string[] = scanData.navigation || [];
  // 1. Combine and Count keyword frequency
  const rawNiches: string[] = [...collections, ...navigation];
  const nicheCounts: Record<string, number> = rawNiches.reduce((acc: Record<string, number>, val: string) => {
    acc[val] = (acc[val] || 0) + 1;
    return acc;
  }, {});
  // 2. Sort by "Strength"
  const sorted: { name: string; count: number }[] = Object.entries(nicheCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([name, count]) => ({ name, count }));
  // 3. Partition: Top 5 become Subdomains, others become Children
  return sorted.map((niche, index) => {
    if (index < 5) {
      return { ...niche, isSubdomain: true };
    }
    // Logic: If it's a small niche, find the closest parent pillar
    // (Example: 'Children' might map to 'Family' if 'Family' is in Top 5)
    return {
      ...niche,
      isSubdomain: false,
      parentPillar: sorted[0].name // Default to the strongest pillar
    };
  });
}

export default function Templanator() {
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [connections, setConnections] = useState<StoreConnection[]>([]);
  const [selectedConn, setSelectedConn] = useState<string>("");
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);

  // Step 2 form
  const [legalEntityName, setLegalEntityName] = useState("");
  const [stateOfIncorporation, setStateOfIncorporation] = useState("");
  const [supportLocation, setSupportLocation] = useState("");
  const [supportNumber, setSupportNumber] = useState("");
  const [nichePalette, setNichePalette] = useState("default");
  const [departmentMappings, setDepartmentMappings] = useState<DepartmentMapping[]>([]);

  // Step 3 - preview
  const [generating, setGenerating] = useState(false);
  const [fileApprovals, setFileApprovals] = useState<FileApproval[]>([]);

  // Step 4 — push
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<PushResult | null>(null);

  const selectedStore = connections.find((connection) => connection.id === selectedConn) ?? null;
  const approvedCount = fileApprovals.filter((file) => file.approved).length;
  const pendingReviewCount = Math.max(fileApprovals.length - approvedCount, 0);
  const availableStep = pushResult ? 4 : fileApprovals.length > 0 ? 3 : scanResult ? 2 : 1;
  const missionState = step;
  const missionProgress = pushResult
    ? 100
    : fileApprovals.length > 0
      ? 78
      : scanResult
        ? 46
        : selectedConn
          ? 18
          : 6;
  const assetCount = scanResult ? Object.keys(scanResult.assets).length : 0;
  const canImport = Boolean(selectedConn) && !scanning;
  const canGenerate = Boolean(scanResult) && !generating;
  const canPush = approvedCount > 0 && !pushing;

  useEffect(() => {
    const fetchConns = async () => {
      const { data } = await supabase
        .from("store_connections")
        .select("id, platform, shop_domain, shop_name")
        .eq("platform", "shopify");
      if (data) setConnections(data);
    };
    void fetchConns();
  }, []);

  useEffect(() => {
    if (!selectedConn && connections.length === 1) {
      setSelectedConn(connections[0].id);
    }
  }, [connections, selectedConn]);

  const resetSession = () => {
    setStep(1);
    setScanResult(null);
    setFileApprovals([]);
    setPushResult(null);
  };

  const handleImportTheme = async () => {
    if (!selectedConn) {
      toast({ title: "Select a store", variant: "destructive" });
      return;
    }
    setScanning(true);
    try {
      const { data: result, error } = await supabase.functions.invoke("fetch-shopify-theme", {
        body: { connectionId: selectedConn },
      });
      if (error) throw error;

      setPushResult(null);
      setFileApprovals([]);
      setScanResult(result);

      const detected = result.detectedBusinessInfo || {};
      setLegalEntityName((prev) => prev || detected.legalEntityName || "");
      setStateOfIncorporation((prev) => prev || detected.stateOfIncorporation || "");
      setSupportLocation((prev) => prev || detected.supportLocation || "");
      setSupportNumber((prev) => prev || detected.supportNumber || "");

      if (result.blogs && result.blogs.length > 0) {
        setDepartmentMappings(
          result.blogs.map((b: string) => ({
            name: b.replace(/['"]/g, "").replace(/blog[._-]?/i, "").trim() || b,
            department: "General",
          }))
        );
      }

      setStep(2);
      toast({ title: "Theme imported!", description: `${result.scanIssues.length} issues detected.` });
    } catch (err: unknown) {
      toast({ title: "Import failed", description: getErrorMessage(err), variant: "destructive" });
    } finally {
      setScanning(false);
    }
  };

  const handleGeneratePreview = async () => {
    if (!scanResult) return;
    setGenerating(true);
    try {
      const { data: result, error } = await supabase.functions.invoke("apply-theme-fixes", {
        body: {
          connectionId: selectedConn,
          themeId: scanResult.themeId,
          assets: scanResult.assets,
          businessInfo: {
            legalEntityName,
            stateOfIncorporation,
            supportLocation,
            supportNumber,
            departmentMappings,
            nichePalette,
          },
          fixTypes: ["architecture", "speed", "tracking", "identity"],
        },
      });
      if (error) throw error;

      // Build file approval list
      const approvals: FileApproval[] = Object.entries(result.rewrittenFiles).map(
        ([key, rewritten]) => ({
          key,
          original: scanResult.assets[key] || null,
          rewritten: rewritten as string,
          approved: true,
          expanded: false,
        })
      );

      setPushResult(null);
      setFileApprovals(approvals);
      setStep(3);
      toast({ title: "Preview Ready!", description: `${approvals.length} files rewritten. Review before pushing.` });
    } catch (err: unknown) {
      toast({ title: "Preview failed", description: getErrorMessage(err), variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const handlePushApproved = async () => {
    if (!scanResult) return;
    const approved = fileApprovals.filter((f) => f.approved);
    if (approved.length === 0) {
      toast({ title: "No files approved", description: "Toggle on at least one file to push.", variant: "destructive" });
      return;
    }
    setPushing(true);
    try {
      const approvedFiles: Record<string, string> = {};
      approved.forEach((f) => { approvedFiles[f.key] = f.rewritten; });

      const { data: result, error } = await supabase.functions.invoke("push-theme-changes", {
        body: {
          connectionId: selectedConn,
          themeId: scanResult.themeId,
          approvedFiles,
        },
      });
      if (error) throw error;

      setPushResult(result as PushResult);
      setStep(4);
      toast({ title: "Theme Updated!", description: `${result.totalModified} files pushed to Shopify.` });
    } catch (err: unknown) {
      toast({ title: "Push failed", description: getErrorMessage(err), variant: "destructive" });
    } finally {
      setPushing(false);
    }
  };

  const toggleFileApproval = (index: number) => {
    setFileApprovals((prev) =>
      prev.map((f, i) => (i === index ? { ...f, approved: !f.approved } : f))
    );
  };

  const toggleFileExpanded = (index: number) => {
    setFileApprovals((prev) =>
      prev.map((f, i) => (i === index ? { ...f, expanded: !f.expanded } : f))
    );
  };

  // ===================== STEP 1 =====================
  const renderStep1 = () => (
    <motion.div key="step1" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} className="space-y-6">
      <Card className="bg-card/50 border-border/30">
        <CardContent className="p-6 space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg gradient-phoenix flex items-center justify-center">
              <Upload className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h2 className="font-bold text-lg">Step 1: The Theme Handshake</h2>
              <p className="text-sm text-muted-foreground">Import your current Shopify theme for analysis</p>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium">Select Shopify Store</label>
            {connections.length === 0 ? (
              <div className="p-4 rounded-lg bg-muted/30 text-center">
                <Store className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No Shopify stores connected.</p>
                <p className="text-xs text-muted-foreground mt-1">Go to Settings to add one first.</p>
              </div>
            ) : (
              <Select value={selectedConn} onValueChange={setSelectedConn}>
                <SelectTrigger className="bg-muted/50">
                  <SelectValue placeholder="Choose a store..." />
                </SelectTrigger>
                <SelectContent>
                  {connections.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.shop_name || c.shop_domain || "Shopify Store"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <Button className="w-full gradient-phoenix text-primary-foreground" size="lg" disabled={!selectedConn || scanning} onClick={handleImportTheme}>
            {scanning ? (
              <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Pulling Theme Files...</>
            ) : (
              <><FileCode className="h-5 w-5 mr-2" /> Import Current Theme</>
            )}
          </Button>

          {scanning && (
            <div className="text-center text-sm text-muted-foreground animate-pulse">
              The Machine is reading your theme's DNA...
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );

  // ===================== STEP 2 =====================
  const renderStep2 = () => (
    <motion.div key="step2" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} className="space-y-6">
      {scanResult && (
        <Card className="bg-card/50 border-border/30">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              <h3 className="font-semibold">Issues Found</h3>
              <Badge variant="secondary" className="ml-auto">{scanResult.themeName}</Badge>
            </div>
            <div className="space-y-2">
              {scanResult.scanIssues.map((issue, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <Zap className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
                  <span className="text-muted-foreground">{issue}</span>
                </div>
              ))}
              {scanResult.scanIssues.length === 0 && (
                <p className="text-sm text-muted-foreground">Theme looks clean! Minor optimizations may still apply.</p>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
              <StatBox label="Images" value={scanResult.stats.totalImages} sub={`${scanResult.stats.unlazyImages} unlazy`} />
              <StatBox label="Hard Colors" value={scanResult.stats.hardcodedColors} />
              <StatBox label="Inline Styles" value={scanResult.stats.inlineStyles} />
              <StatBox label="Untracked Forms" value={scanResult.stats.formsWithoutTracking} />
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="bg-card/50 border-border/30">
        <CardContent className="p-6 space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="font-bold text-lg">Step 2: Configure</h2>
              <p className="text-sm text-muted-foreground">Business info for legal anchors & identity</p>
              {scanResult?.detectedBusinessInfo?.legalEntityName && (
                <p className="text-xs text-primary mt-1">
                  Auto-filled from your live theme where detected. Please review before generating preview.
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4 p-4 rounded-lg border border-primary/20 bg-primary/5">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" /> Licensed Area
              </h3>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Legal Entity Name</label>
                <Input placeholder="e.g. Go Hard Gaming Discord LLC" className="bg-background/50" value={legalEntityName} onChange={(e) => setLegalEntityName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">State of Incorporation</label>
                <Input placeholder="e.g. WY" className="bg-background/50" value={stateOfIncorporation} onChange={(e) => setStateOfIncorporation(e.target.value)} />
              </div>
            </div>

            <div className="space-y-4 p-4 rounded-lg border border-accent/20 bg-accent/5">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Zap className="h-4 w-4 text-accent" /> Functioning Area
              </h3>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Support Location</label>
                <Input placeholder="e.g. Saratoga County, NY" className="bg-background/50" value={supportLocation} onChange={(e) => setSupportLocation(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Support Number</label>
                <Input placeholder="e.g. (518) 555-0100" className="bg-background/50" value={supportNumber} onChange={(e) => setSupportNumber(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Niche Palette */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Palette className="h-4 w-4 text-primary" /> Identity Palette
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {NICHE_PALETTES.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setNichePalette(p.value)}
                  className={`p-3 rounded-lg border text-left transition-all ${
                    nichePalette === p.value
                      ? "border-primary bg-primary/10"
                      : "border-border/30 bg-muted/20 hover:bg-muted/40"
                  }`}
                >
                  <p className="text-sm font-medium">{p.label}</p>
                  <p className="text-xs text-muted-foreground">{p.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {departmentMappings.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-semibold text-sm">Department Mapping</h3>
              <p className="text-xs text-muted-foreground">
                Found these sections. Assign departments to prevent erasure.
              </p>
              {departmentMappings.map((dm, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-sm flex-1 truncate">"{dm.name}"</span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  <Input
                    className="max-w-[180px] bg-muted/50"
                    value={dm.department}
                    onChange={(e) => {
                      const updated = [...departmentMappings];
                      updated[i].department = e.target.value;
                      setDepartmentMappings(updated);
                    }}
                    placeholder="Department"
                  />
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep(1)}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Back
            </Button>
            <Button
              className="flex-1 gradient-phoenix text-primary-foreground"
              size="lg"
              disabled={generating}
              onClick={handleGeneratePreview}
            >
              {generating ? (
                <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> AI is Rewriting...</>
              ) : (
                <><Eye className="h-5 w-5 mr-2" /> Generate Preview</>
              )}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            ⚠️ Policies (Privacy, Terms, Refund) are <strong>not modified</strong> — only link anchors are added.
          </p>
        </CardContent>
      </Card>
    </motion.div>
  );

  // ===================== STEP 3 — DIFF PREVIEW =====================
  const renderStep3 = () => {
    const approvedCount = fileApprovals.filter((f) => f.approved).length;

    return (
      <motion.div key="step3" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} className="space-y-6">
        <Card className="bg-card/50 border-border/30">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <Eye className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h2 className="font-bold text-lg">Step 3: Review Changes</h2>
                <p className="text-sm text-muted-foreground">
                  Toggle files on/off, expand to see before → after diffs.
                </p>
              </div>
              <Badge className="ml-auto" variant="secondary">
                {approvedCount}/{fileApprovals.length} approved
              </Badge>
            </div>

            <div className="space-y-3">
              {fileApprovals.map((file, index) => (
                <div key={file.key} className={`rounded-lg border transition-all ${file.approved ? "border-green-500/30 bg-green-500/5" : "border-border/20 bg-muted/10 opacity-60"}`}>
                  {/* File header */}
                  <div className="flex items-center gap-3 p-4">
                    <Switch
                      checked={file.approved}
                      onCheckedChange={() => toggleFileApproval(index)}
                    />
                    <code className="text-sm font-mono flex-1">{file.key}</code>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleFileExpanded(index)}
                    >
                      {file.expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      <span className="ml-1 text-xs">{file.expanded ? "Hide" : "Diff"}</span>
                    </Button>
                  </div>

                  {/* Diff view */}
                  {file.expanded && (
                    <div className="border-t border-border/20">
                      <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border/20">
                        {/* Original */}
                        <div className="p-3">
                          <p className="text-xs font-semibold text-destructive mb-2 flex items-center gap-1">
                            <X className="h-3 w-3" /> BEFORE
                          </p>
                          <pre className="text-xs bg-destructive/5 rounded p-3 overflow-x-auto max-h-72 whitespace-pre-wrap break-all font-mono text-muted-foreground">
                            {file.original ? truncateCode(file.original, 3000) : "(file not previously loaded)"}
                          </pre>
                        </div>
                        {/* Rewritten */}
                        <div className="p-3">
                          <p className="text-xs font-semibold text-green-500 mb-2 flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> AFTER
                          </p>
                          <pre className="text-xs bg-green-500/5 rounded p-3 overflow-x-auto max-h-72 whitespace-pre-wrap break-all font-mono text-foreground">
                            {truncateCode(file.rewritten, 3000)}
                          </pre>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="flex gap-3 pt-2">
              <Button variant="outline" onClick={() => setStep(2)}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Back
              </Button>
              <Button
                className="flex-1 gradient-phoenix text-primary-foreground"
                size="lg"
                disabled={pushing || approvedCount === 0}
                onClick={handlePushApproved}
              >
                {pushing ? (
                  <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Pushing to Shopify...</>
                ) : (
                  <><Send className="h-5 w-5 mr-2" /> Push {approvedCount} File{approvedCount !== 1 ? "s" : ""} to Store</>
                )}
              </Button>
            </div>

            <p className="text-xs text-muted-foreground text-center">
              Only toggled-on files will be pushed. Review each diff before confirming.
            </p>
          </CardContent>
        </Card>
      </motion.div>
    );
  };

  // ===================== STEP 4 — RESULTS =====================
  const renderStep4 = () => (
    <motion.div key="step4" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} className="space-y-6">
      <Card className="bg-card/50 border-border/30">
        <CardContent className="p-6 space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-lg gradient-phoenix flex items-center justify-center">
              <CheckCircle2 className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <h2 className="font-bold text-xl">Theme Updated!</h2>
              <p className="text-sm text-muted-foreground">
                Your approved changes have been pushed to Shopify.
              </p>
            </div>
          </div>

          {pushResult && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20 text-center">
                  <p className="text-2xl font-bold text-green-500">{pushResult.totalModified}</p>
                  <p className="text-xs text-muted-foreground">Files Pushed</p>
                </div>
                <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-center">
                  <p className="text-2xl font-bold text-destructive">{pushResult.errors?.length || 0}</p>
                  <p className="text-xs text-muted-foreground">Errors</p>
                </div>
              </div>

              {pushResult.appliedFiles?.length > 0 && (
                <div className="space-y-2">
                  <h3 className="font-semibold text-sm">Successfully Applied</h3>
                  {pushResult.appliedFiles.map((f: string) => (
                    <div key={f} className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      <code className="text-xs bg-muted/50 px-2 py-0.5 rounded">{f}</code>
                    </div>
                  ))}
                </div>
              )}

              {pushResult.errors?.length > 0 && (
                <div className="space-y-2">
                  <h3 className="font-semibold text-sm text-destructive">Errors</h3>
                  {pushResult.errors.map((e: string, i: number) => (
                    <p key={i} className="text-xs text-destructive/80">{e}</p>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
            <p className="text-sm font-medium text-yellow-600 dark:text-yellow-400">⚠️ Policy Reminder</p>
            <p className="text-xs text-muted-foreground mt-1">
              Navigation links for Privacy Policy, Terms of Service, and Refund Policy have been added to your footer.
              You must write/update the actual policy content using <strong>Shopify Admin → Settings → Policies</strong>.
            </p>
          </div>

          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              setStep(1);
              setScanResult(null);
              setFileApprovals([]);
              setPushResult(null);
            }}
          >
            <Flame className="h-4 w-4 mr-2" /> Start New Session
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Flame className="h-6 w-6 text-primary" /> Phoenix Flow Templanator
        </h1>
        <p className="text-muted-foreground mt-1">
          Asset-Based Theme Revision — Review and push AI rewrites for speed, compliance, and identity.
        </p>
      </motion.div>

      {/* Progress Steps */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s.num} className="flex items-center gap-2 flex-1">
            <div
              className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                step >= s.num
                  ? "gradient-phoenix text-primary-foreground"
                  : "bg-muted/50 text-muted-foreground"
              }`}
            >
              {step > s.num ? <CheckCircle2 className="h-4 w-4" /> : s.num}
            </div>
            <span className={`text-xs font-medium hidden sm:inline ${step >= s.num ? "text-foreground" : "text-muted-foreground"}`}>
              {s.label}
            </span>
            {i < STEPS.length - 1 && <div className={`flex-1 h-px ${step > s.num ? "bg-primary" : "bg-border/30"}`} />}
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
        {step === 4 && renderStep4()}
      </AnimatePresence>
    </div>
  );
}

function truncateCode(code: string, maxLen: number): string {
  if (code.length <= maxLen) return code;
  return code.slice(0, maxLen) + "\n\n... (truncated for display)";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}



function StatBox({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="p-3 rounded-lg bg-muted/30 text-center">
      <p className="text-lg font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
      {sub && <p className="text-xs text-yellow-500">{sub}</p>}
    </div>
  );
}











