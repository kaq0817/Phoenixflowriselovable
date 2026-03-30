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
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  FileCode,
  Flame,
  Gauge,
  Globe,
  Loader2,
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
import { appIdentityConfig } from "@/config/appIdentity";
import { appSupportConfig } from "@/config/appSupport";

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

type FixTrack = "lcp" | "domains" | "remaining";

const NICHE_PALETTES = [
  { label: "Keep Current", value: "default", desc: "Preserve existing store color scheme", colors: [], tags: ["neutral"] },
  { label: "Minimal / Clean", value: "minimal", desc: "White, light gray, subtle blue accents", colors: [], tags: ["neutral"] },
  { label: "Gaming / Cyberpunk", value: "cyberpunk", desc: "Pitch black, hot pink, neon cyan, dark violet", colors: [], tags: ["cool"] },
  { label: "Adventure / Camp", value: "adventure", desc: "Deep pine green, campfire orange, canvas khaki", colors: [], tags: ["warm"] },
  { label: "Bold / Streetwear", value: "streetwear", desc: "Stark black, pure white, hazard yellow, blood red", colors: [], tags: ["warm"] },
  { label: "Corporate / B2B", value: "corporate", desc: "Navy blue, steel gray, crisp white, subtle slate", colors: [], tags: ["cool"] },
  { label: "Medical / Pharmacy", value: "medical", desc: "Clinical white, cross red, sterile blue, soft gray", colors: [], tags: ["cool"] },
  { label: "Finance / Crypto", value: "finance", desc: "Deep emerald, coin gold, charcoal, stark white", colors: [], tags: ["warm"] },
  { label: "Nature / Eco", value: "eco", desc: "Earthy greens, warm browns, soft golds, leaf tones", colors: [], tags: ["warm"] },
  { label: "Zen / Wellness", value: "zen", desc: "Sage green, soft bamboo, seafoam, river stone", colors: [], tags: ["warm"] },
  { label: "Luxury / Elegant", value: "luxury", desc: "Obsidian black, champagne gold, ivory, deep burgundy", colors: [], tags: ["neutral"] },
  { label: "Artisan / Cafe", value: "cafe", desc: "Roasted brown, matcha green, oat milk, burnt sienna", colors: [], tags: ["warm"] },
  { label: "Studio / Audio", value: "audio", desc: "Midnight blue, brushed silver, crimson indicator red", colors: [], tags: ["cool"] },
  { label: "Publishing / Ink", value: "publishing", desc: "Warm parchment cream, sepia, deep navy text, slate", colors: [], tags: ["warm"] },
  { label: "Future / Tech", value: "tech", desc: "Gunmetal gray, stark white, electric blue, carbon fiber", colors: [], tags: ["cool"] },
  { label: "Playful / Pets", value: "pets", desc: "Sunny yellow, sky blue, bone white, soft teal", colors: [], tags: ["warm"] },
  { label: "Soft / Boutique", value: "boutique", desc: "Blush pink, muted lavender, warm white, rose gold", colors: [], tags: ["warm"] },
  { label: "Dark / Occult", value: "goth", desc: "Crimson blood, obsidian, pale silver moon, amethyst", colors: [], tags: ["neutral"] },
  { label: "Spring Bloom", value: "spring", desc: "Pastel pink, fresh mint, daffodil, soft lilac (Mar-May)", colors: [], tags: ["cool"] },
  { label: "Summer Heat", value: "summer", desc: "Ocean blue, bright coral, sunburst, crisp white (Jun-Aug)", colors: [], tags: ["warm"] },
  { label: "Autumn Harvest", value: "autumn", desc: "Burnt orange, rust red, goldenrod, oak brown (Sep-Nov)", colors: [], tags: ["warm"] },
  { label: "Winter Frost", value: "winter", desc: "Ice blue, stark white, brushed silver, evergreen (Dec-Feb)", colors: [], tags: ["cool"] },
  { label: "Festive / Holiday", value: "holiday", desc: "Classic crimson, pine green, warm gold, snow (Nov-Dec)", colors: [], tags: ["warm"] },
  { label: "Spooky / Halloween", value: "spooky", desc: "Pumpkin orange, midnight black, toxic green, violet (Oct)", colors: [], tags: ["warm"] },
  { label: "Romance / Valentine", value: "valentine", desc: "Deep rose, blush pink, pure white, subtle gold (Feb)", colors: [], tags: ["warm"] },
];

const STEPS = [
  { num: 1, label: "Theme Handshake", summary: "Import the live Shopify theme into the workflow." },
  { num: 2, label: "Policy Verification", summary: "Confirm policy links before applying any rewrites." },
  { num: 3, label: "Theme Fixes", summary: "Run the LCP pass first, then clean domains and handle the remaining fixes." },
  { num: 4, label: "Subdomain Separation", summary: "Review domain and pillar routing suggestions." },
  { num: 5, label: "Push to Store", summary: "Ship only the approved files back to Shopify." },
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
  const [blockWarmTones, setBlockWarmTones] = useState(true);
  const [customPalette, setCustomPalette] = useState(["#0B1D3A", "#7CFF00", "#00E5FF", "#F8FAFC"]);
  const [paletteColorOverrides, setPaletteColorOverrides] = useState<Record<string, string[]>>({});
  const [pillarPaletteOverrides, setPillarPaletteOverrides] = useState<Record<string, string>>({});
  const [departmentMappings, setDepartmentMappings] = useState<DepartmentMapping[]>([]);
  const [generatingTrack, setGeneratingTrack] = useState<FixTrack | null>(null);
  const [previewTrack, setPreviewTrack] = useState<FixTrack | null>(null);
  const [fileApprovals, setFileApprovals] = useState<FileApproval[]>([]);
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<PushResult | null>(null);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantAnswer, setAssistantAnswer] = useState("");
  const identityReady = Boolean(
    legalEntityName.trim() &&
      stateOfIncorporation.trim() &&
      supportLocation.trim() &&
      supportNumber.trim(),
  );

  const selectedStore = useMemo(
    () => connections.find((connection) => connection.id === selectedConn) ?? null,
    [connections, selectedConn],
  );
  const approvedCount = fileApprovals.filter((file) => file.approved).length;
  const policyGeneratorUrl = selectedStore?.shop_domain
    ? `https://${selectedStore.shop_domain}/admin/settings/legal`
    : "";
  const allPoliciesReady = Boolean(
    scanResult?.policyLinks?.length &&
      scanResult.policyLinks.every((link) => link.status === "ok"),
  );
  const brokenPolicyLinks = scanResult?.policyLinks.filter((link) => link.status !== "ok") ?? [];
  const brokenLinkCount = (scanResult?.crossStoreLinks.length ?? 0) + brokenPolicyLinks.length;
  const deferredBlogFiles = scanResult
    ? Array.from(
        new Set(
          [
            ...(scanResult.sections || []).filter(isBlogRelatedAssetKey),
            ...(scanResult.lcpCandidate && isBlogRelatedAssetKey(scanResult.lcpCandidate.assetKey) ? [scanResult.lcpCandidate.assetKey] : []),
            ...scanResult.crossStoreLinks.filter((link) => isBlogRelatedAssetKey(link.assetKey)).map((link) => link.assetKey),
          ],
        ),
      )
    : [];
  const previewTitle = previewTrack === "lcp"
    ? "LCP Preview"
    : previewTrack === "domains"
      ? "Broken Link Preview"
      : previewTrack === "remaining"
        ? "Remaining Fixes Preview"
        : "Preview Changes";
  const previewDescription = previewTrack === "lcp"
    ? "Review the LCP-only rewrite before moving to the broader cleanup pass."
    : previewTrack === "domains"
      ? "Review the broken-link rewrites before applying them."
      : previewTrack === "remaining"
        ? "Review the non-LCP rewrites before proceeding."
        : "Review the generated rewrites before proceeding.";
  const previewEmptyState = previewTrack === "lcp"
      ? "No LCP rewrite was needed. The detected LCP path is already clean."
    : previewTrack === "domains"
      ? "No broken-link rewrites were generated for this pass."
      : previewTrack === "remaining"
        ? "No remaining non-LCP rewrites were generated for this pass."
        : "No rewrites generated yet. Run a preview pass to inspect changes.";
  const pushTrackLabel = previewTrack === "lcp"
    ? "LCP pass"
    : previewTrack === "domains"
      ? "broken link pass"
      : previewTrack === "remaining"
        ? "remaining fixes pass"
        : "approved changes";
  const visiblePalettes = useMemo(
    () =>
      NICHE_PALETTES.filter((palette) => {
        if (blockWarmTones && palette.tags?.includes("warm")) return false;
        return true;
      }),
    [blockWarmTones],
  );
  const paletteChoices = useMemo(
    () => [
      ...visiblePalettes,
      {
        label: "Custom",
        value: "custom",
        desc: "Use your own hex colors",
        colors: customPalette,
        tags: ["neutral"],
      },
    ],
    [visiblePalettes, customPalette],
  );

  const resolvePaletteColors = (value: string) => {
    if (value === "custom") return customPalette;
    const override = paletteColorOverrides[value];
    if (override && override.length) return override.filter(Boolean);
    const palette = NICHE_PALETTES.find((entry) => entry.value === value);
    return palette?.colors ?? [];
  };

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

  useEffect(() => {
    const selected = NICHE_PALETTES.find((palette) => palette.value === nichePalette);
    if (blockWarmTones && selected?.tags?.includes("warm")) {
      setNichePalette("default");
      return;
    }
    if (!visiblePalettes.some((palette) => palette.value === nichePalette)) {
      setNichePalette("default");
    }
  }, [blockWarmTones, nichePalette, visiblePalettes]);

  const handleImportTheme = async () => {
    if (scanning) return;
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
      setPreviewTrack(null);
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

  const handleGeneratePreview = async (track: FixTrack, nextStep = 3) => {
    if (!scanResult) return;
    if (generatingTrack) return;
    if (track === "remaining" && !identityReady) {
      toast({ title: "Missing legal/support info", description: "Fill legal entity, state, support location, and support number.", variant: "destructive" });
      return;
    }
    setGeneratingTrack(track);

    try {
      const paletteSelection = {
        id: nichePalette,
        colors: resolvePaletteColors(nichePalette),
      };
      const pillarPalettes = Object.entries(pillarPaletteOverrides).reduce<Record<string, { id: string; colors: string[] }>>(
        (acc, [handle, value]) => {
          if (!value || value === "inherit") return acc;
          const colors = resolvePaletteColors(value);
          if (colors.length === 0) return acc;
          acc[handle] = { id: value, colors };
          return acc;
        },
        {},
      );

      const { data: result, error } = await supabase.functions.invoke("apply-theme-fixes", {
        body: {
          connectionId: selectedConn,
          themeId: scanResult.themeId,
          assets: scanResult.assets,
          mode: track,
          businessInfo: {
            legalEntityName,
            stateOfIncorporation,
            supportLocation,
            supportNumber,
            departmentMappings,
            nichePalette,
            paletteSelection,
            pillarPalettes,
          },
        },
      });
      if (error) throw error;

      const approvals: FileApproval[] = Object.entries(result.rewrittenFiles || {}).map(
        ([key, rewritten]) => ({
          key,
          original: scanResult.assets[key] || null,
          rewritten: rewritten as string,
          approved: false,
          expanded: false,
        })
      );

      setPushResult(null);
      setPreviewTrack(track);
      setFileApprovals(approvals);
      setStep(nextStep);
      toast({
        title: track === "lcp" ? "LCP preview ready" : "Preview ready",
        description: approvals.length > 0
          ? `${approvals.length} files staged for review.`
          : track === "lcp"
              ? "No LCP rewrite was needed."
            : track === "domains"
              ? "No broken-link rewrite was needed."
            : "No remaining non-LCP rewrites were needed.",
      });
    } catch (err: unknown) {
      toast({ title: "Preview failed", description: getErrorMessage(err), variant: "destructive" });
    } finally {
      setGeneratingTrack(null);
    }
  };

  const handleExplainFindings = async () => {
    if (!scanResult) return;
    if (assistantLoading) return;
    setAssistantLoading(true);
    setAssistantAnswer("");

    try {
      const question = buildFindingsQuestion(scanResult, selectedStore);
      const { data, error } = await supabase.functions.invoke("answer-app-question", {
        body: {
          question,
          identity: appIdentityConfig,
          support: appSupportConfig,
        },
      });
      if (error) throw error;
      if (!data?.answer) throw new Error("Assistant did not return an answer");
      setAssistantAnswer(data.answer as string);
    } catch (err: unknown) {
      toast({ title: "Assistant failed", description: getErrorMessage(err), variant: "destructive" });
    } finally {
      setAssistantLoading(false);
    }
  };

  const handlePushApproved = async () => {
    if (!scanResult) return;
    if (pushing) return;
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

      setScanResult((prev) => (
        prev
          ? {
              ...prev,
              assets: {
                ...prev.assets,
                ...approvedFiles,
              },
            }
          : prev
      ));
      setPushResult(result as PushResult);
      setStep(5);
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

  const resetSession = () => {
    setStep(1);
    setScanResult(null);
    setFileApprovals([]);
    setPushResult(null);
    setGeneratingTrack(null);
    setPreviewTrack(null);
    setAssistantAnswer("");
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

          <Button className="w-full gradient-phoenix text-primary-foreground" size="lg" onClick={handleImportTheme}>
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
                <Shield className="h-5 w-5 text-primary" />
                <h3 className="font-semibold">Policy Verification</h3>
                <Badge variant="secondary" className="ml-auto">{scanResult.themeName}</Badge>
              </div>

              <p className="text-sm text-muted-foreground">
                Verify that the required Shopify policy pages are present. Existing footer links with the wrong target can be auto-fixed. Only truly missing policies need Shopify Admin.
              </p>

              {allPoliciesReady ? (
                <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-3 text-sm text-green-500">
                  All policies verified: pass.
                </div>
              ) : null}

              <div className="space-y-2">
                {scanResult.policyLinks.map((link) => (
                  <div key={link.label} className="rounded-md bg-muted/20 p-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{link.label}</span>
                      <Badge variant={link.status === "ok" ? "secondary" : "destructive"}>
                        {link.status === "ok" ? "pass" : link.status === "missing" ? "missing" : "fixable"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">Target: {link.targetPath}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {link.status === "ok"
                        ? "Already points to the correct Shopify policy route."
                        : link.status === "missing"
                          ? "No matching footer link was found. Create the policy in Shopify Admin if it does not exist yet."
                          : `Existing footer link found. Templanator can rewrite it to ${link.targetPath}.`}
                    </p>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  {allPoliciesReady
                    ? "Policies verified. Continue to Theme Fixes."
                    : "Fixable policy URLs can be rewritten automatically. Missing policies still need Shopify Admin."}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => policyGeneratorUrl && window.open(policyGeneratorUrl, "_blank", "noopener")}
                >
                  Open Shopify Policy Generator
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-3 justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Back
            </Button>
            <Button className="gradient-phoenix text-primary-foreground" onClick={() => setStep(3)}>
              Continue to Theme Fixes
            </Button>
          </div>
        </>
      ) : null}
    </motion.div>
  );

  const renderStep3 = () => (
    <motion.div key="step3" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} className="space-y-6">
      {scanResult ? (
        <>
          <Card className="bg-card/50 border-border/30">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
                <h3 className="font-semibold">Theme Fix Targets</h3>
                <Badge variant="secondary" className="ml-auto">{scanResult.themeName}</Badge>
              </div>

              <div className="space-y-2">
                {scanResult.scanIssues.map((issue, index) => (
                  <div key={index} className="flex items-start gap-2 text-sm">
                    <Zap className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">{issue}</span>
                  </div>
                ))}
                {scanResult.scanIssues.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No critical fix targets were detected in this scan.</p>
                ) : null}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">Need a plain-English breakdown of what to fix first?</p>
                <Button size="sm" variant="outline" onClick={handleExplainFindings}>
                  {assistantLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Explaining...</> : <><Bot className="mr-2 h-4 w-4" /> Explain Findings</>}
                </Button>
              </div>

              {assistantAnswer ? (
                <div className="whitespace-pre-wrap rounded-lg bg-muted/20 p-4 text-sm text-foreground">
                  {assistantAnswer}
                </div>
              ) : null}

              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 pt-2">
                <StatBox label="Images" value={scanResult.stats.totalImages} sub={`${scanResult.stats.belowFoldImagesMissingLazy} below-fold missing lazy`} />
                <StatBox label="Hard Colors" value={scanResult.stats.hardcodedColors} />
                <StatBox label="Inline Styles" value={scanResult.stats.inlineStyles} />
                <StatBox label="Untracked Forms" value={scanResult.stats.formsWithoutTracking} />
                <StatBox label="Broken Links" value={brokenLinkCount} sub={`${scanResult.stats.crossStoreLinkCount} wrong-store URLs`} />
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <ArchitectPanel icon={Gauge} title="LCP Focus" subtitle="Largest Contentful Paint candidate only">
              {scanResult.lcpCandidate ? (
                <>
                  <p className="text-sm"><span className="font-medium">LCP asset:</span> <span className="text-muted-foreground break-all">{scanResult.lcpCandidate.assetKey}</span></p>
                  <p className="text-sm"><span className="font-medium">Priority:</span> <StatusText ok={scanResult.lcpCandidate.hasFetchPriorityHigh} okLabel="fetchpriority=high present" badLabel="needs fetchpriority=high" /></p>
                  <p className="text-sm"><span className="font-medium">Loading:</span> <StatusText ok={scanResult.lcpCandidate.loadingMode === "eager"} okLabel="loading=eager present" badLabel={`currently ${scanResult.lcpCandidate.loadingMode}`} /></p>
                  <p className="text-sm"><span className="font-medium">Preload:</span> <StatusText ok={scanResult.lcpCandidate.preloadDetected} okLabel="head preload found" badLabel="preload missing" /></p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No strong above-the-fold image candidate found.</p>
              )}
              <div className="pt-2">
                <Button
                  className="w-full"
                  variant="outline"
                  disabled={Boolean(generatingTrack) || Boolean(scanResult.lcpCandidate && isBlogRelatedAssetKey(scanResult.lcpCandidate.assetKey))}
                  onClick={() => handleGeneratePreview("lcp")}
                >
                  {generatingTrack === "lcp"
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Building LCP-only preview...</>
                    : <><Eye className="h-4 w-4 mr-2" /> Preview LCP Fix Only</>}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {scanResult.lcpCandidate && isBlogRelatedAssetKey(scanResult.lcpCandidate.assetKey)
                    ? "The current LCP candidate lives in a blog-related theme section, so this pass is deferred until after subdomain and blog organization are established."
                    : "This pass only touches the detected LCP asset and any missing preload tag."}
                </p>
              </div>
            </ArchitectPanel>

            <ArchitectPanel icon={Gauge} title="Lazy-Loading Sweep" subtitle="Below-the-fold image hygiene">
              <p className="text-sm">
                <span className="font-medium">Below fold:</span>{" "}
                <span className="text-muted-foreground">{scanResult.stats.belowFoldImagesMissingLazy} images still need loading="lazy".</span>
              </p>
              <p className="text-xs text-muted-foreground">This is separate from LCP and can be handled independently.</p>
            </ArchitectPanel>
          </div>

          {brokenLinkCount > 0 ? (
            <Card className="bg-card/50 border-border/30">
              <CardContent className="p-6 space-y-3">
                <div className="flex items-center gap-3">
                  <Globe className="h-5 w-5 text-primary" />
                  <div>
                    <h3 className="font-semibold">Broken Links</h3>
                    <p className="text-xs text-muted-foreground">Wrong-store URLs can be rewritten. Missing or off-target policy links are listed separately below.</p>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground space-y-2">
                  <p>Wrong-store links are hard-coded URLs in the theme that send customers to the wrong storefront, brand surface, or support path.</p>
                  <p>Policy link risks are footer links that are missing or pointing at the wrong policy route.</p>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Wrong-Store URLs</p>
                    {scanResult.crossStoreLinks.length > 0 ? (
                      scanResult.crossStoreLinks.slice(0, 5).map((link) => (
                        <div key={`${link.assetKey}-${link.url}`} className="rounded-md bg-muted/20 p-2 text-sm">
                          <p className="font-medium">{link.domain}</p>
                          <p className="text-xs text-muted-foreground truncate">{link.assetKey}</p>
                          <p className="text-xs text-muted-foreground truncate">{link.url}</p>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-md bg-muted/20 p-3 text-xs text-muted-foreground">
                        No wrong-store URLs were detected in the loaded theme assets.
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Policy Link Risks</p>
                    {brokenPolicyLinks.length > 0 ? (
                      brokenPolicyLinks.map((link) => (
                        <div key={`${link.label}-${link.targetPath}`} className="rounded-md bg-muted/20 p-2 text-sm">
                          <p className="font-medium">{link.label}</p>
                          <p className="text-xs text-muted-foreground">Target: {link.targetPath}</p>
                          <p className="text-xs text-muted-foreground">
                            {link.status === "missing"
                              ? "Missing from footer. Create or attach this policy in Shopify Admin."
                              : `Currently points to ${link.href || "an unknown URL"}.`}
                          </p>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-md bg-muted/20 p-3 text-xs text-muted-foreground">
                        No policy link risks were detected.
                      </div>
                    )}
                  </div>
                </div>
                <div className="pt-2">
                  <Button
                    className="w-full"
                    variant="outline"
                    disabled={Boolean(generatingTrack)}
                    onClick={() => handleGeneratePreview("domains")}
                  >
                    {generatingTrack === "domains"
                      ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Building broken-link preview...</>
                      : <><Eye className="h-4 w-4 mr-2" /> Preview Broken Link Fixes</>}
                  </Button>
                  <p className="text-xs text-muted-foreground">This pass rewrites wrong-store URLs to relative theme paths. Missing policy pages still need Shopify Admin if the policy does not exist yet.</p>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {deferredBlogFiles.length > 0 ? (
            <Card className="bg-card/50 border-border/30">
              <CardContent className="p-6 space-y-3">
                <div className="flex items-center gap-3">
                  <Workflow className="h-5 w-5 text-primary" />
                  <div>
                    <h3 className="font-semibold">Deferred Blog Layout Files</h3>
                    <p className="text-xs text-muted-foreground">Blog-related theme files are intentionally excluded from the automated repair passes until after subdomain separation.</p>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground space-y-2">
                  <p>Shopify blog posts are content records, not theme files, so these edits would not delete posts.</p>
                  <p>The risk is changing blog presentation too early, before you decide how blogs should be split across sections or subdomains.</p>
                </div>
                <div className="space-y-2">
                  {deferredBlogFiles.map((fileKey) => (
                    <div key={fileKey} className="rounded-md bg-muted/20 p-2 text-sm">
                      <p className="font-medium">{fileKey}</p>
                      <p className="text-xs text-muted-foreground">Deferred until after Step 4 establishes domain and blog structure.</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card className="bg-card/50 border-border/30">
            <CardContent className="p-6 space-y-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center">
                  <Shield className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h2 className="font-bold text-lg">Step 3: Theme Fix Inputs</h2>
                  <p className="text-sm text-muted-foreground">Set legal anchors, support copy, and palette before generating the rewrite preview.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4 p-4 rounded-lg border border-primary/20 bg-primary/5">
                  <h3 className="font-semibold text-sm flex items-center gap-2"><Shield className="h-4 w-4 text-primary" /> Legal Anchors</h3>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Legal Entity Name</label>
                    <Input placeholder="e.g. Go Hard Gaming Discord" className="bg-background/50" value={legalEntityName} onChange={(e) => setLegalEntityName(e.target.value)} />
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

              {!identityReady ? (
                <p className="text-xs text-muted-foreground">
                  Fill legal entity, state, support location, and support number to unlock the remaining non-LCP fix pass.
                </p>
              ) : null}

              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep(2)}>
                  <ArrowLeft className="h-4 w-4 mr-2" /> Back
                </Button>
                <Button
                  className="flex-1 gradient-phoenix text-primary-foreground"
                  size="lg"
                  disabled={Boolean(generatingTrack)}
                  onClick={() => handleGeneratePreview("remaining")}
                >
                  {generatingTrack === "remaining"
                    ? <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Building remaining fixes...</>
                    : <><Eye className="h-5 w-5 mr-2" /> Preview Remaining Fixes</>}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card/50 border-border/30">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center">
                  <Eye className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h2 className="font-bold text-lg">{previewTitle}</h2>
                  <p className="text-sm text-muted-foreground">{previewDescription}</p>
                  <p className="text-xs text-muted-foreground">Approve each file individually. Nothing is pre-approved.</p>
                </div>
                <Badge className="ml-auto" variant="secondary">{approvedCount}/{fileApprovals.length} approved</Badge>
              </div>

              <div className="space-y-3">
                {fileApprovals.map((file, index) => (
                  <div key={file.key} className={`rounded-lg border transition-all ${file.approved ? "border-green-500/30 bg-green-500/5" : "border-border/20 bg-muted/10 opacity-60"}`}>
                    <div className="flex items-center gap-3 p-4">
                      <Switch checked={file.approved} onCheckedChange={() => toggleFileApproval(index)} />
                      <div className="flex-1">
                        <code className="text-sm font-mono">{file.key}</code>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {summarizePreviewChanges({
                            file,
                            previewTrack,
                            lcpAssetKey: scanResult?.lcpCandidate?.assetKey || null,
                          })}
                        </p>
                      </div>
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
                    {previewEmptyState}
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={() => setStep(2)}>
              Back to Policy Verification
            </Button>
            <Button className="gradient-phoenix text-primary-foreground" onClick={() => setStep(4)}>
              Continue to Subdomain Separation
            </Button>
          </div>
        </>
      ) : null}
    </motion.div>
  );

  const renderStep4 = () => (
    <motion.div key="step4" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} className="space-y-6">
      {scanResult ? (
        <>
          <Card className="bg-card/50 border-border/30">
            <CardContent className="p-6 space-y-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center">
                  <Workflow className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h2 className="font-bold text-lg">Step 4: Subdomain & Content Separation</h2>
                  <p className="text-sm text-muted-foreground">Define your base domain and review pillar separation for content routing.</p>
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

              {scanResult.collectionPillars.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium">Detected Pillar Opportunities</p>
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

              <div className="text-xs text-muted-foreground">
                Palette controls are managed in the theme editor and not set in this step.
              </div>

              {deferredBlogFiles.length > 0 ? (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
                  <p className="font-medium">Blog organization comes after this step.</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Once the base domain and pillar routing are set, the deferred blog-related theme files can be reviewed against the new section and subdomain plan.
                  </p>
                </div>
              ) : null}

              <div className="text-xs text-muted-foreground">
                Automated blog-layout rewrites are intentionally held back here to avoid premature blog restructuring.
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-3 justify-between">
            <Button variant="outline" onClick={() => setStep(3)}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Back
            </Button>
            <Button className="gradient-phoenix text-primary-foreground" onClick={() => setStep(5)}>
              Continue to Push
            </Button>
          </div>
        </>
      ) : null}
    </motion.div>
  );

  const renderStep5 = () => (
    <motion.div key="step5" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} className="space-y-6">
      {!pushResult ? (
        <Card className="bg-card/50 border-border/30">
          <CardContent className="p-6 space-y-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <Send className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h2 className="font-bold text-lg">Step 5: Push to Store</h2>
                <p className="text-sm text-muted-foreground">Push the approved rewrites to Shopify.</p>
              </div>
            </div>

            <div className="rounded-lg bg-muted/20 p-4 text-sm">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{pushTrackLabel}</p>
              <p className="font-medium">Approved sections: {approvedCount}/{fileApprovals.length}</p>
              {approvedCount > 0 ? (
                <div className="mt-2 space-y-1">
                  {fileApprovals.filter((file) => file.approved).map((file) => (
                    <div key={file.key} className="text-xs text-muted-foreground">{file.key}</div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">No files approved yet. Go back to Theme Fixes to approve changes.</p>
              )}
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(4)}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Back
              </Button>
              <Button className="flex-1 gradient-phoenix text-primary-foreground" size="lg" onClick={handlePushApproved}>
                {pushing ? <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Pushing to Shopify...</> : <><Send className="h-5 w-5 mr-2" /> Push Approved Files</>}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-card/50 border-border/30">
          <CardContent className="p-6 space-y-6">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-lg gradient-phoenix flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-primary-foreground" />
              </div>
              <div>
                <h2 className="font-bold text-xl">
                  {previewTrack === "lcp" ? "LCP Pass Updated" : previewTrack === "domains" ? "Broken Link Pass Updated" : "Theme Updated"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {previewTrack === "lcp"
                    ? "The LCP-only pass has been pushed. You can return to Theme Fixes for the remaining cleanup pass."
                    : previewTrack === "domains"
                      ? "The broken-link pass has been pushed. Return to Theme Fixes if you want to continue with the remaining rewrites."
                    : "Approved Automated Architect changes have been pushed to Shopify."}
                </p>
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

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setStep(3)}>
                {previewTrack === "lcp" ? "Continue to Remaining Fixes" : previewTrack === "domains" ? "Back to Theme Fixes" : "Back to Theme Fixes"}
              </Button>
              <Button variant="outline" className="flex-1" onClick={resetSession}>
                <Flame className="h-4 w-4 mr-2" /> Start New Session
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </motion.div>
  );

  const renderCurrentStep = () => {
    if (step === 1) return renderStep1();
    if (step === 2) return renderStep2();
    if (step === 3) return renderStep3();
    if (step === 4) return renderStep4();
    return renderStep5();
  };

  const sessionLabel = selectedStore?.shop_name || selectedStore?.shop_domain || "New session";
  const completedSteps = STEPS.filter((item) => step > item.num).length;
  const sessionStatus = pushResult
    ? "Updated"
    : previewTrack === "lcp"
      ? "LCP pass complete"
      : previewTrack === "domains"
        ? "Broken link pass ready"
        : scanResult
          ? "In progress"
          : "Pending";

  return (
    <div className="mx-auto max-w-7xl">
      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <motion.aside initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
          <Card className="border-border/40 bg-card/80 shadow-sm">
            <CardContent className="space-y-5 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl gradient-phoenix">
                  <Flame className="h-5 w-5 text-primary-foreground" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Phoenix Flow</p>
                  <p className="text-xs text-muted-foreground">Templanator</p>
                </div>
              </div>

              <Button className="w-full gradient-phoenix text-primary-foreground" size="lg" onClick={resetSession}>
                <Flame className="mr-2 h-4 w-4" /> New Session
              </Button>

              <div className="space-y-2 border-t border-border/40 pt-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Menu</p>
                <div className="rounded-xl border border-border/30 bg-muted/20 p-3">
                  <p className="text-sm font-medium">Overview</p>
                  <p className="mt-1 text-xs text-muted-foreground">LCP-first theme repair workflow for Shopify storefronts.</p>
                </div>
              </div>

              <div className="space-y-3 border-t border-border/40 pt-4">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Active Session</p>
                  <Badge variant="secondary">{completedSteps}/{STEPS.length} done</Badge>
                </div>

                <button
                  type="button"
                  className="w-full rounded-2xl border border-primary/20 bg-primary/10 px-4 py-3 text-left transition-colors hover:bg-primary/15"
                  onClick={() => setStep(Math.max(step, 1))}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{sessionLabel}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{sessionStatus}</p>
                    </div>
                    <Store className="mt-0.5 h-4 w-4 text-primary" />
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {selectedStore?.shop_domain || "Connect a Shopify store, run the LCP pass, then clear the remaining fixes."}
                  </p>
                </button>

                {connections.filter((connection) => connection.id !== selectedConn).slice(0, 2).map((connection) => (
                  <div key={connection.id} className="rounded-2xl border border-border/30 bg-muted/10 px-4 py-3">
                    <p className="text-sm font-medium">{connection.shop_name || connection.shop_domain || "Shopify store"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Available</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.aside>

        <div className="space-y-6">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <Flame className="h-6 w-6 text-primary" /> Phoenix Flow Templanator
            </h1>
            <p className="text-muted-foreground">Keep the current site colors, but move through the repair flow one step at a time with LCP isolated from the rest.</p>
            {selectedStore ? <p className="text-xs text-muted-foreground">Active store: {selectedStore.shop_name || selectedStore.shop_domain || "Shopify store"}</p> : null}
          </motion.div>

          <div className="relative pl-6 sm:pl-10">
            <div className="absolute bottom-0 left-[11px] top-0 w-px bg-border/40 sm:left-[19px]" />
            <AnimatePresence mode="wait" initial={false}>
              <div className="space-y-5">
                {STEPS.map((stepItem) => {
                  const isActive = step === stepItem.num;
                  const isComplete = step > stepItem.num;

                  return (
                    <div key={stepItem.num} className="relative">
                      <div className={`absolute left-[-6px] top-5 flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold sm:left-[-2px] sm:h-10 sm:w-10 sm:text-sm ${
                        isComplete
                          ? "border-primary bg-primary text-primary-foreground"
                          : isActive
                            ? "border-primary/50 bg-primary/15 text-primary"
                            : "border-border/50 bg-background text-muted-foreground"
                      }`}>
                        {isComplete ? <CheckCircle2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> : stepItem.num}
                      </div>

                      <div className="pl-8 sm:pl-12">
                        {isActive ? (
                          <div className="space-y-3">
                            <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3">
                              <p className="text-sm font-semibold">{stepItem.num}. {stepItem.label}</p>
                              <p className="mt-1 text-xs text-muted-foreground">{stepItem.summary}</p>
                            </div>
                            {renderCurrentStep()}
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="w-full rounded-2xl border border-border/40 bg-card/70 px-4 py-5 text-left shadow-sm transition-colors hover:bg-card"
                            onClick={() => setStep(stepItem.num)}
                          >
                            <div className="flex items-center justify-between gap-4">
                              <div>
                                <p className="text-base font-semibold">{stepItem.num}. {stepItem.label}</p>
                                <p className="mt-1 text-sm text-muted-foreground">{stepItem.summary}</p>
                              </div>
                              <Badge variant={isComplete ? "secondary" : "outline"}>{isComplete ? "Done" : "Open"}</Badge>
                            </div>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </AnimatePresence>
          </div>
        </div>
      </div>
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

function summarizePreviewChanges(input: {
  file: FileApproval;
  previewTrack: FixTrack | null;
  lcpAssetKey: string | null;
}): string {
  const original = input.file.original || "";
  const rewritten = input.file.rewritten;
  const notes: string[] = [];

  if (input.previewTrack === "lcp") {
    if (input.file.key === input.lcpAssetKey) {
      notes.push("Reason: this file contains the current Largest Contentful Paint candidate.");
      if (addsPattern(original, rewritten, /\bloading\s*=\s*["']eager["']|loading\s*:\s*['"]eager['"]/i)) {
        notes.push("Promotes the detected LCP image to eager loading.");
      }
      if (addsPattern(original, rewritten, /\bfetchpriority\s*=\s*["']high["']|fetchpriority\s*:\s*['"]high['"]/i)) {
        notes.push("Adds high fetch priority to the detected LCP image.");
      }
    }

    if (input.file.key === "layout/theme.liquid" && addsPattern(original, rewritten, /rel=["']preload["'][^>]*as=["']image["']/i)) {
      notes.push("Reason: the layout controls the document head.");
      notes.push("Adds an image preload tag in the document head for the detected LCP asset.");
    }
  }

  if (input.previewTrack === "domains") {
    notes.push("Reason: this file contains hard-coded storefront URLs that should not point off-site.");
    notes.push("Rewrites hard-coded wrong-store URLs in this file to relative theme paths.");
  }

  if (input.previewTrack === "remaining") {
    if (input.file.key === "sections/footer.liquid") {
      notes.push("Reason: the footer owns support identity and policy navigation.");
      notes.push("Normalizes footer policy links and updates the compliance block.");
    }
    if (addsPattern(original, rewritten, /\bloading\s*=\s*["']lazy["']|loading\s*:\s*['"]lazy['"]/i)) {
      notes.push("Reason: below-the-fold imagery in this file should not compete with primary content.");
      notes.push("Adds lazy-loading to below-the-fold images in this file.");
    }
    if (input.file.key === "assets/phoenix-palettes.css") {
      notes.push("Reason: the selected palette needs a generated stylesheet.");
      notes.push("Generates the Phoenix palette stylesheet for the selected theme colors.");
    }
    if (input.file.key === "layout/theme.liquid" && addsPattern(original, rewritten, /phoenix-palettes\.css/i)) {
      notes.push("Reason: the layout must load the generated palette stylesheet.");
      notes.push("Injects the generated palette stylesheet into the theme layout.");
    }
  }

  if (notes.length === 0) {
    if (input.file.key === "sections/footer.liquid" && rewritten.includes("phoenix-flow-identity-block")) {
      notes.push("Updates the footer support and policy markup.");
    } else {
      notes.push("Review the diff for the exact markup changes in this file.");
    }
  }

  return notes.join(" ");
}

function addsPattern(original: string, rewritten: string, pattern: RegExp): boolean {
  return !pattern.test(original) && pattern.test(rewritten);
}

function isBlogRelatedAssetKey(assetKey: string): boolean {
  return /(^|\/)(blog|article|featured-blog|main-blog|main-article)/i.test(assetKey);
}

function buildFindingsQuestion(scan: ScanResult, store: StoreConnection | null): string {
  const storeLabel = store?.shop_name || store?.shop_domain || "Shopify store";
  const issueLines = scan.scanIssues.length > 0
    ? scan.scanIssues.map((issue, index) => `${index + 1}. ${issue}`).join("\n")
    : "No issues were reported.";
  const lcp = scan.lcpCandidate
    ? `LCP candidate asset: ${scan.lcpCandidate.assetKey}; loading=${scan.lcpCandidate.loadingMode}; fetchpriority_high=${scan.lcpCandidate.hasFetchPriorityHigh}; preload=${scan.lcpCandidate.preloadDetected}.`
    : "No LCP candidate detected.";
  const crossStore = scan.crossStoreLinks.length > 0
    ? scan.crossStoreLinks.slice(0, 5).map((link) => `${link.domain} (${link.assetKey})`).join("; ")
    : "No external domain references detected.";
  const policy = scan.policyLinks.length > 0
    ? scan.policyLinks.map((link) => `${link.label}: ${link.status}`).join("; ")
    : "No policy link data.";

  return [
    `Explain the Templanator Architect Findings for ${storeLabel}.`,
    "Use plain English and short bullets.",
    "List each finding with what it means and the first fix to apply.",
    "Do not invent data or routes.",
    "",
    "Findings:",
    issueLines,
    "",
    `Details: ${lcp}`,
    `Policy links: ${policy}`,
    `External domain references: ${crossStore}`,
  ].join("\n");
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








