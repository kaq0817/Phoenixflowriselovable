export function getShopifyApiVersion(): string {
  return Deno.env.get("SHOPIFY_API_VERSION") || "2025-10";
}
