import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";
import {
  buildShopifyAppRedirect,
  getShopifyApiVersion,
  getShopifyClientId,
  getShopifyClientSecret,
  isValidShopDomain,
  verifyShopifyOAuthHmac,
  verifySignedOAuthState,
} from "../_shared/shopify.ts";

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const errorCode = url.searchParams.get("error");
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
        buildShopifyAppRedirect({
          status: errorCode === "access_denied" ? "denied" : "error",
          message: errorCode,
          origin,
          path,
        }),
        302,
      );
    }

    const shop = url.searchParams.get("shop") || "";
    const code = url.searchParams.get("code");

    if (!code || !stateParam || !isValidShopDomain(shop)) {
      return Response.redirect(buildShopifyAppRedirect({ status: "error", message: "Missing or invalid Shopify OAuth parameters." }), 302);
    }

    // Confirms this redirect genuinely came from Shopify.
    const hmacValid = await verifyShopifyOAuthHmac(url);
    if (!hmacValid) {
      return Response.redirect(buildShopifyAppRedirect({ status: "error", message: "Shopify HMAC verification failed." }), 302);
    }

    let state: Awaited<ReturnType<typeof verifySignedOAuthState>>;
    try {
      state = await verifySignedOAuthState(stateParam);
    } catch (error) {
      return Response.redirect(
        buildShopifyAppRedirect({
          status: "error",
          message: error instanceof Error ? error.message : "Invalid Shopify OAuth state.",
        }),
        302,
      );
    }

    if (state.shop !== shop) {
      return Response.redirect(
        buildShopifyAppRedirect({ status: "error", message: "Shop mismatch between authorization request and callback.", origin: state.appOrigin, path: state.returnPath }),
        302,
      );
    }

    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: getShopifyClientId(),
        client_secret: getShopifyClientSecret(),
        code,
      }),
    });

    if (!tokenRes.ok) {
      const tokenError = await tokenRes.text();
      console.error("Shopify token exchange failed:", tokenError);
      return Response.redirect(
        buildShopifyAppRedirect({ status: "error", message: "Shopify token exchange failed.", origin: state.appOrigin, path: state.returnPath }),
        302,
      );
    }

    const tokenData = await tokenRes.json() as { access_token?: string; scope?: string };
    const accessToken = tokenData.access_token;
    const scopes = tokenData.scope || "";

    if (!accessToken) {
      return Response.redirect(
        buildShopifyAppRedirect({ status: "error", message: "Shopify did not return an access token.", origin: state.appOrigin, path: state.returnPath }),
        302,
      );
    }

    let shopName = shop;
    const shopRes = await fetch(`https://${shop}/admin/api/${getShopifyApiVersion()}/shop.json`, {
      headers: { "X-Shopify-Access-Token": accessToken },
    });
    if (shopRes.ok) {
      const shopData = await shopRes.json().catch(() => null) as { shop?: { name?: string } } | null;
      shopName = shopData?.shop?.name || shopName;
    } else {
      console.error("Shopify shop.json lookup failed:", await shopRes.text());
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Offline-access Shopify tokens don't expire and have no refresh token —
    // same shape shopify-manual-connect already writes, so nothing downstream
    // (optimize-shopify-listing, fetch-shopify-products, etc.) needs to change.
    const { error: upsertError } = await supabase.from("store_connections").upsert(
      {
        user_id: state.userId,
        platform: "shopify",
        shop_domain: shop,
        shop_name: shopName,
        access_token: accessToken,
        scopes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,platform,shop_domain" },
    );

    if (upsertError) {
      console.error("Failed to save Shopify connection:", upsertError);
      return Response.redirect(
        buildShopifyAppRedirect({ status: "error", message: "Failed to save Shopify connection.", origin: state.appOrigin, path: state.returnPath }),
        302,
      );
    }

    return Response.redirect(
      buildShopifyAppRedirect({
        status: "connected",
        path: state.returnPath,
        message: `Connected ${shopName}.`,
        origin: state.appOrigin,
      }),
      302,
    );
  } catch (error) {
    console.error("Shopify callback error:", error);
    return Response.redirect(buildShopifyAppRedirect({ status: "error", message: "Internal Shopify OAuth callback error." }), 302);
  }
});
