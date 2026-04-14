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

type BasicPageResponse = {
  markdown: string;
  links: string[];
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

serve(async (req) => {
  let scanId: string | null = null;

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

    const { data: isAdmin, error: roleError } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleError) {
      console.error("Failed to check admin role:", roleError);
      return new Response(JSON.stringify({ error: "Could not verify account access" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Compliance scans are free for admin only. Purchase a scan package to continue." }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { url: storeUrl, customDomain } = await req.json() as { url: string; customDomain?: string | null };
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

    scanId = scan.id;

    // Step 1: Scrape the website with Firecrawl
    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");

    let formattedUrl = storeUrl.trim();
    if (!formattedUrl.startsWith("http://") && !formattedUrl.startsWith("https://")) {
      formattedUrl = `https://${formattedUrl}`;
    }

    console.log("Scraping store:", formattedUrl);
    const inputHost = new URL(formattedUrl).hostname.toLowerCase().replace(/^www\./, "");

    // Scrape main page
    const homepage = FIRECRAWL_API_KEY
      ? await scrapeFirecrawlHome({
          apiKey: FIRECRAWL_API_KEY,
          url: formattedUrl,
        })
      : await scrapeBasicPage(formattedUrl);

    const pageContent = homepage.markdown || "";
    const pageLinks = homepage.links || [];

    // Build the set of allowed hosts for this specific store.
    // customDomain is the Shopify custom domain from the store connection (e.g. ironphoenixghg.store).
    // We allow both the myshopify domain and the custom domain so neither is treated as off-domain.
    const allowedHosts = new Set<string>([inputHost]);
    if (customDomain) {
      allowedHosts.add(customDomain.toLowerCase().replace(/^www\./, "").replace(/^https?:\/\//, ""));
    }
    // Also detect from page links as a fallback for stores where customDomain wasn't passed
    const EXTERNAL_HOSTS = /myshopify\.com|shopify\.com|facebook\.com|instagram\.com|twitter\.com|tiktok\.com|youtube\.com|paypal\.com|stripe\.com|google\.com|apple\.com/i;
    const hostCounts: Record<string, number> = {};
    for (const link of pageLinks) {
      try {
        const h = new URL(link).hostname.toLowerCase().replace(/^www\./, "");
        if (!EXTERNAL_HOSTS.test(h)) hostCounts[h] = (hostCounts[h] ?? 0) + 1;
      } catch { /* ignore */ }
    }
    const detectedHost = Object.entries(hostCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (detectedHost) allowedHosts.add(detectedHost);
    const originHost = customDomain
      ? customDomain.toLowerCase().replace(/^www\./, "").replace(/^https?:\/\//, "")
      : (detectedHost ?? inputHost);
    console.log("Allowed hosts:", [...allowedHosts], "| Origin:", originHost);

    console.log("Scraped content length:", pageContent.length, "Links found:", pageLinks.length);

    // Step 2: Map the site to find policy pages, blogs, product pages, and collections
    let sitePages: string[] = [];
    if (FIRECRAWL_API_KEY) {
      let mapRes: Response | null = null;
      try {
        mapRes = await fetchWithTimeout("https://api.firecrawl.dev/v1/map", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: formattedUrl,
            search: "privacy policy refund return shipping terms contact about faq blog article product collection",
            limit: 80,
            includeSubdomains: false,
          }),
        }, 12000);
      } catch (error) {
        console.error("Firecrawl map failed:", error);
      }

      if (mapRes?.ok) {
        const mapData = await mapRes.json();
        sitePages = mapData.links || [];
        console.log("Mapped pages:", sitePages.length);
      }
    }
    if (sitePages.length === 0) {
      sitePages = pageLinks;
    }

    // Step 3: Scrape key pages across the storefront, not just policies
    const policyKeywords = ["privacy", "refund", "return", "shipping", "terms", "contact", "about", "faq"];
    const policyPages = sitePages.filter((link: string) =>
      policyKeywords.some(kw => link.toLowerCase().includes(kw))
    ).slice(0, 2);
    const blogPages = sitePages.filter((link: string) => /\/(blogs|blog|articles?)\//i.test(link)).slice(0, 1);
    const productPages = sitePages.filter((link: string) => /\/products\//i.test(link)).slice(0, 1);
    const collectionPages = sitePages.filter((link: string) => /\/collections\//i.test(link)).slice(0, 1);
    const priorityPages = Array.from(new Set([
      ...policyPages,
      ...blogPages,
      ...productPages,
      ...collectionPages,
    ])).slice(0, 4);

    const pageSamples = await Promise.allSettled(
      priorityPages.map(async (pageUrl) => {
        const md = FIRECRAWL_API_KEY
          ? await scrapeFirecrawlPage({
              apiKey: FIRECRAWL_API_KEY,
              url: pageUrl,
            })
          : (await scrapeBasicPage(pageUrl)).markdown;
        return md ? `\n\n--- PAGE: ${pageUrl} ---\n${md.slice(0, 1200)}` : "";
      }),
    );
    const sampledPageContent = pageSamples
      .filter((result): result is PromiseFulfilledResult<string> => result.status === "fulfilled")
      .map((result) => result.value)
      .join("");

    const blogPageUrls = sitePages.filter((link: string) => /\/(blogs|blog|articles?)\//i.test(link));
    const storefrontPageUrls = sitePages.filter((link: string) => !/\/(blogs|blog|articles?)\//i.test(link));

    const offDomainLinks = extractOffDomainLinks({
      mainPageLinks: pageLinks,
      sitePages: storefrontPageUrls, // blogs excluded — editorial outbound links are expected
      allowedHosts,
    });
    // All LLC-owned domains are safe — they will eventually redirect to or serve ads for the Shopify store.
    // LLC: Go Hard Gaming Discord LLC  |  DBA: Iron Phoenix GHG  |  Store: Our Phoenix Rise
    // Owned domains: ourphoenixrise.com, gohardgaming.store, ironphoenix.store, ironphoenixghg.com
    // NOTE: gohardgaming.com is NOT owned — it is for sale and should be flagged if found.
    // Only flag links that route shoppers to a genuinely external checkout (etsy, amazon, competitor storefronts).
    const LLC_DOMAINS = /ourphoenixrise\.com|gohardgaming\.store|ironphoenix\.(store|ghg\.com)|ironphoenixghg\.com/i;
    const oldBrandSignals = offDomainLinks.filter((link) =>
      !LLC_DOMAINS.test(link) && /(etsy\.com\/shop\/|amazon\.com\/dp\/)/i.test(link),
    );

    // Step 4: AI Analysis
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

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

2. PRODUCT CLAIM RISK (applies to product pages, product descriptions, and product-level CTAs ONLY — never to blog posts, articles, or editorial story content)
- Product claims appear exaggerated, absolute, or unsupported
- Health, performance, safety, or outcome claims on PRODUCT PAGES lack visible substantiation
- Lifestyle, wellness, children, safety, or recovery wording ON A PRODUCT PAGE crosses into implied treatment, certification, or regulated-claim territory
- Product condition, availability, pricing, or key attributes appear misleading
- Reviews, badges, or trust signals appear misleading or mismatched

IMPORTANT: Blog posts, articles, and editorial stories are NOT subject to product claim rules. Emotional language, personal narratives, relationship stories, wellness lifestyle topics, and human interest content in blog/article pages must NEVER be flagged as health or medical claims — even if they use words like "healing", "recovery", "pressure", "relief", or "support" in a non-product context. Flag only when a product page makes a specific unsubstantiated health claim about what the product does to the body.

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
- Navigation, banners, product pages, or CTAs that route shoppers to a different brand's storefront or checkout are meaningful trust risks
- Blog/article content that uses an outdated brand identity in the store identity or contact info is a misrepresentation signal

IMPORTANT — editorial blog outbound links are NOT a trust risk:
- Blog and article pages routinely link to external sources, venues, brands, or reference sites as part of editorial content (e.g. "Best skydiving in New England" linking to skydiving venues, a recipe post linking to a supplier)
- Outbound links in blog/article content are standard SEO practice and should NOT be flagged as critical or warning
- Only flag off-domain links as a risk if they appear in: navigation menus, product pages, checkout flow, or CTAs that tell the shopper to buy/visit elsewhere

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
- 75-89: one or two warnings, no deceptive signals, store is fundamentally sound
- 55-74: multiple warnings or one clear contradiction worth fixing
- 35-54: meaningful risk signals, contradictions, or one confirmed critical issue
- 0-34: multiple confirmed critical issues with clear deceptive or materially false claims

IMPORTANT: A store with mostly clean content, one business identity issue, and a few warnings should score in the 60-80 range — NOT below 40. Only score below 40 when there is clear, repeated, material deception across multiple areas.

Return findings using these severities:
- critical: clear evidence of false, misleading, deceptive, or materially contradictory claims
- warning: meaningful misrepresentation risk, ambiguity, or inconsistency
- info: pre-risk flag worth reviewing before it becomes a problem — does NOT affect the score
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
${pageContent.slice(0, 4500)}

=== SITE MAP (discovered pages) ===
${sitePages.slice(0, 80).join("\n")}

=== PRIORITY PAGES CONTENT (policies, blogs, products, collections) ===
${sampledPageContent.slice(0, 6000)}

=== LINKS FOUND ON MAIN PAGE ===
${pageLinks.slice(0, 50).join("\n")}

=== DIRECT RISK SIGNALS ===
Store domain: ${originHost} (submitted as: ${inputHost})
POLICY PAGES CONFIRMED (do NOT flag policy coverage as missing — these URLs exist and were sampled): ${policyPages.length > 0 ? policyPages.join(", ") : "none sampled but sitemap includes policy routes"}
Sitemap includes /policies/ routes: ${sitePages.some((p: string) => p.includes("/policies/")) ? "YES — policies are present" : "no"}
Blog/article pages sampled: ${blogPages.length}
Product pages sampled: ${productPages.length}
Collection pages sampled: ${collectionPages.length}
Off-domain links on storefront pages (navigation, products, collections — NOT blogs): ${offDomainLinks.length}
Known old-brand/off-domain links on storefront pages: ${oldBrandSignals.length}
Blog/article pages detected (outbound links on these are editorial and expected — do NOT flag): ${blogPageUrls.length}
Off-domain storefront examples:
${offDomainLinks.slice(0, 25).join("\n")}`;

    let report: ComplianceReport;
    if (!GEMINI_API_KEY) {
      report = buildFallbackComplianceReport({
        storeUrl: formattedUrl,
        pageContent,
        sampledPageContent,
        offDomainLinks,
        oldBrandSignals,
        pagesAnalyzed: 1 + priorityPages.length,
        policyPages,
        sitePages,
      });
    } else {
      try {
        const aiResponse = await fetchWithTimeout(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: {
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
          },
          25000
        );

        if (!aiResponse.ok) {
          const errText = await aiResponse.text();
          console.error("Gemini error:", aiResponse.status, errText);
          throw new Error(`AI analysis failed with status ${aiResponse.status}`);
        }

        const aiData = await aiResponse.json() as GeminiResponse;
        const functionCall = aiData.candidates?.[0]?.content?.parts?.find((part) => part.functionCall)?.functionCall;
        if (!functionCall) throw new Error("No analysis result returned");
        report = functionCall.args;
      } catch (error) {
        console.error("Gemini compliance fallback:", error);
        report = buildFallbackComplianceReport({
          storeUrl: formattedUrl,
          pageContent,
          sampledPageContent,
          offDomainLinks,
          oldBrandSignals,
          pagesAnalyzed: 1 + priorityPages.length,
          policyPages,
        });
      }
    }

    // CRITICAL VALIDATION: Report must be valid before marking completed and sending email
    // This prevents fraud where user is charged without receiving a real report
    if (!report || !Array.isArray(report.findings) || report.findings.length === 0) {
      const serviceSupabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      await serviceSupabase.from("compliance_scans").update({
        status: "failed",
        results: { error: "Report generation returned empty findings. This scan has been marked as failed—you have NOT been charged. Please contact support if this persists." },
        completed_at: new Date().toISOString(),
      }).eq("id", scan.id);
      return new Response(JSON.stringify({ error: "Report generation failed (no findings). Scan marked as FAILED—no charge. Contact support." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (typeof report.score !== "number" || !report.summary || typeof report.pages_analyzed !== "number") {
      const serviceSupabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      await serviceSupabase.from("compliance_scans").update({
        status: "failed",
        results: { error: "Report is incomplete (missing score, summary, or pages_analyzed). Scan marked as failed—you have NOT been charged. Contact support." },
        completed_at: new Date().toISOString(),
      }).eq("id", scan.id);
      return new Response(JSON.stringify({ error: "Report validation failed (incomplete). Scan marked as FAILED—no charge. Contact support." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    // ONLY send email if report is valid and scan is marked completed
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
              summary: report.summary,
              findings: report.findings,
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
    if (scanId) {
      try {
        const serviceSupabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );
        await serviceSupabase.from("compliance_scans").update({
          status: "failed",
          results: { error: error instanceof Error ? error.message : "Unknown error" },
          completed_at: new Date().toISOString(),
        }).eq("id", scanId);
      } catch (updateError) {
        console.error("Failed to update compliance scan status:", updateError);
      }
    }
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: `Scan failed: ${errorMessage}. Your account has NOT been charged. Contact support if you need assistance.` }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function scrapeFirecrawlPage(input: { apiKey: string; url: string }): Promise<string> {
  const response = await fetchWithTimeout("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: input.url,
      formats: ["markdown"],
      onlyMainContent: true,
      waitFor: 1200,
    }),
  }, 10000);

  if (!response.ok) return "";
  const data = await response.json() as FirecrawlScrapeResponse;
  return data.data?.markdown || data.markdown || "";
}

async function scrapeFirecrawlHome(input: { apiKey: string; url: string }): Promise<BasicPageResponse> {
  const response = await fetchWithTimeout("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: input.url,
      formats: ["markdown", "links"],
      onlyMainContent: false,
      waitFor: 1500,
    }),
  }, 20000);

  if (!response.ok) {
    const errData = await response.text();
    console.error("Firecrawl scrape failed:", errData);
    return await scrapeBasicPage(input.url);
  }

  const scrapeData = await response.json() as FirecrawlScrapeResponse;
  return {
    markdown: scrapeData.data?.markdown || scrapeData.markdown || "",
    links: scrapeData.data?.links || scrapeData.links || [],
  };
}

async function scrapeBasicPage(url: string): Promise<BasicPageResponse> {
  const response = await fetchWithTimeout(url, {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; PhoenixFlowCompliance/1.0; +https://www.ironphoenixflow.com)",
      "Accept": "text/html,application/xhtml+xml",
    },
  }, 12000);

  if (!response.ok) {
    throw new Error(`Storefront fetch failed with status ${response.status}`);
  }

  const html = await response.text();
  const markdown = stripHtmlForAudit(html);
  const links = extractLinksFromHtml(html, url);
  return { markdown, links };
}

function extractOffDomainLinks(input: {
  mainPageLinks: string[];
  sitePages: string[];
  allowedHosts: Set<string>;
}): string[] {
  const urls = [...(input.mainPageLinks || []), ...(input.sitePages || [])];
  const offDomain = urls.filter((candidate) => {
    try {
      const parsed = new URL(candidate);
      const h = parsed.hostname.toLowerCase().replace(/^www\./, "");
      return !input.allowedHosts.has(h);
    } catch {
      return false;
    }
  });

  return Array.from(new Set(offDomain)).slice(0, 100);
}

function stripHtmlForAudit(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20000);
}

function extractLinksFromHtml(html: string, baseUrl: string): string[] {
  const matches = Array.from(html.matchAll(/href=["']([^"'#]+)["']/gi));
  const links = matches
    .map((match) => match[1])
    .map((href) => {
      try {
        return new URL(href, baseUrl).toString();
      } catch {
        return null;
      }
    })
    .filter((href): href is string => !!href);

  return Array.from(new Set(links)).slice(0, 100);
}

function buildFallbackComplianceReport(input: {
  storeUrl: string;
  pageContent: string;
  sampledPageContent: string;
  offDomainLinks: string[];
  oldBrandSignals: string[];
  pagesAnalyzed: number;
  policyPages: string[];
  sitePages?: string[];
}): ComplianceReport {
  const findings: ComplianceFinding[] = [];

  // Only scan storefront pages (homepage + non-blog samples) for product-level signals.
  // Blog/article content is excluded from medical claim checks — personal stories,
  // recovery narratives, and editorial wellness content are never product claims.
  const storefrontContent = input.pageContent.toLowerCase();
  const sampledLower = input.sampledPageContent.toLowerCase();
  // Strip blog sections from sampled content before medical regex check
  const storefrontSampled = sampledLower
    .split(/--- page:.*?\/(blogs?|articles?)\/.*?---/i)
    .filter((_, i) => i % 2 === 0)
    .join(" ");
  const combined = `${storefrontContent}\n${storefrontSampled}`;

  // Only flag old-brand signals found on storefront pages (blogs are already excluded upstream)
  if (input.oldBrandSignals.length > 0) {
    const examples = input.oldBrandSignals.slice(0, 5).join("\n• ");
    findings.push({
      category: "gmc_misrepresentation",
      severity: "critical",
      title: "Old-brand or off-domain links found",
      description: `Found ${input.oldBrandSignals.length} link(s) pointing to old brand domains or other storefronts in navigation, banners, or CTAs:\n• ${examples}\n\nThese route shoppers away from this store and can cause GMC suspension.`,
      recommendation: "Search your theme for these URLs and replace them with links to this store's own pages.",
    });
  }

  // Only flag external links if there are many unexplained ones (footer social links,
  // payment badges, and policy hosts are normal — flag only if count is high)
  const unexplainedExternal = input.offDomainLinks.filter(
    (link) => !/(facebook\.com|instagram\.com|twitter\.com|tiktok\.com|youtube\.com|pinterest\.com|paypal\.com|stripe\.com|shopify\.com|google\.com|apple\.com|shopifypay|ourphoenixrise\.com|gohardgaming\.store|ironphoenix\.(store|ghg\.com)|ironphoenixghg\.com)/i.test(link),
  );
  if (unexplainedExternal.length > 5) {
    const sample = unexplainedExternal.slice(0, 8).join("\n• ");
    findings.push({
      category: "general_ecommerce",
      severity: "warning",
      title: "External links need manual trust review",
      description: `Found ${unexplainedExternal.length} off-domain links on storefront pages (not counting social/payment). First examples:\n• ${sample}`,
      recommendation: "Review each link. Keep only legitimate analytics, policy hosts, or approved partner destinations. Remove anything that routes shoppers to checkout elsewhere.",
    });
  }

  const missingPolicies = [
    { key: "privacy", label: "Privacy policy" },
    { key: "refund", label: "Refund or return policy" },
    { key: "shipping", label: "Shipping policy" },
    { key: "terms", label: "Terms of service" },
  ].filter((item) => {
    const allKnownUrls = [...input.policyPages, ...(input.sitePages ?? [])];
    return !allKnownUrls.some((url) => url.toLowerCase().includes(item.key));
  });

  if (missingPolicies.length > 0) {
    const missing = missingPolicies.map((item) => item.label).join(", ");
    findings.push({
      category: "gmc_misrepresentation",
      severity: "warning",
      title: "Policy coverage is incomplete",
      description: `Could not find public URLs for: ${missing}.\n\nShopify standard routes: /policies/privacy-policy, /policies/refund-policy, /policies/shipping-policy, /policies/terms-of-service`,
      recommendation: "Go to Shopify Admin → Settings → Policies and make sure each policy is generated and saved. Then add links to your footer.",
    });
  }

  // Medical claim check runs ONLY on storefront content (not blog content).
  const medicalPattern = /(treats?\s+\w+\s+disease|cures?\s+\w|clinically proven|medical-grade|fda[- ]approved|diagnosed with|treats? (depression|anxiety|ptsd|adhd|cancer))/i;
  const medicalMatch = combined.match(medicalPattern);
  if (medicalMatch) {
    findings.push({
      category: "gmc_misrepresentation",
      severity: "warning",
      title: "Potential medical or treatment-style wording detected",
      description: `Found this phrase on a product or storefront page: "${medicalMatch[0]}"\n\nThis type of language can trigger GMC policy violations for health claims.`,
      recommendation: "Rewrite toward lifestyle language. Replace 'treats X' with 'supports your X routine', 'clinically proven' with 'customer-loved', etc.",
    });
  }

  if (!/(contact|support|email|phone)/i.test(combined)) {
    findings.push({
      category: "general_ecommerce",
      severity: "info",
      title: "Contact signals were not obvious in sampled pages",
      description: "The fallback scan did not clearly detect support or contact information in the sampled storefront pages.",
      recommendation: "Make contact details easy to find in the header, footer, and policy pages.",
    });
  }

  if (findings.length === 0) {
    findings.push({
      category: "general_ecommerce",
      severity: "pass",
      title: "No major misrepresentation signals found in fallback scan",
      description: "The fallback scan did not detect major wrong-domain, policy, or treatment-claim issues in the sampled pages.",
      recommendation: "Review the exported report and run a deeper scan again after major content changes.",
    });
  }

  const score = Math.max(
    20,
    90
      - findings.filter((finding) => finding.severity === "critical").length * 12
      - findings.filter((finding) => finding.severity === "warning").length * 8,
  );

  const summary =
    findings.some((finding) => finding.severity === "critical")
      ? "Fallback scan found material trust or brand-routing risks that should be fixed before using this storefront for paid traffic."
      : findings.some((finding) => finding.severity === "warning")
        ? "Fallback scan completed with actionable warnings. The storefront is readable, but trust, policy, or wording issues still need cleanup."
        : "Fallback scan completed without major misrepresentation signals in the sampled pages.";

  return {
    score,
    summary,
    findings,
    pages_analyzed: input.pagesAnalyzed,
  };
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
