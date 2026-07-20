import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";
import {
  normalizeEtsySuggestions,
  type EtsyListingLike,
  type EtsySuggestionShape,
} from "../_shared/listingValidators.ts";
import {
  getGoogleTrendsMulti,
  formatTrendsForPrompt,
  extractTrendSeeds,
} from "../_shared/googleTrends.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

interface GeminiFunctionCallPart {
  functionCall?: {
    args?: EtsySuggestionShape;
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

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    const [{ data: isAdmin }, { data: profile }] = await Promise.all([
      supabaseAdmin.rpc("has_role", { _user_id: userData.user.id, _role: "admin" }),
      supabaseAdmin.from("profiles").select("subscription_status").eq("id", userData.user.id).single(),
    ]);

    const isSubscribed = profile?.subscription_status === "active" || profile?.subscription_status === "trialing";

    if (!isAdmin && !isSubscribed) {
      return new Response(JSON.stringify({ error: "subscription_required" }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("Gemini API key not configured");

    const { listing } = await req.json() as { listing?: EtsyListingLike };
    if (!listing) {
      return new Response(JSON.stringify({ error: "No listing provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Google Trends: fetch real buyer search data ───────────────────────────
    // Run trends lookup in parallel with nothing — it's fast and cached after
    // the first call for that keyword. Falls back silently if Google is slow.
    const trendSeeds = extractTrendSeeds(
      listing.taxonomy_path ?? "",
      listing.title ?? "",
      listing.taxonomy_path ?? "",
    );

    const trendsResults = await getGoogleTrendsMulti(trendSeeds, "US");
    const trendsBlock = formatTrendsForPrompt(trendsResults);
    // ─────────────────────────────────────────────────────────────────────────

    const systemPrompt = `You are a sales machine for Etsy. Your job is to find the exact words a real buyer types into Etsy and Google when they are ready to spend money, and build every field around those words so this product appears in front of that buyer and they click.

${trendsBlock ? trendsBlock + "\n\n" : ""}KEYWORD STRATEGY (do this first):
Identify ONE primary keyword — the exact 3-5 word phrase a ready-to-buy shopper would type. Target phrases with realistic Etsy competition: specific enough that big sellers are not dominating it, popular enough that real buyers search it. The primary keyword MUST appear at the start of the title and woven into the first sentence of the description.

TITLE RULES:
- Max 140 characters. The first 50-60 characters are all buyers see in search — make them count.
- Lead with the item name and its most important trait (color, material, occasion, or style).
- Do NOT cram every keyword variation into the title — one clear phrase beats five weak ones.
- No brand names, no promotional text (FREE SHIPPING, SALE, BEST SELLER), no ALL CAPS.
- No special characters: no curly quotes, em dashes, bullets, hearts, stars, or any Unicode symbols.
- Plain ASCII only: straight quotes, hyphens, commas, periods, parentheses, slashes, &, +.

TAGS (exactly 13, each max 20 characters INCLUDING spaces):
- Every tag must be a phrase a real buyer would type into Etsy or Google search.
- Prioritize any Rising or Breakout queries from the Google Trends data above — these are what buyers are searching RIGHT NOW.
- Mix tag lengths: 40% should be 3-4 word long-tail phrases (highest conversion), 40% should be 2-3 word mid-tail, 20% can be precise single words (a material, color, or niche term — not generic).
- No duplicate intent: do not create tags that swap word order of the same phrase.
- For apparel/clothing: color MUST appear as at least one tag.
- Every tag must be under 20 characters. Count carefully — "gaming wall art" is 15 chars (ok), "personalized gift" is 17 chars (ok), "custom name wall decor" is 22 chars (too long, cut it).
- No promotional words: sale, cheap, free, discount, deal, new, best, hot.

DESCRIPTION:
- Write like a real seller talking to one buyer, not a bot filling in a template. You know this item and you're telling them the specific reason they need it — not reciting a spec sheet.
- DESIGN SELLS THE PRODUCT, NOT THE MATERIAL: If this listing's appeal is a printed design, graphic, quote, joke, or theme (mug, shirt, ornament, sticker, etc.), lead with why THAT design is cute, funny, or exactly right for the person who'd want it — not the ceramic or fabric it's printed on. Name the specific identity or interest it speaks to.
- PERSONALIZED LISTINGS — THE PERSONALIZATION IS THE STORY: If the title, description, or materials indicate this item accepts a custom name, text, or photo (pillow, blanket, ornament, sign, mug, etc.), that personalization is the emotional core of the listing, not a feature buried in a bullet. Open by naming the specific reason a buyer wants their own name/photo/words on this item — a keepsake, a gift that couldn't be for anyone else, something that makes it theirs — not a generic rundown of the blank product. Be precise about who does the work: the buyer submits or picks what goes on it; the seller prints/produces it. Never phrase it as if the buyer does the customizing themselves ("you customize it," "personalize it yourself") — say "send us the name," "printed with the name you choose," or "your photo, printed on it" instead.
- COLLECTOR ANGLE: If the design is part of a themed or ongoing series, speak to the buyer who collects these — inviting, enthusiastic direct-address lines are welcome ("look no further," "add this to your collection," "your first or your tenth, it earns its spot") as long as they're specific to this design, not generic filler.
- First sentence must name the item clearly, include the primary keyword, and say in plain language why this buyer needs it.
- Put buying-critical details near the top: size, material, color, customization options, production time.
- 600-900 characters. Short paragraphs or bullets for readability. Vary sentence length like real speech.
- Work secondary keywords in naturally — do not repeat the title verbatim.
- BANNED PATTERNS: "elevate your", "whether you're X or Y", "in today's world" — generic filler that could describe any product. Hype tied to something specific about THIS design is good; hype tied to nothing is not.
- End with either a practical note (shipping estimate, care instructions, personalization process) or one honest, enthusiastic closing line on why they'll be glad they bought it — whichever fits the product better.
- No special characters. Plain ASCII only.

MATERIALS: Accurate, specific list. Real fiber contents and percentages if known.

In reasoning: name the primary keyword you chose, list which Google Trends signals you used, and explain any tags you pivoted away from the original.`;

    const userPrompt = `Optimize this Etsy listing:

Title: ${listing.title ?? ""}
Description: ${listing.description ?? ""}
Tags: ${(listing.tags ?? []).join(", ")}
Materials: ${(listing.materials ?? []).join(", ")}
Category: ${listing.taxonomy_path ?? "Unknown"}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
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
                      title: { type: "string", description: "Optimized title (max 140 chars, first 50-60 chars are what buyers see)" },
                      description: { type: "string", description: "Optimized description 600-900 characters, buyer-intent focused" },
                      tags: { type: "array", items: { type: "string" }, description: "Exactly 13 tags, each max 20 characters, real buyer search phrases" },
                      materials: { type: "array", items: { type: "string" }, description: "Accurate materials list" },
                      reasoning: { type: "string", description: "Primary keyword chosen, Google Trends signals used, tags pivoted" },
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
      },
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
    const functionCall = data.candidates?.[0]?.content?.parts?.find(
      (part: GeminiFunctionCallPart) => part.functionCall,
    ) as GeminiFunctionCallPart | undefined;

    if (!functionCall?.functionCall?.args) {
      console.error("Gemini response missing function call:", JSON.stringify(data).slice(0, 2000));
      throw new Error("AI returned an unexpected format");
    }

    const suggestions = normalizeEtsySuggestions(listing, functionCall.functionCall.args);

    return new Response(JSON.stringify({ suggestions, trendsUsed: trendsResults.filter(r => r.source === "google_trends").map(r => r.keyword) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("optimize-etsy-listing error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
