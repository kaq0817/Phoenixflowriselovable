import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { decode as base64urlDecode } from "https://deno.land/std@0.190.0/encoding/base64url.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (!code || !state) {
      return new Response("Missing code or state parameter", { status: 400 });
    }

    // Decode state to get userId and codeVerifier
    let stateData: { userId: string; codeVerifier: string };
    try {
      const decodedState = new TextDecoder().decode(base64urlDecode(state));
      stateData = JSON.parse(decodedState);
    } catch (e) {
      console.error("Failed to decode or parse state parameter:", e);
      return new Response("Invalid state parameter", { status: 400 });
    }

    const { userId, codeVerifier } = stateData;

    const clientId = Deno.env.get("ETSY_API_KEY");
    if (!clientId) throw new Error("ETSY_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase environment variables not configured for service role");
    }

    const redirectUri = `${supabaseUrl}/functions/v1/etsy-callback`;

    // Exchange authorization code for access token
    const tokenRes = await fetch("https://api.etsy.com/v3/public/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        redirect_uri: redirectUri,
        code: code,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      const errorText = await tokenRes.text();
      console.error("Etsy token exchange failed:", errorText);
      return new Response(`Etsy token exchange failed: ${errorText}`, { status: 500 });
    }

    const tokenData = await tokenRes.json();
    const { access_token, refresh_token, expires_in, scopes } = tokenData;

    // Extract shop ID and name from scopes
    let shopId: string | null = null;
    let shopName: string | null = null;

    // Scopes are space-separated, e.g., "listings_r shops_r:12345 shops_w"
    const scopeArray = scopes.split(" ");
    for (const scope of scopeArray) {
      if (scope.startsWith("shops_r:")) {
        shopId = scope.split(":")[1];
        // Attempt to fetch shop name using the shopId
        try {
          const shopRes = await fetch(`https://openapi.etsy.com/v3/application/shops/${shopId}`, {
            headers: {
              "x-api-key": clientId,
              Authorization: `Bearer ${access_token}`,
            },
          });
          if (shopRes.ok) {
            const shopData = await shopRes.json();
            shopName = shopData.shop_name;
          } else {
            console.warn(`Failed to fetch shop name for shopId ${shopId}: ${await shopRes.text()}`);
          }
        } catch (e) {
          console.error(`Error fetching shop name for shopId ${shopId}:`, e);
        }
        break;
      }
    }

    // Store connection details in Supabase
    const serviceSupabase = createClient(supabaseUrl, serviceRoleKey);

    const { error: insertError } = await serviceSupabase
      .from("store_connections")
      .upsert(
        {
          user_id: userId,
          platform: "etsy",
          access_token: access_token,
          refresh_token: refresh_token,
          token_expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
          scopes: scopes,
          shop_domain: shopId, // Using shopId as domain for consistency with Etsy's numeric ID
          shop_name: shopName,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id, platform" } // Update existing connection for user/platform
      );

    if (insertError) {
      console.error("Supabase insert error:", insertError);
      return new Response(`Supabase insert failed: ${insertError.message}`, { status: 500 });
    }

    // Redirect back to the frontend application (e.g., a success page or dashboard)
    const frontendRedirectUrl = `${Deno.env.get("VITE_SUPABASE_URL")?.split('/functions')[0] || "https://ironphoenixflow.com"}/settings?connection=success`;
    return new Response(null, {
      status: 302,
      headers: {
        Location: frontendRedirectUrl,
      },
    });
  } catch (error) {
    console.error("etsy-callback error:", error);
    // Redirect to an error page on the frontend
    const frontendErrorRedirectUrl = `${Deno.env.get("VITE_SUPABASE_URL")?.split('/functions')[0] || "https://ironphoenixflow.com"}/settings?connection=error&message=${encodeURIComponent(error instanceof Error ? error.message : "Unknown error")}`;
    return new Response(null, {
      status: 302,
      headers: {
        Location: frontendErrorRedirectUrl,
      },
    });
  }
});