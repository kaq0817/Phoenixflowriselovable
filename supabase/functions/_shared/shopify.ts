import { decode as base64urlDecode, encode as base64urlEncode } from "https://deno.land/std@0.190.0/encoding/base64url.ts";

export function getShopifyApiVersion(): string {
  return Deno.env.get("SHOPIFY_API_VERSION") || "2025-10";
}

const STATE_TTL_MS = 10 * 60 * 1000;

// Matches every Admin API endpoint actually called across the Shopify functions
// (products, themes, content/blogs/articles, collections, files, inventory,
// online store navigation/domains, plus publications for the channels functions).
const DEFAULT_SHOPIFY_SCOPES = [
  "read_content", "write_content",
  "read_files", "write_files",
  "read_inventory", "write_inventory",
  "read_legal_policies",
  "read_locations",
  "read_online_store_navigation", "write_online_store_navigation",
  "read_products", "write_products",
  "read_metaobjects", "write_metaobjects",
  "read_themes", "write_themes",
  "read_publications", "write_publications",
] as const;

interface ShopifyOAuthStatePayload {
  userId: string;
  shop: string;
  returnPath: string;
  appOrigin?: string;
  exp: number;
}

export function getShopifyClientId(): string {
  const clientId = Deno.env.get("SHOPIFY_CLIENT_ID") || Deno.env.get("SHOPIFY_API_KEY");
  if (!clientId) throw new Error("SHOPIFY_CLIENT_ID not configured");
  return clientId;
}

export function getShopifyClientSecret(): string {
  const secret = Deno.env.get("SHOPIFY_CLIENT_SECRET") || Deno.env.get("SHOPIFY_API_SECRET");
  if (!secret) throw new Error("SHOPIFY_CLIENT_SECRET not configured");
  return secret;
}

export function getShopifyScopes(): string[] {
  const override = Deno.env.get("SHOPIFY_SCOPES");
  if (override) return override.split(",").map((s) => s.trim()).filter(Boolean);
  return [...DEFAULT_SHOPIFY_SCOPES];
}

export function getShopifyRedirectUri(): string {
  return Deno.env.get("SHOPIFY_REDIRECT_URI") || `${Deno.env.get("SUPABASE_URL")}/functions/v1/shopify-callback`;
}

export function isValidShopDomain(shop: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop);
}

function getAppOrigin(): string {
  return Deno.env.get("APP_URL") || Deno.env.get("SITE_URL") || "https://ironphoenixflow.com";
}

function sanitizeMessage(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
}

export function buildShopifyAppRedirect(input: { status: "connected" | "denied" | "error"; message?: string; path?: string; origin?: string }): string {
  const base = new URL(input.path || "/settings", input.origin || getAppOrigin());
  base.searchParams.set("shopify", input.status);
  if (input.message) {
    base.searchParams.set("shopify_message", sanitizeMessage(input.message));
  }
  return base.toString();
}

async function signPayload(payload: string): Promise<string> {
  const secret = Deno.env.get("SHOPIFY_OAUTH_STATE_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY");
  if (!secret) throw new Error("OAuth state secret is not configured");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return base64urlEncode(signatureBuffer);
}

export async function createSignedOAuthState(input: {
  userId: string;
  shop: string;
  returnPath?: string;
  appOrigin?: string;
}): Promise<string> {
  const payload: ShopifyOAuthStatePayload = {
    userId: input.userId,
    shop: input.shop,
    returnPath: input.returnPath || "/settings",
    appOrigin: input.appOrigin,
    exp: Date.now() + STATE_TTL_MS,
  };
  const encodedPayload = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)).buffer);
  const signature = await signPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export async function verifySignedOAuthState(state: string): Promise<ShopifyOAuthStatePayload> {
  const [encodedPayload, signature] = state.split(".");
  if (!encodedPayload || !signature) throw new Error("Invalid state parameter");

  const expectedSignature = await signPayload(encodedPayload);
  if (signature !== expectedSignature) throw new Error("State signature mismatch");

  const payloadText = new TextDecoder().decode(base64urlDecode(encodedPayload));
  const payload = JSON.parse(payloadText) as ShopifyOAuthStatePayload;
  if (!payload.userId || !payload.shop || !payload.returnPath || !payload.exp) {
    throw new Error("Invalid state payload");
  }
  if (payload.exp < Date.now()) {
    throw new Error("OAuth state expired");
  }
  if (payload.appOrigin) {
    try {
      const origin = new URL(payload.appOrigin).origin;
      if (!origin.startsWith("http")) throw new Error("Invalid origin");
      payload.appOrigin = origin;
    } catch {
      throw new Error("Invalid OAuth app origin");
    }
  }

  return payload;
}

// Shopify signs the OAuth callback's own query string (everything except `hmac`
// and `signature`) with the app's client secret. This confirms the redirect
// actually came from Shopify and wasn't forged.
export async function verifyShopifyOAuthHmac(url: URL): Promise<boolean> {
  const hmac = url.searchParams.get("hmac");
  if (!hmac) return false;

  const params: string[] = [];
  for (const [key, value] of url.searchParams.entries()) {
    if (key === "hmac" || key === "signature") continue;
    params.push(`${key}=${value}`);
  }
  params.sort();
  const message = params.join("&");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getShopifyClientSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  const expectedHex = Array.from(new Uint8Array(signatureBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");

  return timingSafeEqual(expectedHex, hmac.toLowerCase());
}

// Shopify signs webhook POST bodies (raw bytes, before JSON.parse) with the
// app's client secret. Compare against the base64-encoded X-Shopify-Hmac-Sha256 header.
export async function verifyShopifyWebhookHmac(rawBody: string, headerValue: string | null): Promise<boolean> {
  if (!headerValue) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getShopifyClientSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expectedBase64 = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));

  return timingSafeEqual(expectedBase64, headerValue);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
