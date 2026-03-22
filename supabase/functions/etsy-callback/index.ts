import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";
import { decode as base64urlDecode } from "https://deno.land/std@0.190.0/encoding/base64url.ts";

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const stateParam = url.searchParams.get("state");

    if (!code || !stateParam) {
      return new Response("Missing required parameters", { status: 400 });
    }

    // Decode URL-safe base64 state
    let userId: string;
    let codeVerifier: string;
    try {
      const stateJson = new TextDecoder().decode(base64urlDecode(stateParam));
      const parsed = JSON.parse(stateJson);
      userId = parsed.userId;
      codeVerifier = parsed.codeVerifier;
    } catch {
      return new Response("Invalid state parameter", { status: 400 });
    }

    if (!userId || !codeVerifier) {
      return new Response("Invalid state", { status: 400 });
    }

    const clientId = Deno.env.get("ETSY_API_KEY");
    if (!clientId) {
      return new Response("Etsy credentials not configured", { status: 500 });
    }

    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/etsy-callback`;

    // Exchange code for access token
    const tokenRes = await fetch("https://api.etsy.com/v3/public/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        redirect_uri: redirectUri,
        code,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error("Etsy token exchange failed:", errText);
      return new Response(`Failed to get access token: ${errText}`, { status: 500 });
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;
    const expiresIn = tokenData.expires_in;

    // Get shop info
    let shopName = "Etsy Shop";
    let shopId = null;
    try {
      const etsyUserId = accessToken.split(".")[0];
      const shopRes = await fetch(`https://openapi.etsy.com/v3/application/users/${etsyUserId}/shops`, {
        headers: {
          "x-api-key": clientId,
          "Authorization": `Bearer ${accessToken}`,
        },
      });
      if (shopRes.ok) {
        const shopData = await shopRes.json();
        if (shopData.results && shopData.results.length > 0) {
          shopName = shopData.results[0].shop_name;
          shopId = shopData.results[0].shop_id;
        }
      } else {
        await shopRes.text(); // consume body
      }
    } catch (e) {
      console.error("Failed to fetch Etsy shop info:", e);
    }

    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { error: upsertError } = await supabase.from("store_connections").upsert(
      {
        user_id: userId,
        platform: "etsy",
        shop_domain: shopId ? String(shopId) : null,
        shop_name: shopName,
        access_token: accessToken,
        refresh_token: refreshToken,
        token_expires_at: tokenExpiresAt,
        scopes: "listings_r listings_w shops_r shops_w",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,platform,shop_domain" }
    );

    if (upsertError) {
      console.error("Failed to save connection:", upsertError);
      return new Response("Failed to save connection", { status: 500 });
    }

    const redirectUrl = "https://ironphoenixflow.com";
    return new Response(null, {
      status: 302,
      headers: { Location: `${redirectUrl}/settings?etsy=connected` },
    });
  } catch (error) {
    console.error("Etsy callback error:", error);
    return new Response("Internal server error", { status: 500 });
  }
});
