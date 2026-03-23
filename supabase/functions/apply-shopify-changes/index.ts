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

    const { productId, optimizedData, connectionId } = await req.json();
    if (!productId || !optimizedData) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let connectionQuery = supabase
      .from("store_connections")
      .select("*")
      .eq("user_id", user.id)
      .eq("platform", "shopify")
      .order("created_at", { ascending: false })
      .limit(1);

    if (connectionId) {
      connectionQuery = connectionQuery.eq("id", connectionId);
    }

    const { data: connectionRows, error: connErr } = await connectionQuery;
    const connection = connectionRows?.[0];

    if (connErr || !connection) {
      return new Response(JSON.stringify({ error: "No Shopify connection found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const shop = connection.shop_domain;
    const accessToken = connection.access_token;

    // Build update payload
    const updateBody: Record<string, unknown> = {};
    if (optimizedData.title) updateBody.title = optimizedData.title;
    if (optimizedData.body_html) updateBody.body_html = optimizedData.body_html;
    if (optimizedData.product_type) updateBody.product_type = optimizedData.product_type;
    if (optimizedData.tags) updateBody.tags = optimizedData.tags;

    // Update product via Shopify API
    const updateRes = await fetch(
      `https://${shop}/admin/api/2024-01/products/${productId}.json`,
      {
        method: "PUT",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ product: { id: productId, ...updateBody } }),
      }
    );

    if (!updateRes.ok) {
      const errText = await updateRes.text();
      console.error("Shopify update failed:", errText);
      return new Response(JSON.stringify({ error: "Failed to update product on Shopify" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update SEO metafields if provided
    if (optimizedData.seo_title || optimizedData.seo_description) {
      const metafieldsToSet = [];
      if (optimizedData.seo_title) {
        metafieldsToSet.push({
          namespace: "global",
          key: "title_tag",
          value: optimizedData.seo_title,
          type: "single_line_text_field",
        });
      }
      if (optimizedData.seo_description) {
        metafieldsToSet.push({
          namespace: "global",
          key: "description_tag",
          value: optimizedData.seo_description,
          type: "single_line_text_field",
        });
      }

      for (const mf of metafieldsToSet) {
        await fetch(
          `https://${shop}/admin/api/2024-01/products/${productId}/metafields.json`,
          {
            method: "POST",
            headers: {
              "X-Shopify-Access-Token": accessToken,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ metafield: mf }),
          }
        );
      }
    }

    const updatedProduct = await updateRes.json();

    return new Response(JSON.stringify({ success: true, product: updatedProduct.product }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("apply-shopify-changes error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});





