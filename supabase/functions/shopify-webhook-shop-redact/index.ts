import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";
import { verifyShopifyWebhookHmac } from "../_shared/shopify.ts";

// Mandatory Shopify GDPR webhook, sent 48 hours after a shop uninstalls or
// closes. Deletes the stored connection so no stale token/shop data remains.
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
      return new Response(null, { status: 200 }); // nothing identifiable to redact
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
      console.error("shopify-webhook-shop-redact delete failed:", error);
      return new Response("Internal error", { status: 500 });
    }

    console.log(`[shopify-webhook] shop/redact for ${shopDomain} — store_connections row(s) deleted.`);
    return new Response(null, { status: 200 });
  } catch (error) {
    console.error("shopify-webhook-shop-redact error:", error);
    return new Response("Internal error", { status: 500 });
  }
});
