import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";
import {
  normalizeShopifySuggestions,
  type ShopifyProductLike,
  type ShopifySuggestionShape,
  type ShopifyVariantLike,
} from "../_shared/listingValidators.ts";
import { getShopifyApiVersion } from "../_shared/shopify.ts";

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
    const OPENAI_API_KEY: string | undefined = undefined; // disabled until OpenAI billing is active
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
    const variantInfo = variants.map((v: ShopifyVariantLike) =>
      `${v.title || "Default"} - $${v.price || "0.00"} (${v.inventory_quantity || 0} in stock)`,
    ).join("\n");

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

    const systemPrompt = `You are an expert Shopify SEO optimizer and Google Merchant Center compliance specialist.

SHOPIFY SEO RULES:
- TITLE: Descriptor-first product name only. Under 60 chars (GMC hard limit). No vendor/brand names. Format: [Descriptor] [Item Type] [Key Attribute if critical — e.g. color+size for apparel, Waterproof/Insulated for drinkware/outerwear]. Strip "Iron Phoenix GHG", "Iron Phoenix", "ghg", "| Iron Phoenix", or any store name. Example: "Block World Pixelated Travel Mug" or "Aurora Flow Gradient Athletic Shorts Black XS-4XL".
- PERSONALIZATION ATTRIBUTES (NEVER REMOVE): "Personalized", "Custom", "Custom Name", "Customizable" are PRODUCT ATTRIBUTES that buyers search for — they are NOT promotional words. If the product accepts a custom name, text, or design, the word "Personalized" or "Custom Name" MUST appear in the title. Removing these words from a personalizable product's title is an error. Research shows these terms increase click-through and conversion significantly.
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
- DESCRIPTION (body_html): The existing Body HTML is your PRIMARY SOURCE — carry all factual specs, materials, and dimensions forward. Then restructure: (1) <h3> containing the primary keyword naturally, (2) one hook <p> — identity-driven, who this is for and why they'll love it, include primary keyword or close variant, (3) <ul> with 5-7 bullets — each leads with a benefit backed by a spec, weave in secondary keywords naturally, (4) closing <p> on use case, gifting, or occasion (2-3 sentences) with a secondary keyword. MINIMUM 800 characters of visible text — more content = more keyword surface area for Google to crawl. No exclamation points. HTML tags: <h3>, <p>, <ul>, <li>, <strong> only.
- TAGS: Generate 20-25 NEW buyer-intent tags only — do NOT re-list the existing product tags (we merge them automatically). Tags in Shopify create crawlable collection pages at /collections/all/[tag] — treat each tag as a mini landing page keyword. The primary keyword MUST appear as one of the tags verbatim. Mix tag lengths: 40% should be 3-5 word long-tail phrases (highest conversion and easiest to rank), 40% should be 2-3 word mid-tail phrases, 20% can be single specific niche words. COLLECTION GUARANTEE: Include at least 1-2 tags matching the collection name's core keyword. Ask "would an actual shopper type this exact phrase into Google?" — if no, drop it. CRITICAL: Never split hyphenated terms. Never use competitor brand names, vendor names, "sale", "cheap", "new", or junk terms. Each individual tag max 255 chars.
- URL HANDLE: Hyphenated, lowercase, PRIMARY KEYWORD as the base, max 50 chars. Shorter is better — 3-5 words ideal. Example: "cartoon-space-crew-metal-wall-sign" not "cartoon-space-crew-iron-wall-sign-gaming-character-metal-wall-decor-art".
- FAQ: Return a JSON array string of 3-4 Q&A pairs.
- IMAGE ALT TEXT: Write alt text for EVERY image listed in the image list — not just the ones attached as photos. For images you can see visually, describe what you actually see. For images beyond the attached photos, write descriptive alt text based on the product name, type, and design theme. Rules: under 125 chars each; Format: "[Product Name] - [Color/Detail/Angle] | ${storeName || "store"}" (e.g. "Block World Pixelated Travel Mug - Matte Black Finish | Phoenix Rise"); CRITICAL: NEVER use "image of", "picture of", generic text like "product image 1", or the vendor/brand name "Iron Phoenix GHG"; include relevant niche keywords naturally before the pipe. NEVER include the store name BOTH in the descriptive part AND after the pipe — it appears exactly once, after the pipe only. NEVER use curly/smart quotes (" " ' ') — only plain straight quotes (" '). Your image_alts JSON array MUST have one entry per image id listed above. Return as a JSON-encoded string in image_alts: [{"image_id": <id>, "alt": "<text>"}].
- IMAGE FILENAMES: For every image, suggest a clean SEO-rich filename. Rules: all lowercase, hyphen-separated, no special chars, end in .jpg; Format: "[clean-product-name]-[detail]-[store-slug].jpg" where store-slug = "${storeName ? storeName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") : "store"}"; Image 1 = full product slug + store slug (e.g. "block-world-pixelated-travel-mug-phoenix-rise.jpg"); Images 2+ = product slug + detail + store slug (e.g. "block-world-pixelated-travel-mug-handle-detail-phoenix-rise.jpg"); NEVER use generic names like "image-1.jpg", vendor names, or LLC suffixes. Return as a JSON-encoded string in image_filenames: [{"image_id": <id>, "filename": "<name>.jpg"}].

GOOGLE MERCHANT CENTER COMPLIANCE (CRITICAL):
- APPAREL TITLES MUST include color and size range (e.g. "Black XS-4XL").
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
Variants:
${variantInfo}${imageInfo}

Current SEO Title: ${product.metafields_global_title_tag || ""}
Current SEO Description: ${product.metafields_global_description_tag || ""}
${descriptionInstruction}

Return all optimizations using the suggest_shopify_optimizations function.`;

    let suggestions: ShopifySuggestionShape | null = null;
    let geminiError = "";

    // Model cascade: try the best available model first, fall back on 429 rate limit
    const GEMINI_MODELS = [
      "gemini-2.5-flash-preview-04-17",  // best quality, lower quota
      "gemini-2.5-flash",                 // stable, higher quota — reliable fallback
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
              variant_suggestions: { type: "string" },
              url_handle: { type: "string" },
              faq_json: { type: "string" },
              collections_suggestion: { type: "string" },
              image_alts: { type: "string", description: "JSON array: [{\"image_id\": <id>, \"alt\": \"<text>\"}] — one entry per product image, max 125 chars per alt" },
              image_filenames: { type: "string", description: "JSON array: [{\"image_id\": <id>, \"filename\": \"<slug>.jpg\"}] — one clean SEO filename per image, lowercase hyphenated, store-branded" },
              reasoning: { type: "string" },
            },
            required: ["title", "body_html", "seo_title", "seo_description", "product_type", "tags", "url_handle", "faq_json", "reasoning"],
          }
        }]
      }],
      toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["suggest_shopify_optimizations"] } }
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
                    variant_suggestions: { type: "string" },
                    url_handle: { type: "string" },
                    faq_json: { type: "string" },
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
      const fallback = buildFallbackSuggestions(product);
      if (geminiError) fallback.reasoning = `AI error: ${geminiError} — ${fallback.reasoning}`;
      suggestions = normalizeShopifySuggestions(product, fallback);
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
