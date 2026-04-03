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
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const {
      connectionId,
      articleId,
      title,
      bodyHtml,
      summaryHtml,
      tags,
    } = await req.json();

    if (!connectionId || !articleId) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: conn, error: connErr } = await supabase
      .from("store_connections")
      .select("id, user_id, platform, shop_domain, access_token")
      .eq("id", connectionId)
      .eq("user_id", user.id)
      .eq("platform", "shopify")
      .single();

    if (connErr || !conn) {
      return new Response(JSON.stringify({ error: "Shopify connection not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const updatePayload: Record<string, unknown> = {
      id: Number(articleId),
    };

    if (typeof title === "string") updatePayload.title = title;
    if (typeof bodyHtml === "string") updatePayload.body_html = bodyHtml;
    if (typeof summaryHtml === "string") updatePayload.summary_html = summaryHtml;
    if (typeof tags === "string") updatePayload.tags = tags;

    const response = await fetch(
      `https://${conn.shop_domain}/admin/api/${SHOPIFY_API_VERSION}/articles/${Number(articleId)}.json`,
      {
        method: "PUT",
        headers: {
          "X-Shopify-Access-Token": conn.access_token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ article: updatePayload }),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("update-shopify-article Shopify update failed:", errText);
      return new Response(JSON.stringify({ error: "Failed to update Shopify article" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();

    return new Response(JSON.stringify({ success: true, article: data.article }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("update-shopify-article error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
