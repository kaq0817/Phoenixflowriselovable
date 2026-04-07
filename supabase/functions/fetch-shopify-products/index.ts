import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";
import { getShopifyApiVersion } from "../_shared/shopify.ts";

const SHOPIFY_API_VERSION = getShopifyApiVersion();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};


interface ShopifyProduct {
  id: number;
  title: string;
  body_html: string;
  status: string;
  tags: string | string[];
  images: Array<{ alt?: string | null }>;
  trashPriority?: number;
}

function normalizeTags(tags: string | string[] | null | undefined): string[] {
  if (Array.isArray(tags)) return tags.map((t) => `${t}`.trim()).filter(Boolean);
  return `${tags || ""}`.split(",").map((t) => t.trim()).filter(Boolean);
}

function stripHtml(value: string | null | undefined): string {
  return `${value || ""}`.replace(/<[^>]*>/g, "").trim();
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const {
      limit = 10,
      connectionId,
      pagesToScan = 5,
      pageInfoCursor = null,
    } = await req.json().catch(() => ({}));

    if (!connectionId) {
      return new Response(JSON.stringify({ error: "Missing connectionId" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: connectionRows, error: connErr } = await supabase
      .from("store_connections")
      .select("*")
      .eq("user_id", user.id)
      .eq("platform", "shopify")
      .eq("id", connectionId);
    
    const connection = connectionRows?.[0];

    if (connErr || !connection) {
      return new Response(JSON.stringify({ error: "No Shopify connection found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const shop = connection.shop_domain;
    const accessToken = connection.access_token;

    // Scan up to pagesToScan pages starting from the provided cursor (or the beginning)
    const fields = "id,title,body_html,product_type,vendor,tags,variants,images,handle,status,metafields_global_description_tag";
    const oldestFirstOrder = "created_at+asc";
    const scanLimit = 10;
    const pagesWindow = Math.max(1, Math.min(Number(pagesToScan) || 5, 5));
    const requestedLimit = Math.max(1, Math.min(Number(limit) || 10, 50));
    const foundTrash: ShopifyProduct[] = [];
    // Start from the cursor the client sent, or from the beginning
    let nextPageInfo: string | null = pageInfoCursor || null;
    let scoredPages = 0;

    while (scoredPages < pagesWindow) {
      let apiUrl: string;
      if (nextPageInfo) {
        // Cursor-based: only limit + page_info allowed by Shopify
        apiUrl = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=${scanLimit}&page_info=${encodeURIComponent(nextPageInfo)}`;
      } else {
        apiUrl = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=${scanLimit}&published_status=any&order=${oldestFirstOrder}&fields=${encodeURIComponent(fields)}`;
      }

      const response = await fetch(apiUrl, {
        headers: { "X-Shopify-Access-Token": accessToken },
      });

      if (!response.ok) {
        return new Response(JSON.stringify({ error: "Shopify API error" }), { status: 500, headers: corsHeaders });
      }

      const data = await response.json();
      const batch: ShopifyProduct[] = data.products || [];
      if (batch.length === 0) break;

      const linkHeader = response.headers.get("Link");
      const nextMatch = linkHeader?.match(/<[^>]*[?&]page_info=([^&>]*)[^>]*>;\s*rel="next"/i);
      nextPageInfo = nextMatch ? decodeURIComponent(nextMatch[1]) : null;

      scoredPages += 1;

      const scoredProducts = batch.map((p) => {
        let priority = 0;
        const title = p.title || "";
        const body = stripHtml(p.body_html);
        const tagCount = normalizeTags(p.tags).length;
        const hasImages = Array.isArray(p.images) && p.images.length > 0;
        const hasMissingAlts = (p.images || []).some((img) => !img?.alt || img.alt.trim() === "");
        const normalizedAlts = (p.images || [])
          .map((img) => `${img?.alt || ""}`.trim().toLowerCase())
          .filter(Boolean);
        const hasDuplicateAlts = normalizedAlts.length > 1 && new Set(normalizedAlts).size !== normalizedAlts.length;

        if (/iron\s*phoenix\s*ghg/i.test(title)) priority += 50; // Critical Identity Risk
        if (/\b(inc|llc|ghg\s*customs?)\b/i.test(title)) priority += 35; // Identity mismatch terms in title
        if ((p.status || "").toLowerCase() === "draft") priority += 30; // Hidden item
        if (tagCount < 5) priority += 25; // Missing/empty tags
        if (body.length < 150) priority += 20; // Thin content
        if (!hasImages) priority += 20; // Missing product image
        if (hasMissingAlts) priority += 15; // Missing image alts
        if (hasDuplicateAlts) priority += 15; // Duplicate image alts
        
        return { ...p, trashPriority: priority };
      });

      for (const product of scoredProducts.sort((a, b) => (b.trashPriority || 0) - (a.trashPriority || 0))) {
        if ((product.trashPriority || 0) > 0 && (product.trashPriority || 0) <= 85) {
          foundTrash.push(product);
        }
      }

      if (!nextPageInfo) break;
    }

    return new Response(JSON.stringify({
      products: foundTrash
        .sort((a, b) => (b.trashPriority || 0) - (a.trashPriority || 0))
        .slice(0, requestedLimit),
      nextPageInfo,
      optimizerUsage: {
        used: connection.optimizer_runs ?? 0,
        limit: 50,
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
