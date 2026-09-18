import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

const CARD_PROMPTS: Record<string, string> = {
  features: `You are a copywriter for ecommerce product listings (Etsy or Shopify). Given a product name, write 5 short, compelling feature bullet points for a "Made With Care" listing card image. Each bullet must be under 60 characters. Focus on quality, personalization, packaging, speed, and satisfaction. Return ONLY valid JSON: {"heading":"Made With Care","b1":"...","b2":"...","b3":"...","b4":"...","b5":"..."}`,
  social: `You are a copywriter for ecommerce product listings (Etsy or Shopify). Given a product name, write a single glowing 1–2 sentence customer review quote for a "Customer Love" listing card. Make it feel genuine and specific. Return ONLY valid JSON: {"heading":"Customer Love","stars":"5","quote":"...","reviewer":""}`,
  promise: `You are a copywriter for ecommerce product listings (Etsy or Shopify). Given a product name, write a warm 2–3 sentence satisfaction guarantee for an "Our Promise" listing card. Sound personal and reassuring. Return ONLY valid JSON: {"heading":"Our Promise To You","body":"...","sub":"Your satisfaction is our priority — always."}`,
  shipping: `You are a copywriter for ecommerce product listings (Etsy or Shopify). Given a product name, write a note explaining made-to-order production for a "Shipping Info" listing card. Keep the note under 80 characters. Return ONLY valid JSON: {"heading":"When Will It Arrive?","production":"2–3","transit":"3–7","note":"..."}`,
  variations: `You are a copywriter for ecommerce product listings (Etsy or Shopify). Given a product name, suggest 4 realistic product variation labels for a "Design Options" listing card. Keep each label under 25 characters. Return ONLY valid JSON: {"heading":"Design Options","varA":"...","varB":"...","varC":"...","varD":"...","note":"See all listing photos for full details"}`,
};

serve(async (req: Request) => {
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
    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { cardType, productName } = await req.json();
    if (!cardType || !productName) {
      return new Response(JSON.stringify({ error: "cardType and productName are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = CARD_PROMPTS[cardType];
    if (!systemPrompt) {
      return new Response(JSON.stringify({ error: "Unknown card type" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("Gemini API key not configured");

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: `Product name: ${productName.slice(0, 200)}` }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 512 },
        }),
      }
    );

    if (!geminiRes.ok) {
      const err = await geminiRes.text();
      throw new Error(`Gemini error: ${err.slice(0, 200)}`);
    }

    const geminiData = await geminiRes.json();
    const raw = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    // Strip markdown fences if present
    const cleaned = raw.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();

    let content: Record<string, string>;
    try {
      content = JSON.parse(cleaned);
    } catch {
      throw new Error("Gemini returned invalid JSON — please try again");
    }

    return new Response(JSON.stringify({ content }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : "Card copy generation failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
