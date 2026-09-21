import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  Video, Store, Search, Loader2, ImagePlus, ArrowUp, ArrowDown, X, Download, AlertTriangle, Check,
} from "lucide-react";
import {
  MAX_VIDEO_IMAGES, VIDEO_SECONDS, VIDEO_SIZE, canMakeVideos, classifyProductImage,
  pickBestImages, renderImagesToMp4,
} from "@/lib/imageVideo";
import { slugify } from "@/lib/listingCardKit";
import { getFunctionErrorMessage } from "@/lib/functionsError";

interface StoreOption { id: string; shop_domain: string | null; shop_name: string | null; }
interface ProductImage { id?: number; src: string; alt?: string | null; position?: number; }
interface ProductOption { id: number; title: string; images: ProductImage[]; }

interface Slide {
  key: string;
  label: string;
  preview: string;
  source: { type: "url"; src: string } | { type: "file"; file: File };
}

export default function ListingVideo() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [stores, setStores] = useState<StoreOption[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [results, setResults] = useState<ProductOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [product, setProduct] = useState<ProductOption | null>(null);

  const [slides, setSlides] = useState<Slide[]>([]);
  const [making, setMaking] = useState(false);
  const [stage, setStage] = useState("");
  const [progress, setProgress] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoBytes, setVideoBytes] = useState(0);

  const supported = canMakeVideos();

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

  // Free the finished video's memory when leaving the page.
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);

  const clearVideo = () => { setVideoUrl(null); setVideoBytes(0); };

  const searchProducts = async () => {
    if (!connectionId) { toast({ title: "Pick a store first", variant: "destructive" }); return; }
    setSearching(true);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-shopify-products", {
        body: { limit: 20, connectionId, search: productSearch.trim(), excludeProductIds: [] },
      });
      if (error) throw new Error(await getFunctionErrorMessage(error, "Couldn't load products"));
      const found: ProductOption[] = data?.products || [];
      setResults(found);
      if (!found.length) toast({ title: "No matching products" });
    } catch (err) {
      toast({ title: "Product search failed", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setSearching(false);
    }
  };

  const slideFromImage = (img: ProductImage, index: number): Slide => ({
    key: `p-${img.id ?? index}`,
    label: classifyProductImage(img.src, img.alt, img.position ?? index + 1).label,
    preview: img.src,
    source: { type: "url", src: img.src },
  });

  // Picking a product also picks its best images for you, in the order they should
  // play: main photo, lifestyle mockups, features card, and so on.
  const linkProduct = (id: string) => {
    const p = results.find((r) => String(r.id) === id);
    if (!p) return;
    setProduct(p);
    clearVideo();
    const best = pickBestImages(p.images);
    setSlides(best.map((i) => slideFromImage(p.images[i], i)));
  };

  const toggleProductImage = (img: ProductImage, index: number) => {
    const key = `p-${img.id ?? index}`;
    clearVideo();
    setSlides((prev) => {
      if (prev.some((s) => s.key === key)) return prev.filter((s) => s.key !== key);
      if (prev.length >= MAX_VIDEO_IMAGES) return prev;
      return [...prev, slideFromImage(img, index)];
    });
  };

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    clearVideo();
    setSlides((prev) => {
      const room = MAX_VIDEO_IMAGES - prev.length;
      const added = Array.from(files).slice(0, Math.max(0, room)).map((file, i): Slide => ({
        key: `f-${Date.now()}-${i}`,
        label: "Your image",
        preview: URL.createObjectURL(file),
        source: { type: "file", file },
      }));
      return [...prev, ...added];
    });
  };

  const removeSlide = (index: number) => {
    clearVideo();
    setSlides((prev) => {
      const gone = prev[index];
      if (gone?.source.type === "file") URL.revokeObjectURL(gone.preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const moveSlide = (index: number, dir: -1 | 1) => {
    clearVideo();
    setSlides((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const makeVideo = async () => {
    if (!slides.length) return;
    setMaking(true);
    setProgress(0);
    setStage("Loading your images…");
    clearVideo();
    const bitmaps: ImageBitmap[] = [];
    try {
      for (const slide of slides) {
        let blob: Blob;
        if (slide.source.type === "file") {
          blob = slide.source.file;
        } else {
          // Ask Shopify's CDN for a right-sized copy instead of the full original.
          const url = new URL(slide.source.src);
          url.searchParams.set("width", "1400");
          const res = await fetch(url.toString());
          if (!res.ok) throw new Error("Couldn't load one of the images.");
          blob = await res.blob();
        }
        bitmaps.push(await createImageBitmap(blob));
      }
      setStage("Making your video…");
      const out = await renderImagesToMp4(bitmaps, setProgress);
      setVideoUrl(URL.createObjectURL(out));
      setVideoBytes(out.size);
      toast({ title: "Video ready", description: "Check it over, then download it." });
    } catch (err) {
      toast({ title: "Couldn't make the video", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      bitmaps.forEach((b) => b.close());
      setMaking(false);
      setStage("");
    }
  };

  const filename = `${slugify(product?.title || "listing")}-video.mp4`;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Video className="w-5 h-5 text-primary" />
          <h1 className="text-2xl font-bold">Listing Video</h1>
        </div>
        <p className="text-muted-foreground text-sm">
          Turns up to {MAX_VIDEO_IMAGES} of your images into a {VIDEO_SECONDS}-second video for your Etsy or Shopify listing. It uses your real images exactly as they are, so nothing gets redrawn or changed, and it costs nothing per video.
        </p>
      </div>

      {!supported && (
        <div className="bg-yellow-500/8 border border-yellow-500/20 rounded-lg px-4 py-3 text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 text-yellow-600 shrink-0" />
          <span>This browser can't make MP4 videos. Open this page in Chrome or Edge.</span>
        </div>
      )}

      {/* Pick a product, or skip this and upload your own images below */}
      <div className="bg-card border border-border/40 rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Store className="w-4 h-4 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Shopify product</span>
          {product ? (
            <>
              <Badge className="bg-primary/10 text-primary border-0 max-w-[26rem] truncate">{product.title}</Badge>
              <button onClick={() => { setProduct(null); setSlides([]); clearVideo(); }} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
                Change
              </button>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">Pick one and the best images get chosen for you, or upload your own below</span>
          )}
        </div>
        {!product && (
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
            {results.length > 0 && (
              <Select onValueChange={linkProduct}>
                <SelectTrigger className="w-72 bg-background/50 h-9">
                  <SelectValue placeholder={`Choose from ${results.length} results`} />
                </SelectTrigger>
                <SelectContent>
                  {results.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}
      </div>

      {/* All of the product's images: tap to add or remove from the video */}
      {product && product.images.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            This product's images (tap to add or remove)
          </p>
          <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 gap-2">
            {product.images.map((img, index) => {
              const info = classifyProductImage(img.src, img.alt, img.position ?? index + 1);
              const key = `p-${img.id ?? index}`;
              const chosen = slides.some((s) => s.key === key);
              const skipped = info.rank >= 99;
              return (
                <button
                  key={key}
                  onClick={() => toggleProductImage(img, index)}
                  className={`relative rounded-md overflow-hidden border-2 text-left transition-all ${chosen ? "border-primary" : "border-transparent hover:border-border"} ${skipped && !chosen ? "opacity-40" : ""}`}
                >
                  <img src={img.src} alt="" className="w-full aspect-square object-cover" />
                  <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[10px] px-1.5 py-0.5 truncate">{info.label}</span>
                  {chosen && (
                    <span className="absolute top-1 right-1 bg-primary text-primary-foreground rounded-full p-0.5"><Check className="w-3 h-3" /></span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">
            The best {MAX_VIDEO_IMAGES} were picked for you: main photo first, then lifestyle mockups, then the features card. Shipping and promise cards and size charts are skipped because they don't help sell the item.
          </p>
        </div>
      )}

      {/* The video's images, in play order */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            In the video ({slides.length}/{MAX_VIDEO_IMAGES}), played in this order
          </p>
          <label className="inline-flex">
            <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            <span className={`inline-flex items-center gap-1.5 text-sm border border-border/60 rounded-md px-3 h-8 cursor-pointer hover:bg-muted/50 ${slides.length >= MAX_VIDEO_IMAGES ? "opacity-50 pointer-events-none" : ""}`}>
              <ImagePlus className="w-4 h-4" /> Upload your own images
            </span>
          </label>
        </div>

        {slides.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm border border-dashed border-border/40 rounded-xl">
            Pick a product above, or upload your own images.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {slides.map((s, i) => (
              <div key={s.key} className="border border-border/40 rounded-lg overflow-hidden bg-card">
                <div className="relative">
                  <img src={s.preview} alt="" className="w-full aspect-square object-cover" />
                  <span className="absolute top-1 left-1 bg-black/70 text-white text-[10px] rounded px-1.5 py-0.5">{i + 1}</span>
                </div>
                <div className="p-1.5 space-y-1">
                  <p className="text-[11px] text-muted-foreground truncate">{s.label}</p>
                  <div className="flex items-center justify-between">
                    <div className="flex gap-0.5">
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => moveSlide(i, -1)} disabled={i === 0} aria-label="Move earlier">
                        <ArrowUp className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => moveSlide(i, 1)} disabled={i === slides.length - 1} aria-label="Move later">
                        <ArrowDown className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeSlide(i)} aria-label="Remove">
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <Button onClick={makeVideo} disabled={!supported || making || slides.length === 0} size="lg" className="gap-2 px-8">
          {making ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />}
          {making ? stage : `Make my ${VIDEO_SECONDS}-second video`}
        </Button>
        {making && <Progress value={Math.round(progress * 100)} />}
      </div>

      {videoUrl && (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your video</p>
          <video
            src={videoUrl}
            controls
            loop
            muted
            playsInline
            className="w-full max-w-md rounded-lg border border-border/40 bg-black"
            style={{ aspectRatio: "1 / 1" }}
          />
          <div className="flex items-center gap-3 flex-wrap">
            <Button asChild size="lg" className="gap-2">
              <a href={videoUrl} download={filename}>
                <Download className="w-4 h-4" /> Download MP4
              </a>
            </Button>
            <span className="text-xs text-muted-foreground">
              {VIDEO_SIZE}×{VIDEO_SIZE}, {VIDEO_SECONDS} seconds, no sound, {(videoBytes / 1_000_000).toFixed(1)} MB. Etsy removes sound from listing videos anyway.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
