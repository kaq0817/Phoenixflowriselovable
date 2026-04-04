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
  variants: { id: number; title: string; price: string; inventory_quantity: number; option1?: string; option2?: string; weight?: number }[];
  images: { id: number; src: string; alt?: string; position?: number }[];
  handle: string;
  tags: string | string[];
  product_type?: string;
  weight?: number;
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

function normalizeShopifyTags(tags: ShopifyProduct["tags"] | string[] | null | undefined): string[] {
  if (Array.isArray(tags)) return tags.map((tag) => `${tag}`.trim()).filter(Boolean);
  return `${tags || ""}`.split(",").map((tag) => tag.trim()).filter(Boolean);
}

function scoreShopifyProduct(p: ShopifyProduct): SEOScore {
  const issues: string[] = [];
  const title = (p.title || "").trim();
  const body = (p.body_html || "").toLowerCase();
  const tags = normalizeShopifyTags(p.tags);
  const weight = p.weight || p.variants?.[0]?.weight || 0;
  const imageAlt = p.images?.[0]?.alt?.trim() || "";

  const hasIdentity = title.includes("Our Phoenix Rise") || title.includes("Iron Phoenix GHG");
  if (!hasIdentity) issues.push("STYLE_NO_SUFFIX: Title must contain brand identifier");

  if (tags.length < 5) issues.push(`SEO_TAG_VOID: Found ${tags.length}/5 required tags`);

  const plainText = body.replace(/<[^>]*>/g, "").trim();
  if (plainText.length < 50) issues.push("ATTR_MISSING_DESC: Description must be 50+ characters");

  if (weight <= 0) issues.push("ATTR_MISSING_WEIGHT: Shipping weight must be > 0");

  const isWellness = ["wellness", "supplement", "soap", "coffee", "ashwagandha", "berberine", "protein", "shake"].some(k => 
    title.toLowerCase().includes(k) || tags.some(t => t.toLowerCase().includes(k))
  );
  const hasRegulatoryData = body.includes("ingredient") || body.includes("supplement facts") || body.includes("nutrition facts");
  if (isWellness && !hasRegulatoryData) issues.push("ATTR_MISSING_INGREDIENTS: Regulatory risk - missing facts/ingredients");

  const needsDims = ["art", "rug", "decor", "blanket", "slippers", "canvas"].some(k => 
    title.toLowerCase().includes(k) || (p.product_type || "").toLowerCase().includes(k)
  );
  const hasDims = /([\d.]+)\s*[x*]\s*([\d.]+)/.test(body) || body.includes("dimensions");
  if (needsDims && !hasDims) issues.push("ATTR_MISSING_DIMENSIONS: Scale metrics absent from description");

  if (imageAlt.length === 0) issues.push("SEO_MISSING_ALT: Primary image missing Alt text");

  if (title.includes('"') || title.includes("'")) issues.push("STYLE_TITLE_QUOTE: Non-standard punctuation in title");

  if (p.status?.toLowerCase() === "draft") issues.push("STATUS_IS_DRAFT: Product is not active");

  const total = issues.length === 0 ? 100 : 0;

  return {
    total,
    title: hasIdentity,
    titleLength: true,
    altText: imageAlt.length > 0,
    description: plainText.length >= 50,
    descriptionLength: plainText.length >= 50,
    tags: tags.length >= 5,
    variants: (p.variants?.length || 0) > 0,
    images: (p.images?.length || 0) > 0,
    issues,
    suggestions: [],
  };
}

function scoreEtsyListing(l: EtsyListing): SEOScore {
  const issues: string[] = [];
  const title = (l.title || "").trim();
  const desc = (l.description || "").trim();
  const tagCount = l.tags?.length || 0;
  
  if (title.length < 20) issues.push("Title too short");
  if (desc.length < 100) issues.push("Description too thin");
  if (tagCount < 13) issues.push(`Tags: ${tagCount}/13 used`);
  if ((l.images?.length || 0) === 0) issues.push("Missing images");

  const total = issues.length === 0 ? 100 : 0;

  return { total, title: title.length > 0, titleLength: title.length >= 20, altText: false, description: desc.length > 0, descriptionLength: desc.length >= 100, tags: tagCount === 13, variants: true, images: (l.images?.length || 0) > 0, issues, suggestions: [] };
}

function getScoreColor(score: number) {
  return score === 100 ? "text-phoenix-success" : "text-destructive";
}

function getScoreBadgeClass(score: number) {
  return score === 100 
    ? "bg-phoenix-success/10 text-phoenix-success border-phoenix-success/30" 
    : "bg-destructive/10 text-destructive border-destructive/30";
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
  const [fixLoading, setFixLoading] = useState<Set<number>>(new Set());
  const [fixes, setFixes] = useState<Map<number, Fix>>(new Map());
  const [applyLoading, setApplyLoading] = useState<Set<number>>(new Set());
  const [applied, setApplied] = useState<Set<number>>(new Set());
  const [bulkPublishing, setBulkPublishing] = useState(false);
  const [availableChannels, setAvailableChannels] = useState<{ id: number; name: string }[]>([]);
  const [selectedChannelIds, setSelectedChannelIds] = useState<Set<number>>(new Set());
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [scoreFilter, setScoreFilter] = useState<number | null>(85);

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

  const handleScan = async () => {
    setScanning(true);
    setScanned(false);
    setFixes(new Map());
    setApplied(new Set());
    try {
      if (platform === "shopify" && connections.shopify) {
        const { data, error } = await supabase.functions.invoke("fetch-shopify-products", { body: { limit: 50, connectionId: selectedShopifyConnectionId || undefined } });
        if (error) throw error;
        const products: ShopifyProduct[] = data.products || [];
        setShopifyProducts(products);
        const scores = new Map<number, SEOScore>();
        products.forEach((p) => scores.set(p.id, scoreShopifyProduct(p)));
        setShopifyScores(scores);
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
        } catch { /* non-critical */ } finally { setChannelsLoading(false); }
      }
      if (platform === "etsy" && connections.etsy) {
        const { data, error } = await supabase.functions.invoke("fetch-etsy-listings", { body: { limit: 50, state: "active", connectionId: selectedEtsyConnectionId || undefined } });
        if (error) throw error;
        const listings: EtsyListing[] = data.results || [];
        setEtsyListings(listings);
        const scores = new Map<number, SEOScore>();
        listings.forEach((l) => scores.set(l.listing_id, scoreEtsyListing(l)));
        setEtsyScores(scores);
      }
      setScanned(true);
    } catch (err: unknown) {
      const error = err as Error;
      toast({ title: "Scan failed", description: error.message, variant: "destructive" });
    } finally { setScanning(false); }
  };

  const handleGenerateFix = async (id: number) => {
    setFixLoading((prev) => new Set(prev).add(id));
    try {
      if (platform === "shopify") {
        const product = shopifyProducts.find((p) => p.id === id);
        if (!product) return;
        const { data, error } = await supabase.functions.invoke("optimize-shopify-listing", { 
          body: { product, connectionId: selectedShopifyConnectionId, shopName: storeConnections.find((c) => c.id === selectedShopifyConnectionId)?.shop_name || "" } 
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
      const error = err as Error;
      toast({ title: "AI fix failed", description: error.message, variant: "destructive" });
    } finally { setFixLoading((prev) => { const s = new Set(prev); s.delete(id); return s; }); }
  };

  const handleApplyFix = async (id: number) => {
    const fix = fixes.get(id);
    if (!fix) return;
    setApplyLoading((prev) => new Set(prev).add(id));
    try {
      if (platform === "shopify") {
        const { error } = await supabase.functions.invoke("apply-shopify-changes", { body: { productId: id, optimizedData: fix, connectionId: selectedShopifyConnectionId || undefined } });
        if (error) throw error;
      } else {
        const { error } = await supabase.functions.invoke("apply-etsy-changes", {
          body: { listingId: id, optimizedData: fix, connectionId: selectedEtsyConnectionId || undefined },
        });
        if (error) throw error;
      }
      setApplied((prev) => new Set(prev).add(id));
      toast({ title: "✅ Fixed!", description: "Changes pushed to your store." });
    } catch (err: unknown) {
      const error = err as Error;
      toast({ title: "Apply failed", description: error.message, variant: "destructive" });
    } finally { setApplyLoading((prev) => { const s = new Set(prev); s.delete(id); return s; }); }
  };

  const handlePublishAll = async () => {
    if (!selectedShopifyConnectionId || shopifyProducts.length === 0 || selectedChannelIds.size === 0) return;
    setBulkPublishing(true);
    try {
      const targetPubs = availableChannels.filter((p) => selectedChannelIds.has(p.id));
      for (const product of shopifyProducts) {
        const { data: chData } = await supabase.functions.invoke("fetch-shopify-channels", {
          body: { connectionId: selectedShopifyConnectionId, productId: product.id },
        });
        const alreadyIn: number[] = chData?.publishedPublicationIds || [];
        for (const pub of targetPubs) {
          if (alreadyIn.includes(pub.id)) continue;
          await supabase.functions.invoke("apply-shopify-channels", {
            body: { connectionId: selectedShopifyConnectionId, productId: product.id, publicationId: pub.id, action: "publish" },
          });
        }
      }
      toast({ title: "Channels updated", description: `Published products to selected channels.` });
    } catch (err: unknown) {
      const error = err as Error;
      toast({ title: "Publish failed", description: error.message, variant: "destructive" });
    } finally { setBulkPublishing(false); }
  };

  const handleFixAll = async () => {
    const ids: number[] = [];
    const currentScores = platform === "shopify" ? shopifyScores : etsyScores;
    currentScores.forEach((score, id) => { if (score.total === 0) ids.push(id); });
    for (const id of ids) { if (!fixes.has(id)) await handleGenerateFix(id); }
    toast({ title: "Binary fixes generated", description: "Review and Apply to clear 0% scores." });
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  const shopifyStoreOptions = storeConnections.filter((c) => c.platform === "shopify");
  const etsyStoreOptions = storeConnections.filter((c) => c.platform === "etsy");
  const allScores = Array.from(platform === "shopify" ? shopifyScores.values() : etsyScores.values());
  const avgScore = allScores.length > 0 ? Math.round(allScores.reduce((a, b) => a + b.total, 0) / allScores.length) : 0;
  const needAttention = allScores.filter((s) => s.total === 0).length;
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
      <div key={id} className={`rounded-lg border border-border/20 overflow-hidden ${score.total === 0 ? 'bg-destructive/5' : 'bg-card/30'}`}>
        <button
          className="w-full flex items-center gap-3 p-3 hover:bg-muted/40 transition-colors text-left"
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
              <span>{score.issues.length} failure{score.issues.length !== 1 ? "s" : ""}</span>
              {isApplied && <Badge className="bg-phoenix-success/10 text-phoenix-success border-phoenix-success/30 border text-[10px] px-1.5">Resolved</Badge>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge className={`${getScoreBadgeClass(score.total)} border text-xs font-bold`}>
              {score.total}%
            </Badge>
            {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
        </button>

        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="border-t border-border/20">
            {score.issues.length > 0 && (
              <div className="p-3 bg-destructive/5 space-y-1">
                {score.issues.map((issue, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <XCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
                    <span className="text-destructive font-medium uppercase text-[10px]">{issue.split(':')[0]}</span>
                    <span className="text-muted-foreground">{issue.split(':')[1] || issue}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="p-3 space-y-3">
              {!fix && !isFixing && (
                <Button size="sm" onClick={() => handleGenerateFix(id)} className="gradient-phoenix text-primary-foreground">
                  <Wrench className="h-3.5 w-3.5 mr-1.5" /> Force 100% Alignment
                </Button>
              )}

              {isFixing && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  Engineering production-ready fix...
                </div>
              )}

              {fix && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-primary uppercase">
                    <Sparkles className="h-3.5 w-3.5" /> Mandatory Alignment Changes
                  </div>

                  <div className="rounded-md border border-border/20 bg-muted/10 p-3">
                    {platform === "shopify" ? (
                      <>
                        {fix.title && renderComparisonRow("Title", shopifyProducts.find((p) => p.id === id)?.title || "", fix.title)}
                        {fix.body_html && renderComparisonRow("Body", "Original Content", "Optimized Content")}
                        {fix.tags && renderComparisonRow("Tags", "Current", Array.isArray(fix.tags) ? fix.tags.join(", ") : (fix.tags || ""))}
                        {fix.product_type && renderComparisonRow("Type", "Current", fix.product_type)}
                      </>
                    ) : (
                      <>
                        {fix.title && renderComparisonRow("Title", "Original", fix.title)}
                        {fix.description && renderComparisonRow("Desc", "Original", "Optimized")}
                        {fix.tags && renderComparisonRow("Tags", "Current", Array.isArray(fix.tags) ? fix.tags.join(", ") : (fix.tags || ""))}
                      </>
                    )}
                  </div>

                  <div className="flex gap-2">
                    {!isApplied ? (
                      <Button size="sm" onClick={() => handleApplyFix(id)} disabled={isApplying} className="bg-phoenix-success hover:bg-phoenix-success/90 text-primary-foreground">
                        {isApplying ? "Applying..." : "Push Binary Fix"}
                      </Button>
                    ) : (
                      <Badge className="bg-phoenix-success/10 text-phoenix-success border-phoenix-success/30 border px-3 py-1.5">
                        <Check className="h-3.5 w-3.5 mr-1" /> Applied
                      </Badge>
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
          <Zap className="h-6 w-6 text-primary" /> BINARY DEEP SCAN v4.0
        </h1>
        <p className="text-muted-foreground mt-1">Surfacing 0% trash products. Only 100% compliance survives.</p>
      </motion.div>

      <Card className="bg-card/50 border-border/30">
        <CardContent className="p-4 flex items-center gap-3 flex-wrap">
          <Tabs value={platform} onValueChange={(v) => setPlatform(v as Platform)} className="flex-1">
            <TabsList className="bg-muted/50">
              {connections.shopify && <TabsTrigger value="shopify">Shopify</TabsTrigger>}
              {connections.etsy && <TabsTrigger value="etsy">Etsy</TabsTrigger>}
            </TabsList>
          </Tabs>
          <Button onClick={handleScan} disabled={scanning} className="gradient-phoenix text-primary-foreground">
            {scanning ? "Scanning..." : "Execute Scan"}
          </Button>
        </CardContent>
      </Card>

      {scanned && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Card className="bg-card/50 border-border/30">
              <CardContent className="p-4 text-center">
                <p className={`text-3xl font-bold ${getScoreColor(avgScore)}`}>{avgScore}%</p>
                <p className="text-xs text-muted-foreground mt-1">Fleet Health</p>
              </CardContent>
            </Card>
            <Card className="bg-card/50 border-border/30">
              <CardContent className="p-4 text-center">
                <p className="text-3xl font-bold text-primary">{productCount}</p>
                <p className="text-xs text-muted-foreground mt-1">Audited</p>
              </CardContent>
            </Card>
            <Card className="bg-card/50 border-border/30">
              <CardContent className="p-4 text-center">
                <p className={`text-3xl font-bold text-destructive`}>{needAttention}</p>
                <p className="text-xs text-muted-foreground mt-1">Trash surfaced</p>
              </CardContent>
            </Card>
          </div>

          <Button onClick={handleFixAll} className="w-full gradient-phoenix text-primary-foreground" size="lg" disabled={needAttention === 0}>
            <Wrench className="h-4 w-4 mr-2" /> Force Align All 0% Trash
          </Button>

          <Card className="bg-card/50 border-border/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Product Inventory (Binary View)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {platform === "shopify" && [...shopifyProducts]
                .sort((a, b) => (shopifyScores.get(a.id)?.total ?? 0) - (shopifyScores.get(b.id)?.total ?? 0))
                .map((p) => {
                  const score = shopifyScores.get(p.id);
                  return score ? renderProductCard(p.id, p.title, p.images?.[0]?.src, score) : null;
                })}
              {platform === "etsy" && [...etsyListings]
                .sort((a, b) => (etsyScores.get(a.listing_id)?.total ?? 0) - (etsyScores.get(b.listing_id)?.total ?? 0))
                .map((l) => {
                  const score = etsyScores.get(l.listing_id);
                  return score ? renderProductCard(l.listing_id, l.title, l.images?.[0]?.url_170x135, score) : null;
                })}
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}