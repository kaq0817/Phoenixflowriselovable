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
    reasoning: "AI optimization service was unavailable. Generated a baseline, rules-safe optimization so you can still apply a fix.",
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
    if (!GEMINI_API_KEY) {
      console.warn("Gemini API key not configured. Falling back to baseline optimization.");
    }

    const { product, connectionId } = await req.json() as { product?: ShopifyProductLike; connectionId?: string };
    if (!product) {
      return new Response(JSON.stringify({ error: "No product provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Usage gating — 50 optimizations per store per billing month
    const MONTHLY_LIMIT = 50;
    if (connectionId) {
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false } }
      );

      const { data: conn, error: connErr } = await supabaseAdmin
        .from("store_connections")
        .select("id, optimizer_runs, optimizer_period_start")
        .eq("id", connectionId)
        .eq("user_id", userData.user.id)
        .single();

      if (!connErr && conn) {
        const periodStart = new Date(conn.optimizer_period_start);
        const now = new Date();
        const daysSince = (now.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24);

        // Reset counter if 30+ days have passed
        if (daysSince >= 30) {
          await supabaseAdmin
            .from("store_connections")
            .update({ optimizer_runs: 1, optimizer_period_start: now.toISOString() })
            .eq("id", connectionId);
        } else if (conn.optimizer_runs >= MONTHLY_LIMIT) {
          return new Response(JSON.stringify({
            error: "Monthly limit reached",
            limit: MONTHLY_LIMIT,
            used: conn.optimizer_runs,
            resetsAt: new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        } else {
          await supabaseAdmin
            .from("store_connections")
            .update({ optimizer_runs: conn.optimizer_runs + 1 })
            .eq("id", connectionId);
        }
      }
    }

    const variants = product.variants || [];
    const variantInfo = variants.map((variant: ShopifyVariantLike) =>
      `${variant.title || "Default"} - $${variant.price || "0.00"} (${variant.inventory_quantity || 0} in stock)`,
    ).join("\n");

    const systemPrompt = `You are an expert Shopify SEO optimizer and Google Merchant Center compliance specialist.

SHOPIFY SEO RULES:

TITLE
- Concise, scannable product name. Use natural language, not keyword stuffing.
- Keep under 70 characters. Front-load the product name.
- For apparel: must include real color and size range (e.g. "Iron Phoenix Teal Gaming Hoodie Black XS-4XL").
- No ALL CAPS (except acronyms like USB, LED, GHG). No special characters, curly quotes, em dashes, symbols, or promotional words (FREE SHIPPING, SALE, BEST SELLER).

META TITLE (seo_title)
- Max 60 characters. Front-load the primary keyword.
- Different from product title - more keyword-focused.

META DESCRIPTION (seo_description)
- Target 120-155 characters EXACTLY. Benefit-focused, conversion-oriented.
- Must mention 1-2 primary keywords naturally.
- No promotional fluff. End with a soft call-to-action if space allows.

DESCRIPTION (body_html)
- Use H3 headings for sections: Features, Benefits, Size & Specs (apparel), Details.
- Include exactly one short bullet list (3-5 items) for key specs or highlights.
- Short sentences. Factual, no exaggerated claims. No hype words.
- End with a brief trust signal (e.g. single line mentioning returns or shipping).
- Format as clean HTML using only <h3>, <p>, <ul>, <li>, <strong>.

TAGS (Shopify-specific - NOT Etsy)
- Shopify tags are for collection filtering and search — NOT keyword stuffing.
- Include: intent-based phrases ("gift for gamers"), niche descriptors ("teal streetwear hoodie"), category terms, material, style.
- Use LONG-TAIL keyword phrases — multi-word phrases search better in Google Shopping.
- CRITICAL: Total combined tags string (all tags joined) must be 250 characters or fewer.
- There is NO 13-tag limit here — this is Shopify, not Etsy. Use as many tags as fit within 250 characters total.
- Do NOT duplicate concepts. Do NOT include vendor name, dropshipping terms, or generic one-word filler.

URL HANDLE (url_handle)
- Short, hyphenated, keyword-based. Example: "teal-gaming-hoodie-iron-phoenix-black-xs-4xl"
- Lowercase letters, numbers, and hyphens only. No brand name unless also a keyword.
- Max 60 characters.

FAQ (faq_json)
- Return a JSON array string of 3-4 question/answer pairs shoppers commonly ask.
- Format: [{"question": "...", "answer": "..."}, ...]
- Real questions about sizing, shipping, materials, or use case. Plain language answers.

COLLECTIONS SUGGESTION (collections_suggestion)
- Suggest 2-3 Shopify collection names this product should be assigned to.
- Use the existing product type, tags, and title as context.
- Example: "Gaming Mugs, Gifts for Gamers, Travel Drinkware"

GOOGLE MERCHANT CENTER COMPLIANCE (violations cause suspension)
- Apparel titles MUST include color and size range exactly as variants show.
- NEVER use special characters/symbols/Unicode decorative characters.
- No misleading claims. Descriptions must match what the product actually is.
- No price, shipping, or promotional text in title/meta fields.

Return all optimizations using the suggest_shopify_optimizations function.`;

    const userPrompt = `Optimize this Shopify product:
SHOPIFY-SPECIFIC RULES:
- Titles: Clear product name + brand. Do NOT use long-tail keyword stuffing. Keep under 70 characters.
- Variant options should use standard Shopify conventions: Color, Size, Gender, Material, Style
- SEO title: max 70 characters, front-load product name
- SEO description (meta description): max 320 characters, benefit-focused, include key attributes
- Body HTML description: compelling, formatted with bullet points for specs, benefit-focused paragraphs
- Tags: relevant product tags for Shopify collections and filtering (comma-separated)
- Prefer specific multi-word tags when they improve clarity, but keep them natural and usable for store organization
- Avoid generic one-word filler tags unless they are required category, material, color, or size markers
- Do not repeat the same keyword twice across tags
- Do not create near-duplicate tags that only swap word order or pluralization
- Product type: accurate category classification

GOOGLE MERCHANT CENTER COMPLIANCE (CRITICAL - violations cause suspension):
- FOR CLOTHING/APPAREL ONLY: Titles MUST include color and size. If the product has a size range such as S-XXL, XS-XL, or numeric sizes, keep that range in the title exactly. If the original title or variants contain a color (e.g. "Blue", "Red", "Gold"), you MUST keep it. Format for clothing: [Brand] [Product Name] [Color] [Size or Size Range]. For non-clothing products, color and size in titles are optional.
- For clothing: always include color as a tag as well.
- Never collapse a multi-size apparel listing into a single size in the title. Preserve the actual size range if the listing covers multiple sizes.
- NEVER use special characters or symbols in titles, descriptions, or tags. This includes: curly quotes, em dashes, en dashes, bullets, trademark symbols, arrows, stars, checkmarks, hearts, or ANY Unicode decorative characters.
- Only use plain ASCII characters: regular quotes (" "), hyphens (-), commas, periods, parentheses, forward slashes, ampersands (&), and plus signs (+).
- No ALL CAPS words (except brand acronyms like "USB" or "LED").
- No promotional text in titles (e.g. "FREE SHIPPING", "SALE", "BEST SELLER").
- No excessive punctuation (!!!, ???, ...).
- Descriptions must be factual and accurate with no exaggerated claims.

IMPORTANT: Shopify SEO is about clarity, proper categorization, and variant structure, not Etsy-style title stuffing. Use long-tail detail mainly in tags and description where it stays natural. For apparel, the title must still carry the real color and the real size or size range visible to the shopper.
Return your optimizations using the suggest_shopify_optimizations function.`;

    const userPrompt = `Optimize this Shopify product:

Title: ${product.title || ""}
Body/Description: ${product.body_html || ""}
Product Type: ${product.product_type || "Unknown"}
Vendor: ${product.vendor || "Unknown"}
Tags: ${product.tags || ""}
Variants:
${variantInfo || "No variants"}

Current SEO Title: ${product.metafields_global_title_tag || product.title || ""}
Current SEO Description: ${product.metafields_global_description_tag || ""}`;

    let suggestions: ShopifySuggestionShape | null = null;

    if (GEMINI_API_KEY) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
          {
            method: "POST",
            headers: {
              "x-goog-api-key": GEMINI_API_KEY,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              contents: [
                { role: "user", parts: [{ text: systemPrompt + "\n\n" + userPrompt }] },
              ],
              tools: [
                {
                  functionDeclarations: [
                    {
                      name: "suggest_shopify_optimizations",
                      description: "Return optimized Shopify product fields",
                      parameters: {
                        type: "object",
                        properties: {
                          title: { type: "string", description: "Optimized product title (max 70 chars, no keyword stuffing)" },
                          body_html: { type: "string", description: "Optimized HTML body using H3 sections, bullet list, trust signal. Only <h3><p><ul><li><strong> tags." },
                          seo_title: { type: "string", description: "SEO meta title (max 60 chars, keyword-first)" },
                          seo_description: { type: "string", description: "SEO meta description (120-155 chars, benefit-focused, conversion-oriented)" },
                          product_type: { type: "string", description: "Optimized product type/category" },
                          tags: { type: "string", description: "Comma-separated long-tail keyword phrase tags. Total string MUST be 250 characters or fewer. Shopify-specific — NOT limited to 13 tags." },
                          variant_suggestions: { type: "string", description: "Suggestions for variant naming (Color/Size/Gender conventions)" },
                          url_handle: { type: "string", description: "Hyphenated URL handle, keyword-based, max 60 chars, lowercase only (e.g. teal-gaming-hoodie-iron-phoenix-black-xs-4xl)" },
                          faq_json: { type: "string", description: "JSON array string of 3-4 FAQ objects: [{\"question\":\"...\",\"answer\":\"...\"}]. Real shopper questions about sizing, shipping, materials, use case." },
                          collections_suggestion: { type: "string", description: "Comma-separated list of 2-3 Shopify collection names this product fits (e.g. Gaming Mugs, Gifts for Gamers, Travel Drinkware)" },
                          reasoning: { type: "string", description: "Brief explanation of changes made" },
                        },
                        required: ["title", "body_html", "seo_title", "seo_description", "product_type", "tags", "url_handle", "faq_json", "reasoning"],
                      },
                    },
                  ],
                },
              ],
              toolConfig: {
                functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["suggest_shopify_optimizations"] },
              },
            }),
          },
        );

        if (!response.ok) {
          const errText = await response.text();
          console.error("Gemini error:", response.status, errText);
        } else {
          const data = await response.json();
          const functionCall = data.candidates?.[0]?.content?.parts?.find((part: GeminiFunctionCallPart) => part.functionCall) as GeminiFunctionCallPart | undefined;
          if (!functionCall?.functionCall?.args) {
            console.error("Gemini response missing function call:", JSON.stringify(data).slice(0, 2000));
          } else {
            suggestions = normalizeShopifySuggestions(product, functionCall.functionCall.args);
          }
        }
      } catch (error) {
        console.error("Gemini request failed:", error);
      }
    }

    if (!suggestions) {
      suggestions = normalizeShopifySuggestions(product, buildFallbackSuggestions(product));
    }

    return new Response(JSON.stringify({ suggestions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("optimize-shopify-listing error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
