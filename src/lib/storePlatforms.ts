export type StorePlatform = "shopify" | "etsy";

export function normalizePlatform(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function isShopifyPlatform(value: unknown): boolean {
  return normalizePlatform(value) === "shopify";
}

export function isEtsyPlatform(value: unknown): boolean {
  return normalizePlatform(value) === "etsy";
}

