import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Sparkles, Copy, Check, Loader2, Store, Search, PlusCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { isShopifyPlatform } from "@/lib/storePlatforms";

interface ProductSlot {
  id: string;
  title: string;
  features: string;
  brand?: string;
}

const BRAND_VOICE_OPTIONS = [
  { value: "", label: "Auto / Unset" },
  { value: "ourphoenixrise", label: "Our Phoenix Rise" },
  { value: "ironphoenix", label: "Iron Phoenix GHG" },
];

interface GeneratedDescription {
  title: string;
  content: string;
  seoTitle?: string;
  seoDescription?: string;
}

interface StoreConnectionOption {
  id: string;
  platform: string;
  shop_domain: string | null;
  shop_name: string | null;
}

interface ShopifyProductOption {
  id: number;
  title: string;
  product_type: string;
  tags: string;
  images: { src: string }[];
  variants: { option1?: string; option2?: string; option3?: string }[];
}

const emptySlots: ProductSlot[] = Array.from({ length: 5 }, (_, index) => ({
  id: String(index + 1),
  title: "",
  features: "",
  brand: "",
}));

function deriveFeaturesFromProduct(product: ShopifyProductOption): string {
  const optionValues = new Set<string>();
  for (const variant of product.variants || []) {
    [variant.option1, variant.option2, variant.option3].forEach((value) => {
      if (value && value.toLowerCase() !== "default title") optionValues.add(value);
    });
  }
  const parts = [product.product_type, ...Array.from(optionValues), product.tags]
    .filter(Boolean)
    .join(", ");
  return parts;
}


export default function DescriptionsPage() {
  const { toast } = useToast();
  const { session } = useAuth();
  const [context, setContext] = useState("");
  const [products, setProducts] = useState<ProductSlot[]>(emptySlots);
  const [results, setResults] = useState<GeneratedDescription[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [storeConnections, setStoreConnections] = useState<StoreConnectionOption[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [storeProducts, setStoreProducts] = useState<ShopifyProductOption[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productSearch, setProductSearch] = useState("");

  useEffect(() => {
    if (!session) return;
    (async () => {
      const { data } = await supabase
        .from("store_connections")
        .select("id, platform, shop_domain, shop_name")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false });
      const rows = (data || []).filter((c) => isShopifyPlatform(c.platform)) as StoreConnectionOption[];
      setStoreConnections(rows);
      if (rows.length === 1) setSelectedConnectionId(rows[0].id);
    })();
  }, [session]);

  const handleUpdate = (index: number, field: keyof Omit<ProductSlot, "id">, value: string) => {
    setProducts((previous) =>
      previous.map((product, productIndex) =>
        productIndex === index ? { ...product, [field]: value } : product,
      ),
    );
  };

  const fetchStoreProducts = async () => {
    if (!selectedConnectionId) {
      toast({ title: "Select a store", description: "Choose a connected Shopify store first." });
      return;
    }
    setProductsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-shopify-products", {
        body: { limit: 50, connectionId: selectedConnectionId },
      });
      if (error) throw error;
      setStoreProducts(data.products || []);
    } catch (err) {
      toast({ variant: "destructive", title: "Error", description: (err as Error).message || "Failed to load products." });
    } finally {
      setProductsLoading(false);
    }
  };

  const applyProductToSlot = (product: ShopifyProductOption) => {
    const connection = storeConnections.find((c) => c.id === selectedConnectionId);
    const brand = connection?.shop_domain || connection?.shop_name || "";
    setProducts((previous) => {
      const emptyIndex = previous.findIndex((slot) => !slot.title.trim());
      const targetIndex = emptyIndex === -1 ? previous.length - 1 : emptyIndex;
      return previous.map((slot, index) =>
        index === targetIndex
          ? { ...slot, title: product.title, features: deriveFeaturesFromProduct(product), brand }
          : slot,
      );
    });
    toast({ title: "Product added", description: `"${product.title}" loaded into the batch below.` });
  };

  const filteredStoreProducts = storeProducts.filter((product) =>
    product.title.toLowerCase().includes(productSearch.toLowerCase()),
  );

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-descriptions", {
        body: { products, globalContext: context },
      });
      if (error) throw error;
      setResults(data.results ?? []);
      toast({ title: "Descriptions Generated", description: "Gemini-optimized for GMC compliance." });
    } catch (err) {
      toast({ variant: "destructive", title: "Error", description: (err as Error).message || "Failed to generate descriptions." });
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (content: string, id: string) => {
    // Strip HTML for clipboard or keep if needed for Shopify
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast({ title: "Copied!", description: "HTML content ready for Shopify." });
  };

  const activeCount = products.filter((product) => product.title.trim()).length;

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileText className="h-6 w-6 text-primary" /> PHX DESC-GEN v2.0
        </h1>
        <p className="text-muted-foreground mt-1">
          Binary-compliant Shopify descriptions. Enforces 100% SEO alignment and brand identity.
        </p>
      </motion.div>

      <Card className="bg-card/50 border-border/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Store className="h-4 w-4 text-primary" /> Pull From Your Store
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 md:flex-row">
            <Select value={selectedConnectionId} onValueChange={setSelectedConnectionId}>
              <SelectTrigger className="bg-background/50 md:w-64">
                <SelectValue placeholder="Choose a connected store" />
              </SelectTrigger>
              <SelectContent>
                {storeConnections.map((connection) => (
                  <SelectItem key={connection.id} value={connection.id}>
                    {connection.shop_name || connection.shop_domain || connection.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={fetchStoreProducts}
              disabled={productsLoading || !selectedConnectionId}
              className="md:w-48"
            >
              {productsLoading ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...</>
              ) : (
                <><Store className="mr-2 h-4 w-4" /> Load Products</>
              )}
            </Button>
          </div>

          {storeConnections.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No connected Shopify store found. Connect one in Settings to pull real products instead of typing them in by hand.
            </p>
          )}

          {storeProducts.length > 0 && (
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search loaded products..."
                  value={productSearch}
                  onChange={(event) => setProductSearch(event.target.value)}
                  className="bg-background/50 pl-9"
                />
              </div>
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {filteredStoreProducts.map((product) => (
                  <div
                    key={product.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/10 bg-muted/10 p-2"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {product.images?.[0]?.src ? (
                        <img
                          src={product.images[0].src}
                          alt=""
                          className="h-10 w-10 rounded object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded bg-muted flex-shrink-0" />
                      )}
                      <p className="text-sm truncate">{product.title}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => applyProductToSlot(product)}
                      className="flex-shrink-0 gap-1"
                    >
                      <PlusCircle className="h-3.5 w-3.5" />
                      <span className="text-[10px] uppercase font-bold">Use This</span>
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card/50 border-border/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Global Brand Context
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            placeholder="e.g. Focus on durability and outdoor performance, or highlight eco-friendly materials and wellness benefits."
            value={context}
            onChange={(event) => setContext(event.target.value)}
            className="bg-muted/30 border-border/40"
            rows={2}
          />
        </CardContent>
      </Card>

      <Card className="bg-card/50 border-border/30">
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-lg">
            <span>Product Batch Input</span>
            <Badge variant="outline" className="text-primary border-primary/30">
              {activeCount}/5 Slots Active
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {products.map((product, index) => (
            <div key={product.id} className="grid grid-cols-1 gap-3 md:grid-cols-3 p-3 rounded-lg border border-border/10 bg-muted/10">
              <div className="space-y-1">
                <p className="text-[10px] uppercase font-bold text-muted-foreground ml-1">Title</p>
                <Input
                  placeholder="e.g. Ashwagandha Capsules"
                  value={product.title}
                  onChange={(event) => handleUpdate(index, "title", event.target.value)}
                  className="bg-background/50"
                />
              </div>
              <div className="space-y-1">
                <p className="text-[10px] uppercase font-bold text-muted-foreground ml-1">Features / Materials</p>
                <Input
                  placeholder="60ct, Organic, Made in USA"
                  value={product.features}
                  onChange={(event) => handleUpdate(index, "features", event.target.value)}
                  className="bg-background/50"
                />
              </div>
              <div className="space-y-1">
                <p className="text-[10px] uppercase font-bold text-muted-foreground ml-1">Brand Voice</p>
                <Select
                  value={product.brand || "auto"}
                  onValueChange={(value) => handleUpdate(index, "brand", value === "auto" ? "" : value)}
                >
                  <SelectTrigger className="bg-background/50">
                    <SelectValue placeholder="Auto / Unset" />
                  </SelectTrigger>
                  <SelectContent>
                    {BRAND_VOICE_OPTIONS.map((option) => (
                      <SelectItem key={option.value || "auto"} value={option.value || "auto"}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ))}
          <Button
            onClick={handleGenerate}
            disabled={loading || activeCount === 0}
            className="w-full gradient-phoenix text-primary-foreground font-bold"
          >
            {loading ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Process Batch...</>
            ) : (
              <><Sparkles className="mr-2 h-4 w-4" /> Generate {activeCount} Compliant Descriptions</>
            )}
          </Button>
        </CardContent>
      </Card>

      {results.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-widest text-primary ml-1">Output — Edit Before Copying</h2>
          {results.map((result, idx) => (
            <Card key={idx} className="bg-card/30 border-primary/20 overflow-hidden">
              <CardHeader className="flex flex-row items-center justify-between py-3 bg-muted/20">
                <CardTitle className="text-sm font-bold text-primary">{result.title}</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(result.content, String(idx))}
                  className="h-8 gap-2"
                >
                  {copiedId === String(idx) ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  <span className="text-[10px] uppercase font-bold">Copy HTML</span>
                </Button>
              </CardHeader>
              <CardContent className="pt-4 space-y-3">
                {(result.seoTitle || result.seoDescription) && (
                  <div className="rounded-md border border-border/20 bg-muted/10 px-3 py-2 space-y-1">
                    {result.seoTitle && (
                      <p className="text-xs">
                        <span className="uppercase font-bold text-muted-foreground mr-2">SEO Title</span>
                        {result.seoTitle}
                      </p>
                    )}
                    {result.seoDescription && (
                      <p className="text-xs">
                        <span className="uppercase font-bold text-muted-foreground mr-2">Meta Desc.</span>
                        {result.seoDescription}
                      </p>
                    )}
                  </div>
                )}
                <textarea
                  className="w-full rounded-md border border-primary/20 bg-black/20 px-3 py-3 text-sm font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary resize-y"
                  rows={Math.max(6, Math.ceil(result.content.length / 80))}
                  value={result.content}
                  onChange={(e) => setResults((prev) => prev.map((r, i) => i === idx ? { ...r, content: e.target.value } : r))}
                />
              </CardContent>
            </Card>
          ))}
        </motion.div>
      )}
    </div>
  );
}

