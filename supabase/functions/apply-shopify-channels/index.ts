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

    const { connectionId, productId, publicationId, action } = await req.json();
    if (!connectionId || !productId || !publicationId || !action) {
      return new Response(JSON.stringify({ error: "Missing required fields: connectionId, productId, publicationId, action" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (action !== "publish" && action !== "unpublish") {
      return new Response(JSON.stringify({ error: "action must be 'publish' or 'unpublish'" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: connectionRows, error: connErr } = await supabase
      .from("store_connections")
      .select("shop_domain, access_token")
      .eq("user_id", user.id)
      .eq("platform", "shopify")
      .eq("id", connectionId);
    const connection = connectionRows?.[0];

    if (connErr || !connection) {
      return new Response(JSON.stringify({ error: "No Shopify connection found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { shop_domain: shop, access_token: accessToken } = connection;

    if (action === "publish") {
      const res = await fetch(
        `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products/${productId}/product_publications.json`,
        {
          method: "POST",
          headers: {
            "X-Shopify-Access-Token": accessToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ product_publication: { publication_id: publicationId } }),
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        console.error("Shopify publish failed:", errText);
        return new Response(JSON.stringify({ error: "Failed to publish product", detail: errText }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const data = await res.json();
      return new Response(JSON.stringify({ success: true, product_publication: data.product_publication }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "unpublish") {
      // Find the product_publication id for this product + publication
      const ppRes = await fetch(
        `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products/${productId}/product_publications.json`,
        { headers: { "X-Shopify-Access-Token": accessToken } }
      );
      if (!ppRes.ok) {
        return new Response(JSON.stringify({ error: "Failed to fetch product publications" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const ppData = await ppRes.json();
      const record = (ppData.product_publications || []).find(
        (pp: { publication_id: number; id: number }) => pp.publication_id === publicationId
      );
      if (!record) {
        return new Response(JSON.stringify({ success: true, note: "Product was not published to this channel" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const delRes = await fetch(
        `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/product_publications/${record.id}.json`,
        {
          method: "DELETE",
          headers: { "X-Shopify-Access-Token": accessToken },
        }
      );

      if (!delRes.ok) {
        const errText = await delRes.text();
        console.error("Shopify unpublish failed:", errText);
        return new Response(JSON.stringify({ error: "Failed to unpublish product", detail: errText }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (error) {
    console.error("apply-shopify-channels error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
