import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";
import {
  buildAppRedirect,
  getEtsyApiKeyHeader,
  getEtsyClientId,
  getEtsyRedirectUri,
  getEtsyScopes,
  verifySignedOAuthState,
} from "../_shared/etsy.ts";

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const errorCode = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");
    const stateParam = url.searchParams.get("state");

    if (errorCode) {
      return Response.redirect(
        buildAppRedirect({
          status: errorCode === "access_denied" ? "denied" : "error",
          message: errorDescription || errorCode,
        }),
        302,
      );
    }

    const code = url.searchParams.get("code");
    if (!code || !stateParam) {
      return Response.redirect(buildAppRedirect({ status: "error", message: "Missing Etsy OAuth parameters." }), 302);
    }

    let state: Awaited<ReturnType<typeof verifySignedOAuthState>>;
    try {
      state = await verifySignedOAuthState(stateParam);
    } catch (error) {
      return Response.redirect(
        buildAppRedirect({
          status: "error",
          message: error instanceof Error ? error.message : "Invalid Etsy OAuth state.",
        }),
        302,
      );
    }

    const clientId = getEtsyClientId();
    const redirectUri = getEtsyRedirectUri();
    const scopes = getEtsyScopes().join(" ");

    const tokenRes = await fetch("https://api.etsy.com/v3/public/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        redirect_uri: redirectUri,
        code,
        code_verifier: state.codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      const tokenError = await tokenRes.text();
      console.error("Etsy token exchange failed:", tokenError);
      return Response.redirect(buildAppRedirect({ status: "error", message: "Etsy token exchange failed." }), 302);
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token as string;
    const refreshToken = tokenData.refresh_token as string;
    const expiresIn = Number(tokenData.expires_in || 3600);
    const etsyUserId = String(accessToken).split(".")[0];

    let shopName = "Etsy Shop";
    let shopId: string | null = null;

    if (etsyUserId) {
      const shopRes = await fetch(`https://api.etsy.com/v3/application/users/${etsyUserId}/shops`, {
        headers: {
          "x-api-key": getEtsyApiKeyHeader(),
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (shopRes.ok) {
        const shopData = await shopRes.json();
        if (Array.isArray(shopData.results) && shopData.results[0]) {
          shopName = shopData.results[0].shop_name || shopName;
          shopId = shopData.results[0].shop_id ? String(shopData.results[0].shop_id) : null;
        }
      } else {
        console.error("Etsy shop lookup failed:", await shopRes.text());
      }
    }

    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { error: upsertError } = await supabase.from("store_connections").upsert(
      {
        user_id: state.userId,
        platform: "etsy",
        shop_domain: shopId,
        shop_name: shopName,
        access_token: accessToken,
        refresh_token: refreshToken,
        token_expires_at: tokenExpiresAt,
        scopes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,platform,shop_domain" },
    );

    if (upsertError) {
      console.error("Failed to save Etsy connection:", upsertError);
      return Response.redirect(buildAppRedirect({ status: "error", message: "Failed to save Etsy connection." }), 302);
    }

    return Response.redirect(
      buildAppRedirect({
        status: "connected",
        path: state.returnPath,
        message: shopName === "Etsy Shop" ? "Etsy OAuth connected." : `Connected ${shopName}.`,
      }),
      302,
    );
  } catch (error) {
    console.error("Etsy callback error:", error);
    return Response.redirect(buildAppRedirect({ status: "error", message: "Internal Etsy OAuth callback error." }), 302);
  }
});
