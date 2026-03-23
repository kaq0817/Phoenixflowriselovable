import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { shop, accessToken } = await req.json();

    const normalizedShop = String(shop || "")
      .trim()
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");

    if (!normalizedShop.endsWith(".myshopify.com")) {
      return new Response(JSON.stringify({ error: "Invalid Shopify domain" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!accessToken || typeof accessToken !== "string") {
      return new Response(JSON.stringify({ error: "Admin API access token is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData, error: userError } = await userSupabase.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const shopRes = await fetch(`https://${normalizedShop}/admin/api/2024-01/shop.json`, {
      headers: {
        "X-Shopify-Access-Token": accessToken,
      },
    });

    if (!shopRes.ok) {
      const errText = await shopRes.text();
      console.error("Shopify token validation failed:", errText);
      return new Response(JSON.stringify({ error: "Invalid Shopify token or store domain" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const shopData = await shopRes.json();
    const shopName = shopData?.shop?.name || normalizedShop;
    const scopes = shopRes.headers.get("x-shopify-api-scopes") || null;

    const serviceSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { error: upsertError } = await serviceSupabase
      .from("store_connections")
      .upsert(
        {
          user_id: userData.user.id,
          platform: "shopify",
          shop_domain: normalizedShop,
          shop_name: shopName,
          access_token: accessToken,
          scopes,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,platform,shop_domain" }
      );

    if (upsertError) {
      console.error("Failed to save Shopify connection:", upsertError);
      return new Response(JSON.stringify({ error: "Failed to save connection" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        shop: {
          name: shopName,
          domain: normalizedShop,
          scopes,
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("shopify-manual-connect error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});


