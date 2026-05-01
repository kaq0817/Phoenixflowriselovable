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
    // FIX: Use title-based slug since 'handle' is missing from ShopifyProductLike
    url_handle: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
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
      }
    }

    const variants = product.variants || [];
    const variantInfo = variants.map((v: ShopifyVariantLike) =>
      `${v.title || "Default"} - $${v.price || "0.00"} (${v.inventory_quantity || 0} in stock)`,
    ).join("\n");

    const systemPrompt = `You are a sales machine. Your only job is to make this product sell. You find the exact words a real buyer types into Google when they are ready to spend money, and you build every field around those words so this product appears in front of that buyer and they click. You work within GMC compliance rules as constraints — not the goal. The goal is the sale.

KEYWORD TARGETING (do this before anything else):
Identify 3-5 keywords a buyer types when ready to purchase — not researching, BUYING. Target 500-5,000 monthly US searches — this is the range a newer store with low domain authority can actually rank for. High-volume terms (25,000+) are owned by Amazon, Wayfair, and established sellers; avoid them. Favor 4-6 word hyper-specific phrases: "personalized gaming room metal wall sign", "custom name fleece blanket dad birthday" — not "wall art" or "blanket". Specificity beats volume for new stores. Build every field around these keywords.

You are also an expert Shopify SEO optimizer and Google Merchant Center compliance specialist.

SHOPIFY SEO RULES:
- TITLE: Concise, scannable, under 60 chars (GMC hard limit). Front-load product name.
- META TITLE (seo_title): Max 60 chars. Keyword-focused.
- META DESCRIPTION (seo_description): 120-155 characters EXACTLY. No promo fluff.
- DESCRIPTION (body_html): Make the buyer need this item. 1000-1200 characters minimum. Open by putting the buyer in the moment — where they are, what they feel, why this fits their life — primary keyword in the first sentence. Natural flow, no section labels. Bullet list of 4-6 real specs that prove the promise. Middle paragraph connecting the product to a real moment, occasion, or feeling. Close with one sentence that makes them feel like they'd miss out without it. No exclamation points, no hype, no hollow phrases. Plain English only, no HTML tags.
- TAGS: Long-tail phrases. Combined total string must be 250 chars or fewer. No vendor names.
- URL HANDLE: Hyphenated, lowercase, keyword-based, max 60 chars.
- FAQ: Return a JSON array string of 3-4 Q&A pairs.

GOOGLE MERCHANT CENTER COMPLIANCE (CRITICAL - violations cause suspension):
- APPAREL TITLES MUST include color and size range (e.g. "Iron Phoenix Teal Gaming Hoodie Black XS-4XL").
- NEVER use special characters or symbols (curly quotes, em dashes, trademark symbols, arrows, stars, emojis).
- ONLY use plain ASCII: regular quotes (" "), hyphens (-), commas, periods, ampersands (&), plus signs (+), and forward slashes (/).
- NO ALL CAPS words (except brand acronyms like "USB" or "LED").
- NO promotional text in titles (e.g. "FREE SHIPPING", "SALE", "BEST SELLER").
- No excessive punctuation (!!!, ???, ...).
- Descriptions must be factual and accurate with no exaggerated claims.`;

    const userPrompt = `Optimize this Shopify product:
Title: ${product.title || ""}
Body: ${product.body_html || ""}
Type: ${product.product_type || "Unknown"}
Vendor: ${product.vendor || "Unknown"}
Tags: ${product.tags || ""}
Variants:
${variantInfo || "No variants"}

Current SEO Title: ${product.metafields_global_title_tag || product.title || ""}
Current SEO Description: ${product.metafields_global_description_tag || ""}

Return all optimizations using the suggest_shopify_optimizations function.`;

    let suggestions: ShopifySuggestionShape | null = null;

    if (GEMINI_API_KEY) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
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
                      title: { type: "string", description: "Optimized product title (max 60 chars, GMC hard limit, no keyword stuffing)" },
                      body_html: { type: "string", description: "Optimized HTML body. Only <h3><p><ul><li><strong> tags." },
                      seo_title: { type: "string", description: "SEO meta title (max 60 chars, keyword-first)" },
                      seo_description: { type: "string", description: "SEO meta description (120-155 chars EXACTLY)" },
                      product_type: { type: "string", description: "Optimized product type" },
                      tags: { type: "string", description: "Comma-separated tags (total string < 250 chars)" },
                      variant_suggestions: { type: "string", description: "Suggestions for variant naming" },
                      url_handle: { type: "string", description: "Hyphenated URL handle, keyword-based, lowercase" },
                      faq_json: { type: "string", description: "JSON array string of 3-4 FAQ objects" },
                      collections_suggestion: { type: "string", description: "Suggested Shopify collection names" },
                      reasoning: { type: "string", description: "Brief explanation of changes" },
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
          // FIX: Replaced any with the defined GeminiFunctionCallPart interface
          const functionCall = data.candidates?.[0]?.content?.parts?.find((p: GeminiFunctionCallPart) => p.functionCall)?.functionCall;
          if (functionCall?.args) {
            suggestions = normalizeShopifySuggestions(product, functionCall.args);
          }
        } else {
          const errText = await response.text();
          console.error("Gemini Error:", response.status, errText);
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
    console.error("optimize-shopify-listing error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});