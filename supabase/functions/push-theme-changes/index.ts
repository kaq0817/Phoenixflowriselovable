import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

const SAFE_PUSH_PATTERNS = [
  /^layout\/theme\.liquid$/,
  /^sections\/[a-z0-9_.-]+\.liquid$/i,
  /^templates\/[a-z0-9_.-]+\.json$/i,
  /^assets\/[a-z0-9_.-]+\.css$/i,
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing auth");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const { connectionId, themeId, approvedFiles } = await req.json();

    if (!connectionId || !themeId || !approvedFiles || typeof approvedFiles !== "object") {
      throw new Error("Missing required fields: connectionId, themeId, approvedFiles");
    }

    const { data: conn, error: connErr } = await supabase
      .from("store_connections")
      .select("*")
      .eq("id", connectionId)
      .eq("user_id", user.id)
      .single();

    if (connErr || !conn) throw new Error("Store connection not found");
    if (conn.platform !== "shopify") throw new Error("Not a Shopify store");

    const shopDomain = conn.shop_domain;
    const accessToken = conn.access_token;

    const safeApprovedFiles = Object.fromEntries(
      Object.entries(approvedFiles).filter(([key, value]) =>
        SAFE_PUSH_PATTERNS.some((pattern) => pattern.test(key)) && typeof value === "string" && value.trim().length > 0,
      )
    );

    if (Object.keys(safeApprovedFiles).length === 0) {
      throw new Error("No safe files selected for push");
    }

    const appliedFiles: string[] = [];
    const errors: string[] = [];

    for (const [key, value] of Object.entries(safeApprovedFiles)) {
      try {
        const putRes = await fetch(
          `https://${shopDomain}/admin/api/2024-01/themes/${themeId}/assets.json`,
          {
            method: "PUT",
            headers: {
              "X-Shopify-Access-Token": accessToken,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ asset: { key, value } }),
          }
        );

        if (putRes.ok) {
          appliedFiles.push(key);
        } else {
          const errData = await putRes.json();
          errors.push(`${key}: ${JSON.stringify(errData.errors || errData)}`);
        }
      } catch (err: any) {
        errors.push(`${key}: ${err.message}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        appliedFiles,
        errors,
        totalModified: appliedFiles.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("push-theme-changes error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
