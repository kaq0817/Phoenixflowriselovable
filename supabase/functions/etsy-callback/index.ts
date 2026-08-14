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

async function getEtsyUserId(accessToken: string): Promise<string | null> {
  // Always resolve via Etsy's own /users/me endpoint rather than trusting the numeric
  // prefix of the access token. The token-shape shortcut this used to take (treating
  // `token.split(".")[0]` as the user id whenever it looked numeric) can silently resolve
  // to the wrong id if that assumption doesn't hold, which then makes the shop lookup
  // legitimately return zero shops for a real, valid shop owner. /users/me is the
  // authoritative source, so always use it.
  const apiKeyHeader = getEtsyApiKeyHeader();
  const meRes = await fetch("https://api.etsy.com/v3/application/users/me", {
    headers: {
      "x-api-key": apiKeyHeader,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!meRes.ok) {
    console.error("Etsy users/me lookup failed:", await meRes.text());
    return null;
  }

  const meData = await meRes.json().catch(() => null) as { user_id?: number | string } | null;
  const userId = meData?.user_id;
  if (typeof userId === "number") return String(userId);
  if (typeof userId === "string" && userId.trim()) return userId.trim();
  return null;
}

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const errorCode = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");
    const stateParam = url.searchParams.get("state");

    if (errorCode) {
      let origin: string | undefined;
      let path: string | undefined;
      if (stateParam) {
        try {
          const recovered = await verifySignedOAuthState(stateParam);
          origin = recovered.appOrigin;
          path = recovered.returnPath;
        } catch {
          // ignore
        }
      }
      return Response.redirect(
        buildAppRedirect({
          status: errorCode === "access_denied" ? "denied" : "error",
          message: errorDescription || errorCode,
          origin,
          path,
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
      return Response.redirect(buildAppRedirect({ status: "error", message: "Etsy token exchange failed.", origin: state.appOrigin, path: state.returnPath }), 302);
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token as string;
    const refreshToken = tokenData.refresh_token as string;
    const expiresIn = Number(tokenData.expires_in || 3600);

    let shopName: string | null = null;
    let shopId: string | null = null;
    let shopLookupDetail = "";

    const etsyUserId = await getEtsyUserId(accessToken);
    if (!etsyUserId) {
      return Response.redirect(
        buildAppRedirect({
          status: "error",
          message: "Could not determine Etsy user for this OAuth session. Please try again.",
          origin: state.appOrigin,
          path: state.returnPath,
        }),
        302,
      );
    }

    const shopRes = await fetch(`https://api.etsy.com/v3/application/users/${etsyUserId}/shops`, {
      headers: {
        "x-api-key": getEtsyApiKeyHeader(),
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (shopRes.ok) {
      const shopData = await shopRes.json().catch(() => null) as { results?: Array<{ shop_name?: string; shop_id?: number | string }> } | null;
      const first = shopData?.results?.[0];
      if (first) {
        shopName = first.shop_name || null;
        shopId = first.shop_id ? String(first.shop_id) : null;
      } else {
        shopLookupDetail = "Etsy returned no shops for this account.";
        console.error("Etsy shop lookup returned no results:", JSON.stringify(shopData));
      }
    } else {
      shopLookupDetail = await shopRes.text();
      console.error("Etsy shop lookup failed:", shopLookupDetail);
    }

    // A connection is only meaningful once we have both a real shop id (used to call the
    // Listings API) and a real shop name (shown to the user). Previously this fell back to
    // the literal string "Etsy Shop" and still reported success, which silently saved a
    // broken connection that looked connected but couldn't be used for anything.
    if (!shopId || !shopName) {
      return Response.redirect(
        buildAppRedirect({
          status: "error",
          message: shopLookupDetail
            ? `Etsy OAuth succeeded, but the shop lookup failed: ${shopLookupDetail.slice(0, 160)}`
            : "Etsy OAuth succeeded, but no shop was found for this account. Make sure your Etsy account has an active shop, then try again.",
          origin: state.appOrigin,
          path: state.returnPath,
        }),
        302,
      );
    }

    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Clean up any broken records (null shop_domain or shop_name) for this user
    // so stale broken connections don't shadow the new good one.
    await supabase
      .from("store_connections")
      .delete()
      .eq("user_id", state.userId)
      .eq("platform", "etsy")
      .or("shop_domain.is.null,shop_name.is.null");

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
      return Response.redirect(buildAppRedirect({ status: "error", message: "Failed to save Etsy connection.", origin: state.appOrigin, path: state.returnPath }), 302);
    }

    return Response.redirect(
      buildAppRedirect({
        status: "connected",
        path: state.returnPath,
        message: `Connected ${shopName}.`,
        origin: state.appOrigin,
      }),
      302,
    );
  } catch (error) {
    console.error("Etsy callback error:", error);
    return Response.redirect(buildAppRedirect({ status: "error", message: "Internal Etsy OAuth callback error." }), 302);
  }
});
