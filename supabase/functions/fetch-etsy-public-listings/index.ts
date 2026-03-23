const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

function normalizeShopName(input: string): string {
  let value = input.trim();

  const urlMatch = value.match(/etsy\.com\/shop\/([^/?&#]+)/i);
  if (urlMatch?.[1]) return decodeURIComponent(urlMatch[1]);

  const subdomainMatch = value.match(/^https?:\/\/([a-zA-Z0-9_-]+)\.etsy\.com/i)
    || value.match(/^([a-zA-Z0-9_-]+)\.etsy\.com/i);
  if (subdomainMatch?.[1]) return decodeURIComponent(subdomainMatch[1]);

  value = value.replace(/^@/, "").replace(/^\/+|\/+$/g, "");
  return decodeURIComponent(value);
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function parseFallbackShopData(html: string, cleanShopName: string, limit: number, offset: number) {
  const shopIdMatch =
    html.match(/"shop_id"\s*:\s*(\d+)/i) ||
    html.match(/"shopId"\s*:\s*(\d+)/i);
  const shopId = shopIdMatch?.[1] ? Number(shopIdMatch[1]) : null;

  const titleMatch = html.match(/<title>(.*?)<\/title>/i);
  const shopNameFromTitle = titleMatch?.[1]
    ?.replace(/\s*\|\s*Etsy.*$/i, "")
    ?.replace(/\s*-\s*Etsy.*$/i, "")
    ?.trim();

  const listingRegex = new RegExp("/listing/(\\d+)", "g");
  const listingIds = Array.from(html.matchAll(listingRegex))
    .map((m) => Number(m[1]))
    .filter((id) => Number.isFinite(id));

  const uniqueListingIds = Array.from(new Set(listingIds));
  const pagedListingIds = uniqueListingIds.slice(offset, offset + limit);

  const results = pagedListingIds.map((listingId) => {
    const anchorRegex = new RegExp(
      `<a[^>]*href=["'][^"']*/listing/${listingId}[^"']*["'][^>]*>([\\s\\S]*?)<\/a>`,
      "i",
    );
    const anchorMatch = html.match(anchorRegex);
    const guessedTitle = anchorMatch?.[1] ? stripHtml(anchorMatch[1]).slice(0, 140) : `Listing ${listingId}`;

    return {
      listing_id: listingId,
      title: guessedTitle || `Listing ${listingId}`,
      description: "",
      tags: [],
      materials: [],
      state: "active",
      images: [],
    };
  });

  return {
    shop_id: shopId,
    shop_name: shopNameFromTitle || cleanShopName,
    count: uniqueListingIds.length,
    results,
    source: "etsy_html_fallback",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { shopName, limit = 25, offset = 0 } = await req.json();

    if (!shopName) {
      return new Response(JSON.stringify({ error: "Shop name is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cleanShopName = normalizeShopName(shopName);
    const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const safeOffset = Math.max(Number(offset) || 0, 0);

    console.log("Fetching public listings for shop:", cleanShopName);

    const clientId = Deno.env.get("ETSY_CLIENT_ID") || Deno.env.get("ETSY_API_KEY");

    if (clientId) {
      try {
        const shopRes = await fetch(
          `https://openapi.etsy.com/v3/application/shops?shop_name=${encodeURIComponent(cleanShopName)}`,
          { headers: { "x-api-key": clientId } },
        );

        if (shopRes.ok) {
          const shopData = await shopRes.json();
          const shop = shopData.results?.[0];

          if (shop?.shop_id) {
            const shopId = shop.shop_id;
            const shopDisplayName = shop.shop_name || cleanShopName;

            const listingsRes = await fetch(
              `https://openapi.etsy.com/v3/application/shops/${shopId}/listings/active?limit=${safeLimit}&offset=${safeOffset}&includes=Images`,
              { headers: { "x-api-key": clientId } },
            );

            if (listingsRes.ok) {
              const listingsData = await listingsRes.json();
              return new Response(
                JSON.stringify({
                  ...listingsData,
                  shop_id: shopId,
                  shop_name: shopDisplayName,
                  source: "etsy_openapi",
                }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } },
              );
            }

            const listErrText = await listingsRes.text();
            console.error("Listings fetch failed with API key:", listErrText);
          }
        } else {
          const errText = await shopRes.text();
          console.error("Shop lookup failed:", errText);
        }
      } catch (apiError) {
        console.error("Open API path failed, falling back to HTML:", apiError);
      }
    } else {
      console.warn("ETSY_CLIENT_ID not configured; using HTML fallback.");
    }

    // Fallback path (does not require Etsy API key): scrape public shop page
    const fallbackUrls = [
      `https://www.etsy.com/shop/${encodeURIComponent(cleanShopName)}`,
      `https://${encodeURIComponent(cleanShopName)}.etsy.com`,
    ];

    let html = "";
    let foundPage = false;
    for (const url of fallbackUrls) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          html = await res.text();
          foundPage = true;
          break;
        }
      } catch {
        // try next URL
      }
    }

    if (!foundPage) {
      return new Response(JSON.stringify({ error: "Could not find that Etsy shop. Check the name and try again." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const fallbackData = parseFallbackShopData(html, cleanShopName, safeLimit, safeOffset);

    if (!fallbackData.shop_id && fallbackData.results.length === 0) {
      return new Response(JSON.stringify({ error: "Could not find active listings for that Etsy shop." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        ...fallbackData,
        warning:
          "Using public HTML fallback. Read-only listing retrieval is available, but policy/advanced API operations require valid Etsy API credentials.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("fetch-etsy-public-listings error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});



