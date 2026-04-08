import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";
import {
  normalizeShopifySuggestions,
  type ShopifyProductLike,
  type ShopifySuggestionShape,
  type ShopifyVariantLike,
} from "../_shared/listingValidators.ts";

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
    if (buffer.byteLength > 3 * 1024 * 1024) return null; // skip >3MB images
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return { data: btoa(binary), mimeType };
  } catch {
    return null;
  }
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function buildFallbackSuggestions(product: ShopifyProductLike): ShopifySuggestionShape {
  const title = (product.title || "Product").trim();
  const seoTitle = title.slice(0, 60).trim();
  const cleanBody = stripHtml(product.body_html || "");

  // Only use real content — never invent copy
  const seoDescription = cleanBody.length >= 50 ? cleanBody.slice(0, 155).trim() : "";

  const tagParts = [
    product.product_type,
    ...String(product.title || "")
      .split(/[-,|/]/)
      .map((part) => part.trim()),
  ]
    .filter(Boolean)
    .map((part) => String(part));

  const tags = Array.from(new Set(tagParts)).slice(0, 12).join(", ");

  return {
    title,
    body_html: product.body_html || `<p>${title}</p>`,
    seo_title: seoTitle,
    seo_description: seoDescription,
    product_type: product.product_type || "",
    tags,
    variant_suggestions: "",
    url_handle: product.handle || "",
    faq_json: "[]",
    reasoning: "Fallback: AI unavailable. Generated compliance-safe, non-duplicate SEO fields.",
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
  // Strip .myshopify.com or any TLD, then title-case the slug
  return domain
    .replace(/\.myshopify\.com$/i, "")
    .replace(/\.[a-z]{2,}$/i, "")
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
    const { product, connectionId, productContext } = await req.json() as { product?: ShopifyProductLike; connectionId?: string; productContext?: string };

    if (!product) {
      return new Response(JSON.stringify({ error: "No product provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Usage gating (50/month)
    let storeName = "";

    if (connectionId) {
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false } }
      );

      const { data: conn, error: connErr } = await supabaseAdmin
        .from("store_connections")
        .select("id, optimizer_runs, optimizer_period_start, shop_name, shop_domain")
        .eq("id", connectionId)
        .eq("user_id", userData.user.id)
        .single();

      if (!connErr && conn) {
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
        storeName = conn.shop_name || domainToStoreName(conn.shop_domain) || "";
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

    // Fetch images for multimodal analysis (cap at 5 images)
    const imageParts: { inlineData: { mimeType: string; data: string } }[] = [];
    for (const img of productImages.slice(0, 5)) {
      if (!img.src) continue;
      const result = await fetchImageBase64(img.src);
      if (result) imageParts.push({ inlineData: { mimeType: result.mimeType, data: result.data } });
    }

    const systemPrompt = `You are an expert Shopify SEO optimizer and Google Merchant Center compliance specialist.

SHOPIFY SEO RULES:
- TITLE: Descriptor-first product name only. Under 70 chars. No vendor/brand names. Format: [Descriptor] [Item Type] [Key Attribute if critical — e.g. color+size for apparel, Waterproof/Insulated for drinkware/outerwear]. Strip "Iron Phoenix GHG", "Iron Phoenix", "ghg", "| Iron Phoenix", or any store name. Example: "Block World Pixelated Travel Mug" or "Aurora Flow Gradient Athletic Shorts Black XS-4XL".
- SEO TITLE: Must be under 60 chars. Use | as the only separator (never hyphens as separators). ${storeName ? `Append "| ${storeName}" only if the result stays at or under 60 chars.` : "Do not append any store name suffix."} Never use "Iron Phoenix GHG" anywhere.
- META TITLE (seo_title): Max 60 chars. Keyword-focused.
- META DESCRIPTION (seo_description): 120-155 characters EXACTLY. No promo fluff. Use | as the only structural separator if needed — never use a hyphen as a separator.
- DESCRIPTION (body_html): H3 headings (Features, Benefits, Specs). Exactly one bullet list (3-5 items). HTML tags: <h3>, <p>, <ul>, <li>, <strong> only.
- TAGS: Think like a real shopper typing into a search bar. Generate 20-30 tags total. First identify the product's niche/theme (e.g. Minecraft-inspired, pixel art, gaming, zombie, patriotic, fitness) — then write real buyer-intent search phrases for that niche (e.g. "minecraft inspired mug", "pixel art gamer gift", "gaming coffee mug", "gift for minecraft fan"). PRESERVE all existing specific tags from the product. Upgrade generic-only tags with themed niche terms alongside them. Single-word niche tags (e.g. "Tumbler", "Gaming", "Zombie") are valid when theme-specific. No vendor names ("Iron Phoenix", "Iron Phoenix GHG", "ghg"). Each individual tag max 255 chars — no combined string length limit.
- URL HANDLE: Hyphenated, lowercase, keyword-based, max 60 chars.
- FAQ: Return a JSON array string of 3-4 Q&A pairs.
- IMAGE ALT TEXT: The actual product images are included in this request — visually analyze each one. Write descriptive SEO-friendly alt text based on what you see in each image. Rules: under 125 chars each; Format: "[Product Name] - [Color/Detail/Angle] | ${storeName || "store"}" (e.g. "Block World Pixelated Travel Mug - Matte Black Finish | Phoenix Rise"); describe the actual visible content (color, angle, key design detail, background context); Images 2+ should describe what makes that photo different from Image 1 (angle, detail, zoom, lifestyle shot, etc.); NEVER use "image of", "picture of", generic text like "product image 1", or the vendor name "Iron Phoenix GHG"; include relevant niche keywords naturally before the pipe. Return as a JSON-encoded string in image_alts: [{"image_id": <id>, "alt": "<text>"}].
- IMAGE FILENAMES: For every image, suggest a clean SEO-rich filename. Rules: all lowercase, hyphen-separated, no special chars, end in .jpg; Format: "[clean-product-name]-[detail]-[store-slug].jpg" where store-slug = "${storeName ? storeName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") : "store"}"; Image 1 = full product slug + store slug (e.g. "block-world-pixelated-travel-mug-phoenix-rise.jpg"); Images 2+ = product slug + detail + store slug (e.g. "block-world-pixelated-travel-mug-handle-detail-phoenix-rise.jpg"); NEVER use generic names like "image-1.jpg", vendor names, or LLC suffixes. Return as a JSON-encoded string in image_filenames: [{"image_id": <id>, "filename": "<name>.jpg"}].

GOOGLE MERCHANT CENTER COMPLIANCE (CRITICAL):
- APPAREL TITLES MUST include color and size range (e.g. "Black XS-4XL").
- NEVER use special characters (curly quotes, em dashes, symbols, Unicode, emojis).
- ONLY use plain ASCII: quotes (" "), hyphens (-), commas, periods, &, +, /.
- NO ALL CAPS (except USB/LED). NO promotional text ("FREE SHIPPING", "SALE").
- Descriptions must be factual with no exaggerated claims.

FACEBOOK / META COMMERCE COMPLIANCE (CRITICAL — products must pass Facebook catalog review):
- NEVER include medical or health claims (e.g. "cures", "treats", "heals", "relieves pain", "therapeutic", "medical grade", "FDA approved", "anti-anxiety", "boosts immunity", "detox"). These trigger automatic Facebook rejection.
- NEVER reference prescription drugs, supplements claiming health benefits, or any before/after health outcomes.
- NEVER use claims about weight loss, muscle gain, or physical transformation.
- Descriptions must describe WHAT the product IS (material, design, use case) — not what it DOES to the body.
- Lifestyle context is fine ("great for desk setups", "perfect for gaming sessions") — health outcomes are not.`;

    const userPrompt = `Optimize this Shopify product:
Title: ${product.title || ""}
Body: ${product.body_html || ""}
Type: ${product.product_type || ""}
Vendor: ${product.vendor || ""}
Tags: ${product.tags || ""}
Variants:
${variantInfo}${imageInfo}

Current SEO Title: ${product.metafields_global_title_tag || ""}
Current SEO Description: ${product.metafields_global_description_tag || ""}
${productContext ? `\nSeller context (use this to inform all fields — the seller knows what this product actually is): ${productContext}` : ""}
Return all optimizations using the suggest_shopify_optimizations function.`;

    let suggestions: ShopifySuggestionShape | null = null;

    if (GEMINI_API_KEY) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: systemPrompt + "\n\n" + userPrompt }, ...imageParts] }],
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
            })
          }
        );

        if (response.ok) {
          const data = await response.json();
          const functionCall = data.candidates?.[0]?.content?.parts?.find((p: GeminiFunctionCallPart) => p.functionCall)?.functionCall;
          if (functionCall?.args) {
            suggestions = normalizeShopifySuggestions(product, functionCall.args);
          }
        } else {
          console.error("Gemini Error:", await response.text());
        }
      } catch (err) {
        console.error("Gemini Request Failed:", err);
      }
    }

      if (!suggestions) {
        suggestions = normalizeShopifySuggestions(product, buildFallbackSuggestions(product));
      }

      if ((!suggestions.image_alts || !suggestions.image_alts.trim()) && (product.images || []).length > 0) {
        suggestions.image_alts = buildFallbackImageAlts(product, storeName);
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
