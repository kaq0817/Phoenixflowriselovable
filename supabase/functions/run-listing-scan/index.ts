import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";
import { getEtsyApiKeyHeader, getEtsyClientId } from "../_shared/etsy.ts";
import { getShopifyApiVersion } from "../_shared/shopify.ts";
import { getKeywordInsights, hasTikTokTrendsEnv, type TikTokKeywordInsight } from "../_shared/tiktokTrends.ts";

const SHOPIFY_API_VERSION = getShopifyApiVersion();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

interface ListingImage {
  url_170x135?: string;
  src?: string;
}

interface KeywordVerificationResult {
  keyword: string;
  searchVolume: string;
  trending: boolean;
  tiktokTrend: boolean;
  source: "tiktok_api" | "serpapi";
}

interface ListingFinding {
  type: string;
  severity: "critical" | "warning" | "info";
  field: string;
  message: string;
  data?: KeywordVerificationResult[];
}

interface ListingRecord {
  listing_id: number;
  title: string;
  description: string;
  tags: string[];
  materials: string[];
  images: ListingImage[];
  _platform: "etsy" | "shopify";
  _mode?: "public_only" | "oauth";
}

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

const TIKTOK_KEYWORD_LOOKUP_LIMIT = 20;

function normalizeKeyword(keyword: string): string {
  return keyword.toLowerCase().replace(/\s+/g, " ").trim();
}

function selectKeywordsForVerification(tags: string[], limit = 5): string[] {
  const seen = new Set<string>();

  return tags
    .map((tag) => tag.replace(/^#/, "").replace(/\s+/g, " ").trim())
    .filter((tag) => tag.length >= 3)
    .sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length || b.length - a.length)
    .filter((tag) => {
      const normalized = normalizeKeyword(tag);
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .slice(0, limit);
}

function collectScanKeywords(listings: ListingRecord[], limit = TIKTOK_KEYWORD_LOOKUP_LIMIT): string[] {
  const allTags = listings.flatMap((listing) => listing.tags || []);
  return selectKeywordsForVerification(allTags, limit);
}

function getSearchVolumeBucket(searchVolume: number): string {
  if (searchVolume >= 100000) return "high";
  if (searchVolume >= 10000) return "medium";
  return "low";
}

function mapTikTokInsightToVerification(insight: TikTokKeywordInsight): KeywordVerificationResult {
  const trending = insight.volume_trend > 0;
  return {
    keyword: insight.keyword,
    searchVolume: getSearchVolumeBucket(insight.search_volume),
    trending,
    tiktokTrend: trending || insight.search_volume >= 10000,
    source: "tiktok_api",
  };
}

async function prefetchTikTokKeywordInsights(
  keywords: string[],
): Promise<Map<string, KeywordVerificationResult>> {
  const results = new Map<string, KeywordVerificationResult>();

  for (const keyword of keywords.slice(0, TIKTOK_KEYWORD_LOOKUP_LIMIT)) {
    try {
      const response = await getKeywordInsights(keyword);
      if (!response.insight) continue;
      results.set(normalizeKeyword(keyword), mapTikTokInsightToVerification(response.insight));
    } catch (error) {
      console.error(`TikTok keyword lookup failed for "${keyword}":`, error);
    }
  }

  return results;
}

async function verifyKeywordsWithSerpApi(
  keywords: string[],
  serpApiKey: string
): Promise<KeywordVerificationResult[]> {
  const results: KeywordVerificationResult[] = [];

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
        source: "serpapi",
      });
    } catch (e) {
      console.error(`SerpAPI error for "${keyword}":`, e);
      results.push({ keyword, searchVolume: "unknown", trending: false, tiktokTrend: false, source: "serpapi" });
    }
  }

  return results;
}

function calculateListingScore(findings: ListingFinding[]): number {
  let score = 100;
  for (const finding of findings) {
    if (finding.severity === "critical") score -= 15;
    else if (finding.severity === "warning") score -= 7;
    else if (finding.severity === "info") score -= 2;
  }
  return Math.max(0, score);
}

// ─── Main handler ───────────────────────────────────────────

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
    let listings: ListingRecord[] = [];

    if (conn.platform === "etsy") {
      const isPublicOnly = (conn.access_token || "").toLowerCase() === "public_only" || (conn.scopes || "") === "public_read";

      // Check token expiry and refresh if needed
      let accessToken = conn.access_token;
      if (!isPublicOnly && (conn.token_expires_at && new Date(conn.token_expires_at) < new Date())) {
        const etsyClientId = getEtsyClientId();
        const refreshRes = await fetch("https://api.etsy.com/v3/public/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: etsyClientId,
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

      // Use the stored Etsy shop ID from the connection row.
      const shopId = conn.shop_domain;

      if (shopId) {
        const apiKeyHeader = getEtsyApiKeyHeader();
        const etsyHeaders: Record<string, string> = { "x-api-key": apiKeyHeader };
        if (!isPublicOnly) {
          etsyHeaders.Authorization = `Bearer ${accessToken}`;
        }
        const MAX_LISTINGS = 500;
        let offset = 0;
        const PAGE_SIZE = 100;

        while (listings.length < MAX_LISTINGS) {
          const listRes = await fetch(
            isPublicOnly
              ? `https://api.etsy.com/v3/application/shops/${shopId}/listings/active?limit=${PAGE_SIZE}&offset=${offset}&includes=Images`
              : `https://api.etsy.com/v3/application/shops/${shopId}/listings?state=active&limit=${PAGE_SIZE}&offset=${offset}&includes=Images`,
            { headers: etsyHeaders }
          );
          if (!listRes.ok) break;
          const listData = await listRes.json();
          const page = listData.results || [];
          if (page.length === 0) break;
          for (const l of page) {
            listings.push({
              listing_id: l.listing_id,
              title: l.title || "",
              description: l.description || "",
              tags: l.tags || [],
              materials: l.materials || [],
              images: l.images || l.Images || [],
              _platform: "etsy",
              _mode: isPublicOnly ? "public_only" : "oauth",
            });
          }
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
        listings = listings.filter((l) => {
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
        `https://${conn.shop_domain}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=250&status=active`;
      
      while (url && listings.length < MAX_PRODUCTS) {
        const shopRes: Response = await fetch(url, {
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
            images: product.images?.map((img: { src?: string }) => ({ url_170x135: img.src })) || [],
            _platform: "shopify",
          });
        }

        // Pagination via Link header
        const linkHeader: string = shopRes.headers.get("Link") || "";
        const nextMatch: RegExpMatchArray | null = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
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

    const SERPAPI_KEY = Deno.env.get("SERPAPI_API_KEY") || Deno.env.get("SERPAPI_KEY");
    let tiktokKeywordResults = new Map<string, KeywordVerificationResult>();
    if (hasTikTokTrendsEnv()) {
      try {
        tiktokKeywordResults = await prefetchTikTokKeywordInsights(collectScanKeywords(listings));
      } catch (error) {
        console.error("TikTok keyword prefetch failed:", error);
      }
    }
    const allFindings: Array<{
      listing_id: number | string;
      title: string;
      image: string | null;
      findings: ListingFinding[];
    }> = [];
    const memoryRows: Record<string, unknown>[] = [];
    let processed = 0;
    const scannedAt = new Date().toISOString();
    const storeId = String(conn.shop_domain || conn.id);

    // ─── Process each listing autonomously ───
    for (const listing of listings) {
      const listingFindings: ListingFinding[] = [];
      const title = listing.title || "";
      const description = listing.description || "";
      const tags = listing.tags || [];

      // 1. Quote characters in title — GMC and Shopify flag these
      if (/[""\u201C\u201D]/.test(title)) {
        listingFindings.push({
          type: "quotes_in_title",
          severity: "critical",
          field: "title",
          message: `Title contains quote characters ("..."). Google Merchant Center rejects titles with decorative or straight quotes. Remove them — use a colon or pipe instead.`,
        });
      }

      // 2. Spelling check
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
      // 4. Keyword verification (TikTok first, SerpAPI fallback)
      const selectedKeywords = selectKeywordsForVerification(tags);
      if ((tiktokKeywordResults.size > 0 || SERPAPI_KEY) && selectedKeywords.length > 0) {
        try {
          const keywordResults: KeywordVerificationResult[] = [];
          const seenKeywords = new Set<string>();

          for (const keyword of selectedKeywords) {
            const normalized = normalizeKeyword(keyword);
            const tiktokMatch = tiktokKeywordResults.get(normalized);
            if (!tiktokMatch) continue;

            keywordResults.push({ ...tiktokMatch, keyword });
            seenKeywords.add(normalized);
          }

          if (SERPAPI_KEY) {
            const missingKeywords = selectedKeywords.filter((keyword) => !seenKeywords.has(normalizeKeyword(keyword)));
            if (missingKeywords.length > 0) {
              const serpResults = await verifyKeywordsWithSerpApi(missingKeywords, SERPAPI_KEY);
              for (const result of serpResults) {
                const normalized = normalizeKeyword(result.keyword);
                if (seenKeywords.has(normalized)) continue;
                keywordResults.push(result);
                seenKeywords.add(normalized);
              }
            }
          }

          if (keywordResults.length > 0) {
            const lowVolume = keywordResults.filter((keyword) => keyword.searchVolume === "low");
            const tiktokTrending = keywordResults.filter((keyword) => keyword.tiktokTrend);

            if (lowVolume.length > 0) {
              listingFindings.push({
                type: "low_volume_keywords",
                severity: "warning",
                field: "tags",
                message: `Low search volume keyword phrases: ${lowVolume.map((keyword) => keyword.keyword).join(", ")}. Consider pivoting toward stronger long-tail phrases.`,
              });
            }

            if (tiktokTrending.length > 0) {
              listingFindings.push({
                type: "tiktok_trending",
                severity: "info",
                field: "tags",
                message: `TikTok trending: ${tiktokTrending.map((keyword) => keyword.keyword).join(", ")}. These phrases currently show TikTok momentum.`,
              });
            }

            listingFindings.push({
              type: "keyword_research",
              severity: "info",
              field: "tags",
              message: "Keyword verification complete",
              data: keywordResults,
            });
          }
        } catch (e) {
          console.error("Keyword verification error:", e);
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

      memoryRows.push({
        user_id: userId,
        store_type: conn.platform,
        store_id: storeId,
        product_id: String(listing.listing_id),
        product_title: title.slice(0, 255),
        last_scan_score: calculateListingScore(listingFindings),
        last_scan_date: scannedAt,
        optimization_reasons: listingFindings.length > 0 ? listingFindings.map((finding) => finding.type) : null,
      });

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
      (sum, l) => sum + l.findings.filter((f) => f.severity === "critical").length, 0
    );
    const warningCount = allFindings.reduce(
      (sum, l) => sum + l.findings.filter((f) => f.severity === "warning").length, 0
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

    if (memoryRows.length > 0) {
      const { error: memoryError } = await serviceSupabase
        .from("product_memory")
        .upsert(memoryRows, { onConflict: "user_id,store_type,store_id,product_id" });

      if (memoryError) {
        console.error("product_memory upsert failed:", memoryError);
      }
    }

    // ─── Send email notification ───
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
              reportType: "listing",
              storeUrl: conn.shop_domain || "",
              summary,
              listingsWithIssues: allFindings.length,
              totalScanned: listings.length,
              findings: allFindings.slice(0, 25),
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














