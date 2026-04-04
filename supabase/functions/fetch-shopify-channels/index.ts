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

    const { connectionId, productId } = await req.json();
    if (!connectionId) {
      return new Response(JSON.stringify({ error: "Missing connectionId" }), {
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

    // Fetch all available publications (sales channels) via GraphQL
    const gqlRes = await fetch(
      `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: `{
            publications(first: 20) {
              edges {
                node {
                  id
                  name
                }
              }
            }
          }`,
        }),
      }
    );

    if (!gqlRes.ok) {
      const errText = await gqlRes.text();
      console.error("Shopify publications fetch failed:", errText);
      return new Response(JSON.stringify({ error: "Failed to fetch publications from Shopify", detail: errText }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const gqlData = await gqlRes.json();
    const publications: { id: number; name: string }[] = (gqlData.data?.publications?.edges || []).map(
      (edge: { node: { id: string; name: string } }) => ({
        id: parseInt(edge.node.id.replace("gid://shopify/Publication/", ""), 10),
        name: edge.node.name,
      })
    );

    // 2. If productId provided, fetch which channels the product is published to
    let publishedPublicationIds: number[] = [];
    if (productId) {
      const ppRes = await fetch(
        `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products/${productId}/product_publications.json`,
        { headers: { "X-Shopify-Access-Token": accessToken } }
      );
      if (ppRes.ok) {
        const ppData = await ppRes.json();
        publishedPublicationIds = (ppData.product_publications || []).map(
          (pp: { publication_id: number }) => pp.publication_id
        );
      }
    }

    return new Response(JSON.stringify({ publications, publishedPublicationIds }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("fetch-shopify-channels error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
