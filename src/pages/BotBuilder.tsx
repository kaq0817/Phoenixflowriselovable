import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Bot, Loader2, RefreshCw, ShoppingBag, Sparkles, Store } from "lucide-react";

import { CopyButton, copyAllFields } from "@/components/CopyButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type SourceMode = "shopify" | "etsy" | "manual";
type Platform = "shopify" | "etsy";

interface StoreConnectionOption {
  id: string;
  platform: Platform;
  shop_domain: string | null;
  shop_name: string | null;
  scopes?: string | null;
  created_at: string;
}

interface ShopifyProduct {
  id: number;
  title: string;
  body_html: string;
  product_type: string;
  vendor: string;
  tags: string;
  variants: { id: number; title: string; price: string; inventory_quantity: number }[];
  images: { src: string; alt?: string | null }[];
  handle: string;
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

interface ManualItemState {
  title: string;
  description: string;
  productType: string;
  vendor: string;
  keyFeatures: string;
  materials: string;
}

interface StrategyState {
  brandGoal: string;
  audience: string;
  offer: string;
  tone: string;
  callToAction: string;
}

interface AdConcept {
  headline: string;
  angle: string;
  hook: string;
  visual_style: string;
  script: string;
  voiceover: string;
  caption: string;
  cta: string;
  compliance_notes: string;
  reasoning: string;
  asset_checklist: string[];
  shot_plan: {
    timecode: string;
    visual: string;
    on_screen_text: string;
    voiceover: string;
  }[];
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function isUsableEtsyConnection(connection: StoreConnectionOption) {
  return connection.platform === "etsy" && !!connection.shop_domain && !!connection.scopes?.includes("shops_r:");
}

function getStoreLabel(connection: StoreConnectionOption) {
  return connection.shop_name || connection.shop_domain || "Unnamed store";
}

function splitList(value: string) {
  return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
}

export default function BotPage() {
  const { session } = useAuth();
  const { toast } = useToast();

  const [sourceMode, setSourceMode] = useState<SourceMode>("manual");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [shopifyLoading, setShopifyLoading] = useState(false);
  const [etsyLoading, setEtsyLoading] = useState(false);
  const [storeConnections, setStoreConnections] = useState<StoreConnectionOption[]>([]);
  const [selectedShopifyConnectionId, setSelectedShopifyConnectionId] = useState("");
  const [selectedEtsyConnectionId, setSelectedEtsyConnectionId] = useState("");
  const [shopifyProducts, setShopifyProducts] = useState<ShopifyProduct[]>([]);
  const [etsyListings, setEtsyListings] = useState<EtsyListing[]>([]);
  const [selectedShopifyProductId, setSelectedShopifyProductId] = useState("");
  const [selectedEtsyListingId, setSelectedEtsyListingId] = useState("");
  const [manualItem, setManualItem] = useState<ManualItemState>({
    title: "",
    description: "",
    productType: "",
    vendor: "",
    keyFeatures: "",
    materials: "",
  });
  const [strategy, setStrategy] = useState<StrategyState>({
    brandGoal: "Drive clicks with a truthful short-form hook",
    audience: "",
    offer: "",
    tone: "Clean, confident, product-first",
    callToAction: "Shop now",
  });
  const [result, setResult] = useState<AdConcept | null>(null);

  useEffect(() => {
    if (!session) return;

    void (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("store_connections")
        .select("id, platform, shop_domain, shop_name, scopes, created_at")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false });

      const allRows = (data || []) as StoreConnectionOption[];
      const rows = allRows.filter((connection) => connection.platform === "shopify" || isUsableEtsyConnection(connection));
      setStoreConnections(rows);

      const firstShopify = rows.find((connection) => connection.platform === "shopify");
      const firstEtsy = rows.find((connection) => connection.platform === "etsy");
      setSelectedShopifyConnectionId(firstShopify?.id || "");
      setSelectedEtsyConnectionId(firstEtsy?.id || "");

      if (firstShopify) setSourceMode("shopify");
      else if (firstEtsy) setSourceMode("etsy");
      else setSourceMode("manual");

      setLoading(false);
    })();
  }, [session]);

  const hasShopify = useMemo(() => storeConnections.some((connection) => connection.platform === "shopify"), [storeConnections]);
  const hasEtsy = useMemo(() => storeConnections.some((connection) => connection.platform === "etsy"), [storeConnections]);
  const shopifyConnections = useMemo(() => storeConnections.filter((connection) => connection.platform === "shopify"), [storeConnections]);
  const etsyConnections = useMemo(() => storeConnections.filter((connection) => connection.platform === "etsy"), [storeConnections]);

  const fetchShopifyProducts = async (connectionId = selectedShopifyConnectionId) => {
    if (!connectionId) return;

    setShopifyLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-shopify-products", {
        body: { limit: 50, connectionId },
      });
      if (error) throw error;

      const products = (data?.products || []) as ShopifyProduct[];
      setShopifyProducts(products);
      setSelectedShopifyProductId(products[0] ? String(products[0].id) : "");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch Shopify products";
      toast({ title: "Product load failed", description: message, variant: "destructive" });
    } finally {
      setShopifyLoading(false);
    }
  };

  const fetchEtsyListings = async (connectionId = selectedEtsyConnectionId) => {
    if (!connectionId) return;

    setEtsyLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-etsy-listings", {
        body: { limit: 50, state: "active", connectionId },
      });
      if (error) throw error;

      const listings = (data?.results || []) as EtsyListing[];
      setEtsyListings(listings);
      setSelectedEtsyListingId(listings[0] ? String(listings[0].listing_id) : "");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch Etsy listings";
      toast({ title: "Listing load failed", description: message, variant: "destructive" });
    } finally {
      setEtsyLoading(false);
    }
  };

  useEffect(() => {
    if (loading || sourceMode !== "shopify" || !selectedShopifyConnectionId || shopifyProducts.length > 0) return;
    void fetchShopifyProducts(selectedShopifyConnectionId);
  }, [loading, sourceMode, selectedShopifyConnectionId, shopifyProducts.length]);

  useEffect(() => {
    if (loading || sourceMode !== "etsy" || !selectedEtsyConnectionId || etsyListings.length > 0) return;
    void fetchEtsyListings(selectedEtsyConnectionId);
  }, [loading, sourceMode, selectedEtsyConnectionId, etsyListings.length]);

  const selectedShopifyProduct = useMemo(
    () => shopifyProducts.find((product) => String(product.id) === selectedShopifyProductId) || null,
    [shopifyProducts, selectedShopifyProductId],
  );

  const selectedEtsyListing = useMemo(
    () => etsyListings.find((listing) => String(listing.listing_id) === selectedEtsyListingId) || null,
    [etsyListings, selectedEtsyListingId],
  );

  const sourcePreview = useMemo(() => {
    if (sourceMode === "shopify" && selectedShopifyProduct) {
      return {
        title: selectedShopifyProduct.title,
        description: stripHtml(selectedShopifyProduct.body_html || ""),
        subtitle: [selectedShopifyProduct.vendor, selectedShopifyProduct.product_type].filter(Boolean).join(" � ") || selectedShopifyProduct.handle,
        subtitle: [selectedShopifyProduct.vendor, selectedShopifyProduct.product_type].filter(Boolean).join(" - ") || selectedShopifyProduct.handle,
      };
    }

    if (sourceMode === "etsy" && selectedEtsyListing) {
      return {
        title: selectedEtsyListing.title,
        description: selectedEtsyListing.description,
        subtitle: selectedEtsyListing.taxonomy_path || "Etsy listing",
        subtitle: selectedEtsyListing.taxonomy_path || "Etsy listing", // No change needed here, it's not using the garbled char
      };
    }

    return {
      title: manualItem.title || "Manual product",
      description: manualItem.description,
      subtitle: [manualItem.vendor, manualItem.productType].filter(Boolean).join(" � ") || "Manual input",
    };
    }; // Changed to " - " below
  }, [sourceMode, selectedShopifyProduct, selectedEtsyListing, manualItem]);

  const generateDisabled = useMemo(() => {
    if (generating) return true;
    if (sourceMode === "shopify") return !selectedShopifyProduct;
    if (sourceMode === "etsy") return !selectedEtsyListing;
    return !manualItem.title.trim() || !manualItem.description.trim();
  }, [generating, sourceMode, selectedShopifyProduct, selectedEtsyListing, manualItem]);

  const handleGenerate = async () => {
    let item: Record<string, unknown> | null = null;
    let platform: SourceMode = sourceMode;

    if (sourceMode === "shopify" && selectedShopifyProduct) {
      item = {
        title: selectedShopifyProduct.title,
        description: stripHtml(selectedShopifyProduct.body_html || ""),
        productType: selectedShopifyProduct.product_type,
        vendor: selectedShopifyProduct.vendor,
        tags: selectedShopifyProduct.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        keyFeatures: [selectedShopifyProduct.product_type, `${selectedShopifyProduct.images?.length || 0} product images available`, `${selectedShopifyProduct.variants?.length || 0} variants`].filter(Boolean),
        variants: selectedShopifyProduct.variants.map((variant) => variant.title),
        imageCount: selectedShopifyProduct.images?.length || 0,
        hasAltText: selectedShopifyProduct.images?.some((image) => !!image.alt?.trim()) || false,
      };
    }

    if (sourceMode === "etsy" && selectedEtsyListing) {
      item = {
        title: selectedEtsyListing.title,
        description: selectedEtsyListing.description,
        productType: selectedEtsyListing.taxonomy_path || "Etsy listing",
        tags: selectedEtsyListing.tags || [],
        materials: selectedEtsyListing.materials || [],
        keyFeatures: [selectedEtsyListing.taxonomy_path || "", `${selectedEtsyListing.images?.length || 0} listing images available`].filter(Boolean),
        imageCount: selectedEtsyListing.images?.length || 0,
        hasAltText: false,
      };
    }

    if (sourceMode === "manual") {
      platform = "manual";
      item = {
        title: manualItem.title,
        description: manualItem.description,
        productType: manualItem.productType,
        vendor: manualItem.vendor,
        keyFeatures: splitList(manualItem.keyFeatures),
        materials: splitList(manualItem.materials),
        imageCount: 0,
        hasAltText: false,
      };
    }

    if (!item) return;

    setGenerating(true);
    setResult(null);

    try {
      const { data, error } = await supabase.functions.invoke("generate-ad-concept", {
        body: {
          platform,
          item,
          ...strategy,
        },
      });

      if (error) throw error;
      setResult(data.adConcept as AdConcept);
      toast({ title: "Ad concept ready", description: "Your 8-second concept is ready to review and copy." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to generate ad concept";
      toast({ title: "Ad generation failed", description: message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Bot className="h-6 w-6 text-primary" /> Ad Generator
        </h1>
        <p className="mt-1 text-muted-foreground">
          Create truthful 8-second product ads that highlight the best parts of an item without fake in-use scenes.
        </p>
      </motion.div>

      <Card className="border-border/30 bg-card/50">
        <CardHeader>
          <CardTitle className="text-lg">Creative Source</CardTitle>
          <CardDescription>
            Pick a real store item or enter product details manually. Manual mode keeps the feature usable even before a store is connected.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={sourceMode} onValueChange={(value) => setSourceMode(value as SourceMode)}>
            <TabsList className="grid w-full grid-cols-3 md:w-[420px]">
              <TabsTrigger value="shopify" disabled={!hasShopify}>Shopify</TabsTrigger>
              <TabsTrigger value="etsy" disabled={!hasEtsy}>Etsy</TabsTrigger>
              <TabsTrigger value="manual">Manual</TabsTrigger>
            </TabsList>

            <TabsContent value="shopify" className="space-y-4">
              {!hasShopify ? (
                <div className="rounded-lg border border-dashed border-border/50 px-4 py-6 text-sm text-muted-foreground">
                  No Shopify store is connected yet. Use Manual mode or connect Shopify in Settings.
                </div>
              ) : (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Shopify Store</p>
                      <Select value={selectedShopifyConnectionId} onValueChange={(value) => {
                        setSelectedShopifyConnectionId(value);
                        setShopifyProducts([]);
                        setSelectedShopifyProductId("");
                        void fetchShopifyProducts(value);
                      }}>
                        <SelectTrigger className="bg-muted/30"><SelectValue placeholder="Choose Shopify store" /></SelectTrigger>
                        <SelectContent>
                          {shopifyConnections.map((connection) => (
                            <SelectItem key={connection.id} value={connection.id}>{getStoreLabel(connection)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">Product</p>
                        <Button size="sm" variant="outline" onClick={() => void fetchShopifyProducts()} disabled={shopifyLoading}>
                          <RefreshCw className={cn("mr-2 h-4 w-4", shopifyLoading && "animate-spin")} /> Refresh
                        </Button>
                      </div>
                      <Select value={selectedShopifyProductId} onValueChange={setSelectedShopifyProductId}>
                        <SelectTrigger className="bg-muted/30"><SelectValue placeholder={shopifyLoading ? "Loading products..." : "Choose product"} /></SelectTrigger>
                        <SelectContent>
                          {shopifyProducts.map((product) => (
                            <SelectItem key={product.id} value={String(product.id)}>{product.title}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="etsy" className="space-y-4">
              {!hasEtsy ? (
                <div className="rounded-lg border border-dashed border-border/50 px-4 py-6 text-sm text-muted-foreground">
                  No Etsy store is connected yet. Use Manual mode or connect Etsy in Settings.
                </div>
              ) : (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Etsy Store</p>
                      <Select value={selectedEtsyConnectionId} onValueChange={(value) => {
                        setSelectedEtsyConnectionId(value);
                        setEtsyListings([]);
                        setSelectedEtsyListingId("");
                        void fetchEtsyListings(value);
                      }}>
                        <SelectTrigger className="bg-muted/30"><SelectValue placeholder="Choose Etsy store" /></SelectTrigger>
                        <SelectContent>
                          {etsyConnections.map((connection) => (
                            <SelectItem key={connection.id} value={connection.id}>{getStoreLabel(connection)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">Listing</p>
                        <Button size="sm" variant="outline" onClick={() => void fetchEtsyListings()} disabled={etsyLoading}>
                          <RefreshCw className={cn("mr-2 h-4 w-4", etsyLoading && "animate-spin")} /> Refresh
                        </Button>
                      </div>
                      <Select value={selectedEtsyListingId} onValueChange={setSelectedEtsyListingId}>
                        <SelectTrigger className="bg-muted/30"><SelectValue placeholder={etsyLoading ? "Loading listings..." : "Choose listing"} /></SelectTrigger>
                        <SelectContent>
                          {etsyListings.map((listing) => (
                            <SelectItem key={listing.listing_id} value={String(listing.listing_id)}>{listing.title}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="manual" className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Input placeholder="Product title" value={manualItem.title} onChange={(event) => setManualItem((prev) => ({ ...prev, title: event.target.value }))} className="bg-muted/30" />
                <Input placeholder="Brand or vendor" value={manualItem.vendor} onChange={(event) => setManualItem((prev) => ({ ...prev, vendor: event.target.value }))} className="bg-muted/30" />
                <Input placeholder="Product type" value={manualItem.productType} onChange={(event) => setManualItem((prev) => ({ ...prev, productType: event.target.value }))} className="bg-muted/30" />
                <Input placeholder="Materials, comma separated" value={manualItem.materials} onChange={(event) => setManualItem((prev) => ({ ...prev, materials: event.target.value }))} className="bg-muted/30" />
              </div>
              <Textarea placeholder="Product description" rows={4} value={manualItem.description} onChange={(event) => setManualItem((prev) => ({ ...prev, description: event.target.value }))} className="bg-muted/30" />
              <Textarea placeholder="Key features, one per line or comma separated" rows={3} value={manualItem.keyFeatures} onChange={(event) => setManualItem((prev) => ({ ...prev, keyFeatures: event.target.value }))} className="bg-muted/30" />
            </TabsContent>
          </Tabs>

          <div className="rounded-xl border border-border/40 bg-background/40 p-4">
            <div className="flex items-start gap-3">
              <ShoppingBag className="mt-1 h-5 w-5 text-primary" />
              <div className="min-w-0 space-y-1">
                <p className="font-medium">Current source preview</p>
                <p className="truncate text-sm font-semibold">{sourcePreview.title || "No item selected"}</p>
                <p className="truncate text-xs text-muted-foreground">{sourcePreview.subtitle}</p>
                <p className="text-sm text-muted-foreground">
                  {sourcePreview.description ? sourcePreview.description.slice(0, 220) : "Select an item or enter product details to build the concept from real facts."}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/30 bg-card/50">
        <CardHeader>
          <CardTitle className="text-lg">Creative Strategy</CardTitle>
          <CardDescription>These inputs shape the concept, but the generator still stays grounded in actual product facts.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Input placeholder="Brand goal" value={strategy.brandGoal} onChange={(event) => setStrategy((prev) => ({ ...prev, brandGoal: event.target.value }))} className="bg-muted/30" />
          <Input placeholder="Target audience" value={strategy.audience} onChange={(event) => setStrategy((prev) => ({ ...prev, audience: event.target.value }))} className="bg-muted/30" />
          <Input placeholder="Offer or promo" value={strategy.offer} onChange={(event) => setStrategy((prev) => ({ ...prev, offer: event.target.value }))} className="bg-muted/30" />
          <Input placeholder="Preferred tone" value={strategy.tone} onChange={(event) => setStrategy((prev) => ({ ...prev, tone: event.target.value }))} className="bg-muted/30" />
          <div className="md:col-span-2">
            <Input placeholder="Call to action" value={strategy.callToAction} onChange={(event) => setStrategy((prev) => ({ ...prev, callToAction: event.target.value }))} className="bg-muted/30" />
          </div>
          <div className="md:col-span-2">
            <Button onClick={handleGenerate} disabled={generateDisabled} className="w-full gradient-phoenix text-primary-foreground">
              {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {generating ? "Generating 8-second concept..." : "Generate 8-Second Ad Concept"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <Card className="border-border/30 bg-card/50">
            <CardHeader className="gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle className="text-xl">{result.headline}</CardTitle>
                <CardDescription>{result.angle}</CardDescription>
              </div>
              <CopyButton
                text={copyAllFields([
                  { label: "Headline", value: result.headline },
                  { label: "Angle", value: result.angle },
                  { label: "Hook", value: result.hook },
                  { label: "Visual Style", value: result.visual_style },
                  { label: "Script", value: result.script },
                  { label: "Voiceover", value: result.voiceover },
                  { label: "Caption", value: result.caption },
                  { label: "CTA", value: result.cta },
                  { label: "Compliance Notes", value: result.compliance_notes },
                  { label: "Reasoning", value: result.reasoning },
                  { label: "Asset Checklist", value: result.asset_checklist.join("\n") },
                  { label: "Shot Plan", value: result.shot_plan.map((shot) => `${shot.timecode}: ${shot.visual} | ${shot.on_screen_text} | ${shot.voiceover}`).join("\n") },
                ])}
                label="Copy full concept"
              />
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg bg-muted/20 p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Hook</p>
                <p className="mt-2 font-medium">{result.hook}</p>
              </div>
              <div className="rounded-lg bg-muted/20 p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Visual Style</p>
                <p className="mt-2 font-medium">{result.visual_style}</p>
              </div>
              <div className="rounded-lg bg-muted/20 p-4 md:col-span-2">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Script</p>
                  <CopyButton text={result.script} label="Script" />
                </div>
                <p className="whitespace-pre-wrap text-sm">{result.script}</p>
              </div>
              <div className="rounded-lg bg-muted/20 p-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Voiceover</p>
                  <CopyButton text={result.voiceover} label="Voiceover" />
                </div>
                <p className="text-sm">{result.voiceover}</p>
              </div>
              <div className="rounded-lg bg-muted/20 p-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Caption + CTA</p>
                  <CopyButton text={`${result.caption}\n\n${result.cta}`} label="Caption" />
                </div>
                <p className="text-sm">{result.caption}</p>
                <p className="mt-3 font-medium text-primary">{result.cta}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/30 bg-card/50">
            <CardHeader>
              <CardTitle className="text-lg">8-Second Shot Plan</CardTitle>
              <CardDescription>Exactly four 2-second beats so the concept is ready to storyboard or hand off.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 xl:grid-cols-2">
              {result.shot_plan.map((shot, index) => (
                <div key={`${shot.timecode}-${index}`} className="rounded-xl border border-border/40 bg-background/40 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <Badge variant="outline">{shot.timecode}</Badge>
                    <CopyButton text={`Visual: ${shot.visual}\nOn-screen text: ${shot.on_screen_text}\nVoiceover: ${shot.voiceover}`} label={`Shot ${index + 1}`} />
                  </div>
                  <div className="space-y-3 text-sm">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Visual</p>
                      <p className="mt-1">{shot.visual}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">On-Screen Text</p>
                      <p className="mt-1">{shot.on_screen_text}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Voiceover</p>
                      <p className="mt-1">{shot.voiceover}</p>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card className="border-border/30 bg-card/50">
              <CardHeader>
                <CardTitle className="text-lg">Production Notes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Truthfulness Guardrail</p>
                  <p className="mt-1">{result.compliance_notes}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Reasoning</p>
                  <p className="mt-1">{result.reasoning}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/30 bg-card/50">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-lg">Asset Checklist</CardTitle>
                <CopyButton text={result.asset_checklist.join("\n")} label="Assets" />
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {result.asset_checklist.map((asset) => (
                  <div key={asset} className="rounded-lg bg-muted/20 px-3 py-2">{asset}</div>
                ))}
              </CardContent>
            </Card>
          </div>
        </motion.div>
      )}

      <Card className="border-border/30 bg-card/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Store className="h-5 w-5 text-primary" /> What this generator is for
          </CardTitle>
          <CardDescription>This is designed for product-truthful social creative, not fake lifestyle invention.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-muted-foreground md:grid-cols-3">
          <div className="rounded-lg bg-muted/20 p-4">Builds 8-second concepts around the best parts of a real item.</div>
          <div className="rounded-lg bg-muted/20 p-4">Avoids fake in-use scenes unless your source details explicitly support them.</div>
          <div className="rounded-lg bg-muted/20 p-4">Outputs something your team can actually shoot or edit from product media.</div>
        </CardContent>
      </Card>
    </div>
  );
}
