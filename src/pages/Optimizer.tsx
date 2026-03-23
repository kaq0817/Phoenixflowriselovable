import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  BarChart3, Sparkles, ShoppingBag, Store, Loader2, CheckCircle2,
  ChevronDown, ChevronUp, Image as ImageIcon, Tag, FileText, Palette,
  ArrowRight, Copy
} from "lucide-react";
import { CopyButton, copyAllFields } from "@/components/CopyButton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

// ── Types ──
interface ShopifyProduct {
  id: number;
  title: string;
  body_html: string;
  product_type: string;
  vendor: string;
  tags: string;
  variants: { id: number; title: string; price: string; inventory_quantity: number; option1?: string; option2?: string; option3?: string }[];
  images: { src: string }[];
  handle: string;
}

interface ShopifySuggestions {
  title: string;
  body_html: string;
  seo_title: string;
  seo_description: string;
  product_type: string;
  tags: string;
  variant_suggestions?: string;
  reasoning: string;
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

function isUsableEtsyConnection(connection: StoreConnectionOption): boolean {
  return connection.platform === "etsy" && !!connection.shop_domain && !!connection.scopes?.includes("shops_r:");
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

  // Etsy
  const [etsyListings, setEtsyListings] = useState<EtsyListing[]>([]);
  const [etsyLoading, setEtsyLoading] = useState(false);
  const [selectedListing, setSelectedListing] = useState<EtsyListing | null>(null);
  const [etsySuggestions, setEtsySuggestions] = useState<EtsySuggestions | null>(null);
  const [etsyOptimizing, setEtsyOptimizing] = useState(false);
  const [etsyApplying, setEtsyApplying] = useState(false);

  const [expandedSection, setExpandedSection] = useState<string | null>(null);

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

  const fetchShopifyProducts = async () => {
    setShopifyLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-shopify-products", { body: { limit: 50, connectionId: selectedShopifyConnectionId || undefined } });
      if (error) throw error;
      setShopifyProducts(data.products || []);
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to fetch products", variant: "destructive" });
    } finally {
      setShopifyLoading(false);
    }
  };

  const fetchEtsyListings = async () => {
    setEtsyLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-etsy-listings", { body: { limit: 50, state: "active", connectionId: selectedEtsyConnectionId || undefined } });
      if (error) throw error;
      setEtsyListings(data.results || []);
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to fetch listings", variant: "destructive" });
    } finally {
      setEtsyLoading(false);
    }
  };

  useEffect(() => {
    if (platform === "shopify" && connections.shopify && shopifyProducts.length === 0) fetchShopifyProducts();
    if (platform === "etsy" && connections.etsy && etsyListings.length === 0) fetchEtsyListings();
  }, [platform, connections]);

  // ── Shopify actions ──
  const optimizeShopify = async (product: ShopifyProduct) => {
    setSelectedProduct(product);
    setShopifySuggestions(null);
    setShopifyOptimizing(true);
    setExpandedSection(null);
    try {
      const { data, error } = await supabase.functions.invoke("optimize-shopify-listing", { body: { product } });
      if (error) throw error;
      setShopifySuggestions(data.suggestions);
      setExpandedSection("title");
    } catch (err: any) {
      toast({ title: "Optimization failed", description: err.message, variant: "destructive" });
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
        body: { productId: selectedProduct.id, optimizedData: shopifySuggestions, connectionId: selectedShopifyConnectionId || undefined },
      });
      if (error) throw error;
      toast({ title: "Done!", description: "Changes applied to your Shopify store." });
      setSelectedProduct(null);
      setShopifySuggestions(null);
      fetchShopifyProducts();
    } catch (err: any) {
      toast({ title: "Apply failed", description: err.message, variant: "destructive" });
    } finally {
      setShopifyApplying(false);
    }
  };

  // ── Etsy actions ──
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
    } catch (err: any) {
      toast({ title: "Optimization failed", description: err.message, variant: "destructive" });
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
    } catch (err: any) {
      toast({ title: "Apply failed", description: err.message, variant: "destructive" });
    } finally {
      setEtsyApplying(false);
    }
  };

  const toggle = (key: string) => setExpandedSection(expandedSection === key ? null : key);

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

  // ── Product image component ──
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

  // ── Comparison row ──
  const ComparisonRow = ({ label, icon, original, optimized, sectionKey }: {
    label: string; icon: React.ReactNode; original: string; optimized: string; sectionKey: string;
  }) => (
    <Card className="bg-card/50 border-border/30 overflow-hidden">
      <button className="w-full p-4 flex items-center justify-between text-left" onClick={() => toggle(sectionKey)}>
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          {original !== optimized && <Badge className="bg-primary/10 text-primary text-xs border-0">Changed</Badge>}
          {expandedSection === sectionKey ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>
      {expandedSection === sectionKey && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="px-4 pb-4 space-y-3">
          <div className="flex gap-3 items-start">
            <div className="flex-1 p-3 rounded-lg bg-muted/30 border border-border/20">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 font-medium">Current</p>
              <p className="text-sm leading-relaxed">{original || <span className="italic text-muted-foreground/50">Empty</span>}</p>
            </div>
            <ArrowRight className="h-4 w-4 text-primary mt-8 shrink-0" />
            <div className="flex-1 p-3 rounded-lg bg-primary/5 border border-primary/20">
              <p className="text-[10px] uppercase tracking-wider text-primary mb-1.5 font-medium">Optimized</p>
              <p className="text-sm leading-relaxed">{optimized}</p>
            </div>
          </div>
        </motion.div>
      )}
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

          {/* ═══════ SHOPIFY TAB ═══════ */}
          <TabsContent value="shopify" className="space-y-4 mt-4">
            <Card className="bg-card/50 border-border/30">
              <CardContent className="p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">Active Shopify store</p>
                  <p className="text-xs text-muted-foreground">Choose the store this optimizer should read from and write to.</p>
                </div>
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={selectedShopifyConnectionId}
                  onChange={(e) => {
                    setSelectedShopifyConnectionId(e.target.value);
                    setSelectedProduct(null);
                    setShopifySuggestions(null);
                    setShopifyProducts([]);
                  }}
                >
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
                  {/* Product header with image */}
                  <Card className="bg-card/50 border-border/30">
                    <CardContent className="p-4 flex gap-4">
                      <ProductImage src={selectedProduct.images?.[0]?.src} alt={selectedProduct.title} size="lg" />
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <h2 className="font-semibold text-base leading-tight">{selectedProduct.title}</h2>
                          <Button variant="ghost" size="sm" className="shrink-0 text-xs" onClick={() => { setSelectedProduct(null); setShopifySuggestions(null); }}>
                            ← Back
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
                        {selectedProduct.variants.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {selectedProduct.variants.slice(0, 6).map((v) => (
                              <span key={v.id} className="text-[11px] bg-muted/50 px-2 py-0.5 rounded-full text-muted-foreground">{v.title}</span>
                            ))}
                            {selectedProduct.variants.length > 6 && (
                              <span className="text-[11px] text-muted-foreground">+{selectedProduct.variants.length - 6} more</span>
                            )}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {shopifyOptimizing ? (
                    <Card className="bg-card/50 border-border/30">
                      <CardContent className="p-8 flex flex-col items-center gap-3">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <p className="text-sm text-muted-foreground">Optimizing for Shopify SEO...</p>
                        <div className="flex gap-2">
                          {["Color", "Size", "Gender", "Category"].map((tag) => (
                            <Badge key={tag} variant="outline" className="text-xs animate-pulse">{tag}</Badge>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  ) : shopifySuggestions ? (
                    <>
                      <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                        <p className="text-sm text-muted-foreground"><Sparkles className="h-4 w-4 inline mr-1 text-primary" />{shopifySuggestions.reasoning}</p>
                      </div>

                      <ComparisonRow label="Product Title" icon={<Tag className="h-4 w-4 text-primary" />} original={selectedProduct.title} optimized={shopifySuggestions.title} sectionKey="title" />
                      <ComparisonRow label="SEO Title" icon={<FileText className="h-4 w-4 text-primary" />} original={selectedProduct.title} optimized={shopifySuggestions.seo_title} sectionKey="seo_title" />
                      <ComparisonRow label="SEO Description" icon={<FileText className="h-4 w-4 text-primary" />} original="" optimized={shopifySuggestions.seo_description} sectionKey="seo_desc" />
                      <ComparisonRow label="Product Type" icon={<Palette className="h-4 w-4 text-primary" />} original={selectedProduct.product_type || ""} optimized={shopifySuggestions.product_type} sectionKey="type" />
                      <ComparisonRow label="Tags" icon={<Tag className="h-4 w-4 text-primary" />} original={selectedProduct.tags || ""} optimized={shopifySuggestions.tags} sectionKey="tags" />

                      {shopifySuggestions.body_html && (
                        <Card className="bg-card/50 border-border/30 overflow-hidden">
                          <button className="w-full p-4 flex items-center justify-between text-left" onClick={() => toggle("body")}>
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4 text-primary" />
                              <span className="text-sm font-medium">Product Description</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge className="bg-primary/10 text-primary text-xs border-0">Changed</Badge>
                              {expandedSection === "body" ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                            </div>
                          </button>
                          {expandedSection === "body" && (
                            <div className="px-4 pb-4">
                              <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                                <p className="text-[10px] uppercase tracking-wider text-primary mb-1.5 font-medium">Optimized Description</p>
                                <div className="text-sm prose prose-sm max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: shopifySuggestions.body_html }} />
                              </div>
                            </div>
                          )}
                        </Card>
                      )}

                      {shopifySuggestions.variant_suggestions && (
                        <Card className="bg-card/50 border-border/30">
                          <CardContent className="p-4">
                            <p className="text-[10px] uppercase tracking-wider text-primary mb-1.5 font-medium">Variant Naming Suggestions</p>
                            <p className="text-sm text-muted-foreground">{shopifySuggestions.variant_suggestions}</p>
                          </CardContent>
                        </Card>
                      )}

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
                  <p className="text-sm text-muted-foreground">{shopifyProducts.length} products</p>
                  <Button variant="outline" size="sm" onClick={fetchShopifyProducts}>Refresh</Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {shopifyProducts.map((product) => (
                    <motion.div key={product.id} whileHover={{ scale: 1.01 }} className="cursor-pointer" onClick={() => optimizeShopify(product)}>
                      <Card className="bg-card/50 border-border/30 hover:border-primary/40 transition-all hover:shadow-lg hover:shadow-primary/5">
                        <CardContent className="p-3 flex gap-3">
                          <ProductImage src={product.images?.[0]?.src} alt={product.title} size="md" />
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <p className="font-medium text-sm leading-tight line-clamp-2">{product.title}</p>
                            <div className="flex flex-wrap gap-1">
                              {product.product_type && (
                                <Badge variant="outline" className="text-[10px] py-0">{product.product_type}</Badge>
                              )}
                              <Badge variant="outline" className="text-[10px] py-0">{product.variants.length} var.</Badge>
                              {product.variants[0]?.price && (
                                <Badge variant="outline" className="text-[10px] py-0">${product.variants[0].price}</Badge>
                              )}
                            </div>
                            {product.images && product.images.length > 1 && (
                              <div className="flex gap-1">
                                {product.images.slice(1, 4).map((img, i) => (
                                  <img key={i} src={img.src} alt="" className="w-8 h-8 rounded object-cover border border-border/20" />
                                ))}
                                {product.images.length > 4 && (
                                  <span className="w-8 h-8 rounded bg-muted/50 flex items-center justify-center text-[10px] text-muted-foreground border border-border/20">+{product.images.length - 4}</span>
                                )}
                              </div>
                            )}
                            <div className="flex items-center gap-1 text-primary text-xs font-medium pt-0.5">
                              <Sparkles className="h-3 w-3" /> Tap to optimize
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
                </div>
                {shopifyProducts.length === 0 && !shopifyLoading && (
                  <p className="text-center text-muted-foreground py-8">No active products found in your store.</p>
                )}
              </>
            )}
          </TabsContent>

          {/* ═══════ ETSY TAB ═══════ */}
          <TabsContent value="etsy" className="space-y-4 mt-4">
            <Card className="bg-card/50 border-border/30">
              <CardContent className="p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">Active Etsy shop</p>
                  <p className="text-xs text-muted-foreground">Choose which Etsy connection this optimizer should use.</p>
                </div>
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={selectedEtsyConnectionId}
                  onChange={(e) => {
                    setSelectedEtsyConnectionId(e.target.value);
                    setSelectedListing(null);
                    setEtsySuggestions(null);
                    setEtsyListings([]);
                  }}
                >
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
                <p className="text-sm text-muted-foreground">Loading your listings...</p>
              </div>
            ) : selectedListing ? (
              <AnimatePresence mode="wait">
                <motion.div key="etsy-detail" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="space-y-4">
                  {/* Listing header with image */}
                  <Card className="bg-card/50 border-border/30">
                    <CardContent className="p-4 flex gap-4">
                      <ProductImage src={selectedListing.images?.[0]?.url_570xN || selectedListing.images?.[0]?.url_170x135} alt={selectedListing.title} size="lg" />
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <h2 className="font-semibold text-base leading-tight">{selectedListing.title}</h2>
                          <Button variant="ghost" size="sm" className="shrink-0 text-xs" onClick={() => { setSelectedListing(null); setEtsySuggestions(null); }}>
                            ← Back
                          </Button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant="outline" className="text-xs">{selectedListing.tags?.length || 0} tags</Badge>
                          <Badge variant="outline" className="text-xs">{selectedListing.materials?.length || 0} materials</Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {etsyOptimizing ? (
                    <Card className="bg-card/50 border-border/30">
                      <CardContent className="p-8 flex flex-col items-center gap-3">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <p className="text-sm text-muted-foreground">Optimizing for Etsy search...</p>
                        <div className="flex gap-2">
                          {["Tags", "Materials", "Keywords", "Description"].map((tag) => (
                            <Badge key={tag} variant="outline" className="text-xs animate-pulse">{tag}</Badge>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  ) : etsySuggestions ? (
                    <>
                      <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                        <p className="text-sm text-muted-foreground"><Sparkles className="h-4 w-4 inline mr-1 text-primary" />{etsySuggestions.reasoning}</p>
                      </div>

                      <ComparisonRow label="Title" icon={<Tag className="h-4 w-4 text-primary" />} original={selectedListing.title} optimized={etsySuggestions.title} sectionKey="title" />
                      <ComparisonRow label="Tags" icon={<Tag className="h-4 w-4 text-primary" />} original={selectedListing.tags?.join(", ") || ""} optimized={etsySuggestions.tags?.join(", ") || ""} sectionKey="tags" />
                      <ComparisonRow label="Materials" icon={<Palette className="h-4 w-4 text-primary" />} original={selectedListing.materials?.join(", ") || ""} optimized={etsySuggestions.materials?.join(", ") || ""} sectionKey="materials" />
                      <ComparisonRow label="Description" icon={<FileText className="h-4 w-4 text-primary" />} original={selectedListing.description?.substring(0, 300) || ""} optimized={etsySuggestions.description?.substring(0, 300) || ""} sectionKey="desc" />

                      <div className="flex gap-3 pt-2">
                        <Button
                          onClick={async () => {
                            if (!etsySuggestions) return;
                            const text = copyAllFields([
                              { label: "Title", value: etsySuggestions.title },
                              { label: "Tags", value: etsySuggestions.tags?.join(", ") || "" },
                              { label: "Materials", value: etsySuggestions.materials?.join(", ") || "" },
                              { label: "Description", value: etsySuggestions.description },
                            ]);
                            await navigator.clipboard.writeText(text);
                            toast({ title: "Copied!", description: "Paste the optimized content into your Etsy listing." });
                          }}
                          className="gradient-phoenix text-primary-foreground flex-1"
                        >
                          <Copy className="h-4 w-4 mr-2" /> Copy All Changes
                        </Button>
                        <CopyButton text={etsySuggestions?.title || ""} label="Title" />
                        <CopyButton text={etsySuggestions?.tags?.join(", ") || ""} label="Tags" />
                      </div>
                    </>
                  ) : null}
                </motion.div>
              </AnimatePresence>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">{etsyListings.length} listings</p>
                  <Button variant="outline" size="sm" onClick={fetchEtsyListings}>Refresh</Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {etsyListings.map((listing) => (
                    <motion.div key={listing.listing_id} whileHover={{ scale: 1.01 }} className="cursor-pointer" onClick={() => optimizeEtsy(listing)}>
                      <Card className="bg-card/50 border-border/30 hover:border-primary/40 transition-all hover:shadow-lg hover:shadow-primary/5">
                        <CardContent className="p-3 flex gap-3">
                          <ProductImage src={listing.images?.[0]?.url_170x135 || listing.images?.[0]?.url_570xN} alt={listing.title} size="md" />
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <p className="font-medium text-sm leading-tight line-clamp-2">{listing.title}</p>
                            <div className="flex flex-wrap gap-1">
                              <Badge variant="outline" className="text-[10px] py-0">{listing.tags?.length || 0} tags</Badge>
                              <Badge variant="outline" className="text-[10px] py-0">{listing.materials?.length || 0} mat.</Badge>
                            </div>
                            <div className="flex items-center gap-1 text-primary text-xs font-medium pt-0.5">
                              <Sparkles className="h-3 w-3" /> Tap to optimize
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
                </div>
                {etsyListings.length === 0 && !etsyLoading && (
                  <p className="text-center text-muted-foreground py-8">No active listings found.</p>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}







