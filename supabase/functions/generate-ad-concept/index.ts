import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

interface AdRequestItem {
  title?: string;
  description?: string;
  productType?: string;
  vendor?: string;
  tags?: string[];
  materials?: string[];
  keyFeatures?: string[];
  variants?: string[];
  imageCount?: number;
  hasAltText?: boolean;
}

interface ShotPlanStep {
  timecode: string;
  visual: string;
  on_screen_text: string;
  voiceover: string;
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

    const {
      platform = "manual",
      item,
      brandGoal = "",
      audience = "",
      offer = "",
      tone = "",
      callToAction = "",
    } = await req.json();

    if (!item?.title) {
      return new Response(JSON.stringify({ error: "A product or listing title is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizedItem = item as AdRequestItem;

    const systemPrompt = `You create short-form ecommerce ad concepts for Shopify and Etsy sellers.

Your job is to generate a truthful, usable 8-second ad concept that highlights the strongest parts of a product.

CRITICAL TRUTH RULES:
- Do NOT invent people using the product, hands-on demonstrations, outdoor scenes, or lifestyle shots unless they are explicitly supported by the provided product information.
- Prefer product-only creative: close-ups, texture shots, packaging, details, materials, before/after framing, feature callouts, and clean motion from existing product media.
- Never imply outcomes, certifications, guarantees, or product capabilities that are not present in the source material.
- Keep the ad grounded in what a seller can actually create from catalog photos or simple product footage.
- The ad must total 8 seconds.
- Make the concept feel shareable and compelling without becoming fake.
- Use plain ASCII only.

OUTPUT RULES:
- Write for short-form social ads.
- Prioritize the best parts of the item: design, texture, material, finish, problem solved, standout feature, or giftability.
- Keep on-screen text concise.
- Keep voiceover optional but usable.
- Provide exactly 4 shot plan steps, each covering 2 seconds.

Return the result using the generate_ad_concept function.`;

    const userPrompt = `Generate a truthful 8-second ad concept.

Platform: ${platform}
Title: ${normalizedItem.title || ""}
Description: ${normalizedItem.description || ""}
Product Type: ${normalizedItem.productType || ""}
Vendor/Brand: ${normalizedItem.vendor || ""}
Tags: ${(normalizedItem.tags || []).join(", ")}
Materials: ${(normalizedItem.materials || []).join(", ")}
Key Features: ${(normalizedItem.keyFeatures || []).join(", ")}
Variants: ${(normalizedItem.variants || []).join(", ")}
Image Count: ${normalizedItem.imageCount ?? 0}
Has Alt Text: ${normalizedItem.hasAltText ? "yes" : "no"}
Brand Goal: ${brandGoal}
Target Audience: ${audience}
Offer or Promo: ${offer}
Preferred Tone: ${tone}
Call To Action: ${callToAction}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": GEMINI_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
          tools: [
            {
              functionDeclarations: [
                {
                  name: "generate_ad_concept",
                  description: "Return a truthful 8-second ad concept for a product or listing",
                  parameters: {
                    type: "object",
                    properties: {
                      headline: { type: "string", description: "Short internal concept title" },
                      angle: { type: "string", description: "Primary creative angle" },
                      hook: { type: "string", description: "Opening hook for the ad" },
                      visual_style: { type: "string", description: "Recommended visual style" },
                      script: { type: "string", description: "Full 8-second script block" },
                      voiceover: { type: "string", description: "Optional concise voiceover" },
                      caption: { type: "string", description: "Social caption for the ad" },
                      cta: { type: "string", description: "Call to action line" },
                      compliance_notes: { type: "string", description: "Short note on how the concept stays truthful and non-fake" },
                      reasoning: { type: "string", description: "Why this concept fits the product" },
                      asset_checklist: {
                        type: "array",
                        items: { type: "string" },
                        description: "Assets needed to produce the ad"
                      },
                      shot_plan: {
                        type: "array",
                        minItems: 4,
                        maxItems: 4,
                        items: {
                          type: "object",
                          properties: {
                            timecode: { type: "string" },
                            visual: { type: "string" },
                            on_screen_text: { type: "string" },
                            voiceover: { type: "string" }
                          },
                          required: ["timecode", "visual", "on_screen_text", "voiceover"]
                        },
                        description: "Exactly 4 shots covering 8 seconds total"
                      }
                    },
                    required: [
                      "headline",
                      "angle",
                      "hook",
                      "visual_style",
                      "script",
                      "voiceover",
                      "caption",
                      "cta",
                      "compliance_notes",
                      "reasoning",
                      "asset_checklist",
                      "shot_plan"
                    ]
                  }
                }
              ]
            }
          ],
          toolConfig: {
            functionCallingConfig: {
              mode: "ANY",
              allowedFunctionNames: ["generate_ad_concept"],
            },
          },
        }),
      },
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const errText = await response.text();
      console.error("Gemini error:", response.status, errText);
      throw new Error(`Ad generation failed (${response.status}): ${errText.slice(0, 300)}`);
    }

    const data = await response.json();
    const partWithFunctionCall = data.candidates?.[0]?.content?.parts?.find(
      (part: { functionCall?: { args: unknown } }) => part.functionCall,
    );

    if (!partWithFunctionCall?.functionCall?.args) {
      console.error("Gemini response missing function call:", JSON.stringify(data).slice(0, 2000));
      throw new Error("AI returned an unexpected format");
    }

    const adConcept = partWithFunctionCall.functionCall.args as {
      shot_plan?: ShotPlanStep[];
    } & Record<string, unknown>;

    if (!Array.isArray(adConcept.shot_plan) || adConcept.shot_plan.length !== 4) {
      throw new Error("AI returned an invalid shot plan");
    }

    return new Response(JSON.stringify({ adConcept }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("generate-ad-concept error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
