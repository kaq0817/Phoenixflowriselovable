import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  BarChart3, Sparkles, Store, Loader2, CheckCircle2,
  ChevronDown, ChevronUp, Image as ImageIcon, Tag, FileText, Palette,
  Radio, Layers, Search, Lightbulb,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { isShopifyPlatform } from "@/lib/storePlatforms";

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
  metafields_global_title_tag?: string;
  metafields_global_description_tag?: string;
}

interface ShopifySuggestions {
  title: string;
  body_html: string;
  seo_title: string;
  seo_description: string;
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

interface MockupDraft {
  data: string;
  mimeType: string;
  style: "lifestyle" | "human" | "styled";
  quality: { approved: boolean; issues: string[] };
  uploaded?: boolean;
}

interface StoreConnectionOption {
  id: string;
  platform: string;
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

// Strip the legal entity name from product titles — it belongs in policy/legal pages,
// not in GMC product titles. The DBA brand "Iron Phoenix GHG" and store "Our Phoenix Rise"
// are kept because GMC requires brand name in apparel titles.
// Legal entity: Go Hard Gaming Discord LLC  |  DBA: Iron Phoenix GHG  |  Store: Our Phoenix Rise
const INTERNAL_BRAND_RE = /\bGo Hard Gaming Discord LLC\b|\bGo Hard Gaming Discord\b/gi;
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
    drafts[img.id] = `${productSlug}-${detail}-${storeSlug}.webp`;
  }
  return drafts;
}

function isApparelProduct(product: ShopifyProduct): boolean {
  const haystack = `${product.title || ""} ${product.product_type || ""} ${product.tags || ""}`.toLowerCase();
  return ["shirt", "tee", "hoodie", "sweatshirt", "sweater", "jacket", "dress", "pants", "leggings", "shorts", "top", "tank", "skirt", "apparel", "clothing", "beanie", "hat", "cap", "jersey"].some((term) => haystack.includes(term));
}

export default function OptimizerPage() {
  const { session } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [storeConnections, setStoreConnections] = useState<StoreConnectionOption[]>([]);
  const [selectedShopifyConnectionId, setSelectedShopifyConnectionId] = useState("");
  const [loading, setLoading] = useState(true);

  const [shopifyProducts, setShopifyProducts] = useState<ShopifyProduct[]>([]);
  const [shopifyLoading, setShopifyLoading] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ShopifyProduct | null>(null);
  const [shopifySuggestions, setShopifySuggestions] = useState<ShopifySuggestions | null>(null);
  const [shopifyOptimizing, setShopifyOptimizing] = useState(false);
  const [shopifyApplying, setShopifyApplying] = useState(false);
  const [shopifyNextCursor, setShopifyNextCursor] = useState<string | null>(null);
  const [shopifyHasMore, setShopifyHasMore] = useState(false);
  const [shopifyDoneIds, setShopifyDoneIds] = useState<Set<number>>(new Set());
  const [productSearch, setProductSearch] = useState("");
  const [activeProductSearch, setActiveProductSearch] = useState("");
  const [seoTitleDraft, setSeoTitleDraft] = useState("");
  const [seoDescDraft, setSeoDescDraft] = useState("");
  const [titleDraft, setTitleDraft] = useState("");

  const [productTitleEdit, setProductTitleEdit] = useState("");
  const [productContextNote, setProductContextNote] = useState("");
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [altTextExpanded, setAltTextExpanded] = useState(false);
  const [imageAltEdits, setImageAltEdits] = useState<Record<number, string>>({});
  const [imageFilenameDrafts, setImageFilenameDrafts] = useState<Record<number, string>>({});
  const [savingAltText, setSavingAltText] = useState(false);
  const [altScanLoading, setAltScanLoading] = useState(false);
  const [altsAIFilled, setAltsAIFilled] = useState(0);
  const [convertingImageId, setConvertingImageId] = useState<number | null>(null);
  const [mockupSourceImageId, setMockupSourceImageId] = useState<number | null>(null);
  const [generatingMockupStyle, setGeneratingMockupStyle] = useState<MockupDraft["style"] | null>(null);
  const [mockupDrafts, setMockupDrafts] = useState<MockupDraft[]>([]);
  const [uploadingMockupIndex, setUploadingMockupIndex] = useState<number | null>(null);

  const [salesChannels, setSalesChannels] = useState<{ id: number; name: string }[]>([]);
  const [publishedChannelIds, setPublishedChannelIds] = useState<number[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelTogglingId, setChannelTogglingId] = useState<number | null>(null);

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
      const rows = (data || []).filter((c) => isShopifyPlatform(c.platform)) as StoreConnectionOption[];
      setStoreConnections(rows);
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
  }, [shopifySuggestions]);

  const fetchShopifyProducts = async (
    cursor: string | null = null,
    append = false,
    searchTerm = "",
  ) => {
    if (!selectedShopifyConnectionId) {
      toast({ title: "Select a store", description: "Choose a Shopify store before loading products." });
      return;
    }
    setShopifyLoading(true);
    try {
      const directSearch = searchTerm.trim().length > 0;
      const currentDoneIds = (() => {
        try {
          const raw = localStorage.getItem(`optimizer-done-ids:${selectedShopifyConnectionId}`);
          return raw ? new Set<number>(JSON.parse(raw)) : new Set<number>();
        } catch { return new Set<number>(); }
      })();
      const { data, error } = await supabase.functions.invoke("fetch-shopify-products", {
        body: {
          limit: 50,
          connectionId: selectedShopifyConnectionId,
          pageInfoCursor: cursor,
          search: searchTerm.trim(),
          excludeProductIds: directSearch
            ? []
            : [
                ...Array.from(currentDoneIds),
                ...(append ? shopifyProducts.map((product) => product.id) : []),
              ],
        },
      });
      if (error) throw error;
      const incoming: ShopifyProduct[] = directSearch
        ? (data.products || [])
        : (data.products || []).filter((p: ShopifyProduct) => !currentDoneIds.has(p.id));
      setActiveProductSearch(searchTerm.trim());
      setShopifyProducts((prev) => {
        if (!append) return incoming;
        const existingIds = new Set(prev.map((p) => p.id));
        return [...prev, ...incoming.filter((p) => !existingIds.has(p.id))];
      });
      setShopifyDoneIds(currentDoneIds);
      const nextCursor: string | null = data.nextPageInfo ?? null;
      setShopifyNextCursor(nextCursor);
      setShopifyHasMore(!directSearch && Boolean(data.hasMore || nextCursor));
      if (data.optimizerUsage) setOptimizerUsage(data.optimizerUsage);
    } catch (err: unknown) {
      const errorObj = err as Error;
      toast({ title: "Error", description: errorObj.message, variant: "destructive" });
    } finally {
      setShopifyLoading(false);
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
    setProductTitleEdit(cleanProductTitle(product.title || ""));
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
    setMockupSourceImageId(product.images?.[0]?.id ?? null);
    setMockupDrafts([]);
    setGeneratingMockupStyle(null);
    setUploadingMockupIndex(null);
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
        if (detail.includes("free_limit_reached")) {
          navigate("/pricing");
          return;
        }
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

  const [rescanningImageId, setRescanningImageId] = useState<number | null>(null);

  const rescanSingleImage = async (img: { id: number; src: string }) => {
    if (!selectedProduct) return;
    setRescanningImageId(img.id);
    try {
      const activeConnection = storeConnections.find((c) => c.id === selectedShopifyConnectionId);
      const storeName = activeConnection?.shop_name || activeConnection?.shop_domain || "store";
      const { data, error } = await supabase.functions.invoke("generate-image-alts", {
        body: {
          images: [{ id: img.id, src: img.src }],
          productTitle: selectedProduct.title,
          storeName,
        },
      });
      if (error) throw error;
      const results: { image_id: number; alt: string; filename: string }[] = data.results || [];
      if (results[0]) {
        setImageAltEdits(prev => ({ ...prev, [img.id]: results[0].alt }));
        setImageFilenameDrafts(prev => ({ ...prev, [img.id]: results[0].filename }));
      }
    } catch (err: unknown) {
      const errorObj = err as Error;
      toast({ title: "Rescan failed", description: errorObj.message, variant: "destructive" });
    } finally {
      setRescanningImageId(null);
    }
  };

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

  const createWebpCopy = async (img: { id: number; src: string; alt: string | null }) => {
    if (!selectedProduct || !selectedShopifyConnectionId) return;
    setConvertingImageId(img.id);
    try {
      const sourceResponse = await fetch(img.src);
      if (!sourceResponse.ok) throw new Error("Phoenix Flow could not read this Shopify image.");
      const sourceBlob = await sourceResponse.blob();
      const bitmap = await createImageBitmap(sourceBlob);
      const maxDimension = 2000;
      const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Your browser could not prepare the WebP image.");
      context.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();

      const webpBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => blob ? resolve(blob) : reject(new Error("WebP conversion failed.")),
          "image/webp",
          0.84,
        );
      });
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("WebP conversion failed."));
        reader.readAsDataURL(webpBlob);
      });
      const attachment = dataUrl.split(",")[1];
      if (!attachment) throw new Error("WebP conversion failed.");

      const { data, error } = await supabase.functions.invoke("upload-shopify-webp", {
        body: {
          connectionId: selectedShopifyConnectionId,
          productId: selectedProduct.id,
          attachment,
          filename: imageFilenameDrafts[img.id] || `product-image-${img.id}.webp`,
          alt: imageAltEdits[img.id] ?? img.alt ?? "",
        },
      });
      if (error) throw error;
      if (!data?.image) throw new Error("Shopify did not return the uploaded image.");

      const updatedProduct = {
        ...selectedProduct,
        images: [...selectedProduct.images, data.image],
      };
      setSelectedProduct(updatedProduct);
      setShopifyProducts((current) => current.map((product) => (
        product.id === updatedProduct.id ? updatedProduct : product
      )));
      setImageAltEdits((current) => ({
        ...current,
        [data.image.id]: data.image.alt || imageAltEdits[img.id] || "",
      }));
      const activeConnection = storeConnections.find((connection) => connection.id === selectedShopifyConnectionId);
      const storeLabel = activeConnection?.shop_name || activeConnection?.shop_domain || "store";
      setImageFilenameDrafts(buildUniqueFilenameDrafts(updatedProduct, storeLabel));
      toast({
        title: "WebP copy uploaded",
        description: "The original remains in Shopify until you approve the new image.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "WebP conversion failed";
      toast({ title: "WebP conversion failed", description: message, variant: "destructive" });
    } finally {
      setConvertingImageId(null);
    }
  };

  const generateMockup = async (style: MockupDraft["style"]) => {
    if (!selectedProduct || !selectedShopifyConnectionId || !mockupSourceImageId) return;
    setGeneratingMockupStyle(style);
    try {
      const { data, error } = await supabase.functions.invoke("generate-product-mockup", {
        body: {
          connectionId: selectedShopifyConnectionId,
          productId: selectedProduct.id,
          imageId: mockupSourceImageId,
          style,
        },
      });
      if (error) throw error;
      if (!data?.mockup?.data) throw new Error("Phoenix Flow did not receive a mockup.");
      setMockupDrafts((current) => [data.mockup as MockupDraft, ...current].slice(0, 6));
      toast({
        title: "Mockup ready to review",
        description: "Compare the product and lettering with the source, then approve or discard it.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Mockup generation failed";
      toast({ title: "Mockup generation failed", description: message, variant: "destructive" });
    } finally {
      setGeneratingMockupStyle(null);
    }
  };

  const uploadMockup = async (draft: MockupDraft, index: number) => {
    if (!selectedProduct || !selectedShopifyConnectionId || !draft.quality.approved) return;
    setUploadingMockupIndex(index);
    try {
      const activeConnection = storeConnections.find((connection) => connection.id === selectedShopifyConnectionId);
      const storeLabel = activeConnection?.shop_name || activeConnection?.shop_domain || "store";
      const productSlug = slugifyForFilename(selectedProduct.title) || `product-${selectedProduct.id}`;
      const storeSlug = slugifyForFilename(storeLabel) || "store";
      const filename = `${productSlug}-${draft.style}-mockup-${storeSlug}.webp`;
      const alt = `${selectedProduct.title} - ${draft.style} lifestyle mockup | ${storeLabel}`.slice(0, 125);
      const { data, error } = await supabase.functions.invoke("upload-shopify-webp", {
        body: {
          connectionId: selectedShopifyConnectionId,
          productId: selectedProduct.id,
          attachment: draft.data,
          filename,
          alt,
        },
      });
      if (error) throw error;
      if (!data?.image) throw new Error("Shopify did not return the uploaded mockup.");

      const updatedProduct = { ...selectedProduct, images: [...selectedProduct.images, data.image] };
      setSelectedProduct(updatedProduct);
      setShopifyProducts((current) => current.map((product) => (
        product.id === updatedProduct.id ? updatedProduct : product
      )));
      setMockupDrafts((current) => current.map((entry, draftIndex) => (
        draftIndex === index ? { ...entry, uploaded: true } : entry
      )));
      toast({ title: "Mockup added to Shopify", description: "The source image remains untouched." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Mockup upload failed";
      toast({ title: "Mockup upload failed", description: message, variant: "destructive" });
    } finally {
      setUploadingMockupIndex(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const shopifyStoreOptions = storeConnections;

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

      {shopifyStoreOptions.length === 0 ? (
        <Card className="bg-card/50 border-border/30">
          <CardContent className="p-8 text-center space-y-4">
            <Store className="h-12 w-12 text-muted-foreground mx-auto" />
            <h2 className="text-lg font-semibold">Connect Your Shopify Store</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Head to Settings and paste your Shopify Admin API token to get started.
            </p>
            <Button onClick={() => window.location.href = "/settings"} className="gradient-phoenix text-primary-foreground">
              Go to Settings
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
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
                  setProductSearch("");
                  setActiveProductSearch("");
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
                        />
                        <p className="text-[10px] text-muted-foreground text-right">{productTitleEdit.length} chars — AI will optimize to GMC limits</p>
                      </div>
                      <div className="space-y-1.5">
                        <label className={`text-xs font-medium uppercase tracking-wider ${selectedProduct.body_html?.trim() ? "text-muted-foreground" : "text-amber-500"}`}>
                          {selectedProduct.body_html?.trim() ? "Additional context for AI (optional)" : "No description found — what is this product?"}
                        </label>
                        <textarea
                          className={`w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 resize-none ${selectedProduct.body_html?.trim() ? "border-input focus:ring-primary" : "border-amber-500/40 focus:ring-amber-500"}`}
                          rows={3}
                          placeholder={selectedProduct.body_html?.trim() ? "e.g. Christmas tablecloth, 60\" round, fixed design — not customizable. Or: metal wall art, generic specs only, do not name a specific design." : "e.g. A 3-piece paint splatter lounge set including hoodie, joggers and shorts. Unisex sizing XS-4XL."}
                          value={productContextNote}
                          onChange={(e) => setProductContextNote(e.target.value)}
                        />
                      </div>
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

                {selectedProduct.images?.length > 0 && (
                  <Card className="bg-card/50 border-primary/30 overflow-hidden">
                    <CardContent className="p-4 space-y-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-primary" />
                          <h3 className="text-sm font-semibold">Generate Product Mockups</h3>
                          <Badge variant="outline" className="ml-auto text-[10px]">OpenAI</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Pick the most accurate source image, then create one low-cost draft. Nothing uploads until you approve it.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">1. Source product image</p>
                        <div className="flex gap-2 overflow-x-auto pb-1">
                          {selectedProduct.images.map((image, index) => (
                            <button
                              key={image.id}
                              type="button"
                              onClick={() => setMockupSourceImageId(image.id)}
                              className={`relative shrink-0 rounded-lg border-2 p-0.5 transition-colors ${
                                mockupSourceImageId === image.id ? "border-primary" : "border-border/30"
                              }`}
                              aria-label={`Use product image ${index + 1} as the mockup source`}
                            >
                              <img src={image.src} alt={image.alt || ""} className="h-16 w-16 rounded-md object-cover" />
                              <span className="absolute bottom-1 right-1 rounded bg-background/90 px-1 text-[9px]">{index + 1}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">2. Create one draft</p>
                        <div className="grid gap-2 sm:grid-cols-3">
                          {([
                            ["lifestyle", "Lifestyle Scene"],
                            ["human", "Person Using It"],
                            ["styled", "Styled Close-up"],
                          ] as const).map(([style, label]) => (
                            <Button
                              key={style}
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={generatingMockupStyle !== null || !mockupSourceImageId}
                              onClick={() => void generateMockup(style)}
                            >
                              {generatingMockupStyle === style
                                ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Creating...</>
                                : label}
                            </Button>
                          ))}
                        </div>
                        <p className="text-[10px] text-muted-foreground">Creates one 1024px WebP draft per click. OpenAI charges usage separately.</p>
                      </div>

                      {mockupDrafts.length > 0 && (
                        <div className="space-y-3">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">3. Review before Shopify</p>
                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {mockupDrafts.map((draft, index) => (
                              <div key={`${draft.style}-${index}`} className="rounded-lg border border-border/40 bg-background/40 p-2 space-y-2">
                                <img
                                  src={`data:${draft.mimeType};base64,${draft.data}`}
                                  alt={`${selectedProduct.title} generated ${draft.style} mockup draft`}
                                  className="w-full aspect-square rounded-md object-cover"
                                />
                                <div className="flex items-center justify-between gap-2">
                                  <Badge variant="outline" className="text-[10px] capitalize">{draft.style}</Badge>
                                  <Badge className={draft.quality.approved
                                    ? "bg-emerald-500/10 text-emerald-300"
                                    : "bg-amber-500/10 text-amber-300"}>
                                    {draft.quality.approved ? "You approved it" : "Approval required"}
                                  </Badge>
                                </div>
                                {!draft.quality.approved && draft.quality.issues?.length > 0 && (
                                  <p className="text-[11px] text-amber-300">{draft.quality.issues.join(" ")}</p>
                                )}
                                {!draft.quality.approved && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    className="w-full"
                                    onClick={() => setMockupDrafts((current) => current.map((entry, draftIndex) => (
                                      draftIndex === index ? { ...entry, quality: { ...entry.quality, approved: true } } : entry
                                    )))}
                                  >
                                    I Checked It - Product Is Accurate
                                  </Button>
                                )}
                                <div className="flex gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    className="flex-1"
                                    disabled={!draft.quality.approved || draft.uploaded || uploadingMockupIndex !== null}
                                    onClick={() => void uploadMockup(draft, index)}
                                  >
                                    {uploadingMockupIndex === index
                                      ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Uploading...</>
                                      : draft.uploaded ? "Uploaded" : "Add to Shopify"}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    disabled={uploadingMockupIndex !== null}
                                    onClick={() => setMockupDrafts((current) => current.filter((_, draftIndex) => draftIndex !== index))}
                                  >
                                    Discard
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
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
                          {selectedProduct.images.length < 5 && (
                            <Badge className="bg-amber-500/10 text-amber-400">
                              Weak Gallery: {selectedProduct.images.length}/5 images
                            </Badge>
                          )}
                          {selectedProduct.images.some((image) => !image.alt?.trim()) && (
                            <Badge className="bg-blue-500/10 text-blue-300">Missing Alt Text</Badge>
                          )}
                          {selectedProduct.images.some((image) => !image.src.split("?")[0].toLowerCase().endsWith(".webp")) && (
                            <Badge className="bg-purple-500/10 text-purple-300">Needs WebP</Badge>
                          )}
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
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={convertingImageId !== null || img.src.split("?")[0].toLowerCase().endsWith(".webp")}
                                onClick={() => void createWebpCopy(img)}
                              >
                                {convertingImageId === img.id
                                  ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Converting...</>
                                  : "Create WebP Copy"}
                              </Button>
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
                    {shopifySuggestions.reasoning?.includes("AI QUOTA EXCEEDED") ? (
                      <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/40">
                        <p className="text-sm text-amber-500 font-medium">AI quota exceeded — basic cleanup only. Wait a few minutes and re-run for full optimization.</p>
                      </div>
                    ) : (
                      <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                        <p className="text-sm text-muted-foreground"><Sparkles className="h-4 w-4 inline mr-1 text-primary" />{shopifySuggestions.reasoning}</p>
                      </div>
                    )}
                    <ComparisonRow label="Product Title" icon={<Tag className="h-4 w-4 text-primary" />} original={selectedProduct.title} optimized={shopifySuggestions.title} onChange={(v) => setShopifySuggestions({ ...shopifySuggestions, title: v })} />
                    <ComparisonRow label="Product Description" icon={<FileText className="h-4 w-4 text-primary" />} original={(selectedProduct.body_html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() || "No description"} optimized={shopifySuggestions.body_html} onChange={(v) => setShopifySuggestions({ ...shopifySuggestions, body_html: v })} multiline />
                    <ComparisonRow label="SEO Title" icon={<FileText className="h-4 w-4 text-primary" />} original={selectedProduct.title} optimized={shopifySuggestions.seo_title} onChange={(v) => setShopifySuggestions({ ...shopifySuggestions, seo_title: v })} />
                    <ComparisonRow label="SEO Description" icon={<FileText className="h-4 w-4 text-primary" />} original={(selectedProduct.metafields_global_description_tag || "No meta description")} optimized={shopifySuggestions.seo_description} onChange={(v) => setShopifySuggestions({ ...shopifySuggestions, seo_description: v })} multiline />
                    <ComparisonRow label="Shopify FAQ Metaobject" icon={<Lightbulb className="h-4 w-4 text-primary" />} original="Existing FAQ entry linked to this product" optimized={shopifySuggestions.faq_json || "[]"} onChange={(v) => setShopifySuggestions({ ...shopifySuggestions, faq_json: v })} multiline />
                    <ComparisonRow label="Product Type" icon={<Palette className="h-4 w-4 text-primary" />} original={selectedProduct.product_type || ""} optimized={shopifySuggestions.product_type} onChange={(v) => setShopifySuggestions({ ...shopifySuggestions, product_type: v })} />
                    <ComparisonRow label="Tags" icon={<Tag className="h-4 w-4 text-primary" />} original={selectedProduct.tags || ""} optimized={shopifySuggestions.tags} onChange={(v) => setShopifySuggestions({ ...shopifySuggestions, tags: v })} multiline />

                    {/* ── Variant Playbook ── */}
                    {(() => {
                      if (!shopifySuggestions.variant_suggestions) return null;
                      let variantRecs: Array<{
                        variant: string;
                        angle: string;
                        primary_keyword: string;
                        secondary_keywords?: string[];
                        listing_tip?: string;
                      }> = [];
                      try {
                        const parsed = JSON.parse(shopifySuggestions.variant_suggestions);
                        if (Array.isArray(parsed) && parsed.length > 0) variantRecs = parsed;
                      } catch { return null; }
                      if (variantRecs.length === 0) return null;
                      return (
                        <div className="rounded-lg border border-primary/30 bg-primary/5 overflow-hidden">
                          <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/20">
                            <Layers className="h-4 w-4 text-primary" />
                            <span className="text-sm font-semibold text-primary">Variant Playbook</span>
                            <Badge variant="outline" className="text-[10px] ml-auto">{variantRecs.length} variant{variantRecs.length !== 1 ? "s" : ""}</Badge>
                          </div>
                          <p className="px-4 py-2 text-xs text-muted-foreground border-b border-primary/10">
                            Each variant targets a different buyer search. Use these to write variant-specific alt text, or split high-traffic designs into standalone products.
                          </p>
                          <div className="divide-y divide-border/30">
                            {variantRecs.map((rec, idx) => (
                              <div key={idx} className="px-4 py-3 space-y-1.5">
                                <div className="flex items-start gap-2">
                                  <span className="text-xs font-semibold text-foreground/80 min-w-0 flex-1 line-clamp-1">{rec.variant}</span>
                                </div>
                                <p className="text-xs text-muted-foreground italic">{rec.angle}</p>
                                <div className="flex flex-wrap gap-1.5 mt-1">
                                  <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                                    <Search className="h-3 w-3" />{rec.primary_keyword}
                                  </span>
                                  {(rec.secondary_keywords || []).map((kw, ki) => (
                                    <span key={ki} className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{kw}</span>
                                  ))}
                                </div>
                                {rec.listing_tip && (
                                  <div className="flex items-start gap-1.5 mt-1">
                                    <Lightbulb className="h-3 w-3 text-amber-500 mt-0.5 shrink-0" />
                                    <span className="text-[11px] text-amber-600 dark:text-amber-400">{rec.listing_tip}</span>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

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
              <Card className="border-primary/20 bg-card/50">
                <CardContent className="space-y-3 p-4">
                  <div>
                    <p className="font-medium">Find Any Product</p>
                    <p className="text-xs text-muted-foreground">
                      Search the entire Shopify store. The product does not need to appear in the priority 50.
                    </p>
                  </div>
                  <form
                    className="flex flex-col gap-2 sm:flex-row"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void fetchShopifyProducts(null, false, productSearch);
                    }}
                  >
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="search"
                        value={productSearch}
                        onChange={(event) => setProductSearch(event.target.value)}
                        placeholder="Product title, SKU, handle, or ID"
                        className="h-11 w-full rounded-md border border-input bg-background pl-10 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                    <Button
                      type="submit"
                      className="h-11"
                      disabled={!selectedShopifyConnectionId || !productSearch.trim() || shopifyLoading}
                    >
                      Find Product
                    </Button>
                    {productSearch && (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11"
                        onClick={() => {
                          setProductSearch("");
                          setActiveProductSearch("");
                          void fetchShopifyProducts(null, false);
                        }}
                      >
                        Return to Priority Queue
                      </Button>
                    )}
                  </form>
                </CardContent>
              </Card>

              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {selectedShopifyConnectionId
                    ? activeProductSearch
                      ? `${shopifyProducts.length} matching products`
                      : `${shopifyProducts.length} priority products`
                    : "Select a store."}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void fetchShopifyProducts(null, false, productSearch)}
                  disabled={!selectedShopifyConnectionId}
                >
                  Refresh
                </Button>
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
        </div>
      )}
    </div>
  );
}
