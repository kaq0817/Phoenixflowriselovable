import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  Zap, Loader2, CheckCircle2, XCircle, AlertTriangle, RefreshCw, Square, StopCircle,
} from "lucide-react";
import {
  CardType, ThemePreset, Niche, THEMES, NICHE_THEMES, CARD_META, CARD_TYPES, DEFAULTS,
  CardRenderer, renderElementToWebpDataUrl, pickNicheForStore,
} from "@/lib/listingCardKit";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ShopifyProductLite {
  id: number;
  title: string;
  images: { src: string }[];
}

interface StoreOption {
  id: string;
  shop_domain: string | null;
  shop_name: string | null;
}

type ProductStatus = "pending" | "running" | "success" | "partial" | "error";

interface ProductResult {
  status: ProductStatus;
  cardsUploaded: number;
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(value: string): string {
  return (value || "product").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "product";
}

async function imageUrlToDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Could not load product image");
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read product image"));
    reader.readAsDataURL(blob);
  });
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ResultBadge({ status }: { status: ProductStatus }) {
  if (status === "success") return <Badge className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20 gap-1"><CheckCircle2 className="w-3 h-3" /> Done</Badge>;
  if (status === "partial") return <Badge className="bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20 gap-1"><AlertTriangle className="w-3 h-3" /> Partial</Badge>;
  if (status === "error") return <Badge className="bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20 gap-1"><XCircle className="w-3 h-3" /> Failed</Badge>;
  if (status === "running") return <Badge className="bg-primary/10 text-primary border-primary/20 gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Working</Badge>;
  return null;
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function BulkListingCards() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [stores, setStores] = useState<StoreOption[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [niche, setNiche] = useState<Niche>("wellness");
  const [theme, setTheme] = useState<ThemePreset>("warm");

  const [products, setProducts] = useState<ShopifyProductLite[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [currentTitle, setCurrentTitle] = useState("");
  const [results, setResults] = useState<Map<number, ProductResult>>(new Map());

  const cancelRef = useRef(false);
  const hiddenRenderRef = useRef<HTMLDivElement>(null);
  const [renderTarget, setRenderTarget] = useState<{ cardType: CardType; content: Record<string, string>; photo: string | null } | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: rows } = await supabase
        .from("store_connections")
        .select("id, shop_domain, shop_name")
        .eq("user_id", user.id)
        .eq("platform", "shopify")
        .order("created_at", { ascending: false });
      const list = rows || [];
      setStores(list);
      if (list.length === 1) {
        setConnectionId(list[0].id);
        const n = pickNicheForStore(list[0].shop_name || list[0].shop_domain || "");
        setNiche(n);
        setTheme(NICHE_THEMES[n].themes[0]);
      }
    })();
  }, [user]);

  const onPickStore = (id: string) => {
    setConnectionId(id);
    const store = stores.find((s) => s.id === id);
    const n = pickNicheForStore(store?.shop_name || store?.shop_domain || "");
    setNiche(n);
    setTheme(NICHE_THEMES[n].themes[0]);
    setProducts([]);
    setSelected(new Set());
    setCursor(null);
    setHasMore(false);
    setResults(new Map());
  };

  const loadProducts = async (append = false) => {
    if (!connectionId) return;
    setLoadingProducts(true);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-shopify-products", {
        body: {
          limit: 50,
          connectionId,
          pageInfoCursor: append ? cursor : null,
          excludeProductIds: append ? products.map((p) => p.id) : [],
        },
      });
      if (error) throw new Error(error.message);
      const incoming: ShopifyProductLite[] = data.products || [];
      setProducts((prev) => (append ? [...prev, ...incoming] : incoming));
      setCursor(data.nextPageInfo ?? null);
      setHasMore(Boolean(data.hasMore || data.nextPageInfo));
    } catch (err) {
      toast({ title: "Couldn't load products", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setLoadingProducts(false);
    }
  };

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllLoaded = () => setSelected(new Set(products.map((p) => p.id)));
  const clearSelection = () => setSelected(new Set());

  // Mounts the given content into the hidden off-screen node, waits for paint
  // (and for the photo <img>, which loads from a data: URL so it's effectively
  // instant but still asynchronous), then captures it to a WebP data URL.
  const captureCard = async (cardType: CardType, content: Record<string, string>, photo: string | null): Promise<string> => {
    setRenderTarget({ cardType, content, photo });
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    await delay(80);
    if (!hiddenRenderRef.current) throw new Error("Card render target not ready");
    return renderElementToWebpDataUrl(hiddenRenderRef.current);
  };

  const stop = () => { cancelRef.current = true; };

  const run = async () => {
    if (!connectionId) { toast({ title: "Pick a store first", variant: "destructive" }); return; }
    const targets = products.filter((p) => selected.has(p.id));
    if (!targets.length) { toast({ title: "Select at least one product first", variant: "destructive" }); return; }

    cancelRef.current = false;
    setRunning(true);
    setResults(new Map());
    setProgress({ current: 0, total: targets.length });

    for (let i = 0; i < targets.length; i++) {
      if (cancelRef.current) break;
      const product = targets[i];
      setProgress({ current: i, total: targets.length });
      setCurrentTitle(product.title);
      setResults((prev) => new Map(prev).set(product.id, { status: "running", cardsUploaded: 0 }));

      try {
        const photoUrl = product.images?.[0]?.src;
        const photoDataUrl = photoUrl ? await imageUrlToDataUrl(photoUrl) : null;

        let uploaded = 0;
        for (const cardType of CARD_TYPES) {
          if (cancelRef.current) break;

          let cardContent: Record<string, string> = { ...DEFAULTS[cardType] };
          try {
            const { data } = await supabase.functions.invoke("generate-card-copy", {
              body: { cardType, productName: product.title, currentContent: cardContent },
            });
            if (data?.content) cardContent = { ...cardContent, ...data.content };
          } catch {
            // AI copy is a nice-to-have here — fall back to the default template
            // text for this card type rather than failing the whole product.
          }

          const dataUrl = await captureCard(cardType, cardContent, photoDataUrl);
          const base64 = dataUrl.split(",")[1];

          const { error: uploadError } = await supabase.functions.invoke("upload-shopify-webp", {
            body: {
              connectionId,
              productId: product.id,
              attachment: base64,
              filename: `${slugify(product.title)}-${cardType}`,
              alt: `${product.title} — ${CARD_META[cardType].label}`,
            },
          });
          if (uploadError) throw new Error(uploadError.message);
          uploaded += 1;
          await delay(300); // stay comfortably under Shopify's write rate limit
        }

        setResults((prev) => new Map(prev).set(product.id, {
          status: uploaded === CARD_TYPES.length ? "success" : "partial",
          cardsUploaded: uploaded,
        }));
      } catch (err) {
        setResults((prev) => new Map(prev).set(product.id, {
          status: "error",
          cardsUploaded: 0,
          error: err instanceof Error ? err.message : "Failed",
        }));
      }
    }

    setProgress((prev) => ({ ...prev, current: targets.length }));
    setRenderTarget(null);
    setRunning(false);
    toast({
      title: cancelRef.current ? "Stopped" : "Bulk run complete",
      description: `${Array.from(results.values()).filter((r) => r.status === "success").length}/${targets.length} products fully done.`,
    });
  };

  const t = THEMES[theme];
  const renderT = renderTarget && (
    <CardRenderer cardType={renderTarget.cardType} theme={t} content={renderTarget.content} photo={renderTarget.photo} />
  );

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      {/* Hidden off-screen render target used to capture each card as WebP */}
      <div style={{ position: "fixed", top: -9999, left: -9999, pointerEvents: "none" }} aria-hidden>
        <div ref={hiddenRenderRef}>{renderT}</div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-1">
          <Zap className="w-5 h-5 text-primary" />
          <h1 className="text-2xl font-bold">Bulk Listing Cards</h1>
          <Badge className="bg-primary/10 text-primary border-0 text-xs">Shopify</Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          Generates all 5 Listing Cards (Made With Care, Customer Love, Our Promise, Shipping Info, Design Variations) for every product you select, and uploads them straight to that product's Shopify images — no manual downloading/re-uploading.
        </p>
      </div>

      <div className="bg-yellow-500/8 border border-yellow-500/20 rounded-lg px-4 py-3 text-sm text-foreground/80">
        <p className="flex items-center gap-1.5 font-semibold text-yellow-700 dark:text-yellow-400 mb-1">
          <AlertTriangle className="w-4 h-4" /> This writes to live listings
        </p>
        <p>Each product gets 5 new images added to its gallery. Running this twice on the same product adds duplicates rather than replacing anything. Test on a handful of products first before selecting your whole catalog.</p>
      </div>

      {/* Store + theme */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={connectionId} onValueChange={onPickStore}>
          <SelectTrigger className="w-64 bg-background/50">
            <SelectValue placeholder={stores.length ? "Pick a connected Shopify store" : "No Shopify store connected"} />
          </SelectTrigger>
          <SelectContent>
            {stores.map((store) => (
              <SelectItem key={store.id} value={store.id}>{store.shop_name || store.shop_domain || store.id}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex gap-1 bg-muted/50 p-1 rounded-lg">
          {(Object.entries(NICHE_THEMES) as [Niche, typeof NICHE_THEMES[Niche]][]).map(([n, { label }]) => (
            <button key={n} onClick={() => { setNiche(n); setTheme(NICHE_THEMES[n].themes[0]); }}
              className={`text-xs font-medium py-1.5 px-3 rounded-md transition-all ${niche === n ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="flex gap-1.5">
          {NICHE_THEMES[niche].themes.map((key) => (
            <button key={key} onClick={() => setTheme(key)} title={THEMES[key].name}
              className={`h-7 w-7 rounded-md border-2 transition-all ${theme === key ? "border-primary scale-110 shadow-md" : "border-transparent hover:border-border"}`}
              style={{ background: THEMES[key].grad }} />
          ))}
        </div>

        <Button variant="outline" size="sm" onClick={() => loadProducts(false)} disabled={!connectionId || loadingProducts} className="gap-2 ml-auto">
          {loadingProducts ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Load Products
        </Button>
      </div>

      {/* Product list */}
      {products.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mr-1">
              {selected.size} of {products.length} selected
            </p>
            <Button variant="ghost" size="sm" onClick={selectAllLoaded} className="h-6 text-xs px-2">Select all loaded</Button>
            <Button variant="ghost" size="sm" onClick={clearSelection} className="h-6 text-xs px-2">Clear</Button>
          </div>

          <div className="border border-border/40 rounded-lg divide-y divide-border/30 max-h-96 overflow-y-auto">
            {products.map((p) => {
              const result = results.get(p.id);
              return (
                <div key={p.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/30">
                  <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggle(p.id)} disabled={running} />
                  {p.images?.[0]?.src && (
                    <img src={p.images[0].src} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
                  )}
                  <span className="flex-1 text-sm truncate">{p.title}</span>
                  {result && <ResultBadge status={result.status} />}
                  {result?.error && <span className="text-[10px] text-red-500 max-w-[200px] truncate">{result.error}</span>}
                </div>
              );
            })}
          </div>

          {hasMore && (
            <Button variant="outline" size="sm" onClick={() => loadProducts(true)} disabled={loadingProducts}>
              {loadingProducts ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Load more products
            </Button>
          )}
        </div>
      )}

      {/* Run controls */}
      {products.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            {!running ? (
              <Button onClick={run} disabled={selected.size === 0} size="lg" className="gap-2">
                <Zap className="w-4 h-4" /> Generate & Upload for {selected.size || ""} Selected
              </Button>
            ) : (
              <Button onClick={stop} variant="destructive" size="lg" className="gap-2">
                <StopCircle className="w-4 h-4" /> Stop
              </Button>
            )}
          </div>

          {(running || progress.total > 0) && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{running ? `Working on: ${currentTitle}` : "Last run"}</span>
                <span>{progress.current}/{progress.total}</span>
              </div>
              <Progress value={progress.total > 0 ? (progress.current / progress.total) * 100 : 0} />
            </div>
          )}
        </div>
      )}

      {!products.length && !loadingProducts && (
        <div className="text-center py-16 text-muted-foreground text-sm border border-dashed border-border/40 rounded-xl">
          <Square className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p>Pick a store, then click <strong>Load Products</strong> to select which ones to run.</p>
        </div>
      )}
    </div>
  );
}
