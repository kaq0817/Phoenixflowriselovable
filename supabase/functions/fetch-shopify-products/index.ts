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
  tags: string;
  trashPriority?: number;
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

    // Switched to @ts-expect-error as requested by your ESLint config
    // @ts-expect-error: Deno namespace is provided by the Supabase Edge Runtime
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    // @ts-expect-error: Deno namespace is provided by the Supabase Edge Runtime
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

    const { limit = 10, page_info, connectionId } = await req.json().catch(() => ({}));

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

    // THE DEEP SCAN: Pulling 250 items to surface the real trash
    const fields = "id,title,body_html,product_type,vendor,tags,variants,images,handle,status,metafields_global_description_tag";
    const scanLimit = 250; 
    let apiUrl = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=${scanLimit}&published_status=any&fields=${encodeURIComponent(fields)}`;
    
    if (page_info) {
      apiUrl = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=${scanLimit}&page_info=${page_info}&published_status=any&fields=${encodeURIComponent(fields)}`;
    }

    const response = await fetch(apiUrl, {
      headers: { "X-Shopify-Access-Token": accessToken },
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: "Shopify API error" }), { status: 500, headers: corsHeaders });
    }

    const data = await response.json();
    const allProducts: ShopifyProduct[] = data.products || [];

    // --- WORST-FIRST SCORING ---
    const scoredProducts = allProducts.map((p: ShopifyProduct) => {
      let priority = 0;
      const title = p.title || "";
      const body = p.body_html || "";
      const tags = p.tags || "";

      if (title.includes("Iron Phoenix GHG")) priority += 50; 
      if (p.status?.toLowerCase() === "draft") priority += 30;              
      if (body.length < 150) priority += 20;                 
      if (tags.split(',').length < 3) priority += 15;        
      
      return { ...p, trashPriority: priority };
    });

    // Final sort: highest priority (trashiest) items float to the top
    const finalProducts = scoredProducts
      .sort((a, b) => (b.trashPriority || 0) - (a.trashPriority || 0))
      .slice(0, limit);

    const linkHeader = response.headers.get("Link");
    let nextPageInfo: string | null = null;
    if (linkHeader) {
      const nextMatch = linkHeader.match(/<[^>]*page_info=([^&>]*)>;\s*rel="next"/);
      if (nextMatch) nextPageInfo = nextMatch[1];
    }

    return new Response(JSON.stringify({
      products: finalProducts,
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