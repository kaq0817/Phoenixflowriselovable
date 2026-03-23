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
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = claimsData.claims.sub;

    const { limit = 25, offset = 0, state: listingState = "active", connectionId } =
      await req.json().catch(() => ({}));

    let connQuery = supabase
      .from("store_connections")
      .select("*")
      .eq("user_id", userId)
      .eq("platform", "etsy")
      .order("created_at", { ascending: false })
      .limit(1);

    if (connectionId) {
      connQuery = connQuery.eq("id", connectionId);
    }

    const { data: connectionRows, error: connErr } = await connQuery;
    const connection = connectionRows?.[0];

    if (connErr || !connection) {
      return new Response(
        JSON.stringify({
          error: "No Etsy connection found. Please connect an Etsy shop in Settings first.",
        }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Read-only/manual Etsy connection: fetch public listings through fallback function
    if (connection.access_token === "public_only" || !connection.refresh_token) {
      const shopName = connection.shop_name || connection.shop_domain;
      if (!shopName) {
        return new Response(
          JSON.stringify({ error: "Connected Etsy store is missing shop identifier." }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const publicRes = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/fetch-etsy-public-listings`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
          },
          body: JSON.stringify({ shopName, limit, offset }),
        },
      );

      const publicText = await publicRes.text();
      if (!publicRes.ok) {
        return new Response(publicText, {
          status: publicRes.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const publicData = JSON.parse(publicText);
      return new Response(
        JSON.stringify({
          ...publicData,
          connection_id: connection.id,
          mode: "public_readonly",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    let accessToken = connection.access_token;
    const clientId = Deno.env.get("ETSY_CLIENT_ID") || Deno.env.get("ETSY_API_KEY");
    if (!clientId) {
      return new Response(JSON.stringify({ error: "ETSY_CLIENT_ID is not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if token is expired and refresh if needed
    if (connection.token_expires_at && new Date(connection.token_expires_at) <= new Date()) {
      const refreshRes = await fetch("https://api.etsy.com/v3/public/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: connection.refresh_token!,
        }),
      });

      if (!refreshRes.ok) {
        return new Response(JSON.stringify({ error: "Token expired. Please reconnect your Etsy shop." }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const refreshData = await refreshRes.json();
      accessToken = refreshData.access_token;

      // Update stored tokens using service role
      const serviceSupabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      await serviceSupabase
        .from("store_connections")
        .update({
          access_token: refreshData.access_token,
          refresh_token: refreshData.refresh_token,
          token_expires_at: new Date(Date.now() + refreshData.expires_in * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", connection.id);
    }

    const shopId = connection.shop_domain;
    if (!shopId) {
      return new Response(JSON.stringify({ error: "Connected Etsy shop is missing shop ID." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const listingsRes = await fetch(
      `https://openapi.etsy.com/v3/application/shops/${shopId}/listings?limit=${limit}&offset=${offset}&state=${listingState}&includes=Images`,
      {
        headers: {
          "x-api-key": clientId,
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (!listingsRes.ok) {
      const errText = await listingsRes.text();
      console.error("Etsy listings fetch failed:", errText);
      return new Response(
        JSON.stringify({
          error:
            errText.includes("API key not found")
              ? "Etsy API credentials are invalid. Update ETSY_CLIENT_ID and Etsy OAuth credentials in project secrets."
              : "Failed to fetch listings from Etsy",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const listingsData = await listingsRes.json();

    return new Response(
      JSON.stringify({
        ...listingsData,
        connection_id: connection.id,
        mode: "oauth",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("fetch-etsy-listings error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});



