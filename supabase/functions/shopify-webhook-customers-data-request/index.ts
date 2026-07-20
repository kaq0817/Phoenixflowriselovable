import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { verifyShopifyWebhookHmac } from "../_shared/shopify.ts";

// Mandatory Shopify GDPR webhook. Phoenix Flow never stores Shopify customer
// data (only product/listing data) — this is an acknowledgement + log entry,
// not a data export.
serve(async (req) => {
  try {
    const rawBody = await req.text();
    const hmacHeader = req.headers.get("X-Shopify-Hmac-Sha256");
    const valid = await verifyShopifyWebhookHmac(rawBody, hmacHeader);
    if (!valid) {
      return new Response("Unauthorized", { status: 401 });
    }

    const shopDomain = req.headers.get("X-Shopify-Shop-Domain") || "unknown";
    console.log(`[shopify-webhook] customers/data_request for ${shopDomain} — no customer data stored, nothing to export.`);

    return new Response(null, { status: 200 });
  } catch (error) {
    console.error("shopify-webhook-customers-data-request error:", error);
    return new Response("Internal error", { status: 500 });
  }
});
