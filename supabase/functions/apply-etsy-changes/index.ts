import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";
import { getEtsyApiKeyHeader, getEtsyClientId } from "../_shared/etsy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

serve(async (req: Request) => {
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
    if (claimsError || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = claimsData.claims.sub;

    const { listingId, originalData, optimizedData, connectionId } = await req.json();
    if (!listingId || !originalData || !optimizedData || !connectionId) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: connection, error: connErr } = await supabase
      .from("store_connections")
      .select("*")
      .eq("user_id", userId)
      .eq("platform", "etsy")
      .eq("id", connectionId)
      .maybeSingle();

    if (connErr || !connection) {
      return new Response(JSON.stringify({ error: "No Etsy connection found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (connection.access_token === "public_only") {
      return new Response(JSON.stringify({ error: "This Etsy connection is read-only. Use Copy buttons, or connect via Etsy OAuth to apply changes directly." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let accessToken = connection.access_token;
    let clientId: string;
    let apiKeyHeader: string;
    try {
      clientId = getEtsyClientId();
      apiKeyHeader = getEtsyApiKeyHeader();
    } catch {
      return new Response(JSON.stringify({ error: "ETSY_CLIENT_ID is not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    const { error: snapError } = await supabase.from("listing_snapshots").insert({
      user_id: userId,
      store_connection_id: connection.id,
      etsy_listing_id: listingId,
      snapshot_data: originalData,
      action_type: "optimization",
    });

    if (snapError) {
      console.error("Snapshot save failed:", snapError);
      return new Response(JSON.stringify({ error: "Failed to save snapshot" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const shopId = connection.shop_domain;
    const updateBody: Record<string, unknown> = {};
    if (optimizedData.title) updateBody.title = optimizedData.title;
    if (optimizedData.description) updateBody.description = optimizedData.description;
    if (optimizedData.tags) updateBody.tags = optimizedData.tags;
    if (optimizedData.materials) updateBody.materials = optimizedData.materials;

    const updateRes = await fetch(`https://api.etsy.com/v3/application/shops/${shopId}/listings/${listingId}`, {
      method: "PATCH",
      headers: {
        "x-api-key": apiKeyHeader,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updateBody),
    });

    if (!updateRes.ok) {
      const errText = await updateRes.text();
      console.error("Etsy update failed:", errText);
      return new Response(JSON.stringify({ error: "Failed to update listing on Etsy" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const updatedListing = await updateRes.json();
    return new Response(JSON.stringify({ success: true, listing: updatedListing }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("apply-etsy-changes error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

