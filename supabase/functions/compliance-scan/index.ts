import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";

type ComplianceFinding = {
  category: string;
  severity: "critical" | "warning" | "info" | "pass";
  title: string;
  description: string;
  recommendation: string;
  reference?: string;
};

type ComplianceReport = {
  score: number;
  summary: string;
  findings: ComplianceFinding[];
  pages_analyzed: number;
};

type GeminiFunctionCallPart = {
  functionCall?: {
    args: ComplianceReport;
  };
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: GeminiFunctionCallPart[];
    };
  }>;
};

type FirecrawlScrapeResponse = {
  data?: {
    markdown?: string;
    links?: string[];
  };
  markdown?: string;
  links?: string[];
};

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
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;
    const userEmail = userData.user.email;

    const { url: storeUrl } = await req.json();
    if (!storeUrl) {
      return new Response(JSON.stringify({ error: "Store URL is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create scan record
    const { data: scan, error: scanErr } = await supabase
      .from("compliance_scans")
      .insert({ user_id: userId, store_url: storeUrl, status: "scanning" })
      .select()
      .single();

    if (scanErr) {
      console.error("Failed to create scan record:", scanErr);
      return new Response(JSON.stringify({ error: "Failed to create scan" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 1: Scrape the website with Firecrawl
    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    if (!FIRECRAWL_API_KEY) {
      throw new Error("Firecrawl is not configured");
    }

    let formattedUrl = storeUrl.trim();
    if (!formattedUrl.startsWith("http://") && !formattedUrl.startsWith("https://")) {
      formattedUrl = `https://${formattedUrl}`;
    }

    console.log("Scraping store:", formattedUrl);
    const originHost = new URL(formattedUrl).hostname.toLowerCase();

    // Scrape main page
    const scrapeRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: formattedUrl,
        formats: ["markdown", "links"],
        onlyMainContent: false,
        waitFor: 3000,
      }),
    });

    if (!scrapeRes.ok) {
      const errData = await scrapeRes.text();
      console.error("Firecrawl scrape failed:", errData);
      // Update scan as failed
      const serviceSupabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      await serviceSupabase.from("compliance_scans").update({
        status: "failed",
        results: { error: "Failed to scrape website. Please check the URL and try again." },
      }).eq("id", scan.id);

      return new Response(JSON.stringify({ error: "Failed to scrape website", scanId: scan.id }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const scrapeData = await scrapeRes.json();
    const pageContent = scrapeData.data?.markdown || scrapeData.markdown || "";
    const pageLinks = scrapeData.data?.links || scrapeData.links || [];

    console.log("Scraped content length:", pageContent.length, "Links found:", pageLinks.length);

    // Step 2: Map the site to find policy pages, blogs, product pages, and collections
    const mapRes = await fetch("https://api.firecrawl.dev/v1/map", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: formattedUrl,
        search: "privacy policy refund return shipping terms contact about faq blog article product collection",
        limit: 200,
        includeSubdomains: false,
      }),
    });

    let sitePages: string[] = [];
    if (mapRes.ok) {
      const mapData = await mapRes.json();
      sitePages = mapData.links || [];
      console.log("Mapped pages:", sitePages.length);
    }

    // Step 3: Scrape key pages across the storefront, not just policies
    const policyKeywords = ["privacy", "refund", "return", "shipping", "terms", "contact", "about", "faq"];
    const policyPages = sitePages.filter((link: string) =>
      policyKeywords.some(kw => link.toLowerCase().includes(kw))
    ).slice(0, 6);
    const blogPages = sitePages.filter((link: string) => /\/(blogs|blog|articles?)\//i.test(link)).slice(0, 8);
    const productPages = sitePages.filter((link: string) => /\/products\//i.test(link)).slice(0, 6);
    const collectionPages = sitePages.filter((link: string) => /\/collections\//i.test(link)).slice(0, 4);
    const priorityPages = Array.from(new Set([
      ...policyPages,
      ...blogPages,
      ...productPages,
      ...collectionPages,
    ])).slice(0, 16);

    let sampledPageContent = "";
    for (const pageUrl of priorityPages) {
      try {
        const md = await scrapeFirecrawlPage({
          apiKey: FIRECRAWL_API_KEY,
          url: pageUrl,
        });
        if (md) {
          sampledPageContent += `\n\n--- PAGE: ${pageUrl} ---\n${md.slice(0, 3500)}`;
        }
      } catch (e) {
        console.error("Failed to scrape page:", pageUrl, e);
      }
    }

    const offDomainLinks = extractOffDomainLinks({
      mainPageLinks: pageLinks,
      sitePages,
      allowedHost: originHost,
    });
    const oldBrandSignals = offDomainLinks.filter((link) =>
      /(ironphoenix\.store|gohardgaming\.store|gohardgaming\.com|etsy\.com)/i.test(link),
    );

    // Step 4: AI Analysis
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("Gemini API key not configured");

    const systemPrompt = `You are a misrepresentation-risk auditor for e-commerce stores.

Your job is NOT to decide whether a store is already suspended.
Your job is to identify evidence of misleading claims, contradictory statements, or trust-damaging gaps that create a realistic RISK of misrepresentation.

Core principle:
- Missing information is usually NOT a critical failure.
- If something cannot be verified from the provided content, mark it as "info" and explain that manual review is needed.
- Only use "critical" when there is clear evidence of a misleading, false, deceptive, or materially contradictory claim.
- Use "warning" when wording, omissions, or inconsistencies create meaningful misrepresentation risk.
- Use "pass" when the content appears clear and non-misleading.

Focus on these areas only:

1. BUSINESS IDENTITY RISK
- Business identity is unclear, misleading, or contradictory
- Contact details suggest the store may be hiding who operates it
- Claims of being official, authorized, certified, or affiliated without visible support

2. PRODUCT CLAIM RISK
- Product claims appear exaggerated, absolute, or unsupported
- Health, performance, safety, or outcome claims lack visible substantiation
- Lifestyle, wellness, children, safety, or recovery wording crosses into implied treatment, certification, or regulated-claim territory
- Product condition, availability, pricing, or key attributes appear misleading
- Reviews, badges, or trust signals appear misleading or mismatched

3. SHIPPING / RETURN / REFUND RISK
- Shipping promises conflict with policy language
- Refund or return promises conflict across pages
- Delivery expectations are presented in a way that could mislead shoppers
- Material refund conditions are hidden, unclear, or contradictory

4. LEGAL / POLICY RISK
- Policy links or disclosures are missing where that absence creates shopper confusion
- Policies contain language that appears copied, inconsistent, or brand-mismatched
- Privacy, terms, refund, shipping, and contact messaging conflict with each other

5. SITE TRUST RISK
- Trust badges, guarantees, scarcity claims, or social proof appear misleading
- Important shopper-facing information is obscured, contradictory, or framed deceptively
- Blog posts, article pages, and old landing pages that link to another store, old brand, or off-domain checkout path are meaningful trust risks
- Blog/article content that uses an outdated brand identity or wrong domain is a misrepresentation signal, not just a content-quality issue

Do NOT treat these alone as critical failures unless there is clear deceptive context:
- no phone number
- no physical address
- no third-party reviews
- no courier name
- no explicit business hours
- incomplete best-practice pages
- anything that simply cannot be verified from the scraped content

Scoring guidance:
- 90-100: little to no visible misrepresentation risk
- 70-89: some warnings, but no strong deceptive signals
- 40-69: meaningful risk signals or multiple contradictions
- 0-39: clear deceptive, false, or materially misleading claims

Return findings using these severities:
- critical: clear evidence of false, misleading, deceptive, or materially contradictory claims
- warning: meaningful misrepresentation risk, ambiguity, or inconsistency
- info: cannot verify or minor issue worth manual review
- pass: clearly acceptable / no meaningful risk found

Keep findings high-signal. Do not pad the report with generic best practices.
Prioritize these Google Merchant Center risks when present:
- false or unclear business identity
- wrong-brand or old-domain links
- misleading product/health/performance claims
- missing or contradictory shipping / return / refund disclosures
- offers or CTAs that do not match the actual landing-page product or route
Calculate an overall score based on misrepresentation risk only.
Use the report_compliance tool to return your analysis.`;

    const userPrompt = `Analyze this e-commerce store for compliance:

URL: ${formattedUrl}

=== MAIN PAGE CONTENT ===
${pageContent.slice(0, 8000)}

=== SITE MAP (discovered pages) ===
${sitePages.slice(0, 80).join("\n")}

=== PRIORITY PAGES CONTENT (policies, blogs, products, collections) ===
${sampledPageContent.slice(0, 24000)}

=== LINKS FOUND ON MAIN PAGE ===
${pageLinks.slice(0, 50).join("\n")}

=== DIRECT RISK SIGNALS ===
Origin host: ${originHost}
Policy pages sampled: ${policyPages.length}
Blog/article pages sampled: ${blogPages.length}
Product pages sampled: ${productPages.length}
Collection pages sampled: ${collectionPages.length}
Off-domain links found: ${offDomainLinks.length}
Known old-brand/off-domain links found: ${oldBrandSignals.length}
Off-domain examples:
${offDomainLinks.slice(0, 25).join("\n")}`;

    const aiResponse = await fetch(
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
                  name: "report_compliance",
                  description: "Return the compliance audit report",
                  parameters: {
                    type: "object",
                    properties: {
                      score: { type: "integer", description: "Overall compliance score 0-100" },
                      summary: { type: "string", description: "2-3 sentence executive summary" },
                      findings: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            category: {
                              type: "string",
                              enum: ["gmc_misrepresentation", "etsy_compliance", "general_ecommerce"],
                            },
                            severity: { type: "string", enum: ["critical", "warning", "info", "pass"] },
                            title: { type: "string", description: "Short finding title" },
                            description: { type: "string", description: "Detailed explanation" },
                            recommendation: { type: "string", description: "How to fix this issue" },
                            reference: { type: "string", description: "Policy reference" },
                          },
                          required: ["category", "severity", "title", "description", "recommendation"],
                        },
                      },
                      pages_analyzed: { type: "integer", description: "Number of pages analyzed" },
                    },
                    required: ["score", "summary", "findings", "pages_analyzed"],
                  },
                },
              ],
            },
          ],
          toolConfig: {
            functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["report_compliance"] },
          },
        }),
      }
    );

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment.", scanId: scan.id }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("Gemini error:", aiResponse.status, errText);
      throw new Error("AI analysis failed");
    }

    const aiData = await aiResponse.json() as GeminiResponse;
    const functionCall = aiData.candidates?.[0]?.content?.parts?.find((part) => part.functionCall)?.functionCall;
    if (!functionCall) throw new Error("No analysis result returned");

    const report = functionCall.args;

    // Calculate counts
    const criticalCount = report.findings.filter((finding) => finding.severity === "critical").length;
    const warningCount = report.findings.filter((finding) => finding.severity === "warning").length;
    const passedCount = report.findings.filter((finding) => finding.severity === "pass").length;

    // Update scan with results using service role
    const serviceSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    await serviceSupabase.from("compliance_scans").update({
      status: "completed",
      results: report,
      score: report.score,
      critical_count: criticalCount,
      warning_count: warningCount,
      passed_count: passedCount,
      completed_at: new Date().toISOString(),
    }).eq("id", scan.id);

    if (userEmail) {
      try {
        const SUPABASE_PROJECT_ID = Deno.env.get("SUPABASE_URL")?.match(/https:\/\/(.+)\.supabase/)?.[1];

        if (SUPABASE_PROJECT_ID) {
          await fetch(`https://${SUPABASE_PROJECT_ID}.supabase.co/functions/v1/send-scan-email`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({
              to: userEmail,
              reportType: "compliance",
              storeUrl: formattedUrl,
              score: report.score,
              criticalCount,
              warningCount,
              pagesAnalyzed: report.pages_analyzed,
            }),
          });
        }
      } catch (emailError) {
        console.error("Compliance report email failed (non-blocking):", emailError);
      }
    }

    return new Response(JSON.stringify({ scanId: scan.id, report }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("compliance-scan error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function scrapeFirecrawlPage(input: { apiKey: string; url: string }): Promise<string> {
  const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: input.url,
      formats: ["markdown"],
      onlyMainContent: true,
      waitFor: 2000,
    }),
  });

  if (!response.ok) return "";
  const data = await response.json() as FirecrawlScrapeResponse;
  return data.data?.markdown || data.markdown || "";
}

function extractOffDomainLinks(input: {
  mainPageLinks: string[];
  sitePages: string[];
  allowedHost: string;
}): string[] {
  const urls = [...(input.mainPageLinks || []), ...(input.sitePages || [])];
  const offDomain = urls.filter((candidate) => {
    try {
      const parsed = new URL(candidate);
      return parsed.hostname.toLowerCase() !== input.allowedHost;
    } catch {
      return false;
    }
  });

  return Array.from(new Set(offDomain)).slice(0, 100);
}
