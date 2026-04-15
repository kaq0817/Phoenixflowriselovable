import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";

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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { url: storeUrl } = await req.json();
    if (!storeUrl) {
      return new Response(JSON.stringify({ error: "Store URL is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    if (!FIRECRAWL_API_KEY) throw new Error("Firecrawl is not configured");

    let formattedUrl = storeUrl.trim();
    if (!formattedUrl.startsWith("http://") && !formattedUrl.startsWith("https://")) {
      formattedUrl = `https://${formattedUrl}`;
    }

    console.log("Theme audit - scraping:", formattedUrl);

    // Step 1: Scrape with branding + HTML formats for color/theme extraction
    const scrapeRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: formattedUrl,
        formats: ["markdown", "html", "links", "branding"],
        onlyMainContent: false,
        waitFor: 3000,
      }),
    });

    if (!scrapeRes.ok) {
      const errText = await scrapeRes.text();
      console.error("Firecrawl scrape failed:", errText);
      return new Response(JSON.stringify({ error: "Failed to scrape website" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const scrapeData = await scrapeRes.json();
    const pageContent = scrapeData.data?.markdown || scrapeData.markdown || "";
    const pageHtml = scrapeData.data?.html || scrapeData.html || "";
    const branding = scrapeData.data?.branding || scrapeData.branding || {};
    const links = scrapeData.data?.links || scrapeData.links || [];
    const metadata = scrapeData.data?.metadata || scrapeData.metadata || {};

    console.log("Branding extracted:", JSON.stringify(branding).slice(0, 500));

    // Step 2: AI Analysis
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("Gemini API key not configured");

    const systemPrompt = `You are an expert e-commerce theme auditor specializing in WCAG color compliance, site speed, SEO, and GMC readiness.

Analyze the provided website's theme, colors, structure, and content. Return a comprehensive theme audit covering the following categories:

## COLOR & CONTRAST COMPLIANCE (WCAG 2.1)
Check all color combinations against WCAG standards:
- **WCAG AA**: Minimum contrast ratio 4.5:1 for normal text, 3:1 for large text (18px+ or 14px+ bold)
- **WCAG AAA**: Enhanced contrast ratio 7:1 for normal text, 4.5:1 for large text
- Check primary text on background colors
- Check button text on button backgrounds
- Check link colors against backgrounds
- Check any colored text/badges
- Flag any color combinations that fail AA or AAA
- Identify if the site uses sufficient color differentiation (not relying on color alone for info)

## SPEED & PERFORMANCE
- Large unoptimized images detected in HTML
- Excessive external scripts/stylesheets
- Missing lazy loading on images
- Missing image dimensions (width/height attributes)
- Render-blocking resources
- Font loading strategy (display: swap, preload)

## SEO META
- Title tag present and under 60 chars
- Meta description present and under 160 chars
- Single H1 tag
- Proper heading hierarchy (H1 > H2 > H3)
- Alt text on images
- Canonical tag
- Open Graph tags (og:title, og:description, og:image)
- Structured data / JSON-LD
- Viewport meta tag

## LAYOUT & CONTENT (GMC-RELEVANT)
- Footer contains required links (privacy, terms, refund, shipping, contact)
- Header navigation includes About and Contact
- Logo quality and placement
- Mobile-responsive indicators
- Clear call-to-action buttons
- Product images meet quality standards
- Trust signals present (payment badges, security seals)
- Cookie consent / GDPR banner

## TYPOGRAPHY
- Font loading and readability
- Font sizes appropriate (body text 16px minimum recommended)
- Line height and spacing
- Font pairing harmony

Identify and categorize *all* potential issues or areas for improvement. Rate each finding as 'critical' (must be fixed, e.g., fails WCAG AA, major SEO error, or GMC compliance issue), 'warning' (should be addressed, e.g., fails WCAG AAA, significant best practice miss, or minor speed bottleneck), or 'info' (a suggestion for improvement or optimization). *Do not report 'pass' findings; only report actual issues or recommendations.*

Use the report_theme_audit tool to return your analysis.`;

    const userPrompt = `Analyze this store's theme and colors for compliance:

URL: ${formattedUrl}

=== BRANDING DATA (extracted) ===
${JSON.stringify(branding, null, 2)}

=== PAGE METADATA ===
Title: ${metadata.title || "Not found"}
Description: ${metadata.description || "Not found"}
Language: ${metadata.language || "Unknown"}

=== HTML (first 10000 chars for style/structure analysis) ===
${pageHtml.slice(0, 10000)}

=== MARKDOWN CONTENT ===
${pageContent.slice(0, 6000)}

=== LINKS FOUND ===
${links.slice(0, 40).join("\n")}`;

    const aiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent`,
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
                  name: "report_theme_audit",
                  description: "Return the theme audit report",
                  parameters: {
                    type: "object",
                    properties: {
                      overall_score: { type: "integer", description: "Overall theme compliance score 0-100" },
                      summary: { type: "string", description: "2-3 sentence executive summary" },
                      color_palette: {
                        type: "object",
                        properties: {
                          primary: { type: "string", description: "Primary color hex" },
                          secondary: { type: "string", description: "Secondary color hex" },
                          accent: { type: "string", description: "Accent color hex" },
                          background: { type: "string", description: "Background color hex" },
                          text: { type: "string", description: "Main text color hex" },
                        },
                        required: ["primary", "background", "text"],
                      },
                      contrast_checks: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            pair: { type: "string", description: "Color pair description" },
                            foreground: { type: "string", description: "Foreground color hex" },
                            background_color: { type: "string", description: "Background color hex" },
                            ratio: { type: "number", description: "Contrast ratio" },
                            wcag_aa: { type: "string", enum: ["pass", "fail"] },
                            wcag_aaa: { type: "string", enum: ["pass", "fail"] },
                          },
                          required: ["pair", "foreground", "background_color", "ratio", "wcag_aa", "wcag_aaa"],
                        },
                      },
                      findings: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            category: {
                              type: "string",
                              enum: ["color_contrast", "speed", "seo", "layout", "typography"],
                            },
                            severity: { type: "string", enum: ["critical", "warning", "info"] }, // 'pass' removed
                            title: { type: "string" },
                            description: { type: "string" },
                            recommendation: { type: "string" },
                          },
                          required: ["category", "severity", "title", "description", "recommendation"],
                        },
                      },
                      category_scores: {
                        type: "object",
                        properties: {
                          color_contrast: { type: "integer" },
                          speed: { type: "integer" },
                          seo: { type: "integer" },
                          layout: { type: "integer" },
                          typography: { type: "integer" },
                        },
                        required: ["color_contrast", "speed", "seo", "layout", "typography"],
                      },
                    },
                    required: ["overall_score", "summary", "color_palette", "contrast_checks", "findings", "category_scores"],
                  },
                },
              ],
            },
          ],
          toolConfig: {
            functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["report_theme_audit"] },
          },
        }),
      }
    );

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("Gemini error:", aiResponse.status, errText);
      throw new Error("AI analysis failed");
    }

    const aiData = await aiResponse.json();
    
    interface Part {
      functionCall?: {
        name: string;
        args: Record<string, unknown>;
      };
    }
    const functionCall = aiData.candidates?.[0]?.content?.parts?.find((p: Part) => p.functionCall);
    if (!functionCall) throw new Error("No analysis result returned");

    const report = functionCall.functionCall.args;

    return new Response(JSON.stringify({ report }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("theme-audit error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
