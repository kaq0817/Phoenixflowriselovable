import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = claimsData.claims.sub;

    const { snapshotId } = await req.json();
    if (!snapshotId) {
      return new Response(JSON.stringify({ error: "Missing snapshot ID" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get snapshot
    const { data: snapshot, error: snapErr } = await supabase
      .from("listing_snapshots")
      .select("*, store_connections(*)")
      .eq("id", snapshotId)
      .eq("user_id", userId)
      .single();

    if (snapErr || !snapshot) {
      return new Response(JSON.stringify({ error: "Snapshot not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const connection = snapshot.store_connections;
    let accessToken = connection.access_token;
    const clientId = Deno.env.get("ETSY_API_KEY")!;

    // Refresh token if expired
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
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const refreshData = await refreshRes.json();
      accessToken = refreshData.access_token;

      const serviceSupabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      await serviceSupabase.from("store_connections").update({
        access_token: refreshData.access_token,
        refresh_token: refreshData.refresh_token,
        token_expires_at: new Date(Date.now() + refreshData.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", connection.id);
    }

    // Restore original data to Etsy
    const originalData = snapshot.snapshot_data;
    const shopId = connection.shop_domain;

    const updateBody: Record<string, unknown> = {};
    if (originalData.title) updateBody.title = originalData.title;
    if (originalData.description) updateBody.description = originalData.description;
    if (originalData.tags) updateBody.tags = originalData.tags;
    if (originalData.materials) updateBody.materials = originalData.materials;

    const updateRes = await fetch(
      `https://openapi.etsy.com/v3/application/shops/${shopId}/listings/${snapshot.etsy_listing_id}`,
      {
        method: "PATCH",
        headers: {
          "x-api-key": clientId,
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updateBody),
      }
    );

    if (!updateRes.ok) {
      const errText = await updateRes.text();
      console.error("Etsy undo failed:", errText);
      return new Response(JSON.stringify({ error: "Failed to restore listing on Etsy" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Delete snapshot after successful undo
    await supabase.from("listing_snapshots").delete().eq("id", snapshotId);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("undo-etsy-changes error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
