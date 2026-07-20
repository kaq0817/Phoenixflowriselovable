import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";
import {
  createSignedOAuthState,
  getShopifyClientId,
  getShopifyRedirectUri,
  getShopifyScopes,
  isValidShopDomain,
} from "../_shared/shopify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { shop, returnPath, appOrigin } = await req.json().catch(() => ({})) as {
      shop?: unknown;
      returnPath?: unknown;
      appOrigin?: unknown;
    };

    const normalizedShop = String(shop || "")
      .trim()
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");

    if (!isValidShopDomain(normalizedShop)) {
      return new Response(JSON.stringify({ error: "Invalid Shopify domain" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const safeReturnPath = typeof returnPath === "string"
      && returnPath.startsWith("/")
      && !returnPath.includes("://")
      && !returnPath.includes("\\");

    const originCandidate = typeof appOrigin === "string" ? appOrigin : req.headers.get("origin") || "";
    let safeAppOrigin: string | undefined;
    if (originCandidate) {
      try {
        safeAppOrigin = new URL(originCandidate).origin;
      } catch {
        // ignore
      }
    }

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
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user?.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const clientId = getShopifyClientId();
    const redirectUri = getShopifyRedirectUri();
    const scopes = getShopifyScopes();

    const state = await createSignedOAuthState({
      userId: userData.user.id,
      shop: normalizedShop,
      returnPath: safeReturnPath ? (returnPath as string) : "/settings",
      appOrigin: safeAppOrigin,
    });

    const authUrl = new URL(`https://${normalizedShop}/admin/oauth/authorize`);
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("scope", scopes.join(","));
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("state", state);

    return new Response(
      JSON.stringify({ url: authUrl.toString(), scopes, redirectUri }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
