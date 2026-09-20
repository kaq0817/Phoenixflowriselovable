import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

// Appended to every card prompt below — the actual bug being fixed here: the model
// used to get nothing but a bare product name, so it wrote generic boilerplate that
// could describe any product in the category ("Circle & Heart Shapes" on a comforter).
// Ground every card in the real product details actually supplied.
const GROUNDING_RULE = " Write at a 5th-grade reading level: short, everyday words and short sentences, nothing a shopper would have to look up (say 'soft' not 'plush', 'lasts a long time' not 'durable', 'made just for you after you order' not 'made-to-order production'). Every line must be TRUE for this specific product according to the supplied details AND must help a shopper decide. Sell the design and who it is for, not the plain blank item it is printed on: what the design says or shows, who would love it, and when they would wear or use it. Supplier details about the blank (fabric blend, weight, print method, brand or model of the blank) are background only and never the headline. Use only facts the details actually support. Do NOT mention gift boxes, packaging, personalization, custom names, free shipping, guarantees, or shipping speed unless the details explicitly say so. Write for a shopper, not a designer or a printer: never use production or print-process jargon (DTG, direct-to-garment, DTF, sublimation, screen printing, CMYK, DPI, GSM, ring-spun, thread count, blank or brand model numbers, print-on-demand). Say what the shopper will see and feel instead, for example 'crisp, vivid print', and only when the details support it; if a detail is only about how it is made, leave it out. Sound like a friendly person talking to a shopper: warm, simple, specific, with the benefit first and about 6 to 10 words per line ('A bold design people will ask about' beats 'eye-catching graphic'; 'Easy to wear every day' beats 'versatile casual apparel'). Those examples show the tone only. Never copy their wording unless it is true for this product. No empty filler ('made with care', 'premium quality', 'built to last') without a concrete fact behind it. If the details support fewer points than requested, return fewer and leave the unused fields as empty strings — never pad or invent.";

const CARD_PROMPTS: Record<string, string> = {
  features: `You are a copywriter for ecommerce product listings (Etsy or Shopify). Given a product name and details, write 5 short, compelling feature bullet points for a "Made With Care" listing card image. Each bullet must be under 60 characters. Choose the points that matter most to a buyer of this specific item (the design or theme on it, who it is for, when they would wear or use it, and its real options). The plain blank item is background, not the product.${GROUNDING_RULE} Return ONLY valid JSON: {"heading":"Made With Care","b1":"...","b2":"...","b3":"...","b4":"...","b5":"..."}`,
  // Deliberately NOT a fabricated customer review/testimonial — presenting invented
  // quotes with a star rating and reviewer attribution as if they were real customer
  // feedback is a fake-testimonial problem (FTC/platform policy), not just a style
  // choice. This card is openly seller-voice enthusiasm, not pretend social proof.
  social: `You are a copywriter for ecommerce product listings (Etsy or Shopify). Given a product name and details, write one short, genuinely enthusiastic 1-2 sentence line in the SELLER'S OWN VOICE about why this specific item is worth loving — not a fabricated customer quote, not attributed to any reviewer, and no star rating. This must read as the brand's own excitement about this item, not an invented testimonial pretending to be someone else's words.${GROUNDING_RULE} Return ONLY valid JSON: {"heading":"Why You'll Love It","quote":"..."}`,
  promise: `You are a copywriter for ecommerce product listings (Etsy or Shopify). Given a product name and details, write a warm 2–3 sentence promise for an "Our Promise" listing card that says the buyer can tell you if they are not happy and you will make it right. Sound personal and reassuring.${GROUNDING_RULE} Return ONLY valid JSON: {"heading":"Our Promise To You","body":"...","sub":"We want you to be happy."}`,
  shipping: `You are a copywriter for ecommerce product listings (Etsy or Shopify). Given a product name and details, write a note explaining made-to-order production for a "Shipping Info" listing card. Keep the note under 80 characters.${GROUNDING_RULE} Return ONLY valid JSON: {"heading":"When Will It Arrive?","production":"2–3","transit":"3–7","note":"..."}`,
  variations: `You are a copywriter for ecommerce product listings (Etsy or Shopify). Given a product name and details, list this product's REAL options (for example colors or styles) taken only from the Options line in the details, as up to 4 labels for a "Design Options" listing card, each under 25 characters. If the details list no real options other than sizes, return empty strings for varA, varB, varC and varD — never invent variations.${GROUNDING_RULE} Return ONLY valid JSON: {"heading":"Design Options","varA":"...","varB":"...","varC":"...","varD":"...","note":"See all listing photos for full details"}`,
};

// Which fields each card type is allowed to carry back. The all-cards response is
// trimmed to exactly these so a stray or misspelled key from the model can't leak
// into a card.
const ALLOWED_KEYS: Record<string, string[]> = {
  features: ["heading", "b1", "b2", "b3", "b4", "b5"],
  social: ["heading", "quote"],
  promise: ["heading", "body", "sub"],
  shipping: ["heading", "production", "transit", "note"],
  variations: ["heading", "varA", "varB", "varC", "varD", "note"],
};

// One call that writes all five cards. Sending the product details once instead of
// five times is cheaper and faster, and because the model sees the whole set it can
// keep the cards from repeating each other.
const ALL_CARDS_PROMPT = `You are a copywriter for ecommerce product listings (Etsy or Shopify). Given a product name and details, write the copy for a set of FIVE listing cards in one pass so they work together and never repeat each other.
- features ("Made With Care"): 5 short, compelling feature bullets, each under 60 characters. Choose the points that matter most to a buyer of this specific item (the design or theme on it, who it is for, when they would wear or use it, and its real options). The plain blank item is background, not the product.
- social ("Why You'll Love It"): one short, genuinely enthusiastic 1-2 sentence line in the SELLER'S OWN VOICE about why this specific item is worth loving. Not a fabricated customer quote, not attributed to any reviewer, no star rating.
- promise ("Our Promise To You"): a warm 2-3 sentence satisfaction guarantee that sounds personal and reassuring.
- shipping ("When Will It Arrive?"): a note under 80 characters explaining made-to-order production. Keep production and transit exactly as in the template below.
- variations ("Design Options"): this product's REAL options (colors or styles) taken only from the Options line in the details, up to 4 labels each under 25 characters. If there are no real options other than sizes, return empty strings for varA-varD. Never invent variations.${GROUNDING_RULE} Return ONLY valid JSON in exactly this shape: {"features":{"heading":"Made With Care","b1":"...","b2":"...","b3":"...","b4":"...","b5":"..."},"social":{"heading":"Why You'll Love It","quote":"..."},"promise":{"heading":"Our Promise To You","body":"...","sub":"We want you to be happy."},"shipping":{"heading":"When Will It Arrive?","production":"2–3","transit":"3–7","note":"..."},"variations":{"heading":"Design Options","varA":"...","varB":"...","varC":"...","varD":"...","note":"See all listing photos for full details"}}`;

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

    const { cardType, productName, productDetails } = await req.json();
    if (!cardType || !productName) {
      return new Response(JSON.stringify({ error: "cardType and productName are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isAll = cardType === "all";
    const systemPrompt = isAll ? ALL_CARDS_PROMPT : CARD_PROMPTS[cardType];
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
          contents: [{ role: "user", parts: [{ text: `Product name: ${productName.slice(0, 200)}\nProduct details: ${typeof productDetails === "string" && productDetails.trim() ? productDetails.trim().slice(0, 1500) : "none provided — stay honestly generic, do not invent specifics"}` }] }],
          generationConfig: isAll
            ? { temperature: 0.7, maxOutputTokens: 1400, responseMimeType: "application/json" }
            : { temperature: 0.7, maxOutputTokens: 512 },
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

    if (isAll) {
      let parsed: Record<string, Record<string, unknown>>;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        throw new Error("Gemini returned invalid JSON — please try again");
      }
      const contents: Record<string, Record<string, string>> = {};
      for (const [type, keys] of Object.entries(ALLOWED_KEYS)) {
        const card = parsed?.[type];
        if (!card || typeof card !== "object") continue;
        const clean: Record<string, string> = {};
        for (const key of keys) {
          const value = card[key];
          if (typeof value === "string") clean[key] = value.trim();
        }
        if (Object.keys(clean).length) contents[type] = clean;
      }
      if (!Object.keys(contents).length) throw new Error("Gemini returned no usable card copy — please try again");
      return new Response(JSON.stringify({ contents }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
