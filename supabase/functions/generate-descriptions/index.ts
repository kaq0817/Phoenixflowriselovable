import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

interface ProductSlot {
  id: string;
  title: string;
  features: string;
}

const HEALTH_KEYWORDS = [
  "protein", "shake", "supplement", "wellness", "coffee", "ashwagandha",
  "berberine", "soap", "tea", "capsule", "fusion", "vitality", "vitamin",
  "probiotic", "collagen", "cbd", "hemp",
];

function needsFdaDisclaimer(title: string): boolean {
  return HEALTH_KEYWORDS.some((k) => title.toLowerCase().includes(k));
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
    if (!GEMINI_API_KEY) throw new Error("Gemini API key not configured");

    const { products, globalContext } = await req.json() as {
      products: ProductSlot[];
      globalContext?: string;
    };

    const active = (products || []).filter((p) => p.title.trim());
    if (active.length === 0) {
      return new Response(JSON.stringify({ error: "No products provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results = await Promise.all(active.map(async (product) => {
      const fda = needsFdaDisclaimer(product.title);

      const prompt = `You are a Google Merchant Center (GMC) compliance expert writing Shopify product descriptions.

RULES — follow every one:
- Use ONLY physical attributes: material, size, quantity, color, weight, age group, country of origin.
- NO marketing fluff: no "best", "amazing", "revolutionary", "premium quality" without a spec to back it up.
- NO all-caps words (except acronyms like USA, FDA, UV).
- NO exclamation points.
- Descriptions must be factual. Write what it IS, not what it DOES to the buyer.
- HTML only. Allowed tags: <h3>, <p>, <ul>, <li>, <strong>. Nothing else.
- Structure: <h3> product name, <p> one-sentence factual summary, <ul> 4-6 spec bullets, optional FDA notice.${fda ? `
- REQUIRED: End with this exact FDA disclaimer paragraph: <p><em>*These statements have not been evaluated by the Food and Drug Administration. This product is not intended to diagnose, treat, cure, or prevent any disease.</em></p>` : ""}

${globalContext ? `Brand tone / context: ${globalContext}` : ""}
Product title: ${product.title}
Features / attributes: ${product.features || "Not provided"}

Output raw HTML only. No markdown, no code fences, no explanation.`;

      let html = "";
      let error = "";

      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
            }),
          }
        );

        if (response.ok) {
          const data = await response.json();
          html = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
          // Strip any code fences Gemini sometimes adds
          html = html.replace(/^```html?\s*/i, "").replace(/```\s*$/, "").trim();
        } else {
          const errText = await response.text();
          error = `Gemini error ${response.status}: ${errText.slice(0, 150)}`;
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }

      if (!html) {
        // Minimal compliant fallback
        const bullets = product.features
          ? product.features.split(/[,\n]/).map((f) => f.trim()).filter(Boolean).slice(0, 6).map((f) => `<li>${f}</li>`).join("")
          : "<li>See product images for full specifications</li>";
        html = `<h3>${product.title}</h3><p>${product.title}. See specifications below.</p><ul>${bullets}</ul>${fda ? '<p><em>*These statements have not been evaluated by the Food and Drug Administration. This product is not intended to diagnose, treat, cure, or prevent any disease.</em></p>' : ""}`;
      }

      return { title: product.title, content: html, error };
    }));

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
