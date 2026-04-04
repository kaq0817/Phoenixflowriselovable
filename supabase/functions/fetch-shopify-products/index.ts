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
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { limit = 10, connectionId } = await req.json().catch(() => ({}));

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

    // DEEP SCAN: always evaluate up to 500 products (2 Shopify pages at 250 each)
    const fields = "id,title,body_html,product_type,vendor,tags,variants,images,handle,status,metafields_global_description_tag";
    const scanLimit = 250;
    const maxProductsToScan = 500;
    const maxPagesToScan = Math.ceil(maxProductsToScan / scanLimit);
    const requestedLimit = Math.max(1, Math.min(Number(limit) || 10, 50));
    const foundTrash: ShopifyProduct[] = [];
    let nextPageInfo: string | null = null;
    let pagesScanned = 0;
    let productsScanned = 0;

    while (productsScanned < maxProductsToScan && pagesScanned < maxPagesToScan) {
      pagesScanned += 1;
      let apiUrl = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=${scanLimit}&published_status=any&fields=${encodeURIComponent(fields)}`;
      if (nextPageInfo) apiUrl += `&page_info=${nextPageInfo}`;

      const response = await fetch(apiUrl, {
        headers: { "X-Shopify-Access-Token": accessToken },
      });

      if (!response.ok) {
        return new Response(JSON.stringify({ error: "Shopify API error" }), { status: 500, headers: corsHeaders });
      }

      const data = await response.json();
      const batch: ShopifyProduct[] = data.products || [];
      if (batch.length === 0) break;
      productsScanned += batch.length;

      const scoredProducts = batch.map((p) => {
        let priority = 0;
        const title = p.title || "";
        const body = stripHtml(p.body_html);
        const tagCount = normalizeTags(p.tags).length;
        const hasMissingAlts = (p.images || []).some((img) => !img?.alt || img.alt.trim() === "");

        if (/iron\s*phoenix\s*ghg/i.test(title)) priority += 50; // Critical Identity Risk
        if ((p.status || "").toLowerCase() === "draft") priority += 30; // Hidden item
        if (tagCount < 5) priority += 25; // Missing tags
        if (body.length < 150) priority += 20; // Thin content
        if (hasMissingAlts) priority += 15; // Missing image alts
        
        return { ...p, trashPriority: priority };
      });

      for (const product of scoredProducts.sort((a, b) => (b.trashPriority || 0) - (a.trashPriority || 0))) {
        if ((product.trashPriority || 0) > 0) {
          foundTrash.push(product);
        }
      }

      const linkHeader = response.headers.get("Link");
      const nextMatch = linkHeader?.match(/<[^>]*page_info=([^&>]*)>;\s*rel="next"/);
      nextPageInfo = nextMatch ? nextMatch[1] : null;
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
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
