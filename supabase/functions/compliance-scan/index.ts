import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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
    const userId = userData.user.id;

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

    // Step 2: Map the site to find policy pages
    const mapRes = await fetch("https://api.firecrawl.dev/v1/map", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: formattedUrl,
        search: "privacy policy refund return shipping terms contact about",
        limit: 50,
        includeSubdomains: false,
      }),
    });

    let sitePages: string[] = [];
    if (mapRes.ok) {
      const mapData = await mapRes.json();
      sitePages = mapData.links || [];
      console.log("Mapped pages:", sitePages.length);
    }

    // Step 3: Scrape key policy pages
    const policyKeywords = ["privacy", "refund", "return", "shipping", "terms", "contact", "about", "faq"];
    const policyPages = sitePages.filter((link: string) =>
      policyKeywords.some(kw => link.toLowerCase().includes(kw))
    ).slice(0, 6); // max 6 policy pages

    let policyContent = "";
    for (const policyUrl of policyPages) {
      try {
        const pRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: policyUrl,
            formats: ["markdown"],
            onlyMainContent: true,
          }),
        });
        if (pRes.ok) {
          const pData = await pRes.json();
          const md = pData.data?.markdown || pData.markdown || "";
          policyContent += `\n\n--- PAGE: ${policyUrl} ---\n${md.slice(0, 3000)}`;
        }
      } catch (e) {
        console.error("Failed to scrape policy page:", policyUrl, e);
      }
    }

    // Step 4: AI Analysis
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("Gemini API key not configured");

    const systemPrompt = `You are a world-class e-commerce compliance auditor. You specialize in Google Merchant Center (GMC) suspension prevention, Etsy seller compliance, and general e-commerce best practices.

You MUST check EVERY item from this official GMC Suspension Checklist. For each item, determine if it passes, fails (critical), or needs attention (warning) based on the website content provided.

## GMC SUSPENSION CHECKLIST

### 1. SOLID FOUNDATIONS
- Website loads quickly and isn't clunky
- Clear, easy to navigate site, no broken links, no gimmicks (e.g. custom cursor graphic)
- No English mistakes or errors in the website
- No stock photos used across the entire website
- No fake reviews or reviews imported relating to other businesses
- Website has above-average reviews on trusted third-party review sites (TrustPilot, Reviews.io, Yotpo)
- All apps and plugins functioning correctly
- Not dropshipping with long delivery fulfilment measured in weeks

### 2. CONTACT INFORMATION
- Physical address on website
- Customer service telephone number
- Branded email address matching store domain (@nameofthestore.com, NOT @gmail.com or @outlook.com)
- Email, address & phone number listed on the contact page AND footer
- Dedicated Contact page exists
- Contact form on the Contact page
- Business contact hours listed on website
- Estimated response time on Contact page
- SSL certificate installed (https)
- Website language appropriate for targeted location

### 3. LEGAL PAGES
- Terms & Conditions page exists
- Privacy Policy page exists
- Terms & Conditions page unique to website (no mentions of other brands/products)
- Privacy Policy clearly explains how users' browsing data may be used
- Links to legal pages present in footer

### 4. RETURNS & REFUNDS
- Clearly indicates the process for requesting a refund or returning an item
- Clearly outlines the process for different circumstances for refunds/returns
- Clear timeframe for each circumstance of return or refund
- Clearly outlines the time it takes to receive the refund
- Indicates the method of return of the refund
- Indicates the return period (how long before they can no longer return)
- Language used same as native language of target location
- Returns & Refund messaging consistent throughout website, no misleading or false claims

### 5. SHIPPING
- Shipping process matches actual shipping process
- Cost of shipping for each location if applicable
- Time to ship to each location
- Courier/postal service details for each location (UPS, FedEx, DHL, etc.)
- Tracking information clear
- Instructions for checking order status available on website (not just email)
- States process for missing items
- Shipping process is fast (not taking more than 1 week)
- Shipping messaging consistent throughout website, no misleading or false claims

### 6. BRANDING & HOMEPAGE
- High quality logo (not blurry)
- URL and store name legitimate and non-spammy
- Brand present on homepage (not just a grid of products)
- Header navigation includes about and contact pages
- Footer has all necessary links (Shipping, Return policies, legal pages)
- Footer has contact information (email, physical address, contact number)

### 7. PRODUCT PAGES
- No false or misleading claims; claims backed with evidence
- Real reviews for each product
- Product availability clear (in stock, out of stock)
- Content targeted towards customers with relevant messaging, features & benefits
- Mix of rich text and image content
- Products not dangerous
- Products not counterfeit or infringing trademarks
- Accurate product condition if selling opened or used items
- Descriptive product titles (not ambiguous)
- Accurate pricing
- Product imagery clear, no watermarks or badges; ideally on white background
- Tax information detailed on product page or incorporated into final price

### 8. PRICING & PAYMENT
- Checkout pages secure with SSL
- At least one mainstream payment method available
- Payment methods visible in footer
- Final price clear with no hidden charges
- All advertised discounts usable during checkout
- Discounts accurate
- Tax information consistent through product, cart, and checkout
- "Buy Now" payment methods match product page price
- "Buy Now / Pay Later" options are optional, not default

### 9. MISLEADING INFORMATION
- No claims of certified reseller when not the case
- No extravagant and unlikely claims about brand or products
- No use of trust stamps without proper affiliation
- No false statements about identity, qualifications, or products

## ETSY COMPLIANCE (if applicable)
- Intellectual property concerns in listings
- Prohibited items indicators
- Handmade/vintage claim accuracy
- Star Seller requirements gaps

## GENERAL E-COMMERCE
- Cookie consent / GDPR compliance
- Accessibility (alt text on images)
- Mobile responsiveness indicators

For EACH checklist item, report whether it passes, fails, or cannot be determined from available content. Rate findings as "critical" (GMC suspension risk), "warning" (improvement needed), "info" (recommendation), or "pass" (compliant).

Calculate an overall compliance score 0-100 based on checklist coverage.

Use the report_compliance tool to return your analysis.`;

    const userPrompt = `Analyze this e-commerce store for compliance:

URL: ${formattedUrl}

=== MAIN PAGE CONTENT ===
${pageContent.slice(0, 8000)}

=== SITE MAP (discovered pages) ===
${sitePages.slice(0, 30).join("\n")}

=== POLICY PAGES CONTENT ===
${policyContent.slice(0, 12000)}

=== LINKS FOUND ON MAIN PAGE ===
${pageLinks.slice(0, 50).join("\n")}`;

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

    const aiData = await aiResponse.json();
    const functionCall = aiData.candidates?.[0]?.content?.parts?.find((p: any) => p.functionCall);
    if (!functionCall) throw new Error("No analysis result returned");

    const report = functionCall.functionCall.args;

    // Calculate counts
    const criticalCount = report.findings.filter((f: any) => f.severity === "critical").length;
    const warningCount = report.findings.filter((f: any) => f.severity === "warning").length;
    const passedCount = report.findings.filter((f: any) => f.severity === "pass").length;

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
