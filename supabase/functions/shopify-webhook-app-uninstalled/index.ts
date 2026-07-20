import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";
import { verifyShopifyWebhookHmac } from "../_shared/shopify.ts";

// Fired the moment a merchant uninstalls the app. Deletes the connection
// immediately so we stop trying to use a token Shopify has already revoked.
serve(async (req) => {
  try {
    const rawBody = await req.text();
    const hmacHeader = req.headers.get("X-Shopify-Hmac-Sha256");
    const valid = await verifyShopifyWebhookHmac(rawBody, hmacHeader);
    if (!valid) {
      return new Response("Unauthorized", { status: 401 });
    }

    const shopDomain = req.headers.get("X-Shopify-Shop-Domain");
    if (!shopDomain) {
      return new Response(null, { status: 200 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { error } = await supabase
      .from("store_connections")
      .delete()
      .eq("platform", "shopify")
      .eq("shop_domain", shopDomain);

    if (error) {
      console.error("shopify-webhook-app-uninstalled delete failed:", error);
      return new Response("Internal error", { status: 500 });
    }

    console.log(`[shopify-webhook] app/uninstalled for ${shopDomain} — store_connections row(s) deleted.`);
    return new Response(null, { status: 200 });
  } catch (error) {
    console.error("shopify-webhook-app-uninstalled error:", error);
    return new Response("Internal error", { status: 500 });
  }
});
