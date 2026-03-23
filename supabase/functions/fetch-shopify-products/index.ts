import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";

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

    // Get the most recently connected Shopify store so multi-store accounts work.
    const { data: connection, error: connErr } = await supabase
      .from("store_connections")
      .select("*")
      .eq("user_id", user.id)
      .eq("platform", "shopify")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (connErr || !connection) {
      return new Response(JSON.stringify({ error: "No Shopify connection found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { limit = 50, page_info } = await req.json().catch(() => ({}));
    const shop = connection.shop_domain;
    const accessToken = connection.access_token;

    let apiUrl = `https://${shop}/admin/api/2024-01/products.json?limit=${limit}&status=active`;
    if (page_info) {
      apiUrl = `https://${shop}/admin/api/2024-01/products.json?limit=${limit}&page_info=${page_info}`;
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



