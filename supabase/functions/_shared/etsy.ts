import { decode as base64urlDecode, encode as base64urlEncode } from "https://deno.land/std@0.190.0/encoding/base64url.ts";

const STATE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_ETSY_SCOPES = ["listings_r", "listings_w", "shops_r"] as const;

interface EtsyOAuthStatePayload {
  userId: string;
  codeVerifier: string;
  returnPath: string;
  exp: number;
}

export function getEtsyClientId(): string {
  const clientId = Deno.env.get("ETSY_CLIENT_ID") || Deno.env.get("ETSY_API_KEY");
  if (!clientId) throw new Error("ETSY_CLIENT_ID not configured");
  return clientId;
}

export function getEtsyApiKeyHeader(): string {
  const clientId = getEtsyClientId();
  const sharedSecret = Deno.env.get("ETSY_CLIENT_SECRET") || Deno.env.get("ETSY_SHARED_SECRET");
  return sharedSecret ? `${clientId}:${sharedSecret}` : clientId;
}

export function getEtsyScopes(): string[] {
  return [...DEFAULT_ETSY_SCOPES];
}

export function getEtsyRedirectUri(): string {
  return Deno.env.get("ETSY_REDIRECT_URI") || `${Deno.env.get("SUPABASE_URL")}/functions/v1/etsy-callback`;
}

export function buildAppRedirect(input: { status: "connected" | "denied" | "error"; message?: string; path?: string }): string {
  const base = new URL(input.path || "/settings", getAppOrigin());
  base.searchParams.set("etsy", input.status);
  if (input.message) {
    base.searchParams.set("etsy_message", sanitizeMessage(input.message));
  }
  return base.toString();
}

export async function createSignedOAuthState(input: {
  userId: string;
  codeVerifier: string;
  returnPath?: string;
}): Promise<string> {
  const payload: EtsyOAuthStatePayload = {
    userId: input.userId,
    codeVerifier: input.codeVerifier,
    returnPath: input.returnPath || "/settings",
    exp: Date.now() + STATE_TTL_MS,
  };
  const encodedPayload = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)).buffer);
  const signature = await signPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export async function verifySignedOAuthState(state: string): Promise<EtsyOAuthStatePayload> {
  const [encodedPayload, signature] = state.split(".");
  if (!encodedPayload || !signature) throw new Error("Invalid state parameter");

  const expectedSignature = await signPayload(encodedPayload);
  if (signature !== expectedSignature) throw new Error("State signature mismatch");

  const payloadText = new TextDecoder().decode(base64urlDecode(encodedPayload));
  const payload = JSON.parse(payloadText) as EtsyOAuthStatePayload;
  if (!payload.userId || !payload.codeVerifier || !payload.returnPath || !payload.exp) {
    throw new Error("Invalid state payload");
  }
  if (payload.exp < Date.now()) {
    throw new Error("OAuth state expired");
  }

  return payload;
}

function getAppOrigin(): string {
  return Deno.env.get("APP_URL") || Deno.env.get("SITE_URL") || "https://ironphoenixflow.com";
}

function sanitizeMessage(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
}

async function signPayload(payload: string): Promise<string> {
  const secret = Deno.env.get("ETSY_OAUTH_STATE_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY");
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

