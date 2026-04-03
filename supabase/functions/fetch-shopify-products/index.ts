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

    const { limit = 10, page_info, connectionId } = await req.json().catch(() => ({}));

    // Debug log: incoming connectionId
    console.log('[fetch-shopify-products] incoming connectionId:', connectionId);

    if (!connectionId) {
      return new Response(JSON.stringify({ error: "Missing connectionId" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Only allow fetching the specific connectionId for this user
    const { data: connectionRows, error: connErr } = await supabase
      .from("store_connections")
      .select("*")
      .eq("user_id", user.id)
      .eq("platform", "shopify")
      .eq("id", connectionId);
    const connection = connectionRows?.[0];

    if (connErr || !connection) {
      return new Response(JSON.stringify({ error: "No Shopify connection found for this user and connectionId" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const shop = connection.shop_domain;
    const accessToken = connection.access_token;
    // Debug log: resolved shop domain
    console.log('[fetch-shopify-products] resolved shop domain:', shop);

    const fields = "id,title,body_html,product_type,vendor,tags,variants,images,handle";
    let apiUrl = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=${limit}&fields=${encodeURIComponent(fields)}`;
    if (page_info) {
      apiUrl = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=${limit}&page_info=${page_info}&fields=${encodeURIComponent(fields)}`;
    }

    const response = await fetch(apiUrl, {
      headers: { "X-Shopify-Access-Token": accessToken },
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Shopify API error:", errText);
      return new Response(JSON.stringify({ error: "Failed to fetch products from Shopify" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();

    // Debug log: number of products returned
    console.log('[fetch-shopify-products] number of products returned:', Array.isArray(data.products) ? data.products.length : 0);

    // Parse pagination link header
    const linkHeader = response.headers.get("Link");
    let nextPageInfo: string | null = null;
    if (linkHeader) {
      const nextMatch = linkHeader.match(/<[^>]*page_info=([^&>]*)>;\s*rel="next"/);
      if (nextMatch) nextPageInfo = nextMatch[1];
    }

    return new Response(JSON.stringify({
      products: data.products || [],
      nextPageInfo,
      optimizerUsage: {
        used: connection.optimizer_runs ?? 0,
        limit: 50,
        resetsAt: connection.optimizer_period_start
          ? new Date(new Date(connection.optimizer_period_start).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
          : null,
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("fetch-shopify-products error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
