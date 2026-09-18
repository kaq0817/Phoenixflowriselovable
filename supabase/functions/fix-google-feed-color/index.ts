import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";
import { getShopifyApiVersion } from "../_shared/shopify.ts";
import { VAGUE_COLOR_VALUES } from "../_shared/googleFeedColors.ts";

const SHOPIFY_API_VERSION = getShopifyApiVersion();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

const OPTION_KEYS = ["option1", "option2", "option3"] as const;

serve(async (req: Request) => {
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
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { connectionId, variantId, colorOptionIndex, color } = await req.json();
    if (!connectionId || !variantId || (colorOptionIndex !== 0 && !colorOptionIndex) || typeof color !== "string") {
      return new Response(JSON.stringify({ error: "connectionId, variantId, colorOptionIndex, and color are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (colorOptionIndex < 0 || colorOptionIndex > 2) {
      return new Response(JSON.stringify({ error: "colorOptionIndex must be 0, 1, or 2" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const trimmedColor = color.trim();
    if (!trimmedColor) {
      return new Response(JSON.stringify({ error: "Color cannot be empty" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (trimmedColor.length > 100) {
      return new Response(JSON.stringify({ error: "Color must be 100 characters or fewer" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (VAGUE_COLOR_VALUES.has(trimmedColor.toLowerCase())) {
      return new Response(JSON.stringify({ error: `"${trimmedColor}" is too vague for Google Shopping — use a real color name (e.g. "Black", "Navy", "Sage Green").` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify the connection belongs to this user
    const { data: connections } = await supabase
      .from("store_connections")
      .select("shop_domain, access_token")
      .eq("id", connectionId)
      .eq("user_id", user.id)
      .eq("platform", "shopify")
      .limit(1);

    const connection = connections?.[0];
    if (!connection) throw new Error("Shopify connection not found");

    const optionKey = OPTION_KEYS[colorOptionIndex];
    const updateRes = await fetch(
      `https://${connection.shop_domain}/admin/api/${SHOPIFY_API_VERSION}/variants/${Number(variantId)}.json`,
      {
        method: "PUT",
        headers: {
          "X-Shopify-Access-Token": connection.access_token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          variant: { id: Number(variantId), [optionKey]: trimmedColor },
        }),
      }
    );

    if (!updateRes.ok) {
      const errText = await updateRes.text();
      throw new Error(`Shopify could not update this variant: ${errText.slice(0, 200)}`);
    }

    const updated = await updateRes.json();

    return new Response(JSON.stringify({
      variant: {
        id: updated.variant?.id,
        title: updated.variant?.title,
        color: trimmedColor,
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update the variant color";
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
