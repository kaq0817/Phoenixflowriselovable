import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";
import { analyzeThemeAssets, buildThemeFixes } from "../_shared/templanator.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

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

    const { connectionId, themeId, assets, businessInfo } = await req.json();

    if (!connectionId || !themeId || !assets || !businessInfo) {
      throw new Error("Missing required fields");
    }

    const { data: conn, error: connErr } = await supabase
      .from("store_connections")
      .select("shop_domain, shop_name")
      .eq("id", connectionId)
      .eq("user_id", user.id)
      .single();

    if (connErr || !conn) throw new Error("Store connection not found");

    const scan = analyzeThemeAssets({
      assets,
      shopDomain: conn.shop_domain,
      shopName: conn.shop_name,
    });
    const rewrittenFiles = buildThemeFixes({ assets, businessInfo, scan });

    return new Response(
      JSON.stringify({
        success: true,
        rewrittenFiles,
        totalModified: Object.keys(rewrittenFiles).length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("apply-theme-fixes error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
