import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart3, Sparkles, ShoppingBag, Store, Loader2, CheckCircle2,
  ChevronDown, ChevronUp, Image as ImageIcon, Tag, FileText, Palette,
  ArrowRight, Copy, AlertTriangle, Link, HelpCircle, LayoutGrid, Radio
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { CopyButton, copyAllFields } from "@/components/CopyButton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface ShopifyProduct {
  id: number;
  title: string;
  body_html: string;
  product_type: string;
  vendor: string;
  tags: string;
  status?: string;
  variants: { id: number; title: string; price: string; inventory_quantity: number; option1?: string; option2?: string; option3?: string }[];
  images: { id: number; src: string; alt: string | null; position: number }[];
  handle: string;
}

interface ShopifySuggestions {
  title: string;
  body_html: string;
  seo_title: string;
  seo_description: string;
  // NEW FIELDS TO MATCH YOUR AUDIT
  og_title?: string;
  og_description?: string;
  product_type: string;
  tags: string;
  variant_suggestions?: string;
  url_handle?: string;
  faq_json?: string;
  collections_suggestion?: string;
  image_alts?: string;
  reasoning: string;
  product_schema_status?: 'valid' | 'missing_fields';
}

interface EtsyListing {
  listing_id: number;
  title: string;
  description: string;
  tags: string[];
  materials: string[];
  taxonomy_path?: string;
  state: string;
  images?: { url_170x135?: string; url_570xN?: string }[];
}

interface EtsySuggestions {
  title: string;
  description: string;
  tags: string[];
  materials: string[];
  reasoning: string;
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

function slugifyForFilename(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .trim();
}

const INTERNAL_BRAND_RE = /Iron Phoenix GHG|Iron Phoenix|Go Hard Gaming|Phoenix Rise/gi;
const PROMO_RE = /FREE SHIPPING|SALE|NEW\b|100%|BEST\b|HOT\b|DEAL|DISCOUNT|OFFER|PROMO|GUARANTEED|CHEAP/gi;

function cleanProductTitle(raw: string): string {
  return (raw || "Product")
    .replace(INTERNAL_BRAND_RE, "")
    .replace(PROMO_RE, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function truncateToWordBoundary(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max).replace(/\s+\S*$/, "").trim();
}


const FILENAME_ANGLE_SLUGS = [
  "main",
  "side-angle",
  "close-up",
  "alternate",
  "feature-detail",
  "lifestyle",
  "top-view",
  "back-view",
  "scale",
  "packaging",
];


function buildUniqueFilenameDrafts(product: ShopifyProduct, storeLabel: string): Record<number, string> {
  const fullSlug = slugifyForFilename(cleanProductTitle(product.title || "product")) || "product";
  const productSlug = truncateToWordBoundary(fullSlug, 40).replace(/-$/, "") || "product";
  const storeSlug = slugifyForFilename(storeLabel || "store") || "store";
  const drafts: Record<number, string> = {};
  for (let i = 0; i < (product.images || []).length; i += 1) {
    const img = product.images[i];
    const detail = FILENAME_ANGLE_SLUGS[i] ?? `view-${i + 1}`;
    drafts[img.id] = `${productSlug}-${detail}-${storeSlug}.jpg`;
  }
  return drafts;
}

function isUsableEtsyConnection(connection: StoreConnectionOption): boolean {
  return connection.platform === "etsy" && !!connection.shop_domain && !!connection.scopes?.includes("shops_r");
}

function isApparelProduct(product: ShopifyProduct): boolean {
  const haystack = `${product.title || ""} ${product.product_type || ""} ${product.tags || ""}`.toLowerCase();
  return ["shirt", "tee", "hoodie", "sweatshirt", "sweater", "jacket", "dress", "pants", "leggings", "shorts", "top", "tank", "skirt", "apparel", "clothing", "beanie", "hat", "cap", "jersey"].some((term) => haystack.includes(term));
}

export default function OptimizerPage() {
  const { session } = useAuth();
  const { toast } = useToast();
  const [platform, setPlatform] = useState<Platform>("shopify");
  const [connections, setConnections] = useState<Record<Platform, boolean>>({ shopify: false, etsy: false });
  const [storeConnections, setStoreConnections] = useState<StoreConnectionOption[]>([]);
  const [selectedShopifyConnectionId, setSelectedShopifyConnectionId] = useState("");
  const [selectedEtsyConnectionId, setSelectedEtsyConnectionId] = useState("");
  const [loading, setLoading] = useState(true);

  // Shopify
  const [shopifyProducts, setShopifyProducts] = useState<ShopifyProduct[]>([]);
  const [shopifyLoading, setShopifyLoading] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ShopifyProduct | null>(null);
  const [shopifySuggestions, setShopifySuggestions] = useState<ShopifySuggestions | null>(null);
  const [shopifyOptimizing, setShopifyOptimizing] = useState(false);
  const [shopifyApplying, setShopifyApplying] = useState(false);
  const [shopifyNextCursor, setShopifyNextCursor] = useState<string | null>(null);
  const [shopifyHasMore, setShopifyHasMore] = useState(false);
  const [shopifyDoneIds, setShopifyDoneIds] = useState<Set<number>>(new Set());
  const [seoTitleDraft, setSeoTitleDraft] = useState("");
  const [seoDescDraft, setSeoDescDraft] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  
  // Etsy
  const [etsyListings, setEtsyListings] = useState<EtsyListing[]>([]);
  const [etsyLoading, setEtsyLoading] = useState(false);
  const [selectedListing, setSelectedListing] = useState<EtsyListing | null>(null);
  const [etsySuggestions, setEtsySuggestions] = useState<EtsySuggestions | null>(null);
  const [etsyOptimizing, setEtsyOptimizing] = useState(false);
  const [etsyApplying, setEtsyApplying] = useState(false);

  const [productTitleEdit, setProductTitleEdit] = useState("");
  const [productContextNote, setProductContextNote] = useState("");
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [altTextExpanded, setAltTextExpanded] = useState(false);
  const [imageAltEdits, setImageAltEdits] = useState<Record<number, string>>({});
  const [imageFilenameDrafts, setImageFilenameDrafts] = useState<Record<number, string>>({});
  const [savingAltText, setSavingAltText] = useState(false);
  const [altScanLoading, setAltScanLoading] = useState(false);
  const [altsAIFilled, setAltsAIFilled] = useState(0);

  // Sales channels
  const [salesChannels, setSalesChannels] = useState<{ id: number; name: string }[]>([]);
  const [publishedChannelIds, setPublishedChannelIds] = useState<number[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelTogglingId, setChannelTogglingId] = useState<number | null>(null);

  // Optimizer usage
  const [optimizerUsage, setOptimizerUsage] = useState<{ used: number; limit: number; resetsAt: string | null } | null>(null);

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
      if (!conn.shopify && conn.etsy) setPlatform("etsy");
      setLoading(false);
    })();
  }, [session]);
  // SECTION 3: The "Rose Je" Shield Hook
useEffect(() => {
    if (shopifySuggestions) {
      const gmcGuard = (text: string, max: number) => {
        if (!text) return "";
        if (text.length <= max) return text;
        const lastSpace = text.lastIndexOf(" ", max);
        return lastSpace > 0 ? text.substring(0, lastSpace) : text.substring(0, max);
      }; 

      setTitleDraft(gmcGuard(shopifySuggestions.title || "", 70));
      setSeoTitleDraft(gmcGuard(shopifySuggestions.seo_title || "", 70));
      setSeoDescDraft(gmcGuard(shopifySuggestions.seo_description || "", 160));
    }
  }, [shopifySuggestions]); // Properly closed the hook here

  const fetchShopifyProducts = async (cursor: string | null = null, append = false) => {
    if (!selectedShopifyConnectionId) {
      toast({ title: "Select a store", description: "Choose a Shopify store before loading products." });
      return;
    }
    setShopifyLoading(true);
    try {
      const currentDoneIds = (() => {
        try {
          const raw = localStorage.getItem(`optimizer-done-ids:${selectedShopifyConnectionId}`);
          return raw ? new Set<number>(JSON.parse(raw)) : new Set<number>();
        } catch { return new Set<number>(); }
      })();
      const { data, error } = await supabase.functions.invoke("fetch-shopify-products", {
        body: { limit: 50, connectionId: selectedShopifyConnectionId, pageInfoCursor: cursor },
      });
      if (error) throw error;
      const incoming: ShopifyProduct[] = (data.products || []).filter(
        (p: ShopifyProduct) => !currentDoneIds.has(p.id),
      );
      setShopifyProducts((prev) => {
        if (!append) return incoming;
        const existingIds = new Set(prev.map((p) => p.id));
        return [...prev, ...incoming.filter((p) => !existingIds.has(p.id))];
      });
      setShopifyDoneIds(currentDoneIds);
      const nextCursor: string | null = data.nextPageInfo ?? null;
      setShopifyNextCursor(nextCursor);
      setShopifyHasMore(!!nextCursor);
      if (data.optimizerUsage) setOptimizerUsage(data.optimizerUsage);
    } catch (err: unknown) {
      const errorObj = err as Error;
      toast({ title: "Error", description: errorObj.message, variant: "destructive" });
    } finally {
      setShopifyLoading(false);
    }
  };

  const fetchEtsyListings = async () => {
    if (!selectedEtsyConnectionId) {
      toast({ title: "Select a shop", description: "Choose an Etsy shop before loading listings." });
      return;
    }
    setEtsyLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-etsy-listings", { body: { limit: 10, state: "active", connectionId: selectedEtsyConnectionId } });
      if (error) throw error;
      setEtsyListings(data.results || []);
    } catch (err: unknown) {
      const errorObj = err as Error;
      toast({ title: "Error", description: errorObj.message, variant: "destructive" });
    } finally {
      setEtsyLoading(false);
    }
  };

  const optimizeEtsy = async (listing: EtsyListing) => {
    setSelectedListing(listing);
    setEtsySuggestions(null);
    setEtsyOptimizing(true);
    setExpandedSection(null);
    try {
      const { data, error } = await supabase.functions.invoke("optimize-etsy-listing", { body: { listing } });
      if (error) throw error;
      setEtsySuggestions(data.suggestions);
      setExpandedSection("title");
    } catch (err: unknown) {
      const errorObj = err as Error;
      toast({ title: "Optimization failed", description: errorObj.message, variant: "destructive" });
      setSelectedListing(null);
    } finally {
      setEtsyOptimizing(false);
    }
  };

  const applyEtsyChanges = async () => {
    if (!selectedListing || !etsySuggestions) return;
    setEtsyApplying(true);
    try {
      const { error } = await supabase.functions.invoke("apply-etsy-changes", {
        body: {
          listingId: selectedListing.listing_id,
          originalData: { title: selectedListing.title, description: selectedListing.description, tags: selectedListing.tags, materials: selectedListing.materials },
          optimizedData: etsySuggestions,
          connectionId: selectedEtsyConnectionId || undefined,
        },
      });
      if (error) throw error;
      toast({ title: "Done!", description: "Changes applied to your Etsy shop." });
      setSelectedListing(null);
      setEtsySuggestions(null);
      fetchEtsyListings();
    } catch (err: unknown) {
      const errorObj = err as Error;
      toast({ title: "Apply failed", description: errorObj.message, variant: "destructive" });
    } finally {
      setEtsyApplying(false);
    }
  };

  const fetchSalesChannels = async (productId: number, connectionId: string) => {
    if (!connectionId) return;
    setChannelsLoading(true);
    setSalesChannels([]);
    setPublishedChannelIds([]);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-shopify-channels", {
        body: { connectionId, productId },
      });
      if (error) throw error;
      setSalesChannels(data.publications || []);
      setPublishedChannelIds(data.publishedPublicationIds || []);
    } catch {
      // Non-critical
    } finally {
      setChannelsLoading(false);
    }
  };

  const toggleSalesChannel = async (publicationId: number, currentlyPublished: boolean) => {
    if (!selectedProduct || !selectedShopifyConnectionId || channelTogglingId !== null) return;
    setChannelTogglingId(publicationId);
    const action = currentlyPublished ? "unpublish" : "publish";
    try {
      const { error } = await supabase.functions.invoke("apply-shopify-channels", {
        body: { connectionId: selectedShopifyConnectionId, productId: selectedProduct.id, publicationId, action },
      });
      if (error) throw error;
      setPublishedChannelIds((prev) =>
        action === "publish" ? [...prev, publicationId] : prev.filter((id) => id !== publicationId)
      );
      toast({ title: action === "publish" ? "Published" : "Unpublished", description: `Product ${action === "publish" ? "added to" : "removed from"} sales channel.` });
    } catch (err: unknown) {
      const errorObj = err as Error;
      toast({ title: "Error", description: errorObj.message, variant: "destructive" });
    } finally {
      setChannelTogglingId(null);
    }
  };

  // Step 1: select product and show the pre-optimization form — no API call yet
  const selectProduct = (product: ShopifyProduct) => {
    setSelectedProduct(product);
    setShopifySuggestions(null);
    setShopifyOptimizing(false);
    setExpandedSection(null);
    setProductTitleEdit(product.title || "");
    setProductContextNote("");
    const initialAlts: Record<number, string> = {};
    for (const img of product.images || []) {
      initialAlts[img.id] = img.alt || "";
    }
    setImageAltEdits(initialAlts);
    const activeConnection = storeConnections.find((c) => c.id === selectedShopifyConnectionId);
    const storeLabel = activeConnection?.shop_name || activeConnection?.shop_domain || "store";
    setImageFilenameDrafts(buildUniqueFilenameDrafts(product, storeLabel));
    setAltTextExpanded(false);
    fetchSalesChannels(product.id, selectedShopifyConnectionId);
  };

  // Step 2: user clicks "Start Optimization" — now call the API with their edits
  const startOptimization = async () => {
    if (!selectedProduct) return;
    setShopifyOptimizing(true);
    setExpandedSection(null);
    setAltTextExpanded(true);

    // Merge user edits back into the product before sending
    const productToSend: ShopifyProduct = {
      ...selectedProduct,
      title: productTitleEdit.trim() || selectedProduct.title,
    };

    try {
      const { data, error } = await supabase.functions.invoke("optimize-shopify-listing", {
        body: { product: productToSend, connectionId: selectedShopifyConnectionId, productContext: productContextNote.trim() || undefined },
      });
      if (error) {
        const detail = (error as { message?: string }).message || "";
        if (detail.includes("Monthly limit reached") || detail.includes("429")) {
          toast({ title: "Monthly limit reached", description: "You have used all 50 optimizations for this store this month.", variant: "destructive" });
          if (optimizerUsage) setOptimizerUsage({ ...optimizerUsage, used: optimizerUsage.limit });
          setSelectedProduct(null);
          setShopifyOptimizing(false);
          return;
        }
        throw error;
      }
      setShopifySuggestions(data.suggestions);
      if (data.suggestions?.image_alts) {
        try {
          const aiAlts: { image_id: number; alt: string }[] = JSON.parse(data.suggestions.image_alts);
          if (Array.isArray(aiAlts)) {
            setAltsAIFilled(aiAlts.length);
            setImageAltEdits(prev => {
              const updated = { ...prev };
              for (const entry of aiAlts) {
                if (typeof entry.image_id === "number" && entry.alt) {
                  updated[entry.image_id] = entry.alt;
                }
              }
              return updated;
            });
          }
        } catch { /* ignore */ }
      }
      if (data.optimizerUsage) setOptimizerUsage(data.optimizerUsage);
      setExpandedSection("title");
    } catch (err: unknown) {
      const errorObj = err as Error;
      toast({ title: "Optimization failed", description: errorObj.message, variant: "destructive" });
      setSelectedProduct(null);
    } finally {
      setShopifyOptimizing(false);
    }
  };

  const applyShopifyChanges = async () => {
    if (!selectedProduct || !shopifySuggestions) return;
    setShopifyApplying(true);
    try {
      const { error } = await supabase.functions.invoke("apply-shopify-changes", {
        body: {
          productId: selectedProduct.id,
          optimizedData: shopifySuggestions,
          connectionId: selectedShopifyConnectionId || undefined,
          imageAltEdits,
        },
      });
      if (error) throw error;
      const appliedId = selectedProduct.id;
      setShopifyDoneIds((prev) => {
        const next = new Set(prev);
        next.add(appliedId);
        try {
          localStorage.setItem(`optimizer-done-ids:${selectedShopifyConnectionId}`, JSON.stringify(Array.from(next)));
        } catch { /* ignore */ }
        return next;
      });
      setShopifyProducts((prev) => prev.filter((p) => p.id !== appliedId));
      toast({ title: "Done!", description: "Changes applied to your Shopify store." });
      setSelectedProduct(null);
      setShopifySuggestions(null);
    } catch (err: unknown) {
      const errorObj = err as Error;
      toast({ title: "Apply failed", description: errorObj.message, variant: "destructive" });
    } finally {
      setShopifyApplying(false);
    }
  };

  const toggle = (key: string) => setExpandedSection(expandedSection === key ? null : key);

  const scanImageAlts = async () => {
    if (!selectedProduct || !selectedProduct.images?.length) return;
    setAltScanLoading(true);
    try {
      const activeConnection = storeConnections.find((c) => c.id === selectedShopifyConnectionId);
      const storeName = activeConnection?.shop_name || activeConnection?.shop_domain || "store";
      const { data, error } = await supabase.functions.invoke("generate-image-alts", {
        body: {
          images: selectedProduct.images.map((img) => ({ id: img.id, src: img.src })),
          productTitle: selectedProduct.title,
          storeName,
        },
      });
      if (error) throw error;
      const results: { image_id: number; alt: string; filename: string }[] = data.results || [];
      const altEdits: Record<number, string> = {};
      const filenameDrafts: Record<number, string> = {};
      for (const r of results) {
        if (r.image_id) {
          altEdits[r.image_id] = r.alt || "";
          filenameDrafts[r.image_id] = r.filename || "";
        }
      }
      setImageAltEdits(altEdits);
      setImageFilenameDrafts(filenameDrafts);
      setAltsAIFilled(results.length);
      toast({ title: "Images scanned", description: `Generated alt text for ${results.length} images.` });
    } catch (err: unknown) {
      const errorObj = err as Error;
      toast({ title: "Scan failed", description: errorObj.message, variant: "destructive" });
    } finally {
      setAltScanLoading(false);
    }
  };

  const saveAltTextOnly = async () => {
    if (!selectedProduct || Object.keys(imageAltEdits).length === 0) return;
    setSavingAltText(true);
    try {
      const { error } = await supabase.functions.invoke("apply-shopify-changes", {
        body: {
          productId: selectedProduct.id,
          optimizedData: {},
          connectionId: selectedShopifyConnectionId || undefined,
          imageAltEdits,
        },
      });
      if (error) throw error;
      setAltsAIFilled(0);
      toast({ title: "Alt text saved", description: "Image alt text updated on Shopify." });
    } catch (err: unknown) {
      const errorObj = err as Error;
      toast({ title: "Save failed", description: errorObj.message, variant: "destructive" });
    } finally {
      setSavingAltText(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const noConnections = !connections.shopify && !connections.etsy;
  const shopifyStoreOptions = storeConnections.filter((c) => c.platform === "shopify");
  const etsyStoreOptions = storeConnections.filter((c) => c.platform === "etsy");

  const ProductImage = ({ src, alt, size = "md" }: { src?: string; alt: string; size?: "sm" | "md" | "lg" }) => {
    const sizeClasses = { sm: "w-14 h-14", md: "w-20 h-20", lg: "w-32 h-32" };
    return src ? (
      <img src={src} alt={alt} className={`${sizeClasses[size]} rounded-lg object-cover border border-border/30`} />
    ) : (
      <div className={`${sizeClasses[size]} rounded-lg bg-muted/50 border border-border/30 flex items-center justify-center`}>
        <ImageIcon className="h-6 w-6 text-muted-foreground/50" />
      </div>
    );
  };

  const ComparisonRow = ({ label, icon, original, optimized, onChange, multiline }: {
    label: string; icon: React.ReactNode; original: string; optimized: string; onChange: (v: string) => void; multiline?: boolean;
  }) => (
    <Card className="bg-card/50 border-border/30 overflow-hidden">
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium">{label}</span>
          {original !== optimized && <Badge className="bg-primary/10 text-primary text-xs border-0">Changed</Badge>}
        </div>
        {original && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-medium">Current</p>
            <p className="text-xs text-muted-foreground/60 leading-relaxed">{original}</p>
          </div>
        )}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-primary mb-1 font-medium">Optimized</p>
          <textarea
            className="w-full rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            value={optimized}
            rows={multiline ? Math.max(3, Math.ceil(optimized.length / 80)) : 2}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      </div>
    </Card>
  );

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-primary" /> Product Optimizer
        </h1>
        <p className="text-muted-foreground mt-1">Pick a product → AI optimizes → Apply to your store.</p>
      </motion.div>

      {noConnections ? (
        <Card className="bg-card/50 border-border/30">
          <CardContent className="p-8 text-center space-y-4">
            <Store className="h-12 w-12 text-muted-foreground mx-auto" />
            <h2 className="text-lg font-semibold">Connect Your Store First</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Head to Settings, paste your Shopify Admin API token or connect Etsy, and come back here to optimize.
            </p>
            <Button onClick={() => window.location.href = "/settings"} className="gradient-phoenix text-primary-foreground">
              Go to Settings
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Tabs value={platform} onValueChange={(v) => setPlatform(v as Platform)}>
          <TabsList className="bg-muted/50">
            {connections.shopify && (
              <TabsTrigger value="shopify" className="flex items-center gap-2">
                <ShoppingBag className="h-4 w-4" /> Shopify
              </TabsTrigger>
            )}
            {connections.etsy && (
              <TabsTrigger value="etsy" className="flex items-center gap-2">
                <Store className="h-4 w-4" /> Etsy
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="shopify" className="space-y-4 mt-4">
            <Card className="bg-card/50 border-border/30">
              <CardContent className="p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">Active Shopify store</p>
                  <p className="text-xs text-muted-foreground">Choose the store this optimizer should read from and write to.</p>
                  {optimizerUsage && (
                    <div className="flex items-center gap-2 mt-1.5">
                      <div className="h-1.5 w-32 rounded-full bg-muted/50 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${optimizerUsage.used >= optimizerUsage.limit ? "bg-red-500" : optimizerUsage.used >= optimizerUsage.limit * 0.8 ? "bg-amber-400" : "bg-primary"}`}
                          style={{ width: `${Math.min(100, (optimizerUsage.used / optimizerUsage.limit) * 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {optimizerUsage.used}/{optimizerUsage.limit} optimizations this month
                      </span>
                    </div>
                  )}
                </div>
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={selectedShopifyConnectionId}
                  onChange={(e) => {
                    setSelectedShopifyConnectionId(e.target.value);
                    setSelectedProduct(null);
                    setShopifySuggestions(null);
                    setShopifyProducts([]);
                    setShopifyNextCursor(null);
                    setShopifyHasMore(false);
                    setShopifyDoneIds(new Set());
                  }}
                >
                  <option value="">Select a Shopify store</option>
                  {shopifyStoreOptions.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.shop_name || connection.shop_domain || "Shopify store"}
                    </option>
                  ))}
                </select>
              </CardContent>
            </Card>
            {shopifyLoading ? (
              <div className="flex flex-col items-center justify-center h-40 gap-3">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Loading your products...</p>
              </div>
            ) : selectedProduct ? (
              <AnimatePresence mode="wait">
                <motion.div key="shopify-detail" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="space-y-4">
                  <Card className="bg-card/50 border-border/30">
                    <CardContent className="p-4 flex gap-4">
                      <ProductImage src={selectedProduct.images?.[0]?.src} alt={selectedProduct.title} size="lg" />
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <h2 className="font-semibold text-base leading-tight">{selectedProduct.title}</h2>
                          <Button variant="ghost" size="sm" className="shrink-0 text-xs" onClick={() => { setSelectedProduct(null); setShopifySuggestions(null); setAltsAIFilled(0); }}>
                            Back
                          </Button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {selectedProduct.product_type && (
                            <Badge variant="outline" className="text-xs">{selectedProduct.product_type}</Badge>
                          )}
                          <Badge variant="outline" className="text-xs">{selectedProduct.variants.length} variant{selectedProduct.variants.length !== 1 ? "s" : ""}</Badge>
                          {selectedProduct.variants[0]?.price && (
                            <Badge variant="outline" className="text-xs">${selectedProduct.variants[0].price}</Badge>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Pre-optimization form — only shown before optimization runs */}
                  {!shopifySuggestions && !shopifyOptimizing && (
                    <Card className="bg-card/50 border-primary/20">
                      <CardContent className="p-4 space-y-4">
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Product Title</label>
                          <input
                            type="text"
                            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                            value={productTitleEdit}
                            onChange={(e) => setProductTitleEdit(e.target.value)}
                            maxLength={70}
                          />
                        </div>
                        {!selectedProduct.body_html?.trim() && (
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium text-amber-500 uppercase tracking-wider">No description found — what is this product?</label>
                            <textarea
                              className="w-full rounded-md border border-amber-500/40 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
                              rows={3}
                              placeholder="e.g. A 3-piece paint splatter lounge set including hoodie, joggers and shorts. Unisex sizing XS-4XL."
                              value={productContextNote}
                              onChange={(e) => setProductContextNote(e.target.value)}
                            />
                          </div>
                        )}
                        <Button
                          className="w-full gradient-phoenix text-primary-foreground"
                          onClick={() => void startOptimization()}
                          disabled={!productTitleEdit.trim()}
                        >
                          <Sparkles className="h-4 w-4 mr-2" /> Start Optimization
                        </Button>
                      </CardContent>
                    </Card>
                  )}

                  {shopifyOptimizing && (
                    <Card className="bg-card/50 border-border/30">
                      <CardContent className="p-6 flex flex-col items-center gap-3">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        <p className="text-sm text-muted-foreground">AI is optimizing your product...</p>
                      </CardContent>
                    </Card>
                  )}

                  {shopifySuggestions && selectedProduct.images && selectedProduct.images.length > 0 && (
                    <Card className={`border-border/30 overflow-hidden ${altsAIFilled > 0 ? "bg-primary/5 border-primary/30" : "bg-card/50"}`}>
                      <button className="w-full p-4 flex items-center justify-between text-left" onClick={() => setAltTextExpanded((v) => !v)}>
                        <div className="flex items-center gap-2">
                          <ImageIcon className="h-4 w-4 text-primary" />
                          <span className="text-sm font-medium">Image Alt Text</span>
                          <Badge variant="outline" className="text-[10px] py-0">{selectedProduct.images.length} image{selectedProduct.images.length !== 1 ? "s" : ""}</Badge>
                          {altsAIFilled > 0 && (
                            <Badge className="bg-primary/20 text-primary border-primary/30 border text-[10px] px-1.5">AI filled {altsAIFilled}</Badge>
                          )}
                        </div>
                        {altTextExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      </button>
                      {altTextExpanded && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="px-4 pb-4 space-y-3">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={altScanLoading}
                              onClick={scanImageAlts}
                            >
                              {altScanLoading
                                ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Scanning images...</>
                                : <><Sparkles className="h-3.5 w-3.5 mr-1.5" /> Scan Images for Alt + Names</>
                              }
                            </Button>
                          </div>
                          {selectedProduct.images.map((img, i) => (
                            <div key={img.id} className="flex gap-3 items-start">
                              <img src={img.src} alt={img.alt || ""} className="w-16 h-16 rounded-lg object-cover border border-border/30 shrink-0" />
                              <div className="flex-1 space-y-1">
                                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Image {i + 1}</p>
                                <input
                                  type="text"
                                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                                  placeholder="Describe this image..."
                                  value={imageAltEdits[img.id] ?? (img.alt || "")}
                                  onChange={(e) => setImageAltEdits(prev => ({ ...prev, [img.id]: e.target.value }))}
                                  maxLength={512}
                                />
                                <input
                                  type="text"
                                  readOnly
                                  className="w-full h-8 rounded-md border border-input bg-muted/30 px-3 text-xs text-muted-foreground"
                                  value={imageFilenameDrafts[img.id] || ""}
                                />
                              </div>
                            </div>
                          ))}
                          <Button size="sm" disabled={savingAltText || Object.keys(imageAltEdits).length === 0} onClick={saveAltTextOnly} className="w-full">
                            {savingAltText ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Saving...</> : "Save Alt Text to Shopify"}
                          </Button>
                          <Button size="sm" variant="ghost" className="w-full text-muted-foreground" onClick={() => setAltTextExpanded(false)}>
                            <ChevronUp className="h-3.5 w-3.5 mr-1.5" /> Collapse
                          </Button>
                        </motion.div>
                      )}
                    </Card>
                  )}

                  {shopifySuggestions && (<Card className="bg-card/50 border-border/30 overflow-hidden">
                    <button className="w-full p-4 flex items-center justify-between text-left" onClick={() => toggle("sales_channels")}>
                      <div className="flex items-center gap-2">
                        <Radio className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium">Sales Channels</span>
                        {!channelsLoading && salesChannels.length > 0 && (
                          <Badge variant="outline" className="text-[10px] py-0">{publishedChannelIds.length}/{salesChannels.length} active</Badge>
                        )}
                      </div>
                      {expandedSection === "sales_channels" ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </button>
                    {expandedSection === "sales_channels" && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="px-4 pb-4 space-y-2">
                        {channelsLoading ? (
                          <div className="flex items-center gap-2 py-2">
                            <Loader2 className="h-4 w-4 animate-spin text-primary" />
                            <span className="text-sm text-muted-foreground">Loading channels...</span>
                          </div>
                        ) : salesChannels.length === 0 ? (
                          <p className="text-sm text-muted-foreground py-2">No sales channels found for this store.</p>
                        ) : (
                          salesChannels.map((channel) => {
                            const isPublished = publishedChannelIds.includes(channel.id);
                            const isToggling = channelTogglingId === channel.id;
                            return (
                              <div key={channel.id} className="flex items-center justify-between py-2 border-b border-border/20 last:border-0">
                                <div className="flex items-center gap-2">
                                  {isToggling ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                                  ) : (
                                    <div className={`w-2 h-2 rounded-full ${isPublished ? "bg-green-500" : "bg-muted-foreground/40"}`} />
                                  )}
                                  <span className="text-sm">{channel.name}</span>
                                </div>
                                <Switch
                                  checked={isPublished}
                                  disabled={isToggling}
                                  onCheckedChange={() => toggleSalesChannel(channel.id, isPublished)}
                                />
                              </div>
                            );
                          })
                        )}
                      </motion.div>
                    )}
                  </Card>

                   )}

                   {shopifyOptimizing ? (
                    <Card className="bg-card/50 border-border/30">
                      <CardContent className="p-8 flex flex-col items-center gap-3">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <p className="text-sm text-muted-foreground">Optimizing for Shopify SEO...</p>
                      </CardContent>
                    </Card>
                  ) : shopifySuggestions ? (
                    <>
                      <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                        <p className="text-sm text-muted-foreground"><Sparkles className="h-4 w-4 inline mr-1 text-primary" />{shopifySuggestions.reasoning}</p>
                      </div>
                      <ComparisonRow label="Product Title" icon={<Tag className="h-4 w-4 text-primary" />} original={selectedProduct.title} optimized={shopifySuggestions.title} onChange={(v) => setShopifySuggestions({ ...shopifySuggestions, title: v })} />
                      <ComparisonRow label="SEO Title" icon={<FileText className="h-4 w-4 text-primary" />} original={selectedProduct.title} optimized={shopifySuggestions.seo_title} onChange={(v) => setShopifySuggestions({ ...shopifySuggestions, seo_title: v })} />
                      <ComparisonRow label="SEO Description" icon={<FileText className="h-4 w-4 text-primary" />} original="" optimized={shopifySuggestions.seo_description} onChange={(v) => setShopifySuggestions({ ...shopifySuggestions, seo_description: v })} multiline />
                      <ComparisonRow label="Product Type" icon={<Palette className="h-4 w-4 text-primary" />} original={selectedProduct.product_type || ""} optimized={shopifySuggestions.product_type} onChange={(v) => setShopifySuggestions({ ...shopifySuggestions, product_type: v })} />
                      <ComparisonRow label="Tags" icon={<Tag className="h-4 w-4 text-primary" />} original={selectedProduct.tags || ""} optimized={shopifySuggestions.tags} onChange={(v) => setShopifySuggestions({ ...shopifySuggestions, tags: v })} multiline />
                      <ComparisonRow
                        label="Social (OG) Title"
                        icon={<Link className="h-4 w-4 text-primary" />}
                        original="Derived from title"
                        optimized={shopifySuggestions.og_title || shopifySuggestions.seo_title}
                        onChange={(v) => setShopifySuggestions({ ...shopifySuggestions, og_title: v })}
                      />
                      <ComparisonRow
                        label="OG Description"
                        icon={<FileText className="h-4 w-4 text-primary" />}
                        original="Empty"
                        optimized={shopifySuggestions.og_description || shopifySuggestions.seo_description}
                        onChange={(v) => setShopifySuggestions({ ...shopifySuggestions, og_description: v })}
                        multiline
                      />
                      <div className="flex gap-3 pt-2">
                        <Button onClick={applyShopifyChanges} disabled={shopifyApplying} className="gradient-phoenix text-primary-foreground flex-1">
                          {shopifyApplying ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Applying...</> : <><CheckCircle2 className="h-4 w-4 mr-2" /> Apply All Changes to Shopify</>}
                        </Button>
                      </div>
                    </>
                  ) : null}
                </motion.div>
              </AnimatePresence>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">{selectedShopifyConnectionId ? `${shopifyProducts.length} products` : "Select a store."}</p>
                  <Button variant="outline" size="sm" onClick={() => void fetchShopifyProducts(null, false)} disabled={!selectedShopifyConnectionId}>Refresh</Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {shopifyProducts.map((product) => (
                    <motion.div key={product.id} whileHover={{ scale: 1.01 }} className="cursor-pointer" onClick={() => selectProduct(product)}>
                      <Card className="bg-card/50 border-border/30 hover:border-primary/40">
                        <CardContent className="p-3 flex gap-3">
                          <ProductImage src={product.images?.[0]?.src} alt={product.title} size="md" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm line-clamp-2">{product.title}</p>
                            <Badge variant="outline" className="text-[10px] mt-1">{product.product_type}</Badge>

                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
                </div>
                {shopifyHasMore && (
                  <Button variant="outline" className="w-full" onClick={() => void fetchShopifyProducts(shopifyNextCursor, true)} disabled={shopifyLoading}>
                    {shopifyLoading ? "Loading..." : "Load More Products"}
                  </Button>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="etsy" className="space-y-4 mt-4">
            <Card className="bg-card/50 border-border/30">
              <CardContent className="p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">Active Etsy shop</p>
                  <p className="text-xs text-muted-foreground">Select connection for optimization.</p>
                </div>
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={selectedEtsyConnectionId}
                  onChange={(e) => {
                    setSelectedEtsyConnectionId(e.target.value);
                    setSelectedListing(null);
                    setEtsyListings([]);
                  }}
                >
                  <option value="">Select an Etsy shop</option>
                  {etsyStoreOptions.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.shop_name || connection.shop_domain || "Etsy shop"}
                    </option>
                  ))}
                </select>
              </CardContent>
            </Card>
            {etsyLoading ? (
              <div className="flex flex-col items-center justify-center h-40 gap-3">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Loading listings...</p>
              </div>
            ) : selectedListing ? (
              <AnimatePresence mode="wait">
                <motion.div key="etsy-detail" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="space-y-4">
                  <Card className="bg-card/50 border-border/30">
                    <CardContent className="p-4 flex gap-4">
                      <ProductImage src={selectedListing.images?.[0]?.url_570xN} alt={selectedListing.title} size="lg" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h2 className="font-semibold text-base leading-tight">{selectedListing.title}</h2>
                          <Button variant="ghost" size="sm" onClick={() => setSelectedListing(null)}>Back</Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {etsyOptimizing ? (
                    <Card className="bg-card/50 border-border/30 p-8 text-center">
                      <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground">Optimizing Etsy search...</p>
                    </Card>
                  ) : etsySuggestions ? (
                    <>
                      <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm">
                        <Sparkles className="h-4 w-4 inline mr-1 text-primary" />{etsySuggestions.reasoning}
                      </div>
                      <ComparisonRow label="Title" icon={<Tag className="h-4 w-4 text-primary" />} original={selectedListing.title} optimized={etsySuggestions.title} onChange={(v) => setEtsySuggestions({ ...etsySuggestions, title: v })} />
                      <ComparisonRow label="Tags" icon={<Tag className="h-4 w-4 text-primary" />} original={selectedListing.tags?.join(", ") || ""} optimized={etsySuggestions.tags?.join(", ") || ""} onChange={(v) => setEtsySuggestions({ ...etsySuggestions, tags: v.split(",").map(t => t.trim()) })} multiline />
                      <div className="flex gap-3 pt-2">
                        <Button onClick={applyEtsyChanges} disabled={etsyApplying} className="gradient-phoenix text-primary-foreground flex-1">
                          {etsyApplying ? "Applying..." : "Apply to Etsy"}
                        </Button>
                      </div>
                    </>
                  ) : null}
                </motion.div>
              </AnimatePresence>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">{selectedEtsyConnectionId ? `${etsyListings.length} listings` : "Select shop."}</p>
                  <Button variant="outline" size="sm" onClick={fetchEtsyListings} disabled={!selectedEtsyConnectionId}>Refresh</Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {etsyListings.map((listing) => (
                    <motion.div key={listing.listing_id} whileHover={{ scale: 1.01 }} className="cursor-pointer" onClick={() => optimizeEtsy(listing)}>
                      <Card className="bg-card/50 border-border/30 hover:border-primary/40">
                        <CardContent className="p-3 flex gap-3">
                          <ProductImage src={listing.images?.[0]?.url_170x135} alt={listing.title} size="md" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm line-clamp-2">{listing.title}</p>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}