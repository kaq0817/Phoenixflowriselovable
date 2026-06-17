import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";
import { buildDescriptionPrompt, normalizeGeneratedHtml } from "./prompt.ts";

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

      const prompt = buildDescriptionPrompt({
        title: product.title,
        features: product.features || "Not provided",
        globalContext,
        requiresFdaDisclaimer: fda,
      });

      let html = "";
      let error = "";

      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-04-17:generateContent?key=${GEMINI_API_KEY}`,
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
          html = normalizeGeneratedHtml(html, product.title, product.features || "", fda);
        } else {
          const errText = await response.text();
          error = `Gemini error ${response.status}: ${errText.slice(0, 150)}`;
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }

      if (!html) {
        html = normalizeGeneratedHtml(
          `<h3>${product.title}</h3><p>Details for this product are listed below.</p><ul>${(product.features || "")
            .split(/[\n,]/)
            .map((f) => f.trim())
            .filter(Boolean)
            .slice(0, 6)
            .map((f) => `<li>${f}</li>`)
            .join("") || "<li>See product details for full specifications.</li>"}</ul><p>Use this information to confirm fit, size, and everyday use.</p>`,
          product.title,
          product.features || "",
          fda,
        );
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
