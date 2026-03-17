import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Helpers ────────────────────────────────────────────────

function findSpellingIssues(text: string): string[] {
  // Common e-commerce misspellings
  const commonMisspellings: Record<string, string> = {
    "recieve": "receive", "seperate": "separate", "occured": "occurred",
    "accomodate": "accommodate", "definately": "definitely", "neccessary": "necessary",
    "occurence": "occurrence", "wierd": "weird", "acheive": "achieve",
    "beleive": "believe", "calender": "calendar", "catagory": "category",
    "cemetary": "cemetery", "collegue": "colleague", "comming": "coming",
    "committment": "commitment", "concious": "conscious", "curiousity": "curiosity",
    "embarass": "embarrass", "enviroment": "environment", "existance": "existence",
    "foriegn": "foreign", "freind": "friend", "goverment": "government",
    "garentee": "guarantee", "harrass": "harass", "immedietly": "immediately",
    "independant": "independent", "jewelery": "jewelry", "judgement": "judgment",
    "knowlege": "knowledge", "liason": "liaison", "libary": "library",
    "maintenence": "maintenance", "millenium": "millennium", "mischievious": "mischievous",
    "neice": "niece", "noticable": "noticeable", "ocassion": "occasion",
    "parliment": "parliament", "persistant": "persistent", "posession": "possession",
    "publically": "publicly", "recomend": "recommend", "refered": "referred",
    "relevent": "relevant", "restaraunt": "restaurant", "rythm": "rhythm",
    "sieze": "seize", "supercede": "supersede", "thier": "their",
    "tommorow": "tomorrow", "untill": "until", "vaccuum": "vacuum",
    "wether": "whether", "writting": "writing", "handmaid": "handmade",
    "custome": "custom", "shiping": "shipping", "quailty": "quality",
    "orignal": "original", "artisian": "artisan", "boheimian": "bohemian",
    "minamilist": "minimalist", "perssonalized": "personalized",
  };

  const issues: string[] = [];
  const words = text.toLowerCase().split(/\s+/);
  for (const word of words) {
    const clean = word.replace(/[^a-z]/g, "");
    if (commonMisspellings[clean]) {
      issues.push(`"${clean}" → "${commonMisspellings[clean]}"`);
    }
  }
  return [...new Set(issues)];
}

function findDuplicateKeywords(tags: string[], title: string): string[] {
  const titleWords = title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const tagWords = tags.map(t => t.toLowerCase().trim());
  const duplicates: string[] = [];

  // Find tags that are subsets of title words (wasted tags)
  for (const tag of tagWords) {
    const tagParts = tag.split(/\s+/);
    if (tagParts.every(part => titleWords.includes(part)) && tagParts.length > 0) {
      duplicates.push(tag);
    }
  }

  // Find duplicate/overlapping tags
  for (let i = 0; i < tagWords.length; i++) {
    for (let j = i + 1; j < tagWords.length; j++) {
      if (tagWords[i] === tagWords[j]) {
        duplicates.push(`duplicate tag: "${tagWords[i]}"`);
      }
    }
  }

  return [...new Set(duplicates)];
}

async function verifyKeywordsWithSerpApi(
  keywords: string[],
  serpApiKey: string
): Promise<{ keyword: string; searchVolume: string; trending: boolean; tiktokTrend: boolean }[]> {
  const results = [];

  for (const keyword of keywords.slice(0, 5)) { // limit to 5 to preserve API credits
    try {
      // Google search check
      const googleRes = await fetch(
        `https://serpapi.com/search.json?q=${encodeURIComponent(keyword)}&api_key=${serpApiKey}&num=5`
      );
      const googleData = googleRes.ok ? await googleRes.json() : null;
      const totalResults = googleData?.search_information?.total_results || 0;

      // TikTok trend check via SerpAPI
      let tiktokTrend = false;
      try {
        const tiktokRes = await fetch(
          `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(keyword + " site:tiktok.com")}&api_key=${serpApiKey}&num=3`
        );
        if (tiktokRes.ok) {
          const tiktokData = await tiktokRes.json();
          const tiktokResults = tiktokData?.search_information?.total_results || 0;
          tiktokTrend = tiktokResults > 1000;
        }
      } catch {
        // TikTok check is best-effort
      }

      results.push({
        keyword,
        searchVolume: totalResults > 1000000 ? "high" : totalResults > 100000 ? "medium" : "low",
        trending: totalResults > 500000,
        tiktokTrend,
      });
    } catch (e) {
      console.error(`SerpAPI error for "${keyword}":`, e);
      results.push({ keyword, searchVolume: "unknown", trending: false, tiktokTrend: false });
    }
  }

  return results;
}

// ─── Main handler ───────────────────────────────────────────

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
    const userEmail = userData.user.email;

    const { scanJobId, connectionId } = await req.json();

    // Use service role for updates (RLS won't block background writes)
    const serviceSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Read job to determine intended platform
    const { data: scanJob } = await serviceSupabase
      .from("scan_jobs")
      .select("platform")
      .eq("id", scanJobId)
      .maybeSingle();

    const scanPlatform = scanJob?.platform || "etsy";

    // Mark job as processing
    await serviceSupabase.from("scan_jobs").update({
      status: "processing",
      started_at: new Date().toISOString(),
    }).eq("id", scanJobId);

    // Get store connection for the requested platform (supports multiple stores)
    let connQuery = supabase
      .from("store_connections")
      .select("*")
      .eq("user_id", userId)
      .eq("platform", scanPlatform)
      .order("created_at", { ascending: false })
      .limit(1);

    if (connectionId) {
      connQuery = connQuery.eq("id", connectionId);
    }

    const { data: connRows } = await connQuery;
    const conn = connRows?.[0];

    if (!conn) {
      await serviceSupabase.from("scan_jobs").update({
        status: "failed",
        error_message: `No ${scanPlatform} store connected. Please connect your store first.`,
      }).eq("id", scanJobId);
      return new Response(JSON.stringify({ error: `No ${scanPlatform} store connected` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Fetch listings based on platform ───
    let listings: any[] = [];

    if (conn.platform === "etsy") {
      // Check token expiry and refresh if needed
      let accessToken = conn.access_token;
      if (conn.token_expires_at && new Date(conn.token_expires_at) < new Date()) {
        const ETSY_API_KEY = Deno.env.get("ETSY_API_KEY");
        const refreshRes = await fetch("https://api.etsy.com/v3/public/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: ETSY_API_KEY!,
            refresh_token: conn.refresh_token!,
          }),
        });
        if (refreshRes.ok) {
          const tokens = await refreshRes.json();
          accessToken = tokens.access_token;
          await serviceSupabase.from("store_connections").update({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
          }).eq("id", conn.id);
        }
      }

      // Extract shop ID from scopes (format: "shops_r:SHOPID ...")
      const shopMatch = conn.scopes?.match(/shops_r:(\d+)/);
      const shopId = shopMatch?.[1] || conn.shop_domain;

      if (shopId) {
        const etsyHeaders = { "x-api-key": Deno.env.get("ETSY_API_KEY")!, Authorization: `Bearer ${accessToken}` };
        const MAX_LISTINGS = 500;
        let offset = 0;
        const PAGE_SIZE = 100;

        while (listings.length < MAX_LISTINGS) {
          const listRes = await fetch(
            `https://openapi.etsy.com/v3/application/shops/${shopId}/listings?state=active&limit=${PAGE_SIZE}&offset=${offset}&includes=Images`,
            { headers: etsyHeaders }
          );
          if (!listRes.ok) break;
          const listData = await listRes.json();
          const page = listData.results || [];
          if (page.length === 0) break;
          listings.push(...page);
          offset += PAGE_SIZE;
          if (page.length < PAGE_SIZE) break; // last page
        }

        // Cap at 500
        listings = listings.slice(0, MAX_LISTINGS);

        // Filter to parent/main listings only — exclude children/variations
        // Etsy parent listings have no `shop_section_id` parent ref and aren't digital downloads with parent IDs
        // The key indicator: listings with `has_variations` are parents; we skip any that are variation children
        // In Etsy API v3, all returned listings from /shops/{id}/listings are already parent-level
        // But we also exclude any that might be duplicated by checking listing_id uniqueness
        const seenIds = new Set<number>();
        listings = listings.filter((l: any) => {
          if (seenIds.has(l.listing_id)) return false;
          seenIds.add(l.listing_id);
          return true;
        });

        console.log(`Fetched ${listings.length} parent Etsy listings (${offset} total API offset)`);
      }
    }

    // ─── Shopify support ───
    if (conn.platform === "shopify" && conn.shop_domain) {
      const MAX_PRODUCTS = 500;
      let url: string | null =
        `https://${conn.shop_domain}/admin/api/2024-01/products.json?limit=250&status=active`;
      
      while (url && listings.length < MAX_PRODUCTS) {
        const shopRes = await fetch(url, {
          headers: { "X-Shopify-Access-Token": conn.access_token },
        });
        if (!shopRes.ok) break;

        const shopData = await shopRes.json();
        const products = shopData.products || [];
        
        // Only parent products — each product object IS the parent; variants are nested
        for (const product of products) {
          listings.push({
            listing_id: product.id,
            title: product.title || "",
            description: product.body_html?.replace(/<[^>]*>/g, " ") || "",
            tags: (product.tags || "").split(",").map((t: string) => t.trim()).filter(Boolean),
            materials: [],
            images: product.images?.map((img: any) => ({ url_170x135: img.src })) || [],
            _platform: "shopify",
          });
        }

        // Pagination via Link header
        const linkHeader = shopRes.headers.get("Link") || "";
        const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
        url = nextMatch ? nextMatch[1] : null;
      }

      listings = listings.slice(0, MAX_PRODUCTS);
      console.log(`Fetched ${listings.length} parent Shopify products`);
    }

    if (listings.length === 0) {
      await serviceSupabase.from("scan_jobs").update({
        status: "completed",
        total_items: 0,
        processed_items: 0,
        summary: { message: "No active listings found to scan." },
        completed_at: new Date().toISOString(),
      }).eq("id", scanJobId);
      return new Response(JSON.stringify({ message: "No listings found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update total
    await serviceSupabase.from("scan_jobs").update({
      total_items: listings.length,
    }).eq("id", scanJobId);

    const SERPAPI_KEY = Deno.env.get("SERPAPI_API_KEY");
    const allFindings: any[] = [];
    let processed = 0;

    // ─── Process each listing autonomously ───
    for (const listing of listings) {
      const listingFindings: any[] = [];
      const title = listing.title || "";
      const description = listing.description || "";
      const tags = listing.tags || [];

      // 1. Spelling check
      const titleSpelling = findSpellingIssues(title);
      const descSpelling = findSpellingIssues(description);
      if (titleSpelling.length > 0) {
        listingFindings.push({
          type: "spelling",
          severity: "warning",
          field: "title",
          message: `Possible spelling issues in title: ${titleSpelling.join(", ")}`,
        });
      }
      if (descSpelling.length > 0) {
        listingFindings.push({
          type: "spelling",
          severity: "info",
          field: "description",
          message: `Possible spelling issues in description: ${descSpelling.join(", ")}`,
        });
      }

      // 2. Duplicate/wasted keyword check
      const duplicates = findDuplicateKeywords(tags, title);
      if (duplicates.length > 0) {
        listingFindings.push({
          type: "duplicate_keywords",
          severity: "warning",
          field: "tags",
          message: `Wasted/duplicate keywords: ${duplicates.join(", ")}. Tags should add NEW keywords not already in the title.`,
        });
      }

      // 3. Tag count check
      if (tags.length < 13) {
        listingFindings.push({
          type: "missing_tags",
          severity: "critical",
          field: "tags",
          message: `Only ${tags.length}/13 tags used. You're leaving SEO opportunity on the table.`,
        });
      }

      // 4. SerpAPI keyword verification (top 5 tags)
      if (SERPAPI_KEY && tags.length > 0) {
        try {
          const keywordResults = await verifyKeywordsWithSerpApi(tags.slice(0, 5), SERPAPI_KEY);
          const lowVolume = keywordResults.filter(k => k.searchVolume === "low");
          const tiktokTrending = keywordResults.filter(k => k.tiktokTrend);

          if (lowVolume.length > 0) {
            listingFindings.push({
              type: "low_volume_keywords",
              severity: "warning",
              field: "tags",
              message: `Low search volume keywords: ${lowVolume.map(k => k.keyword).join(", ")}. Consider replacing with higher-demand terms.`,
            });
          }

          if (tiktokTrending.length > 0) {
            listingFindings.push({
              type: "tiktok_trending",
              severity: "info",
              field: "tags",
              message: `🔥 TikTok trending: ${tiktokTrending.map(k => k.keyword).join(", ")}. Great — these keywords have TikTok presence!`,
            });
          }

          // Store keyword data
          listingFindings.push({
            type: "keyword_research",
            severity: "info",
            field: "tags",
            message: "Keyword verification complete",
            data: keywordResults,
          });
        } catch (e) {
          console.error("SerpAPI batch error:", e);
        }
      }

      // 5. Description length check
      if (description.length < 100) {
        listingFindings.push({
          type: "short_description",
          severity: "critical",
          field: "description",
          message: "Description is too short. Aim for at least 300+ characters with relevant keywords.",
        });
      }

      // Only include listings WITH issues
      if (listingFindings.length > 0) {
        allFindings.push({
          listing_id: listing.listing_id,
          title: title.slice(0, 100),
          image: listing.images?.[0]?.url_170x135 || null,
          findings: listingFindings,
        });
      }

      processed++;
      // Update progress every 5 listings
      if (processed % 5 === 0 || processed === listings.length) {
        await serviceSupabase.from("scan_jobs").update({
          processed_items: processed,
        }).eq("id", scanJobId);
      }
    }

    // ─── Compile summary ───
    const totalIssues = allFindings.reduce((sum, l) => sum + l.findings.length, 0);
    const criticalCount = allFindings.reduce(
      (sum, l) => sum + l.findings.filter((f: any) => f.severity === "critical").length, 0
    );
    const warningCount = allFindings.reduce(
      (sum, l) => sum + l.findings.filter((f: any) => f.severity === "warning").length, 0
    );

    const summary = {
      total_listings_scanned: listings.length,
      listings_with_issues: allFindings.length,
      total_issues: totalIssues,
      critical_count: criticalCount,
      warning_count: warningCount,
      info_count: totalIssues - criticalCount - warningCount,
    };

    // ─── Store results ───
    await serviceSupabase.from("scan_jobs").update({
      status: "completed",
      processed_items: processed,
      findings: allFindings,
      summary,
      completed_at: new Date().toISOString(),
    }).eq("id", scanJobId);

    // ─── Send email notification ───
    if (userEmail) {
      try {
        const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
        const SUPABASE_PROJECT_ID = Deno.env.get("SUPABASE_URL")?.match(/https:\/\/(.+)\.supabase/)?.[1];

        if (LOVABLE_API_KEY && SUPABASE_PROJECT_ID) {
          await fetch(`https://${SUPABASE_PROJECT_ID}.supabase.co/functions/v1/send-scan-email`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({
              to: userEmail,
              summary,
              listingsWithIssues: allFindings.length,
              totalScanned: listings.length,
            }),
          });
        }
      } catch (e) {
        console.error("Email notification failed (non-blocking):", e);
      }
    }

    return new Response(JSON.stringify({ success: true, summary, scanJobId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("run-listing-scan error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
