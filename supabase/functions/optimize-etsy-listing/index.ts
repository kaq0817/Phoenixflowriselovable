import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("Gemini API key not configured");

    const { listing } = await req.json();
    if (!listing) {
      return new Response(JSON.stringify({ error: "No listing provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You are an expert Etsy SEO optimizer. Given a listing's current title, description, tags, and materials, produce optimized versions that will improve search ranking and conversion.

Rules:
- Etsy titles: max 140 characters, front-load important keywords
- Tags: exactly 13 tags, each max 20 characters, no repeating words from title
- Description: compelling, benefit-focused, includes relevant keywords naturally
- Materials: accurate, specific materials list

GOOGLE MERCHANT CENTER & PLATFORM COMPLIANCE (CRITICAL):
- FOR CLOTHING/APPAREL ONLY: Color MUST be included as a tag. Color in the title is encouraged but not strictly required on Etsy. If the original title has a color, keep it.
- NEVER use special characters or symbols in titles, descriptions, tags, or materials. This includes: curly quotes, em dashes, en dashes, bullets, trademark symbols, arrows, stars, checkmarks, hearts, or ANY Unicode decorative characters.
- Only use plain ASCII characters: regular quotes (" "), hyphens (-), commas, periods, parentheses, forward slashes, ampersands (&), and plus signs (+).
- No ALL CAPS words (except material acronyms like "PLA" or "UV").
- No promotional text in titles (e.g. "FREE SHIPPING", "SALE", "BEST SELLER").
- No excessive punctuation (!!!, ???, ...).
- Descriptions must be factual and accurate — no exaggerated claims.

Return your optimizations using the suggest_optimizations function.`;

    const userPrompt = `Optimize this Etsy listing:

Title: ${listing.title || ""}
Description: ${listing.description || ""}
Tags: ${(listing.tags || []).join(", ")}
Materials: ${(listing.materials || []).join(", ")}

Category: ${listing.taxonomy_path || "Unknown"}`;

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
                  name: "suggest_optimizations",
                  description: "Return optimized listing fields",
                  parameters: {
                    type: "object",
                    properties: {
                      title: { type: "string", description: "Optimized title (max 140 chars)" },
                      description: { type: "string", description: "Optimized description" },
                      tags: { type: "array", items: { type: "string" }, description: "Exactly 13 optimized tags" },
                      materials: { type: "array", items: { type: "string" }, description: "Optimized materials list" },
                      reasoning: { type: "string", description: "Brief explanation of changes made" },
                    },
                    required: ["title", "description", "tags", "materials", "reasoning"],
                  },
                },
              ],
            },
          ],
          toolConfig: {
            functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["suggest_optimizations"] },
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
      throw new Error(`AI optimization failed (${response.status}): ${errText.slice(0, 300)}`);
    }

    const data = await response.json();
    const functionCall = data.candidates?.[0]?.content?.parts?.find((p: any) => p.functionCall);
    if (!functionCall) {
      console.error("Gemini response missing function call:", JSON.stringify(data).slice(0, 2000));
      throw new Error("AI returned an unexpected format");
    }

    const suggestions = functionCall.functionCall.args;

    return new Response(JSON.stringify({ suggestions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("optimize-etsy-listing error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});




