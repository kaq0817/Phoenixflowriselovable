import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { verifyShopifyWebhookHmac } from "../_shared/shopify.ts";

// Mandatory Shopify GDPR webhook. Phoenix Flow never stores Shopify customer
// data (only product/listing data) — this is an acknowledgement + log entry,
// there is nothing to redact.
serve(async (req) => {
  try {
    const rawBody = await req.text();
    const hmacHeader = req.headers.get("X-Shopify-Hmac-Sha256");
    const valid = await verifyShopifyWebhookHmac(rawBody, hmacHeader);
    if (!valid) {
      return new Response("Unauthorized", { status: 401 });
    }

    const shopDomain = req.headers.get("X-Shopify-Shop-Domain") || "unknown";
    console.log(`[shopify-webhook] customers/redact for ${shopDomain} — no customer data stored, nothing to redact.`);

    return new Response(null, { status: 200 });
  } catch (error) {
    console.error("shopify-webhook-customers-redact error:", error);
    return new Response("Internal error", { status: 500 });
  }
});
