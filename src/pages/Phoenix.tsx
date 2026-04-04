import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Zap, Loader2, CheckCircle, AlertTriangle, TrendingUp, XCircle,
  ShoppingBag, Store, Image as ImageIcon, Sparkles, ChevronDown, ChevronUp,
  Wrench, Check, ArrowRight, Copy
} from "lucide-react";
import { copyAllFields } from "@/components/CopyButton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface ShopifyProduct {
  id: number;
  title: string;
  body_html: string;
  status?: string;
  metafields_global_description_tag?: string;
  variants: { id: number; title: string; price: string; inventory_quantity: number; option1?: string; option2?: string }[];
  images: { id: number; src: string; alt?: string; position?: number }[];
  handle: string;
  tags: string | string[];
  product_type?: string;
}

interface EtsyListing {
  listing_id: number;
  title: string;
  description: string;
  tags: string[];
  materials: string[];
  taxonomy_path?: string;
  images?: { url_170x135?: string; url_570xN?: string }[];
}

interface SEOScore {
  total: number;
  title: boolean;
  titleLength: boolean;
  altText: boolean;
  description: boolean;
  descriptionLength: boolean;
  tags: boolean;
  variants: boolean;
  images: boolean;
  issues: string[];
  suggestions: string[];
}

interface Fix {
  title?: string;
  description?: string;
  body_html?: string;
  tags?: string | string[];
  materials?: string[];
  product_type?: string;
  seo_title?: string;
  seo_description?: string;
  image_alts?: string;
  image_filenames?: string;
  reasoning?: string;
}

type Platform = "shopify" | "etsy";

interface StoreConnectionOption {
  id: string;
  platform: Platform;
  shop_domain: string | null;
  shop_name: string | null;
  scopes: string | null;
  created_at: string;
}

function isUsableEtsyConnection(connection: StoreConnectionOption): boolean {
  return connection.platform === "etsy" && !!connection.shop_domain && !!connection.scopes?.includes("shops_r");
}

function isApparelProduct(product: ShopifyProduct): boolean {
  const haystack = `${product.title || ""} ${product.product_type || ""} ${product.tags || ""}`.toLowerCase();
  return ["shirt", "tee", "hoodie", "sweatshirt", "sweater", "jacket", "dress", "pants", "leggings", "shorts", "top", "tank", "skirt", "apparel", "clothing", "beanie", "hat", "cap", "jersey"].some((term) => haystack.includes(term));
}

const APPAREL_COLORS = [
  "black", "white", "red", "blue", "green", "yellow", "orange", "purple", "pink", "brown", "tan", "beige",
  "gold", "silver", "gray", "grey", "navy", "teal", "maroon", "burgundy", "olive", "cream", "ivory", "khaki",
  "charcoal", "lavender", "mint", "coral", "turquoise", "bronze", "rose gold",
];

const APPAREL_SIZES = ["xxs", "xs", "s", "m", "l", "xl", "xxl", "xxxl", "4xl", "5xl"];

function titleHasApparelColor(title: string): boolean {
  const normalized = title.toLowerCase();
  return APPAREL_COLORS.some((color) => normalized.includes(color));
}

function titleHasApparelSize(title: string): boolean {
  const normalized = title.toLowerCase();
  const rangeMatch = normalized.match(/\b((?:xxs|xs|s|m|l|xl|xxl|xxxl|4xl|5xl|\d+))\s*-\s*((?:xxs|xs|s|m|l|xl|xxl|xxxl|4xl|5xl|\d+))\b/);
  if (rangeMatch) return true;
  for (const size of APPAREL_SIZES) {
    const pattern = new RegExp(`(^|[^a-z0-9])${size}([^a-z0-9]|$)`, "i");
    if (pattern.test(normalized)) return true;
  }
  return /\b\d{1,3}\b/.test(normalized);
}

function normalizeShopifyTags(tags: ShopifyProduct["tags"] | string[] | null | undefined): string[] {
  if (Array.isArray(tags)) {
    return tags.map((tag) => `${tag}`.trim()).filter(Boolean);
  }

  return `${tags || ""}`
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function scoreShopifyProduct(p: ShopifyProduct): SEOScore {
  const issues: string[] = [];
  let score = 100;

  // 1) Identity mismatch: LLC suffix in title
  const hasIdentityMismatch = /iron\s*phoenix\s*ghg/i.test(p.title || "") || /\b(inc|llc|ghg\s*customs?)\b/i.test(p.title || "");
  if (hasIdentityMismatch) {
    score -= 40;
    issues.push("Identity Mismatch: Title contains LLC suffix (High Risk)");
  }

  // 2) Draft penalty
  const isDraft = p.status?.toLowerCase() === "draft";
  if (isDraft) {
    score -= 30;
    issues.push("Product is a Draft — not live in your store");
  }

  // 3) Search & discovery: minimum 5 tags
  const parsedTags = normalizeShopifyTags(p.tags);
  const tagCount = parsedTags.length;
  if (tagCount < 5) {
    score -= 25;
    issues.push(`Low Search Signal: Only ${tagCount} tags found (Need 5+)`);
  }

  // 4) Content quality
  const strippedDesc = (p.body_html || "").replace(/<[^>]*>/g, "").trim();
  if (strippedDesc.length < 150) {
    score -= 15;
    issues.push("Description is too thin for SEO/Google compliance");
  }

  // 5) Image SEO
  const hasImages = (p.images?.length || 0) > 0;
  const missingAlts = p.images?.some((img) => !img.alt || img.alt.trim() === "") ?? false;
  if (missingAlts) {
    score -= 15;
    issues.push("Missing Image Alt text — hurts Google Image Search");
  }

  const hasTitle = (p.title?.trim()?.length || 0) > 0;
  if (!hasTitle) {
    score -= 10;
    issues.push("Product has no title");
  }

  const total = Math.max(0, score);
  return {
    total,
    title: hasTitle,
    titleLength: hasTitle,
    altText: !missingAlts,
    description: strippedDesc.length > 0,
    descriptionLength: strippedDesc.length >= 150,
    tags: tagCount >= 5,
    variants: (p.variants?.length || 0) > 1,
    images: hasImages,
    issues,
    suggestions: [],
  };
}

function scoreEtsyListing(l: EtsyListing): SEOScore {
  const issues: string[] = [];
  const suggestions: string[] = [];
  let points = 0;
  const maxPoints = 8;
  const title = l.title?.trim() || "";
  const hasTitle = title.length > 0;
  const titleLength = title.length >= 20 && title.length <= 140;
  if (hasTitle) points++; else issues.push("Missing title");
  if (titleLength) points++; else if (hasTitle) { issues.push(`Title: ${title.length} chars (aim 20-140)`); suggestions.push("Front-load keywords"); }
  const hasImages = (l.images?.length || 0) > 0;
  if (hasImages) { points++; points++; } else { issues.push("No images"); suggestions.push("Add high-quality photos"); }
  const desc = l.description?.trim() || "";
  const hasDesc = desc.length > 0;
  const descLength = desc.length >= 100;
  if (hasDesc) points++; else issues.push("Missing description");
  if (descLength) points++; else if (hasDesc) { issues.push("Description too short"); suggestions.push("Write 200+ chars"); }
  const tagCount = l.tags?.length || 0;
  const hasTags = tagCount >= 10;
  if (hasTags) points++; else { issues.push(`Only ${tagCount}/13 tags`); suggestions.push("Use all 13 tag slots"); }
  const hasMaterials = (l.materials?.length || 0) > 0;
  if (hasMaterials) points++; else { issues.push("No materials"); suggestions.push("Add specific materials"); }
  const total = Math.round((points / maxPoints) * 100);
  return { total, title: hasTitle, titleLength, altText: false, description: hasDesc, descriptionLength: descLength, tags: hasTags, variants: hasMaterials, images: hasImages, issues, suggestions };
}


function getScoreColor(score: number) {
  if (score >= 85) return "text-phoenix-success";
  if (score >= 60) return "text-phoenix-warning";
  return "text-destructive";
}
function getScoreLabel(score: number) {
  if (score >= 85) return "Elite";
  if (score >= 60) return "Good";
  return "Critical";
}
function getScoreBadgeClass(score: number) {
  if (score >= 85) return "bg-phoenix-success/10 text-phoenix-success border-phoenix-success/30";
  if (score >= 60) return "bg-phoenix-warning/10 text-phoenix-warning border-phoenix-warning/30";
  return "bg-destructive/10 text-destructive border-destructive/30";
}
function getScoreIcon(score: number) {
  if (score >= 85) return <CheckCircle className="h-4 w-4 text-phoenix-success" />;
  if (score >= 60) return <TrendingUp className="h-4 w-4 text-phoenix-warning" />;
  return <AlertTriangle className="h-4 w-4 text-destructive" />;
}

export default function PhoenixPage() {
  const { session } = useAuth();
  const { toast } = useToast();

  const [platform, setPlatform] = useState<Platform>("shopify");
  const [connections, setConnections] = useState<Record<Platform, boolean>>({ shopify: false, etsy: false });
  const [storeConnections, setStoreConnections] = useState<StoreConnectionOption[]>([]);
  const [selectedShopifyConnectionId, setSelectedShopifyConnectionId] = useState("");
  const [selectedEtsyConnectionId, setSelectedEtsyConnectionId] = useState("");
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [shopifyProducts, setShopifyProducts] = useState<ShopifyProduct[]>([]);
  const [etsyListings, setEtsyListings] = useState<EtsyListing[]>([]);
  const [shopifyScores, setShopifyScores] = useState<Map<number, SEOScore>>(new Map());
  const [etsyScores, setEtsyScores] = useState<Map<number, SEOScore>>(new Map());
  const [scanned, setScanned] = useState(false);
  const [expandedProduct, setExpandedProduct] = useState<number | null>(null);

  // Fix state per product
  const [fixLoading, setFixLoading] = useState<Set<number>>(new Set());
  const [fixes, setFixes] = useState<Map<number, Fix>>(new Map());
  const [applyLoading, setApplyLoading] = useState<Set<number>>(new Set());
  const [applied, setApplied] = useState<Set<number>>(new Set());
  const [bulkPublishing, setBulkPublishing] = useState(false);
  const [availableChannels, setAvailableChannels] = useState<{ id: number; name: string }[]>([]);
  const [selectedChannelIds, setSelectedChannelIds] = useState<Set<number>>(new Set());
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [scoreFilter, setScoreFilter] = useState<number | null>(85);

  // On mount, only load store connections, do NOT auto-trigger scan or product fetch
  useEffect(() => {
    if (!session) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("store_connections")
        .select("id, platform, shop_domain, shop_name, scopes, created_at")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false });
      const allRows = (data || []) as StoreConnectionOption[];
      const rows = allRows.filter((c) => c.platform === "shopify" || isUsableEtsyConnection(c));
      const conn: Record<Platform, boolean> = {
        shopify: rows.some((c) => c.platform === "shopify"),
        etsy: rows.some((c) => c.platform === "etsy"),
      };
      setConnections(conn);
      setStoreConnections(rows);
      const firstShopify = rows.find((c) => c.platform === "shopify");
      const firstEtsy = rows.find((c) => c.platform === "etsy");
      setSelectedShopifyConnectionId(firstShopify?.id || "");
      setSelectedEtsyConnectionId(firstEtsy?.id || "");
      if (!conn.shopify && conn.etsy) setPlatform("etsy");
      setLoading(false);
    })();
  }, [session]);

  // Only run scan on explicit user action
  const handleScan = async () => {
    setScanning(true);
    setScanned(false);
    setFixes(new Map());
    setApplied(new Set());
    try {
      if (platform === "shopify" && connections.shopify) {
        const { data, error } = await supabase.functions.invoke("fetch-shopify-products", { body: { limit: 10, connectionId: selectedShopifyConnectionId || undefined } });
        if (error) throw error;
        const products: ShopifyProduct[] = data.products || [];
        setShopifyProducts(products);
        const scores = new Map<number, SEOScore>();
        products.forEach((p) => scores.set(p.id, scoreShopifyProduct(p)));
        setShopifyScores(scores);
        // Load available sales channels for this store
        setChannelsLoading(true);
        try {
          const { data: chData } = await supabase.functions.invoke("fetch-shopify-channels", {
            body: { connectionId: selectedShopifyConnectionId || undefined },
          });
          const IGNORED = ["google", "facebook", "instagram"];
          setAvailableChannels((chData?.publications || []).filter((ch: { id: number; name: string }) =>
            !IGNORED.some((term) => ch.name.toLowerCase().includes(term))
          ));
          setSelectedChannelIds(new Set());
        } catch { /* non-critical */ } finally {
          setChannelsLoading(false);
        }
      }
      if (platform === "etsy" && connections.etsy) {
        const { data, error } = await supabase.functions.invoke("fetch-etsy-listings", { body: { limit: 10, state: "active", connectionId: selectedEtsyConnectionId || undefined } });
        if (error) throw error;
        const listings: EtsyListing[] = data.results || [];
        setEtsyListings(listings);
        const scores = new Map<number, SEOScore>();
        listings.forEach((l) => scores.set(l.listing_id, scoreEtsyListing(l)));
        setEtsyScores(scores);
      }
      setScanned(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An unknown error occurred";
      toast({ title: "Scan failed", description: message, variant: "destructive" });
    } finally {
      setScanning(false);
    }
  };

  // Generate AI fix for a single product
  const handleGenerateFix = async (id: number) => {
    setFixLoading((prev) => new Set(prev).add(id));
    try {
      if (platform === "shopify") {
        const product = shopifyProducts.find((p) => p.id === id);
        if (!product) return;
        const { data, error } = await supabase.functions.invoke("optimize-shopify-listing", { 
          body: { 
            product, 
            connectionId: selectedShopifyConnectionId, // From your store selector
            shopName: storeConnections.find((c) => c.id === selectedShopifyConnectionId)?.shop_name || "" // From your store selector
          } 
        });
        if (error) throw error;
        setFixes((prev) => new Map(prev).set(id, data.suggestions));
      } else {
        const listing = etsyListings.find((l) => l.listing_id === id);
        if (!listing) return;
        const { data, error } = await supabase.functions.invoke("optimize-etsy-listing", { body: { listing } });
        if (error) throw error;
        setFixes((prev) => new Map(prev).set(id, data.suggestions));
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An unknown error occurred";
      toast({ title: "AI fix failed", description: message, variant: "destructive" });
    } finally {
      setFixLoading((prev) => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  // Apply fix to store
  const handleApplyFix = async (id: number) => {
    const fix = fixes.get(id);
    if (!fix) return;
    setApplyLoading((prev) => new Set(prev).add(id));
    try {
      if (platform === "shopify") {
        const { error } = await supabase.functions.invoke("apply-shopify-changes", { body: { productId: id, optimizedData: fix, connectionId: selectedShopifyConnectionId || undefined } });
        if (error) throw error;
      } else {
        const listing = etsyListings.find((l) => l.listing_id === id);
        const { error } = await supabase.functions.invoke("apply-etsy-changes", {
          body: { listingId: id, originalData: listing, optimizedData: fix, connectionId: selectedEtsyConnectionId || undefined },
        });
        if (error) throw error;
      }
      setApplied((prev) => new Set(prev).add(id));
      toast({ title: "✅ Fixed!", description: "Changes pushed to your store." });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An unknown error occurred";
      toast({ title: "Apply failed", description: message, variant: "destructive" });
    } finally {
      setApplyLoading((prev) => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  // Publish all scanned products to selected channels only
  const handlePublishAll = async () => {
    if (!selectedShopifyConnectionId || shopifyProducts.length === 0 || selectedChannelIds.size === 0) return;
    setBulkPublishing(true);
    try {
      const targetPubs = availableChannels.filter((p) => selectedChannelIds.has(p.id));
      let published = 0;
      let skipped = 0;
      for (const product of shopifyProducts) {
        const { data: chData } = await supabase.functions.invoke("fetch-shopify-channels", {
          body: { connectionId: selectedShopifyConnectionId, productId: product.id },
        });
        const alreadyIn: number[] = chData?.publishedPublicationIds || [];
        for (const pub of targetPubs) {
          if (alreadyIn.includes(pub.id)) { skipped++; continue; }
          await supabase.functions.invoke("apply-shopify-channels", {
            body: { connectionId: selectedShopifyConnectionId, productId: product.id, publicationId: pub.id, action: "publish" },
          });
          published++;
        }
      }
      toast({ title: "Channels updated", description: `Published ${published} product${published !== 1 ? "s" : ""} to ${targetPubs.map(p => p.name).join(", ")}${skipped > 0 ? ` (${skipped} already active)` : ""}.` });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Publish failed";
      toast({ title: "Publish failed", description: message, variant: "destructive" });
    } finally {
      setBulkPublishing(false);
    }
  };

  // Fix all products scoring below threshold
  const handleFixAll = async () => {
    const ids: number[] = [];
    if (platform === "shopify") {
      shopifyProducts.forEach((p) => {
        const score = shopifyScores.get(p.id);
        if (score && score.total < 85) ids.push(p.id);
      });
    } else {
      etsyListings.forEach((l) => {
        const score = etsyScores.get(l.listing_id);
        if (score && score.total < 85) ids.push(l.listing_id);
      });
    }
    for (const id of ids) {
      if (!fixes.has(id)) await handleGenerateFix(id);
    }
    toast({ title: "All fixes generated", description: "Review each product and click Apply to push changes." });
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  const noConnections = !connections.shopify && !connections.etsy;
  const shopifyStoreOptions = storeConnections.filter((c) => c.platform === "shopify");
  const etsyStoreOptions = storeConnections.filter((c) => c.platform === "etsy");
  const allScores = Array.from(platform === "shopify" ? shopifyScores.values() : etsyScores.values());
  const avgScore = allScores.length > 0 ? Math.round(allScores.reduce((a, b) => a + b.total, 0) / allScores.length) : 0;
  const needAttention = allScores.filter((s) => s.total < 85).length;
  const productCount = platform === "shopify" ? shopifyProducts.length : etsyListings.length;

  const renderComparisonRow = (label: string, current: string, optimized: string) => (
    <div className="grid grid-cols-[100px_1fr_auto_1fr] gap-2 items-start text-sm py-2 border-b border-border/10 last:border-0">
      <span className="text-muted-foreground font-medium">{label}</span>
      <span className="text-muted-foreground/70 line-through decoration-destructive/40">{current || "—"}</span>
      <ArrowRight className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
      <span className="text-foreground font-medium">{optimized || "—"}</span>
    </div>
  );

  const renderProductCard = (id: number, title: string, imgSrc: string | undefined, score: SEOScore) => {
    const expanded = expandedProduct === id;
    const fix = fixes.get(id);
    const isFixing = fixLoading.has(id);
    const isApplying = applyLoading.has(id);
    const isApplied = applied.has(id);

    return (
      <div key={id} className="rounded-lg border border-border/20 overflow-hidden">
        <button
          className="w-full flex items-center gap-3 p-3 bg-muted/20 hover:bg-muted/40 transition-colors text-left"
          onClick={() => setExpandedProduct(expanded ? null : id)}
        >
          {imgSrc ? (
            <img src={imgSrc} alt={title} className="w-12 h-12 rounded-md object-cover border border-border/20" />
          ) : (
            <div className="w-12 h-12 rounded-md bg-muted/50 flex items-center justify-center border border-border/20">
              <ImageIcon className="h-5 w-5 text-muted-foreground/50" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <span className="font-medium text-sm truncate block">{title}</span>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
              <span>{score.issues.length} issue{score.issues.length !== 1 ? "s" : ""}</span>
              {isApplied && <Badge className="bg-phoenix-success/10 text-phoenix-success border-phoenix-success/30 border text-[10px] px-1.5">Fixed</Badge>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge className={`${getScoreBadgeClass(score.total)} border text-xs`}>
              {score.total}
            </Badge>
            {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
        </button>

        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="border-t border-border/20">
            {/* Issues */}
            {score.issues.length > 0 && (
              <div className="p-3 bg-destructive/5 space-y-1">
                {score.issues.map((issue, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <XCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">{issue}</span>
                  </div>
                ))}
              </div>
            )}

            {/* AI Fix section */}
            <div className="p-3 space-y-3">
              {!fix && !isFixing && (
                <Button size="sm" onClick={() => handleGenerateFix(id)} className="gradient-phoenix text-primary-foreground">
                  <Wrench className="h-3.5 w-3.5 mr-1.5" /> Generate AI Fix
                </Button>
              )}

              {isFixing && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  AI is writing better SEO for this product...
                </div>
              )}

              {fix && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-medium text-primary">
                    <Sparkles className="h-3.5 w-3.5" /> AI-Generated Fix — Review Changes
                  </div>

                  {platform === "shopify" && (() => {
                    const product = shopifyProducts.find((p) => p.id === id);
                    return product && isApparelProduct(product) ? (
                      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
                        <AlertTriangle className="mr-1.5 inline h-4 w-4 text-amber-300" />
                        Apparel titles should keep the real color and size or size range. Leaving them out can trigger a Google Merchant issue for misrepresentation.
                      </div>
                    ) : null;
                  })()}

                  <div className="rounded-md border border-border/20 bg-muted/10 p-3">
                    {platform === "shopify" ? (
                      <>
                        {fix.title && renderComparisonRow("Title", shopifyProducts.find((p) => p.id === id)?.title || "", fix.title)}
                        {fix.body_html && renderComparisonRow("Description", (shopifyProducts.find((p) => p.id === id)?.body_html || "").replace(/<[^>]*>/g, "").slice(0, 80) + "...", fix.body_html.replace(/<[^>]*>/g, "").slice(0, 80) + "...")}
                        {fix.tags && renderComparisonRow(
                          "Tags",
                          (() => {
                            const tags = shopifyProducts.find((p) => p.id === id)?.tags;
                            if (typeof tags === "string") return tags;
                            if (Array.isArray(tags)) return tags.join(", ");
                            return "";
                          })(),
                          typeof fix.tags === "string" ? fix.tags : fix.tags.join(", ")
                        )}
                        {fix.product_type && renderComparisonRow("Type", shopifyProducts.find((p) => p.id === id)?.product_type || "", fix.product_type)}
                        {fix.seo_title && renderComparisonRow("SEO Title", "", fix.seo_title)}
                        {fix.seo_description && renderComparisonRow("SEO Desc", "", fix.seo_description)}
                        {fix.image_alts && (() => {
                          try {
                            const alts: { image_id: number; alt: string }[] = JSON.parse(fix.image_alts);
                            if (!Array.isArray(alts) || alts.length === 0) return null;
                            const preview = alts[0].alt;
                            const more = alts.length > 1 ? ` (+${alts.length - 1} more)` : "";
                            return renderComparisonRow("Image Alts", `${shopifyProducts.find((p) => p.id === id)?.images?.[0]?.alt || "none"}`, `${preview}${more}`);
                          } catch { return null; }
                        })()}
                        {fix.image_filenames && (() => {
                          try {
                            const names: { image_id: number; filename: string }[] = JSON.parse(fix.image_filenames);
                            if (!Array.isArray(names) || names.length === 0) return null;
                            const preview = names[0].filename;
                            const more = names.length > 1 ? ` (+${names.length - 1} more)` : "";
                            return renderComparisonRow("Filenames", shopifyProducts.find((p) => p.id === id)?.images?.[0]?.src?.split("/").pop()?.split("?")[0] || "current", `${preview}${more}`);
                          } catch { return null; }
                        })()}
                      </>
                    ) : (
                      <>
                        {fix.title && renderComparisonRow("Title", etsyListings.find((l) => l.listing_id === id)?.title || "", fix.title)}
                        {fix.description && renderComparisonRow("Description", (etsyListings.find((l) => l.listing_id === id)?.description || "").slice(0, 80) + "...", fix.description.slice(0, 80) + "...")}
                        {fix.tags && renderComparisonRow(
                          "Tags",
                          (etsyListings.find((l) => l.listing_id === id)?.tags || []).join(", "),
                          Array.isArray(fix.tags) ? fix.tags.join(", ") : fix.tags
                        )}
                        {fix.materials && renderComparisonRow("Materials", (etsyListings.find((l) => l.listing_id === id)?.materials || []).join(", "), fix.materials.join(", "))}
                      </>
                    )}
                  </div>

                  {fix.reasoning && (
                    <p className="text-xs text-muted-foreground italic">💡 {fix.reasoning}</p>
                  )}

                  <div className="flex gap-2">
                    {platform === "shopify" ? (
                      !isApplied ? (
                        <Button size="sm" onClick={() => handleApplyFix(id)} disabled={isApplying} className="bg-phoenix-success hover:bg-phoenix-success/90 text-primary-foreground">
                          {isApplying ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Applying...</> : <><Check className="h-3.5 w-3.5 mr-1.5" /> Apply Fix to Store</>}
                        </Button>
                      ) : (
                        <Badge className="bg-phoenix-success/10 text-phoenix-success border-phoenix-success/30 border px-3 py-1.5">
                          <Check className="h-3.5 w-3.5 mr-1" /> Applied ✓
                        </Badge>
                      )
                    ) : (
                      <Button
                        size="sm"
                        onClick={async () => {
                          const listing = etsyListings.find((l) => l.listing_id === id);
                          const text = copyAllFields([
                            { label: "Title", value: fix.title || "" },
                            { label: "Tags", value: Array.isArray(fix.tags) ? fix.tags.join(", ") : (fix.tags || "") },
                            { label: "Description", value: fix.description || "" },
                            { label: "Materials", value: fix.materials?.join(", ") || "" },
                          ]);
                          await navigator.clipboard.writeText(text);
                          setApplied((prev) => new Set(prev).add(id));
                          toast({ title: "Copied!", description: "Paste the optimized content into your Etsy listing." });
                        }}
                        className="bg-phoenix-success hover:bg-phoenix-success/90 text-primary-foreground"
                      >
                        <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy Fix
                      </Button>
                    )}
                    {!isApplied && (
                      <Button size="sm" variant="ghost" onClick={() => setFixes((prev) => { const m = new Map(prev); m.delete(id); return m; })}>
                        Dismiss
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Zap className="h-6 w-6 text-primary" /> SEO Scanner
        </h1>
        <p className="text-muted-foreground mt-1">Scan → Find issues → Fix with AI → Push to store. All in one place.</p>
      </motion.div>

      {noConnections ? (
        <Card className="bg-card/50 border-border/30">
          <CardContent className="p-8 text-center space-y-4">
            <Store className="h-12 w-12 text-muted-foreground mx-auto" />
            <h2 className="text-lg font-semibold">Connect Your Store First</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">Go to Settings → connect your Shopify or Etsy store → come back to scan & fix.</p>
            <Button onClick={() => window.location.href = "/settings"} className="gradient-phoenix text-primary-foreground">Go to Settings</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="bg-card/50 border-border/30">
            <CardContent className="p-4 flex items-center gap-3 flex-wrap">
              <Tabs value={platform} onValueChange={(v) => { setPlatform(v as Platform); setScanned(false); }} className="flex-1">
                <TabsList className="bg-muted/50">
                  {connections.shopify && <TabsTrigger value="shopify" className="flex items-center gap-2"><ShoppingBag className="h-4 w-4" /> Shopify</TabsTrigger>}
                  {connections.etsy && <TabsTrigger value="etsy" className="flex items-center gap-2"><Store className="h-4 w-4" /> Etsy</TabsTrigger>}
                </TabsList>
              </Tabs>
              {platform === "shopify" && shopifyStoreOptions.length > 0 && (
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={selectedShopifyConnectionId}
                  onChange={(e) => {
                    setSelectedShopifyConnectionId(e.target.value);
                    setScanned(false);
                    setShopifyProducts([]);
                    setFixes(new Map());
                    setApplied(new Set());
                  }}
                >
                  {shopifyStoreOptions.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.shop_name || connection.shop_domain || "Shopify store"}
                    </option>
                  ))}
                </select>
              )}
              {platform === "etsy" && etsyStoreOptions.length > 0 && (
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={selectedEtsyConnectionId}
                  onChange={(e) => {
                    setSelectedEtsyConnectionId(e.target.value);
                    setScanned(false);
                    setEtsyListings([]);
                    setFixes(new Map());
                    setApplied(new Set());
                  }}
                >
                  {etsyStoreOptions.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.shop_name || connection.shop_domain || "Etsy shop"}
                    </option>
                  ))}
                </select>
              )}
              <Button onClick={handleScan} disabled={scanning} className="gradient-phoenix text-primary-foreground">
                {scanning ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Scanning...</> : <><Zap className="h-4 w-4 mr-2" /> Scan Products</>}
              </Button>
            </CardContent>
          </Card>

          {scanning && (
            <Card className="bg-card/50 border-border/30">
              <CardContent className="p-8 flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Pulling your real products and scoring SEO...</p>
              </CardContent>
            </Card>
          )}

          {scanned && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
              {/* Summary */}
              <div className="grid grid-cols-3 gap-3">
                <Card className="bg-card/50 border-border/30">
                  <CardContent className="p-4 text-center">
                    <p className={`text-3xl font-bold ${getScoreColor(avgScore)}`}>{avgScore}</p>
                    <p className="text-xs text-muted-foreground mt-1">Avg Score</p>
                  </CardContent>
                </Card>
                <Card className="bg-card/50 border-border/30">
                  <CardContent className="p-4 text-center">
                    <p className="text-3xl font-bold text-primary">{productCount}</p>
                    <p className="text-xs text-muted-foreground mt-1">Scanned</p>
                  </CardContent>
                </Card>
                <Card className="bg-card/50 border-border/30">
                  <CardContent className="p-4 text-center">
                    <p className={`text-3xl font-bold ${needAttention > 0 ? "text-destructive" : "text-phoenix-success"}`}>{needAttention}</p>
                    <p className="text-xs text-muted-foreground mt-1">Need Fixing</p>
                  </CardContent>
                </Card>
              </div>

              {/* Fix All button */}
              {needAttention > 0 && (
                <Button onClick={handleFixAll} className="w-full gradient-phoenix text-primary-foreground" size="lg">
                  <Wrench className="h-4 w-4 mr-2" /> Generate AI Fixes for All {needAttention > 0 ? `${allScores.filter(s => s.total < 85).length} Products` : "Products"}
                </Button>
              )}

              {/* Publish all products to Facebook channel */}
              {platform === "shopify" && shopifyProducts.length > 0 && (
                <Card className="bg-card/50 border-border/30">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <ShoppingBag className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium">Publish to Sales Channels</span>
                      </div>
                      {selectedChannelIds.size > 0 && (
                        <Badge variant="outline" className="text-[10px] py-0">{selectedChannelIds.size} selected</Badge>
                      )}
                    </div>
                    {channelsLoading ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading channels...
                      </div>
                    ) : availableChannels.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No sales channels found. Connect them in Shopify → Sales Channels.</p>
                    ) : (
                      <div className="space-y-2">
                        {availableChannels.map((ch) => (
                          <label key={ch.id} className="flex items-center gap-2 cursor-pointer text-sm py-1">
                            <input
                              type="checkbox"
                              className="accent-primary"
                              checked={selectedChannelIds.has(ch.id)}
                              onChange={(e) => {
                                setSelectedChannelIds((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) { next.add(ch.id); } else { next.delete(ch.id); }
                                  return next;
                                });
                              }}
                            />
                            {ch.name}
                          </label>
                        ))}
                        <Button
                          onClick={handlePublishAll}
                          disabled={bulkPublishing || selectedChannelIds.size === 0}
                          className="w-full mt-2"
                          size="sm"
                        >
                          {bulkPublishing
                            ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Publishing...</>
                            : <><ShoppingBag className="h-3.5 w-3.5 mr-1.5" /> Publish {shopifyProducts.length} Products to Selected</>}
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Product cards */}
              <Card className="bg-card/50 border-border/30">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <CardTitle className="text-lg">Products</CardTitle>
                    <div className="flex items-center gap-1 text-xs">
                      {([50, 70, 85, null] as (number | null)[]).map((threshold) => (
                        <button
                          key={threshold ?? "all"}
                          onClick={() => setScoreFilter(threshold)}
                          className={`px-2.5 py-1 rounded border transition-colors ${scoreFilter === threshold ? "bg-primary text-primary-foreground border-primary" : "border-border/40 text-muted-foreground hover:text-foreground"}`}
                        >
                          {threshold === null ? "All" : `Under ${threshold}`}
                        </button>
                      ))}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {platform === "shopify" && [...shopifyProducts]
                    .filter((p) => scoreFilter === null || (shopifyScores.get(p.id)?.total ?? 100) < scoreFilter)
                    .sort((a, b) => (shopifyScores.get(b.id)?.total ?? 100) - (shopifyScores.get(a.id)?.total ?? 100))
                                        .sort((a, b) => (shopifyScores.get(b.id)?.total ?? 100) - (shopifyScores.get(a.id)?.total ?? 100))
                    .map((p) => {
                    const score = shopifyScores.get(p.id);
                    if (!score) return null;
                    return renderProductCard(p.id, p.title, p.images?.[0]?.src, score);
                  })}
                  {platform === "etsy" && [...etsyListings]
                    .filter((l) => scoreFilter === null || (etsyScores.get(l.listing_id)?.total ?? 100) < scoreFilter)
                    .sort((a, b) => (etsyScores.get(b.listing_id)?.total ?? 100) - (etsyScores.get(a.listing_id)?.total ?? 100))
                                        .sort((a, b) => (etsyScores.get(b.listing_id)?.total ?? 100) - (etsyScores.get(a.listing_id)?.total ?? 100))
                    .map((l) => {
                    const score = etsyScores.get(l.listing_id);
                    if (!score) return null;
                    return renderProductCard(l.listing_id, l.title, l.images?.[0]?.url_170x135 || l.images?.[0]?.url_570xN, score);
                  })}
                  {productCount === 0 && <p className="text-center text-muted-foreground py-6">No products found.</p>}
                </CardContent>
              </Card>
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}











