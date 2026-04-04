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

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function buildFallbackSuggestions(product: ShopifyProductLike): ShopifySuggestionShape {
  const title = product.title || "Product";
  const cleanBody = stripHtml(product.body_html || "");
  const seoDescription = cleanBody
    ? cleanBody.slice(0, 300)
    : `${title} is ready for a quick Shopify SEO pass.`;

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
    body_html: product.body_html || `<p>${title} is ready for a clearer, buyer-friendly description.</p>`,
    seo_title: title,
    seo_description: seoDescription,
    product_type: product.product_type || "",
    tags,
    variant_suggestions: "",
    url_handle: product.handle || "",
    faq_json: "[]",
    reasoning: "AI optimization service was unavailable. Generated a baseline, rules-safe optimization.",
  };
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
    const { product, connectionId } = await req.json() as { product?: ShopifyProductLike; connectionId?: string };

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
        storeName = conn.shop_name || conn.shop_domain || "";
      }
    }

    const variants = product.variants || [];
    const variantInfo = variants.map((v: ShopifyVariantLike) =>
      `${v.title || "Default"} - $${v.price || "0.00"} (${v.inventory_quantity || 0} in stock)`,
    ).join("\n");

    const productImages = product.images || [];
    const imageInfo = productImages.length > 0
      ? `\nImages (${productImages.length}):\n${productImages.map((img, i) => `Image ${i + 1} (id: ${img.id}, position: ${img.position ?? i + 1}): current_alt="${img.alt || "none"}"`).join("\n")}`
      : "";

    const systemPrompt = `You are an expert Shopify SEO optimizer and Google Merchant Center compliance specialist.

SHOPIFY SEO RULES:
- TITLE: Descriptor-first product name only. Under 70 chars. No vendor/brand names. Format: [Descriptor] [Item Type] [Key Attribute if critical — e.g. color+size for apparel, Waterproof/Insulated for drinkware/outerwear]. Strip "Iron Phoenix GHG", "Iron Phoenix", "ghg", "| Iron Phoenix", or any store name. Example: "Block World Pixelated Travel Mug" or "Aurora Flow Gradient Athletic Shorts Black XS-4XL".
- SEO TITLE: Must be under 60 chars. ${storeName ? `Append "| ${storeName}" only if the result stays at or under 60 chars.` : "Do not append any store name suffix."} Never use "Iron Phoenix GHG" anywhere.
- META TITLE (seo_title): Max 60 chars. Keyword-focused.
- META DESCRIPTION (seo_description): 120-155 characters EXACTLY. No promo fluff.
- DESCRIPTION (body_html): H3 headings (Features, Benefits, Specs). Exactly one bullet list (3-5 items). HTML tags: <h3>, <p>, <ul>, <li>, <strong> only.
- TAGS: Think like a Google Shopping shopper searching for THIS SPECIFIC product. First identify the product's niche/theme (e.g. Minecraft-inspired, pixel art, gaming, zombie, patriotic, fitness) — then use real buyer-intent search queries for that niche (e.g. "minecraft inspired mug", "pixel art gamer gift", "gaming coffee mug", "gift for minecraft fan"). Generic category tags like "coffee cup", "travel mug", "shirt" alone will land on page 3000 — use THEMED niche terms. PRESERVE the existing specific tags. Upgrade generic ones with the product's actual theme. Single-word niche tags (e.g. "Tumbler", "8-bit", "Zombie", "Gaming") are valid when theme-specific. No vendor names ("Iron Phoenix", "Iron Phoenix GHG", "ghg"). Combined total string must be 250 chars or fewer.
- URL HANDLE: Hyphenated, lowercase, keyword-based, max 60 chars.
- FAQ: Return a JSON array string of 3-4 Q&A pairs.
- IMAGE ALT TEXT: For every image listed in the product data, write descriptive SEO-friendly alt text. Rules: under 125 chars each; Format: "[Product Name] - [Color/Detail/Angle] | ${storeName || "store"}" (e.g. "Block World Pixelated Travel Mug - Matte Black Finish | Phoenix Rise"); Image 1 = full clean product name + primary attribute; Images 2+ = angle, detail, or context suffix before the pipe (e.g. "Block World Pixelated Travel Mug - Handle Detail | Phoenix Rise"); NEVER use "image of", "picture of", generic text like "product image 1", or the vendor name "Iron Phoenix GHG"; include relevant niche keywords naturally before the pipe. Return as a JSON-encoded string in image_alts: [{"image_id": <id>, "alt": "<text>"}].

GOOGLE MERCHANT CENTER COMPLIANCE (CRITICAL):
- APPAREL TITLES MUST include color and size range (e.g. "Black XS-4XL").
- NEVER use special characters (curly quotes, em dashes, symbols, Unicode, emojis).
- ONLY use plain ASCII: quotes (" "), hyphens (-), commas, periods, &, +, /.
- NO ALL CAPS (except USB/LED). NO promotional text ("FREE SHIPPING", "SALE").
- Descriptions must be factual with no exaggerated claims.`;

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
              contents: [{ role: "user", parts: [{ text: systemPrompt + "\n\n" + userPrompt }] }],
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
                      collections_suggestion: { type: "string" },                        image_alts: { type: "string", description: "JSON array: [{\"image_id\": <id>, \"alt\": \"<text>\"}] — one entry per product image, max 125 chars per alt" },                      reasoning: { type: "string" },
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

    return new Response(JSON.stringify({ suggestions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});