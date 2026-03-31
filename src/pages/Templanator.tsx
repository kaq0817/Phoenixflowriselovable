import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CopyButton, copyAllFields } from "@/components/CopyButton";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { storeDomainFacts } from "@/config/appIdentity";
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
type RecordType = "CNAME" | "A";
type PillarLaunchMode = "decide" | "launch" | "keep-main" | "hold";

interface PlannerCategory {
  id: string;
  title: string;
  handle: string;
  productsCount: number;
  source: "manual" | "detected";
}

interface SubdomainPlanItem {
  title: string;
  handle: string;
  productsCount: number;
  launchMode: PillarLaunchMode;
  suggestedLabel: string;
  subdomainLabel: string;
  hostname: string;
  routePath: string;
  recordType: RecordType;
  target: string;
  proxied: boolean;
}

interface RouteVerificationState {
  hostname: string;
  routePath: string;
  verified: boolean;
  checking: boolean;
  httpStatus?: number;
  finalUrl?: string;
  message: string;
}

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
  const [baseDomainConfirmed, setBaseDomainConfirmed] = useState(false);
  const [baseDomainChecking, setBaseDomainChecking] = useState(false);
  const [baseDomainStatus, setBaseDomainStatus] = useState("");
  const [cloudflareTargetHost, setCloudflareTargetHost] = useState("");
  const [cloudflareTargetConfirmed, setCloudflareTargetConfirmed] = useState(false);
  const [cloudflareTargetChecking, setCloudflareTargetChecking] = useState(false);
  const [cloudflareTargetStatus, setCloudflareTargetStatus] = useState("");
  const [cloudflareRecordType, setCloudflareRecordType] = useState<RecordType>("CNAME");
  const [cloudflareProxyEnabled, setCloudflareProxyEnabled] = useState(false);
  const [plannerCategories, setPlannerCategories] = useState<PlannerCategory[]>([]);
  const [showDetectedSuggestions, setShowDetectedSuggestions] = useState(false);
  const [manualCategoryDraft, setManualCategoryDraft] = useState("");
  const [pillarSubdomainOverrides, setPillarSubdomainOverrides] = useState<Record<string, string>>({});
  const [pillarRouteOverrides, setPillarRouteOverrides] = useState<Record<string, string>>({});
  const [subdomainNotes, setSubdomainNotes] = useState("");
  const [nichePalette, setNichePalette] = useState("default");
  const [blockWarmTones, setBlockWarmTones] = useState(true);
  const [customPalette, setCustomPalette] = useState(["#0B1D3A", "#7CFF00", "#00E5FF", "#F8FAFC"]);
  const [paletteColorOverrides, setPaletteColorOverrides] = useState<Record<string, string[]>>({});
  const [pillarPaletteOverrides, setPillarPaletteOverrides] = useState<Record<string, string>>({});
  const [routeVerification, setRouteVerification] = useState<Record<string, RouteVerificationState>>({});
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
  const normalizedBaseDomain = useMemo(
    () => (baseDomainConfirmed ? normalizeDomainInput(baseDomain) : ""),
    [baseDomain, baseDomainConfirmed],
  );
  const normalizedTargetHost = useMemo(
    () => (cloudflareTargetConfirmed ? normalizeDomainInput(cloudflareTargetHost) : ""),
    [cloudflareTargetHost, cloudflareTargetConfirmed],
  );
  const subdomainPlan = useMemo<SubdomainPlanItem[]>(
    () =>
      plannerCategories.map((pillar) => {
        const subdomainLabel = sanitizeSubdomainLabel(
          pillarSubdomainOverrides[pillar.handle] || "",
        );
        const routePath = normalizeRouteInput(
          pillarRouteOverrides[pillar.handle],
          shortenCollectionRoute(pillar.handle),
        );

        return {
          title: pillar.title,
          handle: pillar.handle,
          productsCount: pillar.productsCount,
          launchMode: "launch",
          suggestedLabel: sanitizeSubdomainLabel(pillar.handle || pillar.title),
          subdomainLabel,
          hostname: normalizedBaseDomain && subdomainLabel ? `${subdomainLabel}.${normalizedBaseDomain}` : "",
          routePath,
          recordType: cloudflareRecordType,
          target: normalizedTargetHost,
          proxied: cloudflareProxyEnabled,
        };
      }),
    [
      plannerCategories,
      pillarSubdomainOverrides,
      pillarRouteOverrides,
      normalizedBaseDomain,
      cloudflareRecordType,
      normalizedTargetHost,
      cloudflareProxyEnabled,
    ],
  );
  const cloudflareDnsPlan = useMemo(
    () =>
      subdomainPlan
        .filter((item) => item.hostname && item.target)
        .map((item) => formatCloudflareRecord(item))
        .join("\n"),
    [subdomainPlan],
  );
  const cloudflareRoutingBrief = useMemo(
    () =>
      subdomainPlan
        .map((item, index) => {
          const hostLabel = item.hostname || `[set-subdomain-${index + 1}]`;
          const targetLabel = item.target || "[set-target-host]";
          return `${index + 1}. ${item.title}\nHost: ${hostLabel}\nDNS: ${item.recordType} -> ${targetLabel} (${item.proxied ? "Proxied" : "DNS only"})\nStorefront route: ${item.routePath}`;
        })
        .join("\n\n"),
    [subdomainPlan],
  );
  const cloudflarePlanPacket = useMemo(
    () =>
      copyAllFields([
        { label: "Base Domain", value: normalizedBaseDomain },
        { label: "Cloudflare Target Host", value: normalizedTargetHost },
        { label: "Record Type", value: cloudflareRecordType },
        { label: "Proxy Mode", value: cloudflareProxyEnabled ? "Proxied" : "DNS only" },
        { label: "DNS Records", value: cloudflareDnsPlan },
        { label: "Routing Brief", value: cloudflareRoutingBrief },
        { label: "Launch Notes", value: subdomainNotes.trim() },
      ]),
    [
      normalizedBaseDomain,
      normalizedTargetHost,
      cloudflareRecordType,
      cloudflareProxyEnabled,
      cloudflareDnsPlan,
      cloudflareRoutingBrief,
      subdomainNotes,
    ],
  );
  const knownStoreDomains = useMemo(
    () => storeDomainFacts.map((fact) => fact.host).filter(Boolean),
    [],
  );
  const verifiedRouteCount = useMemo(
    () =>
      subdomainPlan.filter((item) => {
        const verification = routeVerification[item.handle];
        return Boolean(
          verification &&
            verification.verified &&
            verification.hostname === item.hostname &&
            verification.routePath === item.routePath,
        );
      }).length,
    [subdomainPlan, routeVerification],
  );
  const allPlannedRoutesVerified = subdomainPlan.length > 0 && verifiedRouteCount === subdomainPlan.length;
  const subdomainPlanReady =
    baseDomainConfirmed &&
    cloudflareTargetConfirmed &&
    plannerCategories.length > 0 &&
    allPlannedRoutesVerified;

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
    if (!selectedStore?.shop_domain) return;
    setCloudflareTargetHost((prev) => prev || selectedStore.shop_domain || "");
  }, [selectedStore]);

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
      setPlannerCategories([]);
      setManualCategoryDraft("");

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
      setAssistantAnswer(buildLocalFindingsExplanation(scanResult, selectedStore));
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

  const addPlannerCategory = (category: PlannerCategory) => {
    setPlannerCategories((prev) => {
      if (prev.some((entry) => entry.handle === category.handle || entry.title.toLowerCase() === category.title.toLowerCase())) {
        return prev;
      }
      return [...prev, category];
    });
  };

  const addDetectedPlannerCategory = (title: string, handle: string, productsCount: number) => {
    addPlannerCategory({
      id: `detected:${handle}`,
      title,
      handle,
      productsCount,
      source: "detected",
    });
  };

  const addManualPlannerCategories = () => {
    const entries = manualCategoryDraft
      .split(/\r?\n|,/)
      .map((value) => value.trim())
      .filter(Boolean);

    if (entries.length === 0) return;

    entries.forEach((title) => {
      const handle = sanitizeSubdomainLabel(title);
      addPlannerCategory({
        id: `manual:${handle}`,
        title,
        handle,
        productsCount: 0,
        source: "manual",
      });
    });

    setManualCategoryDraft("");
  };

  const removePlannerCategory = (handle: string) => {
    setPlannerCategories((prev) => prev.filter((entry) => entry.handle !== handle));
  };

  const verifyHostname = async (hostname: string) => {
    const normalized = normalizeDomainInput(hostname);
    if (!normalized) {
      throw new Error("Enter a hostname first.");
    }

    const { data, error } = await supabase.functions.invoke("verify-domain-target", {
      body: { hostname: normalized },
    });
    if (error) throw error;
    return data as { hostname: string; exists: boolean; aRecords: string[]; cnameRecords: string[] };
  };

  const handleVerifyBaseDomain = async () => {
    if (baseDomainChecking) return;
    setBaseDomainChecking(true);
    setBaseDomainConfirmed(false);
    setBaseDomainStatus("");
    try {
      const result = await verifyHostname(baseDomain);
      if (!result.exists) throw new Error(`Zone not found: ${result.hostname}`);
      setBaseDomainConfirmed(true);
      setBaseDomainStatus(`Found ${result.hostname}`);
    } catch (err: unknown) {
      setBaseDomainStatus(getErrorMessage(err));
      toast({ title: "Zone check failed", description: getErrorMessage(err), variant: "destructive" });
    } finally {
      setBaseDomainChecking(false);
    }
  };

  const handleVerifyTargetHost = async () => {
    if (cloudflareTargetChecking) return;
    setCloudflareTargetChecking(true);
    setCloudflareTargetConfirmed(false);
    setCloudflareTargetStatus("");
    try {
      const result = await verifyHostname(cloudflareTargetHost);
      if (!result.exists) throw new Error(`Target not found: ${result.hostname}`);
      setCloudflareTargetConfirmed(true);
      setCloudflareTargetStatus(`Found ${result.hostname}`);
    } catch (err: unknown) {
      setCloudflareTargetStatus(getErrorMessage(err));
      toast({ title: "Target check failed", description: getErrorMessage(err), variant: "destructive" });
    } finally {
      setCloudflareTargetChecking(false);
    }
  };

  const verifyStorefrontRoute = async (item: SubdomainPlanItem) => {
    if (!item.hostname) {
      throw new Error("Set the hostname first.");
    }

    const { data, error } = await supabase.functions.invoke("verify-storefront-route", {
      body: { hostname: item.hostname, routePath: item.routePath },
    });
    if (error) throw error;
    return data as {
      hostname: string;
      routePath: string;
      ok: boolean;
      status: number;
      finalUrl: string;
      matchedHost: boolean;
      matchedRoute: boolean;
      message: string;
    };
  };

  const handleVerifyStorefrontRoute = async (item: SubdomainPlanItem) => {
    setRouteVerification((prev) => ({
      ...prev,
      [item.handle]: {
        hostname: item.hostname,
        routePath: item.routePath,
        verified: false,
        checking: true,
        message: "Checking live storefront route...",
      },
    }));

    try {
      const result = await verifyStorefrontRoute(item);
      setRouteVerification((prev) => ({
        ...prev,
        [item.handle]: {
          hostname: item.hostname,
          routePath: item.routePath,
          verified: result.ok,
          checking: false,
          httpStatus: result.status,
          finalUrl: result.finalUrl,
          message: result.message,
        },
      }));

      if (!result.ok) {
        toast({
          title: "Route check failed",
          description: `${item.hostname}${item.routePath} did not resolve to the intended collection route.`,
          variant: "destructive",
        });
      }
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      setRouteVerification((prev) => ({
        ...prev,
        [item.handle]: {
          hostname: item.hostname,
          routePath: item.routePath,
          verified: false,
          checking: false,
          message,
        },
      }));
      toast({ title: "Route check failed", description: message, variant: "destructive" });
    }
  };

  const handleVerifyAllStorefrontRoutes = async () => {
    for (const item of subdomainPlan) {
      await handleVerifyStorefrontRoute(item);
    }
  };

  const toggleFileExpanded = (index: number) => {
    setFileApprovals((prev) => prev.map((file, i) => (i === index ? { ...file, expanded: !file.expanded } : file)));
  };

  const setAllFileApprovals = (approved: boolean) => {
    setFileApprovals((prev) => prev.map((file) => ({ ...file, approved })));
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

  const renderPreviewCard = (track: FixTrack) => {
    if (previewTrack !== track) return null;

    return (
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

          {fileApprovals.length > 0 ? (
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" size="sm" onClick={() => setAllFileApprovals(true)}>
                Approve All
              </Button>
              <Button variant="outline" size="sm" onClick={() => setAllFileApprovals(false)}>
                Clear Approvals
              </Button>
              <Button
                className="gradient-phoenix text-primary-foreground"
                size="sm"
                disabled={approvedCount === 0}
                onClick={() => setStep(5)}
              >
                Continue to Push This Pass
              </Button>
            </div>
          ) : null}

          <div className="space-y-3">
            {fileApprovals.map((file, index) => (
              <div key={file.key} className={`rounded-lg border transition-all ${file.approved ? "border-green-500/30 bg-green-500/5" : "border-border/20 bg-muted/10 opacity-60"}`}>
                <div className="flex items-center gap-3 p-4">
                  <div className="flex min-w-[80px] items-center gap-2">
                    <Switch checked={file.approved} onCheckedChange={() => toggleFileApproval(index)} />
                    <span className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Approve</span>
                  </div>
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
    );
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
                  disabled={Boolean(generatingTrack)}
                  onClick={() => handleGeneratePreview("lcp")}
                >
                  {generatingTrack === "lcp"
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Building LCP-only preview...</>
                    : <><Eye className="h-4 w-4 mr-2" /> Preview LCP Fix Only</>}
                </Button>
                <p className="text-xs text-muted-foreground">This pass only touches the detected LCP asset and any missing preload tag.</p>
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

          {renderPreviewCard("lcp")}

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

          {renderPreviewCard("domains")}

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

          {renderPreviewCard("remaining")}

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
                  <p className="text-sm text-muted-foreground">Set domain, add categories, copy DNS.</p>
              </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open("https://dash.cloudflare.com/", "_blank", "noopener")}
                >
                  Open Cloudflare
                </Button>
                <CopyButton text={cloudflareDnsPlan} label="DNS records" />
                <CopyButton text={cloudflareRoutingBrief} label="Routing brief" />
                <CopyButton text={cloudflarePlanPacket} label="Full plan" />
              </div>

              <div className="rounded-xl border border-border/30 bg-background/40 p-3 text-xs text-muted-foreground">
                {knownStoreDomains.length > 0
                  ? `Known store domains: ${knownStoreDomains.join(", ")}`
                  : "No store-domain facts configured."}
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-border/30 bg-muted/10 p-4 space-y-3">
                  <div>
                    <p className="text-sm font-semibold">1. Zone</p>
                    <p className="text-xs text-muted-foreground">Cloudflare zone.</p>
                  </div>
                  <Input
                    placeholder="e.g. ourphoenixrise.com"
                    className="bg-background/50"
                    value={baseDomain}
                    onChange={(e) => {
                      setBaseDomain(e.target.value);
                      setBaseDomainConfirmed(false);
                    }}
                  />
                  <div className="rounded-xl border border-border/30 bg-background/40 p-3 space-y-3">
                    <div>
                      <p className="text-sm font-medium">Use This Zone</p>
                      <p className="text-xs text-muted-foreground">
                        {normalizeDomainInput(baseDomain) || "Enter a base domain first."}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        className="gradient-phoenix text-primary-foreground"
                        disabled={!normalizeDomainInput(baseDomain)}
                        onClick={handleVerifyBaseDomain}
                      >
                        {baseDomainChecking ? "Checking..." : "Check Zone"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setBaseDomainConfirmed(false)}>
                        Clear
                      </Button>
                    </div>
                  </div>
                  <Badge variant={baseDomainConfirmed ? "secondary" : "outline"}>
                    {baseDomainConfirmed ? "zone verified" : "zone not verified"}
                  </Badge>
                  {baseDomainStatus ? <p className="text-xs text-muted-foreground">{baseDomainStatus}</p> : null}
                </div>

                <div className="rounded-2xl border border-border/30 bg-muted/10 p-4 space-y-3">
                  <div>
                    <p className="text-sm font-semibold">2. Target</p>
                    <p className="text-xs text-muted-foreground">Cloudflare target.</p>
                  </div>
                  <Input
                    placeholder="e.g. storefront-origin.example.com"
                    className="bg-background/50"
                    value={cloudflareTargetHost}
                    onChange={(e) => {
                      setCloudflareTargetHost(e.target.value);
                      setCloudflareTargetConfirmed(false);
                    }}
                  />
                  <div className="rounded-xl border border-border/30 bg-background/40 p-3 space-y-3">
                    <div>
                      <p className="text-sm font-medium">Use This Target</p>
                      <p className="text-xs text-muted-foreground">
                        {normalizeDomainInput(cloudflareTargetHost) || "Enter a target host first."}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        className="gradient-phoenix text-primary-foreground"
                        disabled={!normalizeDomainInput(cloudflareTargetHost)}
                        onClick={handleVerifyTargetHost}
                      >
                        {cloudflareTargetChecking ? "Checking..." : "Check Target"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setCloudflareTargetConfirmed(false)}>
                        Clear
                      </Button>
                    </div>
                  </div>
                  <Badge variant={cloudflareTargetConfirmed ? "secondary" : "outline"}>
                    {cloudflareTargetConfirmed ? "target verified" : "target not verified"}
                  </Badge>
                  {cloudflareTargetStatus ? <p className="text-xs text-muted-foreground">{cloudflareTargetStatus}</p> : null}
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-border/30 bg-muted/10 p-4 space-y-3">
                  <div>
                    <p className="text-sm font-semibold">3. What Categories Do You Want To Split Out?</p>
                    <p className="text-xs text-muted-foreground">One per line.</p>
                  </div>
                  <Textarea
                    className="min-h-[120px] bg-background/50"
                    placeholder={"Category One\nCategory Two\nCategory Three"}
                    value={manualCategoryDraft}
                    onChange={(e) => setManualCategoryDraft(e.target.value)}
                  />
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">Manual list.</p>
                    <Button className="gradient-phoenix text-primary-foreground" onClick={addManualPlannerCategories}>
                      Add Categories To Planner
                    </Button>
                  </div>
                </div>

                <div className="rounded-2xl border border-border/30 bg-muted/10 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">Scan Suggestions</p>
                      <p className="text-xs text-muted-foreground">Optional.</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setShowDetectedSuggestions((prev) => !prev)}>
                      {showDetectedSuggestions ? "Hide Suggestions" : "Show Suggestions"}
                    </Button>
                  </div>
                  {showDetectedSuggestions ? (
                    <div className="space-y-2">
                      {(scanResult.collectionPillars ?? []).length > 0 ? (
                        scanResult.collectionPillars.map((pillar) => (
                          <div key={pillar.handle} className="flex items-center justify-between gap-3 rounded-xl border border-border/30 bg-background/40 p-3">
                            <div>
                              <p className="text-sm font-medium">{pillar.title}</p>
                              <p className="text-xs text-muted-foreground">{pillar.productsCount} products</p>
                            </div>
                            <Button
                              size="sm"
                              className="gradient-phoenix text-primary-foreground"
                              onClick={() => addDetectedPlannerCategory(pillar.title, pillar.handle, pillar.productsCount)}
                            >
                              Add
                            </Button>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-muted-foreground">No suggestions returned.</p>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-border/30 bg-background/40 p-3 text-xs text-muted-foreground">
                      Hidden until you ask for them.
                    </div>
                  )}
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-4">
                <StatBox label="Pillars" value={subdomainPlan.length} sub="planned hosts" />
                <StatBox label="DNS Records" value={subdomainPlan.filter((item) => item.hostname && item.target).length} sub={cloudflareRecordType} />
                <StatBox label="Proxy" value={cloudflareProxyEnabled ? 1 : 0} sub={cloudflareProxyEnabled ? "proxied" : "dns only"} />
                <StatBox label="Target Host" value={normalizedTargetHost ? 1 : 0} sub={normalizedTargetHost || "not set"} />
              </div>

              {plannerCategories.length > 0 ? (
                <div className="rounded-2xl border border-border/30 bg-muted/10 p-4 space-y-3">
                  <div>
                    <p className="text-sm font-semibold">Current Planning Queue</p>
                    <p className="text-xs text-muted-foreground">Current categories.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {plannerCategories.map((category) => (
                      <Badge key={category.id} variant="secondary" className="px-3 py-1">
                        {category.title}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
                <div className="rounded-2xl border border-border/30 bg-muted/10 p-4 space-y-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-sm font-semibold">Cloudflare DNS Plan</p>
                      <p className="text-xs text-muted-foreground">Copy-ready records.</p>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-[160px_minmax(0,1fr)]">
                    <div className="space-y-2">
                      <label className="text-xs font-medium">Type</label>
                      <Select value={cloudflareRecordType} onValueChange={(value: RecordType) => setCloudflareRecordType(value)}>
                        <SelectTrigger className="bg-background/50">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="CNAME">CNAME</SelectItem>
                          <SelectItem value="A">A</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="rounded-xl border border-border/30 bg-background/40 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">Proxy Status</p>
                          <p className="text-xs text-muted-foreground">Default: DNS only.</p>
                        </div>
                        <Switch checked={cloudflareProxyEnabled} onCheckedChange={setCloudflareProxyEnabled} />
                      </div>
                    </div>
                  </div>

                  {cloudflareProxyEnabled ? (
                    <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-3 text-sm text-yellow-500">
                      Proxy is on. Standard Shopify usually stays DNS only.
                    </div>
                  ) : (
                    <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-3 text-sm text-green-500">
                      DNS only is active.
                    </div>
                  )}

                  <div className="rounded-xl border border-border/30 bg-background/40 p-3 space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Execution Sequence</p>
                    <p className="text-sm">1. Create records for <span className="font-medium">{normalizedBaseDomain || "[set base domain]"}</span>.</p>
                    <p className="text-sm">2. Point them to <span className="font-medium">{normalizedTargetHost || "[set target host]"}</span>.</p>
                    <p className="text-sm">3. Verify each subdomain resolves on the intended collection route.</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-border/30 bg-muted/10 p-4 space-y-4">
                  <div>
                    <p className="text-sm font-semibold">Routing Brief</p>
                    <p className="text-xs text-muted-foreground">Short copy block.</p>
                  </div>
                  <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-background/50 p-3 text-xs text-muted-foreground">
                    {cloudflareRoutingBrief || "Add a base domain to generate the routing brief."}
                  </pre>
                </div>
              </div>

              {subdomainPlan.length > 0 ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-semibold">Planned Categories</p>
                    <p className="text-xs text-muted-foreground">Only these are in plan.</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={allPlannedRoutesVerified ? "secondary" : "outline"}>
                      {verifiedRouteCount}/{subdomainPlan.length} routes verified
                    </Badge>
                    <Button
                      size="sm"
                      className="gradient-phoenix text-primary-foreground"
                      disabled={subdomainPlan.length === 0 || subdomainPlan.some((item) => routeVerification[item.handle]?.checking)}
                      onClick={handleVerifyAllStorefrontRoutes}
                    >
                      Check All Routes
                    </Button>
                  </div>

                  {subdomainPlan.map((pillar) => (
                    <div key={pillar.handle} className="rounded-2xl border border-border/30 bg-muted/10 p-4 space-y-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <p className="font-medium">{pillar.title}</p>
                          <p className="text-xs text-muted-foreground">Collection handle: {pillar.handle}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">{pillar.productsCount} products</Badge>
                          <Badge variant="outline">{plannerCategories.find((entry) => entry.handle === pillar.handle)?.source || "manual"}</Badge>
                          <Badge variant="outline">{pillar.recordType}</Badge>
                          <Badge variant="outline">{pillar.proxied ? "Proxied" : "DNS only"}</Badge>
                          <Button variant="ghost" size="sm" onClick={() => removePlannerCategory(pillar.handle)}>
                            Remove
                          </Button>
                        </div>
                      </div>

                      <div className="grid gap-4 lg:grid-cols-2">
                        <div className="space-y-2">
                          <label className="text-xs font-medium">Name</label>
                          <Input
                            className="bg-background/50"
                            placeholder={pillar.suggestedLabel || "set-subdomain"}
                            value={pillarSubdomainOverrides[pillar.handle] ?? pillar.subdomainLabel}
                            onChange={(e) =>
                              setPillarSubdomainOverrides((prev) => ({
                                ...prev,
                                [pillar.handle]: e.target.value,
                              }))
                            }
                          />
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setPillarSubdomainOverrides((prev) => ({
                                  ...prev,
                                  [pillar.handle]: pillar.suggestedLabel,
                                }))
                              }
                            >
                              Use Suggested Name
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground">Full hostname: {pillar.hostname || "Set zone + name."}</p>
                        </div>

                        <div className="space-y-2">
                          <label className="text-xs font-medium">Storefront Route</label>
                          <Input
                            className="bg-background/50"
                            value={pillarRouteOverrides[pillar.handle] ?? pillar.routePath}
                            onChange={(e) =>
                              setPillarRouteOverrides((prev) => ({
                                ...prev,
                                [pillar.handle]: e.target.value,
                              }))
                            }
                          />
                          <p className="text-xs text-muted-foreground">Landing path this subdomain should serve inside the storefront.</p>
                        </div>
                      </div>

                      <div className="rounded-xl border border-border/30 bg-background/40 p-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Cloudflare Record</p>
                        <p className="mt-2 break-all font-mono text-xs text-foreground">
                          {formatCloudflareRecord(pillar) || "Set zone, name, and target to generate the DNS record."}
                        </p>
                      </div>

                      <div className="rounded-xl border border-border/30 bg-background/40 p-3 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Live Route Check</p>
                            <p className="mt-1 text-sm">
                              {pillar.hostname || "[set hostname]"}
                              <span className="text-muted-foreground">{pillar.routePath}</span>
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={routeVerification[pillar.handle]?.verified ? "secondary" : "outline"}>
                              {routeVerification[pillar.handle]?.checking
                                ? "checking"
                                : routeVerification[pillar.handle]?.verified
                                  ? "route verified"
                                  : "not verified"}
                            </Badge>
                            <Button
                              size="sm"
                              className="gradient-phoenix text-primary-foreground"
                              disabled={!pillar.hostname || !pillar.routePath || routeVerification[pillar.handle]?.checking}
                              onClick={() => handleVerifyStorefrontRoute(pillar)}
                            >
                              {routeVerification[pillar.handle]?.checking ? "Checking..." : "Check Route"}
                            </Button>
                          </div>
                        </div>

                        {routeVerification[pillar.handle] ? (
                          <div className="space-y-1 text-xs text-muted-foreground">
                            <p>{routeVerification[pillar.handle].message}</p>
                            {routeVerification[pillar.handle].httpStatus ? (
                              <p>HTTP status: {routeVerification[pillar.handle].httpStatus}</p>
                            ) : null}
                            {routeVerification[pillar.handle].finalUrl ? (
                              <p className="break-all">Final URL: {routeVerification[pillar.handle].finalUrl}</p>
                            ) : null}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            This subdomain must resolve on the intended collection route before Step 4 is complete.
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No collection weights were returned from Shopify, so pillar suggestions are not ready yet.</p>
              )}

              <div className="space-y-2">
                <label className="text-xs font-medium">Launch Notes</label>
                <Textarea
                  className="min-h-[110px] bg-background/50"
                  placeholder="Write which subdomains go live first, what stays parked, and any Cloudflare exceptions."
                  value={subdomainNotes}
                  onChange={(e) => setSubdomainNotes(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">This gets included in the copied subdomain packet.</p>
              </div>

              {!subdomainPlanReady ? (
                <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-3 text-sm text-yellow-500">
                  Finish Step 4 by verifying the zone, verifying the target host, adding your categories, and checking that each live subdomain reaches its intended collection route.
                </div>
              ) : (
                <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-3 text-sm text-green-500">
                  Step 4 complete. Every planned subdomain route resolved live.
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex gap-3 justify-between">
            <Button variant="outline" onClick={() => setStep(3)}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Back
            </Button>
            <Button
              className="gradient-phoenix text-primary-foreground"
              disabled={!subdomainPlanReady}
              onClick={() => setStep(5)}
            >
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

function normalizeDomainInput(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
}

function sanitizeSubdomainLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeRouteInput(value: string | undefined, fallback: string): string {
  const candidate = (value || fallback || "").trim();
  if (!candidate) return "/";
  const prefixed = candidate.startsWith("/") ? candidate : `/${candidate}`;
  return prefixed.replace(/\/{2,}/g, "/");
}

function shortenCollectionRoute(handle: string): string {
  const compact = sanitizeSubdomainLabel(handle)
    .split("-")
    .filter(Boolean)
    .slice(0, 4)
    .join("-");
  return `/collections/${compact || "collection"}`;
}

function formatCloudflareRecord(item: SubdomainPlanItem): string {
  if (!item.hostname || !item.target) return "";
  return `${item.recordType} ${item.hostname} -> ${item.target} (${item.proxied ? "Proxied" : "DNS only"})`;
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
      const exactChanges = summarizeExactLineChanges(original, rewritten);
      if (exactChanges.length > 0) {
        notes.push(...exactChanges);
      } else {
        notes.push("Exact change summary unavailable. Open Diff for the concrete markup edit.");
      }
    }
  }

  return notes.join(" ");
}

function addsPattern(original: string, rewritten: string, pattern: RegExp): boolean {
  return !pattern.test(original) && pattern.test(rewritten);
}

function summarizeExactLineChanges(original: string, rewritten: string): string[] {
  const before = normalizeDiffLines(original);
  const after = normalizeDiffLines(rewritten);

  const added = after.filter((line) => !before.includes(line)).slice(0, 2);
  const removed = before.filter((line) => !after.includes(line)).slice(0, 2);
  const changes: string[] = [];

  for (const line of added) {
    changes.push(`Adds ${formatDiffSnippet(line)}.`);
  }

  for (const line of removed) {
    changes.push(`Removes ${formatDiffSnippet(line)}.`);
  }

  return changes;
}

function normalizeDiffLines(source: string): string[] {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^\{%\s*comment/i.test(line) && !/^\{%\s*endcomment/i.test(line));
}

function formatDiffSnippet(line: string): string {
  const collapsed = line.replace(/\s+/g, " ").trim();
  const shortened = collapsed.length > 90 ? `${collapsed.slice(0, 87)}...` : collapsed;
  return `\`${shortened}\``;
}

function buildLocalFindingsExplanation(scan: ScanResult, store: StoreConnection | null): string {
  const storeLabel = store?.shop_name || store?.shop_domain || "Shopify store";
  const lines: string[] = [`Findings for ${storeLabel}:`];

  if (scan.lcpCandidate) {
    const lcpFixes: string[] = [];
    if (!scan.lcpCandidate.hasFetchPriorityHigh) lcpFixes.push("add fetchpriority=high");
    if (scan.lcpCandidate.loadingMode !== "eager") lcpFixes.push("set loading=eager");
    if (!scan.lcpCandidate.preloadDetected) lcpFixes.push("add a preload tag in layout/theme.liquid");
    lines.push(`- LCP: ${scan.lcpCandidate.assetKey} is the current candidate. First fix: ${lcpFixes.length > 0 ? lcpFixes.join(", ") : "no change needed"}.`);
  } else {
    lines.push("- LCP: no clear candidate detected in the loaded theme assets.");
  }

  if (scan.stats.belowFoldImagesMissingLazy > 0) {
    lines.push(`- Lazy loading: ${scan.stats.belowFoldImagesMissingLazy} below-the-fold images still need loading=\"lazy\".`);
  }

  const fixablePolicies = scan.policyLinks.filter((link) => link.status === "dead-link-risk");
  const missingPolicies = scan.policyLinks.filter((link) => link.status === "missing");
  if (fixablePolicies.length > 0) {
    lines.push(`- Policy URLs: ${fixablePolicies.map((link) => `${link.label} -> ${link.targetPath}`).join("; ")}. First fix: rewrite the existing footer links to those Shopify policy routes.`);
  }
  if (missingPolicies.length > 0) {
    lines.push(`- Missing policies: ${missingPolicies.map((link) => link.label).join(", ")}. First fix: generate or attach them in Shopify Admin.`);
  }

  if (scan.crossStoreLinks.length > 0) {
    lines.push(`- Storefront links: ${scan.crossStoreLinks.length} hard-coded URLs still point off-store. First fix: rewrite them to the correct local storefront paths.`);
  }

  if (scan.stats.hardcodedColors > 10) {
    lines.push(`- Theme styling: ${scan.stats.hardcodedColors} hard-coded colors detected. First fix: move repeated colors into the generated palette stylesheet.`);
  }

  if (scan.stats.formsWithoutTracking > 0) {
    lines.push(`- Forms: ${scan.stats.formsWithoutTracking} forms are missing source tracking fields.`);
  }

  if (lines.length === 1) {
    lines.push("- No critical findings were reported.");
  }

  return lines.join("\n");
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








