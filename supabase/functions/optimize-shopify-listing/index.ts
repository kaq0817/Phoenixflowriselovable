import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";
import {
  normalizeShopifySuggestions,
  type ShopifyProductLike,
  type ShopifySuggestionShape,
  type ShopifyVariantLike,
} from "../_shared/listingValidators.ts";
import { getShopifyApiVersion } from "../_shared/shopify.ts";
import {
  getGoogleTrendsMulti,
  formatTrendsForPrompt,
  extractTrendSeeds,
} from "../_shared/googleTrends.ts";

const SHOPIFY_API_VERSION = getShopifyApiVersion();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

interface GeminiFunctionCallPart {
  functionCall?: {
    name?: string;
    args?: ShopifySuggestionShape;
  };
}

async function fetchImageBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/jpeg";
    const mimeType = contentType.split(";")[0].trim();
    if (!mimeType.startsWith("image/")) return null;
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > 800 * 1024) return null; // skip >800KB images — keeps memory well under limit
    const bytes = new Uint8Array(buffer);
    // Chunked conversion — avoids building one massive string in memory
    const CHUNK = 8192;
    let binary = "";
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return { data: btoa(binary), mimeType };
  } catch {
    return null;
  }
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// Remove <img> tags hosted on third-party supplier domains (CJDropshipping, AliExpress, etc.)
// These URLs break after the supplier relationship ends and expose the sourcing origin.
const SUPPLIER_IMG_RE = /<img[^>]+src=["'][^"']*(?:cjdropshipping\.com|alicdn\.com|aliexpress\.com|ae\d+\.alicdn|dhgate\.com|ebayimg\.com)[^"']*["'][^>]*>/gi;

function stripSupplierImages(html: string): string {
  return html.replace(SUPPLIER_IMG_RE, "").replace(/\s{2,}/g, " ").trim();
}

// Known supplier/POD boilerplate phrases — any match = supplier template copy
const SUPPLIER_BOILERPLATE_RE = [
  /bring(?:ing)? you a new sense of atmosphere/i,
  /ideal creative gift/i,
  /professionally designed patterns? prints?/i,
  /attract the attention of guests/i,
  /leave a deep impression/i,
  /enhance your personal taste/i,
  /vivid and interesting colors and patterns/i,
  /use glue or hook install/i,
  /upload your (?:own )?images?/i,
  /enter the text\s*\/logos?/i,
  /customize with any picture/i,
  /eye-catching decor/i,
  /exquisite canvas wall art/i,
  /your design/i,
];

// Detect machine-translated/dropship/POD boilerplate
function isDropshipContent(html: string): boolean {
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!text || text.length < 50) return false;

  // Asterisk-bullet format: "* Material :" — distinctive supplier/POD template
  if (/\*\s+\w[\w\s]*\s*:/.test(text)) return true;

  // Known supplier boilerplate phrases
  if (SUPPLIER_BOILERPLATE_RE.some((re) => re.test(text))) return true;

  // >60% Title Cased words = machine-translated
  const words = text.split(/\s+/).filter((w) => w.length > 3);
  if (words.length < 5) return false;
  const titleCasedCount = words.filter((w) => /^[A-Z][a-z]/.test(w)).length;
  return titleCasedCount / words.length > 0.6;
}

// Extract only factual specs from supplier HTML so the AI can't echo back boilerplate.
// Returns a clean plain-text spec list (dimensions, material, care instructions only).
function extractSpecsFromSupplierHtml(html: string): string {
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s{2,}/g, " ").trim();
  const specLines: string[] = [];
  // Split on asterisk bullets or sentence boundaries
  const segments = text.split(/\*\s+|\.\s+(?=[A-Z])/);
  for (const seg of segments) {
    const clean = seg.trim().replace(/\s+/g, " ");
    // Keep only lines that look like factual specs (contain a measurement, material word, or spec label)
    if (/\b(material|size|dimension|inch|cm|color|weight|hang|mount|wash|care|clean|wipe)\b/i.test(clean) && clean.length > 5 && clean.length < 200) {
      // Strip the label prefix "Material :" → keep "Material: ..."
      specLines.push(clean.replace(/^[\w\s]+\s*:\s*/, (m) => m.trim()));
    }
  }
  return specLines.length > 0
    ? "EXTRACTED SPECS (boilerplate removed — use these facts only, write everything else from images):\n" + specLines.map((l) => `- ${l}`).join("\n")
    : "";
}

const FALLBACK_SPAM_RE = /\b(free shipping|shipped in (us|usa)|made in (the )?usa|best seller|on sale|discount|cheap|wholesale|sunflower|inspirational quotes|wall decor for bedroom|!\s*$)/gi;
const FALLBACK_BRAND_RE = /\b(iron phoenix ghg|iron phoenix|our phoenix rise|go hard gaming|ghg|phoenix flow)\b/gi;

function buildFallbackSuggestions(product: ShopifyProductLike): ShopifySuggestionShape {
  // At minimum clean the title — strip spam keywords, brand names, promo noise, and truncate
  let title = (product.title || "Product")
    .replace(FALLBACK_SPAM_RE, "")
    .replace(FALLBACK_BRAND_RE, "")
    .replace(/[!?]+$/, "")           // trailing punctuation
    .replace(/\s{2,}/g, " ")
    .trim();
  // Truncate at word boundary to 60 chars (GMC limit)
  if (title.length > 60) {
    title = title.slice(0, 60).replace(/\s+\S*$/, "").trim();
  }
  if (!title || title.length < 3) title = product.product_type || "Product";

  const seoTitle = title.slice(0, 60).trim();
  const cleanBody = stripHtml(stripSupplierImages(product.body_html || ""));
  const seoDescription = cleanBody.length >= 50 ? cleanBody.slice(0, 155).trim() : "";

  const tagParts = [
    product.product_type,
    ...String(product.title || "")
      .replace(FALLBACK_SPAM_RE, "")
      .split(/[,|/]/)
      .map((part) => part.trim()),
  ]
    .filter((p) => p && String(p).length > 2)
    .map((part) => String(part));

  const tags = Array.from(new Set(tagParts)).slice(0, 12).join(", ");

  return {
    title,
    body_html: stripSupplierImages(product.body_html || "") || `<p>${title}</p>`,
    seo_title: seoTitle,
    seo_description: seoDescription,
    product_type: product.product_type || "",
    tags,
    variant_suggestions: "",
    url_handle: product.handle || "",
    faq_json: "[]",
    reasoning: "⚠️ AI QUOTA EXCEEDED — this is a basic cleanup only, not a full AI optimization. Try again in a few minutes when quota resets.",
  };
}

function buildFallbackImageAlts(product: ShopifyProductLike, storeName: string): string {
  // 1. Initial cleanup of the title
  let safeTitle = (product.title || "Product Display").trim() || "Product Display";

  // 2. Remove Internal/Niche Brand references (Scrubbing Iron Phoenix & Phoenix Rise)
  // We use a clean regex to catch your specific internal niches without breaking the string
  const internalNiches = /Our Phoenix Rise|Iron Phoenix GHG|Go Hard Gaming/gi;
  safeTitle = safeTitle.replace(internalNiches, "").replace(/\s{2,}/g, " ").trim();

  // 3. Remove Promotional/GMC-Banned phrases (Standard SEO Compliance)
  const promoPhrases = /(FREE SHIPPING|SALE|NEW|100%|BEST|HOT|DEAL|DISCOUNT|OFFER|PROMO|GUARANTEED|CHEAP)/gi;
  safeTitle = safeTitle.replace(promoPhrases, "").replace(/\s{2,}/g, " ").trim();

  // 4. Final Character Sanitize
  safeTitle = safeTitle.replace(/["'“”‘’•–—|]/g, "").replace(/\s{2,}/g, " ").trim();
  safeTitle = safeTitle.replace(/^[-|\s]+|[-|\s]+$/g, "");

  // 5. Fallback if the scrubbing left the title empty
  if (!safeTitle || safeTitle.length < 3) safeTitle = "Product Overview";

  const safeStore = (storeName || "Store").trim();

  // 6. Generate the Alt Text objects
  const entries = (product.images || [])
    .filter((img) => typeof img.id === "number")
    .map((img, idx) => {
      const detail = idx === 0 ? "Main Perspective" : `Detailed View ${idx + 1}`;
      
      // Constructing the final Alt text: [Product] [View] | [Customer Store Name]
      // This follows the Phoenix Flow optimization standard for image SEO
      const alt = `${safeTitle} ${detail} | ${safeStore}`
        .replace(/\s{2,}/g, " ")
        .slice(0, 125) // Stay under the 125 character accessibility limit
        .trim();
        
      return { image_id: img.id, alt };
    });

  // Note: Ensure this returns the stringified entries if your API expects a string
  return JSON.stringify(entries);
}

function domainToStoreName(domain: string | null | undefined): string {
  if (!domain) return "";
  // myshopify slugs are machine-generated IDs — useless as store names
  if (/\.myshopify\.com$/i.test(domain)) return "";
  // Known store domains mapped to their correct public-facing store names
  if (/ourphoenixrise/i.test(domain)) return "Our Phoenix Rise";
  if (/ironphoenixghg/i.test(domain)) return "Iron Phoenix GHG";
  // Generic fallback for any other custom domain
  return domain
    .replace(/\.[a-z]{2,}(\.[a-z]{2,})?$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    const { product: rawProduct, connectionId, productContext } = await req.json() as { product?: ShopifyProductLike & { id?: number }; connectionId?: string; productContext?: string };
    let product: ShopifyProductLike & { id?: number } = rawProduct ?? {};

    if (!rawProduct) {
      return new Response(JSON.stringify({ error: "No product provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Usage gating (50/month)
    let storeName = "";
    let shopDomain = "";
    let shopAccessToken = "";

    if (connectionId) {
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false } }
      );

      const { data: conn, error: connErr } = await supabaseAdmin
        .from("store_connections")
        .select("id, optimizer_runs, optimizer_period_start, shop_name, shop_domain, access_token")
        .eq("id", connectionId)
        .eq("user_id", userData.user.id)
        .single();

      if (!connErr && conn) {
        const { data: isAdmin } = await supabaseAdmin.rpc("has_role", { _user_id: userData.user.id, _role: "admin" });

        if (!isAdmin) {
          const { data: profile } = await supabaseAdmin
            .from("profiles")
            .select("subscription_status, free_runs")
            .eq("id", userData.user.id)
            .single();

          const isSubscribed = profile?.subscription_status === "active" || profile?.subscription_status === "trialing";

          if (!isSubscribed) {
            const freeRunsUsed = profile?.free_runs ?? 0;
            if (freeRunsUsed >= 5) {
              return new Response(JSON.stringify({ error: "free_limit_reached" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }
            await supabaseAdmin.from("profiles").update({ free_runs: freeRunsUsed + 1 }).eq("id", userData.user.id);
          } else {
            const periodStart = new Date(conn.optimizer_period_start);
            const now = new Date();
            const daysSince = (now.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24);
            if (daysSince >= 30) {
              await supabaseAdmin.from("store_connections").update({ optimizer_runs: 1, optimizer_period_start: now.toISOString() }).eq("id", connectionId);
            } else if (conn.optimizer_runs >= 50) {
              return new Response(JSON.stringify({ error: "Monthly limit reached" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            } else {
              await supabaseAdmin.from("store_connections").update({ optimizer_runs: conn.optimizer_runs + 1 }).eq("id", connectionId);
            }
          }
        }
        // Domain-first: custom domain tells us which store this actually is.
        // shop_name is often the DBA ("Iron Phoenix GHG") for both stores — unreliable.
        storeName = domainToStoreName(conn.shop_domain) || conn.shop_name || "";
        shopDomain = conn.shop_domain || "";
        shopAccessToken = conn.access_token || "";
      }
    }

    // Fetch the full product, metafields, and collections in parallel
    const collectionNames: string[] = [];
    if (shopDomain && shopAccessToken && product.id) {
      try {
        const [productRes, metafieldRes, customColRes, smartColRes] = await Promise.all([
          fetch(
            `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/products/${product.id}.json`,
            { headers: { "X-Shopify-Access-Token": shopAccessToken } }
          ),
          fetch(
            `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/products/${product.id}/metafields.json`,
            { headers: { "X-Shopify-Access-Token": shopAccessToken } }
          ),
          fetch(
            `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/custom_collections.json?product_id=${product.id}`,
            { headers: { "X-Shopify-Access-Token": shopAccessToken } }
          ),
          fetch(
            `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/smart_collections.json?product_id=${product.id}`,
            { headers: { "X-Shopify-Access-Token": shopAccessToken } }
          ),
        ]);

        if (productRes.ok) {
          const fullData = await productRes.json();
          const fresh = fullData.product as ShopifyProductLike;
          product = { ...product, ...fresh };
        }

        if (metafieldRes.ok) {
          const mfData = await metafieldRes.json();
          const metafields: { namespace: string; key: string; value: string }[] = mfData.metafields || [];
          const titleTag = metafields.find((m) => m.namespace === "global" && m.key === "title_tag");
          const descTag = metafields.find((m) => m.namespace === "global" && m.key === "description_tag");
          if (titleTag) product = { ...product, metafields_global_title_tag: titleTag.value };
          if (descTag) product = { ...product, metafields_global_description_tag: descTag.value };
        }

        if (customColRes.ok) {
          const ccData = await customColRes.json();
          const names: string[] = (ccData.custom_collections || []).map((c: { title: string }) => c.title);
          collectionNames.push(...names);
        }
        if (smartColRes.ok) {
          const scData = await smartColRes.json();
          const names: string[] = (scData.smart_collections || []).map((c: { title: string }) => c.title);
          collectionNames.push(...names);
        }
      } catch (fetchErr) {
        console.error("Fresh product fetch failed, using client-provided data:", fetchErr);
      }
    }

    const variants = product.variants || [];

    // ── Variant / bundle analysis ──────────────────────────────────────────
    const option1Values = [...new Set(variants.map((v: ShopifyVariantLike) => (v.option1 || "").trim()).filter(Boolean))];
    const option2Values = [...new Set(variants.map((v: ShopifyVariantLike) => (v.option2 || "").trim()).filter(Boolean))];
    const sizePattern = /^(xxs|xs|s|m|l|xl|2xl|xxl|3xl|xxxl|4xl|5xl|6xl|one\s*size|os|free\s*size|\d+(\.\d+)?"?\s*(x\s*\d+)?)$/i;

    // Detect "choice bundle" — product title uses or/and/vs to signal multiple distinct item types
    const productTitle = product.title || "";
    const choiceBundlePattern = /\b(or|and|\/|\||\bvs\.?\b|\bchoice\b|\bpick\b|\bselect\b)\b/i;
    const isBundleByTitle = choiceBundlePattern.test(productTitle);

    // Detect distinct item types in option values (leggings, hoodie, crop top, tee, etc.)
    const garmentWords = /\b(legging|hoodie|sweatshirt|hoodie|tee|t-shirt|crop|top|jogger|short|jacket|cardigan|tank|dress|skirt|pullover|zip|vest|coat|pant|bra|bodysuit|swimsuit|bikini|brief|thong|sock|hat|cap|beanie|glove|scarf|bag|tote|mug|tumbler|poster|print|canvas|pillow|blanket|throw|ornament|keychain|charm|necklace|ring|bracelet|earring)s?\b/i;
    const option2HasGarments = option2Values.filter(v => garmentWords.test(v));
    const option1HasGarments = option1Values.filter(v => garmentWords.test(v));

    // Pick which axis has the item-type dimension
    const itemTypeValues = option1HasGarments.length >= 2 ? option1Values
      : option2HasGarments.length >= 2 ? option2Values
      : [];
    const isBundle = isBundleByTitle || itemTypeValues.length >= 2;

    // Distinct designs = option axis has 3+ non-size, non-garment values (poses, themes, colors)
    const option1IsSize = option1Values.every(v => sizePattern.test(v));
    const option2IsSize = option2Values.every(v => sizePattern.test(v));
    const designAxis = !option1IsSize && option1HasGarments.length === 0 ? option1Values
      : !option2IsSize && option2HasGarments.length === 0 ? option2Values
      : [];
    const hasDistinctDesigns = designAxis.length >= 3;

    const variantInfo = variants.map((v: ShopifyVariantLike) =>
      `${v.title || "Default"} - $${v.price || "0.00"} (${v.inventory_quantity || 0} in stock)`,
    ).join("\n");

    // Build the variant/bundle warning block injected into the AI prompt
    let variantDesignSummary = "";
    if (isBundle) {
      const itemList = itemTypeValues.length >= 2 ? itemTypeValues.join(", ") : productTitle;
      variantDesignSummary = `\n🚨 BUNDLE / MULTI-ITEM PRODUCT — CRITICAL RULES:\n` +
        `This listing sells ${itemTypeValues.length >= 2 ? itemTypeValues.length : "multiple"} DIFFERENT item types (${itemList}). ` +
        `This is NOT a single product — it is a choice bundle where the customer picks which item they want.\n` +
        `TITLE RULE: The optimized title MUST include ALL item types. Do NOT reduce to just one. ` +
        `Format example: "Meditation Lotus Leggings, Crop Top & Hoodie Blue Black XS-2XL". ` +
        `Use ", " and "&" to list them — not "or" (Shopify/GMC prefers "&" over "or" in titles).\n` +
        `DESCRIPTION RULE: Describe all ${itemTypeValues.length >= 2 ? itemTypeValues.length : ""} item types. ` +
        `Open with the set, then give each item its own paragraph with its specific benefits.\n` +
        `SEO DESCRIPTION RULE: Cover the full bundle. Example: "Complete your yoga wardrobe with this meditation lotus set — available as leggings, a crop top, or a hoodie in blue and black.".\n` +
        `TAGS RULE: Generate tags for EVERY item type, not just one.\n` +
        `variant_suggestions: Generate one entry per item type with its own primary keyword.`;
    } else if (hasDistinctDesigns) {
      variantDesignSummary = `\n⚠️ MULTI-DESIGN PRODUCT: This product has ${designAxis.length} distinct design/style variants (${designAxis.slice(0, 8).join(", ")}${designAxis.length > 8 ? ` ... +${designAxis.length - 8} more` : ""}). ` +
        `Write the SEO description to cover this as a product RANGE — not one specific design. ` +
        `Populate variant_suggestions with per-design keyword recs.`;
    } else if (option2Values.length >= 2 && !option2IsSize && option2HasGarments.length === 0) {
      variantDesignSummary = `\n⚠️ MULTI-STYLE PRODUCT: This product has ${option2Values.length} style options (${option2Values.slice(0, 6).join(", ")}). Write the SEO description to cover the range. Populate variant_suggestions.`;
    }

    // Preserve inclusive apparel sizing. A mixed standard-to-extended range is one
    // product range, not a reason to relabel the item as a plus-size product.
    const apparelSizeValues = option1IsSize ? option1Values : option2IsSize ? option2Values : [];
    const hasStandardApparelSize = apparelSizeValues.some((value) => /^(xxs|xs|s|m|l|xl)$/i.test(value));
    const hasExtendedApparelSize = apparelSizeValues.some((value) => /^(2xl|xxl|3xl|xxxl|4xl|5xl|6xl)$/i.test(value));
    if (hasStandardApparelSize && hasExtendedApparelSize) {
      variantDesignSummary += `\n🚨 INCLUSIVE SIZE RANGE — CRITICAL RULES:\n` +
        `This product serves the complete size range: ${apparelSizeValues.join(", ")}. ` +
        `Market it to every available size as one inclusive product. State the complete range naturally in apparel titles and useful fit copy. ` +
        `NEVER call it "plus size", "standard size", "straight size", "regular size", "skinny", "curvy", or use any other body-type label. ` +
        `Do not imply one part of the range is the intended customer. Occasions and styling ideas are welcome when supported by the product.`;
    }

    const productImages = product.images || [];
    const imageInfo = productImages.length > 0
      ? `\nImages (${productImages.length}):\n${productImages.map((img, i) => `Image ${i + 1} (id: ${img.id}, position: ${img.position ?? i + 1}): current_alt="${img.alt || "none"}" url="${img.src}"`).join("\n")}`
      : "";

    // Fetch images in parallel for multimodal analysis (cap at 5 images)
    const imageResults = await Promise.all(
      productImages.slice(0, 3).filter((img) => img.src).map((img) => fetchImageBase64(img.src!))
    );
    const imageParts = imageResults
      .filter((r): r is { data: string; mimeType: string } => r !== null)
      .map((r) => ({ inlineData: { mimeType: r.mimeType, data: r.data } }));

    // ── Google Trends: real buyer search signal ─────────────────────────────
    const trendSeeds = extractTrendSeeds(
      product.product_type ?? "",
      product.title ?? "",
    );
    const trendsResults = await getGoogleTrendsMulti(trendSeeds, "US");
    const trendsBlock = formatTrendsForPrompt(trendsResults);
    // ─────────────────────────────────────────────────────────────────────────

    const systemPrompt = `You are a high-conviction sales voice. Your only job is to make this product feel like the obvious answer to the shopper's search. You find the exact words a real buyer types into Google when they are ready to spend money, and you build every field around those words so this product appears in front of that buyer and they click. You work within GMC compliance rules — not because rules matter, but because breaking them gets the product suspended and suspended products don't sell. You do not write for Google's approval. You write for the human who needs this item in their life and doesn't know it yet. Every title, every sentence, every tag is a door that opens when the right buyer searches. Your job is to make that door feel impossible to ignore and impossible to walk past.

KEYWORD TARGETING (do this before anything else):
Identify 3-5 keywords for this product that a buyer types when they are ready to purchase — not researching, not browsing, BUYING. Target keywords with estimated US monthly search volume between 500 and 5,000. This is the range where a newer store with low domain authority can actually rank — high-volume terms (25,000+) are locked up by Amazon, Wayfair, and established Etsy sellers. Avoid keywords under 200/month (no traffic) and over 10,000/month (too competitive to crack without backlinks). Favor 4-6 word hyper-specific phrases where the big players are not competing: "personalized gaming room metal wall sign", "custom name fleece blanket dad birthday gift" — not "wall art" or "blanket". The more specific the phrase, the lower the competition and the more buyer-ready the intent. Build every field below around these keywords.

SHOPIFY SEO RULES:
- TITLE: Descriptor-first product name only. Under 60 chars (GMC hard limit). No vendor/brand names. Format: [Descriptor] [Item Type] [Key Attribute if critical — e.g. color+size for apparel, Waterproof/Insulated for drinkware/outerwear]. Strip "Iron Phoenix GHG", "Iron Phoenix", "ghg", "| Iron Phoenix", or any store name. Example: "Block World Pixelated Travel Mug" or "Aurora Flow Gradient Athletic Shorts Black XS-4XL". BUNDLE TITLE RULE: If the 🚨 BUNDLE warning is present above, the title MUST include ALL item types separated by ", " and "&". Example: "Meditation Lotus Leggings, Crop Top & Hoodie Blue Black". Collapsing a bundle to one item type is a critical error.
- PERSONALIZATION ATTRIBUTES (NEVER REMOVE): "Personalized", "Custom", "Custom Name", "Customizable" are PRODUCT ATTRIBUTES that buyers search for — they are NOT promotional words. If the product accepts a custom name, text, or design, the word "Personalized" or "Custom Name" MUST appear in the title. Removing these words from a personalizable product's title is an error. Research shows these terms increase click-through and conversion significantly.
- PERSONALIZED PRODUCTS — THE PERSONALIZATION IS THE STORY, NOT A FEATURE LISTED AMONG OTHERS: If this product accepts a custom name, text, photo, or design, that is the emotional core of the body_html description, not a bullet point. Do not describe a personalizable pillow, blanket, mug, or sign the way you'd describe a plain one with "customization" tacked on as a spec. Instead, name the actual, specific reason a buyer reaches for THIS: a name that makes it theirs, a photo that makes it a keepsake, a phrase that makes it a gift instead of an object. Write the opening paragraph around what it means to the person receiving something with their own name/face/words on it — not around the material it's printed on. Be precise about who does what: the customer is buying a finished product and, at most, submits or picks what name/text/photo goes on it — this store does the actual printing/production. NEVER phrase it as if the customer does the customizing themselves (never "you customize it," never "personalize it yourself," never "add your own design" as if they're operating a tool) — say "send us the name" or "printed with the name you choose" or "your photo, printed on it" instead. If the product also offers a non-personalized preset design as an alternative, the description must reflect that it's a choice between the two, not flatten it into only one option.
- SELLER DIRECTION OVERRIDES: If a seller direction is provided in the prompt, the occasion/season/use case it specifies MUST appear in the title. Example: seller says "Christmas tablecloth" → title must say "Christmas" not "birthday" or "thanksgiving". Multi-occasion products should lead with the seller-specified primary use; other occasions belong in the description body only.
- TABLE LINEN IDENTIFICATION (GMC rejects mismatched product types): A table runner is a long narrow strip down the center of a table. A tablecloth covers the entire table surface. ALWAYS check dimensions and shape: if the product is described as round (e.g. 60" round, 152.5cm round) it is a ROUND TABLECLOTH — never call it a "runner". If it is rectangular and narrow (e.g. 12"x72") it is a table runner. If it covers a full rectangular table it is a tablecloth. Use the correct term in the title, description, and product_type.
- BLANK SUBLIMATION CLAIMS (CRITICAL — always remove): This store NEVER sells blank sublimation stock for customers to print themselves. ALWAYS remove phrases like "upload your own image", "customize with any picture", "blank for sublimation", "DIY sublimation", "enter your text/logo to print yourself", "Your Design". These are supplier template copy that do not apply. Products may be sold as personalized (the store prints a design or name FOR the customer) — that is fine to describe. The distinction: "we print it for you" = valid. "buy this blank and print it yourself" = remove always.
- DESIGN NAMES — IMAGE IS THE ONLY SOURCE OF TRUTH: The product title and existing description may contain completely wrong design names (suppliers stuff popular keywords like "Sunflower", "Butterfly", "Inspirational Quotes" into titles to game search — these are often lies). You MUST visually identify the actual design from the product images and use THAT. If the image shows a gaming controller, title it as gaming wall art. If it shows a Christmas tree, title it as Christmas decor. NEVER use a design name from the title or description unless the image confirms it. If you cannot clearly identify the design from the images, write generic specs-only copy with no design name at all.
- INSPIRED-BY DESIGNS — NEVER USE THIRD-PARTY IP NAMES: If a product is visually inspired by a video game, movie, TV show, cartoon, or any other copyrighted brand (e.g. characters that look like Among Us crewmates, Minecraft blocks, Pokemon, Star Wars, etc.), you MUST describe what you see generically — NEVER write the actual game/franchise/brand name unless the seller has explicitly stated it is officially licensed. Use descriptive language instead: "space crewmate character" not "Among Us", "block pixel character" not "Minecraft Steve", "round blob character" not "Kirby". Using trademarked names on unlicensed fan-art products is an IP violation.
- SELLER TITLE AS IP SHIELD: If the seller's existing title already uses generic inspired-by language (e.g. "Cartoon Space Crew", "Block World Character", "Galaxy Warrior") that deliberately avoids a franchise name, that language MUST be preserved as-is. Do not replace the seller's safe phrasing with the IP name you recognized visually. The seller chose generic language on purpose — overriding it with a trademark is an error.
- SPAM TITLE DETECTION: If the existing title is stuffed with promotional phrases ("Made in the USA", "Free Shipping", "Shipped in US", "Best", "Sale", etc.) rather than describing the actual product, IGNORE the title entirely. Instead derive the real product name from: (1) the product images — visually identify the item, its design/theme, and any personalization (e.g. a custom name printed on it); (2) the product description body; (3) variant names. A personalized item should say "Personalized" or "Custom Name" in the title. Example: a blanket with a custom astronaut design and a name on it → "Personalized Astronaut Flannel Blanket" not "Made in USA Blanket Free Shipping".
- PRIMARY KEYWORD STRATEGY (do this first, before writing anything else): Identify ONE primary keyword for this product — the exact phrase a real shopper would type into Google to find it. Choose a specific long-tail phrase (3-5 words) that balances search intent with realistic competition. Example: "cartoon space crew metal wall sign" beats "wall art" (too broad, impossible to rank) and "among us inspired iron wall decor" (too niche, no volume). Once chosen, this keyword MUST appear: (1) at the very START of the seo_title, (2) in the first sentence of the seo_description, (3) in the <h3> or opening <p> of body_html, (4) in the url_handle. Supporting secondary keywords (2-3 related phrases) should appear naturally in the body bullets and closing paragraph. This is the single most important thing you do — a page optimized around one specific keyword outranks a page that mentions many keywords weakly.
- SEO TITLE (seo_title): Max 60 chars. START with the primary keyword — Google weights the beginning of the title tag most heavily. Use | as the only separator. ${storeName ? `Append "| ${storeName}" only if it fits within 60 chars.` : "Do not append any store name suffix."} Never use "Iron Phoenix GHG" anywhere. Example: "Cartoon Space Crew Metal Wall Sign | Our Phoenix Rise" not "Our Phoenix Rise | Cartoon Space Crew Wall Art".
- META DESCRIPTION (seo_description): Target 145-155 characters. Open with the primary keyword in the first sentence — this is what Google bolds in search results and what drives click-through. Then add a specific detail or use case. End at a natural sentence boundary within the character range. No promo fluff. No hyphens as separators.
- DESCRIPTION (body_html): You are a salesperson standing next to this product, talking to one real person about why THEY need it. Not a copywriter filling in a template — someone who knows this item cold and explains, in plain conversational language, the specific reason it solves this buyer's problem or fits their life. Cut anything that doesn't serve that: no filler sentences that exist to hold a keyword, no generic "perfect for any occasion" padding, no spec listed just because it's known.
HARD-SELL TEST — ASSUME THE BUYER IS NOT ALREADY CONVINCED: This description must earn the purchase instead of assuming the item is easy to sell. Before writing, privately identify (1) the buyer's real situation, desire, frustration, or identity, (2) the most likely reason they would hesitate or think they already own something similar, (3) what THIS exact item honestly adds or changes, and (4) the specific reason it deserves to be chosen now. Answer those points naturally inside the copy without labeling them. Every paragraph must move the buyer from "I do not need another one" toward "this fits me, solves that, makes the right gift, or belongs here."
NEW-CAR SALESPERSON STANDARD: Sell the ownership experience and payoff, not a pile of components. A good car salesperson does not stop at listing four tires; translate every verified feature you mention into a concrete buyer benefit and a believable moment of use. Match the size of the promise to the product. A novelty shirt may offer identity, humor, connection, gifting, or a reliable conversation starter — do not pretend it transforms a life. A useful product may remove a real annoyance — name that annoyance clearly when the product data supports it.
OBJECTION HANDLING IS REQUIRED: Naturally answer at least one likely buyer objection that fits this specific item, such as "I already have one," "where would I use it," "who would I give it to," "does this actually feel like me," or "is this gift specific enough?" Do not write the objection as a fake FAQ or use manipulative pressure. Let the product's verified design, use, personalization, fit, dimensions, or function answer it.
CREATE A REAL REASON TO WANT IT — NEVER A FAKE REASON: The honest need may be practical, but it may also be identity, humor, gifting, collecting, remembering someone, completing a room, or finishing an outfit. That is valid sales value. Never invent scarcity, urgency, discounts, popularity, reviews, superiority, durability, comfort, emotional outcomes, or product performance that the supplied facts and images do not prove.
DESIGN SELLS THE PRODUCT, NOT THE MATERIAL: If this product's appeal comes from a printed design, graphic, quote, joke, or theme (a mug, shirt, ornament, sticker, wall art, tumbler, etc.), the material — ceramic, cotton, metal — is NOT the selling point. The design is. Lead with why THAT design is cute, funny, striking, or exactly right for the person who'd want it. Name the specific identity or interest it speaks to (e.g. a science-humor DNA quote mug speaks to someone who'd call themselves a genetics nerd or lab-coat gift-giver) — call that match out directly instead of describing the object in the abstract.
QUOTE THE ACTUAL TEXT — NEVER PARAPHRASE AROUND IT: If the image shows printed words, a joke, a quote, or a phrase, you MUST read it and quote it verbatim in the description (in quotation marks). Never describe it vaguely instead ("a funny quote about X", "a clever saying", "a witty phrase") — that is a tell that you either didn't read the image closely or are avoiding committing to specifics, and it reads as generic AI filler. A buyer decides to buy based on the actual words on the product — withholding them is the opposite of selling it. If the text is genuinely illegible in the image, say so explicitly in reasoning rather than inventing vague language to paper over it.
IF THE PRODUCT HAS NO PRINTED WORDS AT ALL, DO NOT INVENT A QUOTE: If there is no actual printed phrase, joke, or quote on the product, do not make one up and do not put quotation marks around any phrase in the description — quotation marks are reserved strictly for real printed text you can see on the product. Wrapping an invented tagline in quotation marks to make it look like a genuine product quote reads as manipulative to both buyers and Google (fake-quote stuffing is a spam signal that gets listings suppressed, not boosted).
COLLECTOR ANGLE: If the design is part of a themed, niche, or ongoing series (a joke format, a fandom, a quote line, a collectible set), speak to the person who collects these — invite them to add it to what they already have. Enthusiastic, direct-address lines are welcome and encouraged here: "look no further," "add this to your collection," "if this is your first or your tenth, it earns its spot" — say them like a real person hyping something they love, not a recap of the bullet points.
OUTPUT MUST BE VALID HTML — this value is rendered directly in Shopify. Use this exact structure: (A) <h3>[Product name with primary keyword]</h3> (B) <p>[3-4 sentences, roughly 50-70 words. Put the buyer in ONE concrete, physically plausible moment — already wearing it on a walk, reaching for it at 6am, the exact scene where this item earns its place — and let the design/theme do the talking from inside that scene. Do not open with an abstract appeal to a feeling or identity in general ("Embrace your devotion to...", "Show your love for...", "Celebrate your passion for..." are all banned — they describe a category of person, not this moment). Lead with the design/theme appeal per the rule above when it applies. Lead with the primary keyword naturally, worked into the scene, not tacked on. Example: "You're heading out the door before the dog even finishes stretching, and this hoodie is already halfway to becoming a uniform." Not "Introducing our amazing new hoodie." Not "Embrace your devotion to your furry best friend with this essential hoodie." Don't stop at one sentence — stay in the scene for a beat longer and add one more concrete, sensory detail before moving on.]</p> (C) <ul><li>[Benefit-driven, NOT a spec sheet — each bullet is one to two punchy sentences (roughly 12-20 words) that sell why the buyer looks or feels good using THIS item, the way a confident brand would say it out loud, not a catalog listing it. Banned as bullet content: raw material/fabric names, blend percentages, brand/model numbers (e.g. "Gildan 18500"), certification names (e.g. "OEKO-TEX-certified dyes"), or any fact that reads like it was copied from a supplier spec sheet — those belong in materials/reasoning, never in a bullet. A bullet is only allowed if you could say it out loud to a friend without it turning into a materials lecture: the design/phrase and its impact, the personalization, the fit and how it feels/looks, real functional payoffs (e.g. "The kangaroo pocket is deep enough for your phone and keeps your hands warm on the walk there and back" is fine — "Gildan 18500 heavy blend fabric" is not). If a bullet can't be phrased as a payoff without leaning on a spec, cut it rather than dressing the spec up.]</li><li>...</li></ul> — 4-6 bullets, NO section labels like "Features:" inside the bullets (D) <p>[3-4 sentences, roughly 60-90 words. Talk through the moment this product earns its place: a season, a gift, a routine, a feeling, a collection it joins. Weave in a secondary keyword. Write it the way you'd explain it to a friend standing in front of you, not the way a listing page explains it — give it real substance, not one thin sentence.]</p> (E) <p>[1-2 sentences, roughly 20-35 words. The honest, specific, enthusiastic reason they need this. A direct-address collector hook fits well here.]</p>
HUMANIZED VOICE — BANNED PATTERNS: never use "elevate your", "in today's world", "game-changer", "unleash", "discover the", "embrace your", "show your love for", "celebrate your", "designed for comfort and style", or any generic filler phrase that could apply to literally any product. Enthusiastic hype that's specific to THIS design ("look no further," "add this to your collection") is good — bland hype that's specific to nothing is not. Vary sentence length — short and punchy next to longer ones, like real speech, not evenly-sized marketing sentences. Before finishing, read it back and ask: would a real person say this out loud to a customer, or does it sound like AI wrote it? If it sounds like AI, rewrite it.
RULES: (1) LENGTH IS NOT OPTIONAL: the full body_html (paragraphs B, C, D, E combined, not counting the h3) must be 220-300 words / roughly 1400-1900 characters. This is a floor, not a suggestion — before finalizing, count the words. If you're under 220, you are missing required substance (re-read the per-section word counts above and add the missing detail to whichever section is thinnest) — never pad with filler adjectives or repeated phrases to hit the count, add one more real, specific detail instead. (2) No hollow hype that isn't tied to something specific about this product. (3) No section labels or headers inside the copy — no "Key Features:", no "Benefits:". (4) Carry every real fact (material, dimensions, care, fit) from the existing description forward SOMEWHERE in the output — but never as a raw bullet per the bullet rule above. Fold each fact into paragraph B, D, or E behind the benefit it produces (e.g. don't say "cotton-poly blend", say "soft enough to sleep in" — the fact justifies the claim, it doesn't replace it). No fact should be dropped, but no fact should appear un-translated either. (5) No <html>, <body>, <head> wrappers. No inline styles. No <img> tags. No markdown, no asterisks.
- TAGS: Generate 20-25 NEW buyer-intent tags only — do NOT re-list the existing product tags (we merge them automatically). Tags in Shopify create crawlable collection pages at /collections/all/[tag] — treat each tag as a mini landing page keyword. The primary keyword MUST appear as one of the tags verbatim. Mix tag lengths: 40% should be 3-5 word long-tail phrases (highest conversion and easiest to rank), 40% should be 2-3 word mid-tail phrases, 20% can be single specific niche words. COLLECTION GUARANTEE: Include at least 1-2 tags matching the collection name's core keyword. Ask "would an actual shopper type this exact phrase into Google?" — if no, drop it. CRITICAL: Never split hyphenated terms. Never use competitor brand names, vendor names, "sale", "cheap", "new", or junk terms. Each individual tag max 255 chars.
- URL HANDLE: Hyphenated, lowercase, PRIMARY KEYWORD as the base, max 50 chars. Shorter is better — 3-5 words ideal. Example: "cartoon-space-crew-metal-wall-sign" not "cartoon-space-crew-iron-wall-sign-gaming-character-metal-wall-decor-art".
- PRODUCT PAGE FAQ METAFIELD: Return a valid JSON array string containing 4-6 objects in this exact format: [{"question":"...","answer":"..."}]. These appear directly on the Shopify product page, so every question must help a hesitant shopper decide whether to buy THIS exact item. Choose the 4-6 most useful questions from sizing or fit, dimensions, materials, care, personalization steps, design details, intended use, gift recipient, included items, compatibility, or variant differences — but ONLY when the supplied product facts support the answer. Include at least one purchase-objection question specific to the item, such as who it suits, where it fits into daily life, or what makes this design different. Answers must be direct, conversational, 1-3 short sentences, and complete enough to stand alone. Use the primary or a secondary keyword naturally where it genuinely fits. Never invent shipping times, return rules, guarantees, stock, discounts, reviews, durability, comfort, safety, performance, or care instructions. Do not repeat the same answer in different words. Do not include generic questions such as "Why will I love this?" If fewer than 4 facts are available, ask only the questions that can be answered truthfully rather than filling the list with guesses.
- VARIANT PLAYBOOK (variant_suggestions field — CRITICAL for multi-variant products): When this product has 3 or more variants with meaningfully different option values (e.g. different poses, designs, themes, colors, styles — NOT just size/price), you MUST populate variant_suggestions with a JSON array of per-variant recommendations. Each variant is its own SEO opportunity on Shopify because customers can search specifically for that style. Format:
[{"variant":"<variant title>","angle":"<1-sentence unique selling angle that distinguishes THIS variant from the others>","primary_keyword":"<the specific long-tail keyword a buyer types to find THIS exact variant — 3-6 words>","secondary_keywords":["<2-3 supporting keyword phrases>"],"listing_tip":"<one concrete action to improve search visibility for this variant — e.g. add variant-specific alt text, create a separate URL redirect, duplicate as standalone product>"},...]
Rules: Only include variants whose option values suggest a truly different buyer intent or search query. Skip variants that are just size/quantity differences of the same design — they share the same keyword. If all variants are truly the same product (just sizing), return an empty array []. Max 10 variants in the output. Each primary_keyword must be unique across variants.
- IMAGE ALT TEXT: Write alt text for EVERY image listed in the image list — not just the ones attached as photos. For images you can see visually, describe what you actually see. For images beyond the attached photos, write descriptive alt text based on the product name, type, and design theme. Rules: under 125 chars each; Format: "[Product Name] - [Color/Detail/Angle] | ${storeName || "store"}" (e.g. "Block World Pixelated Travel Mug - Matte Black Finish | Phoenix Rise"); CRITICAL: NEVER use "image of", "picture of", generic text like "product image 1", or the vendor/brand name "Iron Phoenix GHG"; include relevant niche keywords naturally before the pipe. NEVER include the store name BOTH in the descriptive part AND after the pipe — it appears exactly once, after the pipe only. NEVER use curly/smart quotes (" " ' ') — only plain straight quotes (" '). Your image_alts JSON array MUST have one entry per image id listed above. Return as a JSON-encoded string in image_alts: [{"image_id": <id>, "alt": "<text>"}].
- IMAGE FILENAMES: For every image, suggest a clean SEO-rich filename. Rules: all lowercase, hyphen-separated, no special chars, end in .webp; Format: "[clean-product-name]-[detail]-[store-slug].webp" where store-slug = "${storeName ? storeName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") : "store"}"; Image 1 = full product slug + store slug (e.g. "block-world-pixelated-travel-mug-phoenix-rise.webp"); Images 2+ = product slug + detail + store slug (e.g. "block-world-pixelated-travel-mug-handle-detail-phoenix-rise.webp"); NEVER use generic names like "image-1.webp", vendor names, or LLC suffixes. Return as a JSON-encoded string in image_filenames: [{"image_id": <id>, "filename": "<name>.webp"}].

GOOGLE MERCHANT CENTER COMPLIANCE (CRITICAL):
- APPAREL TITLES MUST include color and the complete available size range (e.g. "Black XS-4XL").
- INCLUSIVE SIZING: When apparel spans standard and extended sizes, market the whole range together. Never introduce "plus size", "standard size", "straight size", "regular size", "skinny", "curvy", or another body-type category in the title, SEO fields, description, tags, FAQ, image text, or reasoning. Use the exact range supplied by the variants instead. Only preserve a size-category term when the seller explicitly supplied it and the entire offered range belongs to that category.
- Do not discuss internal size-based costs or pricing strategy in customer-facing copy.
- NEVER use special characters (curly quotes, em dashes, symbols, Unicode, emojis).
- ONLY use plain ASCII: quotes (" "), hyphens (-), commas, periods, &, +, /.
- NO ALL CAPS (except USB/LED). NO promotional text ("FREE SHIPPING", "SALE").
- Meta descriptions (seo_description) must be factual with no exaggerated claims. The body_html product page description is separate — see its rules above.

FACEBOOK / META COMMERCE COMPLIANCE (CRITICAL — products must pass Facebook catalog review):
- NEVER include medical or health claims (e.g. "cures", "treats", "heals", "relieves pain", "therapeutic", "medical grade", "FDA approved", "anti-anxiety", "boosts immunity", "detox"). These trigger automatic Facebook rejection.
- NEVER reference prescription drugs, supplements claiming health benefits, or any before/after health outcomes.
- NEVER use claims about weight loss, muscle gain, or physical transformation.
- The seo_description meta field must describe WHAT the product IS — not health outcomes.
- Lifestyle context and identity-driven copy are fine ("the mug you reach for every morning", "the hoodie that makes the fit") — health outcome claims are not (no "cures", "treats", "heals" etc).`;

    // Strip supplier-hosted images from body before sending — those URLs break and expose sourcing
    const cleanedBodyHtml = stripSupplierImages(product.body_html || "");
    const hasExistingBody = cleanedBodyHtml.replace(/<[^>]*>/g, "").trim().length > 50;
    const bodyIsDropship = isDropshipContent(cleanedBodyHtml);

    const titleIsSpam = /made in (the )?usa|free shipping|shipped in (us|usa)|best seller|on sale|discount|cheap|wholesale/i.test(product.title || "");

    const collectionLine = collectionNames.length > 0
      ? `\nCollections this product belongs to: ${collectionNames.join(", ")} — your tags MUST include keywords matching these collection names.`
      : "";

    // When supplier/POD boilerplate is detected, replace the full HTML with specs-only
    // so the AI cannot echo back template phrases. The AI writes fresh from images + specs.
    const bodyForPrompt = bodyIsDropship
      ? (extractSpecsFromSupplierHtml(cleanedBodyHtml) || "No usable description — write from scratch using images, title, and variants.")
      : (cleanedBodyHtml || "No description provided — infer from title, type, and variants.");

    const descriptionInstruction = !hasExistingBody || bodyIsDropship
      ? "⚠️ SUPPLIER/POD TEMPLATE DETECTED: The description field above contains only extracted specs. Write the full body_html ENTIRELY from scratch — use the product images as your primary source for design, style, and identity. The spec facts (material, size) may appear in the description but all copy must be original."
      : "IMPORTANT: The existing description above contains real product data. Your body_html must retain all of it — restructure and expand, never discard specs.";

    const userPrompt = `Optimize this Shopify product:
${productContext ? `🎯 SELLER DIRECTION — this is the PRIMARY brief and overrides the existing description's multi-occasion language:\n"${productContext}"\nThe title MUST lead with this occasion/use case. Other occasions from the existing description may appear as secondary uses in the body only — never in the title or SEO fields.\n` : ""}Title: ${product.title || ""}${titleIsSpam ? "\n⚠️ WARNING: The title above is spam/SEO-stuffed with promotional text — it does NOT describe the product. IGNORE it. Derive the real product name from the seller direction above, images, and description." : ""}${collectionLine}

EXISTING PRODUCT DESCRIPTION (supplier images have been removed — do NOT add any <img> tags to body_html):
${bodyForPrompt}

Product Type: ${product.product_type || ""}
Vendor: ${product.vendor || ""}
Tags: ${product.tags || ""}
Variants:${variantDesignSummary}
${variantInfo}${imageInfo}

Current SEO Title: ${product.metafields_global_title_tag || ""}
Current SEO Description: ${product.metafields_global_description_tag || ""}
${descriptionInstruction}

Return all optimizations using the suggest_shopify_optimizations function.`;

    let suggestions: ShopifySuggestionShape | null = null;
    let geminiError = "";

    // Cost-controlled model cascade. The preview model is economical; the stable
    // Flash-Lite model protects production when a preview is retired or rate-limited.
    const GEMINI_MODELS = [
      "gemini-3-flash-preview",
      "gemini-3.5-flash-lite",
    ];

    // Images come FIRST so Gemini visually identifies the product before reading
    // any potentially incorrect supplier/template description text.
    const imageLeadParts = imageParts.length > 0
      ? [...imageParts, { text: "Examine the images above carefully — they are the authoritative source for product type, shape, design, and features. Now optimize based on the instructions and product data below:\n\n" + systemPrompt + "\n\n" + userPrompt }]
      : [{ text: systemPrompt + "\n\n" + userPrompt }];

    const geminiRequestBody = {
      contents: [{ role: "user", parts: imageLeadParts }],
      tools: [{
        functionDeclarations: [{
          name: "suggest_shopify_optimizations",
          description: "Return optimized Shopify product fields",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string" },
              body_html: { type: "string" },
              seo_title: { type: "string" },
              seo_description: { type: "string" },
              product_type: { type: "string" },
              tags: { type: "string" },
              variant_suggestions: { type: "string", description: "JSON array of per-variant SEO recs for products with 3+ meaningfully different variants (different designs/poses/themes, not just sizes). Format: [{\"variant\":\"Title\",\"angle\":\"unique selling angle\",\"primary_keyword\":\"specific long-tail keyword 3-6 words\",\"secondary_keywords\":[\"kw1\",\"kw2\"],\"listing_tip\":\"one action item\"}]. Return stringified empty array [] if variants only differ by size/quantity." },
              url_handle: { type: "string" },
              faq_json: { type: "string", description: "Stringified JSON array of 4-6 product-page FAQ objects: [{\"question\":\"buyer decision question\",\"answer\":\"1-3 short factual sentences\"}]. Use only supplied product facts." },
              collections_suggestion: { type: "string" },
              image_alts: { type: "string", description: "JSON array: [{\"image_id\": <id>, \"alt\": \"<text>\"}] — one entry per product image, max 125 chars per alt" },
              image_filenames: { type: "string", description: "JSON array: [{\"image_id\": <id>, \"filename\": \"<slug>.webp\"}] — one clean SEO filename per image, lowercase hyphenated, store-branded" },
              reasoning: { type: "string" },
            },
            required: ["title", "body_html", "seo_title", "seo_description", "product_type", "tags", "url_handle", "faq_json", "reasoning"],
          }
        }]
      }],
      toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["suggest_shopify_optimizations"] } },
      generationConfig: { maxOutputTokens: 8192, temperature: 0.4 },
    };

    if (GEMINI_API_KEY) {
      for (const model of GEMINI_MODELS) {
        try {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(geminiRequestBody) }
          );

          if (response.status === 429) {
            geminiError = `Model ${model} quota exceeded, trying fallback...`;
            console.warn(geminiError);
            continue; // try next model in cascade
          }

          if (response.ok) {
            const data = await response.json();
            const functionCall = data.candidates?.[0]?.content?.parts?.find((p: GeminiFunctionCallPart) => p.functionCall)?.functionCall;
            if (functionCall?.args) {
              suggestions = normalizeShopifySuggestions(product, functionCall.args);
              geminiError = ""; // clear any previous model errors
              break; // success — stop trying models
            } else {
              geminiError = `Gemini (${model}) returned no function call. Finish reason: ${data.candidates?.[0]?.finishReason || "unknown"}`;
            }
          } else {
            const errText = await response.text();
            geminiError = `Gemini API error ${response.status}: ${errText.slice(0, 200)}`;
            console.error("Gemini Error:", errText);
          }
        } catch (err) {
          geminiError = `Gemini request threw: ${err instanceof Error ? err.message : String(err)}`;
          console.error("Gemini Request Failed:", err);
        }
      }
    }

    // OpenAI gpt-4o-mini — lowest cost model, only runs if all Gemini models failed
    if (!suggestions && OPENAI_API_KEY) {
      try {
        const openAiMessages: Record<string, unknown>[] = [];

        // Images first (same principle — visual identification before text)
        if (imageParts.length > 0) {
          openAiMessages.push({
            role: "user",
            content: [
              ...imageParts.map((p, idx) => ({
                type: "image_url",
                // First image: "high" to read design details. Rest: "low" to save cost.
                image_url: { url: `data:${(p as {inlineData:{mimeType:string;data:string}}).inlineData.mimeType};base64,${(p as {inlineData:{mimeType:string;data:string}}).inlineData.data}`, detail: idx === 0 ? "high" : "low" },
              })),
              { type: "text", text: "Examine the product images above. Now optimize based on the instructions below." },
            ],
          });
        }
        openAiMessages.push({ role: "user", content: systemPrompt + "\n\n" + userPrompt });

        const oaRes = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_API_KEY}` },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: openAiMessages,
            max_tokens: 8192,
            tools: [{
              type: "function",
              function: {
                name: "suggest_shopify_optimizations",
                description: "Return optimized Shopify product fields",
                parameters: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    body_html: { type: "string" },
                    seo_title: { type: "string" },
                    seo_description: { type: "string" },
                    product_type: { type: "string" },
                    tags: { type: "string" },
                    variant_suggestions: { type: "string", description: "JSON array of per-variant SEO recs. Format: [{\"variant\":\"Title\",\"angle\":\"angle\",\"primary_keyword\":\"keyword\",\"secondary_keywords\":[\"kw\"],\"listing_tip\":\"tip\"}]. Empty array [] if variants differ only by size." },
                    url_handle: { type: "string" },
                    faq_json: { type: "string", description: "Stringified JSON array of 4-6 product-page FAQ objects: [{\"question\":\"buyer decision question\",\"answer\":\"1-3 short factual sentences\"}]. Use only supplied product facts." },
                    collections_suggestion: { type: "string" },
                    image_alts: { type: "string" },
                    image_filenames: { type: "string" },
                    reasoning: { type: "string" },
                  },
                  required: ["title", "body_html", "seo_title", "seo_description", "product_type", "tags", "url_handle", "faq_json", "reasoning"],
                },
              },
            }],
            tool_choice: { type: "function", function: { name: "suggest_shopify_optimizations" } },
          }),
        });

        if (oaRes.ok) {
          const oaData = await oaRes.json();
          const toolCall = oaData.choices?.[0]?.message?.tool_calls?.[0];
          if (toolCall?.function?.arguments) {
            const args = JSON.parse(toolCall.function.arguments) as ShopifySuggestionShape;
            suggestions = normalizeShopifySuggestions(product, args);
            geminiError = "";
          } else {
            geminiError += ` | OpenAI returned no tool call`;
          }
        } else {
          const errText = await oaRes.text();
          geminiError += ` | OpenAI error ${oaRes.status}: ${errText.slice(0, 200)}`;
          console.error("OpenAI error:", errText);
        }
      } catch (err) {
        geminiError += ` | OpenAI threw: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    if (!suggestions) {
      const detail = geminiError || "No configured AI provider returned a valid optimization";
      console.error("Product optimization failed:", detail);
      return new Response(
        JSON.stringify({
          error: "AI optimization failed. Your existing Shopify content was not changed.",
          detail,
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

      // Hard-guarantee: collection name keywords must appear in the final tag list.
      // The AI may miss them — this ensures the product surfaces within its collection.
      if (collectionNames.length > 0 && suggestions.tags) {
        const existingTagsLower = suggestions.tags.toLowerCase();
        const missingCollectionTags: string[] = [];
        for (const col of collectionNames) {
          const colKey = col.toLowerCase().trim();
          if (colKey && !existingTagsLower.includes(colKey)) {
            missingCollectionTags.push(col.toLowerCase());
          }
        }
        if (missingCollectionTags.length > 0) {
          suggestions.tags = [suggestions.tags, ...missingCollectionTags].filter(Boolean).join(", ");
        }
      }

      if ((!suggestions.image_alts || !suggestions.image_alts.trim()) && (product.images || []).length > 0) {
        suggestions.image_alts = buildFallbackImageAlts(product, storeName);
      }

      // Fill in any images the AI skipped (Gemini only sees 5 visually — images 6+ may be missing)
      // and re-stamp every entry with the correct store name suffix.
      if ((product.images || []).length > 0 && suggestions.image_alts) {
        try {
          const BRAND_RE = /\b(iron phoenix ghg|iron phoenix|our phoenix rise|go hard gaming discord llc|go hard gaming discord|go hard gaming|ghg|phoenix flow)\b/gi;
          const alts: { image_id: number; alt: string }[] = JSON.parse(suggestions.image_alts);
          const covered = new Set(alts.map((e) => e.image_id));
          // Build a clean product name for fallback entries (strip brand names)
          const cleanTitle = (product.title || "Product")
            .replace(BRAND_RE, "")
            .replace(/\s{2,}/g, " ")
            .trim() || "Product";
          // Add entries for any images the AI missed
          for (const img of product.images || []) {
            if (!covered.has(img.id)) {
              const detail = `View ${(product.images || []).indexOf(img) + 1}`;
              alts.push({ image_id: img.id, alt: `${cleanTitle} ${detail}` });
            }
          }
          // Strip brand names and re-stamp correct store suffix on every entry
          suggestions.image_alts = JSON.stringify(
            alts.map((entry) => {
              const desc = entry.alt
                .replace(/\s*\|.*$/, "")   // drop any existing suffix
                .replace(BRAND_RE, "")      // strip brand names from descriptor
                .replace(/\s{2,}/g, " ")
                .trim();
              const withSuffix = storeName ? `${desc} | ${storeName}` : desc;
              return { ...entry, alt: withSuffix.slice(0, 125) };
            })
          );
        } catch { /* leave as-is if JSON is malformed */ }
      }

    return new Response(JSON.stringify({ suggestions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
