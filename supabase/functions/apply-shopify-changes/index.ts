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

    const { productId, optimizedData, connectionId, imageAltEdits } = await req.json();
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
    const shopLabel: string = connection.shop_name || connection.shop_domain || "";

    // Build update payload
    const updateBody: Record<string, unknown> = {};
    if (optimizedData.title) updateBody.title = optimizedData.title;
    if (optimizedData.body_html) updateBody.body_html = optimizedData.body_html;
    if (optimizedData.product_type) updateBody.product_type = optimizedData.product_type;
    if (optimizedData.tags) updateBody.tags = optimizedData.tags;
    if (optimizedData.url_handle) updateBody.handle = optimizedData.url_handle;

    // Update product via Shopify API
    const updateRes = await fetch(
      `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products/${productId}.json`,
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

    // Fetch existing metafields once, then upsert each one
    const existingMfRes = await fetch(
      `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products/${productId}/metafields.json`,
      { headers: { "X-Shopify-Access-Token": accessToken } }
    );
    const existingMfData = existingMfRes.ok ? await existingMfRes.json() : { metafields: [] };
    const existingMetafields: { id: number; namespace: string; key: string }[] = existingMfData.metafields || [];

    const findMetafield = (namespace: string, key: string) =>
      existingMetafields.find((m) => m.namespace === namespace && m.key === key);

    const upsertMetafield = async (namespace: string, key: string, value: string, type: string) => {
      const existing = findMetafield(namespace, key);
      const url = existing
        ? `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/metafields/${existing.id}.json`
        : `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products/${productId}/metafields.json`;
      const method = existing ? "PUT" : "POST";
      const payload = {
        metafield: {
          ...(existing ? { id: existing.id } : { namespace, key, type }),
          value,
        },
      };
      const res = await fetch(url, {
        method,
        headers: { "X-Shopify-Access-Token": accessToken, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errorBody = await res.text();
        console.error(`Failed to ${method} metafield ${namespace}.${key}:`, errorBody);
      }
    };

    if (optimizedData.seo_title) {
      await upsertMetafield("global", "title_tag", optimizedData.seo_title, "single_line_text_field");
    }
    if (optimizedData.seo_description) {
      await upsertMetafield("global", "description_tag", optimizedData.seo_description, "single_line_text_field");
    }
    if (optimizedData.faq_json) {
      const faqValue = typeof optimizedData.faq_json === "string"
        ? optimizedData.faq_json
        : JSON.stringify(optimizedData.faq_json);
      await upsertMetafield("custom", "faq", faqValue, "json");
    }

    // Update image alt text — prefer explicit imageAltEdits map, fall back to optimizedData.image_alts JSON string
    let resolvedAltEdits: Record<string, string> | null = null;
    if (imageAltEdits && typeof imageAltEdits === "object") {
      resolvedAltEdits = imageAltEdits as Record<string, string>;
    } else if (optimizedData.image_alts && typeof optimizedData.image_alts === "string") {
      try {
        const parsed: { image_id: number; alt: string }[] = JSON.parse(optimizedData.image_alts);
        if (Array.isArray(parsed)) {
          resolvedAltEdits = {};
          for (const entry of parsed) {
            if (typeof entry.image_id === "number" && entry.alt) {
              resolvedAltEdits[String(entry.image_id)] = entry.alt;
            }
          }
        }
      } catch { /* ignore malformed image_alts */ }
    }
    if (resolvedAltEdits) {
      for (const [imageId, altText] of Object.entries(resolvedAltEdits)) {
        if (!altText) continue;
        // Brand the alt to the current store so Google Merchant sees consistent identity
        const brandedAlt = shopLabel && !altText.includes(shopLabel)
          ? `${altText.split("|")[0].trimEnd()} | ${shopLabel}`
          : altText;
        // Enforce Shopify's 512-char image alt limit (Google recommends under 125)
        const finalAlt = brandedAlt.slice(0, 512);
        await fetch(
          `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products/${productId}/images/${imageId}.json`,
          {
            method: "PUT",
            headers: {
              "X-Shopify-Access-Token": accessToken,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ image: { id: Number(imageId), alt: finalAlt } }),
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





