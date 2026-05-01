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

    // If the user submitted a .myshopify.com URL, note it but treat it as the backend host.
    // The public-facing domain will be detected from the page content after scraping.
    const isMyshopifyUrl = /\.myshopify\.com$/i.test(new URL(formattedUrl).hostname);
    console.log("Scraping store:", formattedUrl, isMyshopifyUrl ? "(myshopify backend URL)" : "");
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
    // Shopify standard policy URLs — check these directly first
    const shopifyPolicyPaths = [
      "/policies/privacy-policy",
      "/policies/refund-policy",
      "/policies/shipping-policy",
      "/policies/terms-of-service",
    ];
    const baseUrl = `https://${originHost}`;
    const confirmedPolicyUrls = shopifyPolicyPaths.map(p => `${baseUrl}${p}`);

    const policyKeywords = ["privacy", "refund", "return", "shipping", "terms", "contact", "about", "faq"];
    const policyPages = Array.from(new Set([
      ...confirmedPolicyUrls,
      ...sitePages.filter((link: string) =>
        policyKeywords.some(kw => link.toLowerCase().includes(kw))
      ),
    ])).slice(0, 6);
    const blogPages = sitePages.filter((link: string) => /\/(blogs|blog|articles?)\//i.test(link)).slice(0, 1);
    const productPages = sitePages.filter((link: string) => /\/products\//i.test(link)).slice(0, 1);
    const collectionPages = sitePages.filter((link: string) => /\/collections\//i.test(link)).slice(0, 1);
    const nonPolicyPages = Array.from(new Set([
      ...blogPages,
      ...productPages,
      ...collectionPages,
    ])).slice(0, 3);

    // Scrape policy pages separately — they get their own budget so product/blog content
    // can't crowd them out of the prompt
    const policySamples = await Promise.allSettled(
      policyPages.map(async (pageUrl) => {
        const md = FIRECRAWL_API_KEY
          ? await scrapeFirecrawlPage({ apiKey: FIRECRAWL_API_KEY, url: pageUrl })
          : (await scrapeBasicPage(pageUrl)).markdown;
        return md && md.trim().length > 50
          ? `\n\n--- POLICY PAGE: ${pageUrl} ---\n${md.slice(0, 1500)}`
          : `\n\n--- POLICY PAGE: ${pageUrl} --- [could not retrieve content]`;
      }),
    );
    const sampledPolicyContent = policySamples
      .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
      .map((r) => r.value)
      .join("");

    const pageSamples = await Promise.allSettled(
      nonPolicyPages.map(async (pageUrl) => {
        const md = FIRECRAWL_API_KEY
          ? await scrapeFirecrawlPage({ apiKey: FIRECRAWL_API_KEY, url: pageUrl })
          : (await scrapeBasicPage(pageUrl)).markdown;
        return md ? `\n\n--- PAGE: ${pageUrl} ---\n${md.slice(0, 1200)}` : "";
      }),
    );
    const sampledPageContent = pageSamples
      .filter((result): result is PromiseFulfilledResult<string> => result.status === "fulfilled")
      .map((result) => result.value)
      .join("");

    const priorityPages = [...policyPages, ...nonPolicyPages];

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

    const systemPrompt = `You are a Google Merchant Center (GMC) compliance specialist and technical SEO auditor for Shopify storefronts. Your job is to find real, actionable issues that cause GMC disapprovals, ad suspensions, and lost organic search rankings — not generic observations.

SEVERITY RULES:
- critical: will cause or is actively causing GMC disapproval, ad suspension, or Google Shopping ban
- warning: creates meaningful risk of disapproval or ranking loss — fix before running ads
- info: best-practice gap that doesn't immediately trigger GMC action but should be fixed
- pass: confirmed compliant — call this out explicitly so the merchant knows what's working

SCORING (GMC + SEO combined):
- 90-100: GMC-ready, no blocking issues, strong SEO foundation
- 75-89: minor gaps, safe to run ads with small fixes
- 55-74: one or more GMC warnings that could trigger disapproval — fix before ads
- 35-54: active GMC risk or multiple SEO failures — do not run ads until resolved
- 0-34: critical GMC violations, likely already disapproved or suspended

WHAT TO AUDIT — CHECK EVERY ONE OF THESE:

1. GMC PRODUCT DATA QUALITY (critical focus)
- Product titles on product pages: must not contain promotional text ("SALE", "FREE SHIPPING", "Best", "Cheap"). Flag any you find verbatim.
- Apparel products MUST show color and size on the product page — if a clothing/apparel/shoe product page exists and does not display color or size options, flag as critical.
- Product descriptions must describe the actual product — flag vague, keyword-stuffed, or supplier-template descriptions ("100% satisfaction guaranteed", "upload your own image", "best quality").
- Price display: if prices are present, confirm they are clearly shown on product pages. Flag hidden pricing or price-on-request.
- Out-of-stock products shown as available: flag if inventory signals suggest unavailability but products appear purchasable.
- Prohibited content on product pages: health claims ("cures", "heals", "treats", "anti-anxiety", "FDA approved"), fake reviews, misleading badges.

2. GMC POLICY REQUIREMENTS (all three required for Shopping ads)
- Shipping policy: must exist and include delivery timeframe estimates. "We ship fast" is not a policy. Flag missing or vague shipping policies as critical.
- Return/refund policy: must exist and specify the return window. Flag missing or contradictory refund policies as critical.
- Privacy policy: must exist and cover data collection. Flag missing privacy policies as critical.
- Contact information: business name and at least one contact method (email, form, phone) must be findable. Flag absence as warning.

3. TECHNICAL SEO (ranking killers)
- Page titles: flag if the homepage or product pages appear to have no title tag, generic titles ("Shopify Store", "Home"), or titles over 60 characters.
- Meta descriptions: flag missing or duplicate meta descriptions. A page with no meta description loses click-through rate in Google results.
- Duplicate content: flag if product descriptions appear copy-pasted across multiple products or use obvious supplier boilerplate.
- Thin content: flag product pages with fewer than 100 words of description as a warning.
- URL structure: flag non-descriptive URLs (e.g. /products/123456789) compared to keyword-rich slugs.
- Structured data / schema: flag if product pages lack Product schema markup (makes Google Shopping rich results impossible).
- Page speed signals: if the scraped content reveals render-blocking scripts, unoptimized images, or no lazy loading, flag as warning.
- Canonical issues: flag if multiple URLs serve the same content with no canonical tag.

4. GMC MISREPRESENTATION RISKS
- Business identity: store name, domain, and brand must be consistent. Flag contradictions between displayed brand name and domain.
- Misleading claims: absolute superlatives ("world's best", "guaranteed results") without substantiation on product pages.
- Bait-and-switch signals: product page content that doesn't match the product image or title.
- Third-party brand names: flag any unlicensed use of trademark names (Nike, Apple, Disney, etc.) in product titles or descriptions.
- Counterfeit signals: "replica", "inspired by [brand]", "dupe", "same as [brand]" language on product pages.

5. SHIPPING COMPLIANCE — MADE-TO-ORDER CONTEXT (GMC suspends accounts for shipping mismatches)
This store sells made-to-order / print-on-demand products. Google Merchant Center requires a single "time to door" number — the total days from order placement to the package arriving at the customer. For made-to-order stores this includes production time. GMC does not separate processing from transit — it wants one total delivery window that reflects when the customer will actually receive the item. Audit with this in mind:

- TIME TO DOOR STATED: Does the shipping policy state a clear maximum total delivery time (e.g. "up to 15 business days from order date")? This number must represent the full end-to-end time — production + carrier transit — not just the carrier leg. Flag as critical if the policy only states carrier transit time (e.g. "3-5 days shipping") without accounting for production, because the customer will expect delivery in 3-5 days and the GMC setting will not match reality.
- CONSISTENCY ACROSS THE STORE: The time-to-door stated in the shipping policy must match any delivery estimates shown on product pages, banners, or checkout. If the policy says "up to 15 days" but a product page says "ships in 3-5 days," flag as critical and quote both claims verbatim — this is the most common cause of GMC account suspension for made-to-order stores.
- CUSTOMER EXPECTATION LANGUAGE: Does the store explain WHY delivery takes this long? Customers who see "up to 15 days" without context will open disputes. The policy or product pages should include language like "Each item is made to order — please allow up to 15 days for delivery." Flag as warning if this context is missing.
- SHIPPING LOCATIONS: Does the policy state which countries or regions are covered? GMC requires this. Flag as warning if absent.
- FREE SHIPPING CLAIMS: If free shipping is advertised anywhere, the policy must confirm it and state any minimums. A free shipping banner that contradicts the policy is a critical GMC violation.
- LATE DELIVERY RECOURSE: If the store states a maximum delivery window, does the refund or shipping policy address what happens if that window is missed? Customers and payment processors (Stripe, PayPal, Shopify Payments) can initiate chargebacks on late orders. A policy that states a maximum delivery time but says nothing about late deliveries leaves the merchant exposed. Flag as warning if a max delivery time is stated but there is no language covering late delivery resolution (e.g. "If your order has not arrived within X days of your order date, contact us and we will investigate or issue a refund").
- CLAIM WINDOW / DISPUTE DEADLINE: Does the policy state a deadline by which customers must report a missing or late order? Without a claim window, a customer can report a missing package months or years later, which platforms (Etsy, Shopify, PayPal) may still act on — including closing the store. A policy should state something like "Non-delivery claims must be submitted within 30 days of the estimated delivery date." Flag as warning if no claim deadline exists. This protects the merchant from stale disputes that no carrier or platform can resolve.
- GMC SHIPPING TEMPLATE REMINDER: Note as info that the store's GMC shipping settings must reflect the full time-to-door maximum (e.g. 15 days), not just carrier transit days. The merchant should verify this in their GMC account under Shipping settings.

6. POLICY CONSISTENCY
- Shipping promises on product pages (e.g. "ships in 24 hours") must not contradict the shipping policy page.
- Return promises on product pages must not contradict the return policy.

ABSOLUTE RULE — BLOG AND EDITORIAL CONTENT:
Blog posts, articles, fiction excerpts, personal essays, and editorial stories operate under completely different rules than product pages. The following types of language in blog/article content are NEVER health claims, NEVER medical claims, and must NEVER be flagged under any severity:
- Emotional or psychological language: "doubt", "anxiety", "spiraled", "felt lighter", "breathe", "vulnerability", "hard days", "healing", "hope", "relief", "pressure"
- Relationship and narrative language: "guardian", "connection", "love", "enduring", "offered", "needed"
- Literary and storytelling devices: metaphor, vulnerability arcs, emotional transformation, character inner states
- Wellness lifestyle language in a personal or narrative context
If the content is on a blog page, article page, or any editorial URL (contains /blogs/, /articles/, /posts/, /news/), treat ALL emotional, psychological, and relational language as creative writing — not as regulated health claims. Only flag blog content if a product is directly named alongside a specific medical outcome claim (e.g. "buy this supplement — it cured my depression").

IMPORTANT — DO NOT FLAG:
- Dates of any kind — "last updated" dates, policy dates, blog post dates, copyright years. Do not attempt to determine whether a date is past or future. Date checking is out of scope for this audit.
- Blog posts, articles, or editorial content for health language (emotional wellness language in blog content is standard)
- Outbound links in blog/editorial pages (these are normal SEO practice)
- Missing phone number or physical address alone (not required by GMC)
- .myshopify.com domain appearing anywhere (this is Shopify infrastructure, not a risk)
- Absence of third-party reviews alone

Keep findings specific and actionable. Quote exact problematic text when you find it. Each recommendation must tell the merchant exactly what to change.
Use the report_compliance tool to return your analysis.`;

    // Inject brand context when scanning any LLC-owned store so Gemini doesn't flag
    // cross-brand emails/domains as identity conflicts — all are the same legal entity.
    const isOwnedStore = LLC_DOMAINS.test(formattedUrl);
    const brandContext = isOwnedStore ? `
VERIFIED BUSINESS CONTEXT — OVERRIDE ANY IDENTITY FINDINGS BELOW:
This store has been pre-verified. The following are FACTS, not risks. Do NOT generate any finding about inconsistent domains, multiple brand identities, subdomain presentation, or brand name mismatches for this store. These are not violations — they are the verified legal structure of this business.

FACTS:
- Legal entity: Go Hard Gaming Discord LLC
- DBA / brand: Iron Phoenix GHG
- Active storefront brand: Our Phoenix Rise
- All of these are the SAME business operating under one LLC with multiple brand layers — this is standard and legal
- All owned domains: ourphoenixrise.com, ironphoenixrise.com, gohardgaming.store, ironphoenix.store, ironphoenixghg.com
- All email domains @ironphoenix.store, @ourphoenixrise.com, @gohardgaming.store, @ironphoenixghg.com belong to the same LLC
- Multiple domains and brand names appearing on this store are EXPECTED and EXPLAINED — do NOT flag as inconsistent, confusing, or misrepresentation
- gohardgaming.com is the ONE domain NOT owned — flag only if found in navigation or checkout

INSTRUCTION: Skip all findings about domain consistency, brand identity conflicts, multiple operating names, or Shopify subdomain presentation for this store. Score only on actual deceptive content, false claims, or policy contradictions.

` : "";

    const userPrompt = `Analyze this e-commerce store for compliance:
${brandContext}
URL: ${formattedUrl}

=== MAIN PAGE CONTENT ===
${pageContent.slice(0, 4500)}

=== SITE MAP (discovered pages) ===
${sitePages.slice(0, 80).join("\n")}

=== POLICY PAGES CONTENT (verify language, consistency, and completeness) ===
${sampledPolicyContent}

=== OTHER PAGES CONTENT (products, blogs, collections) ===
${sampledPageContent.slice(0, 3000)}

=== LINKS FOUND ON MAIN PAGE ===
${pageLinks.slice(0, 50).join("\n")}

=== DIRECT RISK SIGNALS ===
Store domain: ${originHost} (submitted as: ${inputHost})${isMyshopifyUrl ? `
IMPORTANT: The URL submitted was a .myshopify.com backend URL. This is Shopify's internal hosting domain — every Shopify store has one. It is NOT the public storefront domain. Do NOT flag .myshopify.com as an inconsistency, misrepresentation, or domain mismatch. The public domain is the custom domain found in the page content. This is standard Shopify infrastructure.` : ""}
POLICY PAGES SCRAPED AND INCLUDED ABOVE — content is in the POLICY PAGES CONTENT section. Do NOT flag policies as missing or unverifiable — they have been fetched and their text is above. Only flag a policy issue if the actual content is contradictory, blank, or deceptive: ${policyPages.join(", ")}
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
                                  enum: ["gmc_product_data", "gmc_policies", "gmc_shipping", "technical_seo", "gmc_misrepresentation", "policy_consistency"],
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
