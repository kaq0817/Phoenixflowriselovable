import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  FileCode,
  Flame,
  Gauge,
  Globe,
  Loader2,
  Palette,
  Send,
  Shield,
  Store,
  Upload,
  Workflow,
  Zap,
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

interface ThemeLcpCandidate {
  assetKey: string;
  source: string;
  loadingMode: "eager" | "lazy" | "missing" | "other";
  hasFetchPriorityHigh: boolean;
  preloadDetected: boolean;
}

interface ThemePolicyLink {
  label: string;
  targetPath: string;
  href: string | null;
  status: "ok" | "missing" | "dead-link-risk";
}

interface CollectionPillar {
  title: string;
  handle: string;
  productsCount: number;
  suggestedSubdomain: string;
}

interface CrossStoreLink {
  assetKey: string;
  domain: string;
  url: string;
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
    belowFoldImagesMissingLazy: number;
    crossStoreLinkCount: number;
  };
  blogs: string[];
  sections: string[];
  detectedBusinessInfo?: {
    legalEntityName?: string;
    stateOfIncorporation?: string;
    supportLocation?: string;
    supportNumber?: string;
  };
  lcpCandidate: ThemeLcpCandidate | null;
  policyLinks: ThemePolicyLink[];
  collectionPillars: CollectionPillar[];
  crossStoreLinks: CrossStoreLink[];
  supportSiloStatus?: {
    expectedStoreMarker: string | null;
    matchesLocation: boolean;
    matchesPhoneContext: boolean;
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
  { num: 2, label: "Architect Scan" },
  { num: 3, label: "Preview Changes" },
  { num: 4, label: "Push to Store" },
];

export default function Templanator() {
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [connections, setConnections] = useState<StoreConnection[]>([]);
  const [selectedConn, setSelectedConn] = useState<string>("");
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [legalEntityName, setLegalEntityName] = useState("");
  const [stateOfIncorporation, setStateOfIncorporation] = useState("");
  const [supportLocation, setSupportLocation] = useState("");
  const [supportNumber, setSupportNumber] = useState("");
  const [baseDomain, setBaseDomain] = useState("");
  const [nichePalette, setNichePalette] = useState("default");
  const [departmentMappings, setDepartmentMappings] = useState<DepartmentMapping[]>([]);
  const [generating, setGenerating] = useState(false);
  const [fixNowRunning, setFixNowRunning] = useState(false);
  const [fileApprovals, setFileApprovals] = useState<FileApproval[]>([]);
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<PushResult | null>(null);

  const selectedStore = useMemo(
    () => connections.find((connection) => connection.id === selectedConn) ?? null,
    [connections, selectedConn],
  );
  const approvedCount = fileApprovals.filter((file) => file.approved).length;

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
      setStateOfIncorporation((prev) => prev || detected.stateOfIncorporation || "WY");
      setSupportLocation((prev) => prev || detected.supportLocation || "");
      setSupportNumber((prev) => prev || detected.supportNumber || "");

      if (result.blogs && result.blogs.length > 0) {
        setDepartmentMappings(
          result.blogs.map((blog: string) => ({
            name: blog.replace(/['"]/g, "").replace(/blog[._-]?/i, "").trim() || blog,
            department: "General",
          }))
        );
      }

      setStep(2);
      toast({ title: "Theme imported", description: `${result.scanIssues.length} architect checks flagged.` });
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
        },
      });
      if (error) throw error;

      const approvals: FileApproval[] = Object.entries(result.rewrittenFiles || {}).map(
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
      toast({ title: "Preview ready", description: `${approvals.length} files staged for review.` });
    } catch (err: unknown) {
      toast({ title: "Preview failed", description: getErrorMessage(err), variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const handleFixNow = async () => {
    if (!scanResult) return;
    setFixNowRunning(true);

    try {
      const { data: preview, error: previewError } = await supabase.functions.invoke("apply-theme-fixes", {
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
        },
      });
      if (previewError) throw previewError;

      const rewrittenFiles = preview?.rewrittenFiles || {};
      const approvedFiles: Record<string, string> = {};
      Object.entries(rewrittenFiles).forEach(([key, value]) => {
        if (typeof value === "string" && value.trim().length > 0) approvedFiles[key] = value;
      });

      if (Object.keys(approvedFiles).length === 0) {
        toast({ title: "No fixes generated", description: "Nothing to push for this theme." });
        return;
      }

      const { data: push, error: pushError } = await supabase.functions.invoke("push-theme-changes", {
        body: {
          connectionId: selectedConn,
          themeId: scanResult.themeId,
          approvedFiles,
        },
      });
      if (pushError) throw pushError;

      setPushResult(push as PushResult);
      setStep(4);
      toast({ title: "Theme updated", description: `${push.totalModified} files pushed to Shopify.` });
    } catch (err: unknown) {
      toast({ title: "Auto-fix failed", description: getErrorMessage(err), variant: "destructive" });
    } finally {
      setFixNowRunning(false);
    }
  };

  const handlePushApproved = async () => {
    if (!scanResult) return;
    const approved = fileApprovals.filter((file) => file.approved);
    if (approved.length === 0) {
      toast({ title: "No files approved", description: "Toggle on at least one file to push.", variant: "destructive" });
      return;
    }

    setPushing(true);
    try {
      const approvedFiles: Record<string, string> = {};
      approved.forEach((file) => {
        approvedFiles[file.key] = file.rewritten;
      });

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
      toast({ title: "Theme updated", description: `${result.totalModified} files pushed to Shopify.` });
    } catch (err: unknown) {
      toast({ title: "Push failed", description: getErrorMessage(err), variant: "destructive" });
    } finally {
      setPushing(false);
    }
  };

  const toggleFileApproval = (index: number) => {
    setFileApprovals((prev) => prev.map((file, i) => (i === index ? { ...file, approved: !file.approved } : file)));
  };

  const toggleFileExpanded = (index: number) => {
    setFileApprovals((prev) => prev.map((file, i) => (i === index ? { ...file, expanded: !file.expanded } : file)));
  };

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
              <p className="text-sm text-muted-foreground">Import your active Shopify theme for technical and business scanning.</p>
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
                  {connections.map((connection) => (
                    <SelectItem key={connection.id} value={connection.id}>
                      {connection.shop_name || connection.shop_domain || "Shopify Store"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <Button className="w-full gradient-phoenix text-primary-foreground" size="lg" disabled={!selectedConn || scanning} onClick={handleImportTheme}>
            {scanning ? <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Pulling Theme Files...</> : <><FileCode className="h-5 w-5 mr-2" /> Import Current Theme</>}
          </Button>

          {scanning ? <div className="text-center text-sm text-muted-foreground animate-pulse">The Templanator is mapping speed, legal anchors, and pillar opportunities...</div> : null}
        </CardContent>
      </Card>
    </motion.div>
  );

  const renderStep2 = () => (
    <motion.div key="step2" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} className="space-y-6">
      {scanResult ? (
        <>
          <Card className="bg-card/50 border-border/30">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
                <h3 className="font-semibold">Architect Findings</h3>
                <Badge variant="secondary" className="ml-auto">{scanResult.themeName}</Badge>
              </div>
              <div className="space-y-2">
                {scanResult.scanIssues.map((issue, index) => (
                  <div key={index} className="flex items-start gap-2 text-sm">
                    <Zap className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">{issue}</span>
                  </div>
                ))}
                {scanResult.scanIssues.length === 0 ? <p className="text-sm text-muted-foreground">Theme looks stable. Only opportunistic upgrades remain.</p> : null}
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 pt-2">
                <StatBox label="Images" value={scanResult.stats.totalImages} sub={`${scanResult.stats.belowFoldImagesMissingLazy} below-fold missing lazy`} />
                <StatBox label="Hard Colors" value={scanResult.stats.hardcodedColors} />
                <StatBox label="Inline Styles" value={scanResult.stats.inlineStyles} />
                <StatBox label="Untracked Forms" value={scanResult.stats.formsWithoutTracking} />
                <StatBox label="Cross-Store Links" value={scanResult.stats.crossStoreLinkCount} />
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-3">
            <ArchitectPanel icon={Gauge} title="Speed Layer" subtitle="LCP and lazy-loading audit">
              {scanResult.lcpCandidate ? (
                <>
                  <p className="text-sm"><span className="font-medium">LCP asset:</span> <span className="text-muted-foreground break-all">{scanResult.lcpCandidate.assetKey}</span></p>
                  <p className="text-sm"><span className="font-medium">Priority:</span> <StatusText ok={scanResult.lcpCandidate.hasFetchPriorityHigh} okLabel="fetchpriority=high present" badLabel="needs fetchpriority=high" /></p>
                  <p className="text-sm"><span className="font-medium">Loading:</span> <StatusText ok={scanResult.lcpCandidate.loadingMode === "eager"} okLabel="loading=eager present" badLabel={`currently ${scanResult.lcpCandidate.loadingMode}`} /></p>
                  <p className="text-sm"><span className="font-medium">Preload:</span> <StatusText ok={scanResult.lcpCandidate.preloadDetected} okLabel="head preload found" badLabel="preload missing" /></p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No strong above-the-fold image candidate found in the imported homepage sections.</p>
              )}
              <p className="text-sm"><span className="font-medium">Below fold:</span> <span className="text-muted-foreground">{scanResult.stats.belowFoldImagesMissingLazy} images still need `loading="lazy"`.</span></p>
            </ArchitectPanel>

            <ArchitectPanel icon={Shield} title="Wyoming Layer" subtitle="Identity, policy, and support verification">
              <p className="text-sm"><span className="font-medium">Legal anchor:</span> <span className="text-muted-foreground">{legalEntityName || "Pending"} | {stateOfIncorporation || "WY"}</span></p>
              <p className="text-sm"><span className="font-medium">Support silo:</span> <StatusText ok={scanResult.supportSiloStatus?.matchesLocation ?? true} okLabel="location matches active store" badLabel={`expected ${scanResult.supportSiloStatus?.expectedStoreMarker || "store-specific"} support copy`} /></p>
              <div className="space-y-2 pt-1">
                {scanResult.policyLinks.map((link) => (
                  <div key={link.label} className="rounded-md bg-muted/20 p-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{link.label}</span>
                      <Badge variant={link.status === "ok" ? "secondary" : "destructive"}>{link.status === "ok" ? "ready" : link.status === "missing" ? "missing" : "normalize"}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">Target: {link.targetPath}</p>
                  </div>
                ))}
              </div>
            </ArchitectPanel>

            <ArchitectPanel icon={Workflow} title="Pillar Layer" subtitle="Collection weights and subdomain prep">
              {scanResult.collectionPillars.length > 0 ? (
                <div className="space-y-2">
                  {scanResult.collectionPillars.map((pillar) => (
                    <div key={pillar.handle} className="rounded-md bg-muted/20 p-2 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium">{pillar.title}</span>
                        <Badge variant="secondary">{pillar.productsCount} products</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {baseDomain.trim()
                          ? `${pillar.handle}.${baseDomain.trim().replace(/^https?:\/\//, "").replace(/\/$/, "")}`
                          : "Enter a base domain to compute subdomains."}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No collection weights were returned from Shopify, so pillar suggestions are not ready yet.</p>
              )}
              {baseDomain.trim() ? (
                <p className="text-xs text-muted-foreground">CNAME target for Shopify: `shops.myshopify.com`.</p>
              ) : null}
            </ArchitectPanel>
          </div>

          {scanResult.crossStoreLinks.length > 0 ? (
            <Card className="bg-card/50 border-border/30">
              <CardContent className="p-6 space-y-3">
                <div className="flex items-center gap-3">
                  <Globe className="h-5 w-5 text-primary" />
                  <h3 className="font-semibold">Cross-Store Leak Watch</h3>
                </div>
                <div className="space-y-2">
                  {scanResult.crossStoreLinks.slice(0, 5).map((link) => (
                    <div key={`${link.assetKey}-${link.url}`} className="rounded-md bg-muted/20 p-3 text-sm">
                      <p className="font-medium">{link.domain}</p>
                      <p className="text-xs text-muted-foreground break-all">{link.assetKey}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}

      <Card className="bg-card/50 border-border/30">
        <CardContent className="p-6 space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="font-bold text-lg">Step 2: Configure the Rewrite</h2>
              <p className="text-sm text-muted-foreground">Feed the identity layer that will be stamped into footer anchors and support copy.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4 p-4 rounded-lg border border-primary/20 bg-primary/5">
              <h3 className="font-semibold text-sm flex items-center gap-2"><Shield className="h-4 w-4 text-primary" /> Legal Anchors</h3>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Legal Entity Name</label>
                <Input placeholder="e.g. Iron Phoenix Flow LLC" className="bg-background/50" value={legalEntityName} onChange={(e) => setLegalEntityName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">State of Incorporation</label>
                <Input placeholder="e.g. WY" className="bg-background/50" value={stateOfIncorporation} onChange={(e) => setStateOfIncorporation(e.target.value)} />
              </div>
            </div>

            <div className="space-y-4 p-4 rounded-lg border border-accent/20 bg-accent/5">
              <h3 className="font-semibold text-sm flex items-center gap-2"><Zap className="h-4 w-4 text-accent" /> Support Silo</h3>
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

          <div className="space-y-2">
            <label className="text-xs font-medium">Base Domain for Subdomains</label>
            <Input
              placeholder="e.g. ourphoenixrise.com"
              className="bg-background/50"
              value={baseDomain}
              onChange={(e) => setBaseDomain(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Subdomain suggestions will not run until this is filled.</p>
          </div>

          <div className="space-y-3">
            <h3 className="font-semibold text-sm flex items-center gap-2"><Palette className="h-4 w-4 text-primary" /> Identity Palette</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {NICHE_PALETTES.map((palette) => (
                <button
                  key={palette.value}
                  onClick={() => setNichePalette(palette.value)}
                  className={`p-3 rounded-lg border text-left transition-all ${nichePalette === palette.value ? "border-primary bg-primary/10" : "border-border/30 bg-muted/20 hover:bg-muted/40"}`}
                >
                  <p className="text-sm font-medium">{palette.label}</p>
                  <p className="text-xs text-muted-foreground">{palette.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {departmentMappings.length > 0 ? (
            <div className="space-y-3">
              <h3 className="font-semibold text-sm">Department Mapping</h3>
              <p className="text-xs text-muted-foreground">Detected sections from the imported theme. Map them before generating the preview.</p>
              {departmentMappings.map((mapping, index) => (
                <div key={index} className="flex items-center gap-3">
                  <span className="text-sm flex-1 truncate">{mapping.name}</span>
                  <Input
                    className="max-w-[180px] bg-muted/50"
                    value={mapping.department}
                    onChange={(e) => {
                      const updated = [...departmentMappings];
                      updated[index].department = e.target.value;
                      setDepartmentMappings(updated);
                    }}
                    placeholder="Department"
                  />
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep(1)}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Back
            </Button>
            <Button className="flex-1 gradient-phoenix text-primary-foreground" size="lg" disabled={generating} onClick={handleGeneratePreview}>
              {generating ? <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Building deterministic fixes...</> : <><Eye className="h-5 w-5 mr-2" /> Generate Preview</>}
            </Button>
            <Button className="flex-1 bg-primary text-primary-foreground" size="lg" disabled={fixNowRunning} onClick={handleFixNow}>
              {fixNowRunning ? <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Fixing...</> : <><Shield className="h-5 w-5 mr-2" /> Fix Now</>}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground text-center">Policy content is not authored here. This flow only normalizes the footer anchors and legal/support presentation.</p>
        </CardContent>
      </Card>
    </motion.div>
  );

  const renderStep3 = () => (
    <motion.div key="step3" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} className="space-y-6">
      <Card className="bg-card/50 border-border/30">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center">
              <Eye className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="font-bold text-lg">Step 3: Review Changes</h2>
              <p className="text-sm text-muted-foreground">Approve or reject each generated file before it is pushed.</p>
            </div>
            <Badge className="ml-auto" variant="secondary">{approvedCount}/{fileApprovals.length} approved</Badge>
          </div>

          <div className="space-y-3">
            {fileApprovals.map((file, index) => (
              <div key={file.key} className={`rounded-lg border transition-all ${file.approved ? "border-green-500/30 bg-green-500/5" : "border-border/20 bg-muted/10 opacity-60"}`}>
                <div className="flex items-center gap-3 p-4">
                  <Switch checked={file.approved} onCheckedChange={() => toggleFileApproval(index)} />
                  <code className="text-sm font-mono flex-1">{file.key}</code>
                  <Button variant="ghost" size="sm" onClick={() => toggleFileExpanded(index)}>
                    {file.expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    <span className="ml-1 text-xs">{file.expanded ? "Hide" : "Diff"}</span>
                  </Button>
                </div>

                {file.expanded ? (
                  <div className="border-t border-border/20">
                    <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border/20">
                      <div className="p-3">
                        <p className="text-xs font-semibold text-destructive mb-2">BEFORE</p>
                        <pre className="text-xs bg-destructive/5 rounded p-3 overflow-x-auto max-h-72 whitespace-pre-wrap break-all font-mono text-muted-foreground">
                          {file.original ? truncateCode(file.original, 3000) : "(file not previously loaded)"}
                        </pre>
                      </div>
                      <div className="p-3">
                        <p className="text-xs font-semibold text-green-500 mb-2">AFTER</p>
                        <pre className="text-xs bg-green-500/5 rounded p-3 overflow-x-auto max-h-72 whitespace-pre-wrap break-all font-mono text-foreground">
                          {truncateCode(file.rewritten, 3000)}
                        </pre>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}

            {fileApprovals.length === 0 ? (
              <div className="rounded-lg border border-border/30 bg-muted/10 p-6 text-sm text-muted-foreground">
                No safe rewrites were necessary from this scan.
              </div>
            ) : null}
          </div>

          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={() => setStep(2)}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Back
            </Button>
            <Button className="flex-1 gradient-phoenix text-primary-foreground" size="lg" disabled={pushing || approvedCount === 0} onClick={handlePushApproved}>
              {pushing ? <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Pushing to Shopify...</> : <><Send className="h-5 w-5 mr-2" /> Push {approvedCount} File{approvedCount !== 1 ? "s" : ""} to Store</>}
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );

  const renderStep4 = () => (
    <motion.div key="step4" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} className="space-y-6">
      <Card className="bg-card/50 border-border/30">
        <CardContent className="p-6 space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-lg gradient-phoenix flex items-center justify-center">
              <CheckCircle2 className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <h2 className="font-bold text-xl">Theme Updated</h2>
              <p className="text-sm text-muted-foreground">Approved Automated Architect changes have been pushed to Shopify.</p>
            </div>
          </div>

          {pushResult ? (
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

              {pushResult.appliedFiles?.length ? (
                <div className="space-y-2">
                  <h3 className="font-semibold text-sm">Applied Files</h3>
                  {pushResult.appliedFiles.map((file) => (
                    <div key={file} className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      <code className="text-xs bg-muted/50 px-2 py-0.5 rounded">{file}</code>
                    </div>
                  ))}
                </div>
              ) : null}

              {pushResult.errors?.length ? (
                <div className="space-y-2">
                  <h3 className="font-semibold text-sm text-destructive">Errors</h3>
                  {pushResult.errors.map((error, index) => (
                    <p key={index} className="text-xs text-destructive/80">{error}</p>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}

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
    <div className="space-y-6 max-w-6xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Flame className="h-6 w-6 text-primary" /> Phoenix Flow Templanator
        </h1>
        <p className="text-muted-foreground mt-1">Automated Architect mode for speed integrity, legal anchors, and niche partition prep.</p>
        {selectedStore ? <p className="text-xs text-muted-foreground mt-2">Active store: {selectedStore.shop_name || selectedStore.shop_domain || "Shopify store"}</p> : null}
      </motion.div>

      <div className="flex items-center gap-2">
        {STEPS.map((stepItem, index) => (
          <div key={stepItem.num} className="flex items-center gap-2 flex-1">
            <div className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${step >= stepItem.num ? "gradient-phoenix text-primary-foreground" : "bg-muted/50 text-muted-foreground"}`}>
              {step > stepItem.num ? <CheckCircle2 className="h-4 w-4" /> : stepItem.num}
            </div>
            <span className={`text-xs font-medium hidden sm:inline ${step >= stepItem.num ? "text-foreground" : "text-muted-foreground"}`}>{stepItem.label}</span>
            {index < STEPS.length - 1 ? <div className={`flex-1 h-px ${step > stepItem.num ? "bg-primary" : "bg-border/30"}`} /> : null}
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {step === 1 ? renderStep1() : null}
        {step === 2 ? renderStep2() : null}
        {step === 3 ? renderStep3() : null}
        {step === 4 ? renderStep4() : null}
      </AnimatePresence>
    </div>
  );
}

function ArchitectPanel({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: typeof Gauge;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <Card className="bg-card/50 border-border/30">
      <CardContent className="p-6 space-y-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/15 flex items-center justify-center">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold">{title}</h3>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <div className="space-y-2">{children}</div>
      </CardContent>
    </Card>
  );
}

function StatusText({ ok, okLabel, badLabel }: { ok: boolean; okLabel: string; badLabel: string }) {
  return <span className={ok ? "text-green-500" : "text-yellow-500"}>{ok ? okLabel : badLabel}</span>;
}

function truncateCode(code: string, maxLen: number): string {
  if (code.length <= maxLen) return code;
  return `${code.slice(0, maxLen)}\n\n... (truncated for display)`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function StatBox({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="p-3 rounded-lg bg-muted/30 text-center">
      <p className="text-lg font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
      {sub ? <p className="text-xs text-yellow-500">{sub}</p> : null}
    </div>
  );
}
