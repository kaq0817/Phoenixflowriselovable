import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("Gemini API key not configured");

    const { product } = await req.json();
    if (!product) {
      return new Response(JSON.stringify({ error: "No product provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const variants = product.variants || [];
    const variantInfo = variants.map((v: any) => 
      `${v.title} - $${v.price} (${v.inventory_quantity || 0} in stock)`
    ).join("\n");

    const systemPrompt = `You are an expert Shopify SEO optimizer specializing in product listings.

SHOPIFY-SPECIFIC RULES:
- Titles: Clear product name + brand. Do NOT use long-tail keyword stuffing. Keep under 70 characters.
- Variant options should use standard Shopify conventions: Color, Size, Gender, Material, Style
- SEO title: max 70 characters, front-load product name
- SEO description (meta description): max 320 characters, benefit-focused, include key attributes
- Body HTML description: compelling, formatted with bullet points for specs, benefit-focused paragraphs
- Tags: relevant product tags for Shopify collections and filtering (comma-separated)
- Product type: accurate category classification

GOOGLE MERCHANT CENTER COMPLIANCE (CRITICAL — violations cause suspension):
- FOR CLOTHING/APPAREL ONLY: Titles MUST include color and size. If the original title contains a color (e.g. "Blue", "Red", "Gold"), you MUST keep it. Format for clothing: [Brand] [Product Name] [Color] [Size]. For non-clothing products, color and size in titles are optional.
- For clothing: always include color as a tag as well.
- NEVER use special characters or symbols in titles, descriptions, or tags. This includes: curly quotes, em dashes, en dashes, bullets, trademark symbols, arrows, stars, checkmarks, hearts, or ANY Unicode decorative characters.
- Only use plain ASCII characters: regular quotes (" "), hyphens (-), commas, periods, parentheses, forward slashes, ampersands (&), and plus signs (+).
- No ALL CAPS words (except brand acronyms like "USB" or "LED").
- No promotional text in titles (e.g. "FREE SHIPPING", "SALE", "BEST SELLER").
- No excessive punctuation (!!!, ???, ...).
- Descriptions must be factual and accurate — no exaggerated claims.

IMPORTANT: Shopify SEO is about clarity, proper categorization, and variant structure - NOT Etsy-style long-tail keyword stuffing. For clothing products, NEVER strip color or size from titles.

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

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent`,
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
                      tags: { type: "string", description: "Comma-separated optimized tags" },
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
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await response.text();
      console.error("Gemini error:", response.status, errText);
      throw new Error("AI optimization failed");
    }

    const data = await response.json();
    const functionCall = data.candidates?.[0]?.content?.parts?.find((p: any) => p.functionCall);
    if (!functionCall) throw new Error("No optimization result returned");

    const suggestions = functionCall.functionCall.args;

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
