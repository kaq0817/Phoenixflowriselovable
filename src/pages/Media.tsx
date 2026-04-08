import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Image as ImageIcon,
  Images,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
  Store,
  TriangleAlert,
  Type,
} from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type MediaFilter = "all" | "needs-attention" | "missing-images" | "thin-gallery" | "missing-alt" | "ready";

interface ShopifyConnection {
  id: string;
  shop_domain: string | null;
  shop_name: string | null;
  created_at: string;
}

interface ShopifyProduct {
  id: number;
  title: string;
  vendor: string;
  product_type: string;
  handle: string;
  images: { id: number; src: string; alt?: string | null }[];
}

interface MediaRecord {
  id: number;
  title: string;
  subtitle: string;
  imageSrc?: string;
  imageCount: number;
  missingImages: boolean;
  thinGallery: boolean;
  missingAlt: boolean;
  ready: boolean;
}

function getStoreLabel(connection: ShopifyConnection) {
  return connection.shop_name || connection.shop_domain || "Unnamed Shopify store";
}

function formatAverageImageCount(items: MediaRecord[]) {
  if (!items.length) return "0.0";
  const total = items.reduce((sum, item) => sum + item.imageCount, 0);
  return (total / items.length).toFixed(1);
}

function buildUniqueAltDrafts(product: ShopifyProduct, storeLabel: string): Record<number, string> {
  const fallbackStore = storeLabel.trim() || "Store";
  const titleBase = (product.title || "Product").trim() || "Product";

  const normalizedCounts = new Map<string, number>();
  for (const img of product.images || []) {
    const key = (img.alt || "").trim().toLowerCase();
    if (!key) continue;
    normalizedCounts.set(key, (normalizedCounts.get(key) || 0) + 1);
  }

  const drafts: Record<number, string> = {};
  for (let i = 0; i < (product.images || []).length; i += 1) {
    const img = product.images[i];
    const rawAlt = (img.alt || "").trim();
    const isDuplicate = rawAlt ? (normalizedCounts.get(rawAlt.toLowerCase()) || 0) > 1 : false;
    const hasStore = rawAlt.includes("|") && rawAlt.split("|").some((part) => part.trim().toLowerCase() === fallbackStore.toLowerCase());

    if (rawAlt && !isDuplicate && hasStore) {
      drafts[img.id] = rawAlt.slice(0, 512);
      continue;
    }

    const detail = i === 0 ? "Primary View" : `Detail ${i + 1}`;
    drafts[img.id] = `${titleBase} - ${detail} | ${fallbackStore}`.slice(0, 512);
  }

  return drafts;
}

function slugifyForFilename(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .trim();
}

function buildUniqueFilenameDrafts(product: ShopifyProduct, storeLabel: string): Record<number, string> {
  const productSlug = slugifyForFilename(product.title || "product") || "product";
  const storeSlug = slugifyForFilename(storeLabel || "store") || "store";
  const drafts: Record<number, string> = {};

  for (let i = 0; i < (product.images || []).length; i += 1) {
    const img = product.images[i];
    const detail = i === 0 ? "primary-view" : `detail-${i + 1}`;
    drafts[img.id] = `${productSlug}-${detail}-${storeSlug}.jpg`;
  }

  return drafts;
}

export default function MediaPage() {
  const { session } = useAuth();
  const { toast } = useToast();

  const [connections, setConnections] = useState<ShopifyConnection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [filter, setFilter] = useState<MediaFilter>("needs-attention");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedAlt, setExpandedAlt] = useState<number | null>(null);
  const [altEdits, setAltEdits] = useState<Record<number, Record<number, string>>>({});
  const [filenameDrafts, setFilenameDrafts] = useState<Record<number, Record<number, string>>>({});
  const [savingAlt, setSavingAlt] = useState<number | null>(null);

  useEffect(() => {
    if (!session) return;

    void (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("store_connections")
        .select("id, shop_domain, shop_name, created_at")
        .eq("user_id", session.user.id)
        .eq("platform", "shopify")
        .order("created_at", { ascending: false });

      const rows = (data || []) as ShopifyConnection[];
      setConnections(rows);
      setSelectedConnectionId(rows[0]?.id || "");
      setLoading(false);
    })();
  }, [session]);

  const fetchProducts = useCallback(async (connectionId = selectedConnectionId) => {
    if (!connectionId) return;

    setRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-shopify-products", {
        body: { limit: 50, connectionId },
      });
      if (error) throw error;
      setProducts((data?.products || []) as ShopifyProduct[]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch Shopify products";
      toast({ title: "Media load failed", description: message, variant: "destructive" });
    } finally {
      setRefreshing(false);
    }
  }, [selectedConnectionId, toast]);

  useEffect(() => {
    if (loading || !selectedConnectionId || products.length > 0) return;
    void fetchProducts(selectedConnectionId);
  }, [fetchProducts, loading, selectedConnectionId, products.length]);

  const saveAltText = async (product: ShopifyProduct) => {
    const edits = altEdits[product.id];
    if (!edits || Object.keys(edits).length === 0) return;
    setSavingAlt(product.id);
    try {
      const { error } = await supabase.functions.invoke("apply-shopify-changes", {
        body: {
          productId: product.id,
          optimizedData: {},
          connectionId: selectedConnectionId,
          imageAltEdits: edits,
        },
      });
      if (error) throw error;
      setProducts((prev) =>
        prev.map((p) =>
          p.id !== product.id
            ? p
            : { ...p, images: p.images.map((img) => ({ ...img, alt: edits[img.id] ?? img.alt })) }
        )
      );
      setAltEdits((prev) => { const next = { ...prev }; delete next[product.id]; return next; });
      toast({ title: "Alt text saved", description: `Updated ${Object.keys(edits).length} image${Object.keys(edits).length !== 1 ? "s" : ""} on Shopify.` });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed";
      toast({ title: "Save failed", description: message, variant: "destructive" });
    } finally {
      setSavingAlt(null);
    }
  };

  const mediaRecords = useMemo<MediaRecord[]>(() => {
    return products.map((product) => {
      const imageCount = product.images?.length || 0;
      const missingImages = imageCount === 0;
      const thinGallery = imageCount > 0 && imageCount < 3;
      const missingAlt = imageCount > 0 && product.images.some((image) => !image.alt?.trim());

      return {
        id: product.id,
        title: product.title,
        subtitle: [product.vendor, product.product_type].filter(Boolean).join(" | ") || product.handle,
        imageSrc: product.images?.[0]?.src,
        imageCount,
        missingImages,
        thinGallery,
        missingAlt,
        ready: !missingImages && !thinGallery && !missingAlt,
      };
    });
  }, [products]);

  const metrics = useMemo(() => {
    const missingImages = mediaRecords.filter((item) => item.missingImages).length;
    const thinGallery = mediaRecords.filter((item) => item.thinGallery).length;
    const missingAlt = mediaRecords.filter((item) => item.missingAlt).length;
    const ready = mediaRecords.filter((item) => item.ready).length;

    return {
      total: mediaRecords.length,
      missingImages,
      thinGallery,
      missingAlt,
      ready,
      averageImages: formatAverageImageCount(mediaRecords),
    };
  }, [mediaRecords]);

  const filteredRecords = useMemo(() => {
    switch (filter) {
      case "missing-images":
        return mediaRecords.filter((item) => item.missingImages);
      case "thin-gallery":
        return mediaRecords.filter((item) => item.thinGallery);
      case "missing-alt":
        return mediaRecords.filter((item) => item.missingAlt);
      case "ready":
        return mediaRecords.filter((item) => item.ready);
      case "needs-attention":
        return mediaRecords.filter((item) => item.missingImages || item.thinGallery || item.missingAlt);
      default:
        return mediaRecords;
    }
  }, [filter, mediaRecords]);

  const filterOptions: { value: MediaFilter; label: string }[] = [
    { value: "needs-attention", label: "Needs Attention" },
    { value: "missing-images", label: "Missing Images" },
    { value: "thin-gallery", label: "Thin Gallery" },
    { value: "missing-alt", label: "Missing Alt" },
    { value: "ready", label: "Ready" },
    { value: "all", label: "All" },
  ];

  const queueCards = [
    {
      title: "Alt Text Queue",
      description: "Products with images that still need descriptive alt text.",
      value: `${metrics.missingAlt}`,
      cta: "Review Alt Gaps",
      onClick: () => setFilter("missing-alt"),
      disabled: metrics.missingAlt === 0,
      icon: Type,
    },
    {
      title: "Thin Gallery Queue",
      description: "Products with only 1-2 images and weak photo coverage.",
      value: `${metrics.thinGallery}`,
      cta: "Review Thin Galleries",
      onClick: () => setFilter("thin-gallery"),
      disabled: metrics.thinGallery === 0,
      icon: Images,
    },
    {
      title: "Missing Images",
      description: "Products with no media loaded at all.",
      value: `${metrics.missingImages}`,
      cta: "Show Missing Media",
      onClick: () => setFilter("missing-images"),
      disabled: metrics.missingImages === 0,
      icon: TriangleAlert,
    },
    {
      title: "Media Ready",
      description: "Products with healthy Shopify media coverage.",
      value: `${metrics.ready}`,
      cta: "Show Ready Products",
      onClick: () => setFilter("ready"),
      disabled: metrics.ready === 0,
      icon: CheckCircle2,
    },
  ];

  const selectedConnection = useMemo(
    () => connections.find((connection) => connection.id === selectedConnectionId) || null,
    [connections, selectedConnectionId],
  );

  const selectedStoreLabel = selectedConnection ? getStoreLabel(selectedConnection) : "";

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (connections.length === 0) {
    return (
      <div className="space-y-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ImageIcon className="h-6 w-6 text-primary" /> Shopify Media Tools
          </h1>
          <p className="mt-1 text-muted-foreground">
            This page is for Shopify product media, so it needs a Shopify store connection first.
          </p>
        </motion.div>

        <Card className="border-border/30 bg-card/50">
          <CardHeader>
            <CardTitle className="text-lg">Connect Shopify first</CardTitle>
            <CardDescription>
              Once a Shopify store is connected, this page will load real products and show image coverage, thin
              galleries, and missing alt text.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"
      >
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ImageIcon className="h-6 w-6 text-primary" /> Shopify Media Tools
          </h1>
          <p className="mt-1 text-muted-foreground">
            Real Shopify product media triage for image coverage, thin galleries, and alt text cleanup.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Select
            value={selectedConnectionId}
            onValueChange={(value) => {
              setSelectedConnectionId(value);
              setProducts([]);
              setFilter("needs-attention");
              void fetchProducts(value);
            }}
          >
            <SelectTrigger className="min-w-[240px] bg-muted/30">
              <SelectValue placeholder="Choose Shopify store" />
            </SelectTrigger>
            <SelectContent>
              {connections.map((connection) => (
                <SelectItem key={connection.id} value={connection.id}>
                  {getStoreLabel(connection)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button variant="outline" onClick={() => void fetchProducts()} disabled={refreshing}>
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </motion.div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-border/30 bg-card/50">
          <CardHeader className="pb-3">
            <CardDescription>Products Loaded</CardDescription>
            <CardTitle className="text-3xl">{metrics.total}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Active Shopify products from the selected store.
          </CardContent>
        </Card>

        <Card className="border-border/30 bg-card/50">
          <CardHeader className="pb-3">
            <CardDescription>Missing Images</CardDescription>
            <CardTitle className="text-3xl">{metrics.missingImages}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Products with zero media attached.
          </CardContent>
        </Card>

        <Card className="border-border/30 bg-card/50">
          <CardHeader className="pb-3">
            <CardDescription>Missing Alt Text</CardDescription>
            <CardTitle className="text-3xl">{metrics.missingAlt}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Products with at least one image missing alt text.
          </CardContent>
        </Card>

        <Card className="border-border/30 bg-card/50">
          <CardHeader className="pb-3">
            <CardDescription>Average Images</CardDescription>
            <CardTitle className="text-3xl">{metrics.averageImages}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Mean image count per Shopify product.
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {queueCards.map((queue, index) => (
          <motion.div
            key={queue.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.08 }}
          >
            <Card className="h-full border-border/30 bg-card/50">
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2">
                    <queue.icon className="h-5 w-5 text-primary" />
                    {queue.title}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {queue.value}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">{queue.description}</p>
                <Button variant="secondary" className="w-full" onClick={queue.onClick} disabled={queue.disabled}>
                  {queue.cta}
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <Card className="border-border/30 bg-card/50">
        <CardHeader className="gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="text-lg">Shopify Product Media Queue</CardTitle>
            <CardDescription>
              {filteredRecords.length} of {metrics.total} products in the current filter.
            </CardDescription>
          </div>

          <div className="flex flex-wrap gap-2">
            {filterOptions.map((option) => (
              <Button
                key={option.value}
                size="sm"
                variant={filter === option.value ? "default" : "outline"}
                onClick={() => setFilter(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {refreshing ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : filteredRecords.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/50 px-6 py-12 text-center">
              <p className="font-medium">No products in this queue.</p>
              <p className="mt-1 text-sm text-muted-foreground">Try another filter or refresh the current Shopify store.</p>
            </div>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {filteredRecords.map((item) => (
                <div
                  key={item.id}
                  className="flex gap-4 rounded-xl border border-border/40 bg-background/40 p-4 transition-colors hover:border-primary/30"
                >
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted/40">
                    {item.imageSrc ? (
                      <img src={item.imageSrc} alt={item.title} className="h-full w-full object-cover" />
                    ) : (
                      <ImageIcon className="h-8 w-8 text-muted-foreground" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="space-y-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{item.title}</p>
                          <p className="truncate text-sm text-muted-foreground">{item.subtitle}</p>
                        </div>
                        <Badge variant="outline" className="shrink-0">
                          {item.imageCount} image{item.imageCount === 1 ? "" : "s"}
                        </Badge>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {item.missingImages && <Badge className="bg-destructive/10 text-destructive">No Images</Badge>}
                      {item.thinGallery && <Badge className="bg-amber-500/10 text-amber-400">Thin Gallery</Badge>}
                      {item.missingAlt && <Badge className="bg-blue-500/10 text-blue-300">Missing Alt Text</Badge>}
                      {item.ready && <Badge className="bg-emerald-500/10 text-emerald-300">Media Ready</Badge>}
                    </div>

                    <p className="text-sm text-muted-foreground">
                {item.missingImages
                  ? "Add images first."
                  : item.thinGallery
                   ? "Add more image variety."
                  : item.missingAlt
                  ? "Fix image alt text."
                : "Images look complete."}
              </p>

                    {(() => {
                      const product = products.find((p) => p.id === item.id);
                      if (!product || product.images.length === 0) return null;
                      const isExpanded = expandedAlt === item.id;
                      const edits = altEdits[item.id] || {};
                      const filenames = filenameDrafts[item.id] || {};
                      const isDirty = Object.keys(edits).length > 0;
                      const isSaving = savingAlt === item.id;
                      return (
                        <div className="border-t border-border/20 pt-3 mt-1 space-y-2">
                          <button
                            className="flex items-center gap-2 text-xs text-primary font-medium hover:underline"
                            onClick={() => {
                              if (isExpanded) {
                                setExpandedAlt(null);
                                return;
                              }
                              setExpandedAlt(item.id);
                              setAltEdits((prev) => {
                                if (prev[item.id] && Object.keys(prev[item.id]).length > 0) return prev;
                                return {
                                  ...prev,
                                  [item.id]: buildUniqueAltDrafts(product, selectedStoreLabel),
                                };
                              });
                              setFilenameDrafts((prev) => {
                                if (prev[item.id] && Object.keys(prev[item.id]).length > 0) return prev;
                                return {
                                  ...prev,
                                  [item.id]: buildUniqueFilenameDrafts(product, selectedStoreLabel),
                                };
                              });
                            }}
                          >
                            <ImageIcon className="h-3.5 w-3.5" />
                            Edit Alt Text ({product.images.length} image{product.images.length !== 1 ? "s" : ""})
                            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          </button>
                          <AnimatePresence>
                            {isExpanded && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="space-y-3 overflow-hidden"
                              >
                                <div className="flex flex-wrap gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => {
                                      setAltEdits((prev) => ({
                                        ...prev,
                                        [item.id]: buildUniqueAltDrafts(product, selectedStoreLabel),
                                      }));
                                      setFilenameDrafts((prev) => ({
                                        ...prev,
                                        [item.id]: buildUniqueFilenameDrafts(product, selectedStoreLabel),
                                      }));
                                    }}
                                  >
                                    <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Generate Alt + Photo Names
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={async () => {
                                      const nameText = product.images
                                        .map((img, idx) => `Image ${idx + 1}: ${filenames[img.id] || ""}`)
                                        .join("\n");
                                      await navigator.clipboard.writeText(nameText);
                                      toast({ title: "Photo names copied", description: "Generated image filenames are on your clipboard." });
                                    }}
                                  >
                                    <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy Photo Names
                                  </Button>
                                </div>

                                {product.images.map((img, i) => (
                                  <div key={img.id} className="flex gap-3 items-start">
                                    <img src={img.src} alt={img.alt || ""} className="w-14 h-14 rounded-md object-cover border border-border/30 shrink-0" />
                                    <div className="flex-1 space-y-1">
                                      <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Image {i + 1}</p>
                                      <input
                                        type="text"
                                        className="w-full h-8 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                                        placeholder="Describe this image..."
                                        value={edits[img.id] ?? (img.alt || "")}
                                        onChange={(e) =>
                                          setAltEdits((prev) => ({
                                            ...prev,
                                            [item.id]: { ...(prev[item.id] || {}), [img.id]: e.target.value },
                                          }))
                                        }
                                        maxLength={512}
                                      />
                                      <p className="text-[10px] text-muted-foreground text-right">{(edits[img.id] ?? (img.alt || "")).length}/512</p>
                                      <input
                                        type="text"
                                        readOnly
                                        className="w-full h-8 rounded-md border border-input bg-muted/30 px-3 text-xs text-muted-foreground"
                                        value={filenames[img.id] || ""}
                                      />
                                    </div>
                                  </div>
                                ))}
                                <Button
                                  size="sm"
                                  disabled={!isDirty || isSaving}
                                  onClick={() => saveAltText(product)}
                                  className="w-full"
                                >
                                  {isSaving ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Saving...</> : <><Save className="h-3.5 w-3.5 mr-1.5" /> Save Alt Text to Shopify</>}
                                </Button>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/30 bg-card/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Store className="h-5 w-5 text-primary" /> Why this page exists now
          </CardTitle>
          <CardDescription>This screen is now scoped to Shopify product media only.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-muted-foreground md:grid-cols-3">
          <div className="rounded-lg bg-muted/20 p-4">Uses the selected Shopify store as the single source of truth.</div>
          <div className="rounded-lg bg-muted/20 p-4">Shows real Shopify media gaps: no images, thin galleries, and missing alt text.</div>
          <div className="rounded-lg bg-muted/20 p-4">Keeps the page focused instead of mixing Shopify with unrelated platform logic.</div>
        </CardContent>
      </Card>
    </div>
  );
}
