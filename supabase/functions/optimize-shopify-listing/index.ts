import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
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
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      console.warn("Gemini API key not configured. Falling back to baseline optimization.");
    }

    const { product } = await req.json() as { product?: ShopifyProductLike };
    if (!product) {
      return new Response(JSON.stringify({ error: "No product provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const variants = product.variants || [];
    const variantInfo = variants.map((variant: ShopifyVariantLike) =>
      `${variant.title || "Default"} - $${variant.price || "0.00"} (${variant.inventory_quantity || 0} in stock)`,
    ).join("\n");

    const systemPrompt = `You are an expert Shopify SEO optimizer specializing in product listings.

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
                          body_html: { type: "string", description: "Optimized HTML body description with bullet points and benefits" },
                          seo_title: { type: "string", description: "SEO meta title (max 70 chars)" },
                          seo_description: { type: "string", description: "SEO meta description (max 320 chars)" },
                          product_type: { type: "string", description: "Optimized product type/category" },
                          tags: { type: "string", description: "Comma-separated optimized tags with clear, non-duplicated phrasing" },
                          variant_suggestions: { type: "string", description: "Suggestions for variant naming (Color/Size/Gender conventions)" },
                          reasoning: { type: "string", description: "Brief explanation of changes made" },
                        },
                        required: ["title", "body_html", "seo_title", "seo_description", "product_type", "tags", "reasoning"],
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
