import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  Download, Sparkles, Loader2, ChevronRight, Palette,
  ImagePlus, X, Layers, Zap, ArrowLeft, Store, CheckCircle2, Search,
} from "lucide-react";
import {
  CardType, ThemePreset, Niche, THEMES, NICHE_THEMES, CARD_META, DEFAULTS,
  CardRenderer, renderElementToWebpDataUrl, buildProductDetailsSummary, slugify, imageUrlToDataUrl, cardHasRealContent,
  ListingCardsHandoff, readListingCardsHandoff, clearListingCardsHandoff,
} from "@/lib/listingCardKit";
import { getFunctionErrorMessage } from "@/lib/functionsError";

interface StoreOption { id: string; shop_domain: string | null; shop_name: string | null; }
interface ProductOption {
  id: number;
  title: string;
  body_html?: string;
  product_type?: string;
  tags?: string;
  options?: { name: string; values: string[] }[];
  images: { src: string }[];
}

// ─── Form helpers ──────────────────────────────────────────────────────────────

function FF({ label, value, onChange, multiline = false, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; multiline?: boolean; placeholder?: string;
}) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground mb-1 block">{label}</Label>
      {multiline
        ? <Textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="text-sm resize-none" rows={3} />
        : <Input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="text-sm" />
      }
    </div>
  );
}

function FeaturesForm({ c, oc }: { c: Record<string,string>; oc:(k:string,v:string)=>void }) {
  return <div className="space-y-3">
    <FF label="Heading" value={c.heading} onChange={v=>oc("heading",v)} />
    {["b1","b2","b3","b4","b5"].map((k,i)=>(
      <FF key={k} label={`Feature ${i+1}`} value={c[k]} onChange={v=>oc(k,v)} placeholder="A true, useful point in plain words (or leave blank)" />
    ))}
  </div>;
}
function SocialForm({ c, oc }: { c: Record<string,string>; oc:(k:string,v:string)=>void }) {
  return <div className="space-y-3">
    <FF label="Heading" value={c.heading} onChange={v=>oc("heading",v)} />
    <FF label="Hype line (your own voice, not a fake review)" value={c.quote} onChange={v=>oc("quote",v)} multiline placeholder="One short, honest sentence about why it is worth having" />
  </div>;
}
function PromiseForm({ c, oc }: { c: Record<string,string>; oc:(k:string,v:string)=>void }) {
  return <div className="space-y-3">
    <FF label="Heading" value={c.heading} onChange={v=>oc("heading",v)} />
    <FF label="Promise body" value={c.body} onChange={v=>oc("body",v)} multiline />
    <FF label="Closing tagline" value={c.sub} onChange={v=>oc("sub",v)} />
  </div>;
}
function ShippingForm({ c, oc }: { c: Record<string,string>; oc:(k:string,v:string)=>void }) {
  return <div className="space-y-3">
    <FF label="Heading" value={c.heading} onChange={v=>oc("heading",v)} />
    <div className="grid grid-cols-2 gap-3">
      <FF label="Production (days)" value={c.production} onChange={v=>oc("production",v)} />
      <FF label="Transit (days)" value={c.transit} onChange={v=>oc("transit",v)} />
    </div>
    <FF label="Note" value={c.note} onChange={v=>oc("note",v)} multiline />
    <FF label="🎄 Holiday warning (optional)" value={c.holiday||""} onChange={v=>oc("holiday",v)} multiline />
  </div>;
}
function VariationsForm({ c, oc }: { c: Record<string,string>; oc:(k:string,v:string)=>void }) {
  return <div className="space-y-3">
    <FF label="Heading" value={c.heading} onChange={v=>oc("heading",v)} />
    {["A","B","C","D"].map(k=>(
      <FF key={k} label={`Option ${k}`} value={c[`var${k}`]||""} onChange={v=>oc(`var${k}`,v)} placeholder="A real color or style this product comes in" />
    ))}
    <FF label="Note" value={c.note} onChange={v=>oc("note",v)} />
  </div>;
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function ListingCards() {
  const { toast } = useToast();
  const navigate = useNavigate();
  // Read once (state initializer), cleared after mount — the Optimizer opens this
  // page in a new tab and hands the product over via localStorage.
  const [incoming] = useState<ListingCardsHandoff>(() => readListingCardsHandoff() ?? {});
  useEffect(() => { clearListingCardsHandoff(); }, []);

  // Opened from the Optimizer in a new tab: closing it returns to the untouched
  // editor. If the browser won't close it (or it wasn't opened that way), fall
  // back to navigating to the Optimizer in this tab.
  const backToEditor = () => {
    if (window.opener && !window.opener.closed) {
      window.close();
      setTimeout(() => navigate("/optimizer"), 150);
      return;
    }
    navigate("/optimizer");
  };
  const previewRef = useRef<HTMLDivElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [cardType, setCardType]   = useState<CardType>("features");
  const [niche, setNiche]         = useState<Niche>("wellness");
  const [theme, setTheme]         = useState<ThemePreset>("warm");
  const [productName, setProductName] = useState(incoming.productName || "");
  const [productDetails, setProductDetails] = useState(incoming.productDetails || "");
  const [photo, setPhoto]         = useState<string | null>(incoming.photo || null);
  const [content, setContent]     = useState<Record<CardType, Record<string, string>>>(
    Object.fromEntries(
      (Object.keys(DEFAULTS) as CardType[]).map(k => [k, { ...DEFAULTS[k] }])
    ) as Record<CardType, Record<string, string>>
  );
  const [aiLoading, setAiLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // ── Shopify link: which product a finished card gets added to ──
  const { user } = useAuth();
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [connectionId, setConnectionId] = useState(incoming.connectionId || "");
  const [linkedProduct, setLinkedProduct] = useState<{ id: number; title: string } | null>(
    incoming.productId ? { id: incoming.productId, title: incoming.productName || "this product" } : null,
  );
  const [productSearch, setProductSearch] = useState("");
  const [searchResults, setSearchResults] = useState<ProductOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [addedTypes, setAddedTypes] = useState<Set<CardType>>(new Set());

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
      setConnectionId((prev) => prev || (list.length === 1 ? list[0].id : ""));
    })();
  }, [user]);

  const searchProducts = async () => {
    if (!connectionId) { toast({ title: "Pick a store first", variant: "destructive" }); return; }
    setSearching(true);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-shopify-products", {
        body: { limit: 20, connectionId, search: productSearch.trim(), excludeProductIds: [] },
      });
      if (error) throw new Error(await getFunctionErrorMessage(error, "Couldn't load products"));
      const found: ProductOption[] = data?.products || [];
      setSearchResults(found);
      if (!found.length) toast({ title: "No matching products" });
    } catch (err) {
      toast({ title: "Product search failed", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setSearching(false);
    }
  };

  // Linking a product also fills in everything the card needs from it: name, real
  // details for AI Suggest, and its main photo — so nothing is retyped or re-uploaded.
  const linkProduct = async (id: string) => {
    const p = searchResults.find((r) => String(r.id) === id);
    if (!p) return;
    setLinkedProduct({ id: p.id, title: p.title });
    setProductName(p.title);
    setProductDetails(buildProductDetailsSummary(p));
    setAddedTypes(new Set());
    const src = p.images?.[0]?.src;
    if (src) {
      try { setPhoto(await imageUrlToDataUrl(src)); }
      catch { toast({ title: "Couldn't load the product photo", description: "Upload one manually.", variant: "destructive" }); }
    }
  };

  const unlinkProduct = () => { setLinkedProduct(null); setAddedTypes(new Set()); };

  const addToShopify = async () => {
    if (!previewRef.current || !linkedProduct || !connectionId) return;
    setUploading(true);
    try {
      const dataUrl = await renderElementToWebpDataUrl(previewRef.current);
      const attachment = dataUrl.split(",")[1];
      const label = productName.trim() || linkedProduct.title;
      const { data, error } = await supabase.functions.invoke("upload-shopify-webp", {
        body: {
          connectionId,
          productId: linkedProduct.id,
          attachment,
          filename: `${slugify(label)}-${cardType}`,
          alt: `${label} - ${CARD_META[cardType].label}`.slice(0, 125),
        },
      });
      if (error) throw new Error(await getFunctionErrorMessage(error, "Shopify upload failed"));
      if (data?.error) throw new Error(data.error);
      setAddedTypes((prev) => new Set(prev).add(cardType));
      toast({ title: "Added to Shopify", description: `"${CARD_META[cardType].label}" is now on ${linkedProduct.title}.` });
    } catch (err) {
      toast({ title: "Couldn't add to Shopify", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const t = THEMES[theme];
  const c = content[cardType];
  const hasContent = cardHasRealContent(cardType, c);

  const oc = useCallback((key: string, value: string) => {
    setContent(prev => ({ ...prev, [cardType]: { ...prev[cardType], [key]: value } }));
  }, [cardType]);

  // Photo upload
  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setPhoto(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  // AI suggest
  const suggestWithAI = async () => {
    if (!productName.trim()) {
      toast({ title: "Enter a product name first", variant: "destructive" });
      return;
    }
    setAiLoading(true);
    try {
      // One call fills all five cards (was one call per card, each re-sending the
      // product details and only filling the card on screen).
      const { data, error } = await supabase.functions.invoke("generate-card-copy", {
        body: { cardType: "all", productName, productDetails },
      });
      if (error) throw new Error(await getFunctionErrorMessage(error, "AI suggestion failed"));
      const contents = data?.contents as Record<string, Record<string, string>> | undefined;
      if (!contents) throw new Error("No suggestions returned");
      setContent(prev => {
        const next = { ...prev };
        for (const type of Object.keys(contents) as CardType[]) {
          if (next[type]) next[type] = { ...next[type], ...contents[type] };
        }
        return next;
      });
      toast({ title: "Filled all 5 cards", description: "Click through each card to review or edit." });
    } catch (err) {
      toast({ title: "AI suggestion failed", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setAiLoading(false);
    }
  };

  // Export WebP — 3× pixel ratio → ~1620×1260, matches the rest of the app's image pipeline
  const downloadWebp = async () => {
    if (!previewRef.current) return;
    setExporting(true);
    try {
      const dataUrl = await renderElementToWebpDataUrl(previewRef.current);
      const a = document.createElement("a");
      a.download = `listing-card-${cardType}-${theme}.webp`;
      a.href = dataUrl;
      a.click();
      toast({ title: "Downloaded!", description: "Ready to add to your listing." });
    } catch {
      toast({ title: "Export failed — try again.", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const renderForm = () => {
    const props = { c, oc };
    switch (cardType) {
      case "features":   return <FeaturesForm   {...props} />;
      case "social":     return <SocialForm     {...props} />;
      case "promise":    return <PromiseForm    {...props} />;
      case "shipping":   return <ShippingForm   {...props} />;
      case "variations": return <VariationsForm {...props} />;
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-primary" />
            <h1 className="text-2xl font-bold">Listing Card Generator</h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {incoming.fromOptimizer && (
              <Button variant="outline" size="sm" onClick={backToEditor} className="gap-1.5">
                <ArrowLeft className="w-3.5 h-3.5" /> Back to product editor
              </Button>
            )}
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link to="/bulk-listing-cards">
                <Zap className="w-3.5 h-3.5" /> Bulk generate for whole catalog
              </Link>
            </Button>
          </div>
        </div>
        <p className="text-muted-foreground text-sm">
          Build the info cards top sellers use on Etsy and Shopify alike — features, reviews, shipping, promise, and variations. Link your Shopify product, pick a theme, and add each card straight to its images.
        </p>
      </div>

      {/* Shopify product this card gets added to. Arriving from the Optimizer links
          it automatically; otherwise pick a store and search for the product. */}
      <div className="bg-card border border-border/40 rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Store className="w-4 h-4 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Shopify product</span>
          {linkedProduct ? (
            <>
              <Badge className="bg-primary/10 text-primary border-0 max-w-[26rem] truncate">{linkedProduct.title}</Badge>
              <button onClick={unlinkProduct} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
                Change
              </button>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">Not linked — pick one to enable Add to Shopify</span>
          )}
        </div>
        {!linkedProduct && (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={connectionId} onValueChange={setConnectionId}>
              <SelectTrigger className="w-56 bg-background/50 h-9">
                <SelectValue placeholder={stores.length ? "Pick a store" : "No Shopify store connected"} />
              </SelectTrigger>
              <SelectContent>
                {stores.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.shop_name || s.shop_domain || s.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void searchProducts(); }}
              placeholder="Search your products"
              className="h-9 w-56 text-sm"
            />
            <Button variant="outline" size="sm" onClick={searchProducts} disabled={searching || !connectionId} className="gap-1.5 h-9">
              {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              Search
            </Button>
            {searchResults.length > 0 && (
              <Select onValueChange={linkProduct}>
                <SelectTrigger className="w-72 bg-background/50 h-9">
                  <SelectValue placeholder={`Choose from ${searchResults.length} results`} />
                </SelectTrigger>
                <SelectContent>
                  {searchResults.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}
      </div>

      {/* Top bar: product name + photo upload */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-48">
          <Label className="text-xs text-muted-foreground mb-1 block">Product name</Label>
          <Input placeholder="e.g. Personalized Heart Ornament" value={productName}
            onChange={e => setProductName(e.target.value)} className="text-sm" />
        </div>

        {/* Photo upload */}
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Product photo</Label>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => photoInputRef.current?.click()} className="gap-2">
              <ImagePlus className="w-4 h-4" />
              {photo ? "Change photo" : "Upload photo"}
            </Button>
            {photo && (
              <button onClick={() => setPhoto(null)} className="text-muted-foreground hover:text-destructive">
                <X className="w-4 h-4" />
              </button>
            )}
            <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
          </div>
        </div>
      </div>

      {/* Real product details — what actually grounds AI Suggest in this specific
          item instead of generic boilerplate. Optional, but AI Suggest is only as
          good as what's given here. */}
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">Product details (materials, features, use case — feeds AI Suggest)</Label>
        <div className="flex gap-2 items-start">
          <Textarea
            placeholder="e.g. Ceramic mug, 11oz, dishwasher safe, double-sided print, ships in a padded box"
            value={productDetails}
            onChange={e => setProductDetails(e.target.value)}
            className="text-sm resize-none flex-1"
            rows={2}
          />
          <Button variant="outline" size="sm" onClick={suggestWithAI} disabled={aiLoading} className="gap-2 shrink-0">
            {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            AI Suggest (all 5 cards)
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
        {/* ── Left panel ─────────────────────────── */}
        <div className="space-y-5">
          {/* Card type */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Card Type</p>
            <div className="space-y-1.5">
              {(Object.entries(CARD_META) as [CardType, typeof CARD_META[CardType]][]).map(([type, meta]) => (
                <button key={type} onClick={() => setCardType(type)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all text-sm
                    ${cardType === type
                      ? "bg-primary/10 text-primary border border-primary/20 font-medium"
                      : "bg-card hover:bg-muted/60 border border-border/40"}`}>
                  {meta.icon}
                  <div>
                    <div className="font-medium leading-none">{meta.label}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{meta.hint}</div>
                  </div>
                  <span className="ml-auto flex items-center gap-1">
                    {addedTypes.has(type) && <CheckCircle2 className="w-4 h-4 text-green-600" />}
                    {cardType === type && <ChevronRight className="w-4 h-4 text-primary" />}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Niche + Theme */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5" /> Style Theme
            </p>
            {/* Niche tabs */}
            <div className="flex gap-1 mb-2 bg-muted/50 p-1 rounded-lg">
              {(Object.entries(NICHE_THEMES) as [Niche, typeof NICHE_THEMES[Niche]][]).map(([n, { label }]) => (
                <button key={n} onClick={() => {
                  setNiche(n);
                  setTheme(NICHE_THEMES[n].themes[0]);
                }}
                  className={`flex-1 text-[11px] font-medium py-1 px-2 rounded-md transition-all
                    ${niche === n ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                  {label}
                </button>
              ))}
            </div>
            {/* Theme swatches for selected niche */}
            <div className="flex gap-2 flex-wrap">
              {NICHE_THEMES[niche].themes.map(key => (
                <button key={key} onClick={() => setTheme(key)} title={THEMES[key].name}
                  className={`h-9 flex-1 min-w-0 rounded-md border-2 transition-all ${theme === key ? "border-primary scale-110 shadow-md" : "border-transparent hover:border-border"}`}
                  style={{ background: THEMES[key].grad }} />
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 text-center">{t.name}</p>
          </div>

          {/* Content form */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Card Text</p>
            <div className="bg-card border border-border/40 rounded-lg p-4 space-y-3">
              {renderForm()}
            </div>
          </div>
        </div>

        {/* ── Right panel: preview + download ───── */}
        <div className="space-y-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Preview</p>
          <div className="flex justify-center">
            <div ref={previewRef} style={{ borderRadius: "10px", overflow: "hidden", boxShadow: "0 8px 40px rgba(0,0,0,0.20)" }}>
              <CardRenderer cardType={cardType} theme={t} content={c} photo={photo} />
            </div>
          </div>

          <div className="flex justify-center gap-3 flex-wrap">
            <Button onClick={addToShopify} disabled={!linkedProduct || !connectionId || !hasContent || uploading || exporting} size="lg" className="gap-2 px-8">
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Store className="w-4 h-4" />}
              {uploading ? "Adding…" : addedTypes.has(cardType) ? "Add again to Shopify" : "Add to Shopify"}
            </Button>
            <Button onClick={downloadWebp} disabled={exporting || uploading} variant="outline" size="lg" className="gap-2 px-6">
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {exporting ? "Exporting…" : "Download WebP"}
            </Button>
          </div>
          {!linkedProduct && (
            <p className="text-center text-xs text-muted-foreground">Link a Shopify product above to add this card straight to its images.</p>
          )}
          {!hasContent && (
            <p className="text-center text-xs text-muted-foreground">
              This card is empty, so it can't be added yet. Fill it in or use AI Suggest.
              {cardType === "variations" ? " If this product has no real options (like colors), skip this card." : ""}
            </p>
          )}
          {addedTypes.has(cardType) && (
            <p className="text-center text-xs text-muted-foreground">This card is already on the product — adding again creates a duplicate image.</p>
          )}

          <div className="bg-muted/40 border border-border/30 rounded-lg p-4 text-xs text-muted-foreground leading-relaxed max-w-xl mx-auto">
            <strong className="text-foreground">How to use this for a full listing set:</strong> Use Media Tools to generate your hero + lifestyle mockups, then create all 5 info cards here. That gives you a complete 7–9 image listing that looks like a top shop — not just pretty photos. Doing this across your whole catalog by hand? Use <Link to="/bulk-listing-cards" className="text-primary underline underline-offset-2">Bulk generate</Link> instead.
          </div>
        </div>
      </div>
    </div>
  );
}
