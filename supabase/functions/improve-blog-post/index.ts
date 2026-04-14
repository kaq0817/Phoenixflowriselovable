import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function wordCount(html: string): number {
  return stripHtml(html).split(/\s+/).filter(Boolean).length;
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
      bodyHtml,
      summaryHtml,
      title,
      tags,
      storeDomain,
      opportunities,
      focus,
    } = await req.json() as {
      bodyHtml: string;
      summaryHtml: string;
      title: string;
      tags: string;
      storeDomain?: string;
      opportunities?: string[];
      focus?: string;
    };

    if (!bodyHtml && !summaryHtml) {
      return new Response(JSON.stringify({ error: "No blog content provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const words = wordCount(bodyHtml || "");
    const isThin = words < 300;
    const hasProductLink = /\/products\//i.test(bodyHtml || "");
    const hasCta = /\b(shop now|get yours|buy now|order now|check it out|grab yours|try it|see it here|view the collection)\b/i.test(bodyHtml || "");

    const opportunityNotes: string[] = opportunities ?? [];
    if (isThin && !opportunityNotes.includes("thin_content")) opportunityNotes.push("thin_content");
    if (!hasProductLink && !opportunityNotes.includes("no_product_link")) opportunityNotes.push("no_product_link");
    if (!hasCta && !opportunityNotes.includes("no_cta")) opportunityNotes.push("no_cta");

    const fixDirections: string[] = [];
    if (opportunityNotes.includes("thin_content")) {
      fixDirections.push(`- THIN CONTENT: This post is only ~${words} words. Expand it to at least 400-600 words with more detail, storytelling, or context. DO NOT pad with filler — add genuine value.`);
    }
    if (opportunityNotes.includes("no_product_link")) {
      fixDirections.push(`- ADD PRODUCT LINK: Naturally work in a link to a relevant product on the store${storeDomain ? ` (${storeDomain})` : ""}. Use <a href="/products/HANDLE">product name</a> format with a real-sounding handle. Place it where it fits the story organically — not forced.`);
    }
    if (opportunityNotes.includes("no_cta")) {
      fixDirections.push(`- CALL TO ACTION: Add a natural, low-pressure CTA near the end. Something like "Check out our [product name]" or "See the full collection." It should feel like a recommendation, not an ad.`);
    }
    if (opportunityNotes.includes("missing_tags")) {
      fixDirections.push(`- TAGS: The article has very few tags. Return 5-8 relevant keyword tags for this post in the improved_tags field.`);
    }

    const focusNote = focus ? `\nUser request: ${focus}\n` : "";

    const systemPrompt = `You are an expert blog editor for e-commerce stores. You improve blog posts to drive more organic search traffic and convert readers into buyers — without sounding like a sales pitch.

YOUR RULES:
1. Preserve the original voice, tone, and story. Do NOT rewrite from scratch unless the content is essentially empty.
2. Keep all personal stories, emotional narrative, and authentic moments intact. A story about someone fighting cancer, a love letter, a travel adventure — these are ASSETS, not problems. Protect them.
3. Fix HTML structure: use only <h2>, <h3>, <p>, <ul>, <li>, <ol>, <strong>, <em>, <a>, <blockquote>. Remove any data-start, data-end, or data-sourcepos attributes.
4. NEVER add medical claims. NEVER flag or remove personal stories. NEVER strip editorial outbound links.
5. If the content is mostly fine, make only the specific improvements listed below. Don't over-edit.
${focusNote}
SPECIFIC IMPROVEMENTS NEEDED:
${fixDirections.length > 0 ? fixDirections.join("\n") : "- Light polish: improve readability, fix any awkward phrasing, ensure clean HTML structure."}

OUTPUT: Return a JSON object with these fields:
- improved_body_html: the improved full post HTML
- improved_summary_html: a 1-2 sentence HTML summary of the post (use <p> tags only)
- improved_tags: comma-separated keyword tags (return existing tags if no changes needed)
- reasoning: 1-2 sentences explaining what you changed and why`;

    const userPrompt = `Article title: ${title || "Untitled"}
Current tags: ${tags || "none"}

CURRENT SUMMARY HTML:
${summaryHtml || "(empty)"}

CURRENT BODY HTML:
${bodyHtml || "(empty)"}

Improve this blog post per the system instructions. Return valid JSON only — no markdown, no code fences.`;

    let result: {
      improved_body_html: string;
      improved_summary_html: string;
      improved_tags: string;
      reasoning: string;
    } | null = null;

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-04-17:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: systemPrompt + "\n\n" + userPrompt }] }],
            generationConfig: {
              temperature: 0.4,
              maxOutputTokens: 4096,
              responseMimeType: "application/json",
            },
          }),
        },
      );

      if (response.ok) {
        const data = await response.json();
        const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
        // Strip any accidental code fences
        const cleaned = raw.replace(/^```json?\s*/i, "").replace(/```\s*$/, "").trim();
        result = JSON.parse(cleaned);
      } else {
        const errText = await response.text();
        console.error("Gemini error:", response.status, errText.slice(0, 300));
      }
    } catch (err) {
      console.error("Gemini request failed:", err);
    }

    if (!result) {
      return new Response(JSON.stringify({ error: "AI improvement failed — try again" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        improvedBodyHtml: result.improved_body_html || bodyHtml,
        improvedSummaryHtml: result.improved_summary_html || summaryHtml,
        improvedTags: result.improved_tags || tags,
        reasoning: result.reasoning || "",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("improve-blog-post error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
